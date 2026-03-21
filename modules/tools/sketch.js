import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

// ─── Constants ─────────────────────────────────────────────────────────

const TWO_MEGAPIXELS = 2 * 1024 * 1024;
const DEBOUNCE_MS = 40;

const PRESETS = [
  { name: "Graphite Sketch", mode: "sobel", threshold: 60, lineWeight: 1, blend: 30, paper: "#ffffff", ink: "#1a1a1a" },
  { name: "Fine Pen",        mode: "laplacian", threshold: 90, lineWeight: 1, blend: 0, paper: "#ffffff", ink: "#1a1a1a" },
  { name: "Charcoal",        mode: "sobel", threshold: 40, lineWeight: 3, blend: 20, paper: "#f5f0e8", ink: "#2c2c2c" },
  { name: "Blueprint",       mode: "sobel", threshold: 70, lineWeight: 1, blend: 0, paper: "#003366", ink: "#a8d8ff" },
  { name: "Colored Pencil",  mode: "colored-pencil", threshold: 50, lineWeight: 1, blend: 40, paper: "#ffffff", ink: "#1a1a1a" },
  { name: "Cross-Hatch",     mode: "hatching", threshold: 30, lineWeight: 1, blend: 0, paper: "#ffffff", ink: "#1a1a1a", hatchLength: 10, hatchDensity: 60 },
];

// ─── State ─────────────────────────────────────────────────────────────

let sketchCache = {
  blobUrl: null,
  originalData: null,
  previewCanvas: null,
  previewWidth: 0,
  previewHeight: 0,
  isProcessing: false,
};

let worker = null;
let workerBusy = false;

// ─── Color Parsing ─────────────────────────────────────────────────────

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

// ─── Web Worker ────────────────────────────────────────────────────────

function getWorker() {
  if (!worker) {
    const blob = new Blob(
      ['importScripts("./modules/tools/sketch-worker.js");'],
      { type: "application/javascript" }
    );
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  }
  return worker;
}

function processWithWorker(imageData, params) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const { width, height, data } = imageData;

    w.onmessage = (e) => {
      workerBusy = false;
      const d = e.data;

      if (d.mode === "hatching") {
        resolve({
          type: "hatching",
          edgeBuffer: new Float32Array(d.edgeBuffer),
          angleBuffer: new Float32Array(d.angleBuffer),
          width: d.width,
          height: d.height,
        });
      } else {
        // Worker returns plain array 'pixels', reconstruct Uint8ClampedArray
        const pixels = new Uint8ClampedArray(d.pixels);
        resolve({
          type: "imageData",
          data: new ImageData(pixels, d.width, d.height),
        });
      }
    };

    w.onerror = (err) => {
      workerBusy = false;
      reject(err);
    };

    workerBusy = true;
    // Send a COPY of the pixel data so the original stays intact
    const bufferCopy = new Uint8ClampedArray(data);
    w.postMessage({
      pixelBuffer: bufferCopy.buffer,
      width,
      height,
      mode: params.mode,
      threshold: params.threshold,
      lineWeight: params.lineWeight,
      blendAmount: params.blendAmount,
      paperColor: params.paperColor,
      inkColor: params.inkColor,
    });
  });
}

// ─── Sync Processing (main thread, no worker) ─────────────────────────

function convolveSync(grayscale, width, height, kernel) {
  const output = new Float32Array(width * height);
  const kSize = Math.sqrt(kernel.length);
  const half = Math.floor(kSize / 2);
  for (let y = half; y < height - half; y++) {
    for (let x = half; x < width - half; x++) {
      let sum = 0;
      for (let ky = 0; ky < kSize; ky++) {
        for (let kx = 0; kx < kSize; kx++) {
          sum += grayscale[(y + ky - half) * width + (x + kx - half)] * kernel[ky * kSize + kx];
        }
      }
      output[y * width + x] = sum;
    }
  }
  return output;
}

function sobelSync(grayscale, width, height) {
  const Kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const Ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const gx = convolveSync(grayscale, width, height, Kx);
  const gy = convolveSync(grayscale, width, height, Ky);
  const edges = new Float32Array(width * height);
  const angles = new Float32Array(width * height);
  for (let i = 0; i < edges.length; i++) {
    const mag = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
    edges[i] = Math.min(255, mag);
    angles[i] = Math.atan2(gy[i], gx[i]);
  }
  return { edges, angles };
}

function laplacianSync(grayscale, width, height) {
  const K = [0, -1, 0, -1, 4, -1, 0, -1, 0];
  const result = convolveSync(grayscale, width, height, K);
  for (let i = 0; i < result.length; i++) {
    result[i] = Math.min(255, Math.abs(result[i]));
  }
  return result;
}

