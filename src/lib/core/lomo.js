/**
 * Lomo and cross-process emulation: a per-channel tone curve, a saturation
 * control, a warmth shift and a vignette, in that order.
 *
 * The effect is four separable pieces and they are separated here on purpose.
 *
 * 1. The curve. A handful of control points per channel, sampled into a table
 *    of 256 entries, one per possible level, so the per-pixel pass costs an
 *    index rather than a search. The spline is monotone (Fritsch-Carlson), so
 *    a curve cannot overshoot and fold back on itself between two points, which
 *    is what a plain Catmull-Rom does and what makes a tone curve feel wrong
 *    without being able to say why.
 * 2. Saturation, warmth and intensity, all per pixel and all pure arithmetic.
 * 3. The vignette, a radial falloff applied last, as a multiplier.
 * 4. The look definitions, which are curves and settings and nothing else.
 *
 * Everything here is pure arithmetic over a plain `{ width, height, data }`
 * object, which is the shape `ImageData` has. No canvas is created, no
 * `ImageData` is constructed and no `ImageData` global is touched, so the
 * whole module runs in plain Node and can be unit tested without a browser,
 * and the same code runs unchanged inside a Web Worker. Turning a result back
 * into real pixels is the caller's job.
 *
 * Every helper that can divide is guarded. A curve with no points, a curve
 * with one point and a curve whose points all sit at the same level are all
 * things a panel can hand this module, because a panel can add points, remove
 * points and move them onto each other, and none of them may produce a NaN.
 *
 * @typedef {{x: number, y: number, id?: string}} CurvePoint  0..255, both axes
 * @typedef {"R" | "G" | "B"} Channel
 * @typedef {"round" | "oval"} VignetteShape
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 * @typedef {Record<Channel, CurvePoint[]>} Curves
 *
 * @typedef {object} LomoOptions
 * @property {Curves} [curves]       one list of control points per channel
 * @property {number} [saturation]    1 leaves saturation alone, 2 doubles it
 * @property {number} [warmth]        levels to add to red and take off blue
 * @property {number} [intensity]     0..1, how much of the result is mixed in
 * @property {number} [vignette]      0..1, how far the corners are darkened
 * @property {VignetteShape} [shape]  how the vignette is cut
 */

import { clamp01, clampChannel } from "./pixels.js";

/** How many entries a sampled curve has, one per possible level. */
export const CURVE_STEPS = 256;

/**
 * The fewest control points a channel can hold.
 *
 * Two is what makes a pair of points a curve rather than a spot on it. Below
 * two the panel refuses a removal, because there is nothing left to shape.
 */
export const MIN_CURVE_POINTS = 2;

/**
 * The channels, in the order the panel offers them.
 *
 * The colours are the ones the legacy curve editor drew with. They are the
 * channel hues rather than the panel's accent, because a curve is identified
 * by which channel it is when the three cross.
 */
export const CHANNELS = [
  { value: "R", label: "Red", colour: "#ff4444" },
  { value: "G", label: "Green", colour: "#44ff44" },
  { value: "B", label: "Blue", colour: "#4488ff" },
];

/** How the vignette is cut. Two shapes, matching the legacy pair. */
export const VIGNETTE_SHAPES = [
  { value: "round", label: "Round" },
  { value: "oval", label: "Oval" },
];

/**
 * Starting looks.
 *
 * The legacy set, unchanged, curves and all. Each one is a complete look rather
 * than the settings that happen to differ, so a preset can be read against the
 * panel above it and matched exactly.
 *
 * Nothing here claims to be a particular film or a particular camera. These
 * are the shapes a cross-processed slide takes, named for the look rather than
 * for the stock that is not being emulated.
 */
