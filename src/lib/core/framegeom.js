/**
 * Photo frame geometry.
 *
 * Deliberately free of runes, of the DOM and of canvas: everything here takes
 * numbers and returns numbers. That is what makes the frame testable in plain
 * Node, and it keeps the two components that draw a frame down to canvas calls.
 *
 * The one idea worth reading before the code: **a frame grows the picture**. A
 * border is added *around* the image, so the output is the input plus the sum
 * of the four edges. Nothing in this module ever takes space from the picture:
 * the picture keeps its own pixels at its natural size and lands at
 * `borders.left, borders.top` inside the result. The caption lives in the bottom
 * band, which is also frame, never picture.
 */

import { estimateTextWidth } from "./watermarklayout.js";

/**
 * Longest side the export may have.
 *
 * Matches `ResizeTool`'s own ceiling, so a picture cannot be framed into a
 * size that the resize tool would then refuse to produce.
 */
export const MAX_OUTPUT_SIDE = 16000;

/**
 * Ceiling on the whole output, in pixels.
 *
 * The side limit alone is not enough: a 16000 by 16000 canvas is 256 megapixels
 * and about a gigabyte of RGBA backing store, which a browser will either
 * refuse or thrash on. This is the number that actually protects the operator's
 * machine, and it is well under what a photograph needs.
 */
export const MAX_OUTPUT_PIXELS = 36_000_000;

/** Caption type never shrinks below this, however narrow the band is. */
export const MIN_CAPTION_SIZE = 8;

/** Breathing room either side of the caption, so it never kisses the edge. */
export const CAPTION_PADDING = 8;

/** Line box as a multiple of the type size. */
export const CAPTION_LINE_HEIGHT = 1.25;

/** Gap between the caption and the date line, in pixels. */
export const CAPTION_GAP = 3;

/** The date line's size as a fraction of the caption's. */
export const DATE_SIZE_RATIO = 0.75;

/** The four edges, in the order the panel lists them. */
export const EDGES = ["top", "right", "bottom", "left"];

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

