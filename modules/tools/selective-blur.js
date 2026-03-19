import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS, progressMessage } from "../core/messages.js";

let segmentationModulePromise = null;

// Cache for real-time preview
let blurCache = {
  blobUrl: null,
  originalData: null,
  maskData: null,
  blurredDataCache: new Map(), // Cache blurred versions by radius
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
  
  // Horizontal pass
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
  
  // Vertical pass
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
  
  // Normalize
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  
  return kernel;
}

export async function applySelectiveBlur(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Selective blur", async () => {
    // If we have cached data, use it for faster processing
    if (blurCache.originalData && blurCache.maskData && blurCache.blobUrl === state.current.previewUrl) {
      setStatus(FRIENDLY_STATUS.applyingEffect, 50);
      
      const blurRadius = Number(dom.blurIntensity.value);
      const featherRadius = Number(dom.blurFeather.value);
      
      // Get or create blurred version
      let blurredData = blurCache.blurredDataCache.get(blurRadius);
      if (!blurredData) {
        setStatus(FRIENDLY_STATUS.applyingEffect, 60);
        blurredData = applyGaussianBlur(blurCache.originalData, blurRadius);
      }
      
      setStatus(FRIENDLY_STATUS.compositing, 80);
      
      // Create final canvas
      const canvas = document.createElement("canvas");
      canvas.width = state.current.width;
      canvas.height = state.current.height;
      const ctx = canvas.getContext("2d", { alpha: true });
      
      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }
      
      const finalData = ctx.createImageData(canvas.width, canvas.height);
      const { originalData, maskData } = blurCache;
      
      for (let i = 0; i < originalData.data.length; i += 4) {
        let blendFactor;
        
        if (featherRadius > 0) {
          const x = (i / 4) % canvas.width;
          const y = Math.floor((i / 4) / canvas.width);
          blendFactor = calculateFeatheredMask(maskData, x, y, canvas.width, canvas.height, featherRadius);
        } else {
          blendFactor = maskData.data[i + 3] / 255;
        }
        
        finalData.data[i] = originalData.data[i] * blendFactor + blurredData.data[i] * (1 - blendFactor);
        finalData.data[i + 1] = originalData.data[i + 1] * blendFactor + blurredData.data[i + 1] * (1 - blendFactor);
        finalData.data[i + 2] = originalData.data[i + 2] * blendFactor + blurredData.data[i + 2] * (1 - blendFactor);
        finalData.data[i + 3] = originalData.data[i + 3];
      }
      
      ctx.putImageData(finalData, 0, 0);
      
      setStatus(FRIENDLY_STATUS.savingChanges, 95);
      
      const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
      const quality = state.current.format === "png" ? undefined : currentQuality();
      const blob = await canvasToBlob(canvas, mime, quality);
      
      await commitBlobCallback(blob, "Selective blur", state.current.name);
      
      // Clear cache after applying
      clearBlurCache();
      return;
    }
    
    // Fallback: Full processing if no cache
    setStatus(FRIENDLY_STATUS.gettingReady, 10);
    const { removeBackground } = await getSegmentationModule();
    
    setStatus(FRIENDLY_STATUS.applyingEffect, 20);
    const sourceImage = await loadImageElementFromBlob(state.current.blob);
    
    // Get foreground mask
    const maskBlob = await removeBackground(state.current.blob, {
      model: dom.blurModel.value,
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
    
    // Create canvas for compositing
    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }
    
    // Draw original image
    ctx.drawImage(sourceImage, 0, 0);
    const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    setStatus(FRIENDLY_STATUS.applyingEffect, 60);
    
    // Apply blur
    const blurRadius = Number(dom.blurIntensity.value);
    const blurredData = applyGaussianBlur(originalData, blurRadius);
    
    setStatus(FRIENDLY_STATUS.gettingReady, 75);
    
    // Load mask
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
    
    // Composite: use original where mask is opaque, blurred where transparent
    const finalData = ctx.createImageData(canvas.width, canvas.height);
    const featherRadius = Number(dom.blurFeather.value);
    
    for (let i = 0; i < originalData.data.length; i += 4) {
      const maskAlpha = maskData.data[i + 3] / 255;
      
      // Apply feathering for smoother transition
      let blendFactor = maskAlpha;
      if (featherRadius > 0) {
        const x = (i / 4) % canvas.width;
        const y = Math.floor((i / 4) / canvas.width);
        blendFactor = calculateFeatheredMask(maskData, x, y, canvas.width, canvas.height, featherRadius);
      }
      
      // Blend original (foreground) and blurred (background)
      finalData.data[i] = originalData.data[i] * blendFactor + blurredData.data[i] * (1 - blendFactor);
      finalData.data[i + 1] = originalData.data[i + 1] * blendFactor + blurredData.data[i + 1] * (1 - blendFactor);
      finalData.data[i + 2] = originalData.data[i + 2] * blendFactor + blurredData.data[i + 2] * (1 - blendFactor);
      finalData.data[i + 3] = originalData.data[i + 3];
    }
    
    ctx.putImageData(finalData, 0, 0);
    
    setStatus(FRIENDLY_STATUS.savingChanges, 95);
    
    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);
    
    await commitBlobCallback(blob, "Selective blur", state.current.name);
  }, syncUndoButtons);
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