export const LOOKS = [
  {
    name: "Classic Lomo",
    curves: {
      R: [{ x: 0, y: 0 }, { x: 128, y: 148 }, { x: 255, y: 235 }],
      G: [{ x: 0, y: 10 }, { x: 128, y: 130 }, { x: 255, y: 220 }],
      B: [{ x: 0, y: 30 }, { x: 128, y: 110 }, { x: 255, y: 200 }],
    },
    saturation: 1.6,
    vignette: 0.7,
    warmth: 15,
  },
  {
    name: "Cross process",
    curves: {
      R: [{ x: 0, y: 0 }, { x: 64, y: 100 }, { x: 255, y: 255 }],
      G: [{ x: 0, y: 20 }, { x: 128, y: 160 }, { x: 255, y: 230 }],
      B: [{ x: 0, y: 40 }, { x: 128, y: 80 }, { x: 255, y: 255 }],
    },
    saturation: 1.8,
    vignette: 0.4,
    warmth: -10,
  },
  {
    name: "Faded film",
    curves: {
      R: [{ x: 0, y: 40 }, { x: 255, y: 220 }],
      G: [{ x: 0, y: 35 }, { x: 255, y: 215 }],
      B: [{ x: 0, y: 50 }, { x: 255, y: 200 }],
    },
    saturation: 0.85,
    vignette: 0.5,
    warmth: 5,
  },
  {
    name: "Velvia slide",
    curves: {
      R: [{ x: 0, y: 0 }, { x: 128, y: 145 }, { x: 255, y: 255 }],
      G: [{ x: 0, y: 0 }, { x: 128, y: 140 }, { x: 255, y: 255 }],
      B: [{ x: 0, y: 0 }, { x: 128, y: 120 }, { x: 255, y: 255 }],
    },
    saturation: 2.2,
    vignette: 0.3,
    warmth: 20,
  },
  {
    name: "Cyberpunk cross",
    curves: {
      R: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 255 }, { x: 255, y: 255 }],
      G: [{ x: 0, y: 20 }, { x: 128, y: 200 }, { x: 255, y: 230 }],
      B: [{ x: 0, y: 80 }, { x: 128, y: 200 }, { x: 255, y: 255 }],
    },
    saturation: 2.5,
    vignette: 0.8,
    warmth: -30,
  },
];

/**
 * What a panel starts on, in the units a panel uses.
 *
 * Sliders run 0..100 and the arithmetic runs 0..1, so only intensity and the
 * saturation multiples need converting on the way in. The curves come from the
 * first look, so the panel and the chip above it agree on what is loaded.
 */
export const LOMO_DEFAULTS = {
  curves: LOOKS[0].curves,
  saturation: 160,
  vignette: 70,
  warmth: 15,
  intensity: 100,
  shape: "round",
  channel: "R",
};

/** A copy of the default curves, so a caller can edit them in place. */
export function defaultCurves() {
  return {
    R: LOOKS[0].curves.R.map((point) => ({ ...point })),
    G: LOOKS[0].curves.G.map((point) => ({ ...point })),
    B: LOOKS[0].curves.B.map((point) => ({ ...point })),
  };
}

// ---------------------------------------------------------------------------
// Control points
// ---------------------------------------------------------------------------

/**
 * One level, 0..255, with anything unreadable read as 0.
 *
 * A single NaN in a control list would otherwise sort a curve into a nonsense
 * order and take the whole lookup with it, and a NaN in a coordinate divides
 * every tangent below it into NaN as well.
 *
 * @param {unknown} value
 * @returns {number} an integer, 0..255
 */
function cleanLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(clampChannel(n));
}

/**
 * The points, in ascending order, with duplicates dropped.
 *
 * A copy, always, so a panel can hold its points in component state and hand
 * them here to be read without risking a sort that fires the reactivity it was
 * meant to read.
 *
 * Two points at the same level would make a segment of zero width, and the
 * spline below divides by the width of every segment. The later point wins,
 * because that is the one the operator moved there.
 *
 * @param {CurvePoint[]} [points]
 * @returns {CurvePoint[]} ascending by x, strictly increasing
 */
