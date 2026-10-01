/**
 * Pattern text selection.
 *
 * The panel and the stage layer are two separate component instances of one
 * tool, and they have to agree on the same words, the same measured run and the
 * same pattern tile. That agreement cannot live in either of them, so it lives
 * here: a module level store, mounted and unmounted with the tool.
 *
 * Every value is a decision the operator made, in image pixels or degrees, and
 * the store is the only thing that turns those decisions into a placement. The
 * arithmetic is in two places and neither of them is this file:
 * `core/stroketext.js` owns the text layout, and `core/patternfill.js` owns
 * the tile. Both are pure and unit tested.
 *
 * The measured run arrives from the panel (`setRun`) because measuring needs a
 * canvas and only the panel has one. Nothing here touches the DOM.
 *
 * The placement is deliberately translation only. A pattern fill is about the
 * fill, not about the angle of the words, and a pure translation is what lets
 * the tile's origin be the same number in the SVG layer and on the commit
 * canvas. See the comment in `PatternTextTool.svelte`.
 */

import { fontStack } from "../core/watermarklayout.js";
import { FONT_FAMILIES } from "../core/fonts.js";
import {
  ALIGNMENTS,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  blockLayout,
  defaultTextSize,
  frameOverflow,
  rotationMatrix,
  transformBox,
  wrapGlyphs,
} from "../core/stroketext.js";
import {
  MAX_PATTERN_SCALE,
  MIN_PATTERN_SCALE,
  PATTERN_KINDS,
  VISIBLE_CELL,
  isTooFine,
  patternDef,
} from "../core/patternfill.js";

/**
 * Fonts the browser can actually draw.
 *
 * The app loads no web fonts, so the legacy list (Inter, Montserrat, Oswald,
 * Palatino and a Google Fonts text box) rendered as the fallback on every
 * machine and the control lied about what it was setting. These are either
 * generic or ship with the platform, and each is here because it looks
 * different from the others.
 */
// One shared list, so the three text tools cannot drift apart.
export { FONT_FAMILIES };

export {
  ALIGNMENTS,
  MAX_PATTERN_SCALE,
  MAX_TEXT_SIZE,
  MIN_PATTERN_SCALE,
  MIN_TEXT_SIZE,
  PATTERN_KINDS,
  VISIBLE_CELL,
};

/**
 * Row height as a multiple of the text size.
 *
 * A constant rather than a control: this tool's job is the fill, and the words
 * break where the operator typed a newline. The value goes to `blockLayout`
 * explicitly so it is a visible decision rather than a default that could
 * move under the panel.
 */
const LINE_HEIGHT = 1.2;

const DEFAULTS = {
  text: "Pattern Text",
  family: "system-ui",
  size: 72,
  letterSpacing: 0,
  align: "center",
  color: "#111111",
  pattern: "stripes",
  scale: 1,
  rotationDeg: 0,
};

class PatternTextStore {
  // --- What is being said ------------------------------------------
  text = $state(DEFAULTS.text);
  family = $state(DEFAULTS.family);
  size = $state(DEFAULTS.size);
  letterSpacing = $state(DEFAULTS.letterSpacing);
  align = $state(DEFAULTS.align);

  // --- The pattern ---------------------------------------------------
  /** One of `PATTERN_KINDS`. */
  pattern = $state(DEFAULTS.pattern);
  /** The ink. The gap between marks is left transparent, so the photo shows. */
  color = $state(DEFAULTS.color);
  /** Multiple of the base cell. Clamped, never zero. */
  scale = $state(DEFAULTS.scale);
  /** Which way round the tile sits, in degrees, always `0..360`. */
  rotationDeg = $state(DEFAULTS.rotationDeg);

  // --- Placement ----------------------------------------------------
  /** Anchor in image pixels: the block's centre across and down. */
  x = $state(0);
  y = $state(0);

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

  // --- Derived -------------------------------------------------------

