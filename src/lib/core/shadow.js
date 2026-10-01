/**
 * Shadow injection: a cast shadow behind the subject.
 *
 * The subject is found by a segmentation model, which is the expensive half
 * and lives in `state/shadowinject.svelte.js`. Everything after that is
 * arithmetic, and it is all here:
 *
 *   1. `offsetMask` moves the mask by the offset. A sample that lands outside
 *      the frame is empty, never wrapped and never clamped: the part of the
 *      subject that was pushed off the edge of the picture is gone, and a
 *      clamped sample would smear it back along the border.
 *   2. `gaussianBlur` from `core/gaussian.js` softens that shape. Its taps are
 *      clamped to the border, so the tail replicates the edge sample instead
 *      of reading the opposite side of the frame.
 *   3. `compositeShadow` darkens what is left of the background.
 *
 * The composite is not a per-pixel filter: it is one multiply per channel over
 * pixels that are already resolved, so it needs no row banding and no yield.
 * The only pass that could block is the blur, and that is the shared one, which
 * hands the thread back and cancels on its own account.
 *
 * Everything here is pure arithmetic over a plain `{ width, height, data }`
 * object, which is the shape `ImageData` has. No canvas is created and no
 * `ImageData` global is touched, so the module runs in plain Node and can be
 * unit tested without a browser. Turning a result back into real pixels is the
 * caller's job.
 *
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 * @typedef {{x: number, y: number, w: number, h: number}} Bounds
 * @typedef {{isCancelled?: () => boolean}} BlurOptions
 * @typedef {object} ShadowOptions
 * @property {number} [offsetX]  pixels the shadow moves right
 * @property {number} [offsetY]  pixels the shadow moves down
 * @property {number} [blur]     softening radius in pixels
 * @property {number} [opacity]  0..100, how much of the shadow lands
 * @property {number} [depth]    0..100, how far it darkens what is behind it
 * @property {boolean} [keepInFrame]  hold the offset so the shadow stays inside
 */

import { gaussianBlur } from "./gaussian.js";

/**
 * The furthest the shadow may be moved, either way, in pixels.
 *
 * The legacy sliders ran over this range. It is enforced here as well as in the
 * panel, because an offset with no limit is a way to ask for a shape that
 * falls entirely outside the frame.
 */
export const OFFSET_LIMIT = 50;

/** Slider ranges, shared with the panel so the numbers cannot drift apart. */
export const OFFSET_RANGE = { min: -OFFSET_LIMIT, max: OFFSET_LIMIT, step: 1 };
export const BLUR_RANGE = { min: 0, max: 50, step: 1 };
export const OPACITY_RANGE = { min: 0, max: 100, step: 1 };
export const DEPTH_RANGE = { min: 0, max: 100, step: 1 };

/**
 * What a panel starts on.
 *
 * The depth is the legacy tool's hard-coded dark factor of 0.15 turned into a
 * percentage, so the default renders what the old panel rendered.
 *
 * @type {Required<ShadowOptions>}
 */
export const SHADOW_DEFAULTS = {
  offsetX: 10,
  offsetY: 10,
  blur: 15,
  opacity: 60,
  depth: 85,
  keepInFrame: false,
};

/**
 * The direction presets the panel offers.
 *
 * Each one is a unit step rather than a fixed offset, so choosing a direction
 * re-points the shadow without changing how far away it sits.
 *
 * @typedef {{value: string, label: string, dx: number, dy: number}} Direction
 * @type {Direction[]}
 */
export const DIRECTIONS = [
  { value: "left", label: "Left", dx: -1, dy: 0 },
  { value: "up", label: "Up", dx: 0, dy: -1 },
  { value: "right", label: "Right", dx: 1, dy: 0 },
  { value: "down", label: "Down", dx: 0, dy: 1 },
  { value: "none", label: "None", dx: 0, dy: 0 },
];

/**
 * Coverage at which a pixel counts as the subject, and therefore as something
 * the shadow is hidden behind.
 *
 * One, not a half: any coverage at all occludes. A fractional occlusion
 * double counts the subject's own soft edge, because the shadow sits under a
 * pixel that is already half subject, so a shadow of zero offset and zero blur
 * would darken the subject's edge and leave a halo. Treating the outermost
 * fringe as background instead costs nothing visible, since a shadow there is
 * a fraction of a step of colour.
 */
export const SUBJECT_ALPHA = 1;

/**
 * Below this share of the frame the model has not really found a subject.
 *
 * A picture of empty sky, or a frame of texture the model could not separate,
 * comes back as a mask that is zero everywhere or nearly so. Casting a shadow
 * from that would darken the whole picture, which looks like a mistake and is
 * one, so the panel says there is nothing to cast from instead.
 */
