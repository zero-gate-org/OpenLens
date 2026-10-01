/**
 * Text behind an object: the compositing order, and the mask edge.
 *
 * The tool is a three layer composite, and the order is the whole of it:
 *
 *   1. the background, which is a *plate*: the blurred frame, a flat colour, or
 *      the frame itself
 *   2. the text, drawn over the plate
 *   3. the subject, which is the original frame, drawn back over the text
 *      through the segmentation mask
 *
 * So the words pass behind the subject and show only where the mask says there
 * is no subject. Read the order as the reason the subject is composited rather
 * than merely placed: it is the third step, so it hides the text, and it is the
 * only step that reads the original, so the plate never has to have the subject
 * knocked out of it. That is why a blur can serve as a background here without
 * leaving a copy of the subject behind the words.
 *
 * Nothing in this module decides what the subject is. The mask is produced by
 * the segmentation pipeline in `state/shadowinject.svelte.js`, which is shared
 * with the shadow, blur and colour splash tools, and the feathered plane comes
 * out of the shared `featherMask` here. All this module owns is the arithmetic.
 *
 * The edge is the other thing worth reading. A segmentation mask is a hard alpha
 * cut-out, and a hard cut-out where a sharp subject meets a blurred plate is a
 * visible line, which is the usual way this kind of tool goes wrong. So the
 * subject is composited through a *feathered* plane rather than the mask itself:
 * the join is a ramp as wide as the operator asked for. A feather of zero hands
 * the mask through untouched, which is a real setting and not an error, and the
 * panel says what it costs.
 *
 * Everything here is arithmetic over plain `{width, height, data}` objects,
 * which is the shape `ImageData` has. No canvas is created and no `ImageData`
 * global is touched, so the module runs in plain Node and is unit tested
 * without a browser. Turning a result back into real pixels, and rasterising the
 * words, are the caller's job.
 *
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 * @typedef {{x: number, y: number, w: number, h: number}} Box
 * @typedef {{x: number, y: number, w: number, h: number, data: Uint8ClampedArray}} InkSheet
 * @typedef {object} BehindOptions
 * @property {string} [plate]     `blur`, `solid` or `original`
 * @property {number} [plateBlur] softening radius for the blur plate, in pixels
 * @property {string} [plateColor] `#rrggbb` fill for the solid plate
 * @property {number} [feather]   width of the soft join, in pixels
 * @property {number} [opacity]   0..100, how much of the text lands
 * @property {string} [textKey]   the caller's own signature for the ink sheet
 */

import { featherMask, gaussianBlur } from "./gaussian.js";
import { hexToRgb, normalizeHex } from "./duotonemath.js";
import { subjectMass } from "./shadow.js";

/**
 * What the background is.
 *
 * `blur` and `solid` are the two that make the words readable. `original` is
 * the honest third: it leaves the picture alone, so the words show only where
 * the subject is not. It is not the default because on its own it hides the
 * feather control's only job.
 */
export const PLATES = [
  { value: "blur", label: "Blur" },
  { value: "solid", label: "Solid" },
  { value: "original", label: "Original" },
];

/** Slider ranges, shared with the panel so the numbers cannot drift apart. */
export const FEATHER_RANGE = { min: 0, max: 20, step: 1 };
export const PLATE_BLUR_RANGE = { min: 0, max: 60, step: 1 };
export const OPACITY_RANGE = { min: 0, max: 100, step: 1 };

/**
 * The soft join, as the legacy panel spelled it: a hard-coded dark offset
 * shadow under the words. It exists because the words sit on a photograph, and
 * a photograph has no background colour to promise contrast against.
 *
 * `reach` is how far the shadow can spread outside a glyph, which is what the
 * ink sheet has to be padded by to avoid clipping it. Blur plus the larger of
 * the two offsets is the honest figure: the shadow is blurred on every side,
 * and only shifted on two of them.
 */
export const TEXT_SHADOW = {
  color: "rgba(0, 0, 0, 0.5)",
  offsetX: 2,
  offsetY: 2,
  blur: 8,
  reach: 10,
};

/**
 * What a panel starts on.
 *
 * The plate blur is deep enough to push the subject's own colour out of the
 * way, and the feather is the one value that has to be non zero to look right:
 * at zero the subject is a hard cut-out over the plate.
 *
 * @type {Required<Pick<BehindOptions, "plate" | "plateBlur" | "plateColor" | "feather" | "opacity">>}
 */
export const BEHIND_DEFAULTS = {
  plate: "blur",
  plateBlur: 18,
  plateColor: "#0d1216",
  feather: 4,
  opacity: 100,
};

