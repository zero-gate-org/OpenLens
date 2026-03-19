import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS, progressMessage } from "../core/messages.js";

let segmentationModulePromise = null;

let splashCache = {
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

function toGrayscale(imageData) {
  const { width, height, data } = imageData;
  const output = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    output[i] = gray;
    output[i + 1] = gray;
    output[i + 2] = gray;
    output[i + 3] = data[i + 3];
  }

  return new ImageData(output, width, height);
}

function calculateFeatheredMask(maskData, x, y, width, height, featherRadius) {
  let sum = 0;
  let count = 0;
  const radius = Math.ceil(featherRadius);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= featherRadius) {
          const idx = (ny * width + nx) * 4 + 3;
          const weight = 1 - (distance / featherRadius);
          sum += (maskData.data[idx] / 255) * weight;
          count += weight;
        }
      }
    }
  }

  return count > 0 ? sum / count : 0;
}

function compositeSplash(originalData, grayData, maskData, width, height, featherRadius) {
  const output = new Uint8ClampedArray(originalData.data.length);

  for (let i = 0; i < originalData.data.length; i += 4) {
    let blendFactor;

    if (featherRadius > 0) {
      const x = (i / 4) % width;
      const y = Math.floor((i / 4) / width);
      blendFactor = calculateFeatheredMask(maskData, x, y, width, height, featherRadius);
    } else {
      blendFactor = maskData.data[i + 3] / 255;
    }

    // Foreground (color) where mask is opaque, grayscale where transparent
    output[i] = originalData.data[i] * blendFactor + grayData.data[i] * (1 - blendFactor);
    output[i + 1] = originalData.data[i + 1] * blendFactor + grayData.data[i + 1] * (1 - blendFactor);
    output[i + 2] = originalData.data[i + 2] * blendFactor + grayData.data[i + 2] * (1 - blendFactor);
    output[i + 3] = originalData.data[i + 3];
  }

  return new ImageData(output, width, height);
}

export async function applyColorSplash(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Color splash", async () => {
    const featherRadius = Number(dom.splashFeather.value);

    // Use cache if available for current image
    if (splashCache.originalData && splashCache.maskData && splashCache.blobUrl === state.current.previewUrl) {
      setStatus(FRIENDLY_STATUS.applyingEffect, 50);

      const grayData = toGrayscale(splashCache.originalData);

      setStatus(FRIENDLY_STATUS.compositing, 80);

      const canvas = document.createElement("canvas");
      canvas.width = state.current.width;
      canvas.height = state.current.height;
      const ctx = canvas.getContext("2d", { alpha: true });

      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }

      const finalData = compositeSplash(splashCache.originalData, grayData, splashCache.maskData, canvas.width, canvas.height, featherRadius);
      ctx.putImageData(finalData, 0, 0);

      setStatus(FRIENDLY_STATUS.savingChanges, 95);

      const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
      const quality = state.current.format === "png" ? undefined : currentQuality();
      const blob = await canvasToBlob(canvas, mime, quality);

      await commitBlobCallback(blob, "Color splash", state.current.name);

      clearSplashCache();
      return;
    }

    // Full processing
    setStatus(FRIENDLY_STATUS.gettingReady, 10);
    const { removeBackground } = await getSegmentationModule();

    setStatus(FRIENDLY_STATUS.applyingEffect, 20);
    const sourceImage = await loadImageElementFromBlob(state.current.blob);

    const maskBlob = await removeBackground(state.current.blob, {
      model: dom.splashModel.value,
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

    const grayData = toGrayscale(originalData);

    setStatus(FRIENDLY_STATUS.gettingReady, 75);

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

    setStatus(FRIENDLY_STATUS.compositing, 85);

    const finalData = compositeSplash(originalData, grayData, maskData, canvas.width, canvas.height, featherRadius);
    ctx.putImageData(finalData, 0, 0);

    setStatus(FRIENDLY_STATUS.savingChanges, 95);

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);

    await commitBlobCallback(blob, "Color splash", state.current.name);
  }, syncUndoButtons);
}

export function clearSplashCache() {
  splashCache.blobUrl = null;
  splashCache.originalData = null;
  splashCache.maskData = null;
  splashCache.previewCanvas = null;
  splashCache.isProcessing = false;
}

async function initializeSplashPreview() {
  if (!state.current || splashCache.isProcessing) return;

  if (splashCache.blobUrl === state.current.previewUrl && splashCache.originalData) {
    return;
  }

  splashCache.isProcessing = true;

  try {
    setStatus(FRIENDLY_STATUS.preparingPreview, 10);
    const { removeBackground } = await getSegmentationModule();
    const sourceImage = await loadImageElementFromBlob(state.current.blob);

    const maskBlob = await removeBackground(state.current.blob, {
      model: dom.splashModel.value,
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

    splashCache.blobUrl = state.current.previewUrl;
    splashCache.originalData = originalData;
    splashCache.maskData = maskData;
    splashCache.previewCanvas = canvas;

    setStatus("Preview ready.", 100);

    await updateSplashPreview();
  } catch (error) {
    console.error("Failed to initialize color splash preview:", error);
    setStatus("Couldn't prepare preview.", 0);
  } finally {
    splashCache.isProcessing = false;
  }
}

async function updateSplashPreview() {
  if (!splashCache.originalData || !splashCache.maskData || !splashCache.previewCanvas) {
    return;
  }

  const featherRadius = Number(dom.splashFeather.value);

  const grayData = toGrayscale(splashCache.originalData);

  const ctx = splashCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const finalData = compositeSplash(
    splashCache.originalData,
    grayData,
    splashCache.maskData,
    splashCache.previewCanvas.width,
    splashCache.previewCanvas.height,
    featherRadius
  );

  ctx.putImageData(finalData, 0, 0);

  const previewUrl = splashCache.previewCanvas.toDataURL();
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

const debouncedPreviewUpdate = debounce(updateSplashPreview, 50);

export function initColorSplashListeners(commitBlobCallback) {
  dom.applySplash.addEventListener("click", () => applyColorSplash(commitBlobCallback));

  dom.splashFeather.addEventListener("input", () => {
    dom.splashFeatherValue.textContent = dom.splashFeather.value + "px";

    if (!splashCache.originalData) {
      initializeSplashPreview();
    } else {
      debouncedPreviewUpdate();
    }
  });

  dom.splashModel.addEventListener("change", () => {
    clearSplashCache();
    if (state.current) {
      initializeSplashPreview();
    }
  });
}

export async function activateSplashTool() {
  if (state.current && !splashCache.originalData) {
    await initializeSplashPreview();
  }
}

export function deactivateSplashTool() {
  // Optionally clear cache to free memory
}
