/**
 * Curved text selection.
 *
 * The panel and the stage layer are two separate component instances of one
 * tool, and they have to agree on the same words, the same arc and the same
 * measured run. That agreement cannot live in either of them, so it lives
 * here: a module level store, mounted and unmounted with the tool.
 *
 * Every value is a decision the operator made, in image pixels or degrees, and
 * the store is the only thing that turns those decisions into a placement. The
 * arithmetic itself is in `core/textarc.js`, which is pure and unit tested.
 *
 * The measured run arrives from the panel (`setRun`) because measuring needs a
 * canvas and only the panel has one. Nothing here touches the DOM.
 */

import { fontStack } from "../core/watermarklayout.js";
import { FONT_FAMILIES } from "../core/fonts.js";
import {
  arcLayout,
  alongForPoint,
  clamp,
  fitRadius,
  normalizeAngle,
  totalSweep,
} from "../core/textarc.js";

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

/** `above` reads over the top of the circle, `below` under the bottom. */
export const SIDES = [
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
];

/** Where the run sits relative to the arc's start angle. */
export const ANCHORS = [
  { value: "start", label: "Start" },
  { value: "middle", label: "Middle" },
  { value: "end", label: "End" },
];

const DEFAULTS = {
  text: "Curved Text",
  family: "system-ui",
  size: 48,
  bold: false,
  italic: false,
  letterSpacing: 0,
  color: "#ffffff",
  outline: false,
  outlineColor: "#000000",
  outlineWidth: 2,
  side: "above",
  anchor: "middle",
  sweep: 120,
  along: 0,
};

const DEG = Math.PI / 180;

/** Text is sized against the picture, not in absolute pixels. */
const sizeForWidth = (width) => clamp(Math.round(width * 0.05), 12, 240);

class CurvedTextStore {
  // --- What is being said ------------------------------------------
  text = $state(DEFAULTS.text);
  family = $state(DEFAULTS.family);
  size = $state(DEFAULTS.size);
  bold = $state(DEFAULTS.bold);
  italic = $state(DEFAULTS.italic);
  letterSpacing = $state(DEFAULTS.letterSpacing);
  color = $state(DEFAULTS.color);
  outline = $state(DEFAULTS.outline);
  outlineColor = $state(DEFAULTS.outlineColor);
  outlineWidth = $state(DEFAULTS.outlineWidth);

  // --- The arc ------------------------------------------------------
  /** `above` walks the circle one way, `below` the other. */
  side = $state(DEFAULTS.side);
  anchor = $state(DEFAULTS.anchor);
  /** Arc centre, in image pixels. */
  cx = $state(0);
  cy = $state(0);
  radius = $state(0);
  /** The declared arc the run is fitted against, in degrees. */
  sweep = $state(DEFAULTS.sweep);
  /** Where the declared arc starts, in degrees. */
  arcStartDeg = $state(-90);
  /** Slide the run along the arc, in degrees. */
  alongDeg = $state(DEFAULTS.along);

  // --- Measured, from the panel's canvas ----------------------------
  run = $state({ glyphs: [], total: 0 });

  // --- The image on stage -------------------------------------------
  imageWidth = $state(0);
  imageHeight = $state(0);

  /**
   * Set when the radius should follow from the next measurement rather than
   * from the operator. Transient bookkeeping, deliberately not `$state`: it is
   * never rendered.
   */
  pendingFit = false;

  /**
   * Transient drag bookkeeping. Also not `$state`: read only during
   * pointermove, never rendered, so it should invalidate nothing.
   */
  drag = null;

  // --- Derived -------------------------------------------------------

  direction = $derived(this.side === "below" ? -1 : 1);
  arcStartRad = $derived(this.arcStartDeg * DEG);

  /** How far a radius may go before it is off the picture and pointless. */
  maxRadius = $derived(
    Math.max(160, Math.round(Math.max(this.imageWidth, this.imageHeight) * 1.5)),
  );

  /** The arc the run actually occupies at the current radius. */
  textSweepRad = $derived(totalSweep(this.run.total, this.radius));

  /** The same, in degrees, for readouts and controls. */
  textSweepDeg = $derived(this.textSweepRad / DEG);

  hasText = $derived(this.text.trim() !== "" && this.run.glyphs.length > 0);

  /**
   * Whether the run fits the declared arc.
   *
   * False does not shorten or clip anything: the run is always drawn in full
   * and the panel says so, because a word that silently vanished off the end
   * of a curve is worse than one that runs long.
   */
  fits = $derived(
    !this.hasText || this.textSweepDeg <= this.sweep + 0.5,
  );

  /** The canvas font shorthand, spelled the same way for the layer and the commit. */
  get font() {
    return fontStack(this.family, { bold: this.bold, italic: this.italic }, this.size);
  }

