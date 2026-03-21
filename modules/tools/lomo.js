import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

// ─── Constants ─────────────────────────────────────────────────────────

const TWO_MEGAPIXELS = 2 * 1024 * 1024;
const DEBOUNCE_MS = 30;
const CURVE_DEBOUNCE_MS = 50;

// ─── Preset Definitions ────────────────────────────────────────────────

const PRESETS = [
  {
    name: "Classic Lomo",
    curves: {
      R: [{ x: 0, y: 0 }, { x: 128, y: 148 }, { x: 255, y: 235 }],
      G: [{ x: 0, y: 10 }, { x: 128, y: 130 }, { x: 255, y: 220 }],
      B: [{ x: 0, y: 30 }, { x: 128, y: 110 }, { x: 255, y: 200 }],
    },
    saturation: 1.6,
    vignette: 0.7,
    warmth: 15,
  },
  {
    name: "Cross-Process (E6→C41)",
    curves: {
      R: [{ x: 0, y: 0 }, { x: 64, y: 100 }, { x: 255, y: 255 }],
      G: [{ x: 0, y: 20 }, { x: 128, y: 160 }, { x: 255, y: 230 }],
      B: [{ x: 0, y: 40 }, { x: 128, y: 80 }, { x: 255, y: 200 }],
    },
    saturation: 1.8,
    vignette: 0.4,
    warmth: -10,
  },
  {
    name: "Faded Film",
    curves: {
      R: [{ x: 0, y: 40 }, { x: 255, y: 220 }],
      G: [{ x: 0, y: 35 }, { x: 255, y: 215 }],
      B: [{ x: 0, y: 50 }, { x: 255, y: 200 }],
    },
    saturation: 0.85,
    vignette: 0.5,
    warmth: 5,
  },
  {
    name: "Velvia Slide",
    curves: {
      R: [{ x: 0, y: 0 }, { x: 128, y: 145 }, { x: 255, y: 255 }],
      G: [{ x: 0, y: 0 }, { x: 128, y: 140 }, { x: 255, y: 255 }],
      B: [{ x: 0, y: 0 }, { x: 128, y: 120 }, { x: 255, y: 255 }],
    },
    saturation: 2.2,
    vignette: 0.3,
    warmth: 20,
  },
  {
    name: "Cyberpunk Cross",
    curves: {
      R: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 255 }, { x: 255, y: 255 }],
      G: [{ x: 0, y: 20 }, { x: 128, y: 200 }, { x: 255, y: 230 }],
      B: [{ x: 0, y: 80 }, { x: 128, y: 200 }, { x: 255, y: 255 }],
    },
    saturation: 2.5,
    vignette: 0.8,
    warmth: -30,
  },
];

// ─── State ─────────────────────────────────────────────────────────────

let lomoCache = {
  blobUrl: null,
  originalData: null,
  previewCanvas: null,
  isProcessing: false,
};

let worker = null;
let workerBusy = false;

// Current curve state per channel
let curveState = {
  R: [...PRESETS[0].curves.R],
  G: [...PRESETS[0].curves.G],
  B: [...PRESETS[0].curves.B],
};

let currentChannel = "R";
let activePresetIndex = 0;

// Curve editor drag state
let dragPoint = null;
let dragChannel = null;

// ─── Monotone Cubic Spline (Fritsch-Carlson) ───────────────────────────