function dilateMaxSync(buffer, width, height, radius) {
  const output = new Float32Array(buffer.length);
  const r = Math.floor(radius);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (buffer[ny * width + nx] > maxVal) maxVal = buffer[ny * width + nx];
          }
        }
      }
      output[y * width + x] = maxVal;
    }
  }
  return output;
}

function toGrayscaleSync(src, pixelCount) {
  const g = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const j = i * 4;
    g[i] = 0.2126 * src[j] + 0.7152 * src[j + 1] + 0.0722 * src[j + 2];
  }
  return g;
}

function processSync(imageData, params) {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  const src = new Uint8ClampedArray(data);
  const grayscale = toGrayscaleSync(src, pixelCount);

  let edgeBuffer, angleBuffer = null;
  if (params.mode === "sobel" || params.mode === "pencil" || params.mode === "colored-pencil" || params.mode === "hatching") {
    const r = sobelSync(grayscale, width, height);
    edgeBuffer = r.edges;
    angleBuffer = r.angles;
  } else {
    edgeBuffer = laplacianSync(grayscale, width, height);
  }

  if (params.lineWeight > 1) {
    edgeBuffer = dilateMaxSync(edgeBuffer, width, height, params.lineWeight);
  }

  for (let i = 0; i < pixelCount; i++) {
    if (edgeBuffer[i] < params.threshold) edgeBuffer[i] = 0;
  }

  if (params.mode === "hatching") {
    return { type: "hatching", edgeBuffer, angleBuffer, width, height };
  }

  const ink = hexToRgb(params.inkColor);
  const paper = hexToRgb(params.paperColor);
  const dst = new Uint8ClampedArray(src.length);
  const blend = params.blendAmount / 100;

  if (params.mode === "pencil") {
    for (let i = 0; i < pixelCount; i++) {
      const j = i * 4;
      const inv = 255 - edgeBuffer[i];
      const sketch = inv * (1 - blend) + grayscale[i] * blend * 0.3;
      const t = sketch / 255;
      dst[j]     = clamp255(ink.r + t * (paper.r - ink.r));
      dst[j + 1] = clamp255(ink.g + t * (paper.g - ink.g));
      dst[j + 2] = clamp255(ink.b + t * (paper.b - ink.b));
      dst[j + 3] = src[j + 3];
    }
  } else if (params.mode === "colored-pencil") {
    for (let i = 0; i < pixelCount; i++) {
      const j = i * 4;
      const inv = 255 - edgeBuffer[i];
      const sketchVal = inv * (1 - blend) + grayscale[i] * blend * 0.3;
      const factor = sketchVal / 255;
      dst[j]     = clamp255(src[j]     * factor);
      dst[j + 1] = clamp255(src[j + 1] * factor);
      dst[j + 2] = clamp255(src[j + 2] * factor);
      dst[j + 3] = src[j + 3];
    }
  } else {
    for (let i = 0; i < pixelCount; i++) {
      const j = i * 4;
      const inv = 255 - edgeBuffer[i];
      const t = inv / 255;
      dst[j]     = clamp255(ink.r + t * (paper.r - ink.r));
      dst[j + 1] = clamp255(ink.g + t * (paper.g - ink.g));
      dst[j + 2] = clamp255(ink.b + t * (paper.b - ink.b));
      dst[j + 3] = src[j + 3];
    }
  }

  return { type: "imageData", data: new ImageData(dst, width, height) };
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// ─── Process (auto worker / sync) ──────────────────────────────────────

async function processImage(imageData, params) {
  if (workerBusy) {
    return processSync(imageData, params);
  }
  try {
    return await processWithWorker(imageData, params);
  } catch (err) {
    console.warn("Sketch worker failed, using sync fallback:", err);
    return processSync(imageData, params);
  }
}

// ─── Hatching Renderer (main thread canvas draw) ──────────────────────

function renderHatching(ctx, edgeBuffer, angleBuffer, width, height, density, hatchLength, inkColor, paperColor) {
  ctx.fillStyle = paperColor;
  ctx.fillRect(0, 0, width, height);

  const ink = hexToRgb(inkColor);
  ctx.strokeStyle = `rgb(${ink.r},${ink.g},${ink.b})`;
  ctx.lineWidth = 1;

  const threshold = (1 - density / 100) * 255;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const strength = edgeBuffer[idx];
      if (strength < threshold) continue;

      const angle = angleBuffer[idx];
      const perpAngle = angle + Math.PI / 2;
      const len = hatchLength / 2;
      const opacity = Math.min(1, strength / 255);

      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(perpAngle) * len, y - Math.sin(perpAngle) * len);
      ctx.lineTo(x + Math.cos(perpAngle) * len, y + Math.sin(perpAngle) * len);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
}

