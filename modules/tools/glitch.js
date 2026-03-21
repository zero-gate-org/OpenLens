import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

// ─── Constants ─────────────────────────────────────────────────────────

const TWO_MEGAPIXELS = 2 * 1024 * 1024;
const DEBOUNCE_MS = 50;
const ANIMATION_MIN_MS = 100;
const ANIMATION_MAX_MS = 500;

// ─── PRNG ──────────────────────────────────────────────────────────────

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Cache ─────────────────────────────────────────────────────────────

let glitchCache = {
  blobUrl: null,
  originalData: null,
  previewCanvas: null,
  sourceImage: null,
  isProcessing: false,
};

let worker = null;
let workerBusy = false;
let animationFrameId = null;
let animationIntervalId = null;
let animating = false;

// ─── Web Worker ────────────────────────────────────────────────────────

function getWorker() {
  if (!worker) {
    const blob = new Blob(
      ['importScripts("./modules/tools/glitch-worker.js");'],
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

function getGlitchParams() {
  return {
    seed: Number(dom.glitchSeed?.value || 42),
    intensity: Number(dom.glitchIntensity?.value || 50) / 100,
    sliceEnabled: dom.glitchSliceEnabled?.checked ?? true,
    channelEnabled: dom.glitchChannelEnabled?.checked ?? true,
    scanlineEnabled: dom.glitchScanlineEnabled?.checked ?? false,
    datamoshEnabled: dom.glitchDatamoshEnabled?.checked ?? false,
    rgbSplitEnabled: dom.glitchRgbSplitEnabled?.checked ?? false,
    sliceCount: Number(dom.glitchSliceCount?.value || 10),
    maxSliceOffset: Number(dom.glitchMaxSliceOffset?.value || 80),
    blockSize: Number(dom.glitchBlockSize?.value || 16),
  };
}

function getPixelClamped(data, x, y, width, height, channel) {
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));
  return data[(y * width + x) * 4 + channel];
}

// ─── Technique 1: Slice Offset ─────────────────────────────────────────

function applySliceOffset(ctx, width, height, rng, params) {
  const intensity = params.intensity;
  const sliceCount = params.sliceCount;
  const maxOffset = Math.round(params.maxSliceOffset * intensity);

  for (let i = 0; i < sliceCount; i++) {
    const yStart = Math.floor(rng() * height);
    const sliceHeight = Math.max(3, Math.min(50, Math.floor(rng() * 48) + 3));
    const xOffset = Math.round((rng() * 2 - 1) * maxOffset);

    if (xOffset === 0) continue;

    if (xOffset > 0) {
      ctx.drawImage(
        glitchCache.previewCanvas,
        0, yStart, width, sliceHeight,
        xOffset, yStart, width, sliceHeight
      );
      ctx.drawImage(
        glitchCache.previewCanvas,
        width - xOffset, yStart, xOffset, sliceHeight,
        0, yStart, xOffset, sliceHeight
      );
    } else {
      const absOff = Math.abs(xOffset);
      ctx.drawImage(
        glitchCache.previewCanvas,
        0, yStart, width, sliceHeight,
        xOffset, yStart, width, sliceHeight
      );
      ctx.drawImage(
        glitchCache.previewCanvas,
        0, yStart, absOff, sliceHeight,
        width - absOff, yStart, absOff, sliceHeight
      );
    }
  }
}

// ─── Technique 2: Channel Shift Bands ──────────────────────────────────

function applyChannelShiftBands(imageData, rng, params) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const dst = new Uint8ClampedArray(data);
  const intensity = params.intensity;

  const bandCount = Math.max(1, Math.floor(rng() * 4) + 1);
  const shiftR = Math.round((rng() * 12 + 3) * intensity);
  const shiftB = Math.round((rng() * 12 + 3) * intensity);

  for (let b = 0; b < bandCount; b++) {
    const bandY = Math.floor(rng() * height);
    const bandH = Math.max(5, Math.min(height - bandY, Math.floor(rng() * 80) + 10));

    for (let y = bandY; y < bandY + bandH && y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        dst[idx] = getPixelClamped(src, x + shiftR, y, width, height, 0);
        dst[idx + 1] = src[idx + 1];
        dst[idx + 2] = getPixelClamped(src, x - shiftB, y, width, height, 2);
      }
    }
  }

  return new ImageData(dst, width, height);
}

// ─── Technique 3: Scanline Corruption ──────────────────────────────────

