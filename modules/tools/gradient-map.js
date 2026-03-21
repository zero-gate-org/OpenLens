import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

// ─── Constants ─────────────────────────────────────────────────────────

const TWO_MEGAPIXELS = 2 * 1024 * 1024;
const DEBOUNCE_MS = 30;

const PRESETS = [
  { name: "Sunset",             stops: [{ pos: 0,    hex: "#0d0221" }, { pos: 0.5,  hex: "#ff6b35" }, { pos: 1,    hex: "#ffeb3b" }] },
  { name: "Ocean Depth",        stops: [{ pos: 0,    hex: "#000428" }, { pos: 0.6,  hex: "#004e92" }, { pos: 1,    hex: "#a8edea" }] },
  { name: "Forest",             stops: [{ pos: 0,    hex: "#0a0a0a" }, { pos: 0.4,  hex: "#1b4332" }, { pos: 1,    hex: "#95d5b2" }] },
  { name: "Infrared",           stops: [{ pos: 0,    hex: "#000000" }, { pos: 0.33, hex: "#ff0000" }, { pos: 0.66, hex: "#ffff00" }, { pos: 1, hex: "#ffffff" }] },
  { name: "Gold Chrome",        stops: [{ pos: 0,    hex: "#2c2c2c" }, { pos: 0.3,  hex: "#8b6914" }, { pos: 0.6,  hex: "#ffd700" }, { pos: 1, hex: "#fffde7" }] },
  { name: "Duotone Purple-Yellow", stops: [{ pos: 0, hex: "#1e003c" }, { pos: 1,    hex: "#f5e642" }] },
  { name: "Noir",               stops: [{ pos: 0,    hex: "#000000" }, { pos: 1,    hex: "#ffffff" }] },
  { name: "Warm Sepia",         stops: [{ pos: 0,    hex: "#1c0a00" }, { pos: 0.5,  hex: "#6b3a1f" }, { pos: 1,    hex: "#f0d9a0" }] },
];

const DEFAULT_STOPS = [
  { pos: 0,   hex: "#000000" },
  { pos: 1,   hex: "#ffffff" },
];

// ─── State ─────────────────────────────────────────────────────────────

let gmCache = {
  blobUrl: null,
  originalData: null,
  previewCanvas: null,
  isProcessing: false,
};

let stops = DEFAULT_STOPS.map(s => ({ ...s, rgb: hexToRgb(s.hex) }));
let currentLUT = null;
let worker = null;
let workerBusy = false;

// Gradient editor drag state
let dragIndex = -1;
let gradientBarCtx = null;

// ─── Color Parsing ─────────────────────────────────────────────────────

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  let r, g, b;
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
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// ─── LUT Engine ────────────────────────────────────────────────────────

function buildLUT(stopsArr) {
  const sorted = [...stopsArr].sort((a, b) => a.pos - b.pos);
  const lut = new Uint8Array(256 * 3);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s0 = sorted[0], s1 = sorted[sorted.length - 1];

    for (let j = 0; j < sorted.length - 1; j++) {
      if (t >= sorted[j].pos && t <= sorted[j + 1].pos) {
        s0 = sorted[j];
        s1 = sorted[j + 1];
        break;
      }
    }

    const range = s1.pos - s0.pos;
    const localT = range === 0 ? 0 : (t - s0.pos) / range;
    lut[i * 3]     = Math.round(s0.rgb.r + localT * (s1.rgb.r - s0.rgb.r));
    lut[i * 3 + 1] = Math.round(s0.rgb.g + localT * (s1.rgb.g - s0.rgb.g));
    lut[i * 3 + 2] = Math.round(s0.rgb.b + localT * (s1.rgb.b - s0.rgb.b));
  }

  return lut;
}

// ─── Core Pixel Math ───────────────────────────────────────────────────