/** A whole number of pixels, never negative, never NaN. */
export function cleanEdge(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** A whole number of pixels, never negative. Used for radii, blurs and offsets. */
export function cleanPixels(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** Four clean edges from anything, including a partial or hostile object. */
export function cleanBorders(borders) {
  return {
    top: cleanEdge(borders?.top),
    right: cleanEdge(borders?.right),
    bottom: cleanEdge(borders?.bottom),
    left: cleanEdge(borders?.left),
  };
}

/** The same width on all four edges. */
export function uniformBorders(size) {
  const n = cleanEdge(size);
  return { top: n, right: n, bottom: n, left: n };
}

/** How much room the frame takes, on both axes together. */
export function totalBorder(borders) {
  const b = cleanBorders(borders);
  return { width: b.left + b.right, height: b.top + b.bottom, all: b.left + b.right + b.top + b.bottom };
}

/** Whether two sets of edges are the same, for "is this preset active". */
export function sameBorders(a, b) {
  const x = cleanBorders(a);
  const y = cleanBorders(b);
  return EDGES.every((edge) => x[edge] === y[edge]);
}

/** The largest corner radius that cannot invert a rectangle. */
export function maxCorner(width, height) {
  return Math.max(0, Math.min(Number(width) || 0, Number(height) || 0) / 2);
}

/**
 * A corner radius that fits the box.
 *
 * A radius larger than half the shorter side inverts the corners of the path and
 * the frame folds in on itself, so it clamps to a pill: half the shorter side,
 * never more. This is the clamp the panel reports when it bites.
 */
export function cornerRadius(radius, width, height) {
  return clamp(cleanPixels(radius), 0, maxCorner(width, height));
}

/** `#rrggbb` plus an alpha, as a canvas colour. */
export function hexToRgba(hex, alpha) {
  const raw = String(hex ?? "").trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const value = Number.parseInt(full.slice(0, 6), 16);
  const safe = Number.isFinite(value) ? value : 0;
  const a = clamp(Number(alpha) || 0, 0, 1);
  return `rgba(${(safe >> 16) & 0xff}, ${(safe >> 8) & 0xff}, ${safe & 0xff}, ${a})`;
}

// ---------------------------------------------------------------------------
// Output size
// ---------------------------------------------------------------------------

/** `image + borders`, with nothing else involved. */
export function outputSize(width, height, borders) {
  const b = cleanBorders(borders);
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  return { width: w + b.left + b.right, height: h + b.top + b.bottom };
}

/** Scale four edges by `k`, rounding down so the total never grows. */
function scaleBorders(borders, k) {
  const out = {};
  for (const edge of EDGES) out[edge] = Math.floor(borders[edge] * k);
  return out;
}

/**
 * Shrink the borders until the output is something a browser will actually
 * produce.
 *
 * Two ceilings apply and both are reported through `limited`: the longest side
 * (`MAX_OUTPUT_SIDE`) and the whole area (`MAX_OUTPUT_PIXELS`). The edges are
 * scaled together, so a frame stays a frame at the ratio the operator chose
 * rather than losing one side.
 *
 * The area ceiling has no closed form that keeps both axes exact, so it is
 * bisected. Forty iterations is far past the point where a pixel changes.
 *
 * @returns {{borders: object, scale: number, limited: boolean, overArea: boolean}}
 */
export function fitBorders(width, height, borders) {
  const imgW = Math.max(1, Math.round(Number(width) || 0));
  const imgH = Math.max(1, Math.round(Number(height) || 0));
  const want = cleanBorders(borders);
  const totalW = want.left + want.right;
  const totalH = want.top + want.bottom;

  if (totalW === 0 && totalH === 0) {
    return { borders: want, scale: 1, limited: false, overArea: false };
  }

  const areaAt = (k) => (imgW + k * totalW) * (imgH + k * totalH);
  const baseArea = imgW * imgH;

  // The picture on its own is over the ceiling. No border can fix that, so the
  // answer is no border at all, said out loud rather than attempted.
  if (baseArea > MAX_OUTPUT_PIXELS) {
    return { borders: { top: 0, right: 0, bottom: 0, left: 0 }, scale: 0, limited: true, overArea: true };
  }

  let scale = 1;
  if (totalW > 0) scale = Math.min(scale, Math.max(0, MAX_OUTPUT_SIDE - imgW) / totalW);
  if (totalH > 0) scale = Math.min(scale, Math.max(0, MAX_OUTPUT_SIDE - imgH) / totalH);
  scale = clamp(scale, 0, 1);

  if (areaAt(scale) > MAX_OUTPUT_PIXELS) {
    let lo = 0;
    let hi = scale;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (areaAt(mid) <= MAX_OUTPUT_PIXELS) lo = mid;
      else hi = mid;
    }
    scale = lo;
  }

  const scaled = scaleBorders(want, scale);
  const limited = EDGES.some((edge) => scaled[edge] !== want[edge]);
  return { borders: limited ? scaled : want, scale, limited, overArea: false };
}

/**
 * Everything about where the frame is, derived once from the picture and the
 * edges.
 *
 * @param {{width: number, height: number, borders: object, cornerRadius: number}} input
 * @returns {{
 *   width: number, height: number,
 *   picture: {width: number, height: number},
 *   borders: object,
 *   opening: {x: number, y: number, w: number, h: number},
 *   radius: number, radiusWanted: number, radiusClamped: boolean,
 *   limited: boolean, borderScale: number, overArea: boolean
 * }}
 */
export function frameGeometry(input) {
  const imgW = Math.max(1, Math.round(Number(input?.width) || 0));
  const imgH = Math.max(1, Math.round(Number(input?.height) || 0));

  const fit = fitBorders(imgW, imgH, input?.borders);
  const b = fit.borders;
  const width = imgW + b.left + b.right;
  const height = imgH + b.top + b.bottom;

  const wanted = cleanPixels(input?.cornerRadius);
  const radius = cornerRadius(wanted, width, height);

  return {
    width,
    height,
    picture: { width: imgW, height: imgH },
    borders: b,
    // The window the picture is seen through, in output coordinates.
    opening: { x: b.left, y: b.top, w: imgW, h: imgH },
    radius,
    radiusWanted: wanted,
    radiusClamped: radius < wanted,
    limited: fit.limited,
    borderScale: fit.scale,
    overArea: fit.overArea,
  };
}

/**
 * Whether the current settings would hand back the picture untouched.
 *
 * All four edges at zero and no corner radius and no shadow means the output is
 * the input at the input's size, so there is nothing to apply. This is the exact
 * identity case, not an approximation: the frame genuinely is the picture.
 *
 * @param {{borders: object, cornerRadius: number, shadowEnabled: boolean, shadowOpacity: number, transparentBg: boolean}} input
 */
export function isIdentity(input) {
  const total = totalBorder(input?.borders).all;
  if (total > 0) return false;
  if (cleanPixels(input?.cornerRadius) > 0) return false;
  // A shadow at zero opacity casts nothing, so it is not a change either.
  if (input?.shadowEnabled && (Number(input?.shadowOpacity) || 0) > 0 && !input?.transparentBg) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The caption band
// ---------------------------------------------------------------------------

/**
 * The strip of frame below the picture, where a caption goes.
 *
 * By construction this band starts where the picture ends, so it can never
 * overlap the opening however thin the borders are. `null` when there is no
 * bottom band to hold a caption, which is the honest answer for a bottom edge
 * of zero.
 *
 * @param {{opening: {x: number, y: number, w: number, h: number}, borders: object}} input
 * @returns {{x: number, y: number, w: number, h: number} | null}
 */
export function captionBand(input) {
  const opening = input?.opening;
  if (!opening) return null;
  const b = cleanBorders(input?.borders);
  if (b.bottom <= 0) return null;
  if (opening.w <= 0 || opening.h <= 0) return null;
  return { x: opening.x, y: opening.y + opening.h, w: opening.w, h: b.bottom };
}

// ---------------------------------------------------------------------------
// The caption
// ---------------------------------------------------------------------------

const lineHeight = (size) => Math.max(1, Math.round(size * CAPTION_LINE_HEIGHT));

/**
 * Size, position and fit of the caption and its date line, inside the band.
 *
 * Three things happen here, in this order, and all three are reported:
 *
 * 1. **Width.** Each line is shrunk, never cut, until it fits the band. If it
 *    still does not fit at `MIN_CAPTION_SIZE` the line is kept at that floor and
 *    `tooWide` says so, so the panel can tell the operator their words are
 *    being cut rather than leaving them to find out.
 * 2. **Height.** The block is shrunk to fit the band. If it will not fit even
 *    at the floor, the date line goes first and then the caption, each reported
 *    in `dropped`. The picture is never drawn over, and the caption band is
 *    never drawn beyond: a caption that cannot fit is not shown, not spilled.
 * 3. **Position.** The block slides inside the band by `position` percent,
 *    clamped so it stays inside the band at every setting.
 *
 * `measure(text, size)` is a width measurement in pixels, normally
 * `ctx.measureText(t).width` with the font already set. Without one it falls
 * back to an estimate: a caption that is slightly wrong is cosmetic, whereas
 * dropping it is not.
 *
 * @returns {{
 *   primary: object | null,
 *   secondary: object | null,
 *   availWidth: number,
 *   tooWide: boolean,
 *   shrunk: boolean,
 *   dropped: string[],
 *   band: object | null
 * }}
 */
export function captionLayout(input) {
  const band = input?.band ?? null;
  const padding = Math.max(0, Number(input?.padding) || 0);
  const minSize = Math.max(1, Math.round(Number(input?.minSize) || MIN_CAPTION_SIZE));
  const position = clamp(Number(input?.position) || 0, 0, 100);
  const align = input?.align === "left" || input?.align === "right" ? input.align : "center";
  const measure =
    typeof input?.measure === "function"
      ? input.measure
      : (text, size) => estimateTextWidth(text, size);

  const primaryText = String(input?.text ?? "").trim();
  const secondaryText = String(input?.date ?? "").trim();
  const dropped = [];

  const result = {
    primary: null,
    secondary: null,
    availWidth: 0,
    tooWide: false,
    shrunk: false,
    dropped,
    band,
  };

  if (!band || band.w <= 0 || band.h <= 0) {
    if (primaryText) dropped.push("text");
    if (secondaryText) dropped.push("date");
    return result;
  }

  const avail = Math.max(0, band.w - padding * 2);
  result.availWidth = avail;

  /** Shrink one line until it fits the band width, down to the floor. */
  function fitLine(text, wanted) {
    let size = Math.max(minSize, Math.round(Number(wanted) || minSize));
    let width = Number(measure(text, size)) || 0;
    while (width > avail && size > minSize) {
      size -= 1;
      width = Number(measure(text, size)) || 0;
    }
    return { text, size, width, height: lineHeight(size), tooWide: width > avail + 0.5 };
  }

  const wantPrimary = Math.max(minSize, Math.round(Number(input?.size) || minSize));
  const wantSecondary = Math.max(
    minSize,
    Math.round(wantPrimary * (Number(input?.dateRatio) || DATE_SIZE_RATIO)),
  );

  let primary = primaryText ? fitLine(primaryText, wantPrimary) : null;
  let secondary = secondaryText ? fitLine(secondaryText, wantSecondary) : null;

  if (primary && primary.size < wantPrimary) result.shrunk = true;
  if (secondary && secondary.size < wantSecondary) result.shrunk = true;

  const blockHeight = (a, b) => {
    if (a && b) return a.height + CAPTION_GAP + b.height;
    return (a || b)?.height ?? 0;
  };

  // Height. Shrink the taller line first so the pair keeps its rhythm, then
  // give up a line rather than reach out of the band.
  let guard = 0;
  while (blockHeight(primary, secondary) > band.h && guard < 600) {
    guard += 1;
    const canShrinkPrimary = primary && primary.size > minSize;
    const canShrinkSecondary = secondary && secondary.size > minSize;
    if (!canShrinkPrimary && !canShrinkSecondary) break;

    if (canShrinkSecondary && (!canShrinkPrimary || secondary.height >= primary.height)) {
      secondary = fitLine(secondary.text, secondary.size - 1);
      result.shrunk = true;
    } else {
      primary = fitLine(primary.text, primary.size - 1);
      result.shrunk = true;
    }
  }

  if (blockHeight(primary, secondary) > band.h && primary && secondary) {
    secondary = null;
    dropped.push("date");
  }
  if (primary && primary.height > band.h) {
    primary = null;
    dropped.push("text");
  }
  if (!primary && secondary && secondary.height > band.h) {
    secondary = null;
    dropped.push("date");
  }

  const block = blockHeight(primary, secondary);
  const slack = Math.max(0, band.h - block);
  const top = band.y + slack * (position / 100);

  const anchorX =
    align === "left" ? band.x + padding : align === "right" ? band.x + band.w - padding : band.x + band.w / 2;

  let cursor = top;
  if (primary) {
    result.primary = {
      ...primary,
      x: anchorX,
      y: cursor + primary.height / 2,
      align,
    };
    cursor += primary.height;
  }
  if (secondary) {
    cursor += CAPTION_GAP;
    result.secondary = {
      ...secondary,
      x: anchorX,
      y: cursor + secondary.height / 2,
      align,
    };
  }

  result.tooWide = Boolean(primary?.tooWide || secondary?.tooWide);
  return result;
}

/** The line positions a canvas draws at, as an array. Empty when nothing fits. */
export function captionLines(layout) {
  const out = [];
  if (layout?.primary) out.push(layout.primary);
  if (layout?.secondary) out.push(layout.secondary);
  return out;
}