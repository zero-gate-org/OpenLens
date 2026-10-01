/**
 * Gradient map: the tonal range of an image, put onto a colour ramp.
 *
 * There are three separable pieces and they are separated here on purpose.
 *
 * 1. The ramp. A list of stops at positions 0..1, each with a colour, sorted
 *    into order before anything reads it, so a caller can never build a ramp
 *    whose stops are out of sequence.
 * 2. The lookup. The ramp is sampled into a table of 256 entries, one per
 *    possible brightness, so the per-pixel pass costs an index rather than a
 *    search. Sampling once per control change rather than once per pixel is
 *    the difference between this tool being a slider and being a stall.
 * 3. The blend. Four ways of putting the mapped colour onto the original, all
 *    of them mixing by intensity so that 0 leaves the photograph alone.
 *
 * Everything here is pure arithmetic over a plain `{ width, height, data }`
 * object, which is the shape `ImageData` has. No canvas is created, no
 * `ImageData` is constructed and no `ImageData` global is touched, so the
 * whole module runs in plain Node and can be unit tested without a browser,
 * and the same code runs unchanged inside a Web Worker. Turning a result back
 * into real pixels is the caller's job.
 *
 * The lookup is defined the way a CSS gradient is, and this is the one place
 * the legacy tool was vague. Brightness below the first stop holds the first
 * colour, brightness above the last stop holds the last colour, and only the
 * span between stops is interpolated. The legacy tool fell back to the first
 * and last stop when a brightness landed outside their span, which quietly
 * painted a second, wrong ramp across the ends of the picture.
 *
 * @typedef {{pos: number, hex: string, id?: string}} RampStop
 * @typedef {"replace" | "luminosity" | "color" | "multiply"} BlendMode
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 *
 * @typedef {object} RampOptions
 * @property {RampStop[]} [stops]    the ramp, in any order
 * @property {number} [intensity]     0..1, how much of the ramp is mixed in
 * @property {BlendMode} [blend]      how the mapped colour reaches the pixel
 */

import { clamp01, clampChannel } from "./pixels.js";
import { hexToRgb, normalizeHex } from "./duotonemath.js";

/**
 * The fewest stops a ramp can have and still describe a range.
 *
 * Two is the number the UI enforces on removal, and the number every
 * structural helper below refuses to go under, so an impossible ramp cannot
 * be built by asking the panel to build one.
 */
export const MIN_STOPS = 2;

/** How many entries the lookup has, one per possible brightness. */
export const RAMP_STEPS = 256;

/** The ramp a panel starts on: black to white. */
export const DEFAULT_STOPS = [
  { pos: 0, hex: "#000000" },
  { pos: 1, hex: "#ffffff" },
];

/** The blend modes, in the order they are offered. */
export const BLEND_MODES = [
  { value: "replace", label: "Replace" },
  { value: "luminosity", label: "Luminosity" },
  { value: "color", label: "Colour" },
  { value: "multiply", label: "Multiply" },
];

/**
 * A stop inside 0..1.
 *
 * Anything unreadable becomes 0 rather than NaN, because a single bad number
 * in a list would otherwise sort the ramp into a nonsense order and take the
 * whole lookup with it.
 *
 * @param {unknown} value
 * @returns {number}
 */
function cleanPos(value) {
  const pos = Number(value);
  return Number.isFinite(pos) ? clamp01(pos) : 0;
}

/**
 * The stops in ascending position order, as a new array.
 *
 * A copy, always: the caller's array is left exactly as it was, which is what
 * lets a panel hold its stops in component state and hand them here to be
 * read without risking a sort that fires the reactivity it was meant to read.
 *
 * Positions are cleaned on the way out as well as on the way to the
 * comparator. Sorting on a cleaned value and then returning the raw one would
 * hand back a list that is ordered by something it does not contain, and the
 * next reader would have to know that.
 *
 * @param {RampStop[]} stops
 * @returns {RampStop[]}
 */
export function sortStops(stops) {
  return [...(stops ?? [])]
    .map((stop) => ({ ...stop, pos: cleanPos(stop?.pos) }))
    .sort((a, b) => a.pos - b.pos);
}

