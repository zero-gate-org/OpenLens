import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

// ─── Constants ─────────────────────────────────────────────────────────

const DEBOUNCE_MS = 60;
const MAX_SAVED_PRESETS = 10;
const STORAGE_KEY = "openlens-watermark-presets";

const POSITIONS = {
  "top-left":      { xRatio: 0.05, yRatio: 0.05 },
  "top-center":    { xRatio: 0.50, yRatio: 0.05 },
  "top-right":     { xRatio: 0.95, yRatio: 0.05 },
  "middle-left":   { xRatio: 0.05, yRatio: 0.50 },
  "center":        { xRatio: 0.50, yRatio: 0.50 },
  "middle-right":  { xRatio: 0.95, yRatio: 0.50 },
  "bottom-left":   { xRatio: 0.05, yRatio: 0.95 },
  "bottom-center": { xRatio: 0.50, yRatio: 0.95 },
  "bottom-right":  { xRatio: 0.95, yRatio: 0.95 },
};

const QUICK_PRESETS = [
  { name: "Subtle ©", type: "text", text: "© 2026", fontSize: 0, color: "#ffffff", opacity: 30, rotation: -30, position: "bottom-right", blendMode: "source-over", bold: false, italic: false, fontFamily: "Inter", align: "center", strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2 },
  { name: "Bold Stamp", type: "text", text: "SAMPLE", fontSize: 0, color: "#ff0000", opacity: 25, rotation: -45, position: "center", blendMode: "overlay", bold: true, italic: false, fontFamily: "Impact", align: "center", strokeEnabled: true, strokeColor: "#ffffff", strokeWidth: 3 },
  { name: "Draft Mark", type: "text", text: "DRAFT", fontSize: 0, color: "#ff6b35", opacity: 20, rotation: -30, position: "center", blendMode: "multiply", bold: true, italic: false, fontFamily: "Arial", align: "center", strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2 },
  { name: "Confidential", type: "text", text: "CONFIDENTIAL", fontSize: 0, color: "#ff0000", opacity: 15, rotation: -20, position: "center", blendMode: "source-over", bold: true, italic: false, fontFamily: "Oswald", align: "center", strokeEnabled: true, strokeColor: "#990000", strokeWidth: 1 },
  { name: "Tiled ©", type: "tiled", tileSource: "text", text: "© 2026", fontSize: 0, color: "#ffffff", opacity: 15, rotation: -30, tileSize: 0, tileGap: 20, blendMode: "source-over", bold: false, italic: false, fontFamily: "Inter", align: "center", strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2 },
];

// ─── State ─────────────────────────────────────────────────────────────

let wmCache = {
  blobUrl: null,
  sourceImage: null,
  previewCanvas: null,
  isProcessing: false,
  logoImage: null,
  logoUrl: null,
  currentPosition: "center",
  dragOffset: { x: 0, y: 0 },
  isDragging: false,
  lastPointer: null,
};

