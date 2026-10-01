/**
 * Watermark geometry.
 *
 * Deliberately free of runes, of the DOM and of canvas: everything here takes
 * numbers and returns numbers. That is what makes placement testable in plain
 * Node, and it keeps `WatermarkTool.svelte` down to the canvas calls.
 *
 * Every box is a top-left origin with a width and a height, in image pixels.
 * The one thing this module does not know is how big a mark is: that needs a
 * font or a decoded logo, so the caller measures it (or uses `textBox`) and
 * passes the result in.
 */

/**
 * The nine anchors, in the order a three by three grid reads them.
 *
 * The ratios are how the mark sits *inside* the safe band, not where the band
 * is: 0 means flush to the near edge, 0.5 centred, 1 flush to the far edge.
 * The margin then insets the band, which is why "top left" means a mark that
 * starts margin pixels in from the corner rather than one pinned to it.
 */
export const POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const RATIOS = {
  "top-left": { x: 0, y: 0 },
  "top-center": { x: 0.5, y: 0 },
  "top-right": { x: 1, y: 0 },
  "middle-left": { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  "middle-right": { x: 1, y: 0.5 },
  "bottom-left": { x: 0, y: 1 },
  "bottom-center": { x: 0.5, y: 1 },
  "bottom-right": { x: 1, y: 1 },
};

/**
 * Below this a tile grid stops being a look and becomes a hang: a pitch of 4
 * on a 4000px frame is a million draws.
 */
export const MIN_TILE_PITCH = 8;

/** Hard stop on the grid, so a tiny pitch degrades to a sparse one, not a freeze. */
export const MAX_TILE_ORIGINS = 4096;

/** Average glyph advance as a fraction of the em, for the unmeasured fallback. */
const AVERAGE_GLYPH = 0.55;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** The anchor's ratios. Anything unknown is treated as the centre. */
export function anchorRatios(position) {
  return RATIOS[position] ?? RATIOS.center;
}

/**
 * The safe inset a margin percentage asks for, in pixels per axis.
 *
 * Clamped twice, and both clamps matter. The first keeps a silly percentage
 * from pushing a mark off the far side; the second keeps the band from
 * inverting on a small image, where two margins can be wider than the frame.
 */
export function safeInset(margin, width, height) {
  const pct = clamp(Number(margin) || 0, 0, 50) / 100;
  return {
    x: Math.min(pct * width, width / 2),
    y: Math.min(pct * height, height / 2),
  };
}

/** Shrink a size to fit a box, keeping its aspect. Never grows. */
export function containSize(mark, box) {
  if (!(mark.w > 0) || !(mark.h > 0)) {
    return { w: Math.max(0, mark.w), h: Math.max(0, mark.h) };
  }
  const k = Math.min(1, box.w / mark.w, box.h / mark.h);
  return { w: mark.w * k, h: mark.h * k };
}

/** A natural size scaled by a percentage. `imageScale` is a share, not a factor. */
export function scaleSize(size, percent) {
  const k = Math.max(0, Number(percent) || 0) / 100;
  return { w: size.w * k, h: size.h * k };
}

/**
 * Where a mark of a known size lands.
 *
 * Anchored inside the margin band, nudged by the fine tune offsets, then
 * clamped to the frame. The final clamp is to the frame rather than to the
 * band, because an explicit offset is a request to override the margin.
 *
 * A mark bigger than the frame is scaled down to fit instead of being drawn
 * half off the edge: a smaller watermark is a smaller watermark, whereas half
 * a watermark looks like a bug.
 *
 * @param {{position?: string, margin?: number, offsetX?: number, offsetY?: number}} options
 * @param {{w: number, h: number}} mark   the mark at its natural size
 * @param {{width: number, height: number}} frame
 * @returns {{x: number, y: number, w: number, h: number}} top-left origin
 */
export function placeMark(options, mark, frame) {
  const { position, margin = 0, offsetX = 0, offsetY = 0 } = options;
  const ratio = anchorRatios(position);
  const inset = safeInset(margin, frame.width, frame.height);

  const fitted = containSize(mark, { w: frame.width, h: frame.height });
  const bandW = Math.max(0, frame.width - inset.x * 2);
  const bandH = Math.max(0, frame.height - inset.y * 2);

  const x = inset.x + (bandW - fitted.w) * ratio.x + offsetX;
  const y = inset.y + (bandH - fitted.h) * ratio.y + offsetY;

  return {
    x: clamp(x, 0, Math.max(0, frame.width - fitted.w)),
    y: clamp(y, 0, Math.max(0, frame.height - fitted.h)),
    w: fitted.w,
    h: fitted.h,
  };
}

/** The distance between tile origins: the tile plus the gap after it. */
export function tilePitch(tileSize, gap) {
  const pitch = (Number(tileSize) || 0) + (Number(gap) || 0);
  return pitch > MIN_TILE_PITCH ? pitch : MIN_TILE_PITCH;
}

/**
 * Every cell origin needed to cover a frame, on the pitch grid.
 *
 * One cell of bleed past each edge, because a mark is drawn about its own
 * centre and rotating it swings corners outside the box it was placed in. Every
 * origin is `-pitch` plus a whole number of pitches on both axes, so a mark
 * repeated on this grid sits exactly one pitch from its neighbours and the
 * pattern cannot drift.
 */
export function tileOrigins(pitch, width, height) {
  const step = Math.max(1, Number(pitch) || 0);
  const out = [];

  for (let y = -step; y < height && out.length < MAX_TILE_ORIGINS; y += step) {
    for (let x = -step; x < width && out.length < MAX_TILE_ORIGINS; x += step) {
      out.push({ x, y });
    }
  }
  return out;
}

/** Average glyph advance, for when there is no canvas to measure with. */
export function estimateTextWidth(text, fontSize) {
  const str = String(text ?? "");
  if (!str) return 0;
  return str.length * Math.max(0, Number(fontSize) || 0) * AVERAGE_GLYPH;
}

/**
 * The box a run of text occupies.
 *
 * `measure` is an optional width measurement, normally
 * `ctx.measureText(t).width` with the font already set. Without it the width
 * falls back to an estimate: a mark that is a little too wide is cosmetic,
 * whereas throwing the text away is not.
 */
export function textBox(text, fontSize, measure) {
  const size = Math.max(0, Number(fontSize) || 0);
  const str = String(text ?? "");
  // An empty run is zero wide whatever a measurement says, and a mark with no
  // width would collapse its tile cell in a way nothing else can undo.
  if (str.trim() === "") return { w: 0, h: size };
  const measured = measure ? Number(measure(str)) : NaN;
  return {
    w: Number.isFinite(measured) ? Math.max(0, measured) : estimateTextWidth(str, size),
    h: size,
  };
}

/** A canvas font shorthand. The style and weight are always spelled out. */
export function fontStack(family, { bold = false, italic = false } = {}, fontSize = 16) {
  return `${italic ? "italic" : "normal"} ${bold ? "bold" : "normal"} ${fontSize}px ${family}`;
}

/**
 * Starting sizes for a given frame width.
 *
 * A watermark is sized against the picture, not in absolute pixels: the same
 * 48px caption is invisible on a 6000px photo and a slab on a thumbnail.
 */
export function autoSizes(frameWidth) {
  const width = Math.max(1, Number(frameWidth) || 1);
  return {
    fontSize: Math.max(12, Math.round(width * 0.025)),
    imageScale: 15,
    tileSize: Math.max(150, Math.round(width * 0.18)),
  };
}