function buildCurveLUT(controlPoints) {
  const lut = new Uint8Array(256);
  if (controlPoints.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }

  // Sort by x
  const pts = controlPoints.slice().sort((a, b) => a.x - b.x);

  // Ensure endpoints
  if (pts[0].x > 0) pts.unshift({ x: 0, y: 0 });
  if (pts[pts.length - 1].x < 255) pts.push({ x: 255, y: 255 });

  const n = pts.length;
  const dx = new Float64Array(n - 1);
  const dy = new Float64Array(n - 1);
  const slopes = new Float64Array(n - 1);

  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    slopes[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }

  // Tangents via Fritsch-Carlson method
  const tangents = new Float64Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangents[i] = (w1 + w2) / (w1 / slopes[i - 1] + w2 / slopes[i]);
    }
  }

  // Build LUT via Hermite interpolation
  let seg = 0;
  for (let i = 0; i < 256; i++) {
    // Advance segment
    while (seg < n - 2 && pts[seg + 1].x < i) seg++;

    const x0 = pts[seg].x;
    const x1 = pts[seg + 1].x;
    const y0 = pts[seg].y;
    const y1 = pts[seg + 1].y;
    const m0 = tangents[seg];
    const m1 = tangents[seg + 1];

    if (x1 === x0) {
      lut[i] = Math.max(0, Math.min(255, Math.round(y1)));
      continue;
    }

    const t = (i - x0) / (x1 - x0);
    const t2 = t * t;
    const t3 = t2 * t;

    // Hermite basis
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const val = h00 * y0 + h10 * (x1 - x0) * m0 + h01 * y1 + h11 * (x1 - x0) * m1;
    lut[i] = Math.max(0, Math.min(255, Math.round(val)));
  }

  return lut;
}

// ─── Vignette ──────────────────────────────────────────────────────────

function applyVignette(ctx, width, height, strength, shape) {
  if (strength <= 0) return;

  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);

  // Create temporary canvas for vignette layer
  const vigCanvas = document.createElement("canvas");
  vigCanvas.width = width;
  vigCanvas.height = height;
  const vCtx = vigCanvas.getContext("2d");

  // Determine radii based on shape
  let innerR, outerRx, outerRy;
  if (shape === "oval") {
    outerRx = cx;
    outerRy = cy;
    innerR = Math.min(cx, cy) * 0.3;
  } else {
    outerRx = outerRy = maxR;
    innerR = maxR * 0.3;
  }

  const gradient = vCtx.createRadialGradient(cx, cy, innerR, cx, cy, shape === "oval" ? Math.max(outerRx, outerRy) : outerRx);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.5, `rgba(0,0,0,${strength * 0.3})`);
  gradient.addColorStop(1, `rgba(0,0,0,${strength})`);

  vCtx.fillStyle = gradient;
  if (shape === "oval") {
    // Scale for oval shape
    vCtx.save();
    vCtx.translate(cx, cy);
    vCtx.scale(1, outerRy / outerRx);
    vCtx.translate(-cx, -cy);
    vCtx.fillRect(0, 0, width, height);
    vCtx.restore();
  } else {
    vCtx.fillRect(0, 0, width, height);
  }

  // Composite using multiply
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(vigCanvas, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}

// ─── Web Worker ────────────────────────────────────────────────────────

function getWorker() {
  if (!worker) {
    const blob = new Blob(
      ['importScripts("./modules/tools/lomo-worker.js");'],
      { type: "application/javascript" }
    );
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  }
  return worker;
}

function processWithWorker(originalData, lutR, lutG, lutB, saturation, warmth, intensity) {
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
        lutR: Array.from(lutR),
        lutG: Array.from(lutG),
        lutB: Array.from(lutB),
        saturation,
        warmth,
        intensity,
      },
      [buffer]
    );
  });
}

// ─── Main Thread Processing (for small images) ─────────────────────────

function applyLomoMain(imageData, lutR, lutG, lutB, saturation, warmth, intensity) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const dst = new Uint8ClampedArray(data.length);
  const len = src.length;

  for (let i = 0; i < len; i += 4) {
    let r = lutR[src[i]];
    let g = lutG[src[i + 1]];
    let b = lutB[src[i + 2]];

    // Saturation via HSL
    if (saturation !== 1.0) {
      let rn = r / 255, gn = g / 255, bn = b / 255;
      const max = rn > gn ? (rn > bn ? rn : bn) : (gn > bn ? gn : bn);
      const min = rn < gn ? (rn < bn ? rn : bn) : (gn < bn ? gn : bn);
      const l = (max + min) / 2;

      if (max !== min) {
        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h;
        if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        else if (max === gn) h = ((bn - rn) / d + 2) / 6;
        else h = ((rn - gn) / d + 4) / 6;

        const newS = Math.min(1, s * saturation);
        const q = l < 0.5 ? l * (1 + newS) : l + newS - l * newS;
        const p = 2 * l - q;
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
        g = Math.round(hue2rgb(p, q, h) * 255);
        b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
      }
    }

    // Warmth
    if (warmth !== 0) {
      r = r + warmth;
      b = b - warmth;
      r = r < 0 ? 0 : r > 255 ? 255 : r;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
    }

    // Intensity blend
    if (intensity < 1.0) {
      r = src[i] + intensity * (r - src[i]);
      g = src[i + 1] + intensity * (g - src[i + 1]);
      b = src[i + 2] + intensity * (b - src[i + 2]);
    }

    dst[i] = r;
    dst[i + 1] = g;
    dst[i + 2] = b;
    dst[i + 3] = src[i + 3];
  }

  return new ImageData(dst, width, height);
}

