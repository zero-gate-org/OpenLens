import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

// ─── Constants ─────────────────────────────────────────────────────────

const TWO_MEGAPIXELS = 2 * 1024 * 1024;
const DEBOUNCE_MS = 50;

const PRESETS = [
  { name: "Newspaper",  mode: "grayscale", gridSize: 8,  dotColor: "#000000", bgColor: "#ffffff", shape: "circle", angle: 0 },
  { name: "Comic Book", mode: "grayscale", gridSize: 6,  dotColor: "#1a1a4e", bgColor: "#fffde7", shape: "circle", angle: 0 },
  { name: "CMYK Print", mode: "cmyk",      gridSize: 10, dotColor: "#000000", bgColor: "#ffffff", shape: "circle", angle: 0 },
  { name: "Risograph",  mode: "grayscale", gridSize: 12, dotColor: "#c0392b", bgColor: "#fdf6e3", shape: "circle", angle: 0 },
];

// ─── State ─────────────────────────────────────────────────────────────

let halftoneCache = {
  blobUrl: null,
  originalData: null,
  previewCanvas: null,
  isProcessing: false,
};

// ─── Helpers ───────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function rgbToCmyk(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  return {
    c: (1 - rn - k) / (1 - k),
    m: (1 - gn - k) / (1 - k),
    y: (1 - bn - k) / (1 - k),
    k,
  };
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ─── Grayscale Halftone ────────────────────────────────────────────────

function renderGrayscaleHalftone(ctx, width, height, originalData, params) {
  const { gridSize, dotColor, bgColor, shape, angle } = params;
  const data = originalData.data;

  ctx.save();
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  if (angle > 0) {
    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle * Math.PI / 180);
    ctx.translate(-width / 2, -height / 2);
  }

  ctx.fillStyle = dotColor;
  const downsample = width > 1920;

  for (let gy = 0; gy < height; gy += gridSize) {
    for (let gx = 0; gx < width; gx += gridSize) {
      const cellW = Math.min(gridSize, width - gx);
      const cellH = Math.min(gridSize, height - gy);

      let lum = 0, count = 0;
      const step = downsample ? 2 : 1;

      for (let py = gy; py < gy + cellH; py += step) {
        for (let px = gx; px < gx + cellW; px += step) {
          const idx = (py * width + px) * 4;
          lum += 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
          count++;
        }
      }

      const t = (lum / count) / 255;
      const radius = (gridSize / 2) * (1 - t);
      if (radius < 0.3) continue;

      const cx = gx + cellW / 2;
      const cy = gy + cellH / 2;
      drawShape(ctx, shape, cx, cy, radius);
    }
  }

  ctx.restore();
}

// ─── CMYK Halftone ─────────────────────────────────────────────────────

function drawChannelDots(ctx, channelData, width, height, gridSize, shape, angle) {
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(angle * Math.PI / 180);
  ctx.translate(-width / 2, -height / 2);

  for (let gy = 0; gy < height; gy += gridSize) {
    for (let gx = 0; gx < width; gx += gridSize) {
      const cellW = Math.min(gridSize, width - gx);
      const cellH = Math.min(gridSize, height - gy);

      let val = 0, count = 0;
      const step = width > 1920 ? 2 : 1;

      for (let py = gy; py < gy + cellH; py += step) {
        for (let px = gx; px < gx + cellW; px += step) {
          val += channelData[py * width + px];
          count++;
        }
      }

      const t = (val / count) / 255;
      const radius = (gridSize / 2) * t;
      if (radius < 0.3) continue;

      const cx = gx + cellW / 2;
      const cy = gy + cellH / 2;
      drawShape(ctx, shape, cx, cy, radius);
    }
  }

  ctx.restore();
}

