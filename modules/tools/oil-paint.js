import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

// ─── Constants ─────────────────────────────────────────────────────────

const PREVIEW_MAX_WIDTH = 400;
const DEBOUNCE_MS = 80;
const WORKER_TIMEOUT_MS = 120000; // 2 min safety net

const PRESETS = [
  { name: "Watercolor",    mode: "standard",    radius: 3,  passes: 1, sectors: 8,  saturationBoost: 20, edgeSharpening: 0 },
  { name: "Oil Painting",  mode: "standard",    radius: 6,  passes: 2, sectors: 8,  saturationBoost: 30, edgeSharpening: 30 },
  { name: "Heavy Impasto", mode: "standard",    radius: 10, passes: 3, sectors: 8,  saturationBoost: 50, edgeSharpening: 0 },
  { name: "Smooth Style",  mode: "generalized", radius: 5,  passes: 1, sectors: 8,  saturationBoost: 10, edgeSharpening: 0 },
];

// ─── State ─────────────────────────────────────────────────────────────

let oilPaintCache = {
  blobUrl: null,
  originalData: null,
  previewCanvas: null,
  isProcessing: false,
};

let currentWorker = null;
let workerBusy = false;
let workerAbort = false;
let workerTimer = null;
let workerGeneration = 0; // Incremented each time we create a worker; used to detect stale callbacks

// ─── Web Worker ────────────────────────────────────────────────────────

function createWorker() {
  if (currentWorker) {
    currentWorker.terminate();
    currentWorker = null;
  }
  workerGeneration++;
  currentWorker = new Worker("./modules/tools/oil-paint-worker.js");
  return currentWorker;
}

function terminateWorker() {
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  if (currentWorker) {
    currentWorker.terminate();
    currentWorker = null;
  }
  workerBusy = false;
  workerAbort = true;
}