/**
 * Above this share of the frame the mask has not found a subject in the sense
 * this tool needs: it has found that everything is the subject.
 *
 * A mask covering the frame is not a rarer answer than an empty one. A close
 * portrait, a flat texture, or a picture with no depth of field all come back
 * as "all of it is foreground", and the words would then be drawn and completely
 * hidden, which reads as a broken tool rather than as a composition. So it is
 * named rather than left to the arithmetic to look wrong, and the panel says
 * there is no background for the words to show in.
 */
export const FULL_COVERAGE_MASS = 0.97;

/** What the panel says when there are no words. */
export const EMPTY_TEXT_MESSAGE = "Apply needs some words to put behind the subject.";

/** What the panel says when the text would be invisible. */
export const ZERO_OPACITY_MESSAGE = "Text opacity is 0%, so no words would show.";

/** What the panel says when the mask found nothing to put words behind. */
export const NO_SUBJECT_MESSAGE =
  "No subject was found in this picture, so there is nothing to put words behind.";

/** What the panel says when the mask says the whole picture is the subject. */
export const FULL_COVERAGE_MESSAGE =
  "The subject covers the whole frame, so there is no background for the words to show in.";

/**
 * A finite number, or the fallback.
 *
 * Anything a control, a preset or a keyboard can hand over that is not finite
 * becomes the fallback, rather than propagating into a loop where a NaN index
 * reads `undefined` out of the buffer and lands as a zero channel.
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
 * One integer setting, rounded and held inside `min..max`.
 *
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} [fallback]
 * @returns {number}
 */
function clampInt(value, min, max, fallback = min) {
  const n = Math.round(finite(value, fallback));
  return n < min ? min : n > max ? max : n;
}

/** One feather width, rounded and held inside the slider's range. */
export function clampFeather(value) {
  return clampInt(value, FEATHER_RANGE.min, FEATHER_RANGE.max);
}

/** One plate blur radius, rounded and held inside the slider's range. */
export function clampPlateBlur(value) {
  return clampInt(value, PLATE_BLUR_RANGE.min, PLATE_BLUR_RANGE.max);
}

/** One percentage, rounded and held inside 0..100. */
export function clampOpacity(value) {
  return clampInt(value, OPACITY_RANGE.min, OPACITY_RANGE.max);
}

/**
 * The settings, resolved, clamped and defaulted.
 *
 * @param {BehindOptions} [options]
 * @returns {Required<BehindOptions>}
 */
export function normalizeBehind(options = {}) {
  const asked = PLATES.some((p) => p.value === options.plate);
  return {
    plate: /** @type {"blur" | "solid" | "original"} */ (
      asked ? options.plate : BEHIND_DEFAULTS.plate
    ),
    plateBlur: clampPlateBlur(options.plateBlur ?? BEHIND_DEFAULTS.plateBlur),
    plateColor: normalizeHex(options.plateColor ?? BEHIND_DEFAULTS.plateColor),
    feather: clampFeather(options.feather ?? BEHIND_DEFAULTS.feather),
    opacity: clampOpacity(options.opacity ?? BEHIND_DEFAULTS.opacity),
    textKey: String(options.textKey ?? ""),
  };
}

/**
 * Cache key for a finished frame.
 *
 * Two settings with the same key produce the same pixels, which is all the
 * frame cache needs to know. `textKey` is the caller's signature for the ink
 * sheet, because the words are rasterised by the caller on a canvas and this
 * module has no font: without it a cached frame would be reused for a
 * different sentence.
 *
 * @param {BehindOptions} [options]
 * @returns {string}
 */
export function behindKey(options = {}) {
  const o = normalizeBehind(options);
  return `${o.plate},${o.plateBlur},${o.plateColor},${o.feather},${o.opacity},${o.textKey}`;
}

/**
 * Whether the mask says the whole frame is the subject.
 *
 * The mean mask alpha is read by the shared `subjectMass`, the same measurement
 * the shadow tool uses, so the two agree about what a subject is.
 *
 * @param {Pixels} mask
 * @returns {boolean}
 */
export function fullCoverageMask(mask) {
  return subjectMass(mask) >= FULL_COVERAGE_MASS;
}