export function normalizeCurve(points) {
  const list = (Array.isArray(points) ? points : [])
    .map((point) => ({ x: cleanLevel(point?.x), y: cleanLevel(point?.y) }))
    .sort((a, b) => a.x - b.x);

  const out = [];
  for (const point of list) {
    if (out.length && out[out.length - 1].x === point.x) out[out.length - 1] = point;
    else out.push(point);
  }
  return out;
}

/**
 * The points with the two ends of the range pinned on.
 *
 * The endpoints are part of what a tone curve means rather than part of what
 * the operator placed, so they are added here and never counted against
 * `MIN_CURVE_POINTS`. Adding them is also what makes a curve of one point, or
 * of no points at all, safe: the result always has at least two positions, so
 * no segment is ever of zero width.
 *
 * @param {CurvePoint[]} [points]
 * @returns {CurvePoint[]} ascending by x, always spanning 0..255
 */
export function curveEndpoints(points) {
  const out = normalizeCurve(points);
  if (!out.length || out[0].x > 0) out.unshift({ x: 0, y: 0 });
  const last = out[out.length - 1];
  if (last.x < CURVE_STEPS - 1) out.push({ x: CURVE_STEPS - 1, y: CURVE_STEPS - 1 });
  return out;
}

/**
 * A curve as a table of 256 levels.
 *
 * This is the whole point of sampling: a pixel then costs one index per
 * channel instead of a search through the control points, and the table is
 * built once per control change rather than once per pixel.
 *
 * The result is always finite and always 0..255. A curve that cannot be read
 * as a curve, because it has no points or because every point sits at the same
 * level, comes back as the identity rather than as a table of NaN.
 *
 * @param {CurvePoint[]} [points]
 * @returns {Uint8Array} 256 entries
 */
export function buildCurveLut(points) {
  return buildCurveLutFor(curveEndpoints(points));
}

/**
 * A table from points that already have their endpoints on.
 *
 * Split out so the panel can ask for the table of a curve it has already
 * prepared, rather than paying for the sort and the padding twice.
 *
 * @param {CurvePoint[]} prepared ascending, from `curveEndpoints`
 * @returns {Uint8Array} 256 entries
 */
export function buildCurveLutFor(prepared) {
  const lut = new Uint8Array(CURVE_STEPS);
  const identity = () => {
    for (let i = 0; i < CURVE_STEPS; i++) lut[i] = i;
    return lut;
  };

  const pts = Array.isArray(prepared) ? prepared : [];
  // Fewer than two positions is not a curve. There is no direction to
  // interpolate between, so the honest answer is that nothing is changed.
  if (pts.length < 2) return identity();

  const n = pts.length;
  const dx = new Float64Array(n - 1);
  const dy = new Float64Array(n - 1);
  const slopes = new Float64Array(n - 1);

  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    // The width is never zero here, because duplicates were dropped, but the
    // guard costs nothing and keeps the caller honest if that ever changes.
    slopes[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }

  const tangents = new Float64Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];

  for (let i = 1; i < n - 1; i++) {
    // A change of direction puts a flat spot at the top of the change, which
    // is what stops the spline from overshooting and folding back.
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangents[i] = (w1 + w2) / (w1 / slopes[i - 1] + w2 / slopes[i]);
    }
  }

  let seg = 0;
  for (let i = 0; i < CURVE_STEPS; i++) {
    while (seg < n - 2 && pts[seg + 1].x < i) seg++;

    const x0 = pts[seg].x;
    const x1 = pts[seg + 1].x;
    const y0 = pts[seg].y;
    const y1 = pts[seg + 1].y;
    const m0 = tangents[seg];
    const m1 = tangents[seg + 1];

    if (x1 === x0) {
      lut[i] = clampChannel(Math.round(y1));
      continue;
    }

    const t = (i - x0) / (x1 - x0);
    const t2 = t * t;
    const t3 = t2 * t;

    // The Hermite basis, so the curve passes through both of its points.
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const value = h00 * y0 + h10 * (x1 - x0) * m0 + h01 * y1 + h11 * (x1 - x0) * m1;
    // Rounded, because that is the resolution the table is built at, and
    // checked, because a floating point weighted sum can land a hair outside
    // the range on a pure white point.
    lut[i] = Number.isFinite(value) ? clampChannel(Math.round(value)) : i;
  }

  return lut;
}