function renderCMYKHalftone(ctx, width, height, originalData, params, onProgress) {
  const { gridSize, shape } = params;
  const data = originalData.data;
  const totalPixels = width * height;

  const cChannel = new Uint8ClampedArray(totalPixels);
  const mChannel = new Uint8ClampedArray(totalPixels);
  const yChannel = new Uint8ClampedArray(totalPixels);
  const kChannel = new Uint8ClampedArray(totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const cmyk = rgbToCmyk(data[idx], data[idx + 1], data[idx + 2]);
    cChannel[i] = Math.round(cmyk.c * 255);
    mChannel[i] = Math.round(cmyk.m * 255);
    yChannel[i] = Math.round(cmyk.y * 255);
    kChannel[i] = Math.round(cmyk.k * 255);
  }

  if (onProgress) onProgress("Cyan layer…", 10);

  const cyanCanvas = document.createElement("canvas");
  cyanCanvas.width = width;
  cyanCanvas.height = height;
  const cyanCtx = cyanCanvas.getContext("2d");
  cyanCtx.fillStyle = "#ffffff";
  cyanCtx.fillRect(0, 0, width, height);
  cyanCtx.fillStyle = "#00ffff";
  drawChannelDots(cyanCtx, cChannel, width, height, gridSize, shape, 15);

  if (onProgress) onProgress("Magenta layer…", 30);

  const magentaCanvas = document.createElement("canvas");
  magentaCanvas.width = width;
  magentaCanvas.height = height;
  const magentaCtx = magentaCanvas.getContext("2d");
  magentaCtx.fillStyle = "#ffffff";
  magentaCtx.fillRect(0, 0, width, height);
  magentaCtx.fillStyle = "#ff00ff";
  drawChannelDots(magentaCtx, mChannel, width, height, gridSize, shape, 75);

  if (onProgress) onProgress("Yellow layer…", 50);

  const yellowCanvas = document.createElement("canvas");
  yellowCanvas.width = width;
  yellowCanvas.height = height;
  const yellowCtx = yellowCanvas.getContext("2d");
  yellowCtx.fillStyle = "#ffffff";
  yellowCtx.fillRect(0, 0, width, height);
  yellowCtx.fillStyle = "#ffff00";
  drawChannelDots(yellowCtx, yChannel, width, height, gridSize, shape, 0);

  if (onProgress) onProgress("Key layer…", 70);

  const keyCanvas = document.createElement("canvas");
  keyCanvas.width = width;
  keyCanvas.height = height;
  const keyCtx = keyCanvas.getContext("2d");
  keyCtx.fillStyle = "#ffffff";
  keyCtx.fillRect(0, 0, width, height);
  keyCtx.fillStyle = "#000000";
  drawChannelDots(keyCtx, kChannel, width, height, gridSize, shape, 45);

  if (onProgress) onProgress("Compositing…", 85);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(cyanCanvas, 0, 0);
  ctx.drawImage(magentaCanvas, 0, 0);
  ctx.drawImage(yellowCanvas, 0, 0);
  ctx.drawImage(keyCanvas, 0, 0);
  ctx.globalCompositeOperation = "source-over";

  if (onProgress) onProgress("Done.", 100);
}

// ─── Shape Drawing ─────────────────────────────────────────────────────

