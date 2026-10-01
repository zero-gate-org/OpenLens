/**
 * Rotation / flip geometry.
 *
 * The same numbers drive the CSS preview on the stage and the canvas render
 * that gets committed, so what the operator sees is exactly what is written.
 */

/** Snap near-quarter-turns so 90 degrees never picks up float dust. */
export function normalizeAngle(angle) {
  const n = (((Number(angle) || 0) % 360) + 360) % 360;
  const quarter = (Math.round(n / 90) % 4) * 90;
  return Math.abs(n - quarter) < 0.01 ? quarter : n;
}

/** Display box for a rotated image: the axis-aligned bounding rectangle. */
export function bboxFor(width, height, angle) {
  const a = normalizeAngle(angle);
  if (a === 90 || a === 270) return { w: height, h: width };
  if (a === 0 || a === 180) return { w: width, h: height };

  const rad = (a * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  return {
    w: Math.max(1, Math.ceil(width * cos + height * sin)),
    h: Math.max(1, Math.ceil(width * sin + height * cos)),
  };
}

/** Human label for a pending transform, e.g. "90°" or "31.5°". */
export function angleLabel(angle) {
  const a = normalizeAngle(angle);
  const rounded = Math.round(a * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}°`;
}

export function cssTransform({ angle = 0, flipX = false, flipY = false } = {}) {
  const parts = [];
  if (angle) parts.push(`rotate(${normalizeAngle(angle)}deg)`);
  if (flipX || flipY) parts.push(`scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`);
  return parts.length ? parts.join(" ") : "none";
}

/**
 * Paint a transformed image onto a fresh canvas of the correct size.
 * Transparent gaps left by a non-quarter turn stay transparent, which is
 * what an operator expects and what PNG/WebP can represent.
 */
export function renderTransform(image, { angle = 0, flipX = false, flipY = false }) {
  const a = normalizeAngle(angle);
  const canvas = document.createElement("canvas");
  const box = bboxFor(image.naturalWidth, image.naturalHeight, a);
  canvas.width = box.w;
  canvas.height = box.h;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("This browser blocked a 2D canvas context.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.translate(box.w / 2, box.h / 2);
  ctx.rotate((a * Math.PI) / 180);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

  return canvas;
}