function applyGradientMapSync(imageData, lut, intensity, blendMode) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const dst = new Uint8ClampedArray(data.length);
  const len = src.length;

  if (blendMode === "replace") {
    for (let i = 0; i < len; i += 4) {
      const lum = Math.round(0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]);
      const idx = lum * 3;
      dst[i]     = clampByte(Math.round(src[i]     + intensity * (lut[idx]     - src[i])));
      dst[i + 1] = clampByte(Math.round(src[i + 1] + intensity * (lut[idx + 1] - src[i + 1])));
      dst[i + 2] = clampByte(Math.round(src[i + 2] + intensity * (lut[idx + 2] - src[i + 2])));
      dst[i + 3] = src[i + 3];
    }
  } else if (blendMode === "luminosity") {
    for (let i = 0; i < len; i += 4) {
      const lum = Math.round(0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]);
      const idx = lum * 3;
      const mappedLum = 0.2126 * lut[idx] + 0.7152 * lut[idx + 1] + 0.0722 * lut[idx + 2];
      const origLum = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      const diff = mappedLum - origLum;
      dst[i]     = clampByte(Math.round(src[i]     + intensity * (clampByte(src[i]     + diff) - src[i])));
      dst[i + 1] = clampByte(Math.round(src[i + 1] + intensity * (clampByte(src[i + 1] + diff) - src[i + 1])));
      dst[i + 2] = clampByte(Math.round(src[i + 2] + intensity * (clampByte(src[i + 2] + diff) - src[i + 2])));
      dst[i + 3] = src[i + 3];
    }
  } else if (blendMode === "color") {
    for (let i = 0; i < len; i += 4) {
      const lum = Math.round(0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]);
      const idx = lum * 3;
      const mappedHsl = rgbToHsl(lut[idx], lut[idx + 1], lut[idx + 2]);
      const origHsl = rgbToHsl(src[i], src[i + 1], src[i + 2]);
      const blended = hslToRgb(mappedHsl[0], mappedHsl[1], origHsl[2]);
      dst[i]     = clampByte(Math.round(src[i]     + intensity * (blended[0] - src[i])));
      dst[i + 1] = clampByte(Math.round(src[i + 1] + intensity * (blended[1] - src[i + 1])));
      dst[i + 2] = clampByte(Math.round(src[i + 2] + intensity * (blended[2] - src[i + 2])));
      dst[i + 3] = src[i + 3];
    }
  } else if (blendMode === "multiply") {
    for (let i = 0; i < len; i += 4) {
      const lum = Math.round(0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]);
      const idx = lum * 3;
      const mr = (src[i]     * lut[idx])     / 255;
      const mg = (src[i + 1] * lut[idx + 1]) / 255;
      const mb = (src[i + 2] * lut[idx + 2]) / 255;
      dst[i]     = clampByte(Math.round(src[i]     + intensity * (mr - src[i])));
      dst[i + 1] = clampByte(Math.round(src[i + 1] + intensity * (mg - src[i + 1])));
      dst[i + 2] = clampByte(Math.round(src[i + 2] + intensity * (mb - src[i + 2])));
      dst[i + 3] = src[i + 3];
    }
  }

  return new ImageData(dst, width, height);
}

// ─── Web Worker ────────────────────────────────────────────────────────

function getWorker() {
  if (!worker) {
    const blob = new Blob(
      ['importScripts("./modules/tools/gradient-map-worker.js");'],
      { type: "application/javascript" }
    );
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  }
  return worker;
}

function processWithWorker(originalData, lut, intensity, blendMode) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const buffer = originalData.data.buffer.slice(0);

    w.onmessage = (e) => {
      workerBusy = false;
      const resultData = new Uint8ClampedArray(e.data.pixelBuffer);
      resolve(new ImageData(resultData, originalData.width, originalData.height));
    };

    w.onerror = (err) => {
      workerBusy = false;
      reject(err);
    };

    workerBusy = true;
    w.postMessage(
      { pixelBuffer: buffer, lut: lut, intensity, blendMode },
      [buffer]
    );
  });
}

// ─── Cache Management ──────────────────────────────────────────────────

export function clearGradientMapCache() {
  gmCache.blobUrl = null;
  gmCache.originalData = null;
  gmCache.previewCanvas = null;
  gmCache.isProcessing = false;
}

// ─── Gradient Bar Rendering ────────────────────────────────────────────

