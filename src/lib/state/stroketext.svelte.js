/**
 * Stroke text selection.
 *
 * The panel and the stage layer are two separate component instances of one
 * tool, and they have to agree on the same words, the same style and the same
 * measured run. That agreement cannot live in either of them, so it lives
 * here: a module level store, mounted and unmounted with the tool.
 *
 * Every value is a decision the operator made, in image pixels or degrees, and
 * the store is the only thing that turns those decisions into a placement. The
 * arithmetic itself is in `core/stroketext.js`, which is pure and unit tested.
 *
 * The measured run arrives from the panel (`setRun`) because measuring needs a
 * canvas and only the panel has one. Nothing here touches the DOM.
 */

import { fontStack } from "../core/watermarklayout.js";
import { FONT_FAMILIES } from "../core/fonts.js";
import {
  ALIGNMENTS,
  LINE_JOINS,
  MAX_STROKE_WIDTH,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  PAINT_ORDERS,
  blockLayout,
  clampStrokeWidth,
  defaultTextSize,
  frameOverflow,
  padBox,
  paintOps,
  rotationForPoint,
  rotationMatrix,
  scaledSize,
  transformBox,
  unrotate,
  wrapGlyphs,
} from "../core/stroketext.js";

/**
 * Fonts the browser can actually draw.
 *
 * The app loads no web fonts, so the legacy list (Inter, Oswald, Playfair, a
 * Google Fonts field) rendered as the fallback on every machine and the control
 * lied about what it was setting. These are either generic or ship with the
 * platform, and each is here because it looks different from the others.
 */
// One shared list, so the three text tools cannot drift apart.
export { FONT_FAMILIES };

export { ALIGNMENTS, LINE_JOINS, MAX_STROKE_WIDTH, MAX_TEXT_SIZE, MIN_TEXT_SIZE, PAINT_ORDERS };

const DEFAULTS = {
  text: "Stroke Text",
  family: "system-ui",
  size: 72,
  bold: true,
  italic: false,
  letterSpacing: 0,
  align: "center",
  stroke: true,
  strokeColor: "#000000",
  strokeWidth: 3,
  paintOrder: /** @type {"stroke-first" | "fill-first"} */ ("stroke-first"),
  // Narrower than a plain string because the value reaches SVG's
  // `stroke-linejoin`, which accepts only these three.
  lineJoin: /** @type {"round" | "miter" | "bevel"} */ ("round"),
  fill: true,
  fillColor: "#ffffff",
  opacity: 100,
  maxWidth: 0,
  lineHeight: 1.2,
  rotationDeg: 0,
};

class StrokeTextStore {
  // --- What is being said ------------------------------------------
  text = $state(DEFAULTS.text);
  family = $state(DEFAULTS.family);
  size = $state(DEFAULTS.size);
  bold = $state(DEFAULTS.bold);
  italic = $state(DEFAULTS.italic);
  letterSpacing = $state(DEFAULTS.letterSpacing);
  align = $state(DEFAULTS.align);

  // --- Stroke -------------------------------------------------------
  stroke = $state(DEFAULTS.stroke);
  strokeColor = $state(DEFAULTS.strokeColor);
  /** The full width, centred on the glyph outline. See `paintOps`. */
  strokeWidth = $state(DEFAULTS.strokeWidth);
  paintOrder = $state(DEFAULTS.paintOrder);
  lineJoin = $state(DEFAULTS.lineJoin);

  // --- Fill ---------------------------------------------------------
  fill = $state(DEFAULTS.fill);
  fillColor = $state(DEFAULTS.fillColor);
  opacity = $state(DEFAULTS.opacity);

  // --- Block --------------------------------------------------------
  /** Wrap width in image pixels. 0 is no wrapping, only explicit line breaks. */
  maxWidth = $state(DEFAULTS.maxWidth);
  lineHeight = $state(DEFAULTS.lineHeight);

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

  // --- Derived -------------------------------------------------------

  /** The canvas font shorthand, spelled the same way for the layer and the commit. */
  get font() {
    return fontStack(this.family, { bold: this.bold, italic: this.italic }, this.size);
  }

  /** The run's width, as measured plus the gaps between the glyphs. */
  measuredWidth = $derived(
    this.run.glyphs.reduce((sum, glyph) => sum + Math.max(0, glyph.width || 0), 0) +
      (this.run.glyphs.length > 1 ? this.letterSpacing * (this.run.glyphs.length - 1) : 0),
  );

  /** The run broken into lines at the current wrap width. */
  lines = $derived(wrapGlyphs(this.run.glyphs, { maxWidth: this.maxWidth, letterSpacing: this.letterSpacing }));

