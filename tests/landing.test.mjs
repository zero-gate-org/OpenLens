/**
 * Landing page smoke test.
 *
 * Drives the real built page in headless Chrome and checks the things a
 * screenshot cannot: that the canvas passes actually produced pixels, that the
 * deep-link redirect works, and that nothing logged an error.
 */

import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? process.env.LANDING_BASE ?? "http://localhost:4173";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
});

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function newPage(width = 1440, height = 900) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  return { page, errors };
}

/* ------------------------------------------------------------------ *
 * 1. The landing page renders and its passes produce real pixels.
 * ------------------------------------------------------------------ */
{
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0", timeout: 45000 });

  const h1 = await page.$eval("h1", (el) => el.textContent.trim());
  check("hero headline present", h1.length > 0, `"${h1}"`);

  check(
    "hero headline is one line at 1440",
    await page.$eval("h1", (el) => el.getClientRects().length === 1),
  );

  const cta = await page.$eval(".actions .btn--primary", (el) => el.textContent.trim());
  check("hero CTA says one thing", /open the editor/i.test(cta), `"${cta}"`);

  // The primary CTA must be inside the first viewport, without scrolling.
  const ctaTop = await page.$eval(".actions .btn--primary", (el) => el.getBoundingClientRect().top);
  check("hero CTA is above the fold", ctaTop < 900, `top ${Math.round(ctaTop)}px`);

  // The nav must not wrap at desktop.
  check(
    "nav is one line",
    await page.$eval(".bar .inner", (el) => el.getBoundingClientRect().height <= 58),
  );

  /*
   * The nav is a floating tab, so it sits over the hero by design. What must not
   * happen is content landing underneath it: a tab that covers the headline, or
   * an anchor that tucks a heading under the tab.
   */
  const tab = await page.$eval(".bar", (el) => {
    const b = el.getBoundingClientRect();
    return {
      bottom: Math.round(b.bottom),
      left: Math.round(b.left),
      right: Math.round(b.right),
      radius: getComputedStyle(el).borderTopLeftRadius,
      viewport: window.innerWidth,
    };
  });

  const h1Top = await page.$eval("h1", (el) => el.getBoundingClientRect().top);
  check("floating tab clears the headline", h1Top > tab.bottom, `h1 ${Math.round(h1Top)} vs tab ${tab.bottom}`);
  check("hero CTA clears the tab", ctaTop > tab.bottom, `cta ${Math.round(ctaTop)} vs tab ${tab.bottom}`);

  check(
    "tab is inset from the viewport edges, not full width",
    tab.left > 8 && tab.right < tab.viewport - 8,
    `${tab.left} to ${tab.right} of ${tab.viewport}`,
  );

  // The radius has to be the button radius. A pill around a rectangle of
  // content reads as a floating control, not as navigation, and would be a
  // second radius system on a page that has one.
  check("tab uses the button radius, not a pill", tab.radius.startsWith("8"), tab.radius);

  // An anchor jump must land clear of the tab, not underneath it.
  await page.evaluate(() => document.querySelector("#faq").scrollIntoView());
  await new Promise((r) => setTimeout(r, 700));
  const faqTop = await page.$eval("#faq .h2", (el) => Math.round(el.getBoundingClientRect().top));
  check("anchor jump lands clear of the tab", faqTop > 0, `${faqTop}px from the top`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 400));

  // Hero demo canvas: wait for the pass, then confirm it is not a blank frame.
  await page.waitForFunction(
    () => document.querySelector(".effect")?.classList.contains("effect--ready"),
    { timeout: 30000 },
  );

  const canvasStats = await page.$eval(".effect", (canvas) => {
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Count distinct-ish colours: a blank or single-colour canvas means the
    // pass never wrote anything.
    const seen = new Set();
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      seen.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
      if (data[i + 3] > 0) opaque += 1;
    }
    return { colours: seen.size, opaque, w: canvas.width, h: canvas.height };
  });
  check(
    "hero canvas holds a real processed frame",
    canvasStats.colours > 12 && canvasStats.opaque > 100,
    `${canvasStats.w}x${canvasStats.h}, ${canvasStats.colours} colour buckets`,
  );

  // Every showcase tile must finish and differ from its neighbours.
  await page.evaluate(() => document.querySelector("#filters").scrollIntoView());
  await page.waitForFunction(
    () => document.querySelectorAll(".pass--ready").length >= 6,
    { timeout: 60000 },
  );

  const tiles = await page.$$eval(".pass", (nodes) =>
    nodes.map((c) => {
      const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
      let sum = 0;
      let n = 0;
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4 * 211) {
        sum += data[i] + data[i + 1] + data[i + 2];
        seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
        n += 1;
      }
      return { mean: sum / (n * 3), colours: seen.size };
    }),
  );
  check("six showcase tiles computed", tiles.length === 6, `${tiles.length} tiles`);
  check(
    "every showcase tile has detail",
    tiles.every((t) => t.colours > 8),
    tiles.map((t) => t.colours).join(", "),
  );
  check(
    "the six looks are actually different",
    new Set(tiles.map((t) => Math.round(t.mean))).size >= 5,
    `means ${tiles.map((t) => Math.round(t.mean)).join(", ")}`,
  );

  // No "computing" chip left behind.
  check("no tile stuck loading", (await page.$$(".computing")).length === 0);

  check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  await page.close();
}