/**
 * The level the curve gives one input level.
 *
 * @param {Uint8Array} lut from `buildCurveLut`
 * @param {number} level 0..255
 * @returns {number} 0..255
 */
export function curveLevel(lut, level) {
  const i = clampChannel(Math.round(Number(level) || 0));
  const value = lut?.[i];
  return Number.isFinite(value) ? value : i;
}

/**
 * Where a new point would go, and what it would be.
 *
 * The widest gap between two existing points, at its middle, at whatever level
 * the curve already passes through there. Adding a point there leaves the
 * curve looking exactly as it did, which matters because a point that appears
 * with a level the curve does not already have silently reshapes the tone.
 *
 * @param {CurvePoint[]} [points]
 * @returns {{x: number, y: number}} 0..255 on both axes, x unused by an existing point
 */
export function curveInsertionPoint(points) {
  const pts = curveEndpoints(points);
  const lut = buildCurveLutFor(pts);

  let widest = -1;
  let at = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const gap = pts[i + 1].x - pts[i].x;
    if (gap > widest) {
      widest = gap;
      at = i;
    }
  }

  // No points at all, or a curve already at every level: there is no gap to
  // aim at, so the middle is as good an answer as any.
  let x = Math.round((pts[at].x + pts[at + 1].x) / 2);
  if (!Number.isFinite(x)) x = Math.round((CURVE_STEPS - 1) / 2);

  // A new point on top of an existing one would be dropped by `normalizeCurve`,
  // and the operator would watch it vanish. Step off the collision instead.
  const taken = new Set(pts.map((point) => point.x));
  if (taken.has(x)) {
    for (let step = 1; step < CURVE_STEPS; step++) {
      if (!taken.has(clampChannel(x + step))) {
        x = clampChannel(x + step);
        break;
      }
      if (!taken.has(clampChannel(x - step))) {
        x = clampChannel(x - step);
        break;
      }
    }
  }

  return { x, y: curveLevel(lut, x) };
}

/**
 * The table as a path, for drawing the curve.
 *
 * Pure string building, so it can be checked in Node: every coordinate in the
 * result is a finite number, which is the one way a path can fail to render at
 * all.
 *
 * @param {Uint8Array} lut from `buildCurveLut`
 * @param {number} [samples] how many points to draw the curve through
 * @returns {string} an SVG path `d` attribute in a 0..256 view box
 */
