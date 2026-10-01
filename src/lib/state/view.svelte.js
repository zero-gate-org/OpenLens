/** Stage viewport: zoom, pan and the before/after compare hold. */

class ViewStore {
  /** `null` means "fit to the available area". A number is a multiplier on top. */
  zoom = $state(null);
  /** Screen-space offset in CSS pixels, applied when zoomed past fit. */
  pan = $state({ x: 0, y: 0 });
  /** Written by the stage once it has measured its box. */
  fitScale = $state(1);
  /** True while the compare button is held down. */
  comparing = $state(false);

  scale = $derived(this.fitScale * (this.zoom ?? 1));
  isFit = $derived(this.zoom === null);
  /** Past fit there is overflow worth panning across. */
  canPan = $derived(this.zoom !== null && this.zoom > 1);

  setFit(scale) {
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.fitScale = scale;
    this.clampPan();
  }

  setZoom(next) {
    const clamped = Math.max(0.1, Math.min(8, next));
    this.zoom = Number(clamped.toFixed(3));
    this.clampPan();
  }

  zoomBy(factor) {
    this.setZoom((this.zoom ?? 1) * factor);
  }

  fit() {
    this.zoom = null;
    this.#setPan(0, 0);
  }

  /** Only writes when the value actually moves, so callers can call freely. */
  #setPan(x, y) {
    if (this.pan.x === x && this.pan.y === y) return;
    this.pan = { x, y };
  }

  panBy(dx, dy) {
    if (!this.canPan) return;
    this.#setPan(this.pan.x + dx, this.pan.y + dy);
  }

  clampPan(limit = { w: 0, h: 0 }) {
    if (!this.canPan) {
      this.#setPan(0, 0);
      return;
    }
    this.#setPan(
      Math.max(-limit.w, Math.min(limit.w, this.pan.x)),
      Math.max(-limit.h, Math.min(limit.h, this.pan.y)),
    );
  }
}

export const view = new ViewStore();
