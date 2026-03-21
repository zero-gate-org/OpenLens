import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

// ─── Constants ─────────────────────────────────────────────────────────

const TWO_MEGAPIXELS = 2 * 1024 * 1024;
const DEBOUNCE_MS = 30;

const PRESETS = [
  { name: "Subtle Lens",  mode: "radial", strength: 15, offsetRX: 0, offsetRY: 0, offsetBX: 0, offsetBY: 0, intensity: 100 },
  { name: "Glitch Light", mode: "axial",  strength: 0,  offsetRX: -3, offsetRY: 0, offsetBX: 3, offsetBY: 0, intensity: 100 },
  { name: "Heavy Glitch", mode: "axial",  strength: 0,  offsetRX: -10, offsetRY: 2, offsetBX: 10, offsetBY: -2, intensity: 100 },
  { name: "Vintage VHS",  mode: "axial",  strength: 0,  offsetRX: -6, offsetRY: 0, offsetBX: 6, offsetBY: 1, intensity: 80 },
];

// ─── State ─────────────────────────────────────────────────────────────

let caCache = {
  blobUrl: null,
  originalData: null,
  previewCanvas: null,
  isProcessing: false,
};

let worker = null;
let workerBusy = false;

// ─── Web Worker (inline) ───────────────────────────────────────────────

