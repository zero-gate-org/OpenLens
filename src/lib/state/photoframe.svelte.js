/**
 * Photo frame settings.
 *
 * The panel owns the decode and the paint, so this store holds decisions only:
 * the edges, the mat, the shadow, the caption and the presets. The arithmetic
 * that turns decisions into a picture box is in `core/framegeom.js`, which is
 * pure and unit tested.
 *
 * There is deliberately no stage layer here. A frame *grows* the picture, so it
 * cannot be drawn over the picture the way `StickersLayer` or
 * `CurvedTextLayer` do: the border lies outside the image box the stage scales
 * and fits. `PhotoFrameLayer.svelte` is therefore the panel's own preview
 * surface, not something registered with `editor.setStageLayer`. See the header
 * of that file for the measurements from `Stage.svelte` that settled it.
 *
 * One shared font list: the app loads no web fonts, so the caption offers only
 * families the browser can actually draw. See `core/fonts.js`.
 */

import { DEFAULT_FONT, FONT_FAMILIES } from "../core/fonts.js";
import { estimateTextWidth, fontStack } from "../core/watermarklayout.js";
import {
  MAX_OUTPUT_PIXELS,
  MAX_OUTPUT_SIDE,
  captionBand,
  captionLayout,
  cleanBorders,
  cleanPixels,
  frameGeometry,
  isIdentity,
  sameBorders,
  uniformBorders,
} from "../core/framegeom.js";

// One shared list, so the four text tools cannot drift apart.
export { FONT_FAMILIES };

export const ALIGNS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];

/**
 * Presets are written for a picture this wide.
 *
 * The controls are in pixels, but a 30 px border is a hair on a 6000 px photo
 * and a slab on a thumbnail, so a preset scales its numbers to the picture it is
 * being applied to. Every number it sets lands in a visible control, so nothing
 * is hidden: what the operator sees after pressing a preset is the whole truth.
 */
export const PRESET_REFERENCE_WIDTH = 1200;

const scale = (value, width) => Math.max(0, Math.round((Number(value) || 0) * (width / PRESET_REFERENCE_WIDTH)));

/**
 * Starting looks.
 *
 * Each one is only a bundle of the numbers the panel already exposes, which is
 * what keeps them honest: there is no decoration here that the operator cannot
 * see or change.
 */
export const PRESETS = [
  {
    name: "Polaroid",
    uniform: false,
    edges: { top: 40, right: 40, bottom: 150, left: 40 },
    bgColor: "#f7f5f2",
    transparentBg: false,
    cornerRadius: 2,
    shadowEnabled: true,
    shadowBlur: 28,
    shadowX: 6,
    shadowY: 14,
    shadowOpacity: 35,
    captionText: "Summer 2026",
    captionDate: false,
    captionSize: 30,
    captionPosition: 50,
  },
  {
    name: "Vintage",
    uniform: true,
    edges: { top: 44, right: 44, bottom: 44, left: 44 },
    bgColor: "#e6dccb",
    transparentBg: false,
    cornerRadius: 1,
    shadowEnabled: true,
    shadowBlur: 18,
    shadowX: 4,
    shadowY: 8,
    shadowOpacity: 28,
    captionText: "",
    captionDate: true,
    captionSize: 22,
    captionPosition: 50,
  },
  {
    name: "Film reel",
    uniform: false,
    edges: { top: 24, right: 90, bottom: 24, left: 90 },
    bgColor: "#111111",
    transparentBg: false,
    cornerRadius: 0,
    shadowEnabled: false,
    shadowBlur: 0,
    shadowX: 0,
    shadowY: 0,
    shadowOpacity: 0,
    captionText: "",
    captionDate: false,
    captionSize: 16,
    captionPosition: 50,
  },
  {
    name: "Passport",
    uniform: true,
    edges: { top: 22, right: 22, bottom: 22, left: 22 },
    bgColor: "#fdfdfd",
    transparentBg: false,
    cornerRadius: 0,
    shadowEnabled: false,
    shadowBlur: 0,
    shadowX: 0,
    shadowY: 0,
    shadowOpacity: 0,
    captionText: "",
    captionDate: false,
    captionSize: 16,
    captionPosition: 50,
  },
  {
    name: "Cut out",
    uniform: true,
    edges: { top: 0, right: 0, bottom: 0, left: 0 },
    bgColor: "#ffffff",
    transparentBg: true,
    cornerRadius: 24,
    shadowEnabled: true,
    shadowBlur: 22,
    shadowX: 0,
    shadowY: 10,
    shadowOpacity: 45,
    captionText: "",
    captionDate: false,
    captionSize: 16,
    captionPosition: 50,
  },
];

