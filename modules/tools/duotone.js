import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

// ─── Constants ─────────────────────────────────────────────────────────

const TWO_MEGAPIXELS = 2 * 1024 * 1024;
const DEBOUNCE_MS = 30;

const PRESETS = [
  { name: "Spotify",   shadow: "#1e003c", highlight: "#f5e642" },
  { name: "Noir",      shadow: "#000000", highlight: "#ffffff" },
  { name: "Sunset",    shadow: "#0d0221", highlight: "#ff6b35" },
  { name: "Ocean",     shadow: "#0a0a2a", highlight: "#00f0ff" },
  { name: "Forest",    shadow: "#0a1f0a", highlight: "#a8ff3e" },
  { name: "Rose Gold", shadow: "#1a0010", highlight: "#ffb6c1" },
];

// ─── State ─────────────────────────────────────────────────────────────

let duotoneCache = {
  blobUrl: null,
  originalData: null,
  previewCanvas: null,
  isProcessing: false,
};

let worker = null;
let workerBusy = false;

// ─── Color Parsing ─────────────────────────────────────────────────────

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

// ─── Core Duotone Math ─────────────────────────────────────────────────

function applyDuotone(imageData, colorA, colorB, intensity) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const dst = new Uint8ClampedArray(data.length);

  for (let i = 0; i < src.length; i += 4) {
    const lum = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
    const t = lum / 255;

    const dr = Math.round(colorA.r + t * (colorB.r - colorA.r));
    const dg = Math.round(colorA.g + t * (colorB.g - colorA.g));
    const db = Math.round(colorA.b + t * (colorB.b - colorA.b));

    dst[i]     = Math.round(src[i]     + intensity * (dr - src[i]));
    dst[i + 1] = Math.round(src[i + 1] + intensity * (dg - src[i + 1]));
    dst[i + 2] = Math.round(src[i + 2] + intensity * (db - src[i + 2]));
    dst[i + 3] = src[i + 3];
  }

  return new ImageData(dst, width, height);
}

// ─── Web Worker ────────────────────────────────────────────────────────

const WORKER_CODE = `
  self.onmessage = function(e) {
    const { pixelBuffer, width, height, colorA, colorB, intensity } = e.data;
    const data = new Uint8ClampedArray(pixelBuffer);

    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const t = lum / 255;

      const dr = Math.round(colorA.r + t * (colorB.r - colorA.r));
      const dg = Math.round(colorA.g + t * (colorB.g - colorA.g));
      const db = Math.round(colorA.b + t * (colorB.b - colorA.b));

      data[i]     = Math.round(data[i]     + intensity * (dr - data[i]));
      data[i + 1] = Math.round(data[i + 1] + intensity * (dg - data[i + 1]));
      data[i + 2] = Math.round(data[i + 2] + intensity * (db - data[i + 2]));
    }

    self.postMessage({ pixelBuffer: pixelBuffer }, [pixelBuffer]);
  };
`;

function getWorker() {
  if (!worker) {
    const blob = new Blob([WORKER_CODE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  }
  return worker;
}

function processWithWorker(originalData, colorA, colorB, intensity) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const buffer = originalData.data.buffer.slice(0);

    w.onmessage = (e) => {
      workerBusy = false;
      const resultBuf = e.data.pixelBuffer;
      const resultData = new Uint8ClampedArray(resultBuf);
      resolve(new ImageData(resultData, originalData.width, originalData.height));
    };

    w.onerror = (err) => {
      workerBusy = false;
      reject(err);
    };

    workerBusy = true;
    w.postMessage(
      { pixelBuffer: buffer, width: originalData.width, height: originalData.height, colorA, colorB, intensity },
      [buffer]
    );
  });
}

// ─── Cache Management ──────────────────────────────────────────────────