export const NO_SUBJECT_MASS = 0.005;

/** What the panel says when the mask has no subject in it. */
export const NO_SUBJECT_MESSAGE =
  "No subject was found in this picture, so there is nothing to cast a shadow from.";

/**
 * A finite number, or the fallback.
 *
 * Anything a control, a preset or a keyboard can hand over that is not a finite
 * number becomes the fallback, rather than propagating into the loop where a NaN
 * index reads `undefined` out of the buffer and lands as a zero channel.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * One integer setting, rounded and held inside `min..max`.
 *
 * Rounded rather than truncated, so an offset of 2.4 moves two pixels and not
 * one, which is what a slider at step 1 means.
 *
 * `fallback` is what an unreadable value becomes, and it is not always `min`:
 * an offset that cannot be read falls back to no offset rather than to the far
 * edge of the frame.
 *
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} [fallback]
 * @returns {number}
 */
function clampInt(value, min, max, fallback = min) {
  const n = Math.round(finite(value, fallback));
  return n < min ? min : n > max ? max : n;
}

/**
 * One offset, rounded and held inside the tool's range.
 * @param {unknown} value
 * @returns {number}
 */
export function clampOffset(value) {
  return clampInt(value, -OFFSET_LIMIT, OFFSET_LIMIT, 0);
}

/** One blur radius, rounded and held inside 0..BLUR_RANGE.max. */
export function clampBlur(value) {
  return clampInt(value, BLUR_RANGE.min, BLUR_RANGE.max);
}

/** One percentage, rounded and held inside 0..100. */
export function clampPercent(value) {
  return clampInt(value, 0, 100);
}

/**
 * The settings, resolved, clamped and defaulted.
 * @param {ShadowOptions} [options]
 * @returns {Required<ShadowOptions>}
 */
export function normalizeShadowOptions(options = {}) {
  return {
    offsetX: clampOffset(options.offsetX ?? SHADOW_DEFAULTS.offsetX),
    offsetY: clampOffset(options.offsetY ?? SHADOW_DEFAULTS.offsetY),
    blur: clampBlur(options.blur ?? SHADOW_DEFAULTS.blur),
    opacity: clampPercent(options.opacity ?? SHADOW_DEFAULTS.opacity),
    depth: clampPercent(options.depth ?? SHADOW_DEFAULTS.depth),
    keepInFrame: options.keepInFrame === undefined ? SHADOW_DEFAULTS.keepInFrame : !!options.keepInFrame,
  };
}

/**
 * How much of a pixel's own brightness a shadowed pixel keeps, 0..1.
 *
 * 0 is a black shadow and 1 is no darkening at all, so a depth of 0 makes the
 * whole tool the identity rather than a faint tint that hides its own settings.
 *
 * @param {number} depth 0..100
 * @returns {number}
 */
export function depthFactor(depth) {
  return 1 - clampPercent(depth) / 100;
}

/**
 * Whether these settings describe no change at all.
 *
 * The identity case is named rather than left to the arithmetic, because
 * "nothing changes" has to be exact and an exact answer is better made by
 * copying than by hoping a rounding comes out right:
 *
 * - no opacity, so no shadow lands,
 * - no depth, so the shadow is not darker than the background it sits on,
 * - an offset of zero and a blur of zero, so the shadow shape is the subject
 *   shape and every pixel of it is hidden behind the subject it came from.
 *
 * The last one is exact because occlusion is binary: the shadow's own alpha is
 * the mask's alpha, and wherever that is above zero the pixel is subject and
 * takes no shadow, and wherever it is zero the shadow is zero too.
 *
 * @param {ShadowOptions} [options]
 * @returns {boolean}
 */
export function isShadowIdentity(options = {}) {
  const o = normalizeShadowOptions(options);
  if (o.opacity <= 0 || o.depth <= 0) return true;
  return o.offsetX === 0 && o.offsetY === 0 && o.blur === 0;
}

/**
 * Cache key for a finished frame.
 *
 * Two settings with the same key produce the same pixels, which is all the
 * frame cache needs to know.
 *
 * @param {ShadowOptions} [options]
 * @returns {string}
 */
export function shadowKey(options = {}) {
  const o = normalizeShadowOptions(options);
  return `${o.offsetX},${o.offsetY},${o.blur},${o.opacity},${o.depth},${o.keepInFrame ? 1 : 0}`;
}

// ---------------------------------------------------------------
// Reading the mask
// ---------------------------------------------------------------

