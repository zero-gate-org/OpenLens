/**
 * The Kuwahara filter, off the main thread.
 *
 * A thin transport shell and nothing else: the arithmetic lives in
 * `../core/kuwahara.js`, which is the same module the unit tests drive in plain
 * Node. What is left here is the part only a worker can do, which is receive a
 * frame, paint it, and hand the frame back.
 *
 * This is the most expensive pass in the app. A commit is O(radius² · sectors)
 * per pixel per pass in the generalized mode, and O(1) per pixel plus a
 * window walk in the standard one, over every pixel of a frame that can be
 * twelve megapixels. On the main thread that is the difference between a
 * control that answers and a tab that stops responding, and there is no
 * resolution to scale it down to, because the radius is a length in pixels and
 * a cheaper radius is a different picture. The legacy tool noticed the same
 * thing and gave this filter its own worker, and its own cancel button, because
 * a pass it could not interrupt was a pass the operator had to wait out.
 *
 * The frame crosses as a transferred `ArrayBuffer` rather than as a copy, so it
 * is moved twice per pass instead of four times, and structured cloning is not
 * asked to walk four bytes per pixel. The reply transfers as well, so the worker
 * hands over the only copy it made instead of keeping one it will never read.
 *
 * Every reply carries the id of the request that asked for it, progress
 * included, so a slow pass cannot answer a newer one and cannot move the
 * progress bar of a pass that is no longer the one being waited on.
 */

import { applyOilPaint } from "../core/kuwahara.js";

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
 * @typedef {import("../core/kuwahara.js").Pixels} Pixels
 * @typedef {import("../core/kuwahara.js").KuwaharaOptions} KuwaharaOptions
 */

/**
 * One pass.
 *
 * A reply is sent for a malformed message too, and as an error rather than as
 * a rejection: an exception thrown out of a message handler never reaches the
 * sender, so the caller would wait for a pass that is never coming and the
 * preview would hang until the tool was switched away.
 *
 * @param {{id: number, width: number, height: number, buffer: ArrayBuffer, options: KuwaharaOptions}} job
 */
function run(job) {
  const id = job?.id ?? 0;
  try {
    const { width, height, buffer, options } = job;
    const pixels = { width, height, data: new Uint8ClampedArray(buffer) };
    const out = applyOilPaint(pixels, {
      ...options,
      onProgress: (ratio) => scope.postMessage({ id, progress: ratio }),
    });
    // The input buffer is detached by the transfer list below, so the result has
    // to be sent as a fresh one. `applyOilPaint` always allocates.
    scope.postMessage({ id, width, height, buffer: out.data.buffer }, [out.data.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: error?.message || "The oil paint pass failed." });
  }
}

scope.onmessage = (event) => {
  run(event.data);
};