const DEFAULTS = {
  uniform: true,
  uniformSize: 32,
  edges: { top: 32, right: 32, bottom: 32, left: 32 },
  bgColor: "#ffffff",
  transparentBg: false,
  cornerRadius: 0,
  shadowEnabled: true,
  shadowColor: "#000000",
  shadowBlur: 20,
  shadowX: 0,
  shadowY: 10,
  shadowOpacity: 35,
  captionText: "",
  captionDate: false,
  captionFamily: DEFAULT_FONT,
  captionSize: 24,
  captionColor: "#222222",
  captionAlign: "center",
  captionBold: false,
  captionItalic: false,
  captionPosition: 50,
};

class PhotoFrameStore {
  // --- Edges --------------------------------------------------------
  /** One width for all four sides, or one width each. */
  uniform = $state(DEFAULTS.uniform);
  /** The shared width, used while `uniform` is on. */
  uniformSize = $state(DEFAULTS.uniformSize);
  /** The four widths, used while `uniform` is off. */
  edges = $state({ ...DEFAULTS.edges });

  // --- The mat ------------------------------------------------------
  bgColor = $state(DEFAULTS.bgColor);
  transparentBg = $state(DEFAULTS.transparentBg);
  cornerRadius = $state(DEFAULTS.cornerRadius);

  // --- Shadow -------------------------------------------------------
  shadowEnabled = $state(DEFAULTS.shadowEnabled);
  shadowColor = $state(DEFAULTS.shadowColor);
  shadowBlur = $state(DEFAULTS.shadowBlur);
  shadowX = $state(DEFAULTS.shadowX);
  shadowY = $state(DEFAULTS.shadowY);
  shadowOpacity = $state(DEFAULTS.shadowOpacity);

  // --- Caption ------------------------------------------------------
  captionText = $state(DEFAULTS.captionText);
  captionDate = $state(DEFAULTS.captionDate);
  captionFamily = $state(DEFAULTS.captionFamily);
  captionSize = $state(DEFAULTS.captionSize);
  captionColor = $state(DEFAULTS.captionColor);
  captionAlign = $state(DEFAULTS.captionAlign);
  captionBold = $state(DEFAULTS.captionBold);
  captionItalic = $state(DEFAULTS.captionItalic);
  captionPosition = $state(DEFAULTS.captionPosition);

  /**
   * Today's date, written once when the panel mounts.
   *
   * Derived here rather than on every render so the caption cannot change under
   * the operator at midnight, which is exactly the sort of thing that makes a
   * preview stop matching the export.
   */
  today = $state("");

  // --- The image on stage -------------------------------------------
  imageWidth = $state(0);
  imageHeight = $state(0);

  // --- Measurement --------------------------------------------------
  /**
   * Width measurement for a caption line, installed by the panel.
   *
   * Plain rather than `$state` because it is a function, not a value. The bump
   * below is what tells the caption layout to look again once it exists.
   */
  measure = null;
  measureEpoch = $state(0);

  // --- Derived ------------------------------------------------------

  /** The edges as they will be drawn, uniform or not. */
  borders = $derived(this.uniform ? uniformBorders(this.uniformSize) : cleanBorders(this.edges));

  /** Output size, opening, clamped radius and whether anything was clamped. */
  geometry = $derived(
    frameGeometry({
      width: this.imageWidth,
      height: this.imageHeight,
      borders: this.borders,
      cornerRadius: this.cornerRadius,
    }),
  );

  /** The strip of frame under the picture, or null when there is no bottom edge. */
  band = $derived(captionBand({ opening: this.geometry.opening, borders: this.geometry.borders }));

  /**
   * The canvas shorthand for one caption line, at its own fitted size.
   *
   * `date` lines are italic and never bold. Building the shorthand at the size
   * being measured and the size being drawn is not a detail: a width taken with
   * the wrong size is the width of some other mark.
   */
  fontFor(size, date = false) {
    return fontStack(
      this.captionFamily,
      date ? { italic: true } : { bold: this.captionBold, italic: this.captionItalic },
      size,
    );
  }

  /**
   * Whether a size belongs to the date line rather than the caption.
   *
   * The date is always asked for at a fraction of the caption's size, so the
   * only time this is wrong is when both have been squeezed to the same floor,
   * and then it measures the date with the caption's weight and errs wide.
   */
  isDateSize(size) {
    return size < this.captionSize;
  }

  /** The resolved caption, measured against the band. */
  caption = $derived.by(() => {
    void this.measureEpoch;
    return captionLayout({
      band: this.band,
      text: this.captionText,
      date: this.captionDate ? this.today : "",
      size: this.captionSize,
      align: this.captionAlign,
      position: this.captionPosition,
      measure: (text, size) => this.measureCaption(text, size),
    });
  });