// ─── Render result onto canvas ─────────────────────────────────────────

function renderResult(ctx, result, params, width, height) {
  if (result.type === "hatching") {
    renderHatching(ctx, result.edgeBuffer, result.angleBuffer, width, height, params.hatchDensity, params.hatchLength, params.inkColor, params.paperColor);
  } else {
    ctx.putImageData(result.data, 0, 0);
  }
}

// ─── Cache Management ──────────────────────────────────────────────────

export function clearSketchCache() {
  sketchCache.blobUrl = null;
  sketchCache.originalData = null;
  sketchCache.previewCanvas = null;
  sketchCache.isProcessing = false;
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializeSketchPreview() {
  if (!state.current || sketchCache.isProcessing) return;
  if (sketchCache.blobUrl === state.current.previewUrl && sketchCache.originalData) return;

  sketchCache.isProcessing = true;

  try {
    setStatus(FRIENDLY_STATUS.preparingPreview, 10);
    const sourceImage = await loadImageElementFromBlob(state.current.blob);

    const w = state.current.width;
    const h = state.current.height;
    const isLarge = (w * h) > TWO_MEGAPIXELS;
    const scale = isLarge ? 0.5 : 1;
    const pw = Math.round(w * scale);
    const ph = Math.round(h * scale);

    const canvas = document.createElement("canvas");
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");

    ctx.drawImage(sourceImage, 0, 0, pw, ph);
    const originalData = ctx.getImageData(0, 0, pw, ph);

    sketchCache.blobUrl = state.current.previewUrl;
    sketchCache.originalData = originalData;
    sketchCache.previewCanvas = canvas;
    sketchCache.previewWidth = pw;
    sketchCache.previewHeight = ph;

    setStatus("Preview ready.", 100);
    await updateSketchPreview();
  } catch (error) {
    console.error("Failed to initialize sketch preview:", error);
    setStatus("Couldn\u2019t prepare preview.", 0);
  } finally {
    sketchCache.isProcessing = false;
  }
}

// ─── Param Reading ─────────────────────────────────────────────────────

function getSketchMode() {
  const checked = document.querySelector('input[name="sketch-mode"]:checked');
  return checked ? checked.value : "sobel";
}

function getSketchParams() {
  return {
    mode: getSketchMode(),
    threshold: Number(dom.sketchThreshold.value),
    lineWeight: Number(dom.sketchLineWeight.value),
    blendAmount: Number(dom.sketchBlend.value),
    paperColor: dom.sketchPaperColor.value,
    inkColor: dom.sketchInkColor.value,
    hatchLength: Number(dom.sketchHatchLength.value),
    hatchDensity: Number(dom.sketchHatchDensity.value),
  };
}

// ─── UI Visibility Toggles ─────────────────────────────────────────────

function updateControlVisibility(mode) {
  const blendRow = document.querySelector(".sketch-blend-row");
  const hatchRow = document.querySelector(".sketch-hatch-row");
  if (blendRow) blendRow.style.display = (mode === "pencil" || mode === "colored-pencil") ? "" : "none";
  if (hatchRow) hatchRow.style.display = (mode === "hatching") ? "" : "none";
}

// ─── Preview Update ────────────────────────────────────────────────────

async function updateSketchPreview() {
  if (!sketchCache.originalData || !sketchCache.previewCanvas) return;
  if (sketchCache.isProcessing) return;

  const params = getSketchParams();
  updateControlVisibility(params.mode);

  const ctx = sketchCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const result = await processImage(sketchCache.originalData, params);
  renderResult(ctx, result, params, sketchCache.previewWidth, sketchCache.previewHeight);

  dom.cropImage.src = sketchCache.previewCanvas.toDataURL();
}

// ─── Debounce ──────────────────────────────────────────────────────────

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

const debouncedPreview = debounce(updateSketchPreview, DEBOUNCE_MS);

// ─── Trigger helpers ───────────────────────────────────────────────────

function triggerPreview() {
  if (!sketchCache.originalData) {
    initializeSketchPreview();
  } else {
    debouncedPreview();
  }
}

// ─── Full-Resolution Apply ─────────────────────────────────────────────

async function applyFullResolution(params) {
  const sourceImage = await loadImageElementFromBlob(state.current.blob);
  const w = state.current.width;
  const h = state.current.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Failed to get canvas context");
  ctx.drawImage(sourceImage, 0, 0);
  const fullData = ctx.getImageData(0, 0, w, h);

  const result = await processImage(fullData, params);
  renderResult(ctx, result, params, w, h);
  return canvas;
}

// ─── Apply (Commit) ───────────────────────────────────────────────────

export async function applySketchEffect(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Sketch", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);
    const params = getSketchParams();

    setStatus(FRIENDLY_STATUS.applyingEffect, 50);
    const resultCanvas = await applyFullResolution(params);

    setStatus(FRIENDLY_STATUS.savingChanges, 80);
    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(resultCanvas, mime, quality);

    await commitBlobCallback(blob, "Sketch", state.current.name);
    clearSketchCache();
  }, syncUndoButtons);
}