  /** The whole block, in the text's own frame with the anchor at the origin. */
  block = $derived(
    blockLayout({
      lines: this.lines,
      align: this.align,
      size: this.size,
      lineHeight: this.lineHeight,
      ascent: this.run.ascent,
      descent: this.run.descent,
      letterSpacing: this.letterSpacing,
    }),
  );

  /** The placement. Both renderers read this, so neither can invent its own. */
  matrix = $derived(rotationMatrix({ x: this.x, y: this.y, rotationDeg: this.rotationDeg }));

  /**
   * The stroke width the two renderers actually use.
   *
   * One clamp, one place, so the layer's `stroke-width` and the commit's
   * `lineWidth` can never be two different numbers for the same composition.
   */
  paintWidth = $derived(clampStrokeWidth(this.strokeWidth));

  /**
   * A stroke is on only when it is switched on *and* has a width.
   *
   * A width of 0 is a real setting and it means no outline, so this is false
   * even with the stroke switched on, and there is nothing to pad the box for.
   */
  hasStroke = $derived(this.stroke && this.paintWidth > 0);

  /**
   * The block on the picture, in image pixels, with the stroke's reach added.
   *
   * A stroke is centred on the outline, so exactly half of it falls outside the
   * letter whichever order it is drawn in. Half the width, then, is the honest
   * amount to grow the box by.
   */
  box = $derived(padBox(transformBox(this.block.box, this.matrix), this.hasStroke ? this.paintWidth / 2 : 0));

  /** Which edges of the frame the block runs past. Reported, never enforced. */
  overflow = $derived(frameOverflow(this.box, { width: this.imageWidth, height: this.imageHeight }));

  /** The draw operations, in order. A width of 0 contributes no stroke op. */
  ops = $derived(paintOps({ paintOrder: this.paintOrder, strokeWidth: this.strokeWidth, fill: this.fill }));

  hasText = $derived(this.text.trim() !== "" && this.block.glyphs.length > 0);

  /**
   * Whether there is anything to put in the picture, and if not, why.
   *
   * The reason is a value rather than a note in the markup so that the button
   * and the sentence under it can never disagree about whether Apply is live.
   */
  blockedBy = $derived(
    !this.hasText
      ? "Apply needs some words to stroke."
      : !this.fill && !this.hasStroke
        ? "Fill and stroke are both off, so there is nothing to draw."
        : this.opacity <= 0
          ? "Opacity is 0%, so there is nothing to draw."
          : null,
  );

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
    this.bold = DEFAULTS.bold;
    this.italic = DEFAULTS.italic;
    this.letterSpacing = DEFAULTS.letterSpacing;
    this.align = DEFAULTS.align;
    this.stroke = DEFAULTS.stroke;
    this.strokeColor = DEFAULTS.strokeColor;
    this.strokeWidth = DEFAULTS.strokeWidth;
    this.paintOrder = DEFAULTS.paintOrder;
    this.lineJoin = DEFAULTS.lineJoin;
    this.fill = DEFAULTS.fill;
    this.fillColor = DEFAULTS.fillColor;
    this.opacity = DEFAULTS.opacity;
    this.maxWidth = DEFAULTS.maxWidth;
    this.lineHeight = DEFAULTS.lineHeight;
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

  beginDrag(kind, point) {
    this.drag = {
      kind,
      point,
      x: this.x,
      y: this.y,
      size: this.size,
      // The scale handle measures along the block's own axis, so a corner
      // dragged on rotated text still tracks the pointer.
      local: unrotate({ x: this.x, y: this.y, rotationDeg: this.rotationDeg }, point),
    };
  }

  moveDrag(point) {
    const drag = this.drag;
    if (!drag || !point) return;

    if (drag.kind === "move") {
      this.x = Math.round(drag.x + (point.x - drag.point.x));
      this.y = Math.round(drag.y + (point.y - drag.point.y));
      return;
    }

    if (drag.kind === "rotate") {
      this.rotationDeg = Math.round(rotationForPoint({ x: drag.x, y: drag.y }, point));
      return;
    }

    // Scale. Measured from where the drag started, never from the current
    // size, which the re-measurement is already changing underneath it.
    const here = unrotate({ x: drag.x, y: drag.y, rotationDeg: this.rotationDeg }, point);
    this.size = Math.round(
      scaledSize(here.x, drag.local.x, drag.size, MIN_TEXT_SIZE, MAX_TEXT_SIZE),
    );
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

  /** The wrap width cannot usefully exceed the frame it wraps for. */
  get maxWidthMax() {
    return Math.max(200, Math.round(Math.max(this.imageWidth, this.imageHeight) * 1.5));
  }
}

export const strokeText = new StrokeTextStore();