/**
 * How many whole rows every buffer in a group can actually hold.
 *
 * A caller that hands over a buffer shorter than its own width and height gets
 * the rows that fit, rather than a pass that reads off the end of it. A buffer
 * that was never supplied is not a constraint: the ink sheet is optional here,
 * and reading its absence as an empty buffer would collapse the frame to no
 * rows at all.
 *
 * This is `core/shadow.js`'s guard, repeated rather than exported from there,
 * because the two modules are otherwise independent and neither should depend
 * on the other's name to describe its own buffers.
 *
 * @param {Array<Pixels | InkSheet | null | undefined>} buffers
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function fitRows(buffers, width, height) {
  if (!(width > 0)) return 0;
  let pixels = Infinity;
  for (const buffer of buffers) {
    if (!buffer?.data) continue;
    pixels = Math.min(pixels, Math.floor(buffer.data.length / 4));
  }
  return Math.max(0, Math.min(height, Math.floor(pixels / width)));
}

/**
 * A box cut down to the part of it that is inside the frame.
 *
 * Used to keep the ink sheet small. A full frame sheet for the words on a
 * twelve megapixel photograph is forty eight megabytes for a shape a few
 * hundred kilobytes, so the sheet is the size of the text block and this is
 * how it is trimmed. Rounded, because a canvas size has to be a whole number
 * of pixels and a half pixel sheet is not a thing.
 *
 * A box that lies entirely to one side of the frame comes back with nothing of
 * itself across that axis, which is the honest answer: there is none of it on
 * the picture. The other axis is untouched, so a box off the right edge keeps
 * its height and a caller can still tell which way it fell off.
 *
 * @param {Box} box
 * @param {number} width
 * @param {number} height
 * @returns {Box}
 */
export function clipBoxToFrame(box, width, height) {
  const w = Math.max(0, Math.round(finite(width, 0)));
  const h = Math.max(0, Math.round(finite(height, 0)));
  const x0 = Math.round(finite(box?.x, 0));
  const y0 = Math.round(finite(box?.y, 0));
  const x1 = x0 + Math.max(0, Math.round(finite(box?.w, 0)));
  const y1 = y0 + Math.max(0, Math.round(finite(box?.h, 0)));

  const left = Math.max(0, x0);
  const top = Math.max(0, y0);
  return {
    x: left,
    y: top,
    w: Math.max(0, Math.min(w, x1) - left),
    h: Math.max(0, Math.min(h, y1) - top),
  };
}

/** A copy of a frame, always a new buffer. */
function copyFrame(pixels, width, height, rows) {
  const out = new Uint8ClampedArray(rows * width * 4);
  const data = pixels?.data;
  if (data) out.set(/** @type {Uint8ClampedArray} */ (data).subarray(0, out.length));
  return { width, height: rows, data: out };
}

/**
 * The background: step one of the three.
 *
 * The blur is the shared separable pass from `core/gaussian.js`, which hands
 * the main thread back between row bands and gives up if the caller has moved
 * on. A radius of zero is the identity there, so a plate blur of zero returns a
 * copy of the frame rather than a special case of its own.
 *
 * The solid plate is opaque by construction. That is a real property rather than
 * a shortcut: a flat colour has nothing to be transparent about, and letting it
 * inherit the frame's alpha would mean a colour field that changed the
 * transparency of the picture.
 *
 * @param {Pixels} original
 * @param {BehindOptions} [options]
 * @param {{isCancelled?: () => boolean}} [passOptions]
 * @returns {Promise<Pixels | null>} null when cancelled
 */