// ─── Get Current Params ────────────────────────────────────────────────

function getLomoParams() {
  return {
    saturation: Number(dom.lomoSaturation?.value || 160) / 100,
    vignette: Number(dom.lomoVignette?.value || 70) / 100,
    vignetteShape: getVignetteShape(),
    warmth: Number(dom.lomoWarmth?.value || 0),
    intensity: Number(dom.lomoIntensity?.value || 100) / 100,
  };
}

function getVignetteShape() {
  const active = document.querySelector(".lomo-shape-btn.active");
  return active?.dataset.shape || "round";
}

function isLargeImage() {
  if (!state.current) return false;
  return state.current.width * state.current.height > TWO_MEGAPIXELS;
}

// ─── Cache Management ──────────────────────────────────────────────────

export function clearLomoCache() {
  lomoCache.blobUrl = null;
  lomoCache.originalData = null;
  lomoCache.previewCanvas = null;
  lomoCache.isProcessing = false;
}

// ─── Preview Initialization ────────────────────────────────────────────

async function initializeLomoPreview() {
  if (!state.current || lomoCache.isProcessing) return;
  if (lomoCache.blobUrl === state.current.previewUrl && lomoCache.originalData) return;

  lomoCache.isProcessing = true;

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

    lomoCache.blobUrl = state.current.previewUrl;
    lomoCache.originalData = originalData;
    lomoCache.previewCanvas = canvas;

    setStatus("Preview ready.", 100);
    await updateLomoPreview();
  } catch (error) {
    console.error("Failed to initialize lomo preview:", error);
    setStatus("Couldn\u2019t prepare preview.", 0);
  } finally {
    lomoCache.isProcessing = false;
  }
}

// ─── Preview Update ────────────────────────────────────────────────────

