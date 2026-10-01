/**
 * Pure maths for the tilt-shift effect.
 *
 * Two independent pieces live here, both free of runes and of any canvas:
 *
 *   1. the band ramp, which decides how sharp each row of the image is, and
 *   2. the colour maths behind vibrance, saturation, brightness, contrast
 *      and the vignette.
 *
 * Everything takes numbers and returns numbers, so the whole effect can be
 * checked without loading a picture.
 *
 * The colour helpers write into arrays the caller supplies instead of
 * returning fresh ones. They run once per pixel, so allocating there would
 * be the single biggest cost in the effect.
 */

import { clamp01 } from "./pixels.js";

/**
 * 3t^2 - 2t^3.
 *
 * The zero slope at both ends is the point: it is what makes the ramp into
 * the focus band read as gradual instead of like a seam. t is not clamped
 * here so callers can reason about the unclamped value if they need to.
 */
export function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Where the sharp band sits, in pixel rows.
 *
 * `focusPosition` and `transitionWidth` are percentages of the image height,
 * which is what the sliders say. The band is `transitionWidth` tall and
 * centred on `focusPosition`; the blur then ramps up over that same distance
 * again, once above the band and once below it.
 *
 * @returns {{focus: number, half: number, top: number, bottom: number}}
 */
export function bandGeometry(height, focusPosition, transitionWidth) {
  const focus = (focusPosition / 100) * height;
  const half = ((transitionWidth / 100) * height) / 2;
  return { focus, half, top: focus - half, bottom: focus + half };
}

/**
 * How sharp row `y` is. 1 anywhere inside the band, easing down to 0 one
 * transition width above or below it, and never outside 0..1.
 *
 * @param {number} y row index
 * @param {{focus: number, half: number, top: number, bottom: number}} geometry
 */
export function bandWeight(y, geometry) {
  if (y >= geometry.top && y <= geometry.bottom) return 1;

  const distance = y < geometry.top ? geometry.top - y : y - geometry.bottom;
  // A zero width band leaves no room to ramp through, so everything outside
  // it is fully blurred. Dividing by the zero half would otherwise give NaN
  // for a pixel sitting exactly on the edge.
  const t = geometry.half > 0 ? Math.min(1, distance / geometry.half) : 1;
  return 1 - smoothstep(t);
}

/**
 * One weight per row.
 *
 * The band runs across the full width, so a pixel's weight depends only on
 * its row. Storing a single value per row instead of a width by height mask
 * saves a full image of memory and a full image of writes per render.
 *
 * @returns {Float32Array} length `height`, values in 0..1
 */
export function bandRamp(height, focusPosition, transitionWidth) {
  const geometry = bandGeometry(height, focusPosition, transitionWidth);
  const ramp = new Float32Array(height);
  for (let y = 0; y < height; y += 1) ramp[y] = bandWeight(y, geometry);
  return ramp;
}

/**
 * sRGB in 0..1 to HSL. Writes h, s, l into `out` and returns it.
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
 * Radial darkening for one pixel, as a multiplier for the RGB channels.
 *
 * `dx` and `dy` are the offsets from the centre of the frame and
 * `maxDistance` is the distance from the centre to a corner, so the result
 * is 1 at the middle and falls toward `1 - strength` at the corners.
 *
 * @param {number} strength 0 for no vignette, 1 for the full effect
 */
export function vignetteFalloff(dx, dy, maxDistance, strength) {
  if (strength <= 0 || maxDistance <= 0) return 1;
  const d = Math.sqrt(dx * dx + dy * dy) / maxDistance;
  return 1 - d * d * strength;
}

/**
 * The colour pass for one pixel.
 *
 * Order matters and matches the order a colourist would work in: vibrance and
 * saturation adjust chroma in HSL, brightness and contrast are linear
 * multiplies around a mid grey pivot, and the vignette darkens the edges
 * last. Values in and out are 0..1 floats, the caller scales to bytes.
 *
 * `falloff` is the precomputed vignette multiplier, so the hot loop does not
 * repeat the centre distance. `scratch` is a 3 slot array reused by every
 * pixel for the HSL round trip.
 *
 * @param {{vibrance: number, saturation: number, brightness: number, contrast: number, vignette: number}} tone
 * @returns {number[]} `out`, the three channels
 */
export function tonePixel(r, g, b, tone, falloff, scratch, out) {
  const hsl = rgbToHsl(r, g, b, scratch);
  const h = hsl[0];
  const l = hsl[2];

  // Vibrance leans on colours that are already muted, so an already vivid
  // pixel barely moves while a washed out one comes to life.
  let s = hsl[1];
  if (tone.vibrance !== 1) s = clamp01(s + (1 - s) * (tone.vibrance - 1));
  // Saturation then lifts every colour by the same proportion.
  s = clamp01(s * tone.saturation);

  hslToRgb(h, s, l, out);

  out[0] *= tone.brightness;
  out[1] *= tone.brightness;
  out[2] *= tone.brightness;

  out[0] = (out[0] - 0.5) * tone.contrast + 0.5;
  out[1] = (out[1] - 0.5) * tone.contrast + 0.5;
  out[2] = (out[2] - 0.5) * tone.contrast + 0.5;

  out[0] *= falloff;
  out[1] *= falloff;
  out[2] *= falloff;

  return out;
}

/**
 * Cache key for a colour setting. Two settings with the same key produce the
 * same pixels, which is the only property the cache needs.
 */
export function toneKey(tone) {
  const { vibrance, saturation, brightness, contrast, vignette } = tone;
  return `${vibrance}|${saturation}|${brightness}|${contrast}|${vignette}`;
}