  placement = $derived(
    arcLayout({
      cx: this.cx,
      cy: this.cy,
      radius: this.radius,
      direction: this.direction,
      arcStartDeg: this.arcStartDeg,
      alongDeg: this.alongDeg,
      anchor: this.anchor,
      glyphs: this.run.glyphs,
      letterSpacing: this.letterSpacing,
      total: this.run.total,
    }),
  );

  /**
   * The handle the operator drags, which is the leading edge of the run.
   *
   * `arcLayout` reports it, and `alongForPoint` reads a slide back out of it,
   * so what the pointer grabs and where the words land are the same point by
   * construction rather than by two calculations agreeing.
   */
  handle = $derived(this.placement.head);

  // ---------------------------------------------------------------
  // Measurement
  // ---------------------------------------------------------------

  /** Called by the panel whenever the run has to be measured again. */
  setRun(run) {
    this.run = { glyphs: run.glyphs, total: run.total };
  }

  // ---------------------------------------------------------------
  // Seeding
  // ---------------------------------------------------------------

  /**
   * Re-seed for the image on stage.
   *
   * Called once per mount, so leaving the tool and coming back starts from
   * the same place rather than from an arc left over an image that may have
   * been committed or undone in the meantime. The panel re-measures and calls
   * `fitPending` straight after, because the radius can only be fitted from a
   * measurement of the run.
   */
  sync(width, height, force = false) {
    if (!width || !height) {
      this.imageWidth = 0;
      this.imageHeight = 0;
      this.run = { glyphs: [], total: 0 };
      this.radius = 0;
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
    this.color = DEFAULTS.color;
    this.outline = DEFAULTS.outline;
    this.outlineColor = DEFAULTS.outlineColor;
    this.outlineWidth = DEFAULTS.outlineWidth;
    this.side = DEFAULTS.side;
    this.anchor = DEFAULTS.anchor;
    this.sweep = DEFAULTS.sweep;
    this.alongDeg = DEFAULTS.along;
    this.size = sizeForWidth(width);
    this.cx = Math.round(width / 2);
    this.cy = Math.round(height / 2);
    this.arcStartDeg = DEFAULTS.side === "below" ? 90 : -90;
    this.radius = Math.round(Math.max(width, height) * 0.4);
    this.pendingFit = true;
  }

  /** Back to the starting composition, on the same image. */
  reset() {
    this.sync(this.imageWidth, this.imageHeight, true);
  }

  /** Raise or lower the radius until the run exactly fills the declared arc. */
  fitRadius() {
    const wanted = fitRadius(this.run.total, this.sweep);
    // An arc with no length cannot hold the run at any radius, so the honest
    // result is a straight line rather than an impossible circle.
    if (!Number.isFinite(wanted) || wanted <= 0) {
      this.radius = 0;
      return;
    }
    this.radius = Math.round(clamp(wanted, 1, this.maxRadius));
  }

  /** Fit the radius, once, if a seed is waiting on a measurement. */
  fitPending() {
    if (!this.pendingFit) return;
    this.pendingFit = false;
    if (this.run.total <= 0) return;
    this.fitRadius();
  }

  // ---------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------

  /**
   * Flip which side of the circle the run sits on.
   *
   * The start angle flips with it, so the words stay in the same part of the
   * picture instead of travelling to the far side of the centre.
   */
  setSide(side) {
    if (side === this.side) return;
    this.side = side;
    this.arcStartDeg = normalizeAngle(side === "below" ? 90 : -90);
    this.alongDeg = normalizeAngle(-this.alongDeg);
  }

  setAlong(deg) {
    this.alongDeg = normalizeAngle(deg);
  }

  nudgeAlong(deg) {
    this.alongDeg = normalizeAngle(this.alongDeg + (Number(deg) || 0));
  }

  /**
   * The run is in the pixels now, so stop drawing it.
   *
   * The run is emptied as well as the field: clearing only the field would
   * leave the last measured run on the stage for a frame, drawn on top of the
   * image it was just committed into.
   */
  bake() {
    this.text = "";
    this.run = { glyphs: [], total: 0 };
  }

  // ---------------------------------------------------------------
  // Pointer interaction. `point` is in image coordinates.
  // ---------------------------------------------------------------

  beginDrag(kind, point) {
    this.drag = { kind, start: point };
  }

  moveDrag(point) {
    if (!this.drag) return;

    if (this.drag.kind === "centre") {
      this.cx = Math.round(point.x);
      this.cy = Math.round(point.y);
      return;
    }

    this.alongDeg = alongForPoint({
      cx: this.cx,
      cy: this.cy,
      arcStartDeg: this.arcStartDeg,
      anchor: this.anchor,
      textSweep: this.textSweepRad,
      direction: this.direction,
      x: point.x,
      y: point.y,
    });
  }

  endDrag() {
    this.drag = null;
  }
}

export const curvedText = new CurvedTextStore();