/**
 * Stops as the lookup wants them: ordered, and with channels resolved.
 *
 * @param {RampStop[]} stops
 * @returns {{pos: number, r: number, g: number, b: number}[]}
 */
function prepare(stops) {
  return sortStops(stops).map((stop) => {
    const { r, g, b } = hexToRgb(stop?.hex);
    return { pos: stop.pos, r, g, b };
  });
}

/**
 * One brightness read off the ramp, writing three channels into `out`.
 *
 * `stops` is the prepared form, so nothing is sorted or parsed here: this
 * runs 256 times to fill the lookup, and once per stop when a new stop is
 * placed on the ramp.
 *
 * A span with no width, which two stops sharing a position produce, returns
 * the lower of the pair rather than dividing by zero.
 *
 * @param {number} t 0 for the shadows, 1 for the highlights
 * @param {{pos: number, r: number, g: number, b: number}[]} stops ascending
 * @param {number[]} out three slots, written in place
 * @returns {number[]} `out`
 */
export function lookup(t, stops, out) {
  const first = stops[0];
  if (!first) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }

  const last = stops[stops.length - 1];
  const k = clamp01(t);

  if (stops.length === 1 || k <= first.pos) {
    out[0] = first.r;
    out[1] = first.g;
    out[2] = first.b;
    return out;
  }

  if (k >= last.pos) {
    out[0] = last.r;
    out[1] = last.g;
    out[2] = last.b;
    return out;
  }

  for (let j = 0; j < stops.length - 1; j++) {
    const a = stops[j];
    const b = stops[j + 1];
    if (k < a.pos || k > b.pos) continue;

    const span = b.pos - a.pos;
    const local = span > 0 ? (k - a.pos) / span : 0;
    out[0] = Math.round(a.r + local * (b.r - a.r));
    out[1] = Math.round(a.g + local * (b.g - a.g));
    out[2] = Math.round(a.b + local * (b.b - a.b));
    return out;
  }

  out[0] = last.r;
  out[1] = last.g;
  out[2] = last.b;
  return out;
}

/**
 * The colour the ramp gives one brightness, as a fresh array.
 *
 * Convenient for the panel and for the tests, and too slow for the hot loop,
 * which reads `buildLut` instead.
 *
 * @param {number} t 0 for the shadows, 1 for the highlights
 * @param {RampStop[]} stops
 * @returns {number[]} `[r, g, b]` as bytes
 */
export function rampColor(t, stops) {
  return lookup(t, prepare(stops), [0, 0, 0]);
}

/**
 * The ramp as a table of 256 colours, three bytes each.
 *
 * This is the whole point of the module: a pixel then costs one brightness,
 * one multiply by three and one index, instead of a search through the stops.
 *
 * @param {RampStop[]} stops
 * @returns {Uint8Array} 768 bytes
 */
export function buildLut(stops) {
  const ordered = prepare(stops);
  const lut = new Uint8Array(RAMP_STEPS * 3);
  const rgb = [0, 0, 0];

  for (let i = 0; i < RAMP_STEPS; i++) {
    lookup(i / (RAMP_STEPS - 1), ordered, rgb);
    lut[i * 3] = rgb[0];
    lut[i * 3 + 1] = rgb[1];
    lut[i * 3 + 2] = rgb[2];
  }

  return lut;
}

/**
 * The entry in the lookup for one brightness, 0..255.
 *
 * Rounded, because that is the resolution the table is built at, and clamped,
 * because a float weighted sum can land a hair outside the range on a pure
 * white pixel.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number} 0..255
 */
export function toneIndex(r, g, b) {
  return clampChannel(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
}

/**
 * Perceptual brightness of a pixel, 0..255, unrounded.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number}
 */
export function tone(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * HSL of a colour, writing into three slots of `out` from `at`.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number[]} out
 * @param {number} at
 * @returns {number[]} `out`
 */
function toHsl(r, g, b, out, at) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    out[at] = 0;
    out[at + 1] = 0;
  } else {
    const d = max - min;
    out[at + 1] = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        out[at] = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        out[at] = ((bn - rn) / d + 2) / 6;
        break;
      default:
        out[at] = ((rn - gn) / d + 4) / 6;
        break;
    }
  }

  out[at + 2] = l;
  return out;
}