/* ------------------------------------------------------------------ *
 * 2. Tool board is derived from the registry and every link is live.
 * ------------------------------------------------------------------ */
{
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0", timeout: 45000 });

  /*
   * The tool orbit holds fourteen, not twenty-five. The eleven it leaves out are
   * the ones the hero, the filter gallery and the text specimens already show,
   * and the test asserts both halves of that: the fourteen that are here, and the
   * absence of any tool that is not.
   */
  const tools = await page.$$eval("#tools .node a", (nodes) =>
    nodes.map((a) => a.getAttribute("href")),
  );
  check("tool orbit lists 14 tools", tools.length === 14, `${tools.length}`);
  check(
    "every tool links into the editor with a tool param",
    tools.every((href) => /^\.\/editor\.html\?tool=[a-z]+$/.test(href)),
  );

  const shownElsewhere = [
    "gradientmap",
    "halftone",
    "oilpaint",
    "glitch",
    "sketch",
    "lomo",
    "curvedtext",
    "stroketext",
    "textbehind",
    "stickers",
    "patterntext",
  ];
  const ids = tools.map((href) => href.split("tool=")[1]);
  check(
    "the orbit omits the tools shown in other sections",
    shownElsewhere.every((id) => !ids.includes(id)),
    shownElsewhere.filter((id) => ids.includes(id)).join(", "),
  );

  // Every node carries an accessible name, since an unlabelled icon is a puzzle.
  const names = await page.$$eval("#tools .node a", (nodes) =>
    nodes.map((a) => a.getAttribute("aria-label") ?? ""),
  );
  check(
    "every orbit icon has an accessible name and a key",
    names.every((n) => n.length > 8 && /Keyboard shortcut [a-z0-9]\./.test(n)),
    names.filter((n) => n.length <= 8).length + " unlabelled",
  );

  /*
   * The hover label is the tool's name and nothing else. The group and the
   * shortcut are both said elsewhere, and a three-line label over a 54px icon
   * covered the icons behind it.
   */
  const labels = await page.$$eval("#tools .node .label", (nodes) =>
    nodes.map((n) => n.textContent.trim()),
  );
  check(
    "hover label shows the tool name only",
    labels.length === 14 && labels.every((l) => l.length > 2 && l.length < 22),
    labels.filter((l) => l.length < 3 || l.length > 21).join(" | "),
  );

  /*
   * The arrangement itself: four rings, every node mirrored about the vertical
   * axis so the icons read as two flanks either side of the mark, and the
   * outermost ring reduced to the pair on the horizontal axis.
   */
  const geometry = await page.evaluate(() => {
    const stage = document.querySelector("#tools .stage").getBoundingClientRect();
    const cx = stage.left + stage.width / 2;
    const cy = stage.top + stage.height / 2;
    const nodes = [...document.querySelectorAll("#tools .node")].map((n) => {
      const b = n.getBoundingClientRect();
      const dx = b.left + b.width / 2 - cx;
      const dy = b.top + b.height / 2 - cy;
      return { angle: (Math.atan2(dy, dx) * 180) / Math.PI, radius: Math.hypot(dx, dy) };
    });

    // Bucket each node by how far out it sits, then check every ring is either
    // symmetric about the vertical axis or is the outer horizontal pair.
    const radii = [...new Set(nodes.map((n) => Math.round(n.radius)))].sort((a, b) => a - b);
    const mirrored = radii.every((r) => {
      const on = nodes.filter((n) => Math.round(n.radius) === r).map((n) => Math.round(((n.angle % 360) + 360) % 360)).sort((a, b) => a - b);
      return on.every((angle, i) => {
        const partner = (360 - angle) % 360;
        return on.includes(partner) || on.includes((360 - angle + 180) % 360) || on.length === 1;
      });
    });

    return {
      rings: radii.length,
      counts: radii.map((r) => nodes.filter((n) => Math.round(n.radius) === r).length),
      mirrored,
      radius: Math.max(...nodes.map((n) => n.radius)),
      halfStage: stage.width / 2,
    };
  });

  check("four concentric rings", geometry.rings === 4, `${geometry.rings} radii, ${geometry.counts.join("/")} each`);
  check("every ring is mirrored about the vertical axis", geometry.mirrored);
  check(
    "outermost icons sit inside the stage",
    geometry.radius < geometry.halfStage,
    `${Math.round(geometry.radius)} of ${Math.round(geometry.halfStage)}`,
  );

  // Eyebrow budget: at most one kicker on the whole page.
  check("one eyebrow on the page", (await page.$$(".kicker")).length === 1);

  // Section count vs distinct layout families, asserted structurally.
  const sections = await page.$$eval("main > section", (n) => n.length);
  check("page has the intended sections", sections === 6, `${sections} sections`);

  check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

/* ------------------------------------------------------------------ *
 * 3. Old editor deep links still land in the editor.
 * ------------------------------------------------------------------ */
{
  const { page } = await newPage();
  await page.goto(`${BASE}/index.html?tool=halftone`, { waitUntil: "networkidle0", timeout: 45000 });
  check("?tool= redirects to the editor", page.url().includes("editor.html?tool=halftone"), page.url());

  // The rail marks the active tool with `aria-selected`, which is what a
  // screen reader announces, so assert on that rather than on a class.
  const selected = await page
    .waitForSelector('[role="tab"][aria-selected="true"]', { timeout: 15000 })
    .then((el) => el.evaluate((node) => node.getAttribute("aria-controls")))
    .catch(() => null);
  check("editor mounts with a tool selected", selected === "tool-panel", String(selected));

  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0", timeout: 45000 });
  check("bare root is the landing page", !page.url().includes("editor.html"), page.url());

  await page.goto(`${BASE}/editor.html?tool=lomo`, { waitUntil: "networkidle0", timeout: 45000 });
  check("editor deep link works directly", page.url().includes("tool=lomo"));

  await page.close();
}

/* ------------------------------------------------------------------ *
 * 4. Keyboard, motion and mobile.
 * ------------------------------------------------------------------ */
{
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0", timeout: 45000 });
  await page.waitForFunction(() => document.querySelector(".effect--ready"), { timeout: 30000 });

  // The wipe must be a real control, operable by keyboard.
  const before = await page.$eval(".range", (el) => el.value);
  await page.focus(".range");
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowLeft");
  const after = await page.$eval(".range", (el) => el.value);
  check("wipe responds to arrow keys", Number(after) < Number(before), `${before} -> ${after}`);

  const valuetext = await page.$eval(".range", (el) => el.getAttribute("aria-valuetext"));
  check("wipe announces both sides", /original/i.test(valuetext) && /gradient map/i.test(valuetext), valuetext);

  // Tab order, measured on a fresh load before anything else has taken focus.
  // The skip link has to come before the nav, which is the whole point of it.
  {
    const { page: fresh } = await newPage();
    await fresh.goto(`${BASE}/index.html`, { waitUntil: "networkidle0", timeout: 45000 });
    await fresh.keyboard.press("Tab");
    const focused = await fresh.evaluate(() => document.activeElement?.className ?? "");
    check("skip link is first in tab order", focused.includes("skip-link"), focused);
    await fresh.close();
  }

  // Switching filters must actually re-run the pass.
  const labelBefore = await page.$eval(".tag--after", (el) => el.textContent.trim());
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll(".picker .chip")];
    chips.find((c) => /glitch/i.test(c.textContent))?.click();
  });
  await page.waitForFunction(() => document.querySelector(".effect--ready"), { timeout: 30000 });
  const labelAfter = await page.$eval(".tag--after", (el) => el.textContent.trim());
  check("filter chips switch the live pass", labelBefore !== labelAfter, `${labelBefore} -> ${labelAfter}`);

  check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