export function curvePath(lut, samples = 64) {
  const count = Math.max(2, Math.min(CURVE_STEPS, Math.round(samples)));
  const parts = [];

  for (let s = 0; s < count; s++) {
    const i = Math.round((s / (count - 1)) * (CURVE_STEPS - 1));
    const x = (i / (CURVE_STEPS - 1)) * 256;
    const y = 256 - (curveLevel(lut, i) / (CURVE_STEPS - 1)) * 256;
    parts.push(`${s === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Saturation, warmth and the vignette
// ---------------------------------------------------------------------------

/**
 * Red, green and blue pushed apart or pulled together, leaving hue and
 * lightness where they were.
 *
 * At 1 this returns the input unchanged, which is what makes a panel that
 * sits on 100 % a no-op rather than a very slightly different picture.
 *
 * @param {number} r 0..255
 * @param {number} g 0..255
 * @param {number} b 0..255
 * @param {number} factor 1 is unchanged
 * @param {number[]} out three slots
 * @returns {number[]} `out`
 */
export function saturatePixel(r, g, b, factor, out) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  // A grey pixel has no saturation to change, so there is nothing to do and no
  // hue to divide by.
  if (max === min || factor === 1) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;

  const s2 = Math.min(1, s * factor);
  const q = l < 0.5 ? l * (1 + s2) : l + s2 - l * s2;
  const p = 2 * l - q;

  const hue2rgb = (t) => {
    let u = t;
    if (u < 0) u += 1;
    if (u > 1) u -= 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };

  out[0] = clampChannel(Math.round(hue2rgb(h + 1 / 3) * 255));
  out[1] = clampChannel(Math.round(hue2rgb(h) * 255));
  out[2] = clampChannel(Math.round(hue2rgb(h - 1 / 3) * 255));
  return out;
}

/**
 * Red and blue pulled apart.
 *
 * Positive warmth is warmer: red goes up and blue goes down by the same amount.
 * At 0 the three channels are returned exactly as they arrived, which is what
 * makes the middle of the slider a true neutral rather than a very slightly
 * green picture.
 *
 * @param {number} r 0..255
 * @param {number} g 0..255
 * @param {number} b 0..255
 * @param {number} levels how far to move red and blue, in levels
 * @param {number[]} out three slots
 * @returns {number[]} `out`
 */
export function warmthShift(r, g, b, levels, out) {
  const shift = Number.isFinite(levels) ? levels : 0;
  out[0] = shift === 0 ? r : clampChannel(Math.round(r + shift));
  out[1] = g;
  out[2] = shift === 0 ? b : clampChannel(Math.round(b - shift));
  return out;
}

/**
 * The measurements a vignette needs about a frame.
 *
 * @param {number} width
 * @param {number} height
 * @returns {{cx: number, cy: number, corner: number}}
 */
export function vignetteGeometry(width, height) {
  const cx = Math.max(1e-6, width / 2);
  const cy = Math.max(1e-6, height / 2);
  return { cx, cy, corner: Math.sqrt(cx * cx + cy * cy) };
}

/**
 * The darkening at one point, as a multiplier for the three channels.
 *
 * `t` is the distance from the centre as a fraction of the way to the edge, and
 * the ramp through it is the legacy three stop gradient: clear through the
 * inner third, 0.3 of the strength at the half way, and the full strength at
 * the edge. A square shape reaches that at the mid point of an edge, a round
 * one at a corner.
 *
 * At a strength of 0 the multiplier is exactly 1, so a panel sitting on 0 %
 * costs one comparison and changes nothing at all.
 *
 * @param {number} dx offset from the centre in x
 * @param {number} dy offset from the centre in y
 * @param {{cx: number, cy: number, corner: number}} size from `vignetteGeometry`
 * @param {number} strength 0..1
 * @param {VignetteShape} [shape]
 * @returns {number} a multiplier, 0..1
 */
export function vignetteFalloff(dx, dy, size, strength, shape = "round") {
  if (!(strength > 0)) return 1;

  const { cx, cy, corner } = size ?? { cx: 1e-6, cy: 1e-6, corner: 1e-6 };
  if (!(corner > 0) || !(cx > 0) || !(cy > 0)) return 1;

  // The legacy draw scaled the canvas rather than the radius, so the two
  // shapes are the same falloff with different normalisations: an oval
  // measures each axis against its own half size.
  const t =
    shape === "oval"
      ? Math.min(1, Math.sqrt((dx / cx) ** 2 + (dy / cy) ** 2))
      : Math.min(1, Math.sqrt(dx * dx + dy * dy) / corner);

  const amount = Math.min(1, strength);
  const alpha = t <= 0.5 ? amount * 0.6 * t : amount * (0.3 + 1.4 * (t - 0.5));
  return 1 - clamp01(alpha);
}

/**
 * One pixel of a lomo image.
 *
 * The order is the order the pieces are named in and the order a colourist
 * works in: the curve sets the tone, saturation sets the strength of the
 * colour, warmth sets the balance, and the intensity decides how much of the
 * result reaches the photograph at all. Alpha is never touched: it is the shape
 * of the picture, not part of its tone, so a cut-out PNG keeps the transparency
 * it arrived with.
 *
 * @param {number} r 0..255, the original
 * @param {number} g 0..255, the original
 * @param {number} b 0..255, the original
 * @param {Uint8Array} lutR
 * @param {Uint8Array} lutG
 * @param {Uint8Array} lutB
 * @param {number} saturation 1 is unchanged
 * @param {number} warmth in levels
 * @param {number} intensity 0..1, how much of the result is mixed in
 * @param {number[]} scratch three slots, reused by every pixel
 * @param {number[]} out three slots
 * @returns {number[]} `out`
 */
export function lomoPixel(r, g, b, lutR, lutG, lutB, saturation, warmth, intensity, scratch, out) {
  saturatePixel(curveLevel(lutR, r), curveLevel(lutG, g), curveLevel(lutB, b), saturation, scratch);
  warmthShift(scratch[0], scratch[1], scratch[2], warmth, scratch);

  const amount = clamp01(intensity);
  if (amount === 0) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
  } else if (amount === 1) {
    out[0] = scratch[0];
    out[1] = scratch[1];
    out[2] = scratch[2];
  } else {
    out[0] = clampChannel(Math.round(r + amount * (scratch[0] - r)));
    out[1] = clampChannel(Math.round(g + amount * (scratch[1] - g)));
    out[2] = clampChannel(Math.round(b + amount * (scratch[2] - b)));
  }

  return out;
}

/**
 * The whole frame, emulated.
 *
 * Always a new buffer, and always finite: the output is a `Uint8ClampedArray`,
 * so a channel cannot land outside 0..255 however the arithmetic above behaved
 * on the way there.
 *
 * The vignette is applied here rather than composited on a canvas afterwards,
 * because a per-pixel multiply on the last pass is the same arithmetic as a
 * multiply blend and it is the only version of it that can run in the worker.
 *
 * @param {Pixels} pixels
 * @param {LomoOptions} [options]
 * @returns {Pixels}
 */
export function applyLomo(pixels, options = {}) {
  const {
    curves = LOOKS[0].curves,
    saturation = 1,
    warmth = 0,
    intensity = 1,
    vignette = 0,
    shape = "round",
  } = options;

  const lutR = buildCurveLut(curves?.R);
  const lutG = buildCurveLut(curves?.G);
  const lutB = buildCurveLut(curves?.B);
  const sat = Number.isFinite(saturation) ? Math.max(0, saturation) : 1;
  const amount = clamp01(Number.isFinite(intensity) ? intensity : 1);
  const dark = clamp01(Number.isFinite(vignette) ? vignette : 0);

  const { width, height, data } = pixels;
  const out = new Uint8ClampedArray(data.length);
  const scratch = [0, 0, 0];
  const rgb = [0, 0, 0];
  const size = vignetteGeometry(width, height);

  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - size.cy;

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      lomoPixel(data[i], data[i + 1], data[i + 2], lutR, lutG, lutB, sat, warmth, amount, scratch, rgb);

      // One comparison for the whole frame, not one per pixel: at 0 % the
      // multiplier is exactly 1 and the multiply is skipped entirely.
      if (dark > 0) {
        const fall = vignetteFalloff(x + 0.5 - size.cx, dy, size, dark, shape);
        rgb[0] = clampChannel(Math.round(rgb[0] * fall));
        rgb[1] = clampChannel(Math.round(rgb[1] * fall));
        rgb[2] = clampChannel(Math.round(rgb[2] * fall));
      }

      out[i] = rgb[0];
      out[i + 1] = rgb[1];
      out[i + 2] = rgb[2];
      out[i + 3] = data[i + 3];
    }
  }

  return { width, height, data: out };
}
