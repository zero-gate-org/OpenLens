/**
 * Pixel-level plumbing for image effects.
 *
 * Every effect tool needs the same three moves: get the source pixels, run a
 * per-pixel transform, put the result back. These helpers are the shared
 * vocabulary for that, so a tool file is the algorithm and nothing else.
 */

import { canvasToBlob, context2d, createCanvas, loadImage } from "./image.js";
import { MIME_BY_FORMAT, outputFormatFor } from "./format.js";

/**
 * Decode a Blob and copy it onto a fresh canvas at a known size.
 * @returns {Promise<{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, image: HTMLImageElement}>}
 */
export async function sourceCanvas(blob, width, height) {
  const image = await loadImage(blob);
  const w = width || image.naturalWidth;
  const h = height || image.naturalHeight;
  const canvas = createCanvas(w, h);
  const ctx = context2d(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, w, h);
  return { canvas, ctx, image };
}

export function readPixels(ctx, width, height) {
  return ctx.getImageData(0, 0, width, height);
}

export function writePixels(ctx, imageData) {
  ctx.putImageData(imageData, 0, 0);
}

export function makePixels(ctx, width, height) {
  return ctx.createImageData(width, height);
}

/** Copy an ImageData onto a new canvas. */
export function pixelsToCanvas(imageData) {
  const canvas = createCanvas(imageData.width, imageData.height);
  context2d(canvas).putImageData(imageData, 0, 0);
  return canvas;
}

/** Encode an ImageData using the source image's format. */
export function pixelsToBlob(imageData, image, quality = 0.92) {
  const format = outputFormatFor(image.format);
  const mime = MIME_BY_FORMAT[format];
  return canvasToBlob(pixelsToCanvas(imageData), mime, format === "png" ? undefined : quality);
}

/** Encode a canvas using the source image's format. */
export function canvasToImageBlob(canvas, image, quality = 0.92) {
  const format = outputFormatFor(image.format);
  const mime = MIME_BY_FORMAT[format];
  return canvasToBlob(canvas, mime, format === "png" ? undefined : quality);
}

export function clampChannel(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** sRGB-relative luminance, 0 (black) to 1 (white). */
export function luma(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function mix(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Trailing-edge debounce for preview recomputation.
 *
 * Sliders fire continuously; recomputing a per-pixel effect on every input
 * event would peg the main thread and make the control feel broken. 90ms is
 * long enough to coalesce a drag and short enough to feel immediate.
 */
export function debounce(fn, ms = 90) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  /** Run any pending call right now, bypassing the wait. */
  wrapped.flush = (...args) => {
    if (timer) clearTimeout(timer);
    timer = null;
    fn(...args);
  };
  return wrapped;
}