async function updateLomoPreview() {
  if (!lomoCache.originalData || !lomoCache.previewCanvas) return;
  if (workerBusy) return;

  const { saturation, vignette, vignetteShape, warmth, intensity } = getLomoParams();

  // Build LUTs from current curve state
  const lutR = buildCurveLUT(curveState.R);
  const lutG = buildCurveLUT(curveState.G);
  const lutB = buildCurveLUT(curveState.B);

  let finalData;

  if (isLargeImage()) {
    setStatus("Processing\u2026", 50);
    dom.canvasOverlay?.classList.add("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "false");

    try {
      finalData = await processWithWorker(lomoCache.originalData, lutR, lutG, lutB, saturation, warmth, intensity);
    } catch (err) {
      console.error("Worker failed, falling back to sync:", err);
      finalData = applyLomoMain(lomoCache.originalData, lutR, lutG, lutB, saturation, warmth, intensity);
    }

    dom.canvasOverlay?.classList.remove("is-active");
    dom.canvasOverlay?.setAttribute("aria-hidden", "true");
  } else {
    finalData = applyLomoMain(lomoCache.originalData, lutR, lutG, lutB, saturation, warmth, intensity);
  }

  const ctx = lomoCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(finalData, 0, 0);

  // Apply vignette on top (main thread — fast canvas draw)
  if (vignette > 0) {
    applyVignette(ctx, lomoCache.previewCanvas.width, lomoCache.previewCanvas.height, vignette, vignetteShape);
  }

  dom.cropImage.src = lomoCache.previewCanvas.toDataURL();
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

const debouncedLomoPreview = debounce(updateLomoPreview, DEBOUNCE_MS);
const debouncedCurvePreview = debounce(updateLomoPreview, CURVE_DEBOUNCE_MS);

// ─── Curve Editor ──────────────────────────────────────────────────────

function drawCurveEditor() {
  const canvas = dom.lomoCurveCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = "#111820";
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const pos = (w / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(w, pos);
    ctx.stroke();
  }

  // Diagonal reference line
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w, 0);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw curves for all channels faintly, current channel brightly
  const channels = ["R", "G", "B"];
  const channelColors = { R: "#ff4444", G: "#44ff44", B: "#4488ff" };

  channels.forEach((ch) => {
    const pts = curveState[ch];
    const lut = buildCurveLUT(pts);
    const isActive = ch === currentChannel;

    ctx.strokeStyle = isActive ? channelColors[ch] : channelColors[ch].replace("ff", "33");
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.globalAlpha = isActive ? 1 : 0.3;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = h - (lut[i] / 255) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  // Draw control points for active channel
  const activePts = curveState[currentChannel];
  const color = channelColors[currentChannel];

  activePts.forEach((pt, idx) => {
    const x = (pt.x / 255) * w;
    const y = h - (pt.y / 255) * h;

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Update channel label
  if (dom.lomoCurveChannelLabel) {
    dom.lomoCurveChannelLabel.textContent = currentChannel;
  }
}

function getCanvasPoint(e) {
  const canvas = dom.lomoCurveCanvas;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 255;
  const y = 255 - ((e.clientY - rect.top) / rect.height) * 255;
  return {
    x: Math.max(0, Math.min(255, Math.round(x))),
    y: Math.max(0, Math.min(255, Math.round(y))),
  };
}

function findNearestPoint(px, py, channel) {
  const pts = curveState[channel];
  let nearest = -1;
  let minDist = Infinity;

  pts.forEach((pt, i) => {
    const dist = Math.sqrt((pt.x - px) ** 2 + (pt.y - py) ** 2);
    if (dist < minDist) {
      minDist = dist;
      nearest = i;
    }
  });

  // Only return if within clickable range (~15 units in 0-255 space)
  return minDist < 15 ? nearest : -1;
}

function handleCurveMouseDown(e) {
  e.preventDefault();
  const { x, y } = getCanvasPoint(e);

  // Check if clicking on existing point
  const idx = findNearestPoint(x, y, currentChannel);
  if (idx !== -1) {
    if (e.button === 2) {
      // Right-click to delete (min 2 points)
      if (curveState[currentChannel].length > 2) {
        curveState[currentChannel].splice(idx, 1);
        drawCurveEditor();
        debouncedCurvePreview();
      }
      return;
    }
    dragPoint = idx;
    dragChannel = currentChannel;
  } else if (e.button === 0) {
    // Left-click to add point
    curveState[currentChannel].push({ x, y });
    curveState[currentChannel].sort((a, b) => a.x - b.x);
    dragPoint = curveState[currentChannel].findIndex((p) => p.x === x && p.y === y);
    dragChannel = currentChannel;
    drawCurveEditor();
    debouncedCurvePreview();
  }
}

function handleCurveMouseMove(e) {
  if (dragPoint === null) return;
  const { x, y } = getCanvasPoint(e);
  curveState[dragChannel][dragPoint].x = x;
  curveState[dragChannel][dragPoint].y = y;
  curveState[dragChannel].sort((a, b) => a.x - b.x);
  // Re-find point index after sort
  dragPoint = curveState[dragChannel].findIndex((p) => p.x === x || (Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 2));
  if (dragPoint === -1) dragPoint = 0;
  drawCurveEditor();
  debouncedCurvePreview();
}

function handleCurveMouseUp() {
  dragPoint = null;
  dragChannel = null;
}

function handleCurveContextMenu(e) {
  e.preventDefault();
}

// ─── Apply (Commit) ───────────────────────────────────────────────────

export async function applyLomoEffect(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Lomo / Cross-Process", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);

    const { saturation, vignette, vignetteShape, warmth, intensity } = getLomoParams();

    const lutR = buildCurveLUT(curveState.R);
    const lutG = buildCurveLUT(curveState.G);
    const lutB = buildCurveLUT(curveState.B);

    let finalData;

    if (isLargeImage() && lomoCache.originalData) {
      setStatus(FRIENDLY_STATUS.applyingEffect, 50);
      try {
        finalData = await processWithWorker(lomoCache.originalData, lutR, lutG, lutB, saturation, warmth, intensity);
      } catch (err) {
        finalData = applyLomoMain(lomoCache.originalData, lutR, lutG, lutB, saturation, warmth, intensity);
      }
    } else if (lomoCache.originalData) {
      finalData = applyLomoMain(lomoCache.originalData, lutR, lutG, lutB, saturation, warmth, intensity);
    } else {
      const sourceImage = await loadImageElementFromBlob(state.current.blob);
      const canvas = document.createElement("canvas");
      canvas.width = state.current.width;
      canvas.height = state.current.height;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("Failed to get canvas context");
      ctx.drawImage(sourceImage, 0, 0);
      const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      finalData = applyLomoMain(originalData, lutR, lutG, lutB, saturation, warmth, intensity);
    }

    // Draw onto final canvas with vignette
    const canvas = document.createElement("canvas");
    canvas.width = state.current.width;
    canvas.height = state.current.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.putImageData(finalData, 0, 0);

    if (vignette > 0) {
      applyVignette(ctx, canvas.width, canvas.height, vignette, vignetteShape);
    }

    setStatus(FRIENDLY_STATUS.savingChanges, 80);

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);

    await commitBlobCallback(blob, "Lomo / Cross-Process", state.current.name);
    clearLomoCache();
  }, syncUndoButtons);
}

// ─── Preset Application ────────────────────────────────────────────────

function applyPreset(preset, index) {
  curveState.R = preset.curves.R.map((p) => ({ ...p }));
  curveState.G = preset.curves.G.map((p) => ({ ...p }));
  curveState.B = preset.curves.B.map((p) => ({ ...p }));
  activePresetIndex = index;

  // Update sliders
  if (dom.lomoSaturation) {
    dom.lomoSaturation.value = Math.round(preset.saturation * 100);
    if (dom.lomoSaturationValue) dom.lomoSaturationValue.textContent = preset.saturation.toFixed(1) + "x";
  }
  if (dom.lomoVignette) {
    dom.lomoVignette.value = Math.round(preset.vignette * 100);
    if (dom.lomoVignetteValue) dom.lomoVignetteValue.textContent = Math.round(preset.vignette * 100) + "%";
  }
  if (dom.lomoWarmth) {
    dom.lomoWarmth.value = preset.warmth;
    if (dom.lomoWarmthValue) dom.lomoWarmthValue.textContent = preset.warmth;
  }

  // Highlight preset card
  document.querySelectorAll(".lomo-preset-card").forEach((card, i) => {
    card.classList.toggle("active", i === index);
  });

  drawCurveEditor();

  if (!lomoCache.originalData) {
    initializeLomoPreview();
  } else {
    debouncedLomoPreview();
  }
}

// ─── Preset Rendering ──────────────────────────────────────────────────

function renderPresets() {
  const container = dom.lomoPresets;
  if (!container) return;

  container.innerHTML = "";

  PRESETS.forEach((preset, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "lomo-preset-card" + (idx === 0 ? " active" : "");
    card.title = preset.name;

    const preview = document.createElement("div");
    preview.className = "lomo-preset-preview";

    // Generate miniature gradient swatch showing curve style
    const rLut = buildCurveLUT(preset.curves.R);
    const gLut = buildCurveLUT(preset.curves.G);
    const bLut = buildCurveLUT(preset.curves.B);

    const swatchCanvas = document.createElement("canvas");
    swatchCanvas.width = 48;
    swatchCanvas.height = 48;
    const sCtx = swatchCanvas.getContext("2d");
    const imgData = sCtx.createImageData(48, 48);

    for (let py = 0; py < 48; py++) {
      for (let px = 0; px < 48; px++) {
        const i = (py * 48 + px) * 4;
        const lum = Math.round((px / 47) * 255);
        imgData.data[i] = rLut[lum];
        imgData.data[i + 1] = gLut[lum];
        imgData.data[i + 2] = bLut[lum];
        imgData.data[i + 3] = 255;
      }
    }
    sCtx.putImageData(imgData, 0, 0);
    preview.appendChild(swatchCanvas);

    const label = document.createElement("span");
    label.className = "lomo-preset-name";
    label.textContent = preset.name;

    card.appendChild(preview);
    card.appendChild(label);

    card.addEventListener("click", () => applyPreset(preset, idx));
    container.appendChild(card);
  });
}

// ─── Channel Selector ──────────────────────────────────────────────────

function setupChannelButtons() {
  document.querySelectorAll(".lomo-channel-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".lomo-channel-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentChannel = btn.dataset.channel;
      drawCurveEditor();
    });
  });
}