function applyScanlineCorruption(imageData, rng, params) {
  const { width, height, data } = imageData;
  const dst = new Uint8ClampedArray(data);
  const intensity = params.intensity;

  const rowCount = Math.max(1, Math.floor(height * 0.05));

  for (let i = 0; i < rowCount; i++) {
    const y = Math.floor(rng() * height);
    const srcY = Math.floor(rng() * height);
    const brightness = 1.2 + rng() * 0.8 * intensity;

    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;
      const srcIdx = (srcY * width + x) * 4;
      dst[dstIdx] = Math.min(255, Math.round(data[srcIdx] * brightness));
      dst[dstIdx + 1] = Math.min(255, Math.round(data[srcIdx + 1] * brightness));
      dst[dstIdx + 2] = Math.min(255, Math.round(data[srcIdx + 2] * brightness));
      dst[dstIdx + 3] = data[srcIdx + 3];
    }
  }

  return new ImageData(dst, width, height);
}

// ─── Technique 4: Block Datamosh ───────────────────────────────────────

function applyBlockDatamosh(imageData, rng, params) {
  const { width, height, data } = imageData;
  const dst = new Uint8ClampedArray(data);
  const blockSize = params.blockSize;
  const intensity = params.intensity;

  const blocksX = Math.floor(width / blockSize);
  const blocksY = Math.floor(height / blockSize);
  const totalBlocks = blocksX * blocksY;
  const moshCount = Math.max(1, Math.floor(totalBlocks * (0.1 + rng() * 0.15)));

  for (let i = 0; i < moshCount; i++) {
    const bx = Math.floor(rng() * blocksX);
    const by = Math.floor(rng() * blocksY);
    const srcBx = Math.floor(rng() * blocksX);
    const srcBy = Math.floor(rng() * blocksY);

    const tintR = 1.0 + (rng() - 0.5) * 0.4 * intensity;
    const tintG = 1.0 + (rng() - 0.5) * 0.4 * intensity;
    const tintB = 1.0 + (rng() - 0.5) * 0.4 * intensity;

    for (let dy = 0; dy < blockSize; dy++) {
      for (let dx = 0; dx < blockSize; dx++) {
        const dstX = bx * blockSize + dx;
        const dstY = by * blockSize + dy;
        const srcX = srcBx * blockSize + dx;
        const srcY = srcBy * blockSize + dy;

        if (dstX >= width || dstY >= height || srcX >= width || srcY >= height) continue;

        const dstIdx = (dstY * width + dstX) * 4;
        const srcIdx = (srcY * width + srcX) * 4;

        dst[dstIdx] = Math.min(255, Math.round(data[srcIdx] * tintR));
        dst[dstIdx + 1] = Math.min(255, Math.round(data[srcIdx + 1] * tintG));
        dst[dstIdx + 2] = Math.min(255, Math.round(data[srcIdx + 2] * tintB));
        dst[dstIdx + 3] = data[srcIdx + 3];
      }
    }
  }

  return new ImageData(dst, width, height);
}

// ─── Technique 5: RGB Band Split ───────────────────────────────────────

function applyRgbBandSplit(imageData, rng, params) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const dst = new Uint8ClampedArray(data);
  const intensity = params.intensity;

  const bandCount = Math.floor(rng() * 6) + 3;

  for (let b = 0; b < bandCount; b++) {
    const bandY = Math.floor(rng() * height);
    const bandH = Math.max(3, Math.min(height - bandY, Math.floor(rng() * 40) + 5));
    const shiftR = Math.round((20 + rng() * 20) * intensity);
    const shiftB = Math.round((20 + rng() * 20) * intensity);

    for (let y = bandY; y < bandY + bandH && y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        dst[idx] = getPixelClamped(src, x + shiftR, y, width, height, 0);
        dst[idx + 1] = src[idx + 1];
        dst[idx + 2] = getPixelClamped(src, x - shiftB, y, width, height, 2);
      }
    }
  }

  return new ImageData(dst, width, height);
}

// ─── Main Render Pipeline ──────────────────────────────────────────────

