/**
 * Pattern fill maths.
 *
 * Text filled with a repeating pattern is three decisions and nothing else:
 * which mark repeats, how big a cell it repeats on, and which way round it
 * sits. This module owns those decisions as numbers and hands the rest of the
 * tool a tile.
 *
 * One tile definition, two renderers. The stage layer paints the tile as an
 * inline SVG `<pattern>` and lets the SVG clip it to real `<text>` outlines;
 * the commit canvas paints the same tile into a small canvas and hands it to
 * `createPattern`, which clips it to real glyph outlines. Both walk the
 * `tileShapes` list below, in the same order, with the same numbers, so the
 * preview and the committed pixels are the same drawing rather than two
 * drawings that resemble each other.
 *
 * Free of runes, of the DOM and of canvas: everything here takes numbers and
 * returns numbers. That is what lets `tests/patternfill.test.js` check the
 * degenerate cases (a scale of zero, a rotation of 450 degrees, an unknown
 * kind, a coordinate of NaN) without a browser.
 *
 * Every length is in image pixels, so nothing here knows what the stage
 * happens to be zoomed to.
 */

import { clamp } from "./stroketext.js";
import { normalizeHex } from "./duotonemath.js";

const DEG = Math.PI / 180;

/**
 * The marks on offer.
 *
 * Each is authored inside a square cell and repeated by tiling, so one number
 * describes the size of every one of them. Four is enough to read as a choice:
 * more patterns with the same single scale control would be near duplicates.
 */
export const PATTERN_KINDS = [
  { value: "stripes", label: "Stripes" },
  { value: "checks", label: "Checks" },
  { value: "dots", label: "Dots" },
  { value: "grid", label: "Grid" },
];

/** What an unreadable or missing kind falls back to. */
export const DEFAULT_PATTERN = "stripes";

/** Scale bounds, as a multiple of the base cell. */
export const MIN_PATTERN_SCALE = 0.1;
export const MAX_PATTERN_SCALE = 4;

/** The cell side in image pixels at a scale of 1. */
export const BASE_CELL = 24;

/**
 * The floor on the cell side, in image pixels.
 *
 * A cell is what a renderer is asked to tile, so a cell of zero pixels is not a
 * pattern, it is a divide by zero waiting to happen. The cell never goes below
 * this however small the scale is, and two image pixels is the smallest tile
 * that still draws a mark at all.
 */
export const MIN_PATTERN_CELL = 2;

/**
 * Under this cell the marks stop reading as marks.
 *
 * Below about six image pixels the ink and the gap beside it are the same
 * width as a screen pixel, so the fill reads as a flat tone whatever was
 * asked for. The panel says so rather than silently refusing the setting, and
 * the setting is still honoured.
 */
export const VISIBLE_CELL = 6;

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Anything unreadable becomes a plain zero, so one bad value cannot poison a whole tile. */
const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** `0`, never `-0`, so the numbers in a matrix string stay clean. */
const flat = (n) => (n === 0 ? 0 : n);

/**
 * A modulo that always lands in `0..n`.
 *
 * JavaScript's `%` keeps the sign of the dividend, so `-1 % 24` is `-1`. Every
 * pattern here wraps its coordinates into the cell with this, which is what
 * makes the pattern periodic across the origin as well as to the right of it.
 */
function wrap(value, period) {
  const p = Math.abs(num(period));
  if (p === 0) return 0;
  const r = num(value) % p;
  return r < 0 ? r + p : r;
}

/**
 * A scale inside the range the tool offers.
 *
 * The floor is a real value and not a rounding error: a scale of zero would ask
 * a renderer for a tile of no size at all, so it lands on `MIN_PATTERN_SCALE`
 * and the pattern comes out as fine as the tool will draw it.
 *
 * Anything that is not a finite number, including the empty string an empty
 * number field produces and an `Infinity` a division left behind, becomes 1.
 * That is the size the pattern is authored at, and it is a size a renderer can
 * draw; the alternative, letting an infinity through to become an infinite
 * period, is a solid block with no pattern in it.
 */