/* Reduced motion: nothing should stay hidden. */
{
  const { page } = await newPage();
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0", timeout: 45000 });

  const hidden = await page.$$eval("[data-reveal]", (nodes) =>
    nodes.filter((n) => Number(getComputedStyle(n).opacity) < 0.9).length,
  );
  check("reduced motion shows every revealed block", hidden === 0, `${hidden} still faded`);

  await page.close();
}

/* No JavaScript: the whole page must still be readable. */
{
  const { page } = await newPage();
  await page.setJavaScriptEnabled(false);
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0", timeout: 45000 });

  const faded = await page.$$eval("[data-reveal]", (nodes) =>
    nodes.filter((n) => Number(getComputedStyle(n).opacity) < 0.9).length,
  );
  check("no-JS: no section is left invisible", faded === 0, `${faded} faded`);

  const words = await page.$eval("h1", (el) => el.textContent.trim().split(/\s+/).length);
  check("no-JS: headline renders", words > 4, `${words} words`);

  await page.close();
}

/* Mobile: the nav collapses and nothing overflows sideways. */
{
  const { page, errors } = await newPage(390, 844);
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0", timeout: 45000 });

  check(
    "mobile: no horizontal overflow",
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await page.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`),
  );

  const toggleVisible = await page.$eval(".toggle", (el) => getComputedStyle(el).display !== "none");
  check("mobile: menu button appears", toggleVisible);

  await page.click(".toggle");
  check("mobile: menu opens", (await page.$$(".sheet a")).length >= 4);

  // Escape has to close it, or a keyboard visitor is trapped in the menu.
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 200));
  check("mobile: Escape closes the menu", (await page.$$(".sheet")).length === 0);

  // The tab still has to clear the headline once the wordmark is gone.
  const mobileTab = await page.$eval(".bar", (el) => Math.round(el.getBoundingClientRect().bottom));
  const mobileH1 = await page.$eval("h1", (el) => Math.round(el.getBoundingClientRect().top));
  check("mobile: tab clears the headline", mobileH1 > mobileTab, `${mobileH1} vs ${mobileTab}`);

  const ctaFits = await page.$eval(".actions .btn--primary", (el) => {
    // Measure the text node, not the whole button. A range over the button also
    // covers the icon, which is a separate box and would make the rect count
    // meaningless.
    const textNode = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const box = el.getBoundingClientRect();
    return {
      oneLine: range.getClientRects().length === 1,
      fits: box.width <= window.innerWidth,
      text: textNode.textContent.trim(),
    };
  });
  check(
    "mobile: CTA label does not wrap",
    ctaFits.oneLine && ctaFits.fits,
    `${ctaFits.text}, ${ctaFits.oneLine ? "one line" : "WRAPPED"}`,
  );

  check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

/* ------------------------------------------------------------------ *
 * 5. No em-dashes anywhere in the rendered text.
 * ------------------------------------------------------------------ */
{
  const { page } = await newPage();
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0", timeout: 45000 });

  const dashes = await page.evaluate(() => {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (/[\u2014\u2013]/.test(text)) found.push(text.trim().slice(0, 60));
    }
    return found;
  });
  check("no em-dashes or en-dashes in visible text", dashes.length === 0, dashes.join(" | "));

  await page.close();
}

await browser.close();

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