/**
 * The mask alpha at one point, or zero outside the frame.
 *
 * EDGE SAMPLING, and the opposite rule to the blur's. A sample point outside
 * the frame is empty: the subject that was moved past the edge of the picture
 * has left the picture. Clamping would replicate the border sample and paint a
 * stripe of shadow down the edge, and wrapping would bring the far side of the
 * frame in behind the subject. Both are visible, and both are wrong.
 *
 * This function is the only place a mask sample index is produced, so "no
 * sample comes from outside the buffer" is a property of the module rather
 * than a promise about its callers.
 *
 * @param {Pixels} mask
 * @param {unknown} x
 * @param {unknown} y
 * @returns {number} 0..255
 */
export function sampleMask(mask, x, y) {
  const width = Math.max(0, Math.round(finite(mask?.width, 0)));
  const height = Math.max(0, Math.round(finite(mask?.height, 0)));
  if (width === 0 || height === 0) return 0;

  // A coordinate that cannot be read is empty rather than pixel zero. Treating
  // it as the top left pixel would put shadow in a place nobody asked for, and
  // treating it as a clamp would do the same at whichever edge it landed on.
  // Only a finite number names a pixel here, because the only caller produces
  // integers from clamped settings.
  if (typeof x !== "number" || typeof y !== "number") return 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;

  const col = Math.round(x);
  const row = Math.round(y);
  if (col < 0 || col >= width || row < 0 || row >= height) return 0;

  return mask.data[(row * width + col) * 4 + 3];
}

/**
 * The subject's bounding box, in pixels, or null if the mask is empty.
 *
 * A rectangle rather than the shape itself, because the two things it is used
 * for, holding the shadow inside the frame and reporting how much of it falls
 * out, only need the extent. It is a loose bound: the corners of the box are
 * usually background.
 *
 * @param {Pixels} mask
 * @returns {Bounds | null}
 */
export function subjectBounds(mask) {
  const width = Math.max(0, Math.round(finite(mask?.width, 0)));
  const height = Math.max(0, Math.round(finite(mask?.height, 0)));
  const data = mask?.data ?? null;
  if (!data || width === 0 || height === 0) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(row + x) * 4 + 3] < SUBJECT_ALPHA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * The mean mask alpha over the frame, 0..1.
 *
 * Measured, not assumed: this is the share of the picture the subject holds,
 * with its soft edges counted at their own value.
 *
 * @param {Pixels} mask
 * @returns {number}
 */
export function subjectMass(mask) {
  const width = Math.max(0, Math.round(finite(mask?.width, 0)));
  const height = Math.max(0, Math.round(finite(mask?.height, 0)));
  const data = mask?.data ?? null;
  const count = width * height;
  if (!data || count === 0) return 0;

  let sum = 0;
  for (let p = 0; p < count; p++) sum += data[p * 4 + 3];
  return sum / (count * 255);
}

/**
 * Whether the mask holds a subject big enough to cast a shadow from.
 * @param {Pixels} mask
 * @returns {boolean}
 */
export function hasSubject(mask) {
  return subjectMass(mask) >= NO_SUBJECT_MASS;
}

// ---------------------------------------------------------------
// Keeping the shadow in the frame
// ---------------------------------------------------------------

/**
 * The largest offset that leaves the whole subject inside the frame.
 *
 * The shadow is the subject moved by the offset, so the pair that keeps every
 * pixel of it is bounded by the subject's own extent: `dx` runs from the left
 * edge of the subject to the right edge of the frame, and `dy` likewise.
 *
 * A subject that fills the frame has no such pair other than zero, which is the
 * honest answer: a full frame shadow cannot move and still fit.
 *
 * With no bounds at all the whole frame is free, which is the only reading that
 * does not invent a subject to be constrained by.
 *
 * @param {Bounds} bounds
 * @param {number} width
 * @param {number} height
 * @returns {{minX: number, maxX: number, minY: number, maxY: number}}
 */
export function offsetRoom(bounds, width, height) {
  const w = Math.max(0, Math.round(finite(width, 0)));
  const h = Math.max(0, Math.round(finite(height, 0)));
  const box = bounds ?? { x: 0, y: 0, w: 0, h: 0 };
  const bx = clampInt(box.x, 0, w);
  const by = clampInt(box.y, 0, h);
  const bw = clampInt(box.w, 0, Math.max(0, w - bx));
  const bh = clampInt(box.h, 0, Math.max(0, h - by));

  return {
    minX: -bx,
    // The subject ends on the pixel before its width, so the last offset that
    // fits is one less than the room left over.
    maxX: Math.max(-bx, w - bx - bw),
    minY: -by,
    maxY: Math.max(-by, h - by - bh),
  };
}