export function clampPatternScale(scale) {
  const n = Number(scale);
  if (!Number.isFinite(n)) return 1;
  return clamp(n, MIN_PATTERN_SCALE, MAX_PATTERN_SCALE);
}

/**
 * A rotation in `0..360`.
 *
 * Unlike the tool's own text angle there is nothing to preserve here: a
 * pattern turned 450 degrees is a pattern turned 90 degrees, and a pattern
 * turned -30 degrees is the same pattern turned 330. Wrapping rather than
 * clamping means the whole turn is reachable from any starting point.
 */
export function normalizePatternAngle(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  return flat(((n % 360) + 360) % 360);
}

/**
 * The cell side in image pixels, as a whole number.
 *
 * Whole on purpose. Both renderers size their tile from this one number, and a
 * tile of 23.7 pixels would be 24 pixels of canvas and a 23.7 unit pattern
 * box, which is a visible seam rather than a rounding difference.
 */
export function patternCell(scale) {
  const cell = Math.round(BASE_CELL * clampPatternScale(scale));
  return Math.max(MIN_PATTERN_CELL, cell);
}

/** Whether a cell is too fine to read as a pattern at this size. */
export function isTooFine(cell) {
  return num(cell) < VISIBLE_CELL;
}

/**
 * A normalised pattern definition.
 *
 * Idempotent, because both renderers normalise and neither knows whether it
 * was handed a store value or an already normalised definition: an explicit
 * `cell` is passed straight through, a `scale` becomes one.
 *
 * Every field is safe. An unknown kind becomes the default pattern, an
 * unreadable colour becomes black, and a scale of zero becomes the smallest
 * cell the tool will draw. Nothing here can return `NaN`.
 */