function processWithWorker(imageData, params) {
  return new Promise((resolve, reject) => {
    workerAbort = false;
    const w = createWorker();
    const buffer = imageData.data.buffer.slice(0);
    const myGeneration = workerGeneration; // Capture generation for this call

    workerBusy = true;

    // Timeout safety net
    workerTimer = setTimeout(() => {
      if (workerGeneration === myGeneration) {
        terminateWorker();
        reject(new Error("Worker timeout"));
      }
    }, WORKER_TIMEOUT_MS);

    w.onmessage = (e) => {
      // Ignore callbacks from a stale worker
      if (workerGeneration !== myGeneration) return;

      const msg = e.data;
      if (msg.type === 'progress') {
        if (msg.pass) {
          setStatus(`Pass ${msg.pass}\u2026 ${msg.percent}%`, msg.percent);
        } else {
          setStatus(`Processing\u2026 ${msg.percent}%`, msg.percent);
        }
      } else if (msg.type === 'done') {
        if (workerTimer) { clearTimeout(workerTimer); workerTimer = null; }
        workerBusy = false;
        const resultData = new Uint8ClampedArray(msg.pixelBuffer);
        resolve(new ImageData(resultData, imageData.width, imageData.height));
      }
    };

    w.onerror = (err) => {
      if (workerGeneration !== myGeneration) return;
      if (workerTimer) { clearTimeout(workerTimer); workerTimer = null; }
      workerBusy = false;
      reject(err);
    };

    w.postMessage(
      { type: 'process', pixelBuffer: buffer, width: imageData.width, height: imageData.height, params },
      [buffer]
    );
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────

function getOilPaintParams() {
  return {
    mode: getSelectedMode(),
    radius: Number(dom.opRadius?.value || 4),
    passes: Number(dom.opPasses?.value || 1),
    sectors: Number(dom.opSectors?.value || 8),
    saturationBoost: Number(dom.opSatBoost?.value || 0),
    edgeSharpening: Number(dom.opEdgeSharpen?.value || 0),
  };
}

function getSelectedMode() {
  const active = document.querySelector(".op-mode-btn.active");
  return active?.dataset.mode || "standard";
}

function createPreviewData(originalData, maxWidth) {
  const { width, height } = originalData;
  if (width <= maxWidth) {
    return { data: originalData, scale: 1 };
  }
  const scale = maxWidth / width;
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = width;
  tmpCanvas.height = height;
  const tmpCtx = tmpCanvas.getContext("2d");
  tmpCtx.putImageData(originalData, 0, 0);

  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = newW;
  scaledCanvas.height = newH;
  const scaledCtx = scaledCanvas.getContext("2d");
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = "high";
  scaledCtx.drawImage(tmpCanvas, 0, 0, newW, newH);

  return { data: scaledCtx.getImageData(0, 0, newW, newH), scale };
}

// ─── Cache Management ──────────────────────────────────────────────────

export function clearOilPaintCache() {
  terminateWorker();
  oilPaintCache.blobUrl = null;
  oilPaintCache.originalData = null;
  oilPaintCache.previewCanvas = null;
  oilPaintCache.isProcessing = false;
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializeOilPaintPreview() {
  if (!state.current || oilPaintCache.isProcessing) return;
  if (oilPaintCache.blobUrl === state.current.previewUrl && oilPaintCache.originalData) return;

  oilPaintCache.isProcessing = true;

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

    oilPaintCache.blobUrl = state.current.previewUrl;
    oilPaintCache.originalData = originalData;
    oilPaintCache.previewCanvas = canvas;

    setStatus("Preview ready.", 100);
    await updateOilPaintPreview();
  } catch (error) {
    console.error("Failed to initialize oil paint preview:", error);
    setStatus("Couldn\u2019t prepare preview.", 0);
  } finally {
    oilPaintCache.isProcessing = false;
  }
}

// ─── Preview Update ────────────────────────────────────────────────────

async function updateOilPaintPreview() {
  if (!oilPaintCache.originalData || !oilPaintCache.previewCanvas) return;

  // Abort any in-flight worker
  if (workerBusy) {
    terminateWorker();
    // Small delay to ensure worker is fully terminated
    await new Promise(r => setTimeout(r, 10));
  }

  const params = getOilPaintParams();
  const { data: previewData } = createPreviewData(oilPaintCache.originalData, PREVIEW_MAX_WIDTH);

  dom.canvasOverlay?.classList.add("is-active");
  dom.canvasOverlay?.setAttribute("aria-hidden", "false");
  setStatus("Computing preview\u2026", 20);

  try {
    const resultData = await processWithWorker(previewData, params);

    if (workerAbort) return;

    // Scale result back up to display
    const displayCanvas = document.createElement("canvas");
    displayCanvas.width = oilPaintCache.originalData.width;
    displayCanvas.height = oilPaintCache.originalData.height;
    const dCtx = displayCanvas.getContext("2d", { alpha: true });
    if (!dCtx) return;

    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = previewData.width;
    tmpCanvas.height = previewData.height;
    const tmpCtx = tmpCanvas.getContext("2d");
    tmpCtx.putImageData(resultData, 0, 0);

    dCtx.imageSmoothingEnabled = true;
    dCtx.imageSmoothingQuality = "high";
    dCtx.drawImage(tmpCanvas, 0, 0, displayCanvas.width, displayCanvas.height);

    dom.cropImage.src = displayCanvas.toDataURL();
  } catch (err) {
    if (!workerAbort) {
      console.error("Preview computation failed:", err);
      setStatus("Preview failed — try smaller radius.", 0);
    }
  } finally {
    if (!workerAbort) {
      dom.canvasOverlay?.classList.remove("is-active");
      dom.canvasOverlay?.setAttribute("aria-hidden", "true");
    }
  }
}

// ─── Debounce ──────────────────────────────────────────────────────────

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

const debouncedOilPaintPreview = debounce(updateOilPaintPreview, DEBOUNCE_MS);

// ─── Apply (Commit) ───────────────────────────────────────────────────

export async function applyOilPaintEffect(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Oil Paint", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 20);

    const params = getOilPaintParams();

    if (!oilPaintCache.originalData) {
      await initializeOilPaintPreview();
    }

    // Full-resolution processing
    setStatus("Applying Kuwahara filter\u2026", 30);
    dom.canvasOverlay?.classList.add("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "false");

    let finalData;
    try {
      finalData = await processWithWorker(oilPaintCache.originalData, params);
    } catch (err) {
      console.error("Worker failed:", err);
      setStatus("Effect failed: " + (err.message || "unknown error"), 0);
      dom.canvasOverlay?.classList.remove("is-active");
      dom.canvasOverlay?.setAttribute("aria-hidden", "true");
      return;
    }

    if (workerAbort) {
      setStatus("Cancelled.", 0);
      dom.canvasOverlay?.classList.remove("is-active");
      dom.canvasOverlay?.setAttribute("aria-hidden", "true");
      return;
    }

    setStatus(FRIENDLY_STATUS.savingChanges, 90);
    dom.canvasOverlay?.classList.remove("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "true");

    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.putImageData(finalData, 0, 0);

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);

    await commitBlobCallback(blob, "Oil Paint", state.current.name);
    clearOilPaintCache();
  }, syncUndoButtons);
}

// ─── Preset Rendering ──────────────────────────────────────────────────

function renderPresets() {
  const container = dom.opPresets;
  if (!container) return;

  container.innerHTML = "";

  PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "op-preset-btn";
    btn.title = preset.name;
    btn.setAttribute("data-preset", preset.name);
    btn.textContent = preset.name;

    btn.addEventListener("click", () => {
      syncUIFromPreset(preset);
      if (!oilPaintCache.originalData) {
        initializeOilPaintPreview();
      } else {
        debouncedOilPaintPreview();
      }
    });

    container.appendChild(btn);
  });
}