  /** The canvas font shorthand, spelled the same way for the layer and the commit. */
  get font() {
    return fontStack(this.family, {}, this.size);
  }

  /**
   * The run broken into lines.
   *
   * A wrap width of 0 means only the newlines the operator typed break the
   * run. A line wider than the frame is reported rather than silently
   * re-broken, so the words stay the words that were typed.
   */
  lines = $derived(wrapGlyphs(this.run.glyphs, { maxWidth: 0, letterSpacing: this.letterSpacing }));

  /** The whole block, in the text's own frame with the anchor at the origin. */
  block = $derived(
    blockLayout({
      lines: this.lines,
      align: this.align,
      size: this.size,
      lineHeight: LINE_HEIGHT,
      ascent: this.run.ascent,
      descent: this.run.descent,
      letterSpacing: this.letterSpacing,
    }),
  );

  /**
   * The placement.
   *
   * A translation, not a rotation. Both renderers read this same object, and
   * because it has no rotation and no scale in it, the tile's origin inside
   * the block's frame is the tile's origin on the picture, in both.
   */
  matrix = $derived(rotationMatrix({ x: this.x, y: this.y, rotationDeg: 0 }));

  /** The block on the picture, in image pixels. */
  box = $derived(transformBox(this.block.box, this.matrix));

  /** Which edges of the frame the block runs past. Reported, never enforced. */
  overflow = $derived(frameOverflow(this.box, { width: this.imageWidth, height: this.imageHeight }));

  /**
   * The normalised tile: which mark, how big a cell, which way round, in what
   * ink. One definition, read by the layer and by the commit canvas.
   */
  def = $derived(
    patternDef({
      kind: this.pattern,
      scale: this.scale,
      angleDeg: this.rotationDeg,
      color: this.color,
    }),
  );

  /** The cell side in image pixels, after the scale and the floor. */
  cellPx = $derived(this.def.cell);

  /** True when the cell is too small to read as marks at this size. */
  tooFine = $derived(isTooFine(this.def.cell));

  hasText = $derived(this.text.trim() !== "" && this.block.glyphs.length > 0);

  /**
   * Whether there is anything to put in the picture, and if not, why.
   *
   * The reason is a value rather than a note in the markup so that the button
   * and the sentence under it can never disagree about whether Apply is live.
   *
   * Empty words are the only thing that can block it. The cell never reaches
   * zero (`patternCell` floors it), and a tile that is too fine to read is
   * deliberately not a reason either: the operator can see the tile on the
   * stage and the setting is honoured, so it is reported in the panel instead.
   * Refusing to draw it would hide the consequence rather than describe it.
   */
  blockedBy = $derived(!this.hasText ? "Apply needs some words to fill." : null);

  /** True when the composition is incomplete enough to refuse to draw it. */
  blocked = $derived(this.blockedBy !== null);

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
    this.letterSpacing = DEFAULTS.letterSpacing;
    this.align = DEFAULTS.align;
    this.color = DEFAULTS.color;
    this.pattern = DEFAULTS.pattern;
    this.scale = DEFAULTS.scale;
    this.rotationDeg = DEFAULTS.rotationDeg;
    this.size = defaultTextSize(width);
    this.x = Math.round(width / 2);
    this.y = Math.round(height / 2);
  }

  /** Back to the starting composition, on the same image. */
  reset() {
    this.sync(this.imageWidth, this.imageHeight, true);
  }

  // ---------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------

  /** Put the block back in the middle of the picture. */
  centre() {
    this.x = Math.round(this.imageWidth / 2);
    this.y = Math.round(this.imageHeight / 2);
  }

  /**
   * The words are in the pixels now, so stop drawing them.
   *
   * The run is emptied as well as the field: clearing only the field would
   * leave the last measured run on the stage for a frame, drawn on top of the
   * image it was just committed into.
   */
  bake() {
    this.text = "";
    this.run = { glyphs: [], ascent: 0, descent: 0 };
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

export const patternText = new PatternTextStore();