/**
 * RGB from HSL, written into three slots of `out` from `at`.
 *
 * @param {number} h 0..1
 * @param {number} s 0..1
 * @param {number} l 0..1
 * @param {number[]} out
 * @param {number} at
 * @returns {number[]} `out`
 */
function fromHsl(h, s, l, out, at) {
  if (s === 0) {
    const grey = Math.round(l * 255);
    out[at] = grey;
    out[at + 1] = grey;
    out[at + 2] = grey;
    return out;
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let u = t;
    if (u < 0) u += 1;
    if (u > 1) u -= 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };

  out[at] = clampChannel(Math.round(hue(h + 1 / 3) * 255));
  out[at + 1] = clampChannel(Math.round(hue(h) * 255));
  out[at + 2] = clampChannel(Math.round(hue(h - 1 / 3) * 255));
  return out;
}

/**
 * One pixel of a gradient mapped image.
 *
 * The brightness of the pixel picks the colour off the ramp, the blend says
 * how that colour reaches the pixel, and the intensity says how much of it
 * arrives. Alpha is never touched: this is a colour map, and a cut-out PNG
 * has to keep the transparency it arrived with.
 *
 * `scratch` and `out` are caller-owned so the per-pixel pass allocates
 * nothing. `scratch` is nine slots: the mapped colour as HSL, the original
 * colour as HSL, and the blended RGB.
 *
 * @param {number} r 0..255
 * @param {number} g 0..255
 * @param {number} b 0..255
 * @param {Uint8Array} lut   from `buildLut`
 * @param {number} amount    0..1
 * @param {BlendMode} blend
 * @param {number[]} scratch nine slots
 * @param {number[]} out     three slots for the result
 * @returns {number[]} `out`, as bytes
 */
export function rampPixel(r, g, b, lut, amount, blend, scratch, out) {
  const i = toneIndex(r, g, b) * 3;
  const mr = lut[i];
  const mg = lut[i + 1];
  const mb = lut[i + 2];
  let tr = mr;
  let tg = mg;
  let tb = mb;

  if (blend === "luminosity") {
    // The brightness of the mapped colour is added to each channel, which
    // keeps every hue and saturation the original had and moves only the
    // tone. Clamped per channel because a channel can already be at its end.
    const diff = tone(mr, mg, mb) - tone(r, g, b);
    tr = clampChannel(r + diff);
    tg = clampChannel(g + diff);
    tb = clampChannel(b + diff);
  } else if (blend === "color") {
    // The hue and saturation of the ramp, the lightness of the original, so
    // the picture keeps its own modelling and takes the ramp's colour.
    toHsl(mr, mg, mb, scratch, 0);
    toHsl(r, g, b, scratch, 3);
    fromHsl(scratch[0], scratch[1], scratch[5], scratch, 6);
    tr = scratch[6];
    tg = scratch[7];
    tb = scratch[8];
  } else if (blend === "multiply") {
    // The two colours multiply, so a ramp that is dark everywhere darkens
    // everywhere and the original's own texture survives.
    tr = (r * mr) / 255;
    tg = (g * mg) / 255;
    tb = (b * mb) / 255;
  }

  const k = clamp01(amount);
  out[0] = clampChannel(Math.round(r + k * (tr - r)));
  out[1] = clampChannel(Math.round(g + k * (tg - g)));
  out[2] = clampChannel(Math.round(b + k * (tb - b)));
  return out;
}

/**
 * Map a whole frame onto the ramp.
 *
 * @param {Pixels} pixels
 * @param {RampOptions} [options]
 * @returns {Pixels} always a new buffer
 */
