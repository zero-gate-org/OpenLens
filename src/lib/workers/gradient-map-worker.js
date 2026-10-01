/**
 * Gradient map, off the main thread.
 *
 * A thin transport shell and nothing else: the arithmetic lives in
 * `../core/ramp.js`, which is the same module the unit tests drive in plain
 * Node. What is left here is the part that only a worker can do, which is
 * receive a frame, map it onto the ramp, and hand the frame back.
 *
 * A pass is a brightness per pixel, a lookup on a 256 entry table and one of
 * four blends. That is cheap per pixel and there are a great many pixels, so
 * on a twelve megapixel image it is long enough to be felt as a stall if it
 * runs while a stop is being dragged along its ramp. Dragging a stop queues
 * passes faster than a large image can answer them, which is the case this
 * worker exists for.
 *
 * The frame crosses as a transferred `ArrayBuffer` rather than as a copy, so a
 * multi-megapixel image is moved twice per pass instead of four times, and
 * structured cloning is not asked to walk four bytes per pixel. The reply
 * transfers as well, so the worker gives the buffer away instead of keeping a
 * copy it will never read.
 *
 * Every reply carries the id of the request that asked for it, so a pass can
 * never be read back as the answer to a different one.
 */

import { applyRamp } from "../core/ramp.js";

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
 * @typedef {import("../core/ramp.js").Pixels} Pixels
 * @typedef {import("../core/ramp.js").RampOptions} RampOptions
 */

/**
 * Run one pass.
 *
 * A reply is sent for a malformed message too, and as an error rather than as
 * a rejection: an exception thrown out of a message handler never reaches the
 * sender, so the caller would wait for a pass that is never coming and the
 * preview would hang until the tool was switched away.
 *
 * @param {{id: number, width: number, height: number, buffer: ArrayBuffer, options: RampOptions}} job
 */
function run(job) {
  try {
    const { id, width, height, buffer, options } = job;
    const pixels = { width, height, data: new Uint8ClampedArray(buffer) };
    const out = applyRamp(pixels, options);
    // The input buffer is detached by the transfer list below, so the result
    // has to be sent as a fresh one. `applyRamp` always allocates.
    scope.postMessage({ id, width, height, buffer: out.data.buffer }, [out.data.buffer]);
  } catch (error) {
    scope.postMessage({ id: job?.id ?? 0, error: error?.message || "The gradient map pass failed." });
  }
}

scope.onmessage = (event) => {
  run(event.data);
};