// ─── Helpers ───────────────────────────────────────────────────────────

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function hexToRgba(hex, alpha) {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

function computeAutoSize(canvasWidth) {
  return {
    fontSize: Math.max(12, Math.round(canvasWidth * 0.025)),
    imageScale: 15,
    tileSize: Math.max(150, Math.round(canvasWidth * 0.18)),
  };
}

function getPositionCoords(preset, canvasW, canvasH, margin) {
  const pos = POSITIONS[preset] || POSITIONS["center"];
  const safeX = (margin / 100) * canvasW;
  const safeY = (margin / 100) * canvasH;
  const x = Math.max(safeX, Math.min(canvasW - safeX, canvasW * pos.xRatio));
  const y = Math.max(safeY, Math.min(canvasH - safeY, canvasH * pos.yRatio));
  return { x, y };
}

// ─── Parameter Reading ─────────────────────────────────────────────────

function getParams() {
  const type = document.querySelector('input[name="wm-type"]:checked')?.value || "text";
  const params = {
    type,
    opacity: Number(dom.wmOpacity.value) / 100,
    rotation: Number(dom.wmRotation.value),
    blendMode: dom.wmBlendMode.value,
    position: wmCache.currentPosition,
    posX: Number(dom.wmPosX.value),
    posY: Number(dom.wmPosY.value),
    margin: Number(dom.wmMargin.value),
    fontFamily: dom.wmFontFamily.value,
    fontSize: Number(dom.wmFontSize.value),
    color: dom.wmColor.value,
    bold: dom.wmBold.checked,
    italic: dom.wmItalic.checked,
    align: dom.wmAlign.value,
    text: dom.wmText.value,
    strokeEnabled: dom.wmStrokeEnabled.checked,
    strokeColor: dom.wmStrokeColor.value,
    strokeWidth: Number(dom.wmStrokeWidth.value),
    imageScale: Number(dom.wmImageScale.value) / 100,
    logoImage: wmCache.logoImage,
    tileSource: dom.wmTileSource.value,
    tileSize: Number(dom.wmTileSize.value),
    tileGap: Number(dom.wmTileGap.value),
  };
  return params;
}

function setParamsFromPreset(preset) {
  if (preset.type) {
    const radio = document.querySelector(`input[name="wm-type"][value="${preset.type}"]`);
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change")); }
  }
  if (preset.text !== undefined) dom.wmText.value = preset.text;
  if (preset.fontFamily) dom.wmFontFamily.value = preset.fontFamily;
  if (preset.fontSize && preset.fontSize > 0) {
    dom.wmFontSize.value = preset.fontSize;
    dom.wmFontSizeVal.textContent = preset.fontSize + "px";
  }
  if (preset.color) dom.wmColor.value = preset.color;
  if (preset.opacity !== undefined) {
    dom.wmOpacity.value = preset.opacity;
    dom.wmOpacityVal.textContent = preset.opacity + "%";
  }
  if (preset.rotation !== undefined) {
    dom.wmRotation.value = preset.rotation;
    dom.wmRotationVal.textContent = preset.rotation + "°";
  }
  if (preset.blendMode) dom.wmBlendMode.value = preset.blendMode;
  if (preset.bold !== undefined) dom.wmBold.checked = preset.bold;
  if (preset.italic !== undefined) dom.wmItalic.checked = preset.italic;
  if (preset.align) dom.wmAlign.value = preset.align;
  if (preset.strokeEnabled !== undefined) {
    dom.wmStrokeEnabled.checked = preset.strokeEnabled;
    dom.wmStrokeControls.style.display = preset.strokeEnabled ? "" : "none";
  }
  if (preset.strokeColor) dom.wmStrokeColor.value = preset.strokeColor;
  if (preset.strokeWidth !== undefined) {
    dom.wmStrokeWidth.value = preset.strokeWidth;
    dom.wmStrokeWidthVal.textContent = preset.strokeWidth + "px";
  }
  if (preset.position) {
    wmCache.currentPosition = preset.position;
    updatePositionGridActive();
  }
  if (preset.tileSource) dom.wmTileSource.value = preset.tileSource;
  if (preset.tileSize && preset.tileSize > 0) {
    dom.wmTileSize.value = preset.tileSize;
    dom.wmTileSizeVal.textContent = preset.tileSize + "px";
  }
  if (preset.tileGap !== undefined) {
    dom.wmTileGap.value = preset.tileGap;
    dom.wmTileGapVal.textContent = preset.tileGap + "px";
  }
}

// ─── Rendering ─────────────────────────────────────────────────────────

function renderTextWatermark(ctx, params, x, y) {
  ctx.save();
  ctx.globalAlpha = params.opacity;
  ctx.globalCompositeOperation = params.blendMode;

  const fontStr = `${params.italic ? "italic " : ""}${params.bold ? "bold " : ""}${params.fontSize}px ${params.fontFamily}`;
  ctx.font = fontStr;
  ctx.fillStyle = params.color;
  ctx.textAlign = params.align;
  ctx.textBaseline = "middle";

  if (params.strokeEnabled) {
    ctx.strokeStyle = params.strokeColor;
    ctx.lineWidth = params.strokeWidth;
    ctx.lineJoin = "round";
    ctx.strokeText(params.text, x, y);
  }

  ctx.fillText(params.text, x, y);
  ctx.restore();
}

function renderImageWatermark(ctx, params, x, y) {
  if (!params.logoImage) return;
  ctx.save();
  ctx.globalAlpha = params.opacity;
  ctx.globalCompositeOperation = params.blendMode;

  const w = params.logoImage.naturalWidth * params.imageScale;
  const h = params.logoImage.naturalHeight * params.imageScale;

  ctx.translate(x, y);
  ctx.rotate(params.rotation * Math.PI / 180);
  ctx.drawImage(params.logoImage, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function renderTiledWatermark(ctx, canvas, params) {
  const tileSize = params.tileSize + params.tileGap;
  if (tileSize <= 0) return;

  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = tileSize;
  tileCanvas.height = tileSize;
  const tileCtx = tileCanvas.getContext("2d");

  tileCtx.save();
  tileCtx.globalAlpha = params.opacity;
  tileCtx.translate(tileSize / 2, tileSize / 2);
  tileCtx.rotate(params.rotation * Math.PI / 180);

  if (params.tileSource === "text" || !params.logoImage) {
    const fontStr = `${params.italic ? "italic " : ""}${params.bold ? "bold " : ""}${params.fontSize}px ${params.fontFamily}`;
    tileCtx.font = fontStr;
    tileCtx.fillStyle = params.color;
    tileCtx.textAlign = "center";
    tileCtx.textBaseline = "middle";

    if (params.strokeEnabled) {
      tileCtx.strokeStyle = params.strokeColor;
      tileCtx.lineWidth = params.strokeWidth;
      tileCtx.lineJoin = "round";
      tileCtx.strokeText(params.text, 0, 0);
    }
    tileCtx.fillText(params.text, 0, 0);
  } else {
    const w = params.logoImage.naturalWidth * params.imageScale;
    const h = params.logoImage.naturalHeight * params.imageScale;
    tileCtx.drawImage(params.logoImage, -w / 2, -h / 2, w, h);
  }
  tileCtx.restore();

  ctx.save();
  ctx.globalCompositeOperation = params.blendMode;
  const pattern = ctx.createPattern(tileCanvas, "repeat");
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// ─── Preview ───────────────────────────────────────────────────────────

async function updateWatermarkPreview() {
  if (!wmCache.previewCanvas || !state.current) return;

  const params = getParams();
  const { width, height } = wmCache.previewCanvas;
  const ctx = wmCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  // Restore original image
  if (wmCache.sourceImage) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(wmCache.sourceImage, 0, 0);
  }

  if (params.type === "tiled") {
    renderTiledWatermark(ctx, wmCache.previewCanvas, params);
  } else {
    const basePos = getPositionCoords(params.position, width, height, params.margin);
    const x = basePos.x + params.posX;
    const y = basePos.y + params.posY;

    if (params.type === "text") {
      renderTextWatermark(ctx, params, x, y);
    } else {
      renderImageWatermark(ctx, params, x, y);
    }
  }

  dom.cropImage.src = wmCache.previewCanvas.toDataURL();
}

const debouncedPreview = debounce(updateWatermarkPreview, DEBOUNCE_MS);

// ─── Cache Management ──────────────────────────────────────────────────

export function clearWatermarkCache() {
  wmCache.blobUrl = null;
  wmCache.sourceImage = null;
  wmCache.previewCanvas = null;
  wmCache.isProcessing = false;
  wmCache.logoImage = null;
  if (wmCache.logoUrl) {
    URL.revokeObjectURL(wmCache.logoUrl);
    wmCache.logoUrl = null;
  }
  wmCache.currentPosition = "center";
  wmCache.isDragging = false;
  wmCache.lastPointer = null;
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializeWatermarkPreview() {
  if (!state.current || wmCache.isProcessing) return;
  if (wmCache.blobUrl === state.current.previewUrl && wmCache.previewCanvas) {
    // Still update source for new params
    updateWatermarkPreview();
    return;
  }

  wmCache.isProcessing = true;

  try {
    setStatus(FRIENDLY_STATUS.preparingPreview, 10);
    const sourceImage = await loadImageElementFromBlob(state.current.blob);

    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");

    ctx.drawImage(sourceImage, 0, 0);

    wmCache.blobUrl = state.current.previewUrl;
    wmCache.sourceImage = sourceImage;
    wmCache.previewCanvas = canvas;

    // Auto-size defaults
    const sizes = computeAutoSize(canvas.width);
    if (Number(dom.wmFontSize.value) === 48) {
      dom.wmFontSize.value = sizes.fontSize;
      dom.wmFontSizeVal.textContent = sizes.fontSize + "px";
    }
    if (Number(dom.wmTileSize.value) === 200) {
      dom.wmTileSize.value = sizes.tileSize;
      dom.wmTileSizeVal.textContent = sizes.tileSize + "px";
    }

    setStatus("Preview ready.", 100);
    await updateWatermarkPreview();
  } catch (error) {
    console.error("Failed to initialize watermark preview:", error);
    setStatus("Couldn't prepare preview.", 0);
  } finally {
    wmCache.isProcessing = false;
  }
}

// ─── Apply (Commit) ───────────────────────────────────────────────────

export async function applyWatermark(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Watermark", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);

    const params = getParams();
    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");

    const sourceImage = wmCache.sourceImage || await loadImageElementFromBlob(state.current.blob);
    ctx.drawImage(sourceImage, 0, 0);

    if (params.type === "tiled") {
      renderTiledWatermark(ctx, canvas, params);
    } else {
      const basePos = getPositionCoords(params.position, canvas.width, canvas.height, params.margin);
      const x = basePos.x + params.posX;
      const y = basePos.y + params.posY;

      if (params.type === "text") {
        renderTextWatermark(ctx, params, x, y);
      } else {
        renderImageWatermark(ctx, params, x, y);
      }
    }

    setStatus(FRIENDLY_STATUS.savingChanges, 80);

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);

    await commitBlobCallback(blob, "Watermark", state.current.name);
    clearWatermarkCache();
  }, syncUndoButtons);
}

// ─── Position Grid ─────────────────────────────────────────────────────

function updatePositionGridActive() {
  document.querySelectorAll(".wm-pos-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.pos === wmCache.currentPosition);
  });
}

