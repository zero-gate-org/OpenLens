import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";

export function syncLockedDimensions(from) {
  if (!state.current || !dom.lockRatio.checked) return;
  const ratio = state.current.width / state.current.height;

  if (from === "width") {
    const width = Number(dom.resizeWidth.value);
    if (Number.isFinite(width) && width > 0) {
      dom.resizeHeight.value = Math.max(1, Math.round(width / ratio));
    }
  }

  if (from === "height") {
    const height = Number(dom.resizeHeight.value);
    if (Number.isFinite(height) && height > 0) {
      dom.resizeWidth.value = Math.max(1, Math.round(height * ratio));
    }
  }
}

export async function applyResize(commitBlobCallback) {
  if (!state.current) return;

  const width = Math.max(1, Number(dom.resizeWidth.value));
  const height = Math.max(1, Number(dom.resizeHeight.value));

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    setStatus("Resize values must be valid numbers.", 0);
    return;
  }

  await withOperation("Resize", async () => {
    setStatus("Loading image...", 20);
    const sourceImage = await loadImageElementFromBlob(state.current.blob);
    
    setStatus("Resizing image...", 40);
    
    // Create destination canvas with target dimensions
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }
    
    // Use high-quality image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    
    // Draw the resized image
    ctx.drawImage(sourceImage, 0, 0, width, height);
    
    setStatus("Encoding image...", 70);
    
    // Convert to blob
    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);
    
    setStatus("Finalizing...", 90);
    await commitBlobCallback(blob, "Resize", state.current.name);
  }, syncUndoButtons);
}

export function initResizeListeners(commitBlobCallback) {
  dom.resizeWidth.addEventListener("input", () => syncLockedDimensions("width"));
  dom.resizeHeight.addEventListener("input", () => syncLockedDimensions("height"));
  dom.applyResize.addEventListener("click", () => applyResize(commitBlobCallback));
}
