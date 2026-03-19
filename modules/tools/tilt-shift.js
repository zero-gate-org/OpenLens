import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

let tsCache = {
  blobUrl: null,
  originalData: null,
  enhancedData: null,
  blurredDataCache: new Map(),
  previewCanvas: null,
  isProcessing: false,
  lastParams: null,
};

// ─── Gaussian Blur (two-pass separable) ────────────────────────────────

function applyGaussianBlur(imageData, radius) {
  const { width, height, data } = imageData;
  const output = new Uint8ClampedArray(data);

  const kernel = createGaussianKernel(radius);
  const kernelSize = kernel.length;
  const halfKernel = Math.floor(kernelSize / 2);

  const temp = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < kernelSize; k++) {
        const px = Math.min(width - 1, Math.max(0, x + k - halfKernel));
        const idx = (y * width + px) * 4;
        const w = kernel[k];
        r += data[idx] * w;
        g += data[idx + 1] * w;
        b += data[idx + 2] * w;
        a += data[idx + 3] * w;
      }
      const idx = (y * width + x) * 4;
      temp[idx] = r;
      temp[idx + 1] = g;
      temp[idx + 2] = b;
      temp[idx + 3] = a;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < kernelSize; k++) {
        const py = Math.min(height - 1, Math.max(0, y + k - halfKernel));
        const idx = (py * width + x) * 4;
        const w = kernel[k];
        r += temp[idx] * w;
        g += temp[idx + 1] * w;
        b += temp[idx + 2] * w;
        a += temp[idx + 3] * w;
      }
      const idx = (y * width + x) * 4;
      output[idx] = r;
      output[idx + 1] = g;
      output[idx + 2] = b;
      output[idx + 3] = a;
    }
  }

  return new ImageData(output, width, height);
}

function createGaussianKernel(radius) {
  const size = Math.ceil(radius) * 2 + 1;
  const kernel = new Float32Array(size);
  const sigma = radius / 3;
  const twoSigmaSquare = 2 * sigma * sigma;
  const center = Math.floor(size / 2);
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - center;
    kernel[i] = Math.exp(-(x * x) / twoSigmaSquare);
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  return kernel;
}

// ─── Color Enhancement Pipeline ────────────────────────────────────────
// Mirrors what professionals do in Photoshop/DaVinci/Premiere:
//   1. Vibrance (boost muted colors more than already-vivid ones)
//   2. Saturation (uniform color intensity boost)
//   3. Brightness (lift overall exposure)
//   4. Contrast (S-curve around midpoint)
//   5. Vignette (radial darkening toward edges)

function applyColorEnhancement(imageData, params) {
  const { width, height, data } = imageData;
  const { vibrance, saturation, brightness, contrast } = params;
  const output = new Uint8ClampedArray(data.length);

  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const vignetteStrength = params.vignette;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;

      // ── RGB → HSL ──
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;

      if (max === min) {
        h = 0;
        s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
      }

      // ── Vibrance: boost muted colors more than vivid ones ──
      // Photoshop's Vibrance targets low-saturation pixels aggressively
      // and eases off for already-saturated ones.
      if (vibrance !== 1) {
        const vibranceBoost = (1 - s) * (vibrance - 1);
        s = Math.min(1, s + vibranceBoost);
      }

      // ── Saturation: uniform boost ──
      s = Math.min(1, s * saturation);

      // ── HSL → RGB ──
      if (s === 0) {
        r = g = b = l;
      } else {
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
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }

      // ── Brightness: linear lift ──
      r *= brightness;
      g *= brightness;
      b *= brightness;

      // ── Contrast: S-curve around midpoint ──
      r = (r - 0.5) * contrast + 0.5;
      g = (g - 0.5) * contrast + 0.5;
      b = (b - 0.5) * contrast + 0.5;

      // ── Vignette: radial darkening from center ──
      if (vignetteStrength > 0) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
        const vignette = 1 - dist * dist * vignetteStrength;
        r *= vignette;
        g *= vignette;
        b *= vignette;
      }

      output[i] = Math.max(0, Math.min(255, r * 255));
      output[i + 1] = Math.max(0, Math.min(255, g * 255));
      output[i + 2] = Math.max(0, Math.min(255, b * 255));
      output[i + 3] = data[i + 3];
    }
  }

  return new ImageData(output, width, height);
}

