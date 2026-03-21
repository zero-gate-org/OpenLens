import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

// ─── Constants ─────────────────────────────────────────────────────────

const TWO_MEGAPIXELS = 2 * 1024 * 1024;
const DEBOUNCE_MS = 30;
const MAX_STRENGTH_DELTA = 80;

const PRESETS = [
  { name: "Subtle Digital", noiseType: "uniform", strength: 15, grainSize: 1, shape: "square", highlightsOnly: false, shadowsOnly: false, fixedGrain: false, seed: 42, blend: 100 },
  { name: "35mm Film", noiseType: "luminance", strength: 35, grainSize: 2, shape: "square", highlightsOnly: false, shadowsOnly: false, fixedGrain: false, seed: 42, blend: 100 },
  { name: "Pushed ISO 3200", noiseType: "luminance", strength: 70, grainSize: 3, shape: "random", highlightsOnly: true, shadowsOnly: true, fixedGrain: false, seed: 42, blend: 100 },
  { name: "Kodachrome", noiseType: "color", strength: 25, grainSize: 2, shape: "square", highlightsOnly: false, shadowsOnly: false, fixedGrain: false, seed: 42, blend: 100 },
  { name: "Old Photo", noiseType: "uniform", strength: 55, grainSize: 4, shape: "random", highlightsOnly: false, shadowsOnly: false, fixedGrain: false, seed: 42, blend: 100 },
];

// ─── State ─────────────────────────────────────────────────────────────

let filmGrainCache = {
  blobUrl: null,
  originalData: null,
  previewCanvas: null,
  isProcessing: false,
};

let worker = null;
let workerBusy = false;

// ─── Seeded PRNG ───────────────────────────────────────────────────────

function hashNoise(x, y, seed) {
  let n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.3) * 43758.5453;
  return n - Math.floor(n);
}

// ─── HSL Conversion ────────────────────────────────────────────────────

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// ─── Luminance Helpers ─────────────────────────────────────────────────

function pixelLuminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ─── Core Film Grain Algorithm ─────────────────────────────────────────

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function applyFilmGrain(imageData, params) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const dst = new Uint8ClampedArray(data.length);

  const { noiseType, strength, grainSize, shape, highlightsOnly, shadowsOnly, fixedGrain, seed, blend } = params;
  const delta = (strength / 100) * MAX_STRENGTH_DELTA;
  const strengthNorm = delta / 255;
  const gs = Math.max(1, Math.round(grainSize));

  const useFixedGrain = fixedGrain;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Compute noise position (grain size blocking)
      let noiseX, noiseY;
      if (gs > 1) {
        if (shape === "square") {
          noiseX = Math.floor(x / gs) * gs;
          noiseY = Math.floor(y / gs) * gs;
        } else {
          noiseX = Math.floor(x / gs);
          noiseY = Math.floor(y / gs);
        }
      } else {
        noiseX = x;
        noiseY = y;
      }

      // Get noise values based on type
      let noiseR = 0, noiseG = 0, noiseB = 0;

      if (noiseType === "uniform") {
        let noise;
        if (useFixedGrain) {
          noise = (hashNoise(noiseX, noiseY, seed) - 0.5) * 2 * delta;
        } else {
          noise = (Math.random() - 0.5) * 2 * delta;
        }
        noiseR = noiseG = noiseB = noise;
      } else if (noiseType === "luminance") {
        // Convert to HSL, add noise to L, convert back
        const r = src[i], g = src[i + 1], b = src[i + 2];
        const [h, s, l] = rgbToHsl(r, g, b);

        let noise;
        if (useFixedGrain) {
          noise = (hashNoise(noiseX, noiseY, seed) - 0.5) * 2 * strengthNorm;
        } else {
          noise = (Math.random() - 0.5) * 2 * strengthNorm;
        }

        const newL = clamp(l + noise, 0, 1);
        const [nr, ng, nb] = hslToRgb(h, s, newL);
        noiseR = nr - r;
        noiseG = ng - g;
        noiseB = nb - b;
      } else if (noiseType === "color") {
        if (useFixedGrain) {
          noiseR = (hashNoise(noiseX, noiseY, seed) - 0.5) * 2 * delta;
          noiseG = (hashNoise(noiseX + 0.5, noiseY + 0.5, seed + 1) - 0.5) * 2 * delta;
          noiseB = (hashNoise(noiseX + 1.0, noiseY + 1.0, seed + 2) - 0.5) * 2 * delta;
        } else {
          noiseR = (Math.random() - 0.5) * 2 * delta;
          noiseG = (Math.random() - 0.5) * 2 * delta;
          noiseB = (Math.random() - 0.5) * 2 * delta;
        }
      }

      // Highlights/Shadows only masking
      let applyNoise = true;
      if (highlightsOnly || shadowsOnly) {
        const lum = pixelLuminance(src[i], src[i + 1], src[i + 2]);
        if (highlightsOnly && shadowsOnly) {
          applyNoise = lum > 0.6 || lum < 0.4;
        } else if (highlightsOnly) {
          applyNoise = lum > 0.6;
        } else if (shadowsOnly) {
          applyNoise = lum < 0.4;
        }
      }

      if (applyNoise) {
        // Blend with original using blend slider
        const bFactor = blend / 100;
        dst[i]     = clamp(Math.round(src[i]     + noiseR * bFactor), 0, 255);
        dst[i + 1] = clamp(Math.round(src[i + 1] + noiseG * bFactor), 0, 255);
        dst[i + 2] = clamp(Math.round(src[i + 2] + noiseB * bFactor), 0, 255);
      } else {
        dst[i]     = src[i];
        dst[i + 1] = src[i + 1];
        dst[i + 2] = src[i + 2];
      }

      dst[i + 3] = src[i + 3];
    }
  }

  return new ImageData(dst, width, height);
}

// ─── Web Worker ────────────────────────────────────────────────────────

function getWorker() {
  if (!worker) {
    const blob = new Blob(
      ['importScripts("./modules/tools/film-grain-worker.js");'],
      { type: "application/javascript" }
    );
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
        params,
      },
      [buffer]
    );
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────

function isLargeImage() {
  if (!state.current) return false;
  return state.current.width * state.current.height > TWO_MEGAPIXELS;
}

function getFilmGrainParams() {
  return {
    noiseType: getSelectedNoiseType(),
    strength: Number(dom.fgStrength?.value || 25),
    grainSize: Number(dom.fgGrainSize?.value || 1),
    shape: getSelectedShape(),
    highlightsOnly: dom.fgHighlightsOnly?.checked ?? false,
    shadowsOnly: dom.fgShadowsOnly?.checked ?? false,
    fixedGrain: dom.fgFixedGrain?.checked ?? false,
    seed: Number(dom.fgSeed?.value || 42),
    blend: Number(dom.fgBlend?.value || 100),
  };
}

function getSelectedNoiseType() {
  const active = document.querySelector(".fg-noise-btn.active");
  return active?.dataset.noiseType || "uniform";
}

function getSelectedShape() {
  const active = document.querySelector(".fg-shape-btn.active");
  return active?.dataset.shape || "square";
}

// ─── Cache Management ──────────────────────────────────────────────────

export function clearFilmGrainCache() {
  filmGrainCache.blobUrl = null;
  filmGrainCache.originalData = null;
  filmGrainCache.previewCanvas = null;
  filmGrainCache.isProcessing = false;
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializeFilmGrainPreview() {
  if (!state.current || filmGrainCache.isProcessing) return;
  if (filmGrainCache.blobUrl === state.current.previewUrl && filmGrainCache.originalData) return;

  filmGrainCache.isProcessing = true;

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

    filmGrainCache.blobUrl = state.current.previewUrl;
    filmGrainCache.originalData = originalData;
    filmGrainCache.previewCanvas = canvas;

    setStatus("Preview ready.", 100);
    await updateFilmGrainPreview();
  } catch (error) {
    console.error("Failed to initialize film grain preview:", error);
    setStatus("Couldn\u2019t prepare preview.", 0);
  } finally {
    filmGrainCache.isProcessing = false;
  }
}