/**
 * The offset to draw with, after the keep-in-frame setting has had its say.
 *
 * @param {ShadowOptions} [options]
 * @param {Bounds | null} [bounds]
 * @param {number} [width]
 * @param {number} [height]
 * @returns {{x: number, y: number}}
 */
export function effectiveOffset(options = {}, bounds = null, width = 0, height = 0) {
  const o = normalizeShadowOptions(options);
  if (!o.keepInFrame || !bounds || width <= 0 || height <= 0) {
    return { x: o.offsetX, y: o.offsetY };
  }
  const room = offsetRoom(bounds, width, height);
  return {
    x: Math.max(room.minX, Math.min(room.maxX, o.offsetX)),
    y: Math.max(room.minY, Math.min(room.maxY, o.offsetY)),
  };
}

/**
 * The share of the shadowed subject that lands outside the frame, 0..1.
 *
 * Measured on the subject's bounding box, so it is a loose upper bound on what
 * is lost rather than an exact count of pixels, and it is computed from the
 * offset the operator asked for rather than the clamped one: this is the number
 * that says the clamp is doing work.
 *
 * @param {ShadowOptions} [options]
 * @param {Bounds | null} [bounds]
 * @param {number} [width]
 * @param {number} [height]
 * @returns {number}
 */
export function shadowOutsideShare(options = {}, bounds = null, width = 0, height = 0) {
  const o = normalizeShadowOptions(options);
  if (!bounds || width <= 0 || height <= 0) return 0;

  const room = offsetRoom(bounds, width, height);
  const lostX = Math.max(0, room.minX - o.offsetX) + Math.max(0, o.offsetX - room.maxX);
  const lostY = Math.max(0, room.minY - o.offsetY) + Math.max(0, o.offsetY - room.maxY);

  // How much of the shadow travels outside on each axis, as a fraction of the
  // subject's own extent. Capped at 1 because a shadow can be fully out.
  const shareX = bounds.w > 0 ? Math.min(1, lostX / bounds.w) : 0;
  const shareY = bounds.h > 0 ? Math.min(1, lostY / bounds.h) : 0;
  return Math.max(shareX, shareY);
}

/**
 * Hold an offset so the shadowed subject stays inside the frame.
 *
 * With no bounds there is nothing to fit against, so the offset stands, only
 * clamped to the tool's own range.
 *
 * @param {number} offsetX
 * @param {number} offsetY
 * @param {Bounds | null} bounds
 * @param {number} width
 * @param {number} height
 * @returns {{x: number, y: number}}
 */
export function fitOffset(offsetX, offsetY, bounds, width, height) {
  const raw = { x: clampOffset(offsetX), y: clampOffset(offsetY) };
  if (!bounds) return raw;

  const room = offsetRoom(bounds, width, height);
  return {
    x: clampInt(raw.x, room.minX, room.maxX),
    y: clampInt(raw.y, room.minY, room.maxY),
  };
}

// ---------------------------------------------------------------
// The shadow itself
// ---------------------------------------------------------------

/**
 * How many whole rows every buffer in a group can actually hold.
 *
 * A caller that hands over a buffer shorter than its own width and height gets
 * the rows that fit, rather than a pass that reads off the end of it.
 *
 * @param {Array<Pixels | null>} buffers
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function fitRows(buffers, width, height) {
  if (!(width > 0)) return 0;
  let pixels = Infinity;
  for (const buffer of buffers) {
    pixels = Math.min(pixels, buffer?.data ? Math.floor(buffer.data.length / 4) : 0);
  }
  return Math.max(0, Math.min(height, Math.floor(pixels / width)));
}

/**
 * The mask, moved by the offset.
 *
 * The colour channels are left at zero: this is a shape to be softened and
 * darkened, not a picture in its own right, so nothing in it is ever read back
 * except its alpha.
 *
 * @param {Pixels} mask
 * @param {number} offsetX
 * @param {number} offsetY
 * @returns {Pixels} always a new buffer, never the input
 */
