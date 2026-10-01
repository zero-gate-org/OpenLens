/**
 * Chromatic aberration: every colour channel sampled at a slightly different
 * place, which is what a cheap lens does to a picture.
 *
 * There are two separable pieces and they are separated here on purpose.
 *
 * 1. The settings. Two modes, four channel offsets and one radial strength,
 *    all cleaned and clamped before anything reads them, so a stale control or
 *    a preset can never hand the loop a NaN index.
 * 2. The sample. One function decides where a channel comes from, and it is
 *    the whole correctness story of this effect: see `samplePixel`.
 *
 * Everything here is pure arithmetic over a plain `{ width, height, data }`
 * object, which is the shape `ImageData` has. No canvas is created, no
 * `ImageData` is constructed and no `ImageData` global is touched, so the
 * whole module runs in plain Node and can be unit tested without a browser,
 * and the same code runs unchanged inside a Web Worker. Turning a result back
 * into real pixels is the caller's job.
 *
 * @typedef {"axial" | "radial"} AberrationMode
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 *
 * @typedef {object} AberrationOptions
 * @property {AberrationMode} [mode]  "axial" shifts channels sideways, "radial" scales them about the centre
 * @property {number} [strength]      0..100, radial only
 * @property {number} [offsetRX]      pixels, axial only
 * @property {number} [offsetRY]
 * @property {number} [offsetBX]
 * @property {number} [offsetBY]
 * @property {number} [intensity]     0..1, how much of the shift reaches the pixel
 */

/** The two ways the channels can be pulled apart. */
export const ABERRATION_MODES = [
  { value: "axial", label: "Axial" },
  { value: "radial", label: "Radial" },
];

/**
 * The furthest a channel may be moved, in either direction, in pixels.
 *
 * This is the range the legacy sliders ran over, and it is enforced here rather
 * than only in the panel, because an offset with no limit is a way to ask for a
 * sample thousands of pixels away from the picture.
 */
export const OFFSET_LIMIT = 20;

/** Slider ranges, shared by the panel so the numbers cannot drift apart. */
export const OFFSET_RANGE = { min: -OFFSET_LIMIT, max: OFFSET_LIMIT, step: 1 };
export const STRENGTH_RANGE = { min: 0, max: 100, step: 1 };

/**
 * How much of the strength each channel is scaled by, about the centre.
 *
 * Red is never scaled in a radial pass, so blue is pulled twice as far out as
 * green and the pair of them describe a lens that disperses further the
 * further a channel is from green.
 */
const RADIAL_SCALE = [0, 0.003, 0.006];

/**
 * What a panel starts on.
 *
 * Typed rather than inferred, so `ABERRATION_DEFAULTS.mode` is the two-value
 * union rather than a plain string and the option types below line up with it.
 *
 * @type {Required<AberrationOptions>}
 */
export const ABERRATION_DEFAULTS = {
  mode: "axial",
  strength: 30,
  offsetRX: -4,
  offsetRY: 0,
  offsetBX: 4,
  offsetBY: 0,
  intensity: 1,
};

/**
 * A finite number, or the fallback.
 *
 * Anything a control, a preset or a keyboard can hand over that is not a
 * finite number becomes the fallback instead of propagating into the loop,
 * where a NaN index reads `undefined` out of the buffer and lands as a zero
 * channel.
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
 * One offset, rounded and held inside the tool's range.
 *
 * Rounded rather than truncated, so an offset of 2.4 moves two pixels and not
 * one, which is what a slider at step 1 means.
 *
 * @param {unknown} value
 * @returns {number} -OFFSET_LIMIT .. OFFSET_LIMIT
 */
export function clampOffset(value) {
  const n = Math.round(finite(value, 0));
  return Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, n));
}

/**
 * One strength, rounded and held inside the slider's range.
 *
 * @param {unknown} value
 * @returns {number} 0 .. 100
 */
export function clampStrength(value) {
  const n = Math.round(finite(value, 0));
  return Math.max(STRENGTH_RANGE.min, Math.min(STRENGTH_RANGE.max, n));
}

/**
 * One intensity, held inside 0..1.
 *
 * Unlike the other two this is not rounded: it is a mix factor, not a distance
 * in pixels, so a fraction of it is a real setting rather than a lost one.
 *
 * @param {unknown} value
 * @returns {number} 0..1
 */
export function clampIntensity(value) {
  const n = finite(value, 1);
  return Math.max(0, Math.min(1, n));
}