const WORKER_CODE = `
  function getPixelClamped(data, x, y, w, h, ch) {
    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
    return data[(y * w + x) * 4 + ch];
  }

  self.onmessage = function(e) {
    const { pixelBuffer, width, height, mode, offsetRX, offsetRY, offsetBX, offsetBY, strength, intensity } = e.data;
    const src = new Uint8ClampedArray(pixelBuffer);
    const dst = new Uint8ClampedArray(src.length);

    var cx = width * 0.5;
    var cy = height * 0.5;

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var idx = (y * width + x) * 4;

        var rVal, gVal, bVal;

        if (mode === "radial") {
          var dx = x - cx;
          var dy = y - cy;
          var scaleG = 1.0 + (strength * 0.003);
          var scaleB = 1.0 + (strength * 0.006);
          rVal = src[idx];
          gVal = getPixelClamped(src, Math.round(cx + dx * scaleG), Math.round(cy + dy * scaleG), width, height, 1);
          bVal = getPixelClamped(src, Math.round(cx + dx * scaleB), Math.round(cy + dy * scaleB), width, height, 2);
        } else {
          rVal = getPixelClamped(src, x + offsetRX, y + offsetRY, width, height, 0);
          gVal = src[idx + 1];
          bVal = getPixelClamped(src, x + offsetBX, y + offsetBY, width, height, 2);
        }

        if (intensity < 1.0) {
          rVal = Math.round(src[idx]     + intensity * (rVal - src[idx]));
          gVal = Math.round(src[idx + 1] + intensity * (gVal - src[idx + 1]));
          bVal = Math.round(src[idx + 2] + intensity * (bVal - src[idx + 2]));
        }

        dst[idx]     = rVal;
        dst[idx + 1] = gVal;
        dst[idx + 2] = bVal;
        dst[idx + 3] = src[idx + 3];
      }
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

function processWithWorker(originalData, params) {
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
      {
        pixelBuffer: buffer,
        width: originalData.width,
        height: originalData.height,
        mode: params.mode,
        offsetRX: params.offsetRX,
        offsetRY: params.offsetRY,
        offsetBX: params.offsetBX,
        offsetBY: params.offsetBY,
        strength: params.strength,
        intensity: params.intensity,
      },
      [buffer]
    );
  });
}

// ─── Core Algorithms ───────────────────────────────────────────────────

function getPixelClamped(data, x, y, width, height, channel) {
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));
  return data[(y * width + x) * 4 + channel];
}

function applyAxial(imageData, offsetRX, offsetRY, offsetBX, offsetBY, intensity) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const dst = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      let rVal = getPixelClamped(src, x + offsetRX, y + offsetRY, width, height, 0);
      let gVal = src[idx + 1];
      let bVal = getPixelClamped(src, x + offsetBX, y + offsetBY, width, height, 2);

      if (intensity < 1.0) {
        rVal = Math.round(src[idx]     + intensity * (rVal - src[idx]));
        gVal = Math.round(src[idx + 1] + intensity * (gVal - src[idx + 1]));
        bVal = Math.round(src[idx + 2] + intensity * (bVal - src[idx + 2]));
      }

      dst[idx]     = rVal;
      dst[idx + 1] = gVal;
      dst[idx + 2] = bVal;
      dst[idx + 3] = src[idx + 3];
    }
  }

  return new ImageData(dst, width, height);
}

function applyRadial(imageData, strength, intensity) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const dst = new Uint8ClampedArray(data.length);

  const cx = width * 0.5;
  const cy = height * 0.5;
  const scaleG = 1.0 + (strength * 0.003);
  const scaleB = 1.0 + (strength * 0.006);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      const dx = x - cx;
      const dy = y - cy;

      let rVal = src[idx];
      let gVal = getPixelClamped(src, Math.round(cx + dx * scaleG), Math.round(cy + dy * scaleG), width, height, 1);
      let bVal = getPixelClamped(src, Math.round(cx + dx * scaleB), Math.round(cy + dy * scaleB), width, height, 2);

      if (intensity < 1.0) {
        rVal = Math.round(src[idx]     + intensity * (rVal - src[idx]));
        gVal = Math.round(src[idx + 1] + intensity * (gVal - src[idx + 1]));
        bVal = Math.round(src[idx + 2] + intensity * (bVal - src[idx + 2]));
      }

      dst[idx]     = rVal;
      dst[idx + 1] = gVal;
      dst[idx + 2] = bVal;
      dst[idx + 3] = src[idx + 3];
    }
  }

  return new ImageData(dst, width, height);
}

function applyChromaticAberration(originalData, params) {
  if (params.mode === "radial") {
    return applyRadial(originalData, params.strength, params.intensity);
  }
  return applyAxial(originalData, params.offsetRX, params.offsetRY, params.offsetBX, params.offsetBY, params.intensity);
}

// ─── Cache Management ──────────────────────────────────────────────────

export function clearChromaticAberrationCache() {
  caCache.blobUrl = null;
  caCache.originalData = null;
  caCache.previewCanvas = null;
  caCache.isProcessing = false;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function isLargeImage() {
  if (!state.current) return false;
  return (state.current.width * state.current.height) > TWO_MEGAPIXELS;
}

function getCAParams() {
  const mode = (document.querySelector('input[name="ca-mode"]:checked') || {value: "axial"}).value;
  return {
    mode,
    offsetRX: Number(dom.caOffsetRX ? dom.caOffsetRX.value : -4),
    offsetRY: Number(dom.caOffsetRY ? dom.caOffsetRY.value : 0),
    offsetBX: Number(dom.caOffsetBX ? dom.caOffsetBX.value : 4),
    offsetBY: Number(dom.caOffsetBY ? dom.caOffsetBY.value : 0),
    strength: Number(dom.caStrength ? dom.caStrength.value : 30),
    intensity: Number(dom.caIntensity ? dom.caIntensity.value : 100) / 100,
  };
}

function updateControlVisibility(mode) {
  const axialControls = document.querySelectorAll(".ca-axial-only");
  const radialControls = document.querySelectorAll(".ca-radial-only");
  axialControls.forEach(el => {
    el.style.display = mode === "axial" ? "" : "none";
  });
  radialControls.forEach(el => {
    el.style.display = mode === "radial" ? "" : "none";
  });
}

function syncUIFromParams(params) {
  if (dom.caOffsetRX) dom.caOffsetRX.value = params.offsetRX;
  if (dom.caOffsetRY) dom.caOffsetRY.value = params.offsetRY;
  if (dom.caOffsetBX) dom.caOffsetBX.value = params.offsetBX;
  if (dom.caOffsetBY) dom.caOffsetBY.value = params.offsetBY;
  if (dom.caStrength) dom.caStrength.value = params.strength;
  if (dom.caIntensity) dom.caIntensity.value = params.intensity;

  if (dom.caOffsetRXValue) dom.caOffsetRXValue.textContent = params.offsetRX + "px";
  if (dom.caOffsetRYValue) dom.caOffsetRYValue.textContent = params.offsetRY + "px";
  if (dom.caOffsetBXValue) dom.caOffsetBXValue.textContent = params.offsetBX + "px";
  if (dom.caOffsetBYValue) dom.caOffsetBYValue.textContent = params.offsetBY + "px";
  if (dom.caStrengthValue) dom.caStrengthValue.textContent = params.strength;
  if (dom.caIntensityValue) dom.caIntensityValue.textContent = params.intensity + "%";

  const modeRadio = document.querySelector('input[name="ca-mode"][value="' + params.mode + '"]');
  if (modeRadio) modeRadio.checked = true;
  updateControlVisibility(params.mode);
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializeCAPreview() {
  if (!state.current || caCache.isProcessing) return;
  if (caCache.blobUrl === state.current.previewUrl && caCache.originalData) return;

  caCache.isProcessing = true;

  try {
    setStatus(FRIENDLY_STATUS.preparingPreview, 10);
    const sourceImage = await loadImageElementFromBlob(state.current.blob);

    const canvas = document.createElement("canvas");

    const useHalfRes = (dom.caHalfPreview && dom.caHalfPreview.checked) && isLargeImage();
    canvas.width = useHalfRes ? Math.round(state.current.width * 0.5) : state.current.width;
    canvas.height = useHalfRes ? Math.round(state.current.height * 0.5) : state.current.height;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");

    ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
    const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    caCache.blobUrl = state.current.previewUrl;
    caCache.originalData = originalData;
    caCache.previewCanvas = canvas;

    if (isLargeImage()) {
      if (dom.caLargeBadge) dom.caLargeBadge.classList.add("is-visible");
      if (dom.caHalfPreviewWrap) dom.caHalfPreviewWrap.style.display = "";
    } else {
      if (dom.caLargeBadge) dom.caLargeBadge.classList.remove("is-visible");
      if (dom.caHalfPreviewWrap) dom.caHalfPreviewWrap.style.display = "none";
    }

    setStatus("Preview ready.", 100);
    await updateCAPreview();
  } catch (error) {
    console.error("Failed to initialize chromatic aberration preview:", error);
    setStatus("Couldn\u2019t prepare preview.", 0);
  } finally {
    caCache.isProcessing = false;
  }
}

// ─── Preview Update ────────────────────────────────────────────────────

async function updateCAPreview() {
  if (!caCache.originalData || !caCache.previewCanvas) return;
  if (workerBusy) return;

  const params = getCAParams();

  let finalData;

  if (isLargeImage()) {
    setStatus("Processing\u2026", 50);
    if (dom.canvasOverlay) {
      dom.canvasOverlay.classList.add("is-active");
      dom.canvasOverlay.setAttribute("aria-hidden", "false");
    }

    try {
      finalData = await processWithWorker(caCache.originalData, params);
    } catch (err) {
      console.error("Worker failed, falling back to sync:", err);
      finalData = applyChromaticAberration(caCache.originalData, params);
    }

    if (dom.canvasOverlay) {
      dom.canvasOverlay.classList.remove("is-active");
      dom.canvasOverlay.setAttribute("aria-hidden", "true");
    }
  } else {
    finalData = applyChromaticAberration(caCache.originalData, params);
  }

  const ctx = caCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(finalData, 0, 0);
  dom.cropImage.src = caCache.previewCanvas.toDataURL();
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

const debouncedCAPreview = debounce(updateCAPreview, DEBOUNCE_MS);

// ─── Apply (Commit) ───────────────────────────────────────────────────

export async function applyChromaticAberrationEffect(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Chromatic Aberration", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);

    const params = getCAParams();

    let finalData;

    if (isLargeImage() && caCache.originalData) {
      setStatus(FRIENDLY_STATUS.applyingEffect, 50);
      try {
        finalData = await processWithWorker(caCache.originalData, params);
      } catch (err) {
        finalData = applyChromaticAberration(caCache.originalData, params);
      }
    } else if (caCache.originalData) {
      finalData = applyChromaticAberration(caCache.originalData, params);
    } else {
      const sourceImage = await loadImageElementFromBlob(state.current.blob);
      const canvas = document.createElement("canvas");
      canvas.width = state.current.width;
      canvas.height = state.current.height;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("Failed to get canvas context");
      ctx.drawImage(sourceImage, 0, 0);
      const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      finalData = applyChromaticAberration(originalData, params);
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

    await commitBlobCallback(blob, "Chromatic Aberration", state.current.name);
    clearChromaticAberrationCache();
  }, syncUndoButtons);
}

// ─── Preset Rendering ──────────────────────────────────────────────────

function renderPresets() {
  const container = dom.caPresets;
  if (!container) return;

  container.innerHTML = "";

  PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ca-preset-btn";
    btn.title = preset.name;
    btn.setAttribute("data-preset", preset.name);

    const label = document.createElement("span");
    label.className = "ca-preset-label";
    label.textContent = preset.name;

    btn.appendChild(label);

    btn.addEventListener("click", () => {
      syncUIFromParams(preset);
      if (!caCache.originalData) {
        initializeCAPreview();
      } else {
        debouncedCAPreview();
      }
    });

    container.appendChild(btn);
  });
}

// ─── Reset ─────────────────────────────────────────────────────────────

function resetCA() {
  if (!caCache.originalData || !caCache.previewCanvas) return;

  const ctx = caCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(caCache.originalData, 0, 0);
  dom.cropImage.src = caCache.previewCanvas.toDataURL();
}

// ─── Event Listeners ───────────────────────────────────────────────────

export function initChromaticAberrationListeners(commitBlobCallback) {
  dom.caApply.addEventListener("click", () => applyChromaticAberrationEffect(commitBlobCallback));

  dom.caReset.addEventListener("click", () => {
    resetCA();
  });

  const initOrDebounce = () => {
    if (!caCache.originalData) {
      initializeCAPreview();
    } else {
      debouncedCAPreview();
    };
  };

  // Mode radios
  document.querySelectorAll('input[name="ca-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updateControlVisibility(radio.value);
      initOrDebounce();
    });
  });

  // Axial sliders
  dom.caOffsetRX.addEventListener("input", () => {
    dom.caOffsetRXValue.textContent = dom.caOffsetRX.value + "px";
    initOrDebounce();
  });
  dom.caOffsetRY.addEventListener("input", () => {
    dom.caOffsetRYValue.textContent = dom.caOffsetRY.value + "px";
    initOrDebounce();
  });
  dom.caOffsetBX.addEventListener("input", () => {
    dom.caOffsetBXValue.textContent = dom.caOffsetBX.value + "px";
    initOrDebounce();
  });
  dom.caOffsetBY.addEventListener("input", () => {
    dom.caOffsetBYValue.textContent = dom.caOffsetBY.value + "px";
    initOrDebounce();
  });

  // Radial slider
  dom.caStrength.addEventListener("input", () => {
    dom.caStrengthValue.textContent = dom.caStrength.value;
    initOrDebounce();
  });

  // Intensity slider
  dom.caIntensity.addEventListener("input", () => {
    dom.caIntensityValue.textContent = dom.caIntensity.value + "%";
    initOrDebounce();
  });

  // Half-res preview checkbox
  if (dom.caHalfPreview) {
    dom.caHalfPreview.addEventListener("change", () => {
      clearChromaticAberrationCache();
      initializeCAPreview();
    });
  }

  renderPresets();
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateChromaticAberrationTool() {
  if (state.current && !caCache.originalData) {
    await initializeCAPreview();
  }
}

export function deactivateChromaticAberrationTool() {
  // Cache retained for fast re-activation
}