// ─── Drag to Reposition ────────────────────────────────────────────────

function initDragHandlers() {
  const cropImage = dom.cropImage;
  if (!cropImage) return;

  cropImage.addEventListener("pointerdown", (e) => {
    if (!wmCache.previewCanvas || !state.current) return;
    const type = document.querySelector('input[name="wm-type"]:checked')?.value;
    if (type === "tiled") return; // tiled uses phase offset, skip drag for now

    const rect = cropImage.getBoundingClientRect();
    const scaleX = state.current.width / rect.width;
    const scaleY = state.current.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    const params = getParams();
    const basePos = getPositionCoords(params.position, state.current.width, state.current.height, params.margin);
    const wx = basePos.x + params.posX;
    const wy = basePos.y + params.posY;

    // Hit test: check if pointer is near the watermark
    const hitRadius = type === "text" ? Math.max(params.fontSize, 40) : Math.max(
      (params.logoImage?.naturalWidth || 100) * params.imageScale,
      (params.logoImage?.naturalHeight || 100) * params.imageScale
    ) / 2 + 20;

    const dx = px - wx;
    const dy = py - wy;
    if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
      wmCache.isDragging = true;
      wmCache.dragOffset = { x: dx, y: dy };
      wmCache.lastPointer = { x: px, y: py };
      cropImage.style.cursor = "grabbing";
      e.preventDefault();
    }
  });

  window.addEventListener("pointermove", (e) => {
    if (!wmCache.isDragging || !state.current) return;

    const rect = cropImage.getBoundingClientRect();
    const scaleX = state.current.width / rect.width;
    const scaleY = state.current.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    const params = getParams();
    const basePos = getPositionCoords(params.position, state.current.width, state.current.height, params.margin);

    const newX = Math.round(px - wmCache.dragOffset.x - basePos.x);
    const newY = Math.round(py - wmCache.dragOffset.y - basePos.y);

    dom.wmPosX.value = newX;
    dom.wmPosY.value = newY;

    wmCache.lastPointer = { x: px, y: py };
    debouncedPreview();
  });

  window.addEventListener("pointerup", () => {
    if (wmCache.isDragging) {
      wmCache.isDragging = false;
      cropImage.style.cursor = "";
    }
  });

  cropImage.addEventListener("pointerenter", () => {
    if (!wmCache.isDragging && wmCache.previewCanvas) {
      cropImage.style.cursor = "grab";
    }
  });

  cropImage.addEventListener("pointerleave", () => {
    if (!wmCache.isDragging) {
      cropImage.style.cursor = "";
    }
  });
}

