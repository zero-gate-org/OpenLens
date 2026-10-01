/**
 * The landing page's live effect pipeline.
 *
 * This is the part worth reading. Nothing here draws a picture of a filter
 * working. Every frame on this page went through the same arithmetic, in the
 * same modules, in the same Web Workers, that the editor runs when you commit
 * a tool. The tiles below the fold are not screenshots and not CSS tricks: they
 * are the product, run on the page.
 *
 * Three rules kept it honest:
 *
 *   1. Only the editor's own `core/` functions and `workers/` shells are
 *      called. If a look on this page is wrong, it is wrong in the tool too,
 *      which is the only useful kind of wrong.
 *   2. The settings are the shipped settings. Where a panel offers presets,
 *      the preset is imported and passed through rather than retyped, so the
 *      page cannot drift away from the tool.
 *   3. The source frame is never mutated. Every pass allocates its own
 *      output, and the worker transport copies before it transfers, so the
 *      same decoded photograph can feed six tiles in a row.
 *
 * The expensive passes go to workers for the same reason the editor puts them
 * there: Kuwahara is O(radius^2) per pixel and there is no resolution to scale
 * it down to, because the radius is a length in pixels and a cheaper radius is
 * a different picture. Halftone stays on the main thread because it yields
 * itself between bands already.
 */

import { renderHalftone } from "../../lib/core/halftone.js";
import { LOOKS } from "../../lib/core/lomo.js";
import { GLITCH_DEFAULTS } from "../../lib/core/glitch.js";
import { OIL_PAINT_PRESETS } from "../../lib/core/kuwahara.js";

import { drawCover } from "./photos.js";

/**
 * The editor's worker shells, reached through the same `new URL(...,
 * import.meta.url)` form the tools use so Vite bundles each one as its own
 * chunk. One worker per job and `terminate` after the reply: a pool would be
 * tidier, but a landing page opens six jobs in a row and never overlaps them,
 * so a pool would be machinery with nothing to schedule.
 */
const WORKERS = {
  gradientmap: () =>
    new Worker(new URL("../../lib/workers/gradient-map-worker.js", import.meta.url), {
      type: "module",
    }),
  oilpaint: () =>
    new Worker(new URL("../../lib/workers/oil-paint-worker.js", import.meta.url), {
      type: "module",
    }),
  sketch: () =>
    new Worker(new URL("../../lib/workers/sketch-worker.js", import.meta.url), { type: "module" }),
  lomo: () =>
    new Worker(new URL("../../lib/workers/lomo-worker.js", import.meta.url), { type: "module" }),
  glitch: () =>
    new Worker(new URL("../../lib/workers/glitch-worker.js", import.meta.url), { type: "module" }),
};

/**
 * Run one pass in a worker and resolve with a fresh frame.
 *
 * The frame crosses as a transferred buffer, so the buffer is copied first:
 * transferring detaches it, and the caller's photograph is still needed by the
 * next tile.
 *
 * @param {keyof WORKERS} kind
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} pixels
 * @param {object} options passed straight through to `core/`
 * @returns {Promise<{ width: number, height: number, data: Uint8ClampedArray }>}
 */
function inWorker(kind, pixels, options) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = WORKERS[kind]();
    } catch (error) {
      reject(error instanceof Error ? error : new Error("The pass could not start."));
      return;
    }

    const finish = (settle) => (value) => {
      worker.terminate();
      settle(value);
    };

    worker.onmessage = (event) => {
      const message = event.data ?? {};
      // Oil paint reports progress. Progress is not an answer.
      if (message.progress !== undefined) return;
      if (message.error) {
        finish(reject)(new Error(message.error));
        return;
      }
      finish(resolve)({
        width: message.width,
        height: message.height,
        data: new Uint8ClampedArray(message.buffer),
      });
    };

    // An exception thrown inside a worker never surfaces as an `error` event on
    // its own, and an unanswered promise would hang the tile in its loading
    // state for the rest of the session.
    worker.onerror = (event) => {
      finish(reject)(new Error(event.message || "The pass failed."));
    };

    const frame = new Uint8ClampedArray(pixels.data);
    worker.postMessage(
      {
        id: 1,
        width: pixels.width,
        height: pixels.height,
        buffer: frame.buffer,
        options,
      },
      [frame.buffer],
    );
  });
}

/**
 * A four-stop ramp built from the accent.
 *
 * The greens are the page's own: `--accent-ink` is the ink the primary button
 * paints on, and the two middle stops are the accent darkened and lightened.
 * So the hero pass is the brand palette applied to a photograph, rather than a
 * second palette that happens to be near the first.
 */