  /** Whether there is anything at all in the caption band. */
  hasCaption = $derived(!!this.caption.primary || !!this.caption.secondary);

  /**
   * A transparent mat has no body, so it has nothing to cast a shadow from.
   * Stated here so the panel can say why the shadow is off rather than showing
   * a control that quietly does nothing.
   */
  shadowDrawn = $derived(this.shadowEnabled && this.shadowOpacity > 0 && !this.transparentBg);

  /** True when these settings would hand the picture straight back. */
  identity = $derived(
    isIdentity({
      borders: this.borders,
      cornerRadius: this.cornerRadius,
      shadowEnabled: this.shadowEnabled,
      shadowOpacity: this.shadowOpacity,
      transparentBg: this.transparentBg,
    }),
  );

  // --- Seeding ------------------------------------------------------

  /**
   * Attach to the picture on stage.
   *
   * Called once per mount. A different picture means every pixel number in the
   * panel now describes something else, so the decisions are seeded again
   * against the new size rather than carried over.
   */
  sync(width, height, force = false) {
    if (!width || !height) {
      this.imageWidth = 0;
      this.imageHeight = 0;
      return;
    }
    if (!force && width === this.imageWidth && height === this.imageHeight) return;
    this.imageWidth = width;
    this.imageHeight = height;
    this.seed(width);
  }

  /** The starting look for a picture this wide. */
  seed(width) {
    this.uniform = DEFAULTS.uniform;
    this.uniformSize = scale(DEFAULTS.uniformSize, width) || DEFAULTS.uniformSize;
    this.edges = this.scaledEdges(DEFAULTS.edges, width);
    this.bgColor = DEFAULTS.bgColor;
    this.transparentBg = DEFAULTS.transparentBg;
    this.cornerRadius = DEFAULTS.cornerRadius;
    this.shadowEnabled = DEFAULTS.shadowEnabled;
    this.shadowColor = DEFAULTS.shadowColor;
    this.shadowBlur = scale(DEFAULTS.shadowBlur, width);
    this.shadowX = scale(DEFAULTS.shadowX, width);
    this.shadowY = scale(DEFAULTS.shadowY, width);
    this.shadowOpacity = DEFAULTS.shadowOpacity;
    this.captionText = DEFAULTS.captionText;
    this.captionDate = DEFAULTS.captionDate;
    this.captionFamily = DEFAULTS.captionFamily;
    this.captionSize = scale(DEFAULTS.captionSize, width) || DEFAULTS.captionSize;
    this.captionColor = DEFAULTS.captionColor;
    this.captionAlign = DEFAULTS.captionAlign;
    this.captionBold = DEFAULTS.captionBold;
    this.captionItalic = DEFAULTS.captionItalic;
    this.captionPosition = DEFAULTS.captionPosition;
  }

  /** Back to the starting look, on the same picture. */
  reset() {
    if (this.imageWidth) this.seed(this.imageWidth);
  }

  /**
   * The edges a preset asks for, sized for this picture.
   *
   * The preset stores the four widths; a uniform preset keeps them uniform and
   * only one of them is used, so the panel shows a single Border slider.
   */
  scaledEdges(edges, width) {
    return {
      top: scale(edges?.top, width),
      right: scale(edges?.right, width),
      bottom: scale(edges?.bottom, width),
      left: scale(edges?.left, width),
    };
  }

  /** Put a preset on the picture. Every preset field lands in a visible control. */
  usePreset(preset) {
    const width = this.imageWidth || PRESET_REFERENCE_WIDTH;
    this.uniform = preset.uniform;
    this.edges = this.scaledEdges(preset.edges, width);
    this.uniformSize = scale(preset.edges.top, width);
    this.bgColor = preset.bgColor;
    this.transparentBg = preset.transparentBg;
    this.cornerRadius = scale(preset.cornerRadius, width);
    this.shadowEnabled = preset.shadowEnabled;
    this.shadowBlur = scale(preset.shadowBlur, width);
    this.shadowX = scale(preset.shadowX, width);
    this.shadowY = scale(preset.shadowY, width);
    this.shadowOpacity = preset.shadowOpacity;
    this.captionText = preset.captionText;
    this.captionDate = preset.captionDate;
    this.captionSize = scale(preset.captionSize, width);
    this.captionPosition = preset.captionPosition;
  }

