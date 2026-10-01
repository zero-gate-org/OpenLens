/** Canvas / Blob plumbing shared by every tool. */

import { inferFormat, MIME_BY_FORMAT, outputFormatFor, renameExtension } from "./format.js";

/**
 * @typedef {object} ImageRecord
 * @property {Blob} blob
 * @property {string} url      object URL owned by this record
 * @property {string} name     filename with a matching extension
 * @property {number} width    natural width in pixels
 * @property {number} height   natural height in pixels
 * @property {string} format   the source format, e.g. "png", "jpeg", "avif"
 * @property {string} mime
 */

/**
 * Decode a Blob into an HTMLImageElement.
 * Always revokes the temporary object URL, on both paths.
 */
export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be decoded as an image."));
    };
    image.src = url;
  });
}

export function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function context2d(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: false });
  if (!ctx) throw new Error("This browser blocked a 2D canvas context.");
  return ctx;
}

export function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The browser could not encode that image."));
      },
      mime,
      quality,
    );
  });
}

/**
 * Build a renderable image record from a Blob.
 * Owns its own object URL; the caller is responsible for revoking it
 * (the editor store does that centrally).
 */
export async function imageFromBlob(blob, name) {
  const decoded = await loadImage(blob);
  const format = inferFormat(blob.type || "", name || "");
  return {
    blob,
    url: URL.createObjectURL(blob),
    name: renameExtension(name || "image", format),
    width: decoded.naturalWidth,
    height: decoded.naturalHeight,
    format,
    mime: MIME_BY_FORMAT[format] || blob.type || "image/png",
  };
}

/** Copy a record and mint a fresh object URL (used for history snapshots). */
export function snapshotOf(image) {
  if (!image) return null;
  return { ...image, url: URL.createObjectURL(image.blob) };
}

export function revokeImage(image) {
  if (image?.url) URL.revokeObjectURL(image.url);
}

/**
 * Encode a canvas using the source image's current format.
 * PNG ignores quality (it is lossless), matching browser behaviour.
 */
export function encodeLike(canvas, image, quality = 0.92) {
  // A format we cannot write (AVIF, GIF, TIFF) becomes PNG on first edit,
  // which is lossless and keeps the alpha channel intact.
  const format = outputFormatFor(image.format);
  const mime = MIME_BY_FORMAT[format];
  return canvasToBlob(canvas, mime, format === "png" ? undefined : quality);
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next frame so the download has definitely started.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