// ─── Vignette Shape Buttons ────────────────────────────────────────────

function setupShapeButtons() {
  document.querySelectorAll(".lomo-shape-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".lomo-shape-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      initOrDebounce();
    });
  });
}

// ─── Reset ─────────────────────────────────────────────────────────────

function resetLomo() {
  if (!lomoCache.originalData || !lomoCache.previewCanvas) return;

  const ctx = lomoCache.previewCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  ctx.putImageData(lomoCache.originalData, 0, 0);
  dom.cropImage.src = lomoCache.previewCanvas.toDataURL();
}

// ─── Event Listeners ───────────────────────────────────────────────────

const initOrDebounce = () => {
  if (!lomoCache.originalData) {
    initializeLomoPreview();
  } else {
    debouncedLomoPreview();
  }
};

export function initLomoListeners(commitBlobCallback) {
  // Apply / Reset
  dom.lomoApply?.addEventListener("click", () => applyLomoEffect(commitBlobCallback));
  dom.lomoReset?.addEventListener("click", () => resetLomo());

  // Channel buttons
  setupChannelButtons();

  // Vignette shape buttons
  setupShapeButtons();

  // Sliders
  dom.lomoSaturation?.addEventListener("input", () => {
    if (dom.lomoSaturationValue) {
      const val = (Number(dom.lomoSaturation.value) / 100).toFixed(1);
      dom.lomoSaturationValue.textContent = val + "x";
    }
    initOrDebounce();
  });

  dom.lomoVignette?.addEventListener("input", () => {
    if (dom.lomoVignetteValue) dom.lomoVignetteValue.textContent = dom.lomoVignette.value + "%";
    initOrDebounce();
  });

  dom.lomoWarmth?.addEventListener("input", () => {
    if (dom.lomoWarmthValue) dom.lomoWarmthValue.textContent = dom.lomoWarmth.value;
    initOrDebounce();
  });

  dom.lomoIntensity?.addEventListener("input", () => {
    if (dom.lomoIntensityValue) dom.lomoIntensityValue.textContent = dom.lomoIntensity.value + "%";
    initOrDebounce();
  });

  // Curve editor events
  const canvas = dom.lomoCurveCanvas;
  if (canvas) {
    canvas.addEventListener("mousedown", handleCurveMouseDown);
    canvas.addEventListener("mousemove", handleCurveMouseMove);
    canvas.addEventListener("mouseup", handleCurveMouseUp);
    canvas.addEventListener("mouseleave", handleCurveMouseUp);
    canvas.addEventListener("contextmenu", handleCurveContextMenu);
  }

  // Render presets
  renderPresets();

  // Initial curve draw
  drawCurveEditor();
}

// ─── Tool Lifecycle ────────────────────────────────────────────────────

export async function activateLomoTool() {
  if (state.current && !lomoCache.originalData) {
    await initializeLomoPreview();
  }
  drawCurveEditor();
}

export function deactivateLomoTool() {
  // Cache retained for fast re-activation
}
