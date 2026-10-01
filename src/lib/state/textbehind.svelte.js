/**
 * Text behind an object: the selection the panel and the stage layer share.
 *
 * The panel and the layer are two separate component instances of one tool, and
 * they have to agree on the same words, the same style and the same placement.
 * That agreement cannot live in either of them, so it lives here: a module level
 * store, mounted and unmounted with the tool.
 *
 * Every value is a decision the operator made, in image pixels or degrees. The
 * text geometry is computed by the shared `core/stroketext.js`, so this tool's
 * words sit where the other two text tools' words sit for the same numbers, and
 * the compositing is `core/behind.js`, which is pure and unit tested.
 *
 * The segmentation mask is not here. It belongs to the pipeline in
 * `shadowinject.svelte.js`, which the shadow, blur and colour splash tools all
 * read from, and it is read straight off that store rather than cached a second
 * time: the model is the expensive half by far and there is one copy of it.
 */

import {
  ALIGNMENTS,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  blockLayout,
  defaultTextSize,
  frameOverflow,
  padBox,
  rotationMatrix,
  transformBox,
  wrapGlyphs,
} from "../core/stroketext.js";
import {
  BEHIND_DEFAULTS,
  EMPTY_TEXT_MESSAGE,
  FULL_COVERAGE_MESSAGE,
  NO_SUBJECT_MESSAGE,
  OPACITY_RANGE,
  TEXT_SHADOW,
  ZERO_OPACITY_MESSAGE,
  behindKey,
  buildBehind,
  clipBoxToFrame,
  fullCoverageMask,
} from "../core/behind.js";
import { normalizeHex } from "../core/duotonemath.js";
import { FONT_FAMILIES } from "../core/fonts.js";
import { fontStack } from "../core/watermarklayout.js";
import { shadowInjection } from "./shadowinject.svelte.js";

/** One shared font list, so the three text tools cannot drift apart. */
export { FONT_FAMILIES, ALIGNMENTS, MIN_TEXT_SIZE, MAX_TEXT_SIZE, OPACITY_RANGE };

/** Finished frames to keep, so a slider can be dragged back and forth. */
const FRAMES_KEPT = 3;

const DEFAULTS = {
  text: "Text Behind",
  family: "system-ui",
  bold: true,
  italic: false,
  letterSpacing: 0,
  align: "center",
  color: "#ffffff",
  shadow: true,
  rotationDeg: 0,
};

class TextBehindStore {
  // --- What is being said ------------------------------------------
  text = $state(DEFAULTS.text);
  family = $state(DEFAULTS.family);
  size = $state(72);
  bold = $state(DEFAULTS.bold);
  italic = $state(DEFAULTS.italic);
  letterSpacing = $state(DEFAULTS.letterSpacing);
  align = $state(DEFAULTS.align);
  color = $state(DEFAULTS.color);
  shadow = $state(DEFAULTS.shadow);
  opacity = $state(BEHIND_DEFAULTS.opacity);

  // --- The background ----------------------------------------------
  plate = $state(BEHIND_DEFAULTS.plate);
  plateBlur = $state(BEHIND_DEFAULTS.plateBlur);
  plateColor = $state(BEHIND_DEFAULTS.plateColor);
  /**
   * The soft join around the subject, in pixels.
   *
   * This is the one value that decides whether the tool looks right: at zero the
   * subject is a hard cut-out over the plate, which is what leaves a visible
   * line. See `featherMask` in `core/gaussian.js`.
   */
  feather = $state(BEHIND_DEFAULTS.feather);

  // --- Placement ----------------------------------------------------
  /** Anchor, in image pixels: the block's centre across and down. */
  x = $state(0);
  y = $state(0);
  rotationDeg = $state(DEFAULTS.rotationDeg);

  // --- Measured, from the panel's canvas ----------------------------
  run = $state({ glyphs: [], ascent: 0, descent: 0 });

  // --- The image on stage -------------------------------------------
  imageWidth = $state(0);
  imageHeight = $state(0);

  /**
   * Transient drag bookkeeping. Deliberately not `$state`: it is read only
   * during a pointermove and never rendered, so it should invalidate nothing.
   */
  drag = null;

  /**
   * Finished frames by composition key.
   *
   * Not `$state` for the same reason the segmentation store keeps its pixels out
   * of it: nothing renders from a frame, and writing one would invalidate the
   * panel.
   *
   * @type {Map<string, Promise<import("../core/behind.js").Pixels | null>>}
   */
  frames = new Map();

  // --- Derived -------------------------------------------------------