function renderGradientBar() {
  const canvas = dom.gmGradientBar;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  for (const s of sorted) {
    grad.addColorStop(s.pos, s.hex);
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  gradientBarCtx = ctx;
}

function renderStopHandles() {
  const track = dom.gmStopsTrack;
  if (!track) return;

  track.innerHTML = "";
  stops.forEach((stop, i) => {
    const handle = document.createElement("div");
    handle.className = "gm-stop-handle";
    handle.style.left = (stop.pos * 100) + "%";
    handle.style.setProperty("--stop-color", stop.hex);
    handle.dataset.index = i;

    // Set the handle's color swatch via ::after background
    handle.style.cssText += `left:${stop.pos * 100}%;`;

    // Use inline style on a pseudo-target: set border color on the ::after
    const styleEl = document.createElement("style");
    styleEl.textContent = `.gm-stop-handle[data-index="${i}"]::after { background-color: ${stop.hex}; }`;
    handle.appendChild(styleEl);

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startDragStop(i, e);
    });

    handle.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openColorPicker(i);
    });

    handle.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeStop(i);
    });

    track.appendChild(handle);
  });
}

function renderStopList() {
  const list = dom.gmStopList;
  if (!list) return;

  list.innerHTML = "";
  stops.forEach((stop, i) => {
    const row = document.createElement("div");
    row.className = "gm-stop-row";

    const swatch = document.createElement("div");
    swatch.className = "gm-stop-swatch";
    swatch.style.backgroundColor = stop.hex;
    swatch.title = "Click to change color";
    swatch.addEventListener("click", () => openColorPicker(i));

    const hexInput = document.createElement("input");
    hexInput.className = "gm-stop-hex";
    hexInput.type = "text";
    hexInput.value = stop.hex;
    hexInput.maxLength = 7;
    hexInput.addEventListener("change", () => {
      const val = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        stops[i].hex = val;
        stops[i].rgb = hexToRgb(val);
        onGradientChanged();
      } else {
        hexInput.value = stops[i].hex;
      }
    });

    const posInput = document.createElement("input");
    posInput.className = "gm-stop-pos";
    posInput.type = "number";
    posInput.min = 0;
    posInput.max = 100;
    posInput.value = Math.round(stop.pos * 100);
    posInput.addEventListener("change", () => {
      let v = parseInt(posInput.value, 10);
      if (isNaN(v)) v = Math.round(stops[i].pos * 100);
      v = Math.max(0, Math.min(100, v));
      stops[i].pos = v / 100;
      posInput.value = v;
      onGradientChanged();
    });

    const pctLabel = document.createElement("span");
    pctLabel.textContent = "%";
    pctLabel.style.color = "var(--text-muted)";
    pctLabel.style.fontSize = "0.65rem";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "gm-stop-delete";
    deleteBtn.type = "button";
    deleteBtn.textContent = "\u00d7";
    deleteBtn.title = "Remove stop";
    deleteBtn.disabled = stops.length <= 2;
    deleteBtn.addEventListener("click", () => removeStop(i));

    row.appendChild(swatch);
    row.appendChild(hexInput);
    row.appendChild(posInput);
    row.appendChild(pctLabel);
    row.appendChild(deleteBtn);
    list.appendChild(row);
  });
}

function renderAll() {
  renderGradientBar();
  renderStopHandles();
  renderStopList();
}

// ─── Stop Interactions ─────────────────────────────────────────────────

function openColorPicker(index) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = stops[index].hex;
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.appendChild(input);

  input.addEventListener("input", () => {
    stops[index].hex = input.value;
    stops[index].rgb = hexToRgb(input.value);
    onGradientChanged();
  });

  input.addEventListener("change", () => {
    document.body.removeChild(input);
  });

  input.click();
}

function addStopAtPosition(pos) {
  pos = Math.max(0, Math.min(1, pos));
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  let s0 = sorted[0], s1 = sorted[sorted.length - 1];
  for (let j = 0; j < sorted.length - 1; j++) {
    if (pos >= sorted[j].pos && pos <= sorted[j + 1].pos) {
      s0 = sorted[j];
      s1 = sorted[j + 1];
      break;
    }
  }
  const range = s1.pos - s0.pos;
  const t = range === 0 ? 0 : (pos - s0.pos) / range;
  const r = Math.round(s0.rgb.r + t * (s1.rgb.r - s0.rgb.r));
  const g = Math.round(s0.rgb.g + t * (s1.rgb.g - s0.rgb.g));
  const b = Math.round(s0.rgb.b + t * (s1.rgb.b - s0.rgb.b));
  const hex = rgbToHex(r, g, b);

  stops.push({ pos, hex, rgb: { r, g, b } });
  onGradientChanged();
}

