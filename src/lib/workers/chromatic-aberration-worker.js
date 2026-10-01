/**
 * Chromatic aberration, off the main thread.
 *
 * A thin transport shell and nothing else: the arithmetic lives in
 * `../core/aberration.js`, which is the same module the unit tests drive in
 * plain Node. What is left here is the part that only a worker can do, which is
 * receive a frame, shift its channels, and hand the frame back.
 *
 * A pass is two channel reads and a mix per pixel, so it is cheap per pixel and
 * there are a great many pixels. On a twelve megapixel image that is long enough
 * to be felt as a stall if it runs while a slider is being dragged, and dragging
 * an offset queues passes faster than a large image can answer them. That is
 * the case this worker exists for. The legacy tool only used a worker above two
 * megapixels and fell back to a main thread pass below it, which meant two code
 * paths for one result; every pass here runs here instead, so a small image and
 * a large one are shifted by the same arithmetic and the preview always shows
 * what Apply will write.
 *
 * The frame crosses as a transferred `ArrayBuffer` rather than as a copy, so a
 * multi-megapixel image is moved twice per pass instead of four times, and
 * structured cloning is not asked to walk four bytes per pixel. The reply
 * transfers as well, so the worker hands the buffer away instead of keeping a
 * copy it will never read.
 *
 * Every reply carries the id of the request that asked for it, so a pass can
 * never be read back as the answer to a different one.
 */

import { applyAberration } from "../core/aberration.js";

/**
 * The worker global, untyped.
 *
 * `postMessage` means two different things depending on where this code runs:
 * the two argument form in a worker, and a `targetOrigin` in a window. Naming
 * the worker type would drag in a second set of lib definitions that conflict
 * with the DOM ones this project already type checks against, so the global is
 * reached through `globalThis` and its shape is not asserted.
 */
const scope = /** @type {any} */ (globalThis);

/**
 * @typedef {import("../core/aberration.js").Pixels} Pixels
 * @typedef {import("../core/aberration.js").AberrationOptions} AberrationOptions
 */

/**
 * Run one pass.
 *
 * A reply is sent for a malformed message too, and as an error rather than as
 * a rejection: an exception thrown out of a message handler never reaches the
 * sender, so the caller would wait for a pass that is never coming and the
 * preview would hang until the tool was switched away.
 *
 * @param {{id: number, width: number, height: number, buffer: ArrayBuffer, options: AberrationOptions}} job
 */
function run(job) {
  try {
    const { id, width, height, buffer, options } = job;
    const pixels = { width, height, data: new Uint8ClampedArray(buffer) };
    const out = applyAberration(pixels, options);
    // The input buffer is detached by the transfer list below, so the result
    // has to be sent as a fresh one. `applyAberration` always allocates.
    scope.postMessage({ id, width: out.width, height: out.height, buffer: out.data.buffer }, [
      out.data.buffer,
    ]);
  } catch (error) {
    scope.postMessage({ id: job?.id ?? 0, error: error?.message || "The aberration pass failed." });
  }
}

scope.onmessage = (event) => {
  run(event.data);
};