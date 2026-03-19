import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS, progressMessage } from "../core/messages.js";

let segmentationModulePromise = null;

let shadowCache = {
  blobUrl: null,
  originalData: null,
  maskData: null,
  previewCanvas: null,
  isProcessing: false,
};

async function getSegmentationModule() {
  if (!segmentationModulePromise) {
    segmentationModulePromise = import(
      "https://cdn.jsdelivr.net/npm/@imgly/background-removal/+esm"
    );
  }
  return segmentationModulePromise;
}

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
        const weight = kernel[k];

        r += data[idx] * weight;
        g += data[idx + 1] * weight;
        b += data[idx + 2] * weight;
        a += data[idx + 3] * weight;
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
        const weight = kernel[k];

        r += temp[idx] * weight;
        g += temp[idx + 1] * weight;
        b += temp[idx + 2] * weight;
        a += temp[idx + 3] * weight;
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

function createOffsetMask(maskData, offsetX, offsetY, width, height) {
  const output = new Uint8ClampedArray(maskData.data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = x - offsetX;
      const srcY = y - offsetY;
      const dstIdx = (y * width + x) * 4;

      if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
        const srcIdx = (srcY * width + srcX) * 4;
        output[dstIdx] = 0;
        output[dstIdx + 1] = 0;
        output[dstIdx + 2] = 0;
        output[dstIdx + 3] = maskData.data[srcIdx + 3];
      } else {
        output[dstIdx] = 0;
        output[dstIdx + 1] = 0;
        output[dstIdx + 2] = 0;
        output[dstIdx + 3] = 0;
      }
    }
  }

  return new ImageData(output, width, height);
}

function compositeShadow(originalData, maskData, offsetMaskData, width, height, shadowOpacity) {
  const output = new Uint8ClampedArray(originalData.data.length);

  for (let i = 0; i < originalData.data.length; i += 4) {
    const fgAlpha = maskData.data[i + 3] / 255;
    const shadowAlpha = (offsetMaskData.data[i + 3] / 255) * shadowOpacity;
    const shadowBlend = shadowAlpha * (1 - fgAlpha);

    // Darken factor for shadow pixels
    const darkFactor = 0.15;

    // Start with original pixel
    let r = originalData.data[i];
    let g = originalData.data[i + 1];
    let b = originalData.data[i + 2];

    // Blend shadow onto background (behind foreground)
    r = r * (1 - shadowBlend) + r * darkFactor * shadowBlend;
    g = g * (1 - shadowBlend) + g * darkFactor * shadowBlend;
    b = b * (1 - shadowBlend) + b * darkFactor * shadowBlend;

    output[i] = r;
    output[i + 1] = g;
    output[i + 2] = b;
    output[i + 3] = originalData.data[i + 3];
  }

  return new ImageData(output, width, height);
}

export async function applyShadowInjection(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Shadow injection", async () => {
    const offsetX = Number(dom.shadowOffsetX.value);
    const offsetY = Number(dom.shadowOffsetY.value);
    const blurRadius = Number(dom.shadowBlur.value);
    const shadowOpacity = Number(dom.shadowOpacity.value) / 100;

    if (shadowCache.originalData && shadowCache.maskData && shadowCache.blobUrl === state.current.previewUrl) {
      setStatus(FRIENDLY_STATUS.applyingEffect, 50);

      const offsetMaskData = createOffsetMask(shadowCache.maskData, offsetX, offsetY, state.current.width, state.current.height);

      setStatus(FRIENDLY_STATUS.applyingEffect, 60);

      const blurredOffsetMask = applyGaussianBlur(offsetMaskData, blurRadius);

      setStatus(FRIENDLY_STATUS.compositing, 80);

      const canvas = document.createElement("canvas");
      canvas.width = state.current.width;
      canvas.height = state.current.height;
      const ctx = canvas.getContext("2d", { alpha: true });

      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }

      const finalData = compositeShadow(shadowCache.originalData, shadowCache.maskData, blurredOffsetMask, canvas.width, canvas.height, shadowOpacity);
      ctx.putImageData(finalData, 0, 0);

      setStatus(FRIENDLY_STATUS.savingChanges, 95);

      const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
      const quality = state.current.format === "png" ? undefined : currentQuality();
      const blob = await canvasToBlob(canvas, mime, quality);

      await commitBlobCallback(blob, "Shadow injection", state.current.name);

      clearShadowCache();
      return;
    }

    setStatus(FRIENDLY_STATUS.gettingReady, 10);
    const { removeBackground } = await getSegmentationModule();

    setStatus(FRIENDLY_STATUS.applyingEffect, 20);
    const sourceImage = await loadImageElementFromBlob(state.current.blob);

    const maskBlob = await removeBackground(state.current.blob, {
      model: dom.shadowModel.value,
      output: {
        format: "image/png",
        type: "foreground",
      },
      progress(key, current, total) {
        const ratio = total > 0 ? Math.round((current / total) * 100) : 0;
        const phase = progressMessage({ key });
        setStatus(`${phase} ${ratio}%`, 10 + ratio * 0.3);
      },
    });

    setStatus(FRIENDLY_STATUS.applyingEffect, 50);

    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });

    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }

    ctx.drawImage(sourceImage, 0, 0);
    const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    setStatus(FRIENDLY_STATUS.applyingEffect, 60);

    const maskImage = await loadImageElementFromBlob(maskBlob);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext("2d", { alpha: true });

    if (!maskCtx) {
      throw new Error("Failed to get mask canvas context");
    }

    maskCtx.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
    const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);

    setStatus(FRIENDLY_STATUS.gettingReady, 70);

    const offsetMaskData = createOffsetMask(maskData, offsetX, offsetY, canvas.width, canvas.height);
    const blurredOffsetMask = applyGaussianBlur(offsetMaskData, blurRadius);

    setStatus(FRIENDLY_STATUS.compositing, 85);

    const finalData = compositeShadow(originalData, maskData, blurredOffsetMask, canvas.width, canvas.height, shadowOpacity);
    ctx.putImageData(finalData, 0, 0);

    setStatus(FRIENDLY_STATUS.savingChanges, 95);

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);

    await commitBlobCallback(blob, "Shadow injection", state.current.name);
  }, syncUndoButtons);
}

