/**
 * Prerender the landing page into static HTML.
 *
 * The editor is an application and has no business being a document. The landing
 * page is the opposite: it is a document that happens to be interactive, it is
 * the thing search engines read, and it is the URL people paste into chat. All
 * three of those break if the page is empty until a module loads.
 *
 * So this renders the built page in a real browser, lifts the markup out of
 * `#app`, and writes it back into `dist/index.html`. The result is a normal
 * static page: full text in the served HTML, and the interactive parts still
 * work because Svelte hydrates the markup rather than replacing it.
 *
 * Run as part of `npm run build`, after Vite. It needs a Chrome binary, which is
 * the same requirement as `test:e2e` already has, and it is skipped with a
 * warning rather than failing the build if one is not present.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, "dist");
const PORT = Number(process.env.PRERENDER_PORT ?? 4399);

/** Chrome locations, in the order they are tried. */
const BROWSERS = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const executablePath = BROWSERS.find((candidate) => existsSync(candidate));

if (!executablePath) {
  console.warn(
    "prerender: no Chrome binary found, so the landing page was left client-rendered.\n" +
      "  Set CHROME_PATH to prerender it. The page still works; it just ships empty to a crawler.",
  );
  process.exit(0);
}

if (!existsSync(path.join(DIST, "index.html"))) {
  console.error("prerender: dist/index.html is missing. Run the build first.");
  process.exit(1);
}

/** Serve `dist` on a port, so the page loads over http rather than file://. */
const server = spawn(
  "npx",
  ["vite", "preview", "--port", String(PORT), "--strictPort"],
  { cwd: here, stdio: "ignore" },
);

const shutdown = (code) => {
  server.kill();
  process.exit(code);
};

process.on("exit", () => server.kill());

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`http://localhost:${PORT}/index.html`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

if (!(await waitForServer())) {
  console.error("prerender: the preview server did not come up.");
  shutdown(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  const problems = [];
  page.on("pageerror", (error) => problems.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle0", timeout: 60000 });

  // Wait for the hero pass, so the markup is lifted from a settled page rather
  // than one caught mid-render. A page that only half-settled would prerender
  // a canvas with no `ready` class and a skeleton with no caption.
  await page.waitForFunction(() => document.querySelector(".effect--ready"), { timeout: 60000 });

  // Scroll the whole document once so every `data-reveal` has fired, then
  // return to the top. Without this the lifted markup would carry the hidden
  // state and a crawler reading attributes would think the sections are empty.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    window.scrollTo(0, 0);
  });

  const { html, title, description } = await page.evaluate(() => {
    const app = document.getElementById("app");
    // The canvases hold pixels, not markup, and a canvas serialises as an empty
    // box. The alternative would be embedding the output as a data URL, which
    // would put six hundred kilobytes of base64 into the HTML for content the
    // page recomputes on hydration anyway. The `noscript` copy below and the
    // alt text on the wrapper carry the same information in words.
    return {
      html: app.innerHTML,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content ?? "",
    };
  });

  if (problems.length > 0) {
    console.error(`prerender: the page reported ${problems.length} error(s) before it settled.`);
    for (const problem of problems.slice(0, 5)) console.error(`  ${problem}`);
    shutdown(1);
  }

  const file = path.join(DIST, "index.html");
  let source = await readFile(file, "utf8");

  // Replace the empty mount point with the rendered markup, and flag it so the
  // entry point knows to hydrate rather than mount.
  const mountPoint = '<div id="app"></div>';
  if (!source.includes(mountPoint)) {
    console.error("prerender: could not find the empty #app mount point in dist/index.html.");
    shutdown(1);
  }

  source = source.replace(mountPoint, `<div id="app" data-prerendered>${html}</div>`);

  await writeFile(file, source);

  const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  console.log(
    `prerender: wrote ${(html.length / 1024).toFixed(0)}KB of markup, ${words} words, into dist/index.html`,
  );
} finally {
  await browser.close();
}

shutdown(0);