export async function makePlate(original, options = {}, passOptions = {}) {
  const o = normalizeBehind(options);
  const width = Math.max(0, Math.round(finite(original?.width, 0)));
  const height = Math.max(0, Math.round(finite(original?.height, 0)));

  // There is no frame to derive a background from, so there is no background.
  // Reported as "no plate" rather than as a black one, which would be a picture
  // the operator never chose.
  if (!original?.data || width === 0 || height === 0) return null;

  const rows = fitRows([original], width, height);

  if (o.plate === "solid") {
    const { r, g, b } = hexToRgb(o.plateColor);
    const data = new Uint8ClampedArray(rows * width * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
    return { width, height: rows, data };
  }

  if (o.plate === "original") return copyFrame(original, width, height, rows);

  const blurred = await gaussianBlur(original, o.plateBlur, passOptions);
  if (!blurred) return null;
  // The blur reports the frame's own height. Trim it to what was actually there
  // so the plate and the composite cannot disagree about the row count.
  return copyFrame(blurred, width, height, rows);
}

/**
 * The whole composition, in the order it has to happen.
 *
 * Three steps, and the loop is written in the order they are named in so the
 * order is readable rather than merely correct:
 *
 *   1. the plate is the starting colour of the pixel
 *   2. the ink is mixed into it, which is what puts the words *over* the
 *      background
 *   3. the subject is mixed into that, which is what puts the words *under* the
 *      subject
 *
 * Every mix is a straight lerp, `dst + (src - dst) * a`, rather than a Porter
 * Duff expression. That is exact for an opaque destination, and the only
 * destination that is not opaque is a plate cut from a frame that had
 * transparency in it, where a lerp toward a straight colour is the answer an
 * editor wants anyway. The alpha channel gets the same treatment rather than
 * being copied from one layer, so a transparent source contributes its own
 * transparency to the subject step and the picture cannot gain opacity nobody
 * asked for.
 *
 * The ink sheet is a sub rectangle of the frame rather than the whole frame,
 * because it is the words and the words are small. A pixel outside the sheet
 * simply has no ink, which is the same as an ink alpha of zero.
 *
 * A missing coverage plane means the subject could not be measured, and leaving
 * the frame alone is the only answer to that which cannot delete the subject.
 *
 * @param {Pixels} original   the frame, and the only source of the subject
 * @param {Pixels} plate      the background; the original when absent
 * @param {InkSheet | null} ink
 * @param {Uint8ClampedArray | null} coverage  one 0..255 value per pixel
 * @param {BehindOptions} [options]
 * @returns {Pixels} always a new buffer, never an input
 */
export function compositeBehind(original, plate, ink, coverage, options = {}) {
  const o = normalizeBehind(options);
  const width = Math.max(0, Math.round(finite(original?.width, 0)));
  const height = Math.max(0, Math.round(finite(original?.height, 0)));
  const rows = fitRows([original, plate, ink], width, height);
  const out = new Uint8ClampedArray(rows * width * 4);

  const originalData = original?.data ?? null;
  if (!originalData || rows === 0) return { width, height: rows, data: out };

  // Nothing to composite through: the frame is already the answer.
  if (!coverage) return copyFrame(original, width, height, rows);

  const base = plate?.data ?? originalData;
  const inkData = ink?.data ?? null;
  const inkX = Math.round(finite(ink?.x, 0));
  const inkY = Math.round(finite(ink?.y, 0));
  const inkW = Math.max(0, Math.round(finite(ink?.w, 0)));
  const inkH = Math.max(0, Math.round(finite(ink?.h, 0)));
  const inkMix = inkOn(o.opacity);
  const hasInk = inkMix > 0 && inkData !== null && inkW > 0 && inkH > 0;

  for (let y = 0; y < rows; y++) {
    const inkRow = y - inkY;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // 1. Background.
      let r = base[i];
      let g = base[i + 1];
      let b = base[i + 2];
      let a = base[i + 3];

      // 2. The text, over the background.
      const inkCol = x - inkX;
      if (hasInk && inkCol >= 0 && inkCol < inkW && inkRow >= 0 && inkRow < inkH) {
        const k = (inkRow * inkW + inkCol) * 4;
        const inkA = inkData[k + 3];
        if (inkA > 0) {
          const t = (inkA / 255) * inkMix;
          r += (inkData[k] - r) * t;
          g += (inkData[k + 1] - g) * t;
          b += (inkData[k + 2] - b) * t;
          a += (255 - a) * t;
        }
      }

      // 3. The subject, over the text, through the feathered plane.
      const s = (coverage[y * width + x] / 255) * (originalData[i + 3] / 255);
      if (s > 0) {
        r += (originalData[i] - r) * s;
        g += (originalData[i + 1] - g) * s;
        b += (originalData[i + 2] - b) * s;
        a += (255 - a) * s;
      }

      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = a;
    }
  }

  return { width, height: rows, data: out };
}

/**
 * How much of the text lands, 0..1.
 *
 * @param {number} opacity 0..100
 * @returns {number}
 */
function inkOn(opacity) {
  return clampOpacity(opacity) / 100;
}

/**
 * The whole effect: plate, feather, text, subject.
 *
 * The two expensive passes are the shared ones. `featherMask` averages the mask
 * alpha into the soft plane the subject is composited through, and
 * `gaussianBlur` softens the plate; both hand the main thread back between row
 * bands and both give up if the caller has moved on. The composite that
 * follows is a straight mix per channel over pixels that are already decided,
 * so there is no neighbourhood and nothing to band.
 *
 * @param {Pixels} original
 * @param {Pixels} mask       the unfeathered foreground mask
 * @param {InkSheet | null} ink
 * @param {BehindOptions} [options]
 * @param {{isCancelled?: () => boolean}} [passOptions]
 * @returns {Promise<Pixels | null>} null when a pass was cancelled
 */
export async function buildBehind(original, mask, ink, options = {}, passOptions = {}) {
  const o = normalizeBehind(options);

  const coverage = await featherMask(mask, o.feather, passOptions);
  if (!coverage) return null;

  const plate = await makePlate(original, o, passOptions);
  if (!plate) return null;

  return compositeBehind(original, plate, ink, coverage, o);
}