// Clear cache when switching images
export function clearBlurCache() {
  blurCache.blobUrl = null;
  blurCache.originalData = null;
  blurCache.maskData = null;
  blurCache.blurredDataCache.clear();
  blurCache.previewCanvas = null;
  blurCache.isProcessing = false;
}

// Initialize preview - detect foreground and cache data
async function initializeBlurPreview() {
  if (!state.current || blurCache.isProcessing) return;
  
  // Check if cache is valid for current image
  if (blurCache.blobUrl === state.current.previewUrl && blurCache.originalData) {
    return; // Already initialized
  }
  
  blurCache.isProcessing = true;
  
  try {
    setStatus(FRIENDLY_STATUS.preparingPreview, 10);
    const { removeBackground } = await getSegmentationModule();
    const sourceImage = await loadImageElementFromBlob(state.current.blob);
    
    // Get foreground mask
    const maskBlob = await removeBackground(state.current.blob, {
      model: dom.blurModel.value,
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
    
    // Create canvas and get original data
    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }
    
    ctx.drawImage(sourceImage, 0, 0);
    const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Load and cache mask
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
    
    // Cache everything
    blurCache.blobUrl = state.current.previewUrl;
    blurCache.originalData = originalData;
    blurCache.maskData = maskData;
    blurCache.previewCanvas = canvas;
    blurCache.blurredDataCache.clear();
    
    setStatus("Preview ready.", 100);
    
    // Trigger initial preview
    await updateBlurPreview();
    
  } catch (error) {
    console.error("Failed to initialize blur preview:", error);
    setStatus("Couldn’t prepare preview.", 0);
  } finally {
    blurCache.isProcessing = false;
  }
}

// Update preview with current slider values (fast operation)
async function updateBlurPreview() {
  if (!blurCache.originalData || !blurCache.maskData || !blurCache.previewCanvas) {
    return;
  }
  
  const blurRadius = Number(dom.blurIntensity.value);
  const featherRadius = Number(dom.blurFeather.value);
  
  // Get or create blurred version for this radius
  let blurredData = blurCache.blurredDataCache.get(blurRadius);
  if (!blurredData) {
    // Need to blur - this is the slower part but still fast
    blurredData = applyGaussianBlur(blurCache.originalData, blurRadius);
    blurCache.blurredDataCache.set(blurRadius, blurredData);
  }
  
  // Composite layers (very fast)
  const ctx = blurCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  
  const finalData = ctx.createImageData(blurCache.previewCanvas.width, blurCache.previewCanvas.height);
  const { originalData, maskData } = blurCache;
  const width = blurCache.previewCanvas.width;
  const height = blurCache.previewCanvas.height;
  
  for (let i = 0; i < originalData.data.length; i += 4) {
    let blendFactor;
    
    if (featherRadius > 0) {
      const x = (i / 4) % width;
      const y = Math.floor((i / 4) / width);
      blendFactor = calculateFeatheredMask(maskData, x, y, width, height, featherRadius);
    } else {
      blendFactor = maskData.data[i + 3] / 255;
    }
    
    // Blend original (foreground) and blurred (background)
    finalData.data[i] = originalData.data[i] * blendFactor + blurredData.data[i] * (1 - blendFactor);
    finalData.data[i + 1] = originalData.data[i + 1] * blendFactor + blurredData.data[i + 1] * (1 - blendFactor);
    finalData.data[i + 2] = originalData.data[i + 2] * blendFactor + blurredData.data[i + 2] * (1 - blendFactor);
    finalData.data[i + 3] = originalData.data[i + 3];
  }
  
  ctx.putImageData(finalData, 0, 0);
  
  // Update the preview image
  const previewUrl = blurCache.previewCanvas.toDataURL();
  dom.cropImage.src = previewUrl;
}

// Debounce helper for slider updates
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

const debouncedPreviewUpdate = debounce(updateBlurPreview, 50);

export function initSelectiveBlurListeners(commitBlobCallback) {
  // Initialize preview when tool is activated
  dom.applyBlur.addEventListener("click", () => applySelectiveBlur(commitBlobCallback));
  
  // Real-time preview on slider changes
  dom.blurIntensity.addEventListener("input", () => {
    dom.blurIntensityValue.textContent = dom.blurIntensity.value + "px";
    
    // Initialize preview if not already done
    if (!blurCache.originalData) {
      initializeBlurPreview();
    } else {
      debouncedPreviewUpdate();
    }
  });
  
  dom.blurFeather.addEventListener("input", () => {
    dom.blurFeatherValue.textContent = dom.blurFeather.value + "px";
    
    // Initialize preview if not already done
    if (!blurCache.originalData) {
      initializeBlurPreview();
    } else {
      debouncedPreviewUpdate();
    }
  });
  
  // Re-detect foreground when model changes
  dom.blurModel.addEventListener("change", () => {
    clearBlurCache();
    if (state.current) {
      initializeBlurPreview();
    }
  });
}

// Export for UI controller to call when switching to blur tool
export async function activateBlurTool() {
  if (state.current && !blurCache.originalData) {
    await initializeBlurPreview();
  }
}

// Export for UI controller to call when switching away from blur tool
export function deactivateBlurTool() {
  // Optionally clear cache to free memory
  // clearBlurCache();
}