function drawShape(ctx, shape, cx, cy, radius) {
  switch (shape) {
    case "square":
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      break;
    case "diamond":
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx + radius, cy);
      ctx.lineTo(cx, cy + radius);
      ctx.lineTo(cx - radius, cy);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

// ─── Parameter Reading ─────────────────────────────────────────────────

function getHalftoneParams() {
  const mode = document.querySelector('input[name="halftone-mode"]:checked')?.value || "grayscale";
  return {
    mode,
    gridSize: Number(dom.halftoneGridSize.value),
    dotColor: dom.halftoneDotColor.value,
    bgColor: dom.halftoneBgColor.value,
    shape: dom.halftoneShape.value,
    angle: Number(dom.halftoneAngle.value),
  };
}

// ─── Cache Management ──────────────────────────────────────────────────

export function clearHalftoneCache() {
  halftoneCache.blobUrl = null;
  halftoneCache.originalData = null;
  halftoneCache.previewCanvas = null;
  halftoneCache.isProcessing = false;
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializeHalftonePreview() {
  if (!state.current || halftoneCache.isProcessing) return;
  if (halftoneCache.blobUrl === state.current.previewUrl && halftoneCache.originalData) return;

  halftoneCache.isProcessing = true;

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

    halftoneCache.blobUrl = state.current.previewUrl;
    halftoneCache.originalData = originalData;
    halftoneCache.previewCanvas = canvas;

    setStatus("Preview ready.", 100);
    await updateHalftonePreview();
  } catch (error) {
    console.error("Failed to initialize halftone preview:", error);
    setStatus("Couldn\u2019t prepare preview.", 0);
  } finally {
    halftoneCache.isProcessing = false;
  }
}

// ─── Preview Update ────────────────────────────────────────────────────

async function updateHalftonePreview() {
  if (!halftoneCache.originalData || !halftoneCache.previewCanvas) return;

  const params = getHalftoneParams();
  const { width, height } = halftoneCache.previewCanvas;
  const ctx = halftoneCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  if (params.mode === "cmyk") {
    dom.canvasOverlay?.classList.add("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "false");
    setStatus("Processing CMYK layers\u2026", 5);
  }

  if (params.mode === "grayscale") {
    renderGrayscaleHalftone(ctx, width, height, halftoneCache.originalData, params);
  } else {
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        renderCMYKHalftone(
          ctx,
          width,
          height,
          halftoneCache.originalData,
          params,
          (msg, pct) => setStatus(msg, pct)
        );
        resolve();
      });
    });
  }

  if (params.mode === "cmyk") {
    dom.canvasOverlay?.classList.remove("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "true");
    setStatus("Preview ready.", 100);
  }

  dom.cropImage.src = halftoneCache.previewCanvas.toDataURL();
}

const debouncedHalftonePreview = debounce(updateHalftonePreview, DEBOUNCE_MS);

// ─── Apply (Commit) ───────────────────────────────────────────────────

export async function applyHalftoneEffect(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Halftone", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);

    const params = getHalftoneParams();

    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");

    if (halftoneCache.originalData) {
      if (params.mode === "grayscale") {
        renderGrayscaleHalftone(ctx, canvas.width, canvas.height, halftoneCache.originalData, params);
      } else {
        await new Promise((resolve) => {
          requestAnimationFrame(() => {
            renderCMYKHalftone(ctx, canvas.width, canvas.height, halftoneCache.originalData, params);
            resolve();
          });
        });
      }
    } else {
      const sourceImage = await loadImageElementFromBlob(state.current.blob);
      const srcCanvas = document.createElement("canvas");
      srcCanvas.width = state.current.width;
      srcCanvas.height = state.current.height;
      const srcCtx = srcCanvas.getContext("2d", { alpha: true });
      if (!srcCtx) throw new Error("Failed to get canvas context");
      srcCtx.drawImage(sourceImage, 0, 0);
      const originalData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);

      if (params.mode === "grayscale") {
        renderGrayscaleHalftone(ctx, canvas.width, canvas.height, originalData, params);
      } else {
        renderCMYKHalftone(ctx, canvas.width, canvas.height, originalData, params);
      }
    }

    setStatus(FRIENDLY_STATUS.savingChanges, 80);

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);

    await commitBlobCallback(blob, "Halftone", state.current.name);
    clearHalftoneCache();
  }, syncUndoButtons);
}

// ─── Preset Rendering ──────────────────────────────────────────────────