export function clearDuotoneCache() {
  duotoneCache.blobUrl = null;
  duotoneCache.originalData = null;
  duotoneCache.previewCanvas = null;
  duotoneCache.isProcessing = false;
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializeDuotonePreview() {
  if (!state.current || duotoneCache.isProcessing) return;
  if (duotoneCache.blobUrl === state.current.previewUrl && duotoneCache.originalData) return;

  duotoneCache.isProcessing = true;

  try {
    setStatus(FRIENDLY_STATUS.preparingPreview, 10);
    const sourceImage = await loadImageElementFromBlob(state.current.blob);

    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");

    ctx.drawImage(sourceImage, 0, 0);
    const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    duotoneCache.blobUrl = state.current.previewUrl;
    duotoneCache.originalData = originalData;
    duotoneCache.previewCanvas = canvas;

    setStatus("Preview ready.", 100);
    await updateDuotonePreview();
  } catch (error) {
    console.error("Failed to initialize duotone preview:", error);
    setStatus("Couldn\u2019t prepare preview.", 0);
  } finally {
    duotoneCache.isProcessing = false;
  }
}

// ─── Preview Update ────────────────────────────────────────────────────

function getDuotoneParams() {
  return {
    colorA: hexToRgb(dom.duotoneShadowColor.value),
    colorB: hexToRgb(dom.duotoneHighlightColor.value),
    intensity: Number(dom.duotoneIntensity.value) / 100,
  };
}

function isLargeImage() {
  if (!state.current) return false;
  return (state.current.width * state.current.height) > TWO_MEGAPIXELS;
}

async function updateDuotonePreview() {
  if (!duotoneCache.originalData || !duotoneCache.previewCanvas) return;
  if (workerBusy) return;

  const { colorA, colorB, intensity } = getDuotoneParams();

  let finalData;

  if (isLargeImage()) {
    setStatus("Processing\u2026", 50);
    dom.canvasOverlay?.classList.add("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "false");

    try {
      finalData = await processWithWorker(duotoneCache.originalData, colorA, colorB, intensity);
    } catch (err) {
      console.error("Worker failed, falling back to sync:", err);
      finalData = applyDuotone(duotoneCache.originalData, colorA, colorB, intensity);
    }

    dom.canvasOverlay?.classList.remove("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "true");
  } else {
    finalData = applyDuotone(duotoneCache.originalData, colorA, colorB, intensity);
  }

  const ctx = duotoneCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(finalData, 0, 0);
  dom.cropImage.src = duotoneCache.previewCanvas.toDataURL();
}

// ─── Debounce ──────────────────────────────────────────────────────────

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const debouncedDuotonePreview = debounce(updateDuotonePreview, DEBOUNCE_MS);

// ─── Apply (Commit) ───────────────────────────────────────────────────

export async function applyDuotoneEffect(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Duotone", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);

    const { colorA, colorB, intensity } = getDuotoneParams();

    let finalData;

    if (isLargeImage() && duotoneCache.originalData) {
      setStatus(FRIENDLY_STATUS.applyingEffect, 50);
      try {
        finalData = await processWithWorker(duotoneCache.originalData, colorA, colorB, intensity);
      } catch (err) {
        finalData = applyDuotone(duotoneCache.originalData, colorA, colorB, intensity);
      }
    } else if (duotoneCache.originalData) {
      finalData = applyDuotone(duotoneCache.originalData, colorA, colorB, intensity);
    } else {
      const sourceImage = await loadImageElementFromBlob(state.current.blob);
      const canvas = document.createElement("canvas");
      canvas.width = state.current.width;
      canvas.height = state.current.height;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("Failed to get canvas context");
      ctx.drawImage(sourceImage, 0, 0);
      const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      finalData = applyDuotone(originalData, colorA, colorB, intensity);
    }

    setStatus(FRIENDLY_STATUS.savingChanges, 80);

    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.putImageData(finalData, 0, 0);

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);

    await commitBlobCallback(blob, "Duotone", state.current.name);
    clearDuotoneCache();
  }, syncUndoButtons);
}

// ─── Preset Rendering ──────────────────────────────────────────────────

function renderPresets() {
  const container = dom.duotonePresets;
  if (!container) return;

  container.innerHTML = "";

  PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "duotone-preset-btn";
    btn.title = preset.name;
    btn.setAttribute("data-preset", preset.name);

    const swatchLeft = document.createElement("span");
    swatchLeft.className = "duotone-preset-left";
    swatchLeft.style.backgroundColor = preset.shadow;

    const swatchRight = document.createElement("span");
    swatchRight.className = "duotone-preset-right";
    swatchRight.style.backgroundColor = preset.highlight;

    const label = document.createElement("span");
    label.className = "duotone-preset-label";
    label.textContent = preset.name;

    btn.appendChild(swatchLeft);
    btn.appendChild(swatchRight);
    btn.appendChild(label);

    btn.addEventListener("click", () => {
      dom.duotoneShadowColor.value = preset.shadow;
      dom.duotoneHighlightColor.value = preset.highlight;
      if (!duotoneCache.originalData) {
        initializeDuotonePreview();
      } else {
        debouncedDuotonePreview();
      }
    });

    container.appendChild(btn);
  });
}

// ─── Reset ─────────────────────────────────────────────────────────────

function resetDuotone() {
  if (!duotoneCache.originalData || !duotoneCache.previewCanvas) return;

  const ctx = duotoneCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(duotoneCache.originalData, 0, 0);
  dom.cropImage.src = duotoneCache.previewCanvas.toDataURL();
}

// ─── Event Listeners ───────────────────────────────────────────────────

export function initDuotoneListeners(commitBlobCallback) {
  dom.duotoneApply.addEventListener("click", () => applyDuotoneEffect(commitBlobCallback));

  dom.duotoneReset.addEventListener("click", () => {
    resetDuotone();
  });

  const initOrDebounce = () => {
    if (!duotoneCache.originalData) {
      initializeDuotonePreview();
    } else {
      debouncedDuotonePreview();
    }
  };

  dom.duotoneShadowColor.addEventListener("input", initOrDebounce);
  dom.duotoneHighlightColor.addEventListener("input", initOrDebounce);

  dom.duotoneIntensity.addEventListener("input", () => {
    dom.duotoneIntensityValue.textContent = dom.duotoneIntensity.value + "%";
    initOrDebounce();
  });

  renderPresets();
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateDuotoneTool() {
  if (state.current && !duotoneCache.originalData) {
    await initializeDuotonePreview();
  }
}

export function deactivateDuotoneTool() {
  // Cache retained for fast re-activation
}
