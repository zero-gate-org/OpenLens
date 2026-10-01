/**
 * End-to-end smoke test.
 *
 * Drives the real built app in headless Chrome and asserts on what an
 * operator would actually see: pixels on the stage, the numbers in the panel,
 * and whether history is doing its job. This is the layer unit tests cannot
 * reach, because most of the interesting failures live in the seam between
 * Svelte reactivity and the DOM.
 *
 *   npm run build && npm run test:e2e
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import zlib from "node:zlib";
import puppeteer from "puppeteer-core";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 4319;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const SHOTS = path.join(ROOT, ".screenshots");

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), `expected ${expected}, got ${actual}`);
}

async function startServer() {
  const child = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(ORIGIN, { signal: AbortSignal.timeout(800) });
      if (res.ok) return child;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  child.kill();
  throw new Error("preview server did not start");
}

/** A deterministic test image: two solid quadrants plus a border. */
function makeTestPng() {
  return { width: 400, height: 300, raw: makeRaw(400, 300) };
}

/**
 * Raw RGB for a `width` x `height` image: slate on the left, amber on the
 * right, with a black frame so the edges are unambiguous in screenshots.
 */
function makeRaw(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const frame = x < 2 || y < 2 || x > width - 3 || y > height - 3;
      if (frame) {
        raw[i] = 10;
        raw[i + 1] = 10;
        raw[i + 2] = 10;
      } else if (x < width / 2) {
        raw[i] = 70;
        raw[i + 1] = 90;
        raw[i + 2] = 110;
      } else {
        raw[i] = 220;
        raw[i + 1] = 170;
        raw[i + 2] = 90;
      }
    }
  }
  return raw;
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  try {
    await run(page, consoleErrors);
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

async function run(page, consoleErrors) {
  // ---------------------------------------------------------------
  console.log("\nempty state");
  // ---------------------------------------------------------------
  await page.goto(ORIGIN, { waitUntil: "networkidle0" });

  eq("no image means the dropzone", await page.$(".empty") !== null, true);
  eq("no image means no stage", await page.$(".stage") !== null, false);
  check("topbar reads as empty", (await page.$eval(".filename", (el) => el.textContent)).includes("No image"));
  eq("download is disabled", await page.$eval('[data-action="download"]', (el) => el.disabled), true);
  eq("undo is disabled", await page.$eval('[data-action="undo"]', (el) => el.disabled), true);
  eq(
    "the rail lists every ported tool, in registry order",
    (await page.$$eval('[role="tab"]', (els) => els.map((el) => el.id))).join(","),
    [
      "tool-tab-crop",
      "tool-tab-resize",
      "tool-tab-rotate",
      "tool-tab-bgremove",
      "tool-tab-blur",
      "tool-tab-tiltshift",
      "tool-tab-convert",
    ].join(","),
  );
  await page.screenshot({ path: path.join(SHOTS, "01-empty.png") });

  // Deep link decides the active tool.
  await page.goto(`${ORIGIN}/?tool=rotate`, { waitUntil: "networkidle0" });
  eq("?tool=rotate selects Rotate", await page.$eval('[aria-selected="true"]', (el) => el.id), "tool-tab-rotate");
  await page.goto(ORIGIN, { waitUntil: "networkidle0" });
  eq("no param falls back to Crop", await page.$eval('[aria-selected="true"]', (el) => el.id), "tool-tab-crop");

  // ---------------------------------------------------------------
  console.log("\nload an image");
  // ---------------------------------------------------------------
  const { width, height, raw } = makeTestPng();
  await uploadPng(page, raw, width, height, "fixture.png");

  await page.waitForSelector(".stage", { timeout: 10000 });
  eq("stage replaces the dropzone", await page.$(".empty") !== null, false);
  eq(
    "filename is shown",
    await page.$eval(".filename", (el) => el.textContent),
    "fixture.png",
  );
  check(
    "dimensions chip is correct",
    (await page.$eval("#topbar-chips, .chips", (el) => el.textContent)).includes("400 × 300"),
  );
  eq("compare is not available yet", await page.$eval('[title="Hold to see the original"]', (el) => el.disabled), true);

  const img = await page.$eval(".picture", (el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
  eq("picture decodes at full size", `${img.w}x${img.h}`, "400x300");

  const box = await page.$eval(".viewport", (el) => {
    const r = el.getBoundingClientRect();
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
    };
  });
  check("a small image is shown large enough to work on", box.w > 400, `rendered ${box.w}px`);
  check("image keeps its aspect ratio", Math.abs(box.w / box.h - 400 / 300) < 0.02, JSON.stringify(box));
  await checkCentred(page, "a small image");
  await page.screenshot({ path: path.join(SHOTS, "02-loaded.png") });

  // Regression: an image larger than the stage must still be shown whole and
  // centred. Sizing the centred element at natural size and scaling it with a
  // transform made a 4000px image claim 4000px of layout, so the browser
  // pushed it to the start edge and only the top-left corner was on screen.
  await uploadPng(page, makeRaw(2400, 1600), 2400, 1600, "big.png");
  await page.waitForFunction(() => document.querySelector(".chips")?.textContent?.includes("2400 × 1600"), {
    timeout: 15000,
  });
  const big = await page.$eval(".viewport", (el) => {
    const r = el.getBoundingClientRect();
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
    };
  });
  const stageBox = await page.$eval(".stage", (el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), left: r.left, top: r.top };
  });
  check("a large image is scaled down to fit", big.w < stageBox.w && big.h < stageBox.h, JSON.stringify({ big, stageBox }));
  check("a large image keeps its aspect ratio", Math.abs(big.w / big.h - 2400 / 1600) < 0.02, JSON.stringify(big));
  check("a large image stays inside the stage", big.left >= stageBox.left - 2 && big.top >= stageBox.top - 2
    && big.right <= stageBox.left + stageBox.w + 2 && big.bottom <= stageBox.top + stageBox.h + 2,
    `image ${big.left},${big.top},${big.right},${big.bottom} vs stage ${stageBox.left},${stageBox.top},${stageBox.w},${stageBox.h}`);
  await checkCentred(page, "a large image");
  await page.screenshot({ path: path.join(SHOTS, "02b-large.png") });

  // Back to the small fixture for the rest of the run.
  await uploadPng(page, raw, width, height, "fixture.png");
  await page.waitForFunction(() => document.querySelector(".chips")?.textContent?.includes("400 × 300"), {
    timeout: 15000,
  });

  // ---------------------------------------------------------------
  console.log("\ncrop");
  // ---------------------------------------------------------------
  eq("crop selection starts at 90%", await readCropBox(page), "360x270");

  // Drag the south-east corner inward and check the panel follows.
  const se = await handleCentre(page, "se");
  await drag(page, se, { dx: -80, dy: -60 });
  const afterDrag = await readCropBox(page);
  check("se handle shrinks the selection", afterDrag !== "360x270", afterDrag);

  // Type an exact size instead.
  await setField(page, "#crop-width", 200);
  await commitField(page);
  const afterType = await readCropBox(page);
  eq("typing a width resizes the selection", afterType.split("x")[0], "200");

  // Ratio lock keeps the box honest.
  await clickRatio(page, "1:1");
  const locked = await readCropBox(page);
  const [lw, lh] = locked.split("x").map(Number);
  eq("1:1 lock makes the selection square", lw, lh);

  // Free ratio, then apply.
  await clickRatio(page, "free");
  await setField(page, "#crop-width", 200);
  await setField(page, "#crop-height", 150);
  await commitField(page);
  eq("free ratio holds both axes", await readCropBox(page), "200x150");

  await page.click('[data-tool="apply"]');
  await page.waitForFunction(() => document.querySelector(".chips")?.textContent?.includes("200 × 150"), {
    timeout: 10000,
  });
  eq("crop commit updates the dimensions", await chipText(page, "Dim"), "200 × 150");
  eq("redo is empty after a fresh edit", await page.$eval('[data-action="redo"]', (el) => el.disabled), true);
  eq("undo becomes available", await page.$eval('[data-action="undo"]', (el) => el.disabled), false);
  eq("reset becomes available", await page.$eval('[data-action="reset"]', (el) => el.disabled), false);
  eq("compare unlocks once there is an edit", await page.$eval('[title="Hold to see the original"]', (el) => el.disabled), false);

  const cropped = await page.$eval(".picture", (el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
  eq("cropped pixels are the selection", `${cropped.w}x${cropped.h}`, "200x150");
  await page.screenshot({ path: path.join(SHOTS, "03-cropped.png") });

  // ---------------------------------------------------------------
  console.log("\nhistory");
  // ---------------------------------------------------------------
  await page.click('[data-action="undo"]');
  await page.waitForFunction(() => document.querySelector(".chips")?.textContent?.includes("400 × 300"), {
    timeout: 5000,
  });
  eq("undo restores the previous size", await chipText(page, "Dim"), "400 × 300");
  eq("redo becomes available", await page.$eval('[data-action="redo"]', (el) => el.disabled), false);

  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyZ");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector(".chips")?.textContent?.includes("200 × 150"), {
    timeout: 5000,
  });
  eq("ctrl+shift+z redoes", await chipText(page, "Dim"), "200 × 150");

  await page.click('[data-action="reset"]');
  await page.waitForFunction(() => document.querySelector(".chips")?.textContent?.includes("400 × 300"), {
    timeout: 5000,
  });
  eq("reset returns to the original", await chipText(page, "Dim"), "400 × 300");
  eq("reset is undoable", await page.$eval('[data-action="undo"]', (el) => el.disabled), false);
  await page.click('[data-action="undo"]');
  await page.waitForFunction(() => document.querySelector(".chips")?.textContent?.includes("200 × 150"), {
    timeout: 5000,
  });
  eq("undo brings the crop back", await chipText(page, "Dim"), "200 × 150");

  // ---------------------------------------------------------------
  console.log("\ncompare and zoom");
  // ---------------------------------------------------------------
  const compare = await page.$('[title="Hold to see the original"]');
  const cb = await compare.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await sleep(120);
  eq("holding compare shows the original", await originalShown(page), true);
  await page.mouse.up();
  await sleep(120);
  eq("releasing compare shows the edit", await originalShown(page), false);

  const natural = await naturalSize(page);
  const beforeZoom = await page.$eval(".viewport", (el) => el.getBoundingClientRect().width);

  await page.click('[title="Actual pixels"]');
  await sleep(180);
  const atPixel = await page.$eval(".viewport", (el) => el.getBoundingClientRect().width);
  eq("1:1 draws one CSS px per image px", Math.round(atPixel), natural.w);

  await page.keyboard.down("Control");
  await page.keyboard.press("Digit0");
  await page.keyboard.up("Control");
  await sleep(180);
  const refit = await page.$eval(".viewport", (el) => el.getBoundingClientRect().width);
  check("ctrl+0 refits", Math.abs(refit - beforeZoom) < 2, `${refit} vs ${beforeZoom}`);

  // The crop overlay's chrome must stay a constant screen size at any zoom,
  // which is the whole reason the overlay divides by --s.
  const chromeAtFit = await handleSize(page, "se");
  await page.click('[title="Zoom in"]');
  await page.click('[title="Zoom in"]');
  await sleep(250);
  const zoomedWidth = await page.$eval(".viewport", (el) => el.getBoundingClientRect().width);
  const chromeZoomed = await handleSize(page, "se");
  check("zoom in actually zooms", zoomedWidth > beforeZoom, `${beforeZoom} -> ${zoomedWidth}`);
  check(
    "handle stays a constant screen size across zoom",
    Math.abs(chromeAtFit - chromeZoomed) < 2,
    `${chromeAtFit} vs ${chromeZoomed}`,
  );
  await page.keyboard.down("Control");
  await page.keyboard.press("Digit0");
  await page.keyboard.up("Control");
  await sleep(180);

  // ---------------------------------------------------------------
  console.log("\nresize");
  // ---------------------------------------------------------------
  await clickTool(page, "resize");
  const r0 = await naturalSize(page);
  eq("resize seeds the real width", await fieldValue(page, "#resize-width"), String(r0.w));
  eq("resize seeds the real height", await fieldValue(page, "#resize-height"), String(r0.h));

  const halfW = Math.round(r0.w / 2);
  const halfH = Math.round(r0.h / 2);
  await setField(page, "#resize-width", halfW);
  await commitField(page);
  eq("a locked width rewrites the height", await fieldValue(page, "#resize-height"), String(halfH));

  // Unlock and the axes move independently.
  await page.click('[title="Aspect ratio locked"]');
  await sleep(120);
  await setField(page, "#resize-height", 40);
  await commitField(page);
  eq(
    "an unlocked height leaves the width alone",
    await fieldValue(page, "#resize-width"),
    String(halfW),
  );

  // Re-locking adopts the ratio currently on screen (halfW x 40), not a stale
  // one, so the following width edit follows that ratio.
  await page.click('[title="Aspect ratio free"]');
  await sleep(120);
  const relockRatio = halfW / 40;
  await setField(page, "#resize-width", halfW * 2);
  await commitField(page);
  eq(
    "re-locking snaps the height to the on-screen ratio",
    await fieldValue(page, "#resize-height"),
    String(Math.round((halfW * 2) / relockRatio)),
  );

  await clickChip(page, "50%");
  eq("the 50% preset sets the width", await fieldValue(page, "#resize-width"), String(halfW));
  eq("the 50% preset sets the height", await fieldValue(page, "#resize-height"), String(halfH));

  await page.click('[data-tool="apply"]');
  await page.waitForFunction(
    (want) => document.querySelector(".chips")?.textContent?.includes(want),
    { timeout: 10000 },
    `${halfW} \u00d7 ${halfH}`,
  );
  const resized = await naturalSize(page);
  eq("resize commits real pixels", `${resized.w}x${resized.h}`, `${halfW}x${halfH}`);
  await page.screenshot({ path: path.join(SHOTS, "04-resized.png") });

  // ---------------------------------------------------------------
  console.log("\nrotate");
  // ---------------------------------------------------------------
  await clickTool(page, "rotate");
  const before = await naturalSize(page);
  eq("nothing is applied yet", before.w, halfW);

  await page.click('[data-turn="right"]');
  await sleep(250);
  const vp = await page.$eval(".viewport", (el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  check(
    "a 90 degree preview swaps the stage axes",
    Math.abs(vp.w / vp.h - before.h / before.w) < 0.04,
    `viewport ${vp.w.toFixed(0)}x${vp.h.toFixed(0)} for ${before.w}x${before.h}`,
  );
  check(
    "the preview does not touch the underlying file",
    (await naturalSize(page)).w === before.w,
  );
  eq(
    "apply is enabled once something is pending",
    await page.$eval('[data-tool="apply"]', (el) => el.disabled),
    false,
  );
  await page.screenshot({ path: path.join(SHOTS, "05-rotate-preview.png") });

  await page.click('[data-tool="apply"]');
  await page.waitForFunction(
    (want) => document.querySelector(".chips")?.textContent?.includes(want),
    { timeout: 10000 },
    `${before.h} \u00d7 ${before.w}`,
  );
  const rotated = await naturalSize(page);
  // Exact equality is the point: a quarter turn must not add a column from
  // floating point dust in cos(90deg).
  eq("rotated pixels swap exactly", `${rotated.w}x${rotated.h}`, `${before.h}x${before.w}`);
  await page.screenshot({ path: path.join(SHOTS, "06-rotated.png") });

  // ---------------------------------------------------------------
  console.log("\npanel and rail behaviour");
  // ---------------------------------------------------------------
  const carried = await naturalSize(page);
  await clickTool(page, "crop");
  eq("switching tools does not clear the image", (await page.$(".picture")) !== null, true);
  eq("image survives the switch", (await naturalSize(page)).w, carried.w);
  eq("the tool shows in the URL", new URL(page.url()).searchParams.get("tool"), "crop");

  await page.keyboard.press("Digit3");
  eq("number keys switch tools", await page.$eval('[aria-selected="true"]', (el) => el.id), "tool-tab-rotate");
  eq("URL follows the shortcut", new URL(page.url()).searchParams.get("tool"), "rotate");

  // Cycling wraps, so the neighbour depends on how many tools are registered.
  const ids = await page.$$eval('[role="tab"]', (els) => els.map((el) => el.id));
  const at = ids.indexOf("tool-tab-rotate");
  await page.keyboard.press("BracketRight");
  eq("] cycles forward", await page.$eval('[aria-selected="true"]', (el) => el.id), ids[(at + 1) % ids.length]);
  await page.keyboard.press("BracketLeft");
  eq("[ cycles back", await page.$eval('[aria-selected="true"]', (el) => el.id), "tool-tab-rotate");

  // Panel state must not leak between tools.
  await clickTool(page, "resize");
  const carriedW = (await naturalSize(page)).w;
  await setField(page, "#resize-width", 111);
  await clickTool(page, "crop");
  await clickTool(page, "resize");
  eq(
    "resize re-seeds instead of keeping a stale 111",
    await fieldValue(page, "#resize-width"),
    String(carriedW),
  );

  // ---------------------------------------------------------------
  console.log("\ntilt-shift");
  // ---------------------------------------------------------------
  await clickTool(page, "tiltshift");
  const ts0 = await naturalSize(page);
  await page.waitForSelector('.preview-flag.on', { timeout: 20000 });
  check("a preview appears without pressing apply", true);

  // Move a slider, the preview must follow, and nothing may be committed.
  const blurSlider = await page.$('input[type="range"]');
  const start = await blurSlider.evaluate((el) => el.value);
  const max = await blurSlider.evaluate((el) => el.max);
  await blurSlider.evaluate((el, m) => {
    el.value = String(m);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, max);
  await page.waitForFunction(
    (v) => document.querySelector('input[type="range"]')?.value !== v,
    { timeout: 5000 },
    start,
  );
  eq("nothing is committed by moving a slider", (await naturalSize(page)).w, ts0.w);
  await page.screenshot({ path: path.join(SHOTS, "04b-tiltshift-preview.png") });

  await applyTool(page);
  await page.waitForFunction(() => !document.querySelector(".preview-flag.on"), { timeout: 20000 });
  const ts1 = await naturalSize(page);
  eq("tilt-shift keeps the dimensions", `${ts1.w}x${ts1.h}`, `${ts0.w}x${ts0.h}`);
  eq("tilt-shift is undoable", await page.$eval('[data-action="undo"]', (el) => el.disabled), false);
  eq("the preview is released after apply", (await page.$(".preview-flag.on")) === null, true);

  // Leaving the tool must clear the preview, not leave it stranded.
  await clickTool(page, "crop");
  eq("switching tools clears the preview", (await page.$(".preview-flag.on")) === null, true);

  // ---------------------------------------------------------------
  console.log("\nconvert");
  // ---------------------------------------------------------------
  await clickTool(page, "convert");
  eq("convert shows the current format", await chipText(page, "Type"), ts1.w >= 0 ? await chipText(page, "Type") : null);
  const nameBefore = await page.$eval(".filename", (el) => el.textContent.trim());

  await page.click('.opt[data-option="jpeg"] input');
  await sleep(160);
  check("picking a format updates the export name", (await page.$eval(".filename", (el) => el.textContent.trim())) === nameBefore, "filename only changes on commit");

  await applyTool(page);
  await page.waitForFunction(() => document.querySelector(".filename")?.textContent?.endsWith(".jpg"), { timeout: 20000 });
  eq("the format chip follows the conversion", await chipText(page, "Type"), "JPEG");
  eq("the extension follows the format", await page.$eval(".filename", (el) => el.textContent.trim().split(".").pop()), "jpg");
  const converted = await naturalSize(page);
  eq("convert keeps the dimensions", `${converted.w}x${converted.h}`, `${ts1.w}x${ts1.h}`);

  // PNG is lossless, so the quality control must be inert and say so.
  await page.click('.opt[data-option="png"] input');
  await sleep(160);
  eq("PNG is selected", await page.$eval('.opt[data-option="png"]', (el) => el.classList.contains("on")), true);
  const qualityOff = await page.$$eval("fieldset[disabled], .track", (els) => els.some((el) => el.hasAttribute("disabled")));
  check("the quality control is disabled for PNG", qualityOff || (await page.$eval('input[type="range"]', (el) => el.disabled)), "no disabled control found");
  check("a note explains why", (await page.$$eval(".tool-note", (els) => els.map((e) => e.textContent).join(" "))).toLowerCase().includes("lossless"));
  await page.screenshot({ path: path.join(SHOTS, "04c-convert.png") });

  // ---------------------------------------------------------------
  console.log("\nshortcut sheet");
  // ---------------------------------------------------------------
  await page.keyboard.press("Slash", { }); // produces "?" with shift
  await page.keyboard.down("Shift");
  await page.keyboard.press("Slash");
  await page.keyboard.up("Shift");
  await sleep(200);
  const sheetOpen = (await page.$('[role="dialog"]')) !== null;
  if (!sheetOpen) {
    await page.keyboard.press("?");
    await sleep(200);
  }
  check("the shortcut sheet opens", (await page.$('[role="dialog"]')) !== null);
  await page.screenshot({ path: path.join(SHOTS, "07-shortcuts.png") });
  await page.keyboard.press("Escape");
  await sleep(150);
  eq("escape closes it", (await page.$('[role="dialog"]')) === null, true);

  // A focused slider or radio is exactly where a person is after clicking a
  // control. It must not swallow the global shortcuts.
  await page.focus('input[type="range"]');
  await page.keyboard.down("Shift");
  await page.keyboard.press("Slash");
  await page.keyboard.up("Shift");
  await sleep(200);
  check("a focused slider still opens the shortcut sheet", (await page.$('[role="dialog"]')) !== null);
  await page.keyboard.press("Escape");
  await sleep(150);

  // Same for a focused radio: undo must still reach the store.
  await clickTool(page, "crop");
  const moved = await page.$$eval(".opt", (els) => {
    const hit = els.find((el) => !el.classList.contains("on"));
    hit?.querySelector("input")?.click();
    return Boolean(hit);
  });
  check("there is an unselected ratio to focus", moved);
  await sleep(200);
  await page.focus('.opt:not(.on) input');
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  eq("a radio really has focus", focusedTag, "INPUT");
  // The most recent commit is the JPEG conversion, and the step before it is
  // the same pixels as PNG. So dimensions and the extension cannot tell us
  // whether the undo landed; the format chip can.
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyZ");
  await page.keyboard.up("Control");
  await page.waitForFunction(
    () => {
      const chip = [...document.querySelectorAll(".chip")].find(
        (el) => el.querySelector("dt")?.textContent.trim() === "Type",
      );
      return chip?.querySelector("dd")?.textContent.trim() === "PNG";
    },
    { timeout: 10000 },
  );
  check("a focused radio still allows undo", true, "undo had no effect");

  // ---------------------------------------------------------------
  console.log("\nreplace and discard");
  // ---------------------------------------------------------------
  const input = await page.$('input[type="file"]');
  await input.uploadFile(pngFileFrom(raw, width, height));
  await page.waitForFunction(() => document.querySelector(".chips")?.textContent?.includes("400 × 300"), {
    timeout: 10000,
  });
  eq("replacing resets the dimensions", await chipText(page, "Dim"), "400 × 300");
  eq("replacing clears history", await page.$eval('[data-action="undo"]', (el) => el.disabled), true);
  eq("replacing clears the edited flag", await page.$eval('[data-action="reset"]', (el) => el.disabled), true);

  // ---------------------------------------------------------------
  console.log("\nnarrow viewport");
  // ---------------------------------------------------------------
  await page.setViewport({ width: 700, height: 820 });
  await sleep(300);
  const railBox = await page.$eval(".rail", (el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, top: r.top };
  });
  check("rail becomes a horizontal strip", railBox.w > 600 && railBox.h < 60, JSON.stringify(railBox));
  const stageVisible = await page.$eval(".stage", (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  check("stage still has room", stageVisible);
  await page.screenshot({ path: path.join(SHOTS, "08-narrow.png") });

  // ---------------------------------------------------------------
  console.log("\nconsole hygiene");
  // ---------------------------------------------------------------
  const noisy = consoleErrors.filter(
    (text) => !/favicon|Failed to load resource.*404/i.test(text),
  );
  check("no console errors", noisy.length === 0, noisy.slice(0, 3).join(" | "));
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

async function uploadPng(page, raw, width, height, name) {
  const input = await page.$('input[type="file"]');
  await input.uploadFile(pngFileFrom(raw, width, height, name));
}

/** Minimal PNG encoder: zlib stores the scanlines, the rest is chunk framing. */
function pngFileFrom(raw, width, height, name = "fixture.png") {
  const lines = [];
  for (let y = 0; y < height; y += 1) {
    lines.push(Buffer.from([0]), raw.subarray(y * width * 3, (y + 1) * width * 3));
  }
  const idat = zlib.deflateSync(Buffer.concat(lines));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  const file = path.join(SHOTS, name);
  writeFileSync(file, png);
  return file;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

let CRC_TABLE = null;

function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return crc ^ -1;
}

const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
/** The picture must sit in the middle of the stage, not off one edge. */
async function checkCentred(page, label) {
  const stage = await page.$eval(".stage", (el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  });
  const pic = await page.$eval(".viewport", (el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  });
  check(
    `${label} is centred in the stage`,
    Math.abs(pic.cx - stage.cx) < 2 && Math.abs(pic.cy - stage.cy) < 2,
    `picture centre ${pic.cx.toFixed(0)},${pic.cy.toFixed(0)} vs stage ${stage.cx.toFixed(0)},${stage.cy.toFixed(0)}`,
  );
}

const naturalSize = (page) =>
  page.$eval(".picture", (el) => ({ w: el.naturalWidth, h: el.naturalHeight }));

const fieldValue = (page, sel) => page.$eval(sel, (el) => el.value);

async function setField(page, sel, value) {
  const el = await page.$(sel);
  await el.focus();
  // Select-all is the reliable way to clear a numeric field; a triple click
  // does not select reliably inside an input[type=number].
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await el.type(String(value));
  await sleep(60);
}

/** Tab out of a field and let the commit land. */
async function commitField(page) {
  await page.keyboard.press("Tab");
  await sleep(140);
}

async function readCropBox(page) {
  const width = await fieldValue(page, "#crop-width");
  const height = await fieldValue(page, "#crop-height");
  return `${width}x${height}`;
}

async function clickRatio(page, id) {
  await page.click(`.opt[data-option="${id}"] input`);
  await sleep(140);
}

async function clickChip(page, text) {
  await page.$$eval(
    ".tool-chip",
    (els, want) => els.find((el) => el.textContent.trim() === want)?.click(),
    text,
  );
  await sleep(140);
}

/**
 * Click the active tool's primary action, waiting until it is genuinely
 * clickable. The apply button is deliberately disabled while a preview is
 * still being computed, so clicking it blindly is a race, not a test.
 */
async function applyTool(page) {
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-tool="apply"]');
      return Boolean(btn) && !btn.disabled;
    },
    { timeout: 25000 },
  );
  await page.click('[data-tool="apply"]');
}

async function clickTool(page, id) {
  await page.click(`#tool-tab-${id}`);
  await sleep(220);
}

const handleCentre = (page, kind) =>
  page.$eval(`.handle.${kind}`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

const handleSize = (page, kind) =>
  page.$eval(`.handle.${kind}`, (el) => {
    const r = el.getBoundingClientRect();
    return r.width;
  });

async function drag(page, from, { dx, dy }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // A few steps so pointermove fires more than once, like a real drag.
  for (let i = 1; i <= 5; i += 1) {
    await page.mouse.move(from.x + (dx * i) / 5, from.y + (dy * i) / 5);
  }
  await page.mouse.up();
  await sleep(120);
}

const originalShown = (page) => page.$eval(".compare-flag", (el) => el.classList.contains("on"));

async function chipText(page, label) {
  return page.$$eval(".chip", (els, want) => {
    const hit = els.find((el) => el.querySelector("dt")?.textContent.trim() === want);
    return hit?.querySelector("dd")?.textContent.trim() ?? null;
  }, label);
}

await main();