// ─── Graduated Blur Mask ───────────────────────────────────────────────

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function createTiltShiftMask(width, height, focusPosition, transitionWidth) {
  const mask = new Float32Array(width * height);
  const focusY = (focusPosition / 100) * height;
  const bandHalf = (transitionWidth / 100) * height / 2;
  const bandTop = focusY - bandHalf;
  const bandBottom = focusY + bandHalf;

  for (let y = 0; y < height; y++) {
    let sharpness;
    if (y >= bandTop && y <= bandBottom) {
      sharpness = 1.0;
    } else if (y < bandTop) {
      const dist = bandTop - y;
      const t = Math.min(1, dist / bandHalf);
      sharpness = 1.0 - smoothstep(t);
    } else {
      const dist = y - bandBottom;
      const t = Math.min(1, dist / bandHalf);
      sharpness = 1.0 - smoothstep(t);
    }

    for (let x = 0; x < width; x++) {
      mask[y * width + x] = sharpness;
    }
  }

  return mask;
}

// ─── Compositing ───────────────────────────────────────────────────────

function compositeTiltShift(enhancedData, blurredData, mask, width, height) {
  const output = new Uint8ClampedArray(enhancedData.data.length);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const px = (rowOffset + x) * 4;
      const sharpness = mask[rowOffset + x];
      const blur = 1 - sharpness;

      output[px] = enhancedData.data[px] * sharpness + blurredData.data[px] * blur;
      output[px + 1] = enhancedData.data[px + 1] * sharpness + blurredData.data[px + 1] * blur;
      output[px + 2] = enhancedData.data[px + 2] * sharpness + blurredData.data[px + 2] * blur;
      output[px + 3] = enhancedData.data[px + 3];
    }
  }

  return new ImageData(output, width, height);
}

// ─── Parameter Helpers ─────────────────────────────────────────────────

function getPreviewParams() {
  return {
    blurRadius: Number(dom.tsBlurIntensity.value),
    focusPosition: Number(dom.tsFocusPosition.value),
    transitionWidth: Number(dom.tsTransitionWidth.value),
    vibrance: Number(dom.tsVibrance.value) / 100,
    saturation: Number(dom.tsSaturation.value) / 100,
    brightness: Number(dom.tsBrightness.value) / 100,
    contrast: Number(dom.tsContrast.value) / 100,
    vignette: Number(dom.tsVignette.value) / 100,
  };
}

function paramsEqual(a, b) {
  return a.vibrance === b.vibrance &&
         a.saturation === b.saturation &&
         a.brightness === b.brightness &&
         a.contrast === b.contrast &&
         a.vignette === b.vignette;
}

function colorParamsKey(p) {
  return `${p.vibrance}|${p.saturation}|${p.brightness}|${p.contrast}|${p.vignette}`;
}

// ─── Enhanced Data Cache ───────────────────────────────────────────────

function getEnhancedData(params) {
  const key = colorParamsKey(params);
  if (tsCache.enhancedData && tsCache.lastParams === key) {
    return tsCache.enhancedData;
  }
  tsCache.enhancedData = applyColorEnhancement(tsCache.originalData, params);
  tsCache.lastParams = key;
  tsCache.blurredDataCache.clear();
  return tsCache.enhancedData;
}

// ─── Apply (commit) ────────────────────────────────────────────────────

export async function applyTiltShift(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Tilt-shift", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);

    const params = getPreviewParams();

    setStatus(FRIENDLY_STATUS.applyingEffect, 50);
    const enhancedData = getEnhancedData(params);

    setStatus(FRIENDLY_STATUS.applyingEffect, 60);
    let blurredData = tsCache.blurredDataCache.get(params.blurRadius);
    if (!blurredData) {
      blurredData = applyGaussianBlur(enhancedData, params.blurRadius);
    }

    setStatus(FRIENDLY_STATUS.compositing, 80);
    const mask = createTiltShiftMask(state.current.width, state.current.height, params.focusPosition, params.transitionWidth);
    const finalData = compositeTiltShift(enhancedData, blurredData, mask, state.current.width, state.current.height);

    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.putImageData(finalData, 0, 0);

    setStatus(FRIENDLY_STATUS.savingChanges, 95);
    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);

    await commitBlobCallback(blob, "Tilt-shift", state.current.name);
    clearTiltShiftCache();
  }, syncUndoButtons);
}