function applyGlitch(params) {
  if (!glitchCache.originalData || !glitchCache.previewCanvas) return;

  const { width, height } = glitchCache.originalData;
  const ctx = glitchCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  // Start from original
  ctx.putImageData(glitchCache.originalData, 0, 0);

  const rng = mulberry32(params.seed);

  // Canvas-based techniques (fast)
  if (params.sliceEnabled) {
    applySliceOffset(ctx, width, height, rng, params);
  }

  // Pixel-based techniques
  let imageData = ctx.getImageData(0, 0, width, height);

  if (params.channelEnabled) {
    imageData = applyChannelShiftBands(imageData, rng, params);
  }
  if (params.scanlineEnabled) {
    imageData = applyScanlineCorruption(imageData, rng, params);
  }
  if (params.datamoshEnabled) {
    imageData = applyBlockDatamosh(imageData, rng, params);
  }
  if (params.rgbSplitEnabled) {
    imageData = applyRgbBandSplit(imageData, rng, params);
  }

  ctx.putImageData(imageData, 0, 0);
  dom.cropImage.src = glitchCache.previewCanvas.toDataURL();
}

async function applyGlitchAsync(params) {
  if (!glitchCache.originalData || !glitchCache.previewCanvas) return;
  if (workerBusy) return;

  if (isLargeImage() && (params.channelEnabled || params.rgbSplitEnabled || params.scanlineEnabled || params.datamoshEnabled)) {
    setStatus("Processing\u2026", 50);
    if (dom.canvasOverlay) {
      dom.canvasOverlay.classList.add("is-active");
      dom.canvasOverlay.setAttribute("aria-hidden", "false");
    }

    try {
      const result = await processWithWorker(glitchCache.originalData, params);
      const ctx = glitchCache.previewCanvas.getContext("2d", { alpha: true });
      if (ctx) {
        ctx.putImageData(result, 0, 0);
        dom.cropImage.src = glitchCache.previewCanvas.toDataURL();
      }
    } catch (err) {
      console.error("Worker failed, falling back to sync:", err);
      applyGlitch(params);
    }

    if (dom.canvasOverlay) {
      dom.canvasOverlay.classList.remove("is-active");
      dom.canvasOverlay.setAttribute("aria-hidden", "true");
    }
  } else {
    applyGlitch(params);
  }
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializeGlitchPreview() {
  if (!state.current || glitchCache.isProcessing) return;
  if (glitchCache.blobUrl === state.current.previewUrl && glitchCache.originalData) return;

  glitchCache.isProcessing = true;

  try {
    setStatus(FRIENDLY_STATUS.preparingPreview, 10);
    const sourceImage = await loadImageElementFromBlob(state.current.blob);

    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");

    ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
    const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    glitchCache.blobUrl = state.current.previewUrl;
    glitchCache.originalData = originalData;
    glitchCache.previewCanvas = canvas;
    glitchCache.sourceImage = sourceImage;

    setStatus("Preview ready.", 100);
    await updateGlitchPreview();
  } catch (error) {
    console.error("Failed to initialize glitch preview:", error);
    setStatus("Couldn\u2019t prepare preview.", 0);
  } finally {
    glitchCache.isProcessing = false;
  }
}

// ─── Preview Update ────────────────────────────────────────────────────

async function updateGlitchPreview() {
  if (!glitchCache.originalData || !glitchCache.previewCanvas) return;
  if (workerBusy) return;

  const params = getGlitchParams();
  await applyGlitchAsync(params);
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

const debouncedGlitchPreview = debounce(updateGlitchPreview, DEBOUNCE_MS);

// ─── Seed Management ───────────────────────────────────────────────────

function generateRandomSeed() {
  return Math.floor(Math.random() * 2147483647);
}

function updateSeedDisplay(seed) {
  if (dom.glitchSeed) dom.glitchSeed.value = seed;
}

// ─── Animation ─────────────────────────────────────────────────────────

function startAnimation() {
  if (animating) return;
  animating = true;

  const speedSlider = dom.glitchAnimSpeed;
  const interval = ANIMATION_MAX_MS - ((speedSlider?.value || 50) / 100) * (ANIMATION_MAX_MS - ANIMATION_MIN_MS);

  function tick() {
    if (!animating) return;
    const newSeed = generateRandomSeed();
    updateSeedDisplay(newSeed);
    const params = getGlitchParams();
    params.seed = newSeed;
    applyGlitch(params);
    animationIntervalId = setTimeout(tick, interval);
  }

  tick();
}

function stopAnimation() {
  animating = false;
  if (animationIntervalId) {
    clearTimeout(animationIntervalId);
    animationIntervalId = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// ─── Apply (Commit) ────────────────────────────────────────────────────

export async function applyGlitchEffect(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Glitch Effect", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);

    const params = getGlitchParams();

    if (!glitchCache.originalData) {
      await initializeGlitchPreview();
    }

    if (isLargeImage()) {
      setStatus(FRIENDLY_STATUS.applyingEffect, 50);
      try {
        const result = await processWithWorker(glitchCache.originalData, params);
        const ctx = glitchCache.previewCanvas.getContext("2d", { alpha: true });
        if (ctx) ctx.putImageData(result, 0, 0);
      } catch (err) {
        applyGlitch(params);
      }
    } else {
      applyGlitch(params);
    }

    setStatus(FRIENDLY_STATUS.savingChanges, 80);

    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.drawImage(glitchCache.previewCanvas, 0, 0);

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);

    await commitBlobCallback(blob, "Glitch Effect", state.current.name);
    clearGlitchCache();
  }, syncUndoButtons);
}

// ─── Presets ───────────────────────────────────────────────────────────

const PRESETS = [
  {
    name: "Mild Glitch",
    sliceEnabled: true, channelEnabled: true, scanlineEnabled: false,
    datamoshEnabled: false, rgbSplitEnabled: false,
    intensity: 30, sliceCount: 8, maxSliceOffset: 80, blockSize: 16,
  },
  {
    name: "VHS Dropout",
    sliceEnabled: true, channelEnabled: false, scanlineEnabled: true,
    datamoshEnabled: false, rgbSplitEnabled: false,
    intensity: 60, sliceCount: 15, maxSliceOffset: 100, blockSize: 16,
  },
  {
    name: "Data Corrupt",
    sliceEnabled: true, channelEnabled: true, scanlineEnabled: true,
    datamoshEnabled: true, rgbSplitEnabled: true,
    intensity: 80, sliceCount: 20, maxSliceOffset: 120, blockSize: 32,
  },
  {
    name: "Subtle Tear",
    sliceEnabled: true, channelEnabled: false, scanlineEnabled: false,
    datamoshEnabled: false, rgbSplitEnabled: false,
    intensity: 20, sliceCount: 5, maxSliceOffset: 30, blockSize: 16,
  },
];

function syncUIFromPreset(preset) {
  if (dom.glitchSliceEnabled) dom.glitchSliceEnabled.checked = preset.sliceEnabled;
  if (dom.glitchChannelEnabled) dom.glitchChannelEnabled.checked = preset.channelEnabled;
  if (dom.glitchScanlineEnabled) dom.glitchScanlineEnabled.checked = preset.scanlineEnabled;
  if (dom.glitchDatamoshEnabled) dom.glitchDatamoshEnabled.checked = preset.datamoshEnabled;
  if (dom.glitchRgbSplitEnabled) dom.glitchRgbSplitEnabled.checked = preset.rgbSplitEnabled;
  if (dom.glitchIntensity) dom.glitchIntensity.value = preset.intensity;
  if (dom.glitchIntensityValue) dom.glitchIntensityValue.textContent = preset.intensity;
  if (dom.glitchSliceCount) dom.glitchSliceCount.value = preset.sliceCount;
  if (dom.glitchSliceCountValue) dom.glitchSliceCountValue.textContent = preset.sliceCount;
  if (dom.glitchMaxSliceOffset) dom.glitchMaxSliceOffset.value = preset.maxSliceOffset;
  if (dom.glitchMaxSliceOffsetValue) dom.glitchMaxSliceOffsetValue.textContent = preset.maxSliceOffset + "px";
  if (dom.glitchBlockSize) dom.glitchBlockSize.value = preset.blockSize;
  if (dom.glitchBlockSizeValue) dom.glitchBlockSizeValue.textContent = preset.blockSize + "px";
}

function renderPresets() {
  const container = dom.glitchPresets;
  if (!container) return;

  container.innerHTML = "";

  PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "glitch-preset-btn";
    btn.title = preset.name;
    btn.setAttribute("data-preset", preset.name);

    const label = document.createElement("span");
    label.className = "glitch-preset-label";
    label.textContent = preset.name;

    btn.appendChild(label);

    btn.addEventListener("click", () => {
      syncUIFromPreset(preset);
      if (!glitchCache.originalData) {
        initializeGlitchPreview();
      } else {
        debouncedGlitchPreview();
      }
    });

    container.appendChild(btn);
  });
}

