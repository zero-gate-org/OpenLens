/**
 * Film grain: seeded noise, weighted by how bright a pixel already is.
 *
 * Everything here is pure arithmetic over a plain `{ width, height, data }`
 * object, which is the shape `ImageData` has. No canvas is created, no
 * `ImageData` is constructed and no `ImageData` global is touched, so the whole
 * module runs in plain Node and can be unit tested without a browser, and the
 * same code runs unchanged inside a Web Worker. Turning a result back into real
 * pixels is the caller's job.
 *
 * The noise is a pure function of (x, y, seed) and of nothing else, in
 * particular not of a clock or of `Math.random`. That is what makes the preview
 * stable: dragging a slider re-runs the same arithmetic and gets the same grain
 * back, so the picture does not shimmer between two versions of itself. The
 * seed field is therefore always live, and randomising it is the only way to
 * get a different pattern.
 *
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 * @typedef {"uniform" | "luminance" | "color"} NoiseType
 * @typedef {"square" | "random"} GrainShape
 * @typedef {"everywhere" | "highlights" | "shadows"} Placement
 * @typedef {"add" | "overlay" | "soft-light"} BlendMode
 *
 * @typedef {object} GrainOptions
 * @property {NoiseType} [noiseType]  how the noise is turned into channel offsets
 * @property {number} [strength]      0..100, 0 returns the input untouched
 * @property {number} [grainSize]     1..8, the side of a grain cell in pixels
 * @property {GrainShape} [shape]     a cell grid, or a fresh cell per pixel
 * @property {Placement} [placement]  which tones carry the grain
 * @property {BlendMode} [blendMode]  how an offset is applied to a channel
 * @property {number} [blend]         0..100, how far the blend result is taken
 * @property {number} [seed]          integer, selects the pattern
 */

/**
 * The largest channel offset a strength of 100 can produce, in 0..255 units.
 *
 * At 80 the strongest setting is a visible texture rather than a destroyed
 * picture, which is the whole point of a slider that runs to its end.
 */
export const MAX_OFFSET = 80;

/** Where the tonal cut sits, as a fraction of full scale. */
const HIGHLIGHT_CUT = 0.7;
const SHADOW_CUT = 0.3;

/**
 * A hash for one grain cell, in 0..1.
 *
 * Three rounded integer multiplies rather than the usual `sin(x) * 43758`
 * trick. A sine hash is only well distributed while its argument stays small:
 * at a few thousand pixels across, `x * 127.1` has already lost the low bits
 * that carry the variation, and the pattern smears into diagonal bands. The
 * integer version stays a bijection over its inputs, so a large image gets
 * grain as fine grained as a small one, and the same seed gives the same
 * pattern on every machine, because nothing here depends on the rounding of a
 * transcendental.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 * @returns {number} 0..1
 */
export function grainNoise(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h = Math.imul(h ^ (seed | 0), 0x9e3779b1);
  // A final avalanche, so neighbouring cells do not share their high bits.
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  // The top bits are the well mixed ones, so they are folded into the top of
  // the mantissa. A shift rather than a division: cheaper, and exact.
  return (h >>> 8) / 16777216;
}

/**
 * sRGB-relative luminance of one pixel, 0 (black) to 1 (white).
 *
 * The same coefficients the rest of the app uses, so "highlights" here means
 * the same thing as a highlight everywhere else.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number} 0..1
 */
export function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Whether a pixel carries grain, from its luminance.
 *
 * One weight per pixel rather than one per channel, because "highlights" is a
 * statement about a tone and not about three numbers: a saturated red at
 * (255, 60, 40) is a highlight or it is not, and grading its three channels
 * separately would be answering a question nobody asked.
 *
 * The cut is a step, not a ramp, so a pixel either takes its grain whole or
 * keeps none of it. A soft ramp would be prettier across a sky, and it would
 * also make a half strength pixel impossible to reason about.
 *
 * @param {number} lum pixel luminance, 0..1
 * @param {Placement} placement
 * @returns {boolean}
 */
function carriesGrain(lum, placement) {
  if (placement === "highlights") return lum >= HIGHLIGHT_CUT;
  if (placement === "shadows") return lum <= SHADOW_CUT;
  return true;
}

/**
 * The W3C overlay blend, in 0..255, for a backdrop and a source.
 *
 * @param {number} b backdrop, 0..255
 * @param {number} s source, 0..255
 * @returns {number} 0..255
 */
function overlay(b, s) {
  return b <= 127.5 ? (2 * b * s) / 255 : 255 - (2 * (255 - b) * (255 - s)) / 255;
}

/**
 * The W3C soft light blend, in 0..255, for a backdrop and a source.
 *
 * @param {number} b backdrop, 0..255
 * @param {number} s source, 0..255
 * @returns {number} 0..255
 */
function softLight(b, s) {
  const bn = b / 255;
  const sn = s / 255;
  // 255 * b * (1 - b): the headroom of the backdrop, in 0..1.
  const headroom = bn * (1 - bn);
  const depth = bn <= 0.25 ? ((16 * bn - 12) * bn + 4) * bn : Math.sqrt(bn);
  const out = sn <= 0.5 ? bn - (1 - 2 * sn) * headroom : bn + (2 * sn - 1) * (depth - bn);
  return out * 255;
}