export function offsetMask(mask, offsetX, offsetY) {
  const width = Math.max(0, Math.round(finite(mask?.width, 0)));
  const height = Math.max(0, Math.round(finite(mask?.height, 0)));
  const rows = fitRows([mask], width, height);
  const out = new Uint8ClampedArray(rows * width * 4);

  const dx = clampOffset(offsetX);
  const dy = clampOffset(offsetY);

  for (let y = 0; y < rows; y++) {
    const srcY = y - dy;
    for (let x = 0; x < width; x++) {
      // sampleMask owns the edge rule: outside the frame is empty, never a
      // clamped border sample and never the far side of the frame. The mask
      // itself is passed rather than a fresh literal, so the hot loop allocates
      // nothing but the output.
      out[(y * width + x) * 4 + 3] = sampleMask(mask, x - dx, srcY);
    }
  }

  return { width, height: rows, data: out };
}

/**
 * Darken the background, behind the subject.
 *
 * All three frames are the same size and share one coordinate system, which is
 * what lets the loop stride through them together. They are separate buffers
 * because the shadow has been moved and blurred while the other two have not.
 *
 * The subject is kept exactly as it was and the shadow is only allowed into the
 * part of the frame the subject does not cover, so a shadow that has moved
 * back under the subject is hidden by it. Alpha is carried over untouched:
 * this changes how dark a pixel is, not which pixels are there.
 *
 * The composite is one multiply per channel over pixels that are already
 * decided, so there is no neighbourhood and nothing to band.
 *
 * @param {Pixels} original
 * @param {Pixels} mask     the unshifted subject mask
 * @param {Pixels} shadow   the softened, offset mask
 * @param {ShadowOptions} [options]
 * @returns {Pixels} always a new buffer, never the input
 */
export function compositeShadow(original, mask, shadow, options = {}) {
  const o = normalizeShadowOptions(options);
  const width = Math.max(0, Math.round(finite(original?.width, 0)));
  const height = Math.max(0, Math.round(finite(original?.height, 0)));
  const rows = fitRows([original, mask, shadow], width, height);
  const out = new Uint8ClampedArray(rows * width * 4);
  const data = original?.data;
  if (!data || rows === 0) return { width, height: rows, data: out };

  const opacity = o.opacity / 100;
  // A depth of 0 gives a factor of 1, so every blend multiplies by 1 and the
  // result is the input. `buildShadow` short circuits that case before here.
  const dark = depthFactor(o.depth);
  const maskData = mask?.data ?? null;
  const shadowData = shadow?.data ?? null;

  for (let i = 0; i < rows * width * 4; i += 4) {
    const fg = maskData ? maskData[i + 3] / 255 : 0;
    // Occlusion is binary on purpose. See SUBJECT_ALPHA.
    const behind = fg >= SUBJECT_ALPHA / 255 ? 0 : 1;
    const cast_ = shadowData ? (shadowData[i + 3] / 255) * opacity : 0;
    const blend = cast_ * behind;

    if (blend <= 0) {
      out[i] = data[i];
      out[i + 1] = data[i + 1];
      out[i + 2] = data[i + 2];
      out[i + 3] = data[i + 3];
      continue;
    }

    const keep = 1 - blend * (1 - dark);
    out[i] = data[i] * keep;
    out[i + 1] = data[i + 1] * keep;
    out[i + 2] = data[i + 2] * keep;
    out[i + 3] = data[i + 3];
  }

  return { width, height: rows, data: out };
}

/**
 * The whole effect: shift, soften, darken.
 *
 * The blur is the shared separable pass from `core/gaussian.js`, which clamps
 * its taps at the border so the tail replicates the edge rather than reading
 * across the frame, and which hands the main thread back between row bands on
 * its own. Nothing here bands by row: the composite that follows is a single
 * multiply per channel.
 *
 * @param {Pixels} original
 * @param {Pixels} mask
 * @param {ShadowOptions} [options]
 * @param {BlurOptions} [blurOptions]
 * @returns {Promise<Pixels | null>} null when the blur was cancelled
 */
export async function buildShadow(original, mask, options = {}, blurOptions = {}) {
  const o = normalizeShadowOptions(options);
  const width = Math.max(0, Math.round(finite(original?.width, 0)));
  const height = Math.max(0, Math.round(finite(original?.height, 0)));

  // Exact identity: the copy is the whole answer, not a rounding of it.
  if (isShadowIdentity(o)) {
    const rows = fitRows([original], width, height);
    const out = new Uint8ClampedArray(rows * width * 4);
    if (original?.data) out.set(/** @type {Uint8ClampedArray} */ (original.data).subarray(0, out.length));
    return { width, height: rows, data: out };
  }

  const bounds = subjectBounds(mask);
  const offset = effectiveOffset(o, bounds, width, height);
  const shape = offsetMask(mask, offset.x, offset.y);

  const soft = await gaussianBlur(shape, o.blur, blurOptions);
  if (!soft) return null;

  return compositeShadow(original, mask, soft, o);
}