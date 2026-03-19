import { state, MIME_BY_FORMAT } from "./state.js";
import { dom } from "./dom.js";

export function createImageState({ blob, name, width, height }) {
  const format = inferFormat(blob.type || "", name);
  return {
    blob,
    name: renameExtension(name || "image", format),
    width,
    height,
    mime: MIME_BY_FORMAT[format] || blob.type || "image/png",
    format,
  };
}

export function inferFormat(mime, name = "") {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "webp") return "webp";
  return "png";
}

export function renameExtension(name, format) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  const ext = format === "jpeg" ? "jpg" : format;
  return `${base}.${ext}`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function setBusy(isBusy) {
  state.busy = isBusy;
  document.querySelectorAll("button, input, select").forEach((element) => {
    const isTVOControl = element.closest('[data-panel="textoverlay"]');
    const isFabricCanvas = element.closest(".textoverlay-canvas-wrap");
    if (!element.closest(".dropzone") && !element.closest(".view-landing") && !element.classList.contains("back-btn") && !element.classList.contains("tool-switcher") && !isTVOControl && !isFabricCanvas) {
      element.disabled = isBusy;
    }
  });
  dom.pickFile.disabled = false;
  
  if (dom.canvasOverlay) {
    if (isBusy) {
      dom.canvasOverlay.classList.add("is-active");
      dom.canvasOverlay.setAttribute("aria-hidden", "false");
    } else {
      dom.canvasOverlay.classList.remove("is-active");
      dom.canvasOverlay.setAttribute("aria-hidden", "true");
      setTimeout(() => {
        if (dom.canvasProgressBar) dom.canvasProgressBar.style.width = "0%";
      }, 350);
    }
  }
}

export function setStatus(message, progress = 0) {
  dom.statusText.textContent = message;
  dom.progressBar.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
  if (dom.canvasStatusText) dom.canvasStatusText.textContent = message;
  if (dom.canvasProgressBar)
    dom.canvasProgressBar.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
}

export function revokeUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

export function loadImageElementFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      revokeUrl(url);
      resolve(image);
    };
    image.onerror = () => {
      revokeUrl(url);
      reject(new Error("Failed to decode image"));
    };
    image.src = url;
  });
}

export function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode image"));
      },
      mime,
      quality
    );
  });
}

export function currentQuality() {
  return Number(dom.qualityRange.value) / 100;
}

export async function withOperation(label, action, onComplete) {
  if (!state.current || state.busy) return;

  setBusy(true);
  try {
    await action();
    setStatus(`${label} complete.`, 100);
  } catch (error) {
    console.error(error);
    setStatus(error.message || `${label} failed.`, 0);
  } finally {
    setBusy(false);
    if (onComplete) onComplete();
  }
}