/**
 * Blend one channel of one pixel, returning a value in 0..255.
 *
 * The grain always arrives as a signed offset rather than as an absolute
 * colour, so that a cell with no grain is a no-op in every mode. The mode only
 * decides how the offset is applied: `add` is the linear sum the legacy tool
 * used, and the other two move the pixel a fraction of the way towards the
 * blend of itself with the offset, which is what keeps a clipped channel
 * clipped. Both of those are fixed points of the W3C formula at 0 and 255.
 *
 * @param {number} base channel value, 0..255
 * @param {number} offset signed grain, in 0..255 units
 * @param {BlendMode} mode
 * @param {number} amount 0..1
 * @returns {number} 0..255
 */
function blendChannel(base, offset, mode, amount) {
  if (amount <= 0) return base;
  if (mode === "overlay") return base + (overlay(base, base + offset) - base) * amount;
  if (mode === "soft-light") return base + (softLight(base, base + offset) - base) * amount;
  return base + offset * amount;
}

/** Round to the nearest byte and hold the result inside 0..255. */
function clampByte(v) {
  const n = Math.round(v);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

/**
 * Add film grain to a frame.
 *
 * Three noise modes, which differ in what the noise is allowed to touch:
 * `uniform` offsets all three channels by the same amount and so stays grey,
 * `color` gives each channel its own hash and so speckles in colour, and
 * `luminance` offsets green alone. Green carries most of a pixel's luminance,
 * so the third mode reads as a change in brightness rather than as a change of
 * colour, which is how grain behaves on real film.
 *
 * The returned frame is always a new buffer: a preview built from it must never
 * alias the sharp frame the next control change starts from.
 *
 * @param {Pixels} pixels
 * @param {GrainOptions} [options]
 * @returns {Pixels}
 */
export function applyGrain(pixels, options = {}) {
  const {
    noiseType = "uniform",
    strength = 25,
    grainSize = 1,
    shape = "square",
    placement = "everywhere",
    blendMode = "soft-light",
    blend = 100,
    seed = 42,
  } = options;

  const { width, height, data } = pixels;

  // Zero strength is the identity, and short-circuiting keeps it exact: no
  // rounding, no clamping, the same bytes in and out.
  if (!(strength > 0)) return { width, height, data: new Uint8ClampedArray(data) };

  const out = new Uint8ClampedArray(data.length);
  const span = Math.max(0, Math.min(100, strength)) / 100;
  const offset = span * MAX_OFFSET;
  const amount = Math.max(0, Math.min(100, blend)) / 100;
  const cell = Math.max(1, Math.round(grainSize));
  // A size of one cannot form cells, so the shape is irrelevant there and the
  // per-pixel path is used instead. That is the legacy behaviour, kept because
  // fine digital grain is the size-one case.
  const quantised = cell > 1;
  const masked = placement !== "everywhere";

  for (let y = 0; y < height; y++) {
    // Grain is quantised to a cell, so the hash is evaluated once per cell and
    // reused across it. At size 8 that is a sixty fourth of the hashing, and
    // it is the reason a large grain size is affordable at all.
    const cy = quantised ? Math.floor(y / cell) : y;

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Square cells share one hash across the whole block, which gives hard
      // squares of one tone. Random cells put a single grain in each one, so a
      // block reads as a cluster of separate specks.
      const cx = quantised
        ? shape === "square"
          ? Math.floor(x / cell) * cell
          : Math.floor(x / cell)
        : x;

      let dR = 0;
      let dG = 0;
      let dB = 0;

      if (noiseType === "luminance") {
        // The grain is a signed offset around the channel value. Green carries
        // most of a pixel's luminance, so offsetting it alone is the cheapest
        // way to move brightness without moving hue.
        dG = (grainNoise(cx, cy, seed) - 0.5) * 2 * offset;
      } else {
        dR = (grainNoise(cx, cy, seed) - 0.5) * 2 * offset;
        if (noiseType === "color") {
          // A second and third hash, offset in both cell and seed, so the
          // channels are uncorrelated rather than three copies of one value.
          dG = (grainNoise(cx + 1, cy + 1, seed + 1) - 0.5) * 2 * offset;
          dB = (grainNoise(cx + 2, cy + 2, seed + 2) - 0.5) * 2 * offset;
        } else {
          dG = dR;
          dB = dR;
        }
      }

      const lum = masked ? luminance(r, g, b) : 0;
      const w = masked && !carriesGrain(lum, placement) ? 0 : 1;

      // Alpha is never touched: grain is a property of colour, and a grain
      // that appeared in a transparent area would be a halo.
      out[i] = dR === 0 || w === 0 ? r : clampByte(blendChannel(r, dR, blendMode, amount));
      out[i + 1] = dG === 0 || w === 0 ? g : clampByte(blendChannel(g, dG, blendMode, amount));
      out[i + 2] = dB === 0 || w === 0 ? b : clampByte(blendChannel(b, dB, blendMode, amount));
      out[i + 3] = data[i + 3];
    }
  }

  return { width, height, data: out };
}
