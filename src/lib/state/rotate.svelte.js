/**
 * Pending transform for the rotate tool.
 *
 * Non-destructive by design: the stage previews the angle, and only "Apply"
 * burns a history step. The old editor rotated destructively on every click,
 * which made fine angles a click-then-undo gamble.
 */

const SNAP = 90;

class RotateStore {
  angle = $state(0);
  flipX = $state(false);
  flipY = $state(false);

  isClean = $derived(this.angle === 0 && !this.flipX && !this.flipY);

  reset() {
    this.angle = 0;
    this.flipX = false;
    this.flipY = false;
  }

  /**
   * Stored raw (not wrapped to 0-360) so the slider can span a signed
   * -180..180 range. Consumers normalise via `normalizeAngle`.
   */
  setAngle(deg) {
    const n = Number(deg);
    if (Number.isFinite(n)) this.angle = n;
  }

  nudge(delta) {
    this.setAngle(this.angle + delta);
  }

  turn(quarter) {
    this.setAngle(this.angle + quarter * SNAP);
  }

  /** Toggle a flip, negating the angle when the horizontal axis is engaged. */
  toggleFlip(axis) {
    if (axis === "x") {
      this.flipX = !this.flipX;
      if (this.flipX) this.angle = -this.angle;
    } else {
      this.flipY = !this.flipY;
    }
  }
}

export const rotate = new RotateStore();
