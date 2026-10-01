/**
 * Pure colour maths for the color splash effect.
 *
 * A splash keeps one colour family and turns the rest grey. That is two
 * decisions per pixel, and both live here:
 *
 *   1. how much chroma a pixel keeps, which is its hue measured against the
 *      chosen family, and
 *   2. how much grey it keeps, which is the foreground coverage the mask
 *      supplies.
 *
 * Nothing in this file touches a canvas or a rune, and no helper allocates
 * inside the hot loop: the HSL round trip writes into arrays the caller passes
 * in, because this runs once per pixel of the image.
 *
 * Channels go in as 0..255 bytes, because that is what a decoded image
 * actually holds, and come back as 0..1 floats, which is what a mix wants. The
 * caller scales by 255 on the way out, and a clamped array does the rounding.
 */

import { luma } from "./pixels.js";

export { luma };

/**
 * How far from a family's hue a pixel still counts as that family, as a
 * fraction of the colour circle.
 *
 * 0.05 is 18 degrees, which is narrow on purpose: the presets sit as close as
 * 21 degrees apart (orange and yellow), so a wider window would let one
 * family keep another's colour outright and the pick would be a lie. The width
 * is the outer edge of a ramp rather than a cliff, so a colour near the
 * boundary is only partly kept and the join never shows.
 */
export const FAMILY_WIDTH = 0.05;

/**
 * The presets the panel offers.
 *
 * `hue` is the centre of the family, and `hex` is the swatch, so the colour on
 * screen and the colour the maths keeps are the same number. `hue: null` is
 * the legacy behaviour: keep every colour the subject has, and take the
 * saturation off everything else.
 *
 * @typedef {{id: string, label: string, hex: string, hue: number|null, width: number}} Family
 * @type {Family[]}
 */
export const SPLASH_COLOURS = [
  { id: "original", label: "Original", hex: "#9aa0a6", hue: null, width: FAMILY_WIDTH },
  { id: "red", label: "Red", hex: "#ef4444", hue: 0.0, width: FAMILY_WIDTH },
  { id: "orange", label: "Orange", hex: "#f97316", hue: 0.068, width: FAMILY_WIDTH },
  { id: "yellow", label: "Yellow", hex: "#eab308", hue: 0.126, width: FAMILY_WIDTH },
  { id: "green", label: "Green", hex: "#22c55e", hue: 0.395, width: FAMILY_WIDTH },
  { id: "blue", label: "Blue", hex: "#3b82f6", hue: 0.603, width: FAMILY_WIDTH },
  { id: "violet", label: "Violet", hex: "#8b5cf6", hue: 0.718, width: FAMILY_WIDTH },
  { id: "pink", label: "Pink", hex: "#ec4899", hue: 0.918, width: FAMILY_WIDTH },
];

/** The preset the panel starts on: the subject keeps its own colours. */
export const DEFAULT_COLOUR_ID = "original";

/**
 * sRGB in 0..1 to HSL. Writes h, s, l into `out` and returns it.
 *
 * A pixel with no chroma has no meaningful hue, so it comes back at hue 0
 * rather than as a division by a zero range.
 */
export function rgbToHsl(r, g, b, out) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    out[0] = 0;
    out[1] = 0;
    out[2] = l;
    return out;
  }

  const d = max - min;
  out[0] = 0;
  out[1] = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  if (max === r) out[0] = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) out[0] = ((b - r) / d + 2) / 6;
  else out[0] = ((r - g) / d + 4) / 6;
  out[2] = l;
  return out;
}

/** HSL back to sRGB in 0..1. Writes r, g, b into `out` and returns it. */
export function hslToRgb(h, s, l, out) {
  if (s === 0) {
    out[0] = l;
    out[1] = l;
    out[2] = l;
    return out;
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  out[0] = hueToChannel(p, q, h + 1 / 3);
  out[1] = hueToChannel(p, q, h);
  out[2] = hueToChannel(p, q, h - 1 / 3);
  return out;
}

function hueToChannel(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/**
 * Shortest distance between two hues, 0 to 0.5.
 *
 * The colour circle has no ends, so red at 0 and red at 0.98 are close
 * together rather than almost opposite.
 */
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

/**
 * How much of itself a colour keeps, 0 to 1, measured against a family.
 *
 * A family with no hue is "Original": it keeps everything, which is what the
 * legacy tool did before there were presets. Everything else is a smooth ramp
 * that reaches full strength at the family hue and is gone one width away, so
 * a colour on the boundary half survives instead of flipping.
 *
 * @param {number} hue 0..1
 * @param {Family} family
 */
export function familyWeight(hue, family) {
  if (!family || family.hue === null) return 1;

  const width = family.width ?? FAMILY_WIDTH;
  if (!(width > 0)) return hue === family.hue ? 1 : 0;

  const t = (width - hueDistance(hue, family.hue)) / width;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // 3t^2 - 2t^3: flat at both ends, so the ramp has no visible corner on it.
  return t * t * (3 - 2 * t);
}

/**
 * The splash for one pixel.
 *
 * Grey is the floor: every pixel is first replaced by its own luma, which
 * leaves a colourless version of the image behind. Each channel is then pulled
 * back toward the original by how much of that pixel should stay coloured,
 * which is the mask's coverage times the strength of the colour's own family.
 *
 * A pixel with no coverage is grey whatever its hue, and a pixel at full
 * coverage is untouched unless its family says otherwise, so the mask and the
 * colour pass never fight over the same pixel.
 *
 * @param {number} r 0..255
 * @param {number} g 0..255
 * @param {number} b 0..255
 * @param {number} coverage 0..1 from the segmentation mask
 * @param {Family} family
 * @param {number[]} hsl 3 scratch slots
 * @param {number[]} out 3 scratch slots, 0..1
 */
export function splashPixel(r, g, b, coverage, family, hsl, out) {
  const grey = luma(r, g, b);

  let keep = coverage;
  // The hue is only worth converting for a pixel that has colour to lose. The
  // background is most of the frame, and it is grey either way.
  if (keep > 0 && family && family.hue !== null) {
    rgbToHsl(r / 255, g / 255, b / 255, hsl);
    keep *= familyWeight(hsl[0], family);
    // None of this pixel's family survived, so the mix below would multiply
    // by zero and give the grey back anyway.
    if (keep <= 0) {
      out[0] = grey;
      out[1] = grey;
      out[2] = grey;
      return out;
    }
  }

  // Pulling every channel toward the same grey by `keep` is a desaturation
  // that cannot change luminance, so the background keeps its exposure and
  // loses only its colour.
  out[0] = grey + (r / 255 - grey) * keep;
  out[1] = grey + (g / 255 - grey) * keep;
  out[2] = grey + (b / 255 - grey) * keep;
  return out;
}

/**
 * Cache key for a finished frame.
 *
 * Two settings with the same key produce the same pixels, which is all the
 * frame cache needs to know. The feather is in the key because it decides the
 * coverage, and the family because it decides the colour.
 */
export function splashKey(family, feather) {
  return `${family?.id ?? "original"}|${feather}`;
}