// ─── Conditional UI visibility ─────────────────────────────────────────

function updateControlVisibility() {
  const sliceFields = document.querySelectorAll(".glitch-slice-only");
  const datamoshFields = document.querySelectorAll(".glitch-datamosh-only");

  const sliceEnabled = dom.glitchSliceEnabled?.checked ?? true;
  const datamoshEnabled = dom.glitchDatamoshEnabled?.checked ?? false;

  sliceFields.forEach((el) => {
    el.style.display = sliceEnabled ? "" : "none";
  });
  datamoshFields.forEach((el) => {
    el.style.display = datamoshEnabled ? "" : "none";
  });
}

// ─── Reset ─────────────────────────────────────────────────────────────

function resetGlitch() {
  if (!glitchCache.originalData || !glitchCache.previewCanvas) return;

  const ctx = glitchCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(glitchCache.originalData, 0, 0);
  dom.cropImage.src = glitchCache.previewCanvas.toDataURL();
}

// ─── Cache Management ──────────────────────────────────────────────────

export function clearGlitchCache() {
  glitchCache.blobUrl = null;
  glitchCache.originalData = null;
  glitchCache.previewCanvas = null;
  glitchCache.sourceImage = null;
  glitchCache.isProcessing = false;
}

// ─── Event Listeners ───────────────────────────────────────────────────