/**
 * The settings, resolved, clamped and defaulted.
 *
 * An unreadable mode falls back to the default rather than throwing, so a
 * bookmarked control or a stale preset cannot take the tool down.
 *
 * @param {AberrationOptions} [options]
 * @returns {Required<AberrationOptions>}
 */
export function normalizeOptions(options = {}) {
  /** @type {AberrationMode} */
  const mode = options.mode === "radial" ? "radial" : ABERRATION_DEFAULTS.mode;

  return {
    mode,
    strength: clampStrength(options.strength ?? ABERRATION_DEFAULTS.strength),
    offsetRX: clampOffset(options.offsetRX ?? ABERRATION_DEFAULTS.offsetRX),
    offsetRY: clampOffset(options.offsetRY ?? ABERRATION_DEFAULTS.offsetRY),
    offsetBX: clampOffset(options.offsetBX ?? ABERRATION_DEFAULTS.offsetBX),
    offsetBY: clampOffset(options.offsetBY ?? ABERRATION_DEFAULTS.offsetBY),
    intensity: clampIntensity(options.intensity ?? ABERRATION_DEFAULTS.intensity),
  };
}

/**
 * Whether these settings describe no change at all.
 *
 * The identity case is named rather than left to the arithmetic, because
 * "nothing moves" has to be exact and an exact answer is better made by
 * copying than by hoping a rounding comes out right:
 *
 * - an axial pass with all four offsets at zero,
 * - a radial pass with no strength,
 * - any pass at zero intensity.
 *
 * `applyAberration` short circuits on this, so the identity holds by
 * construction. The arithmetic below is still exact at the same settings: a
 * zero offset samples the pixel being written, and a mix factor of 1 or 0
 * returns one of its two inputs untouched.
 *
 * @param {AberrationOptions} [options]
 * @returns {boolean}
 */
export function isIdentity(options = {}) {
  const o = normalizeOptions(options);
  if (o.intensity <= 0) return true;
  if (o.mode === "radial") return o.strength <= 0;
  return o.offsetRX === 0 && o.offsetRY === 0 && o.offsetBX === 0 && o.offsetBY === 0;
}

/**
 * One coordinate, rounded and clamped into 0..limit.
 *
 * Rounded first, so a half pixel offset lands on a whole pixel rather than
 * being truncated towards zero and biasing every negative shift by one.
 *
 * @param {unknown} value
 * @param {number} limit
 * @returns {number}
 */
function clampCoord(value, limit) {
  const n = Math.round(finite(value, 0));
  if (n < 0) return 0;
  return n > limit ? limit : n;
}

/**
 * The pixel index a sample point lands on.
 *
 * EDGE SAMPLING. A sample point outside the frame is clamped to the nearest
 * edge pixel. The frame is not padded and the sample is not dropped and not
 * replaced by the pixel being written.
 *
 * Clamping is the choice because this effect samples each channel at a
 * slightly different radius, so along whichever edge a channel is displaced
 * away from, and at the corners of any edge, the sample point is outside the
 * frame by construction. Border replication is what a lens boundary does: the
 * fringing runs to the last pixel of the frame rather than fading out, the
 * output keeps the size and the shape of the input, and no colour appears that
 * was not already in the picture. Holding the original pixel instead would
 * leave a band of unchanged pixels along the edge whose width depends on which
 * way the offset points, which reads as a fault rather than as an edge
 * treatment, and the band would not even be the same width on opposite edges.
 *
 * The clamp runs on every sample, including the ones already inside the frame,
 * so there is a single rule for every read and no path can skip it. This
 * function is the only place a sample index is produced, which is what makes
 * "no output pixel comes from outside the buffer" a property of the module
 * rather than a promise about its callers.
 *
 * @param {unknown} x  any number at all, inside or outside the frame
 * @param {unknown} y
 * @param {number} width
 * @param {number} height
 * @returns {number} 0 .. width * height - 1, or 0 for an empty frame
 */
export function samplePixel(x, y, width, height) {
  const w = Math.max(0, Math.round(finite(width, 0)));
  const h = Math.max(0, Math.round(finite(height, 0)));
  if (w === 0 || h === 0) return 0;
  return clampCoord(y, h - 1) * w + clampCoord(x, w - 1);
}