function renderPresets() {
  const container = dom.halftonePresets;
  if (!container) return;

  container.innerHTML = "";

  PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "halftone-preset-btn";
    btn.title = preset.name;
    btn.setAttribute("data-preset", preset.name);

    const dotSwatch = document.createElement("span");
    dotSwatch.className = "halftone-preset-dot";
    dotSwatch.style.backgroundColor = preset.dotColor;

    const bgSwatch = document.createElement("span");
    bgSwatch.className = "halftone-preset-bg";
    bgSwatch.style.backgroundColor = preset.bgColor;

    const label = document.createElement("span");
    label.className = "halftone-preset-label";
    label.textContent = preset.name;

    btn.appendChild(bgSwatch);
    btn.appendChild(dotSwatch);
    btn.appendChild(label);

    btn.addEventListener("click", () => {
      const modeRadio = document.querySelector(`input[name="halftone-mode"][value="${preset.mode}"]`);
      if (modeRadio) modeRadio.checked = true;
      updateModeVisibility(preset.mode);

      dom.halftoneGridSize.value = preset.gridSize;
      dom.halftoneGridSizeValue.textContent = preset.gridSize + "px";
      dom.halftoneDotColor.value = preset.dotColor;
      dom.halftoneBgColor.value = preset.bgColor;
      dom.halftoneShape.value = preset.shape;
      dom.halftoneAngle.value = preset.angle;
      dom.halftoneAngleValue.textContent = preset.angle + "\u00b0";

      if (!halftoneCache.originalData) {
        initializeHalftonePreview();
      } else {
        debouncedHalftonePreview();
      }
    });

    container.appendChild(btn);
  });
}

// ─── Mode Visibility ───────────────────────────────────────────────────

function updateModeVisibility(mode) {
  const grayscaleFields = document.querySelectorAll(".halftone-grayscale-only");
  grayscaleFields.forEach((el) => {
    el.style.display = mode === "grayscale" ? "" : "none";
  });

  // Update toggle button active states
  document.querySelectorAll('input[name="halftone-mode"]').forEach((radio) => {
    radio.closest(".halftone-mode-btn")?.classList.toggle("active", radio.checked);
  });
}

// ─── Reset ─────────────────────────────────────────────────────────────

function resetHalftone() {
  if (!halftoneCache.originalData || !halftoneCache.previewCanvas) return;

  const ctx = halftoneCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(halftoneCache.originalData, 0, 0);
  dom.cropImage.src = halftoneCache.previewCanvas.toDataURL();
}

// ─── Event Listeners ───────────────────────────────────────────────────

export function initHalftoneListeners(commitBlobCallback) {
  dom.halftoneApply.addEventListener("click", () => applyHalftoneEffect(commitBlobCallback));

  dom.halftoneReset.addEventListener("click", () => {
    resetHalftone();
  });

  const initOrDebounce = () => {
    if (!halftoneCache.originalData) {
      initializeHalftonePreview();
    } else {
      debouncedHalftonePreview();
    }
  };

  // Mode radios
  document.querySelectorAll('input[name="halftone-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updateModeVisibility(radio.value);
      initOrDebounce();
    });
  });

  // Grid size slider
  dom.halftoneGridSize.addEventListener("input", () => {
    dom.halftoneGridSizeValue.textContent = dom.halftoneGridSize.value + "px";
    initOrDebounce();
  });

  // Color pickers
  dom.halftoneDotColor.addEventListener("input", initOrDebounce);
  dom.halftoneBgColor.addEventListener("input", initOrDebounce);

  // Shape selector
  dom.halftoneShape.addEventListener("change", initOrDebounce);

  // Angle slider
  dom.halftoneAngle.addEventListener("input", () => {
    dom.halftoneAngleValue.textContent = dom.halftoneAngle.value + "\u00b0";
    initOrDebounce();
  });

  renderPresets();
  updateModeVisibility("grayscale");
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateHalftoneTool() {
  if (state.current && !halftoneCache.originalData) {
    await initializeHalftonePreview();
  }
}

export function deactivateHalftoneTool() {
  // Cache retained for fast re-activation
}
