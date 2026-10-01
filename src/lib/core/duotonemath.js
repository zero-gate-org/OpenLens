/**
 * Pure maths for the duotone effect.
 *
 * A duotone image keeps no colour of its own. Every pixel is reduced to one
 * number, its brightness, and that number is looked up on a straight line
 * running from the shadow colour to the highlight colour. The result is then
 * mixed back over the original in proportion to the intensity, so 0 leaves
 * the photograph alone and 1 replaces it completely.
 *
 * Everything here takes numbers and returns numbers, so the effect can be
 * checked without loading a picture. The pixel helpers write into arrays the
 * caller supplies rather than returning fresh ones, because they run once per
 * pixel and an allocation there would be the single biggest cost in the tool.
 *
 * The luminance weights are the sRGB ones (0.2126, 0.7152, 0.0722) and are
 * shared with the rest of the app through `pixels.js`, so the brightness this
 * ramp is built on is the same brightness a contrast slider measures.
 *
 * @typedef {{r: number, g: number, b: number}} Rgb 8 bit channels
 * @typedef {{shadow: Rgb, highlight: Rgb, intensity: number}} Duotone
 */

import { clamp01, luma } from "./pixels.js";

/**
 * A `#rgb` or `#rrggbb` string as 8 bit channels.
 *
 * The two forms both turn up: a preset and a hand-typed value disagree about
 * how many digits to write, and neither is an error. Anything unreadable
 * becomes black rather than NaN, so one bad value cannot make the whole panel
 * render nothing.
 *
 * @param {string} hex
 * @returns {Rgb}
 */
export function hexToRgb(hex) {
  const digits = String(hex ?? "")
    .trim()
    .replace(/^#/, "");
  // Three digits is shorthand: f0a expands to ff00aa.
  const full = digits.length === 3
    ? digits.replace(/./g, (c) => c + c)
    : digits.slice(0, 6).padEnd(6, "0");

  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return { r: 0, g: 0, b: 0 };

  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * The same colour as a canonical lowercase `#rrggbb` string.
 *
 * Two colours can only be compared as strings if they are written the same
 * way, so this is what makes a preset and a colour field able to agree about
 * whether they hold the same colour.
 *
 * @param {string} hex
 * @returns {string}
 */
export function normalizeHex(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The ramp lookup, writing into `out`.
 *
 * Black maps to the shadow colour and white to the highlight colour, with
 * everything between them on a straight line. `t` is clamped rather than
 * trusted: brightness from a real image is always 0..1, but a caller that
 * computes it another way should get the ends of the ramp, not a colour with
 * a negative channel.
 *
 * The result is rounded, which is what an 8 bit channel holds anyway, and
 * rounding here rather than at the end keeps the mix below exactly the legacy
 * arithmetic.
 *
 * @param {number} t 0 for the shadows, 1 for the highlights
 * @param {Rgb} shadow
 * @param {Rgb} highlight
 * @param {number[]} out three slots, written in place
 * @returns {number[]} `out`
 */
export function rampInto(t, shadow, highlight, out) {
  const k = clamp01(t);
  out[0] = Math.round(shadow.r + k * (highlight.r - shadow.r));
  out[1] = Math.round(shadow.g + k * (highlight.g - shadow.g));
  out[2] = Math.round(shadow.b + k * (highlight.b - shadow.b));
  return out;
}

/**
 * The ramp lookup as a fresh array. Convenient, and too slow for the hot
 * loop, which should be handing `rampInto` a scratch array it already owns.
 *
 * @param {number} t 0 for the shadows, 1 for the highlights
 * @param {Rgb} shadow
 * @param {Rgb} highlight
 * @returns {number[]} `[r, g, b]` as bytes
 */
export function rampColor(t, shadow, highlight) {
  return rampInto(t, shadow, highlight, [0, 0, 0]);
}

/**
 * One pixel of a duotone image.
 *
 * The brightness is measured on the colour the pixel already has, alpha is
 * ignored, and the ramp colour is then mixed over the original by the
 * intensity. A fully transparent pixel therefore still gets a ramp colour,
 * with the transparency it started with, which is the same as the legacy tool
 * did and the reason cut-out PNGs survive the round trip.
 *
 * `ramp` and `out` are caller-owned scratch arrays so the per-pixel pass can
 * allocate nothing at all.
 *
 * @param {number} r 0..255
 * @param {number} g 0..255
 * @param {number} b 0..255
 * @param {Duotone} settings
 * @param {number[]} ramp three scratch slots for the ramp lookup
 * @param {number[]} out three slots for the result
 * @returns {number[]} `out`, as bytes
 */
export function duotonePixel(r, g, b, settings, ramp, out) {
  const amount = clamp01(settings.intensity);
  rampInto(luma(r, g, b), settings.shadow, settings.highlight, ramp);

  out[0] = Math.round(r + amount * (ramp[0] - r));
  out[1] = Math.round(g + amount * (ramp[1] - g));
  out[2] = Math.round(b + amount * (ramp[2] - b));
  return out;
}

/**
 * Cache key for a set of tones.
 *
 * Two settings with the same key produce the same pixels, which is the only
 * property the cache needs. Colours go in as decimal channels so that two
 * spellings of one colour cannot open two cache entries.
 *
 * @param {Duotone} settings
 * @returns {string}
 */
export function duotoneKey(settings) {
  const { shadow, highlight, intensity } = settings;
  return `${shadow.r},${shadow.g},${shadow.b}|${highlight.r},${highlight.g},${highlight.b}|${intensity}`;
}