/**
 * The factor a channel is scaled by about the centre of the frame.
 *
 * A scale rather than a constant offset, because a radial aberration belongs to
 * the lens: the fringing has to grow with the distance from the middle, and a
 * constant would fringe the middle of the picture as hard as its corners.
 * Scaling about the centre also means there is no radius to normalise by, so a
 * frame one pixel wide or one pixel tall is the same arithmetic as any other
 * and cannot divide by zero.
 *
 * @param {number} strength 0..100
 * @param {0 | 1 | 2} channel
 * @returns {number} at least 1
 */
export function radialScale(strength, channel) {
  return 1 + clampStrength(strength) * (RADIAL_SCALE[channel] ?? 0);
}

/**
 * How much of a sampled channel reaches the pixel.
 *
 * `k` is 0..1. At 0 the pixel keeps its own channel and at 1 the sample lands
 * unchanged, so both ends of the intensity slider are exact rather than
 * approximated. The two inputs are always bytes, so the mix of them is a byte
 * too and needs no clamp.
 *
 * @param {number} original 0..255
 * @param {number} sampled  0..255
 * @param {number} k        0..1
 * @returns {number} 0..255
 */
function mixChannel(original, sampled, k) {
  if (k >= 1) return sampled;
  if (k <= 0) return original;
  return Math.round(original + k * (sampled - original));
}

/**
 * Shift a whole frame.
 *
 * Always returns a new buffer, never the one it was handed, so a cached frame
 * survives a pass and the result can be transferred rather than copied again.
 *
 * Two modes, and each one leaves a different channel in place:
 *
 * - Axial moves red and blue by their own offsets and leaves green where it
 *   is, so the picture keeps its structure and only the colour fringing shows.
 * - Radial scales green and blue out from the centre and leaves red where it
 *   is, which is what makes the effect grow towards the corners.
 *
 * Alpha is never sampled and never mixed: transparency is the shape of the
 * picture, not part of its colour, so a cut-out PNG keeps exactly the
 * transparency it arrived with.
 *
 * @param {Pixels} pixels
 * @param {AberrationOptions} [options]
 * @returns {Pixels} always a new buffer, never the input
 */
export function applyAberration(pixels, options = {}) {
  const data = pixels?.data ?? null;
  const width = Math.max(0, Math.round(finite(pixels?.width, 0)));
  const height = Math.max(0, Math.round(finite(pixels?.height, 0)));

  // A frame is the number of whole rows the buffer can actually hold. A caller
  // that hands over a buffer shorter than its own width and height gets the
  // rows that fit rather than a pass that reads off the end of it.
  const fit = data ? Math.floor(data.length / 4) : 0;
  const rows = width > 0 ? Math.max(0, Math.min(height, Math.floor(fit / width))) : 0;
  const out = new Uint8ClampedArray(rows * width * 4);

  if (rows === 0) return { width, height: 0, data: out };

  const opts = normalizeOptions(options);

  // Exact identity: nothing is read that is not the pixel being written, so
  // the copy is the whole answer rather than a rounding of it.
  if (isIdentity(opts)) {
    out.set(/** @type {Uint8ClampedArray} */ (data).subarray(0, out.length));
    return { width, height: rows, data: out };
  }

  const k = opts.intensity;
  const cx = width * 0.5;
  const cy = rows * 0.5;

  if (opts.mode === "radial") {
    const scaleG = radialScale(opts.strength, 1);
    const scaleB = radialScale(opts.strength, 2);

    for (let y = 0; y < rows; y++) {
      const gy = cy + (y - cy) * scaleG;
      const by = cy + (y - cy) * scaleB;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = x - cx;
        out[i] = data[i];
        out[i + 1] = mixChannel(data[i + 1], data[samplePixel(cx + dx * scaleG, gy, width, rows) * 4 + 1], k);
        out[i + 2] = mixChannel(data[i + 2], data[samplePixel(cx + dx * scaleB, by, width, rows) * 4 + 2], k);
        out[i + 3] = data[i + 3];
      }
    }

    return { width, height: rows, data: out };
  }

  for (let y = 0; y < rows; y++) {
    const ry = y + opts.offsetRY;
    const by = y + opts.offsetBY;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[i] = mixChannel(data[i], data[samplePixel(x + opts.offsetRX, ry, width, rows) * 4], k);
      out[i + 1] = data[i + 1];
      out[i + 2] = mixChannel(data[i + 2], data[samplePixel(x + opts.offsetBX, by, width, rows) * 4 + 2], k);
      out[i + 3] = data[i + 3];
    }
  }

  return { width, height: rows, data: out };
}