export function clearShadowCache() {
  shadowCache.blobUrl = null;
  shadowCache.originalData = null;
  shadowCache.maskData = null;
  shadowCache.previewCanvas = null;
  shadowCache.isProcessing = false;
}

async function initializeShadowPreview() {
  if (!state.current || shadowCache.isProcessing) return;

  if (shadowCache.blobUrl === state.current.previewUrl && shadowCache.originalData) {
    return;
  }

  shadowCache.isProcessing = true;

  try {
    setStatus(FRIENDLY_STATUS.preparingPreview, 10);
    const { removeBackground } = await getSegmentationModule();
    const sourceImage = await loadImageElementFromBlob(state.current.blob);

    const maskBlob = await removeBackground(state.current.blob, {
      model: dom.shadowModel.value,
      output: {
        format: "image/png",
        type: "foreground",
      },
      progress(key, current, total) {
        const ratio = total > 0 ? Math.round((current / total) * 100) : 0;
        const phase = progressMessage({ key, defaultPhase: FRIENDLY_STATUS.preparingPreview });
        setStatus(`${phase} ${ratio}%`, 10 + ratio * 0.5);
      },
    });

    setStatus(FRIENDLY_STATUS.preparingPreview, 70);

    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });

    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }

    ctx.drawImage(sourceImage, 0, 0);
    const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const maskImage = await loadImageElementFromBlob(maskBlob);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext("2d", { alpha: true });

    if (!maskCtx) {
      throw new Error("Failed to get mask canvas context");
    }

    maskCtx.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
    const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);

    shadowCache.blobUrl = state.current.previewUrl;
    shadowCache.originalData = originalData;
    shadowCache.maskData = maskData;
    shadowCache.previewCanvas = canvas;

    setStatus("Preview ready.", 100);

    await updateShadowPreview();
  } catch (error) {
    console.error("Failed to initialize shadow injection preview:", error);
    setStatus("Couldn't prepare preview.", 0);
  } finally {
    shadowCache.isProcessing = false;
  }
}

async function updateShadowPreview() {
  if (!shadowCache.originalData || !shadowCache.maskData || !shadowCache.previewCanvas) {
    return;
  }

  const offsetX = Number(dom.shadowOffsetX.value);
  const offsetY = Number(dom.shadowOffsetY.value);
  const blurRadius = Number(dom.shadowBlur.value);
  const shadowOpacity = Number(dom.shadowOpacity.value) / 100;

  const offsetMaskData = createOffsetMask(shadowCache.maskData, offsetX, offsetY, shadowCache.previewCanvas.width, shadowCache.previewCanvas.height);
  const blurredOffsetMask = applyGaussianBlur(offsetMaskData, blurRadius);

  const ctx = shadowCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const finalData = compositeShadow(
    shadowCache.originalData,
    shadowCache.maskData,
    blurredOffsetMask,
    shadowCache.previewCanvas.width,
    shadowCache.previewCanvas.height,
    shadowOpacity
  );

  ctx.putImageData(finalData, 0, 0);

  const previewUrl = shadowCache.previewCanvas.toDataURL();
  dom.cropImage.src = previewUrl;
}

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

const debouncedPreviewUpdate = debounce(updateShadowPreview, 80);

export function initShadowInjectionListeners(commitBlobCallback) {
  dom.applyShadow.addEventListener("click", () => applyShadowInjection(commitBlobCallback));

  dom.shadowOffsetX.addEventListener("input", () => {
    dom.shadowOffsetXValue.textContent = dom.shadowOffsetX.value + "px";
    if (!shadowCache.originalData) {
      initializeShadowPreview();
    } else {
      debouncedPreviewUpdate();
    }
  });

  dom.shadowOffsetY.addEventListener("input", () => {
    dom.shadowOffsetYValue.textContent = dom.shadowOffsetY.value + "px";
    if (!shadowCache.originalData) {
      initializeShadowPreview();
    } else {
      debouncedPreviewUpdate();
    }
  });

  dom.shadowBlur.addEventListener("input", () => {
    dom.shadowBlurValue.textContent = dom.shadowBlur.value + "px";
    if (!shadowCache.originalData) {
      initializeShadowPreview();
    } else {
      debouncedPreviewUpdate();
    }
  });

  dom.shadowOpacity.addEventListener("input", () => {
    dom.shadowOpacityValue.textContent = dom.shadowOpacity.value + "%";
    if (!shadowCache.originalData) {
      initializeShadowPreview();
    } else {
      debouncedPreviewUpdate();
    }
  });

  dom.shadowModel.addEventListener("change", () => {
    clearShadowCache();
    if (state.current) {
      initializeShadowPreview();
    }
  });
}

export async function activateShadowTool() {
  if (state.current && !shadowCache.originalData) {
    await initializeShadowPreview();
  }
}

export function deactivateShadowTool() {
  // Optionally clear cache to free memory
}