// ─── Preset Rendering ──────────────────────────────────────────────────

function renderPresets() {
  const container = dom.sketchPresets;
  if (!container) return;

  container.innerHTML = "";

  PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sketch-preset-btn";
    btn.title = preset.name;

    const label = document.createElement("span");
    label.className = "sketch-preset-label";
    label.textContent = preset.name;
    btn.appendChild(label);

    btn.addEventListener("click", () => {
      const modeRadio = document.querySelector(`input[name="sketch-mode"][value="${preset.mode}"]`);
      if (modeRadio) {
        modeRadio.checked = true;
        document.querySelectorAll(".sketch-mode-btn").forEach((b) => {
          b.classList.toggle("active", b.querySelector("input").checked);
        });
      }

      dom.sketchThreshold.value = preset.threshold;
      dom.sketchThresholdValue.textContent = preset.threshold;
      dom.sketchLineWeight.value = preset.lineWeight;
      dom.sketchLineWeightValue.textContent = preset.lineWeight;
      dom.sketchBlend.value = preset.blend;
      dom.sketchBlendValue.textContent = preset.blend + "%";
      dom.sketchPaperColor.value = preset.paper;
      dom.sketchInkColor.value = preset.ink;

      if (preset.hatchLength !== undefined) {
        dom.sketchHatchLength.value = preset.hatchLength;
        dom.sketchHatchLengthValue.textContent = preset.hatchLength + "px";
      }
      if (preset.hatchDensity !== undefined) {
        dom.sketchHatchDensity.value = preset.hatchDensity;
        dom.sketchHatchDensityValue.textContent = preset.hatchDensity + "%";
      }

      updateControlVisibility(preset.mode);
      triggerPreview();
    });

    container.appendChild(btn);
  });
}

// ─── Mode Button Styling ───────────────────────────────────────────────

function initModeButtons() {
  document.querySelectorAll('input[name="sketch-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      document.querySelectorAll(".sketch-mode-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.querySelector("input").checked);
      });
      triggerPreview();
    });
  });
}

// ─── Reset ─────────────────────────────────────────────────────────────

function resetSketch() {
  if (!sketchCache.originalData || !sketchCache.previewCanvas) return;
  const ctx = sketchCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  ctx.putImageData(sketchCache.originalData, 0, 0);
  dom.cropImage.src = sketchCache.previewCanvas.toDataURL();
}

// ─── Event Listeners ───────────────────────────────────────────────────

export function initSketchListeners(commitBlobCallback) {
  dom.sketchApply.addEventListener("click", () => applySketchEffect(commitBlobCallback));
  dom.sketchReset.addEventListener("click", resetSketch);

  // Sliders
  dom.sketchThreshold.addEventListener("input", () => {
    dom.sketchThresholdValue.textContent = dom.sketchThreshold.value;
    triggerPreview();
  });

  dom.sketchLineWeight.addEventListener("input", () => {
    dom.sketchLineWeightValue.textContent = dom.sketchLineWeight.value;
    triggerPreview();
  });

  dom.sketchBlend.addEventListener("input", () => {
    dom.sketchBlendValue.textContent = dom.sketchBlend.value + "%";
    triggerPreview();
  });

  dom.sketchHatchLength.addEventListener("input", () => {
    dom.sketchHatchLengthValue.textContent = dom.sketchHatchLength.value + "px";
    triggerPreview();
  });

  dom.sketchHatchDensity.addEventListener("input", () => {
    dom.sketchHatchDensityValue.textContent = dom.sketchHatchDensity.value + "%";
    triggerPreview();
  });

  // Color pickers
  dom.sketchPaperColor.addEventListener("input", triggerPreview);
  dom.sketchInkColor.addEventListener("input", triggerPreview);

  // Mode radios
  initModeButtons();

  // Presets
  renderPresets();
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateSketchTool() {
  if (state.current && !sketchCache.originalData) {
    await initializeSketchPreview();
  }
}

export function deactivateSketchTool() {
  // Cache retained for fast re-activation
}