  /** The canvas font shorthand, spelled the same way for the layer and the ink. */
  get font() {
    return fontStack(this.family, { bold: this.bold, italic: this.italic }, this.size);
  }

  /** The run broken into lines. There is no wrap width, so only line breaks. */
  lines = $derived(
    wrapGlyphs(this.run.glyphs, { maxWidth: 0, letterSpacing: this.letterSpacing }),
  );

  /** The whole block, in the text's own frame with the anchor at the origin. */
  block = $derived(
    blockLayout({
      lines: this.lines,
      align: this.align,
      size: this.size,
      lineHeight: 1.2,
      ascent: this.run.ascent,
      descent: this.run.descent,
      letterSpacing: this.letterSpacing,
    }),
  );

  /** The placement. The ink sheet and the layer both read this. */
  matrix = $derived(rotationMatrix({ x: this.x, y: this.y, rotationDeg: this.rotationDeg }));

  /** The block on the picture, in image pixels, rotated with the words. */
  box = $derived(transformBox(this.block.box, this.matrix));

  /** Which edges of the frame the words run past. Reported, never enforced. */
  overflow = $derived(frameOverflow(this.box, { width: this.imageWidth, height: this.imageHeight }));

  /**
   * The rectangle the ink sheet covers: the block, grown by however far the text
   * shadow can spread, then cut down to the part of it on the picture.
   *
   * Trimmed on purpose. A full frame sheet for a line of words on a twelve
   * megapixel photograph is forty eight megabytes for a shape a few hundred
   * kilobytes, and `compositeBehind` reads the sheet through this origin so a
   * smaller sheet is a faster one.
   */
  inkBox = $derived(
    clipBoxToFrame(
      padBox(this.box, this.shadow ? TEXT_SHADOW.reach : 0),
      this.imageWidth,
      this.imageHeight,
    ),
  );

  /**
   * A signature for the ink sheet.
   *
   * The words are rasterised by the panel on a canvas, so this module has no
   * way to tell two different sentences apart except by being told. The canvas
   * font shorthand carries the family, the size, the weight and the slant, so
   * one entry covers all of them. Without this the frame cache would hand back
   * yesterday's sentence.
   */
  textKey = $derived(
    [
      this.font,
      this.text,
      this.letterSpacing,
      this.align,
      Math.round(this.x),
      Math.round(this.y),
      Math.round(this.rotationDeg),
      normalizeHex(this.color),
      this.shadow ? 1 : 0,
    ].join("|"),
  );

  /** The compositing settings, resolved. */
  behind = $derived({
    plate: this.plate,
    plateBlur: this.plateBlur,
    plateColor: this.plateColor,
    feather: this.feather,
    opacity: this.opacity,
    textKey: this.textKey,
  });

  /** The key the finished frames are cached under. */
  frameKey = $derived(behindKey(this.behind));

  hasText = $derived(this.text.trim() !== "" && this.block.glyphs.length > 0);

  /**
   * Whether the composition is incomplete enough to refuse to draw it, and if
   * not why. A value rather than a note in the markup, so the button and the
   * sentence under it can never disagree about whether Apply is live.
   *
   * The mask verdict comes last and only once the model has actually run, so
   * the panel never reports a problem it has not measured. It reads the shared
   * segmentation store rather than a private copy: the subject is one subject.
   */
  blockedReason = $derived.by(() => {
    if (!this.hasText) return EMPTY_TEXT_MESSAGE;
    if (this.opacity <= 0) return ZERO_OPACITY_MESSAGE;
    if (!shadowInjection.ready) return null;
    if (shadowInjection.noSubject) return NO_SUBJECT_MESSAGE;
    if (fullCoverageMask(shadowInjection.mask)) return FULL_COVERAGE_MESSAGE;
    return null;
  });

  /** True when the composition is incomplete enough to refuse to draw it. */
  blocked = $derived(this.blockedReason !== null);

  // ---------------------------------------------------------------
  // Measurement
  // ---------------------------------------------------------------

  /**
   * Called by the panel whenever the run has to be measured again.
   *
   * The block is left empty until this arrives, so a font the browser has not
   * drawn yet cannot leave a run of zeroes on the stage.
   */
  setRun(run) {
    this.run = {
      glyphs: run?.glyphs ?? [],
      ascent: Number.isFinite(run?.ascent) ? run.ascent : 0,
      descent: Number.isFinite(run?.descent) ? run.descent : 0,
    };
  }

  // ---------------------------------------------------------------
  // Frames
  // ---------------------------------------------------------------

  /** Drop the cached frames. Work in flight lands on a stale key and is unused. */
  clearFrames() {
    this.frames.clear();
  }