export function initGlitchListeners(commitBlobCallback) {
  // Apply / Reset
  dom.glitchApply?.addEventListener("click", () => applyGlitchEffect(commitBlobCallback));
  dom.glitchReset?.addEventListener("click", () => resetGlitch());

  // Regenerate
  dom.glitchRegenerate?.addEventListener("click", () => {
    const newSeed = generateRandomSeed();
    updateSeedDisplay(newSeed);
    if (!glitchCache.originalData) {
      initializeGlitchPreview();
    } else {
      updateGlitchPreview();
    }
  });

  // Seed randomize
  dom.glitchSeedRandomize?.addEventListener("click", () => {
    const newSeed = generateRandomSeed();
    updateSeedDisplay(newSeed);
    if (!glitchCache.originalData) {
      initializeGlitchPreview();
    } else {
      debouncedGlitchPreview();
    }
  });

  // Seed input change
  dom.glitchSeed?.addEventListener("change", () => {
    if (!glitchCache.originalData) {
      initializeGlitchPreview();
    } else {
      debouncedGlitchPreview();
    }
  });

  // Technique toggles
  const toggles = [
    dom.glitchSliceEnabled,
    dom.glitchChannelEnabled,
    dom.glitchScanlineEnabled,
    dom.glitchDatamoshEnabled,
    dom.glitchRgbSplitEnabled,
  ];

  toggles.forEach((toggle) => {
    toggle?.addEventListener("change", () => {
      updateControlVisibility();
      if (!glitchCache.originalData) {
        initializeGlitchPreview();
      } else {
        debouncedGlitchPreview();
      }
    });
  });

  // Sliders
  dom.glitchIntensity?.addEventListener("input", () => {
    if (dom.glitchIntensityValue) dom.glitchIntensityValue.textContent = dom.glitchIntensity.value;
    if (!glitchCache.originalData) {
      initializeGlitchPreview();
    } else {
      debouncedGlitchPreview();
    }
  });

  dom.glitchSliceCount?.addEventListener("input", () => {
    if (dom.glitchSliceCountValue) dom.glitchSliceCountValue.textContent = dom.glitchSliceCount.value;
    if (!glitchCache.originalData) {
      initializeGlitchPreview();
    } else {
      debouncedGlitchPreview();
    }
  });

  dom.glitchMaxSliceOffset?.addEventListener("input", () => {
    if (dom.glitchMaxSliceOffsetValue) dom.glitchMaxSliceOffsetValue.textContent = dom.glitchMaxSliceOffset.value + "px";
    if (!glitchCache.originalData) {
      initializeGlitchPreview();
    } else {
      debouncedGlitchPreview();
    }
  });

  dom.glitchBlockSize?.addEventListener("input", () => {
    if (dom.glitchBlockSizeValue) dom.glitchBlockSizeValue.textContent = dom.glitchBlockSize.value + "px";
    if (!glitchCache.originalData) {
      initializeGlitchPreview();
    } else {
      debouncedGlitchPreview();
    }
  });

  // Animate toggle
  dom.glitchAnimate?.addEventListener("change", () => {
    if (dom.glitchAnimate.checked) {
      startAnimation();
    } else {
      stopAnimation();
    }
  });

  // Animation speed
  dom.glitchAnimSpeed?.addEventListener("input", () => {
    if (animating) {
      stopAnimation();
      startAnimation();
    }
  });

  // Presets
  renderPresets();

  // Initial seed
  updateSeedDisplay(generateRandomSeed());
  updateControlVisibility();
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateGlitchTool() {
  if (state.current && !glitchCache.originalData) {
    await initializeGlitchPreview();
  }
}

export function deactivateGlitchTool() {
  stopAnimation();
}