export function applyRamp(pixels, options = {}) {
  const { stops = DEFAULT_STOPS, intensity = 1, blend = "replace" } = options;
  const lut = buildLut(stops);
  const { width, height, data } = pixels;
  const out = new Uint8ClampedArray(data.length);
  // Two scratch sets for the whole pass. The blend and the result are the
  // same few numbers for every pixel, so allocating per pixel would be the
  // most expensive thing in the tool.
  const scratch = new Array(9).fill(0);
  const rgb = [0, 0, 0];

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    rampPixel(data[i], data[i + 1], data[i + 2], lut, intensity, blend, scratch, rgb);

    out[i] = rgb[0];
    out[i + 1] = rgb[1];
    out[i + 2] = rgb[2];
    // Alpha is the shape of the picture, not part of its tone, so a cut-out
    // PNG keeps the transparency it arrived with.
    out[i + 3] = data[i + 3];
  }

  return { width, height, data: out };
}

/**
 * Move one stop to a new position, keeping the ramp in order.
 *
 * Two stops can share a position, which the lookup handles, but the list is
 * always sorted on the way out: an unsorted ramp would interpolate between
 * the wrong pair of stops for part of the tonal range.
 *
 * @param {RampStop[]} stops
 * @param {number} index  into the list as it stands
 * @param {number} pos    0..1
 * @returns {RampStop[]} a new list
 */
export function moveStop(stops, index, pos) {
  const next = sortStops(stops).map((stop) => ({ ...stop }));
  if (index < 0 || index >= next.length) return next;

  next[index] = { ...next[index], pos: cleanPos(pos) };
  return sortStops(next);
}

/**
 * Put one stop on the ramp, at a position, in a colour.
 *
 * @param {RampStop[]} stops
 * @param {number} pos 0..1
 * @param {string} hex `#rrggbb`
 * @param {string} [id] carried through, so a panel can keep hold of a stop
 * @returns {RampStop[]} a new list, ascending
 */
export function addStop(stops, pos, hex, id) {
  const stop = /** @type {RampStop} */ ({ pos: cleanPos(pos), hex: normalizeHex(hex) });
  if (id !== undefined) stop.id = id;
  return sortStops([...sortStops(stops), stop]);
}

/**
 * The ramp with one more stop on it, at `pos`, coloured to match.
 *
 * The colour is read off the ramp itself, so a stop dropped into the middle
 * of a gradient starts invisible and only becomes visible when it is moved
 * or recoloured. That is the behaviour every gradient editor has, and it is
 * why the stop is selected as soon as it is added.
 *
 * @param {RampStop[]} stops
 * @param {number} pos 0..1
 * @param {string} [id] carried through, so a panel can keep hold of a stop
 * @returns {RampStop[]} a new list
 */
export function addStopAt(stops, pos, id) {
  const ordered = sortStops(stops);
  const at = cleanPos(pos);
  const [r, g, b] = lookup(at, prepare(ordered), [0, 0, 0]);
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return addStop(ordered, at, hex, id);
}

/**
 * The ramp without one stop.
 *
 * A ramp below `MIN_STOPS` is refused rather than clamped, because there is
 * no second stop to fall back to and a ramp of one is not a ramp.
 *
 * @param {RampStop[]} stops
 * @param {number} index  into the list as it stands
 * @returns {RampStop[]} a new list, or the original when the removal was refused
 */
export function removeStop(stops, index) {
  const ordered = sortStops(stops);
  if (ordered.length <= MIN_STOPS) return ordered;
  if (index < 0 || index >= ordered.length) return ordered;

  const next = ordered.map((stop) => ({ ...stop }));
  next.splice(index, 1);
  return sortStops(next);
}

/**
 * The ramp the other way up.
 *
 * Mirroring positions is the same operation the legacy tool performed when
 * its reverse button was pressed, and it is its own inverse, so pressing it
 * twice lands back where it started.
 *
 * @param {RampStop[]} stops
 * @returns {RampStop[]} a new list, ascending again
 */
export function reverseStops(stops) {
  return sortStops(sortStops(stops).map((stop) => ({ ...stop, pos: 1 - cleanPos(stop.pos) })));
}