  /** Keep only the newest `limit` entries of an insertion-ordered Map. */
  trim(limit) {
    for (const key of this.frames.keys()) {
      if (this.frames.size <= limit) break;
      this.frames.delete(key);
    }
  }

  /**
   * A finished frame for the current composition, computed at most once.
   *
   * The promise is what gets cached, not the result, so a preview and a commit
   * that land together share the work instead of racing for the same pixels.
   * The mask and the frame it reads come from the shared segmentation store, so
   * this costs a feather, a plate and a composite and never a second run of the
   * model.
   *
   * @param {import("../core/behind.js").InkSheet | null} ink
   * @param {() => boolean} isStale
   * @param {((message: string, ratio: number | null) => void) | null} [report]
   * @returns {Promise<import("../core/behind.js").Pixels | null>}
   */
  frame(ink, isStale, report) {
    const key = this.frameKey;
    const cached = this.frames.get(key);
    if (cached) {
      // Re-insert: the bound should drop the entry nobody looked at twice.
      this.frames.delete(key);
      this.frames.set(key, cached);
      return cached;
    }

    report?.("Putting the words behind the subject", 0.8);

    const work = buildBehind(
      shadowInjection.original,
      shadowInjection.mask,
      ink,
      this.behind,
      { isCancelled: isStale },
    ).then(
      (pixels) => {
        // A cancelled frame is not a result, and must not sit in the cache.
        if (!pixels) this.frames.delete(key);
        return pixels;
      },
      (error) => {
        this.frames.delete(key);
        throw error;
      },
    );

    this.frames.set(key, work);
    this.trim(FRAMES_KEPT);
    return work;
  }

  // ---------------------------------------------------------------
  // Seeding
  // ---------------------------------------------------------------

  /**
   * Re-seed for the image on stage.
   *
   * Called once per mount, so leaving the tool and coming back starts from the
   * same place rather than from words left over an image that may have been
   * committed or undone in the meantime.
   */
  sync(width, height, force = false) {
    if (!width || !height) {
      this.imageWidth = 0;
      this.imageHeight = 0;
      this.run = { glyphs: [], ascent: 0, descent: 0 };
      this.x = 0;
      this.y = 0;
      return;
    }

    if (!force && width === this.imageWidth && height === this.imageHeight) return;

    this.imageWidth = width;
    this.imageHeight = height;
    this.text = DEFAULTS.text;
    this.family = DEFAULTS.family;
    this.bold = DEFAULTS.bold;
    this.italic = DEFAULTS.italic;
    this.letterSpacing = DEFAULTS.letterSpacing;
    this.align = DEFAULTS.align;
    this.color = DEFAULTS.color;
    this.shadow = DEFAULTS.shadow;
    this.opacity = BEHIND_DEFAULTS.opacity;
    this.plate = BEHIND_DEFAULTS.plate;
    this.plateBlur = BEHIND_DEFAULTS.plateBlur;
    this.plateColor = BEHIND_DEFAULTS.plateColor;
    this.feather = BEHIND_DEFAULTS.feather;
    this.rotationDeg = DEFAULTS.rotationDeg;
    this.size = defaultTextSize(width);
    this.x = Math.round(width / 2);
    this.y = Math.round(height / 2);
  }

  /** Back to the starting composition, on the same image. */
  reset() {
    this.sync(this.imageWidth, this.imageHeight, true);
  }

  /** Put the block back in the middle of the picture. */
  centre() {
    this.x = Math.round(this.imageWidth / 2);
    this.y = Math.round(this.imageHeight / 2);
  }

  // ---------------------------------------------------------------
  // Pointer interaction. `point` is in image coordinates.
  // ---------------------------------------------------------------

  beginDrag(point) {
    this.drag = { point, x: this.x, y: this.y };
  }

  moveDrag(point) {
    const drag = this.drag;
    if (!drag || !point) return;
    this.x = Math.round(drag.x + (point.x - drag.point.x));
    this.y = Math.round(drag.y + (point.y - drag.point.y));
  }

  endDrag() {
    this.drag = null;
  }

  /** The widest the anchor may usefully sit from a frame edge, for the fields. */
  get axisMax() {
    return Math.max(1, this.imageWidth, this.imageHeight) * 2;
  }

  /** Tracking is bounded by the text size, so a gap can never dwarf a letter. */
  get trackingMax() {
    // Never below the slider's own reach, or shrinking the text would leave the
    // current tracking sitting outside a range the control no longer offers.
    return Math.max(40, Math.min(200, Math.round(this.size)));
  }
}

export const textBehind = new TextBehindStore();