const MINT_RAMP = [
  { pos: 0, hex: "#03110c" },
  { pos: 0.38, hex: "#0f4d38" },
  { pos: 0.72, hex: "#4ecf9a" },
  { pos: 1, hex: "#e8fff4" },
];

/**
 * The six looks on the page.
 *
 * `label` and `shortcut` are read straight out of the registry, so the caption
 * under a tile is the same string the tool's rail entry carries and the key is
 * the key that actually opens it.
 */
export const EFFECTS = {
  gradientmap: {
    label: "Gradient Map",
    tool: "gradientmap",
    shortcut: "m",
    summary: "Tone remapped onto a four-stop ramp built from the accent.",
    run: (pixels) =>
      inWorker("gradientmap", pixels, {
        blend: "replace",
        intensity: 1,
        stops: MINT_RAMP,
      }),
  },

  halftone: {
    label: "Halftone",
    tool: "halftone",
    shortcut: "0",
    summary: "Broken into a screen of dots on a turned lattice.",
    run: (pixels) =>
      renderHalftone(pixels, {
        mode: "grayscale",
        cellSize: 7,
        dotColor: "#0b0f11",
        bgColor: "#e9f1ee",
        shape: "circle",
        angle: 15,
      }),
  },

  oilpaint: {
    label: "Oil Paint",
    tool: "oilpaint",
    shortcut: "o",
    summary: "Flattened into painterly patches by the Kuwahara filter.",
    // The shipped "Watercolour" preset, imported rather than retyped. It is the
    // cheapest of the four, which matters: this is the one pass whose cost
    // scales with the square of its radius.
    run: (pixels) => inWorker("oilpaint", pixels, { ...OIL_PAINT_PRESETS[0] }),
  },

  sketch: {
    label: "Sketch",
    tool: "sketch",
    shortcut: "s",
    summary: "Edges lifted into ink on paper.",
    run: (pixels) =>
      inWorker("sketch", pixels, {
        mode: "sobel",
        blend: 30,
        ink: "#0d1417",
        paper: "#f2f7f5",
      }),
  },

  lomo: {
    label: "Lomo",
    tool: "lomo",
    shortcut: "l",
    summary: "A film curve per channel, warmed and vignetted.",
    run: (pixels) => {
      const look = LOOKS[0];
      return inWorker("lomo", pixels, {
        curves: look.curves,
        saturation: look.saturation,
        vignette: look.vignette,
        warmth: look.warmth,
        intensity: 1,
        shape: "round",
      });
    },
  },

  glitch: {
    label: "Glitch",
    tool: "glitch",
    shortcut: "x",
    summary: "Sliced sideways with the channels pulled out of register.",
    run: (pixels) =>
      inWorker("glitch", pixels, {
        ...GLITCH_DEFAULTS,
        seed: 7,
        intensity: 0.62,
        slicing: true,
        channel: true,
        scanline: true,
        datamosh: false,
        rgbSplit: true,
        sliceCount: 14,
        maxSliceOffset: 90,
      }),
  },
};

/**
 * The four the hero offers.
 *
 * A smaller set than the showcase because the hero has to answer a tap. These
 * are the four whose results are most unlike each other at a glance, so the
 * chips read as four choices rather than four shades of one.
 */
export const HERO_EFFECTS = ["gradientmap", "halftone", "oilpaint", "glitch"];

/**
 * Apply one effect to a source frame and paint the result into a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement} image the decoded photograph
 * @param {string} effect a key of `EFFECTS`
 * @param {object} [options]
 * @param {(ratio: number) => void} [options.onprogress]
 * @param {{ focusX?: number, focusY?: number }} [options.crop] `object-position` semantics, 0.5 centred
 * @returns {Promise<void>}
 */
export async function paint(canvas, image, effect, options = {}) {
  const { onprogress, crop } = options;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser would not give the page a 2D canvas.");

  // The crop happens first, at the tile's own size, so the pass never runs over
  // more pixels than the tile can show. A 900px photograph rendered into a
  // 640px tile is 40% wasted work on every one of six tiles.
  drawCover(ctx, image, canvas.width, canvas.height, crop?.focusX, crop?.focusY);

  const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
  onprogress?.(0.35);

  const pass = EFFECTS[effect];
  if (!pass) throw new Error(`Unknown effect: ${effect}`);

  const result = await pass.run(source);
  onprogress?.(0.85);

  // Halftone answers `null` when it cancels itself, which is its way of saying
  // "stopped early" rather than "no result".
  if (!result) return;

  ctx.putImageData(
    new ImageData(result.data, result.width, result.height),
    0,
    0,
  );
}