function removeStop(index) {
  if (stops.length <= 2) return;
  stops.splice(index, 1);
  onGradientChanged();
}

function startDragStop(index, e) {
  dragIndex = index;
  const track = dom.gmStopsTrack;
  const handles = track.querySelectorAll(".gm-stop-handle");
  if (handles[index]) handles[index].classList.add("active");

  const onMove = (ev) => {
    const rect = track.getBoundingClientRect();
    let pos = (ev.clientX - rect.left) / rect.width;
    pos = Math.max(0, Math.min(1, pos));
    stops[dragIndex].pos = pos;
    onGradientChanged();
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    const handles = track.querySelectorAll(".gm-stop-handle");
    if (handles[dragIndex]) handles[dragIndex].classList.remove("active");
    dragIndex = -1;
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// Click on gradient bar to add stop
function initGradientBarClick() {
  const canvas = dom.gmGradientBar;
  if (!canvas) return;

  let canvasReady = false;

  function sizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
      canvasReady = true;
      renderGradientBar();
    }
  }

  // Use ResizeObserver to detect when panel becomes visible
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => { sizeCanvas(); });
    ro.observe(canvas);
  } else {
    // Fallback: try on init and on activate
    requestAnimationFrame(sizeCanvas);
  }

  canvas.addEventListener("mousedown", (e) => {
    if (!canvasReady) sizeCanvas();
    const rect = canvas.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    addStopAtPosition(pos);
  });
}

// ─── Gradient Change Handler ───────────────────────────────────────────

function onGradientChanged() {
  currentLUT = buildLUT(stops);
  renderAll();
  if (gmCache.originalData) {
    debouncedPreview();
  }
}

// ─── Params ────────────────────────────────────────────────────────────

function getParams() {
  return {
    intensity: Number(dom.gmIntensity.value) / 100,
    blendMode: dom.gmBlendMode.value || "replace",
  };
}

function isLargeImage() {
  if (!state.current) return false;
  return (state.current.width * state.current.height) > TWO_MEGAPIXELS;
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializePreview() {
  if (!state.current || gmCache.isProcessing) return;
  if (gmCache.blobUrl === state.current.previewUrl && gmCache.originalData) return;

  gmCache.isProcessing = true;

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

    gmCache.blobUrl = state.current.previewUrl;
    gmCache.originalData = originalData;
    gmCache.previewCanvas = canvas;

    if (!currentLUT) currentLUT = buildLUT(stops);

    setStatus("Preview ready.", 100);
    await updatePreview();
  } catch (error) {
    console.error("Failed to initialize gradient map preview:", error);
    setStatus("Couldn\u2019t prepare preview.", 0);
  } finally {
    gmCache.isProcessing = false;
  }
}

// ─── Preview Update ────────────────────────────────────────────────────