// ─── Saved Presets (localStorage) ──────────────────────────────────────

function loadSavedPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSavedPresets(presets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch { /* quota exceeded, ignore */ }
}

function renderSavedPresetsDropdown() {
  const select = dom.wmSavedPresets;
  if (!select) return;

  const presets = loadSavedPresets();
  select.innerHTML = '<option value="">Load a preset…</option>';
  presets.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = p.name;
    select.appendChild(opt);
  });
}

function saveCurrentAsPreset() {
  const name = dom.wmPresetName?.value?.trim();
  if (!name) return;

  const params = getParams();
  const preset = { name, ...params, logoImage: undefined }; // Don't serialize Image objects

  const presets = loadSavedPresets();
  presets.unshift(preset);
  if (presets.length > MAX_SAVED_PRESETS) presets.length = MAX_SAVED_PRESETS;
  saveSavedPresets(presets);

  dom.wmPresetName.value = "";
  renderSavedPresetsDropdown();
}

function loadSavedPreset(index) {
  const presets = loadSavedPresets();
  const preset = presets[index];
  if (!preset) return;
  setParamsFromPreset(preset);
  initOrDebounce();
}

// ─── Quick Presets ─────────────────────────────────────────────────────

function renderQuickPresets() {
  const container = dom.wmPresets;
  if (!container) return;
  container.innerHTML = "";

  QUICK_PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wm-preset-btn";
    btn.textContent = preset.name;
    btn.title = preset.name;
    btn.addEventListener("click", () => {
      // Auto-compute font size from canvas
      if (wmCache.previewCanvas) {
        const sizes = computeAutoSize(wmCache.previewCanvas.width);
        preset = { ...preset };
        if (preset.fontSize === 0) preset.fontSize = sizes.fontSize;
        if (preset.tileSize === 0) preset.tileSize = sizes.tileSize;
      }
      setParamsFromPreset(preset);
      initOrDebounce();
    });
    container.appendChild(btn);
  });
}