// ─── Cache Management ──────────────────────────────────────────────────

export function clearTiltShiftCache() {
  tsCache.blobUrl = null;
  tsCache.originalData = null;
  tsCache.enhancedData = null;
  tsCache.blurredDataCache.clear();
  tsCache.previewCanvas = null;
  tsCache.isProcessing = false;
  tsCache.lastParams = null;
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializeTiltShiftPreview() {
  if (!state.current || tsCache.isProcessing) return;
  if (tsCache.blobUrl === state.current.previewUrl && tsCache.originalData) return;

  tsCache.isProcessing = true;

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

    tsCache.blobUrl = state.current.previewUrl;
    tsCache.originalData = originalData;
    tsCache.enhancedData = null;
    tsCache.previewCanvas = canvas;
    tsCache.blurredDataCache.clear();
    tsCache.lastParams = null;

    setStatus("Preview ready.", 100);
    await updateTiltShiftPreview();
  } catch (error) {
    console.error("Failed to initialize tilt-shift preview:", error);
    setStatus("Couldn\u2019t prepare preview.", 0);
  } finally {
    tsCache.isProcessing = false;
  }
}

// ─── Preview Update (fast, debounced) ──────────────────────────────────

async function updateTiltShiftPreview() {
  if (!tsCache.originalData || !tsCache.previewCanvas) return;

  const params = getPreviewParams();
  const enhancedData = getEnhancedData(params);

  let blurredData = tsCache.blurredDataCache.get(params.blurRadius);
  if (!blurredData) {
    blurredData = applyGaussianBlur(enhancedData, params.blurRadius);
    tsCache.blurredDataCache.set(params.blurRadius, blurredData);
  }

  const ctx = tsCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const mask = createTiltShiftMask(tsCache.previewCanvas.width, tsCache.previewCanvas.height, params.focusPosition, params.transitionWidth);
  const finalData = compositeTiltShift(enhancedData, blurredData, mask, tsCache.previewCanvas.width, tsCache.previewCanvas.height);

  ctx.putImageData(finalData, 0, 0);
  dom.cropImage.src = tsCache.previewCanvas.toDataURL();
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

const debouncedTsPreviewUpdate = debounce(updateTiltShiftPreview, 50);

// ─── Event Listeners ───────────────────────────────────────────────────

export function initTiltShiftListeners(commitBlobCallback) {
  dom.applyTiltShift.addEventListener("click", () => applyTiltShift(commitBlobCallback));

  const initOrDebounce = () => {
    if (!tsCache.originalData) {
      initializeTiltShiftPreview();
    } else {
      debouncedTsPreviewUpdate();
    }
  };

  dom.tsBlurIntensity.addEventListener("input", () => {
    dom.tsBlurIntensityValue.textContent = dom.tsBlurIntensity.value + "px";
    initOrDebounce();
  });

  dom.tsFocusPosition.addEventListener("input", () => {
    dom.tsFocusPositionValue.textContent = dom.tsFocusPosition.value + "%";
    initOrDebounce();
  });

  dom.tsTransitionWidth.addEventListener("input", () => {
    dom.tsTransitionWidthValue.textContent = dom.tsTransitionWidth.value + "%";
    initOrDebounce();
  });

  dom.tsVibrance.addEventListener("input", () => {
    dom.tsVibranceValue.textContent = dom.tsVibrance.value + "%";
    initOrDebounce();
  });

  dom.tsSaturation.addEventListener("input", () => {
    dom.tsSaturationValue.textContent = dom.tsSaturation.value + "%";
    initOrDebounce();
  });

  dom.tsBrightness.addEventListener("input", () => {
    dom.tsBrightnessValue.textContent = dom.tsBrightness.value + "%";
    initOrDebounce();
  });

  dom.tsContrast.addEventListener("input", () => {
    dom.tsContrastValue.textContent = dom.tsContrast.value + "%";
    initOrDebounce();
  });

  dom.tsVignette.addEventListener("input", () => {
    dom.tsVignetteValue.textContent = dom.tsVignette.value + "%";
    initOrDebounce();
  });
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateTiltShiftTool() {
  if (state.current && !tsCache.originalData) {
    await initializeTiltShiftPreview();
  }
}

export function deactivateTiltShiftTool() {
  // Cache retained for fast re-activation
}