// ─── Preview Update ────────────────────────────────────────────────────

async function updateFilmGrainPreview() {
  if (!filmGrainCache.originalData || !filmGrainCache.previewCanvas) return;
  if (workerBusy) return;

  const params = getFilmGrainParams();

  let finalData;

  if (isLargeImage() && params.noiseType === "luminance") {
    setStatus("Processing\u2026", 50);
    dom.canvasOverlay?.classList.add("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "false");

    try {
      finalData = await processWithWorker(filmGrainCache.originalData, params);
    } catch (err) {
      console.error("Worker failed, falling back to sync:", err);
      finalData = applyFilmGrain(filmGrainCache.originalData, params);
    }

    dom.canvasOverlay?.classList.remove("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "true");
  } else {
    finalData = applyFilmGrain(filmGrainCache.originalData, params);
  }

  const ctx = filmGrainCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(finalData, 0, 0);
  dom.cropImage.src = filmGrainCache.previewCanvas.toDataURL();
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

const debouncedFilmGrainPreview = debounce(updateFilmGrainPreview, DEBOUNCE_MS);

// ─── Apply (Commit) ───────────────────────────────────────────────────

export async function applyFilmGrainEffect(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Film Grain", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);

    const params = getFilmGrainParams();

    if (!filmGrainCache.originalData) {
      await initializeFilmGrainPreview();
    }

    let finalData;

    if (isLargeImage() && params.noiseType === "luminance") {
      setStatus(FRIENDLY_STATUS.applyingEffect, 50);
      try {
        finalData = await processWithWorker(filmGrainCache.originalData, params);
      } catch (err) {
        finalData = applyFilmGrain(filmGrainCache.originalData, params);
      }
    } else if (filmGrainCache.originalData) {
      finalData = applyFilmGrain(filmGrainCache.originalData, params);
    } else {
      const sourceImage = await loadImageElementFromBlob(state.current.blob);
      const canvas = document.createElement("canvas");
      canvas.width = state.current.width;
      canvas.height = state.current.height;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("Failed to get canvas context");
      ctx.drawImage(sourceImage, 0, 0);
      const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      finalData = applyFilmGrain(originalData, params);
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

    await commitBlobCallback(blob, "Film Grain", state.current.name);
    clearFilmGrainCache();
  }, syncUndoButtons);
}

// ─── Preset Rendering ──────────────────────────────────────────────────

function renderPresets() {
  const container = dom.fgPresets;
  if (!container) return;

  container.innerHTML = "";

  PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fg-preset-btn";
    btn.title = preset.name;
    btn.setAttribute("data-preset", preset.name);
    btn.textContent = preset.name;

    btn.addEventListener("click", () => {
      syncUIFromPreset(preset);
      if (!filmGrainCache.originalData) {
        initializeFilmGrainPreview();
      } else {
        debouncedFilmGrainPreview();
      }
    });

    container.appendChild(btn);
  });
}