// ─── Tab Switching ─────────────────────────────────────────────────────

function updateTypeTab(type) {
  const textTab = document.querySelector("#wm-text-tab");
  const imageTab = document.querySelector("#wm-image-tab");
  const tiledTab = document.querySelector("#wm-tiled-tab");

  if (textTab) textTab.style.display = (type === "text") ? "" : "none";
  if (imageTab) imageTab.style.display = (type === "image") ? "" : "none";
  if (tiledTab) tiledTab.style.display = (type === "tiled") ? "" : "none";

  // Update toggle button active states
  document.querySelectorAll('input[name="wm-type"]').forEach((radio) => {
    radio.closest(".wm-type-btn")?.classList.toggle("active", radio.checked);
  });

  // Set default rotation for tiled
  if (type === "tiled" && Number(dom.wmRotation.value) === 0) {
    dom.wmRotation.value = -30;
    dom.wmRotationVal.textContent = "-30°";
  }
}

// ─── Auto Size ─────────────────────────────────────────────────────────

function applyAutoSize() {
  if (!wmCache.previewCanvas) return;
  const sizes = computeAutoSize(wmCache.previewCanvas.width);

  dom.wmFontSize.value = sizes.fontSize;
  dom.wmFontSizeVal.textContent = sizes.fontSize + "px";
  dom.wmImageScale.value = sizes.imageScale;
  dom.wmImageScaleVal.textContent = sizes.imageScale + "%";
  dom.wmTileSize.value = sizes.tileSize;
  dom.wmTileSizeVal.textContent = sizes.tileSize + "px";

  initOrDebounce();
}

// ─── Init / Debounce wrapper ───────────────────────────────────────────

function initOrDebounce() {
  if (!wmCache.previewCanvas) {
    initializeWatermarkPreview();
  } else {
    debouncedPreview();
  }
}

// ─── Reset ─────────────────────────────────────────────────────────────

function resetWatermark() {
  if (!wmCache.previewCanvas || !wmCache.sourceImage) return;
  const ctx = wmCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, wmCache.previewCanvas.width, wmCache.previewCanvas.height);
  ctx.drawImage(wmCache.sourceImage, 0, 0);
  dom.cropImage.src = wmCache.previewCanvas.toDataURL();
}

// ─── Event Listeners ───────────────────────────────────────────────────

