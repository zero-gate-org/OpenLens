/**
 * Crop selection, stored in *image* coordinates (natural pixels) so the
 * selection stays correct at every zoom level and the committed canvas is
 * just `width x height` with no resampling maths.
 *
 * All the arithmetic lives in `core/geometry.js`; this file is only state and
 * the intent that ties it to the image on screen.
 */

import {
  MIN_SIZE,
  clamp,
  clampToBounds,
  fitToAspect,
  moveBox,
  resizeBox,
  seedBox,
} from "../core/geometry.js";

export const ASPECT_PRESETS = [
  { id: "free", label: "Free", value: 0 },
  { id: "1:1", label: "1:1", value: 1 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "3:4", label: "3:4", value: 3 / 4 },
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "9:16", label: "9:16", value: 9 / 16 },
];

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

class CropStore {
  /** @type {{x:number,y:number,w:number,h:number} | null} */
  box = $state(null);
  /** 0 = free. */
  aspect = $state(0);
  /** Handle id or "move" while the pointer is down, for affordance styling. */
  handle = $state(null);
  /** Drives the thirds guides. */
  interacting = $state(false);

  imageWidth = $state(0);
  imageHeight = $state(0);

  /**
   * Transient drag bookkeeping. Deliberately not `$state`: it is read only
   * during pointermove and never rendered, so it should not invalidate
   * anything.
   */
  drag = null;

  handles = HANDLES;

  isValid = $derived(
    !!this.box && this.box.w >= MIN_SIZE && this.box.h >= MIN_SIZE,
  );

  right = $derived(this.box ? this.box.x + this.box.w : 0);
  bottom = $derived(this.box ? this.box.y + this.box.h : 0);

  /** Selection size rounded for display and for the panel inputs. */
  rounded = $derived(
    this.box
      ? { w: Math.round(this.box.w), h: Math.round(this.box.h) }
      : { w: 0, h: 0 },
  );

  /** Aspect label for the readout, e.g. "16:9" or "Free". */
  aspectLabel = $derived.by(() => {
    if (this.aspect <= 0) return "Free";
    const preset = ASPECT_PRESETS.find((p) => p.value === this.aspect);
    return preset ? preset.label : "Custom";
  });

  /**
   * Guarantee a valid selection for the image on screen. Re-seeds whenever the
   * underlying image changes, then re-applies any locked ratio.
   */
  sync(width, height) {
    const sameImage = width === this.imageWidth && height === this.imageHeight;
    this.imageWidth = width;
    this.imageHeight = height;

    if (!width || !height) {
      this.box = null;
      return;
    }

    if (!sameImage || !this.box) {
      this.box = seedBox(width, height);
    } else {
      this.box = clampToBounds(this.box, width, height);
    }

    if (this.aspect > 0) this.applyAspect(this.aspect);
  }

  /** Lock a ratio, re-fitting the current selection around its centre. */
  applyAspect(value) {
    this.aspect = value > 0 ? value : 0;
    if (!this.box || this.aspect === 0) return;
    this.box = fitToAspect(this.box, this.aspect, this.imageWidth, this.imageHeight);
  }

  setAspectById(id) {
    const preset = ASPECT_PRESETS.find((p) => p.id === id);
    this.applyAspect(preset ? preset.value : 0);
  }

  /** Set the selection from exact output dimensions, anchored top-left. */
  setSize(w, h) {
    if (!this.box) return;
    const width = clamp(Math.round(w), MIN_SIZE, this.imageWidth);
    const height = clamp(Math.round(h), MIN_SIZE, this.imageHeight);
    this.box = clampToBounds(
      { x: this.box.x, y: this.box.y, w: width, h: height },
      this.imageWidth,
      this.imageHeight,
    );
  }

  // ---------------------------------------------------------------
  // Pointer interaction. `point` is in image coordinates.
  // ---------------------------------------------------------------

  beginDrag(kind, point) {
    if (!this.box) return;
    this.drag = { kind, origin: { ...this.box }, start: { ...point } };
    this.handle = kind;
    this.interacting = true;
  }

  moveDrag(point) {
    if (!this.drag) return;
    const { kind, origin, start } = this.drag;
    this.box =
      kind === "move"
        ? moveBox(origin, start, point, this.imageWidth, this.imageHeight)
        : resizeBox(kind, origin, point, this.imageWidth, this.imageHeight, this.aspect);
  }

  endDrag() {
    this.drag = null;
    this.handle = null;
    this.interacting = false;
  }
}

export const crop = new CropStore();