async function updatePreview() {
  if (!gmCache.originalData || !gmCache.previewCanvas) return;
  if (workerBusy) return;

  if (!currentLUT) currentLUT = buildLUT(stops);

  const { intensity, blendMode } = getParams();
  let finalData;

  if (isLargeImage()) {
    setStatus("Processing\u2026", 50);
    dom.canvasOverlay?.classList.add("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "false");

    try {
      finalData = await processWithWorker(gmCache.originalData, currentLUT, intensity, blendMode);
    } catch (err) {
      console.error("Worker failed, falling back to sync:", err);
      finalData = applyGradientMapSync(gmCache.originalData, currentLUT, intensity, blendMode);
    }

    dom.canvasOverlay?.classList.remove("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "true");
  } else {
    finalData = applyGradientMapSync(gmCache.originalData, currentLUT, intensity, blendMode);
  }

  const ctx = gmCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(finalData, 0, 0);
  dom.cropImage.src = gmCache.previewCanvas.toDataURL();
}

// ─── Debounce ──────────────────────────────────────────────────────────

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const debouncedPreview = debounce(updatePreview, DEBOUNCE_MS);

// ─── Apply (Commit) ───────────────────────────────────────────────────

export async function applyGradientMapEffect(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Gradient Map", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);

    if (!currentLUT) currentLUT = buildLUT(stops);
    const { intensity, blendMode } = getParams();

    let finalData;

    if (isLargeImage() && gmCache.originalData) {
      setStatus(FRIENDLY_STATUS.applyingEffect, 50);
      try {
        finalData = await processWithWorker(gmCache.originalData, currentLUT, intensity, blendMode);
      } catch (err) {
        finalData = applyGradientMapSync(gmCache.originalData, currentLUT, intensity, blendMode);
      }
    } else if (gmCache.originalData) {
      finalData = applyGradientMapSync(gmCache.originalData, currentLUT, intensity, blendMode);
    } else {
      const sourceImage = await loadImageElementFromBlob(state.current.blob);
      const canvas = document.createElement("canvas");
      canvas.width = state.current.width;
      canvas.height = state.current.height;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("Failed to get canvas context");
      ctx.drawImage(sourceImage, 0, 0);
      const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      finalData = applyGradientMapSync(originalData, currentLUT, intensity, blendMode);
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

    await commitBlobCallback(blob, "Gradient Map", state.current.name);
    clearGradientMapCache();
  }, syncUndoButtons);
}

// ─── Preset Rendering ──────────────────────────────────────────────────

function renderPresets() {
  const container = dom.gmPresets;
  if (!container) return;

  container.innerHTML = "";

  PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gm-preset-btn";
    btn.title = preset.name;

    // Build a tiny gradient swatch
    const swatch = document.createElement("span");
    swatch.className = "gm-preset-swatch";
    const sorted = [...preset.stops].sort((a, b) => a.pos - b.pos);
    swatch.style.background = `linear-gradient(90deg, ${sorted.map(s => `${s.hex} ${Math.round(s.pos * 100)}%`).join(", ")})`;

    const label = document.createElement("span");
    label.className = "gm-preset-label";
    label.textContent = preset.name;

    btn.appendChild(swatch);
    btn.appendChild(label);

    btn.addEventListener("click", () => {
      stops = preset.stops.map(s => ({ ...s, rgb: hexToRgb(s.hex) }));
      currentLUT = buildLUT(stops);
      renderAll();
      if (!gmCache.originalData) {
        initializePreview();
      } else {
        debouncedPreview();
      }
    });

    container.appendChild(btn);
  });
}

// ─── Reset ─────────────────────────────────────────────────────────────

function resetGradientMap() {
  if (!gmCache.originalData || !gmCache.previewCanvas) return;

  const ctx = gmCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(gmCache.originalData, 0, 0);
  dom.cropImage.src = gmCache.previewCanvas.toDataURL();
}

// ─── Reverse ───────────────────────────────────────────────────────────

function reverseStops() {
  stops.forEach(s => {
    s.pos = 1 - s.pos;
  });
  currentLUT = buildLUT(stops);
  renderAll();
  if (gmCache.originalData) {
    debouncedPreview();
  }
}

// ─── Event Listeners ───────────────────────────────────────────────────

export function initGradientMapListeners(commitBlobCallback) {
  dom.gmApply.addEventListener("click", () => applyGradientMapEffect(commitBlobCallback));

  dom.gmReset.addEventListener("click", () => {
    resetGradientMap();
  });

  dom.gmReverse.addEventListener("click", () => {
    reverseStops();
  });

  const initOrDebounce = () => {
    if (!gmCache.originalData) {
      initializePreview();
    } else {
      debouncedPreview();
    }
  };

  dom.gmIntensity.addEventListener("input", () => {
    dom.gmIntensityValue.textContent = dom.gmIntensity.value + "%";
    initOrDebounce();
  });

  dom.gmBlendMode.addEventListener("change", initOrDebounce);

  initGradientBarClick();
  renderPresets();
  currentLUT = buildLUT(stops);
  renderAll();
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateGradientMapTool() {
  // Re-render gradient bar now that panel is visible
  const canvas = dom.gmGradientBar;
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
      renderGradientBar();
      renderStopHandles();
    }
  }
  if (state.current && !gmCache.originalData) {
    await initializePreview();
  }
}

export function deactivateGradientMapTool() {
  // Cache retained for fast re-activation
}