function syncUIFromPreset(preset) {
  // Noise type buttons
  document.querySelectorAll(".fg-noise-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.noiseType === preset.noiseType);
  });

  // Sliders
  if (dom.fgStrength) {
    dom.fgStrength.value = preset.strength;
    if (dom.fgStrengthValue) dom.fgStrengthValue.textContent = preset.strength;
  }
  if (dom.fgGrainSize) {
    dom.fgGrainSize.value = preset.grainSize;
    if (dom.fgGrainSizeValue) dom.fgGrainSizeValue.textContent = preset.grainSize + "px";
  }
  if (dom.fgBlend) {
    dom.fgBlend.value = preset.blend;
    if (dom.fgBlendValue) dom.fgBlendValue.textContent = preset.blend + "%";
  }

  // Shape buttons
  document.querySelectorAll(".fg-shape-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.shape === preset.shape);
  });

  // Checkboxes
  if (dom.fgHighlightsOnly) dom.fgHighlightsOnly.checked = preset.highlightsOnly;
  if (dom.fgShadowsOnly) dom.fgShadowsOnly.checked = preset.shadowsOnly;
  if (dom.fgFixedGrain) {
    dom.fgFixedGrain.checked = preset.fixedGrain;
    updateSeedVisibility();
  }
  if (dom.fgSeed) dom.fgSeed.value = preset.seed;
}

// ─── Seed Visibility ───────────────────────────────────────────────────

function updateSeedVisibility() {
  const seedRow = document.querySelector(".fg-seed-row");
  if (!seedRow) return;
  seedRow.style.display = dom.fgFixedGrain?.checked ? "flex" : "none";
}

// ─── Reset ─────────────────────────────────────────────────────────────

function resetFilmGrain() {
  if (!filmGrainCache.originalData || !filmGrainCache.previewCanvas) return;

  const ctx = filmGrainCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(filmGrainCache.originalData, 0, 0);
  dom.cropImage.src = filmGrainCache.previewCanvas.toDataURL();
}

// ─── Event Listeners ───────────────────────────────────────────────────

export function initFilmGrainListeners(commitBlobCallback) {
  // Apply / Reset
  dom.fgApply?.addEventListener("click", () => applyFilmGrainEffect(commitBlobCallback));
  dom.fgReset?.addEventListener("click", () => resetFilmGrain());

  // Noise type segmented buttons
  document.querySelectorAll(".fg-noise-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fg-noise-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      initOrDebounce();
    });
  });

  // Shape segmented buttons
  document.querySelectorAll(".fg-shape-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fg-shape-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      initOrDebounce();
    });
  });

  const initOrDebounce = () => {
    if (!filmGrainCache.originalData) {
      initializeFilmGrainPreview();
    } else {
      debouncedFilmGrainPreview();
    }
  };

  // Strength slider
  dom.fgStrength?.addEventListener("input", () => {
    if (dom.fgStrengthValue) dom.fgStrengthValue.textContent = dom.fgStrength.value;
    initOrDebounce();
  });

  // Grain size slider
  dom.fgGrainSize?.addEventListener("input", () => {
    if (dom.fgGrainSizeValue) dom.fgGrainSizeValue.textContent = dom.fgGrainSize.value + "px";
    initOrDebounce();
  });

  // Blend slider
  dom.fgBlend?.addEventListener("input", () => {
    if (dom.fgBlendValue) dom.fgBlendValue.textContent = dom.fgBlend.value + "%";
    initOrDebounce();
  });

  // Checkboxes
  dom.fgHighlightsOnly?.addEventListener("change", initOrDebounce);
  dom.fgShadowsOnly?.addEventListener("change", initOrDebounce);

  dom.fgFixedGrain?.addEventListener("change", () => {
    updateSeedVisibility();
    initOrDebounce();
  });

  // Seed input
  dom.fgSeed?.addEventListener("change", initOrDebounce);

  // Seed randomize
  dom.fgSeedRandomize?.addEventListener("click", () => {
    if (dom.fgSeed) dom.fgSeed.value = Math.floor(Math.random() * 2147483647);
    initOrDebounce();
  });

  // Presets
  renderPresets();

  // Initial seed visibility
  updateSeedVisibility();
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateFilmGrainTool() {
  if (state.current && !filmGrainCache.originalData) {
    await initializeFilmGrainPreview();
  }
}

export function deactivateFilmGrainTool() {
  // Cache retained for fast re-activation
}