export function patternDef(input) {
  const source = input && typeof input === "object" ? input : {};
  const kind = PATTERN_KINDS.some((option) => option.value === source.kind)
    ? /** @type {string} */ (source.kind)
    : DEFAULT_PATTERN;

  const given = Number(source.cell);
  const cell =
    Number.isFinite(given) && given > 0
      ? Math.max(MIN_PATTERN_CELL, Math.round(given))
      : patternCell(source.scale);

  return {
    kind,
    cell,
    angleDeg: normalizePatternAngle(source.angleDeg),
    color: normalizeHex(source.color),
  };
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * The line width of the grid mark, as a fraction of the cell.
 *
 * Proportional so the grid keeps its look at any scale, with a floor of one
 * pixel so it never thins away to nothing at the smallest cell.
 */
function gridLine(cell) {
  return Math.max(1, Math.round(cell / 12));
}

/**
 * Whether a point falls on ink, for one pattern kind and one cell size.
 *
 * Total by construction: any input at all, including `NaN`, `Infinity`,
 * strings and coordinates far outside the image, returns 0 or 1. The grid mark
 * is the reason this matters, because it divides the coordinate by the cell
 * and a coordinate that is not a number would otherwise return `NaN` and
 * compare false in a way that depends on which direction the test ran.
 *
 * @returns {number} 1 for ink, 0 for the gap
 */
export function patternSample(kind, x, y, cell) {
  const size = Math.max(MIN_PATTERN_CELL, num(cell));
  const px = finite(x);
  const py = finite(y);

  if (kind === "stripes") {
    return wrap(px, size) < size / 2 ? 1 : 0;
  }

  if (kind === "checks") {
    const half = size / 2;
    const col = wrap(Math.floor(finite(px) / half), 2);
    const row = wrap(Math.floor(finite(py) / half), 2);
    return (col + row) % 2 === 0 ? 1 : 0;
  }

  if (kind === "dots") {
    const dx = wrap(px, size) - size / 2;
    const dy = wrap(py, size) - size / 2;
    return dx * dx + dy * dy <= (size / 4) ** 2 ? 1 : 0;
  }

  if (kind === "grid") {
    // The line sits at the low corner of the cell, exactly where `tileShapes`
    // puts it, so the sampled field and the drawn tile are the same tile. The
    // neighbouring cell draws its own line at its own low corner, which is
    // this cell's high one, so the marks meet and the grid reads as lines.
    const line = gridLine(size);
    return wrap(px, size) < line || wrap(py, size) < line ? 1 : 0;
  }

  // An unknown kind is the safe answer, not a throw: nothing is drawn, which
  // is what an empty pattern definition means.
  return 0;
}

/**
 * The ink at an image coordinate, with the pattern's rotation applied.
 *
 * The coordinate is taken back into the pattern's own frame before it is
 * tested, which is what makes the rotation a property of the tile rather than
 * a property of the shape drawn with it. That is the same relationship SVG's
 * `patternTransform` and the canvas's `CanvasPattern.setTransform` describe,
 * so the two renderers sample the same field.
 *
 * With the rotation at 0 the pattern is periodic with exactly the cell along
 * each axis, which is the property the tile is built on.
 *
 * @param {object} def a raw or normalised pattern definition
 * @returns {number} 1 for ink, 0 for the gap
 */
export function sampleAt(def, x, y) {
  const d = patternDef(def);
  const angle = d.angleDeg * DEG;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const px = finite(x);
  const py = finite(y);

  return patternSample(d.kind, px * cos + py * sin, py * cos - px * sin, d.cell);
}

// ---------------------------------------------------------------------------
// The tile
// ---------------------------------------------------------------------------

/**
 * @typedef {{kind: "rect", x: number, y: number, w: number, h: number}
 *          | {kind: "circle", cx: number, cy: number, r: number}} TileShape
 */

/**
 * The ink in one cell, in cell coordinates, in drawing order.
 *
 * This is the single description of every mark, and it is what keeps the two
 * renderers honest: the stage layer turns each shape into one SVG `<rect>` or
 * `<circle>` and the commit canvas turns the same list into one `fillRect` or
 * `arc`. There are no strokes, so there is no line width for the two to
 * disagree about, and every shape is inside `0..cell` on both axes, so a tile
 * has no half drawn mark to wrap badly.
 *
 * Marks are drawn as ink only. The gap between them is left alone, so the
 * photograph shows through the fill rather than being covered by a second
 * colour the operator did not ask for.
 *
 * @param {string} kind
 * @param {number} cell image pixels
 * @returns {TileShape[]} empty for an unknown kind, which draws no tile
 */
export function tileShapes(kind, cell) {
  const size = Math.max(MIN_PATTERN_CELL, num(cell));

  if (kind === "stripes") {
    // One band per cell: half ink, half gap, turned by the pattern rotation.
    return [{ kind: "rect", x: 0, y: 0, w: size / 2, h: size }];
  }

  if (kind === "checks") {
    const half = size / 2;
    return [
      { kind: "rect", x: 0, y: 0, w: half, h: half },
      { kind: "rect", x: half, y: half, w: half, h: half },
    ];
  }

  if (kind === "dots") {
    return [{ kind: "circle", cx: size / 2, cy: size / 2, r: size / 4 }];
  }

  if (kind === "grid") {
    // A cross on the cell corner, so the marks meet across tile edges and the
    // grid reads as continuous lines rather than as dashes.
    const line = gridLine(size);
    return [
      { kind: "rect", x: 0, y: 0, w: line, h: size },
      { kind: "rect", x: 0, y: 0, w: size, h: line },
    ];
  }

  return [];
}

/**
 * The pattern's own rotation as six matrix numbers.
 *
 * Separate from the text's placement on purpose, and the same shape
 * `rotationMatrix` returns, so a renderer can hand it straight to
 * `CanvasPattern.setTransform` (via `new DOMMatrix([...])`) and to SVG's
 * `patternTransform`. Identity at 0 degrees, so an unrotated pattern puts its
 * tile at the origin with nothing to undo.
 *
 * @returns {{a: number, b: number, c: number, d: number, e: number, f: number}}
 */
export function patternTransform(def) {
  const angle = patternDef(def).angleDeg * DEG;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    a: flat(cos),
    b: flat(sin),
    c: flat(-sin),
    d: flat(cos),
    e: 0,
    f: 0,
  };
}