  /** The preset these settings match, or -1. Drives the chip highlight. */
  presetIndex = $derived.by(() => {
    const width = this.imageWidth || PRESET_REFERENCE_WIDTH;
    return PRESETS.findIndex((preset) => {
      const edges = this.scaledEdges(preset.edges, width);
      const wanted = preset.uniform ? uniformBorders(edges.top) : edges;
      if (this.uniform !== preset.uniform) return false;
      if (!sameBorders(this.borders, wanted)) return false;
      if (this.transparentBg !== preset.transparentBg) return false;
      if (this.bgColor.toLowerCase() !== preset.bgColor.toLowerCase()) return false;
      if (cleanPixels(this.cornerRadius) !== scale(preset.cornerRadius, width)) return false;
      if (this.shadowEnabled !== preset.shadowEnabled) return false;
      if (this.shadowOpacity !== preset.shadowOpacity) return false;
      if (cleanPixels(this.shadowBlur) !== scale(preset.shadowBlur, width)) return false;
      if (cleanPixels(this.shadowX) !== scale(preset.shadowX, width)) return false;
      if (cleanPixels(this.shadowY) !== scale(preset.shadowY, width)) return false;
      if (cleanPixels(this.captionSize) !== scale(preset.captionSize, width)) return false;
      if (cleanPixels(this.captionPosition) !== scale(preset.captionPosition, width)) return false;
      if (this.captionDate !== preset.captionDate) return false;
      if (this.captionText !== preset.captionText) return false;
      return true;
    });
  });

  // --- Measurement --------------------------------------------------

  /**
   * Install the panel's width measurement.
   *
   * Measuring needs a 2D context and only the panel has one. The bump is what
   * re-runs the caption layout, because the function itself is not reactive.
   */
  setMeasure(fn) {
    this.measure = typeof fn === "function" ? fn : null;
    this.measureEpoch += 1;
  }

  /**
   * Width of one caption line at one size, in pixels.
   *
   * Before the panel has installed a context the estimate stands in, so the
   * first layout is already the right shape rather than a run of zeroes that
   * read as "fits perfectly".
   */
  measureCaption(text, size) {
    if (!this.measure) return estimateTextWidth(text, size);
    return Number(this.measure(text, size)) || 0;
  }

  // --- Range for the controls ---------------------------------------

  /** How wide a border may usefully be on this picture before it is absurd. */
  get borderMax() {
    const width = Math.max(this.imageWidth, this.imageHeight) || 1200;
    return Math.max(64, Math.min(MAX_OUTPUT_SIDE, Math.round(width)));
  }

  /** Why Apply is unavailable, or null when it is available. */
  blockedBy = $derived(
    this.imageWidth === 0
      ? "No picture on stage to frame."
      : this.identity
        ? "Every border is zero, so this would hand the picture straight back. Add a border, a shadow or a corner radius."
        : null,
  );

  /** Facts the panel says out loud rather than leaving the operator to guess. */
  notes = $derived.by(() => {
    const out = [];
    const g = this.geometry;

    if (g.overArea) {
      out.push({
        tone: "warn",
        text: `This picture is already over the ${MAX_OUTPUT_PIXELS} pixel ceiling for an export, so no frame was added.`,
      });
    } else if (g.limited) {
      out.push({
        tone: "warn",
        text: `Borders were reduced so the export stays within ${MAX_OUTPUT_SIDE} px on a side and ${(MAX_OUTPUT_PIXELS / 1e6).toFixed(0)} megapixels in total.`,
      });
    }

    if (g.radiusClamped) {
      out.push({
        tone: "warn",
        text: `Corner radius is held at half the shorter side, ${Math.round(g.radius)} px, so the corners cannot fold in.`,
      });
    }

    const cap = this.caption;
    if (cap.tooWide) {
      out.push({
        tone: "warn",
        text: "The caption is wider than the band even at its smallest size. It is cut at both ends. Make the bottom border wider or the type smaller.",
      });
    }
    if (cap.dropped.includes("date")) {
      out.push({
        tone: "warn",
        text: "The bottom band is too short for the caption and its date together, so the date was left out.",
      });
    }
    if (cap.dropped.includes("text")) {
      out.push({
        tone: "warn",
        text: "The bottom band is too short for the caption, so no caption is drawn. Nothing is written over the picture.",
      });
    }
    if (cap.shrunk && !cap.dropped.length && (cap.primary || cap.secondary)) {
      out.push({
        tone: "warn",
        text: `The caption was reduced to ${Math.round(cap.primary?.size ?? cap.secondary.size)} px to fit the bottom band. Widen the bottom border to keep it larger.`,
      });
    }
    if (this.captionText.trim() && !this.band) {
      out.push({
        tone: "warn",
        text: "The bottom border is zero, so there is no band to hold the caption. Give the bottom edge a width.",
      });
    }

    return out;
  });
}

export const photoFrame = new PhotoFrameStore();