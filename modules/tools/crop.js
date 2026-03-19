import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";

export function destroyCropper() {
  if (state.cropper) {
    state.cropper.destroy();
    state.cropper = null;
  }
}

export function ensureCropper() {
  if (!state.current || state.cropper) return;
  if (!window.Cropper) {
    throw new Error("CropperJS failed to load.");
  }

  if (!dom.cropImage.complete || dom.cropImage.naturalWidth === 0) {
    dom.cropImage.onload = () => {
      dom.cropImage.onload = null;
      ensureCropper();
    };
    return;
  }

  state.cropper = new window.Cropper(dom.cropImage, {
    viewMode: 1,
    dragMode: "move",
    responsive: true,
    background: false,
    autoCropArea: 0.84,
    restore: false,
    ready() {
      const canvasData = this.cropper.getCanvasData();
      const size = Math.min(canvasData.width, canvasData.height) * 0.78;
      const left = canvasData.left + (canvasData.width - size) / 2;
      const top = canvasData.top + (canvasData.height - size) / 2;
      this.cropper.setCropBoxData({ left, top, width: size, height: size });
    },
    crop(event) {
      dom.cropWidth.value = Math.round(event.detail.width);
      dom.cropHeight.value = Math.round(event.detail.height);
    },
  });

  applyAspectRatio();
}

export function applyAspectRatio() {
  if (!state.cropper) return;
  const value = dom.aspectRatio.value;
  state.cropper.setAspectRatio(value === "free" ? NaN : Number(value));
}

export async function applyCrop(commitBlobCallback) {
  if (!state.cropper || !state.current) return;

  await withOperation("Crop", async () => {
    setStatus("Cropping image...", 35);
    const canvas = state.cropper.getCroppedCanvas({
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    });
    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);
    await commitBlobCallback(blob, "Crop", state.current.name);
  }, syncUndoButtons);
}

export function initCropListeners(commitBlobCallback) {
  dom.cropWidth.addEventListener("input", () => {
    if (!state.cropper) return;
    const w = Number(dom.cropWidth.value);
    if (w > 0) state.cropper.setData({ width: w });
  });
  
  dom.cropHeight.addEventListener("input", () => {
    if (!state.cropper) return;
    const h = Number(dom.cropHeight.value);
    if (h > 0) state.cropper.setData({ height: h });
  });
  
  dom.aspectRatio.addEventListener("change", applyAspectRatio);
  dom.applyCrop.addEventListener("click", () => applyCrop(commitBlobCallback));
}