export function initWatermarkListeners(commitBlobCallback) {
  // Apply / Reset
  dom.wmApply.addEventListener("click", () => applyWatermark(commitBlobCallback));
  dom.wmReset.addEventListener("click", () => resetWatermark());

  // Type tabs
  document.querySelectorAll('input[name="wm-type"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updateTypeTab(radio.value);
      initOrDebounce();
    });
  });

  // Text controls
  dom.wmText.addEventListener("input", debouncedPreview);
  dom.wmFontFamily.addEventListener("change", initOrDebounce);
  dom.wmFontSize.addEventListener("input", () => {
    dom.wmFontSizeVal.textContent = dom.wmFontSize.value + "px";
    initOrDebounce();
  });
  dom.wmBold.addEventListener("change", initOrDebounce);
  dom.wmItalic.addEventListener("change", initOrDebounce);
  dom.wmAlign.addEventListener("change", initOrDebounce);
  dom.wmColor.addEventListener("input", initOrDebounce);

  // Stroke
  dom.wmStrokeEnabled.addEventListener("change", () => {
    dom.wmStrokeControls.style.display = dom.wmStrokeEnabled.checked ? "" : "none";
    initOrDebounce();
  });
  dom.wmStrokeColor.addEventListener("input", initOrDebounce);
  dom.wmStrokeWidth.addEventListener("input", () => {
    dom.wmStrokeWidthVal.textContent = dom.wmStrokeWidth.value + "px";
    initOrDebounce();
  });

  // Image upload
  dom.wmUploadBtn.addEventListener("click", () => dom.wmImageInput.click());
  dom.wmImageInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (wmCache.logoUrl) {
      URL.revokeObjectURL(wmCache.logoUrl);
    }

    const url = URL.createObjectURL(file);
    wmCache.logoUrl = url;

    const img = new Image();
    img.onload = () => {
      wmCache.logoImage = img;
      dom.wmImageName.textContent = file.name;
      initOrDebounce();
    };
    img.onerror = () => {
      dom.wmImageName.textContent = "Failed to load";
    };
    img.src = url;

    e.target.value = "";
  });
  dom.wmImageScale.addEventListener("input", () => {
    dom.wmImageScaleVal.textContent = dom.wmImageScale.value + "%";
    initOrDebounce();
  });

  // Tiled controls
  dom.wmTileSource.addEventListener("change", initOrDebounce);
  dom.wmTileSize.addEventListener("input", () => {
    dom.wmTileSizeVal.textContent = dom.wmTileSize.value + "px";
    initOrDebounce();
  });
  dom.wmTileGap.addEventListener("input", () => {
    dom.wmTileGapVal.textContent = dom.wmTileGap.value + "px";
    initOrDebounce();
  });

  // Shared appearance
  dom.wmOpacity.addEventListener("input", () => {
    dom.wmOpacityVal.textContent = dom.wmOpacity.value + "%";
    initOrDebounce();
  });
  dom.wmRotation.addEventListener("input", () => {
    dom.wmRotationVal.textContent = dom.wmRotation.value + "°";
    initOrDebounce();
  });
  dom.wmBlendMode.addEventListener("change", initOrDebounce);

  // Position grid
  document.querySelectorAll(".wm-pos-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      wmCache.currentPosition = btn.dataset.pos;
      dom.wmPosX.value = 0;
      dom.wmPosY.value = 0;
      updatePositionGridActive();
      initOrDebounce();
    });
  });

  // Fine-tune position
  dom.wmPosX.addEventListener("input", debouncedPreview);
  dom.wmPosY.addEventListener("input", debouncedPreview);

  // Safe margin
  dom.wmMargin.addEventListener("input", () => {
    dom.wmMarginVal.textContent = dom.wmMargin.value + "%";
    initOrDebounce();
  });

  // Auto-size
  dom.wmAutoSize.addEventListener("click", applyAutoSize);

  // Saved presets
  dom.wmSavePreset.addEventListener("click", saveCurrentAsPreset);
  dom.wmSavedPresets.addEventListener("change", () => {
    const idx = dom.wmSavedPresets.selectedIndex - 1; // offset by "Load a preset…" option
    if (idx >= 0) loadSavedPreset(idx);
    dom.wmSavedPresets.value = "";
  });

  // Drag
  initDragHandlers();

  // Render quick presets and saved presets
  renderQuickPresets();
  renderSavedPresetsDropdown();
  updateTypeTab("text");
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateWatermarkTool() {
  if (state.current) {
    await initializeWatermarkPreview();
  }
}

export function deactivateWatermarkTool() {
  // Cache retained for fast re-activation
}