function syncUIFromPreset(preset) {
  document.querySelectorAll(".op-mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === preset.mode);
  });

  updateModeVisibility(preset.mode);

  if (dom.opRadius) {
    dom.opRadius.value = preset.radius;
    if (dom.opRadiusValue) dom.opRadiusValue.textContent = preset.radius + "px";
  }
  if (dom.opPasses) {
    dom.opPasses.value = preset.passes;
    if (dom.opPassesValue) dom.opPassesValue.textContent = preset.passes;
  }
  if (dom.opSectors) {
    dom.opSectors.value = preset.sectors;
    if (dom.opSectorsValue) dom.opSectorsValue.textContent = preset.sectors;
  }
  if (dom.opSatBoost) {
    dom.opSatBoost.value = preset.saturationBoost;
    if (dom.opSatBoostValue) dom.opSatBoostValue.textContent = preset.saturationBoost + "%";
  }
  if (dom.opEdgeSharpen) {
    dom.opEdgeSharpen.value = preset.edgeSharpening;
    if (dom.opEdgeSharpenValue) dom.opEdgeSharpenValue.textContent = preset.edgeSharpening + "%";
  }

  updatePassWarning(preset.passes);
}

// ─── Mode / Pass Visibility ────────────────────────────────────────────

function updateModeVisibility(mode) {
  const sectorsField = document.querySelector(".op-sectors-field");
  if (sectorsField) {
    sectorsField.style.display = mode === "generalized" ? "" : "none";
  }
}

function updatePassWarning(passes) {
  const warning = document.querySelector(".op-pass-warning");
  if (warning) {
    warning.style.display = passes > 2 ? "flex" : "none";
  }
}

// ─── Reset ─────────────────────────────────────────────────────────────

function resetOilPaint() {
  if (!oilPaintCache.originalData || !oilPaintCache.previewCanvas) return;
  terminateWorker();

  const ctx = oilPaintCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(oilPaintCache.originalData, 0, 0);
  dom.cropImage.src = oilPaintCache.previewCanvas.toDataURL();
}

function cancelOilPaint() {
  terminateWorker();
  dom.canvasOverlay?.classList.remove("is-active");
  dom.canvasOverlay?.setAttribute("aria-hidden", "true");
  setStatus("Cancelled.", 0);
  resetOilPaint();
}

// ─── Event Listeners ───────────────────────────────────────────────────

export function initOilPaintListeners(commitBlobCallback) {
  dom.opApply?.addEventListener("click", () => applyOilPaintEffect(commitBlobCallback));
  dom.opReset?.addEventListener("click", () => resetOilPaint());
  dom.opCancel?.addEventListener("click", () => cancelOilPaint());

  // Mode segmented buttons
  document.querySelectorAll(".op-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".op-mode-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      updateModeVisibility(btn.dataset.mode);
      triggerPreview();
    });
  });

  function triggerPreview() {
    if (!oilPaintCache.originalData) {
      initializeOilPaintPreview();
    } else {
      debouncedOilPaintPreview();
    }
  }

  dom.opRadius?.addEventListener("input", () => {
    if (dom.opRadiusValue) dom.opRadiusValue.textContent = dom.opRadius.value + "px";
    triggerPreview();
  });

  dom.opPasses?.addEventListener("input", () => {
    const v = Number(dom.opPasses.value);
    if (dom.opPassesValue) dom.opPassesValue.textContent = v;
    updatePassWarning(v);
    triggerPreview();
  });

  dom.opSectors?.addEventListener("input", () => {
    if (dom.opSectorsValue) dom.opSectorsValue.textContent = dom.opSectors.value;
    triggerPreview();
  });

  dom.opSatBoost?.addEventListener("input", () => {
    if (dom.opSatBoostValue) dom.opSatBoostValue.textContent = dom.opSatBoost.value + "%";
    triggerPreview();
  });

  dom.opEdgeSharpen?.addEventListener("input", () => {
    if (dom.opEdgeSharpenValue) dom.opEdgeSharpenValue.textContent = dom.opEdgeSharpen.value + "%";
    triggerPreview();
  });

  renderPresets();
  updateModeVisibility(getSelectedMode());
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateOilPaintTool() {
  if (state.current && !oilPaintCache.originalData) {
    await initializeOilPaintPreview();
  }
}

export function deactivateOilPaintTool() {
  terminateWorker();
}
