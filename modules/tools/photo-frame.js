// Photo Frame / Polaroid Generator
import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

const DEBOUNCE_MS = 30;

// ─── Frame Defaults ──────────────────────────────────────────────────────

const FRAME_DEFAULTS = {
  polaroid: {
    borders: { top: 40, right: 40, bottom: 140, left: 40 },
    bgColor: "#f9f8f6",
    cornerRadius: 2,
    shadow: { enabled: true, color: "#000000", blur: 25, x: 8, y: 12, opacity: 45 },
    rotation: 0,
    captionFont: '"Brush Script MT", cursive',
    captionSize: 32,
    captionColor: "#2c2c2c",
  },
  filmstrip: {
    borders: { top: 20, right: 80, bottom: 20, left: 80 },
    bgColor: "#111111",
    cornerRadius: 0,
    shadow: { enabled: false, color: "#000000", blur: 0, x: 0, y: 0, opacity: 0 },
    rotation: 0,
    captionFont: '"Courier New", monospace',
    captionSize: 14,
    captionColor: "#d48d20",
  },
  vintage: {
    borders: { top: 35, right: 35, bottom: 50, left: 35 },
    bgColor: "#e8ddcc",
    cornerRadius: 1,
    shadow: { enabled: true, color: "#000000", blur: 15, x: 4, y: 6, opacity: 30 },
    rotation: 0,
    captionFont: "Georgia, serif",
    captionSize: 22,
    captionColor: "#574330",
  },
  passport: {
    borders: { top: 15, right: 15, bottom: 15, left: 15 },
    bgColor: "#fefefe",
    cornerRadius: 0,
    shadow: { enabled: false, color: "#000000", blur: 0, x: 0, y: 0, opacity: 0 },
    rotation: 0,
    captionFont: "Inter, sans-serif",
    captionSize: 12,
    captionColor: "#222222",
  },
  instax: {
    borders: { top: 20, right: 20, bottom: 85, left: 20 },
    bgColor: "#fafafa",
    cornerRadius: 10,
    shadow: { enabled: true, color: "#000000", blur: 18, x: 5, y: 8, opacity: 40 },
    rotation: 0,
    captionFont: '"Brush Script MT", cursive',
    captionSize: 24,
    captionColor: "#444444",
  },
  magazine: {
    borders: { top: 20, right: 20, bottom: 40, left: 20 },
    bgColor: "#ffffff",
    cornerRadius: 0,
    shadow: { enabled: true, color: "#000000", blur: 10, x: 0, y: 5, opacity: 20 },
    rotation: 0,
    captionFont: '"Dancing Script", cursive',
    captionSize: 28,
    captionColor: "#111111",
  },
  neon: {
    borders: { top: 40, right: 40, bottom: 40, left: 40 },
    bgColor: "#080808",
    cornerRadius: 6,
    shadow: { enabled: true, color: "#00ffff", blur: 30, x: 0, y: 0, opacity: 60 },
    rotation: 0,
    neonColor: "#00ffff",
    neonGlow: 3,
    neonWidth: 3,
    captionFont: "Inter, sans-serif",
    captionSize: 20,
    captionColor: "#00ffff",
  },
  decorative: {
    borders: { top: 50, right: 50, bottom: 50, left: 50 },
    bgColor: "#2a2a2a",
    cornerRadius: 2,
    shadow: { enabled: true, color: "#000000", blur: 40, x: 10, y: 15, opacity: 60 },
    rotation: 0,
    captionFont: "Georgia, serif",
    captionSize: 24,
    captionColor: "#d4af37",
  },
};

// ─── State ───────────────────────────────────────────────────────────────

let pfCache = {
  blobUrl: null,
  imageElement: null,
  previewCanvas: null,
  isProcessing: false,
};

let currentFrameType = "polaroid";
let previewDebounceTimer = null;

// ─── Helpers ─────────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  const rad = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hexToRgba(hex, alpha) {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

function toOpacityPercent(value) {
  // Support defaults expressed as either 0..1 or 0..100.
  return value <= 1 ? Math.round(value * 100) : Math.round(value);
}

// ─── Read Settings from DOM ──────────────────────────────────────────────

function getSettings() {
  const uniform = dom.pfUniformBorder?.checked !== false;
  let borders;
  if (uniform) {
    const v = Number(dom.pfBorderSize?.value || 30);
    borders = { top: v, right: v, bottom: v, left: v };
  } else {
    borders = {
      top: Number(dom.pfBorderTop?.value || 30),
      right: Number(dom.pfBorderRight?.value || 30),
      bottom: Number(dom.pfBorderBottom?.value || 100),
      left: Number(dom.pfBorderLeft?.value || 30),
    };
  }

  const neonColor = dom.pfNeonSwatchActive?.dataset?.color || "#00ffff";

  return {
    frameType: currentFrameType,
    borders,
    bgColor: dom.pfBgColor?.value || "#ffffff",
    transparentBg: dom.pfTransparentBg?.checked || false,
    cornerRadius: Number(dom.pfCornerRadius?.value || 12),
    shadow: {
      enabled: dom.pfShadowEnabled?.checked !== false,
      color: dom.pfShadowColor?.value || "#000000",
      blur: Number(dom.pfShadowBlur?.value || 20),
      x: Number(dom.pfShadowX?.value || 5),
      y: Number(dom.pfShadowY?.value || 8),
      opacity: Number(dom.pfShadowOpacity?.value || 35) / 100,
    },
    rotation: Number(dom.pfRotation?.value || 0),
    captionText: dom.pfCaptionText?.value || "",
    captionDate: dom.pfCaptionDate?.checked || false,
    captionDateText: dom.pfCaptionDateText?.value || "",
    captionFont: dom.pfCaptionFont?.value || '"Brush Script MT", cursive',
    captionSize: Number(dom.pfCaptionSize?.value || 22),
    captionColor: dom.pfCaptionColor?.value || "#333333",
    captionAlign: dom.pfCaptionAlign?.value || "center",
    captionBold: dom.pfCaptionBold?.checked || false,
    captionItalic: dom.pfCaptionItalic?.checked || false,
    captionY: Number(dom.pfCaptionY?.value || 50),
    neonColor,
    neonGlow: Number(dom.pfNeonGlow?.value || 3),
    neonWidth: Number(dom.pfNeonWidth?.value || 3),
  };
}

// ─── Frame Drawing Functions ─────────────────────────────────────────────

function drawSprocketHoles(ctx, x, width, imageH, borderT) {
  const holeW = 12;
  const holeH = 18;
  const spacing = 28;
  const count = Math.floor(imageH / spacing) + 2;
  const startX = x + (width - holeW) / 2;
  const startY = borderT - 4;

  for (let i = 0; i < count; i++) {
    const hy = startY + i * spacing;
    if (hy < borderT - 4) continue;
    if (hy + holeH > borderT + imageH + 4) break;
    
    // Punch out the hole (transparent if scene is transparent)
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    roundRect(ctx, startX, hy, holeW, holeH, 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    // Inner shadow and rim light to make hole look real
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, startX, hy, holeW, holeH, 2);
    ctx.clip();
    
    // Top-left dark shadow (inner)
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(startX - 1, hy - 1, holeW + 2, holeH + 2);
    
    // Bottom-right rim light
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.strokeRect(startX + 1, hy + 1, holeW - 1, holeH - 1);
    ctx.restore();
  }
}

function drawVignette(ctx, x, y, w, h) {
  const grd = ctx.createRadialGradient(
    x + w / 2, y + h / 2, Math.min(w, h) * 0.4,
    x + w / 2, y + h / 2, Math.max(w, h) * 0.8
  );
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(0.5, "rgba(20,10,0,0.1)");
  grd.addColorStop(1, "rgba(30,15,0,0.5)");
  ctx.fillStyle = grd;
  ctx.fillRect(x, y, w, h);
}

function drawJaggedBorder(ctx, x, y, w, h, bgColor) {
  const rng = seededRandom(42);
  const jitter = 3;
  ctx.fillStyle = bgColor;

  // Top edge
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let px = x; px <= x + w; px += 4) {
    ctx.lineTo(px, y + (rng() - 0.5) * jitter);
  }
  ctx.lineTo(x + w, y + 20);
  ctx.lineTo(x, y + 20);
  ctx.closePath();
  ctx.fill();

  // Bottom edge
  ctx.beginPath();
  ctx.moveTo(x, y + h - 20);
  ctx.lineTo(x + w, y + h - 20);
  for (let px = x + w; px >= x; px -= 4) {
    ctx.lineTo(px, y + h + (rng() - 0.5) * jitter);
  }
  ctx.closePath();
  ctx.fill();

  // Left edge
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let py = y; py <= y + h; py += 4) {
    ctx.lineTo(x + (rng() - 0.5) * jitter, py);
  }
  ctx.lineTo(x + 20, y + h);
  ctx.lineTo(x + 20, y);
  ctx.closePath();
  ctx.fill();

  // Right edge
  ctx.beginPath();
  ctx.moveTo(x + w - 20, y);
  ctx.lineTo(x + w - 20, y + h);
  for (let py = y + h; py >= y; py -= 4) {
    ctx.lineTo(x + w + (rng() - 0.5) * jitter, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawNeonBorder(ctx, x, y, w, h, color, glowLayers, lineWidth) {
  // Draw glow layers
  for (let i = glowLayers; i >= 1; i--) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth + (i * 2);
    ctx.shadowColor = color;
    ctx.shadowBlur = 15 * i;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  
  // Draw hot white inner tube for realism
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = lineWidth * 0.4;
  ctx.strokeRect(x, y, w, h);
}

function drawDecorativeBorder(ctx, x, y, w, h, borderWidth, bgColor) {
  const outer = borderWidth;
  const inner = Math.max(4, borderWidth * 0.3);
  const mid = borderWidth * 0.5;

  // Outer band with metallic gradient
  const goldGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  goldGrad.addColorStop(0, "#d4af37");
  goldGrad.addColorStop(0.3, "#fff2cd");
  goldGrad.addColorStop(0.7, "#aa7c11");
  goldGrad.addColorStop(1, "#f8e08e");
  
  ctx.fillStyle = goldGrad;
  ctx.fillRect(x, y, w, outer);
  ctx.fillRect(x, y + h - outer, w, outer);
  ctx.fillRect(x, y, outer, h);
  ctx.fillRect(x + w - outer, y, outer, h);

  // Inner accent line
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + inner, y + inner, w - inner * 2, h - inner * 2);
  
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + inner + 1, y + inner + 1, w - inner * 2 - 2, h - inner * 2 - 2);

  // Corner diamonds
  const cs = 8;
  const corners = [
    [x + outer / 2, y + outer / 2],
    [x + w - outer / 2, y + outer / 2],
    [x + outer / 2, y + h - outer / 2],
    [x + w - outer / 2, y + h - outer / 2],
  ];
  ctx.fillStyle = "#fff";
  corners.forEach(([cx, cy]) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - cs);
    ctx.lineTo(cx + cs, cy);
    ctx.lineTo(cx, cy + cs);
    ctx.lineTo(cx - cs, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  // Dot pattern along mid line
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  const dotSpacing = 16;
  for (let dx = x + mid + dotSpacing; dx < x + w - mid; dx += dotSpacing) {
    ctx.beginPath();
    ctx.arc(dx, y + mid, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dx, y + h - mid, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let dy = y + mid + dotSpacing; dy < y + h - mid; dy += dotSpacing) {
    ctx.beginPath();
    ctx.arc(x + mid, dy, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w - mid, dy, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPassportOval(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h * 0.4, w * 0.3, h * 0.38, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawInstaxSticker(ctx, x, y, w, h) {
  const stickerX = x + w - 35;
  const stickerY = y + h - 28;
  ctx.save();
  ctx.fillStyle = "#ff6b8a";
  ctx.beginPath();
  ctx.arc(stickerX, stickerY, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 9px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("♥", stickerX, stickerY);
  ctx.restore();
}

function drawFilmGrain(ctx, x, y, w, h, opacity = 0.04) {
  const rng = seededRandom(123);
  ctx.save();
  ctx.globalAlpha = opacity;
  for (let i = 0; i < w * h * 0.01; i++) {
    const px = x + rng() * w;
    const py = y + rng() * h;
    const v = Math.floor(rng() * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(px, py, 1, 1);
  }
  ctx.restore();
}

function drawPaperTexture(ctx, w, h, opacity = 0.03) {
  const rng = seededRandom(456);
  ctx.save();
  ctx.globalAlpha = opacity;
  // Draw subtle fine noise
  for (let i = 0; i < w * h * 0.03; i++) {
    const px = rng() * w;
    const py = rng() * h;
    const v = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(px, py, 1, 1);
  }
  ctx.restore();
}

function drawInnerBevel(ctx, x, y, w, h) {
  ctx.save();
  // Top inner shadow
  const gradTop = ctx.createLinearGradient(0, y, 0, y + 6);
  gradTop.addColorStop(0, "rgba(0,0,0,0.35)");
  gradTop.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradTop;
  ctx.fillRect(x, y, w, 6);

  // Left inner shadow
  const gradLeft = ctx.createLinearGradient(x, 0, x + 6, 0);
  gradLeft.addColorStop(0, "rgba(0,0,0,0.35)");
  gradLeft.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradLeft;
  ctx.fillRect(x, y, 6, h);

  // Bottom rim light
  const gradBottom = ctx.createLinearGradient(0, y + h - 4, 0, y + h);
  gradBottom.addColorStop(0, "rgba(255,255,255,0)");
  gradBottom.addColorStop(1, "rgba(255,255,255,0.4)");
  ctx.fillStyle = gradBottom;
  ctx.fillRect(x, y + h - 4, w, 4);

  // Right rim light
  const gradRight = ctx.createLinearGradient(x + w - 4, 0, x + w, 0);
  gradRight.addColorStop(0, "rgba(255,255,255,0)");
  gradRight.addColorStop(1, "rgba(255,255,255,0.4)");
  ctx.fillStyle = gradRight;
  ctx.fillRect(x + w - 4, y, 4, h);
  
  // Outer frame edge outline to crisp it up
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

// ─── Caption Rendering ───────────────────────────────────────────────────

function renderCaption(ctx, text, x, y, availableWidth, style) {
  if (!text) return;
  const fontStyle = `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${style.fontSize}px ${style.fontFamily}`;
  ctx.font = fontStyle;
  ctx.fillStyle = style.color;
  ctx.textAlign = style.align;
  ctx.textBaseline = "middle";

  // Auto-fit text
  let fontSize = style.fontSize;
  let testFont = `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${fontSize}px ${style.fontFamily}`;
  ctx.font = testFont;
  while (ctx.measureText(text).width > availableWidth - 16 && fontSize > 8) {
    fontSize -= 1;
    testFont = `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${fontSize}px ${style.fontFamily}`;
    ctx.font = testFont;
  }

  let drawX = x;
  if (style.align === "center") drawX = x + availableWidth / 2;
  else if (style.align === "right") drawX = x + availableWidth - 8;
  else drawX = x + 8;

  ctx.fillText(text, drawX, y);
}

function renderDateCaption(ctx, dateText, x, y, availableWidth, style) {
  if (!dateText) return;
  const smallSize = Math.max(8, style.fontSize - 6);
  const fontStyle = `${style.italic ? "italic " : ""}${smallSize}px ${style.fontFamily}`;
  ctx.font = fontStyle;
  ctx.fillStyle = hexToRgba(style.color, 0.7);
  ctx.textAlign = style.align;
  ctx.textBaseline = "middle";

  let drawX = x;
  if (style.align === "center") drawX = x + availableWidth / 2;
  else if (style.align === "right") drawX = x + availableWidth - 8;
  else drawX = x + 8;

  ctx.fillText(dateText, drawX, y);
}

// ─── Blurred Scene Background ────────────────────────────────────────────

function drawBlurredBg(ctx, image, canvasW, canvasH, isExport) {
  const maxW = isExport ? canvasW : 800;
  const scale = maxW / canvasW;
  const sw = Math.floor(canvasW * scale);
  const sh = Math.floor(canvasH * scale);

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = sw;
  tmpCanvas.height = sh;
  const tmpCtx = tmpCanvas.getContext("2d");
  tmpCtx.drawImage(image, 0, 0, sw, sh);

  // 3-pass box blur
  for (let pass = 0; pass < 3; pass++) {
    tmpCtx.filter = `blur(${8 * scale}px)`;
    tmpCtx.drawImage(tmpCanvas, 0, 0);
  }

  ctx.drawImage(tmpCanvas, 0, 0, canvasW, canvasH);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(0, 0, canvasW, canvasH);
}

// ─── Apply (Commit) ─────────────────────────────────────────────────────

export async function applyPhotoFrame(commitBlobCallback) {
  if (!state.current || !pfCache.imageElement) return;

  await withOperation("Photo Frame", async () => {
    setStatus(FRIENDLY_STATUS.applyingEffect, 40);

    const settings = getSettings();
    const exportCanvas = document.createElement("canvas");
    renderFrame(exportCanvas, pfCache.imageElement, settings, true);

    setStatus(FRIENDLY_STATUS.savingChanges, 80);

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(exportCanvas, mime, quality);

    await commitBlobCallback(blob, "Photo Frame", state.current.name);
    clearPhotoFrameCache();
  }, syncUndoButtons);
}

// ─── Presets ─────────────────────────────────────────────────────────────

const PRESETS = {
  "classic-polaroid": {
    frame: "polaroid",
    borders: { top: 40, right: 40, bottom: 160, left: 40 },
    bgColor: "#f9f8f6",
    cornerRadius: 3,
    shadowEnabled: true,
    shadowBlur: 30,
    shadowX: 5,
    shadowY: 15,
    shadowOpacity: 35,
    rotation: -2,
    captionText: "Summer 2026",
    captionDate: false,
    captionFont: '"Brush Script MT", cursive',
    captionSize: 28,
    captionColor: "#333333",
    captionAlign: "center",
    captionBold: false,
    captionItalic: false,
    captionY: 60,
    transparentBg: false,
  },
  "night-neon": {
    frame: "neon",
    borders: { top: 40, right: 40, bottom: 40, left: 40 },
    bgColor: "#080808",
    cornerRadius: 6,
    shadowEnabled: true,
    shadowBlur: 40,
    shadowX: 0,
    shadowY: 0,
    shadowOpacity: 80,
    neonColor: "#ff00ff",
    neonGlow: 4,
    neonWidth: 4,
    rotation: 0,
    captionText: "",
    captionDate: false,
    transparentBg: false,
  },
  "vintage-memory": {
    frame: "vintage",
    borders: { top: 35, right: 35, bottom: 60, left: 35 },
    bgColor: "#e8ddcc",
    cornerRadius: 1,
    shadowEnabled: true,
    shadowBlur: 20,
    shadowX: 5,
    shadowY: 8,
    shadowOpacity: 25,
    rotation: 1.5,
    captionText: "",
    captionDate: true,
    captionFont: "Georgia, serif",
    captionSize: 18,
    captionColor: "#574330",
    captionAlign: "center",
    captionBold: false,
    captionItalic: true,
    captionY: 50,
    transparentBg: false,
  },
  "film-reel": {
    frame: "filmstrip",
    borders: { top: 20, right: 80, bottom: 20, left: 80 },
    bgColor: "#111111",
    cornerRadius: 0,
    shadowEnabled: true,
    shadowBlur: 30,
    shadowX: 0,
    shadowY: 10,
    shadowOpacity: 60,
    rotation: 0,
    captionText: "",
    captionDate: false,
    transparentBg: true,
  },
  "clean-passport": {
    frame: "passport",
    borders: { top: 20, right: 20, bottom: 20, left: 20 },
    bgColor: "#fefefe",
    cornerRadius: 0,
    shadowEnabled: true,
    shadowBlur: 10,
    shadowX: 0,
    shadowY: 4,
    shadowOpacity: 20,
    rotation: 0,
    captionText: "",
    captionDate: false,
    transparentBg: false,
  },
};

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;

  // Set frame type
  selectFrameType(preset.frame);

  // Set borders
  if (dom.pfUniformBorder) dom.pfUniformBorder.checked = true;
  toggleBorderMode(true);
  const b = preset.borders;
  const uniformVal = (b.top === b.right && b.right === b.bottom && b.bottom === b.left) ? b.top : b.top;
  if (dom.pfBorderSize) dom.pfBorderSize.value = uniformVal;
  if (dom.pfBorderSizeVal) dom.pfBorderSizeVal.textContent = uniformVal + "px";
  if (dom.pfBorderTop) dom.pfBorderTop.value = b.top;
  if (dom.pfBorderRight) dom.pfBorderRight.value = b.right;
  if (dom.pfBorderBottom) dom.pfBorderBottom.value = b.bottom;
  if (dom.pfBorderLeft) dom.pfBorderLeft.value = b.left;

  // Style
  if (dom.pfBgColor) dom.pfBgColor.value = preset.bgColor;
  if (dom.pfTransparentBg) dom.pfTransparentBg.checked = preset.transparentBg || false;
  if (dom.pfCornerRadius) dom.pfCornerRadius.value = preset.cornerRadius;
  if (dom.pfCornerRadiusVal) dom.pfCornerRadiusVal.textContent = preset.cornerRadius + "px";

  // Shadow
  if (dom.pfShadowEnabled) dom.pfShadowEnabled.checked = preset.shadowEnabled;
  if (dom.pfShadowBlur) dom.pfShadowBlur.value = preset.shadowBlur || 0;
  if (dom.pfShadowX) dom.pfShadowX.value = preset.shadowX || 0;
  if (dom.pfShadowY) dom.pfShadowY.value = preset.shadowY || 0;
  if (dom.pfShadowOpacity) dom.pfShadowOpacity.value = preset.shadowOpacity || 0;
  if (dom.pfShadowBlurVal) dom.pfShadowBlurVal.textContent = (preset.shadowBlur || 0) + "px";
  if (dom.pfShadowXVal) dom.pfShadowXVal.textContent = (preset.shadowX || 0) + "px";
  if (dom.pfShadowYVal) dom.pfShadowYVal.textContent = (preset.shadowY || 0) + "px";
  if (dom.pfShadowOpacityVal) dom.pfShadowOpacityVal.textContent = (preset.shadowOpacity || 0) + "%";
  toggleShadowControls(preset.shadowEnabled);

  // Rotation
  if (dom.pfRotation) dom.pfRotation.value = preset.rotation;
  if (dom.pfRotationVal) dom.pfRotationVal.textContent = preset.rotation + "°";

  // Caption
  if (dom.pfCaptionText) dom.pfCaptionText.value = preset.captionText || "";
  if (dom.pfCaptionDate) dom.pfCaptionDate.checked = preset.captionDate || false;
  if (dom.pfCaptionFont) dom.pfCaptionFont.value = preset.captionFont || '"Brush Script MT", cursive';
  if (dom.pfCaptionSize) dom.pfCaptionSize.value = preset.captionSize || 22;
  if (dom.pfCaptionColor) dom.pfCaptionColor.value = preset.captionColor || "#333333";
  if (dom.pfCaptionAlign) dom.pfCaptionAlign.value = preset.captionAlign || "center";
  if (dom.pfCaptionBold) dom.pfCaptionBold.checked = preset.captionBold || false;
  if (dom.pfCaptionItalic) dom.pfCaptionItalic.checked = preset.captionItalic || false;
  if (dom.pfCaptionY) dom.pfCaptionY.value = preset.captionY || 50;
  if (dom.pfCaptionSizeVal) dom.pfCaptionSizeVal.textContent = (preset.captionSize || 22) + "px";
  if (dom.pfCaptionYVal) dom.pfCaptionYVal.textContent = (preset.captionY || 50) + "%";
  toggleDateCustom(preset.captionDate);

  // Neon
  if (preset.frame === "neon" && preset.neonColor) {
    setActiveNeonSwatch(preset.neonColor);
    if (dom.pfNeonGlow) dom.pfNeonGlow.value = preset.neonGlow || 3;
    if (dom.pfNeonWidth) dom.pfNeonWidth.value = preset.neonWidth || 3;
    if (dom.pfNeonGlowVal) dom.pfNeonGlowVal.textContent = preset.neonGlow || 3;
    if (dom.pfNeonWidthVal) dom.pfNeonWidthVal.textContent = (preset.neonWidth || 3) + "px";
  }

  updatePreview();
}

// ─── UI Helpers ──────────────────────────────────────────────────────────

function selectFrameType(type) {
  currentFrameType = type;
  document.querySelectorAll(".pf-frame-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.frame === type);
  });

  const defaults = FRAME_DEFAULTS[type];
  if (defaults) {
    dom.pfNeonSection && (dom.pfNeonSection.style.display = type === "neon" ? "" : "none");
    // Update shadow toggle text
    if (dom.pfShadowEnabled && !dom.pfShadowEnabled._userSet) {
      dom.pfShadowEnabled.checked = defaults.shadow.enabled;
      toggleShadowControls(defaults.shadow.enabled);
    }
  }
}

function toggleBorderMode(uniform) {
  if (dom.pfUniformControls) dom.pfUniformControls.style.display = uniform ? "" : "none";
  if (dom.pfCustomControls) dom.pfCustomControls.style.display = uniform ? "none" : "";
}

function toggleShadowControls(enabled) {
  if (dom.pfShadowControls) dom.pfShadowControls.style.display = enabled ? "" : "none";
}

function toggleDateCustom(show) {
  if (dom.pfDateCustomWrap) dom.pfDateCustomWrap.style.display = show ? "" : "none";
}

function setActiveNeonSwatch(color) {
  document.querySelectorAll(".pf-neon-swatch").forEach((sw) => {
    const isActive = sw.dataset.color === color;
    sw.classList.toggle("is-active", isActive);
    if (isActive) {
      dom.pfNeonSwatchActive = sw;
    }
  });
}

// ─── Cache Management ────────────────────────────────────────────────────

export function clearPhotoFrameCache() {
  pfCache.blobUrl = null;
  pfCache.imageElement = null;
  pfCache.previewCanvas = null;
  pfCache.isProcessing = false;
}

// ─── Event Listeners ─────────────────────────────────────────────────────

export function initPhotoFrameListeners(commitBlobCallback) {
  // Frame type cards
  document.querySelectorAll(".pf-frame-card").forEach((card) => {
    card.addEventListener("click", () => {
      const type = card.dataset.frame;
      const defaults = FRAME_DEFAULTS[type];
      selectFrameType(type);

      // Apply frame defaults
      if (defaults) {
        if (dom.pfBgColor) dom.pfBgColor.value = defaults.bgColor;
        if (dom.pfCornerRadius) dom.pfCornerRadius.value = defaults.cornerRadius;
        if (dom.pfCornerRadiusVal) dom.pfCornerRadiusVal.textContent = defaults.cornerRadius + "px";
        if (dom.pfCaptionFont) dom.pfCaptionFont.value = defaults.captionFont;
        if (dom.pfCaptionSize) dom.pfCaptionSize.value = defaults.captionSize;
        if (dom.pfCaptionSizeVal) dom.pfCaptionSizeVal.textContent = defaults.captionSize + "px";
        if (dom.pfCaptionColor) dom.pfCaptionColor.value = defaults.captionColor;

        const b = defaults.borders;
        if (dom.pfUniformBorder?.checked) {
          if (dom.pfBorderSize) dom.pfBorderSize.value = b.top;
          if (dom.pfBorderSizeVal) dom.pfBorderSizeVal.textContent = b.top + "px";
        } else {
          if (dom.pfBorderTop) dom.pfBorderTop.value = b.top;
          if (dom.pfBorderRight) dom.pfBorderRight.value = b.right;
          if (dom.pfBorderBottom) dom.pfBorderBottom.value = b.bottom;
          if (dom.pfBorderLeft) dom.pfBorderLeft.value = b.left;
          if (dom.pfBorderTopVal) dom.pfBorderTopVal.textContent = b.top + "px";
          if (dom.pfBorderRightVal) dom.pfBorderRightVal.textContent = b.right + "px";
          if (dom.pfBorderBottomVal) dom.pfBorderBottomVal.textContent = b.bottom + "px";
          if (dom.pfBorderLeftVal) dom.pfBorderLeftVal.textContent = b.left + "px";
        }

        if (dom.pfShadowEnabled) {
          dom.pfShadowEnabled.checked = defaults.shadow.enabled;
          dom.pfShadowEnabled._userSet = false;
          toggleShadowControls(defaults.shadow.enabled);
        }
        if (dom.pfShadowBlur) dom.pfShadowBlur.value = defaults.shadow.blur;
        if (dom.pfShadowX) dom.pfShadowX.value = defaults.shadow.x;
        if (dom.pfShadowY) dom.pfShadowY.value = defaults.shadow.y;
        const opacityPercent = toOpacityPercent(defaults.shadow.opacity);
        if (dom.pfShadowOpacity) dom.pfShadowOpacity.value = opacityPercent;
        if (dom.pfShadowBlurVal) dom.pfShadowBlurVal.textContent = defaults.shadow.blur + "px";
        if (dom.pfShadowXVal) dom.pfShadowXVal.textContent = defaults.shadow.x + "px";
        if (dom.pfShadowYVal) dom.pfShadowYVal.textContent = defaults.shadow.y + "px";
        if (dom.pfShadowOpacityVal) dom.pfShadowOpacityVal.textContent = opacityPercent + "%";

        if (dom.pfRotation) dom.pfRotation.value = defaults.rotation;
        if (dom.pfRotationVal) dom.pfRotationVal.textContent = defaults.rotation + "°";
      }

      debouncedPreview();
    });
  });

  // Uniform border toggle
  dom.pfUniformBorder?.addEventListener("change", () => {
    toggleBorderMode(dom.pfUniformBorder.checked);
    debouncedPreview();
  });

  // Border sliders
  const borderSlider = (input, output) => {
    if (!input) return;
    input.addEventListener("input", () => {
      if (output) output.textContent = input.value + "px";
      debouncedPreview();
    });
  };
  borderSlider(dom.pfBorderSize, dom.pfBorderSizeVal);
  borderSlider(dom.pfBorderTop, dom.pfBorderTopVal);
  borderSlider(dom.pfBorderRight, dom.pfBorderRightVal);
  borderSlider(dom.pfBorderBottom, dom.pfBorderBottomVal);
  borderSlider(dom.pfBorderLeft, dom.pfBorderLeftVal);

  // Style controls
  dom.pfBgColor?.addEventListener("input", debouncedPreview);
  dom.pfTransparentBg?.addEventListener("change", debouncedPreview);

  dom.pfCornerRadius?.addEventListener("input", () => {
    if (dom.pfCornerRadiusVal) dom.pfCornerRadiusVal.textContent = dom.pfCornerRadius.value + "px";
    debouncedPreview();
  });

  // Shadow controls
  dom.pfShadowEnabled?.addEventListener("change", () => {
    dom.pfShadowEnabled._userSet = true;
    toggleShadowControls(dom.pfShadowEnabled.checked);
    debouncedPreview();
  });

  const shadowSlider = (input, output, suffix) => {
    if (!input) return;
    input.addEventListener("input", () => {
      if (output) output.textContent = input.value + suffix;
      debouncedPreview();
    });
  };
  shadowSlider(dom.pfShadowBlur, dom.pfShadowBlurVal, "px");
  shadowSlider(dom.pfShadowX, dom.pfShadowXVal, "px");
  shadowSlider(dom.pfShadowY, dom.pfShadowYVal, "px");
  shadowSlider(dom.pfShadowOpacity, dom.pfShadowOpacityVal, "%");

  // Rotation
  dom.pfRotation?.addEventListener("input", () => {
    if (dom.pfRotationVal) dom.pfRotationVal.textContent = dom.pfRotation.value + "°";
    debouncedPreview();
  });

  // Caption controls
  dom.pfCaptionText?.addEventListener("input", debouncedPreview);
  dom.pfCaptionDate?.addEventListener("change", () => {
    toggleDateCustom(dom.pfCaptionDate.checked);
    debouncedPreview();
  });
  dom.pfCaptionDateText?.addEventListener("input", debouncedPreview);
  dom.pfCaptionFont?.addEventListener("change", debouncedPreview);
  dom.pfCaptionSize?.addEventListener("input", () => {
    if (dom.pfCaptionSizeVal) dom.pfCaptionSizeVal.textContent = dom.pfCaptionSize.value + "px";
    debouncedPreview();
  });
  dom.pfCaptionColor?.addEventListener("input", debouncedPreview);
  dom.pfCaptionAlign?.addEventListener("change", debouncedPreview);
  dom.pfCaptionBold?.addEventListener("change", debouncedPreview);
  dom.pfCaptionItalic?.addEventListener("change", debouncedPreview);
  dom.pfCaptionY?.addEventListener("input", () => {
    if (dom.pfCaptionYVal) dom.pfCaptionYVal.textContent = dom.pfCaptionY.value + "%";
    debouncedPreview();
  });

  // Neon swatches
  document.querySelectorAll(".pf-neon-swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      setActiveNeonSwatch(sw.dataset.color);
      debouncedPreview();
    });
  });
  // Initialize active swatch reference
  const activeSwatch = document.querySelector(".pf-neon-swatch.is-active");
  if (activeSwatch) dom.pfNeonSwatchActive = activeSwatch;

  dom.pfNeonGlow?.addEventListener("input", () => {
    if (dom.pfNeonGlowVal) dom.pfNeonGlowVal.textContent = dom.pfNeonGlow.value;
    debouncedPreview();
  });
  dom.pfNeonWidth?.addEventListener("input", () => {
    if (dom.pfNeonWidthVal) dom.pfNeonWidthVal.textContent = dom.pfNeonWidth.value + "px";
    debouncedPreview();
  });

  // Presets
  document.querySelectorAll(".pf-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyPreset(btn.dataset.preset);
    });
  });

  // Apply / Reset
  dom.pfApply?.addEventListener("click", () => applyPhotoFrame(commitBlobCallback));

  dom.pfReset?.addEventListener("click", () => {
    if (!pfCache.imageElement) return;
    selectFrameType("polaroid");
    applyPreset("classic-polaroid");
  });
}

// ─── Tool Lifecycle ──────────────────────────────────────────────────────

export async function activatePhotoFrameTool() {
  if (state.current && !pfCache.imageElement) {
    await initializePreview();
  } else if (pfCache.imageElement) {
    updatePreview();
  }
}

export function deactivatePhotoFrameTool() {
  clearTimeout(previewDebounceTimer);
}

export function renderFrame(targetCanvas, imageElement, settings, isExport) {
  if (!imageElement) return;

  const imgW = imageElement.naturalWidth || imageElement.width;
  const imgH = imageElement.naturalHeight || imageElement.height;
  const { borders, bgColor, transparentBg, cornerRadius, shadow, rotation,
    frameType, captionText, captionDate, captionDateText,
    captionFont, captionSize, captionColor, captionAlign,
    captionBold, captionItalic, captionY,
    neonColor, neonGlow, neonWidth } = settings;

  const padBottom = (captionText || captionDate) ? borders.bottom : borders.bottom;
  const newW = imgW + borders.left + borders.right;
  const newH = imgH + borders.top + padBottom;

  targetCanvas.width = newW;
  targetCanvas.height = newH;

  const ctx = targetCanvas.getContext("2d", { alpha: true });
  ctx.clearRect(0, 0, newW, newH);

  // Step 1: Scene background
  if (!transparentBg) {
    if (settings._sceneBg === "blurred" && imageElement) {
      drawBlurredBg(ctx, imageElement, newW, newH, isExport);
    } else {
      ctx.fillStyle = settings._sceneBgColor || bgColor;
      ctx.fillRect(0, 0, newW, newH);
    }
  }

  // Step 2: Drop shadow
  if (shadow.enabled) {
    ctx.save();
    ctx.shadowColor = hexToRgba(shadow.color, shadow.opacity);
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.x;
    ctx.shadowOffsetY = shadow.y;
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    roundRect(ctx, 0, 0, newW, newH, cornerRadius);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // Step 3: Fill frame background (if not transparent)
  if (!transparentBg && frameType !== "neon") {
    // Add subtle gradient for realism
    let primaryGrad = ctx.createLinearGradient(0, 0, newW, newH);
    if (frameType === "polaroid" || frameType === "instax" || frameType === "vintage") {
      primaryGrad.addColorStop(0, bgColor);
      // darken slightly at bottom right
      let endColor = hexToRgba(bgColor, 0.95);
      primaryGrad.addColorStop(1, "rgba(0,0,0,0.05)"); 
      ctx.fillStyle = primaryGrad;
    } else {
      ctx.fillStyle = bgColor;
    }

    if (cornerRadius > 0) {
      ctx.beginPath();
      roundRect(ctx, 0, 0, newW, newH, cornerRadius);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, newW, newH);
    }
    
    // Add base texture for realism
    if (frameType === "polaroid" || frameType === "instax" || frameType === "passport") {
      drawPaperTexture(ctx, newW, newH, 0.04);
    } else if (frameType === "vintage") {
      drawPaperTexture(ctx, newW, newH, 0.07);
    }
    
    // Fill background solid color again with a blend mode if needed? 
    // Actually letting the gradient and texture be visible is good.
    if (frameType === "polaroid" || frameType === "instax" || frameType === "vintage") {
       ctx.fillStyle = bgColor;
       ctx.globalAlpha = 0.6;
       if (cornerRadius > 0) {
         ctx.beginPath();
         roundRect(ctx, 0, 0, newW, newH, cornerRadius);
         ctx.fill();
       } else {
         ctx.fillRect(0, 0, newW, newH);
       }
       ctx.globalAlpha = 1.0;
    }
  }

  // Step 4: Frame-specific decorations
  if (frameType === "filmstrip") {
    drawSprocketHoles(ctx, 0, borders.left, imgH, borders.top);
    drawSprocketHoles(ctx, newW - borders.right, borders.right, imgH, borders.top);
    drawFilmGrain(ctx, 0, 0, newW, newH);
    // Subtle film edge text
    ctx.save();
    ctx.fillStyle = "rgba(230,160,50,0.4)";
    ctx.font = "14px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(borders.left / 2, newH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("KODAK PORTRA 400", 0, 0);
    ctx.restore();
  } else if (frameType === "vintage") {
    // Inner border line
    ctx.strokeStyle = "rgba(139,115,85, 0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(borders.left - 3, borders.top - 3, imgW + 6, imgH + 6);
    ctx.strokeStyle = "rgba(255,255,255, 0.4)";
    ctx.strokeRect(borders.left - 2, borders.top - 2, imgW + 4, imgH + 4);
  } else if (frameType === "passport") {
    // Thin outer border
    ctx.strokeStyle = "#dddddd";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, newW - 1, newH - 1);
    // Oval guide
    drawPassportOval(ctx, borders.left, borders.top, imgW, imgH);
  } else if (frameType === "magazine") {
    drawJaggedBorder(ctx, 0, 0, newW, newH, bgColor);
  } else if (frameType === "neon") {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, newW, newH);
    drawNeonBorder(ctx, borders.left / 2, borders.top / 2,
      newW - borders.left / 2 - borders.right / 2,
      newH - borders.top / 2 - borders.bottom / 2,
      neonColor, neonGlow, neonWidth);
  } else if (frameType === "decorative") {
    drawDecorativeBorder(ctx, 0, 0, newW, newH, Math.min(borders.left, borders.top, 40), bgColor);
  } else if (frameType === "instax") {
    drawInstaxSticker(ctx, 0, 0, newW, newH);
    // Bottom gradient to simulate instax cartridge bulge
    const gy = borders.top + imgH;
    const grd = ctx.createLinearGradient(0, gy, 0, newH);
    grd.addColorStop(0, "rgba(255,255,255,0.7)");
    grd.addColorStop(0.5, "rgba(220,220,220,0.1)");
    grd.addColorStop(1, "rgba(200,200,200,0.3)");
    ctx.fillStyle = grd;
    ctx.fillRect(borders.left, gy, imgW, newH - gy);
  }

  // Step 5: Draw image
  ctx.drawImage(imageElement, borders.left, borders.top, imgW, imgH);

  // Step 5.5: Add realistic inner shadows/bevels
  if (["polaroid", "instax", "vintage", "decorative", "passport", "magazine"].includes(frameType)) {
    drawInnerBevel(ctx, borders.left, borders.top, imgW, imgH);
  }
  
  // Step 5.6: Picture-area effects for specific frames
  if (frameType === "vintage" || frameType === "filmstrip") {
    // Subtle warm tone + localized grain
    ctx.fillStyle = "rgba(150, 100, 50, 0.08)";
    ctx.fillRect(borders.left, borders.top, imgW, imgH);
    drawFilmGrain(ctx, borders.left, borders.top, imgW, imgH, 0.03);
  }

  // Step 6: Vignette (vintage only)
  if (frameType === "vintage") {
    drawVignette(ctx, borders.left, borders.top, imgW, imgH);
  }

  // Step 7: Captions
  if (captionText || captionDate) {
    const capY = borders.top + imgH;
    const capH = padBottom;
    const capX = borders.left;
    const capW = imgW;

    const primaryText = captionText;
    const dateText = captionDate
      ? (captionDateText || new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }))
      : "";

    const yFrac = captionY / 100;
    const capBaseY = capY + capH * yFrac;

    if (primaryText) {
      renderCaption(ctx, primaryText, capX, capBaseY, capW, {
        fontFamily: captionFont,
        fontSize: captionSize,
        color: captionColor,
        align: captionAlign,
        bold: captionBold,
        italic: captionItalic,
      });
    }
    if (dateText) {
      const dateOffset = primaryText ? captionSize * 0.8 : 0;
      renderDateCaption(ctx, dateText, capX, capBaseY + dateOffset, capW, {
        fontFamily: captionFont,
        fontSize: captionSize,
        color: captionColor,
        align: captionAlign,
        bold: false,
        italic: true,
      });
    }
  }

  // Step 8: Corner radius clip
  if (cornerRadius > 0 && frameType !== "magazine") {
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    roundRect(ctx, 0, 0, newW, newH, cornerRadius);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  // Step 9: Rotation (on preview only, not export)
  if (!isExport && rotation !== 0) {
    const rotated = document.createElement("canvas");
    const pad = Math.ceil(Math.max(newW, newH) * 0.15);
    rotated.width = newW + pad * 2;
    rotated.height = newH + pad * 2;
    const rCtx = rotated.getContext("2d");
    rCtx.translate(rotated.width / 2, rotated.height / 2);
    rCtx.rotate((rotation * Math.PI) / 180);
    rCtx.drawImage(targetCanvas, -newW / 2, -newH / 2);

    targetCanvas.width = rotated.width;
    targetCanvas.height = rotated.height;
    const finalCtx = targetCanvas.getContext("2d");
    finalCtx.drawImage(rotated, 0, 0);
  }
}

// ─── Preview Update ──────────────────────────────────────────────────────

function updatePreview() {
  if (!pfCache.imageElement || !state.current) return;

  // Ensure the shared preview image is visible even if Cropper left hidden classes.
  dom.cropImage?.classList.remove("cropper-hidden", "cropper-hide");
  dom.cropImage?.removeAttribute("aria-hidden");

  const settings = getSettings();
  const previewCanvas = document.createElement("canvas");
  renderFrame(previewCanvas, pfCache.imageElement, settings, false);

  // Fit to viewport
  const canvasArea = dom.canvasArea;
  const cropSurface = dom.cropSurface;
  if (canvasArea && cropSurface) {
    const availW = Math.max(0, canvasArea.clientWidth - 48);
    const availH = Math.max(0, canvasArea.clientHeight - 48);
    if (availW > 0 && availH > 0 && previewCanvas.width > 0 && previewCanvas.height > 0) {
      const scale = Math.min(1, availW / previewCanvas.width, availH / previewCanvas.height);
      const sw = Math.max(1, Math.floor(previewCanvas.width * scale));
      const sh = Math.max(1, Math.floor(previewCanvas.height * scale));
      cropSurface.style.width = `${sw}px`;
      cropSurface.style.height = `${sh}px`;
    }
  }

  dom.cropImage.src = previewCanvas.toDataURL();
}

function debouncedPreview() {
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(updatePreview, DEBOUNCE_MS);
}

// ─── Initialize Preview ──────────────────────────────────────────────────

async function initializePreview() {
  if (!state.current || pfCache.isProcessing) return;
  if (pfCache.blobUrl === state.current.previewUrl && pfCache.imageElement) {
    updatePreview();
    return;
  }

  pfCache.isProcessing = true;
  try {
    setStatus(FRIENDLY_STATUS.preparingPreview, 10);
    pfCache.imageElement = await loadImageElementFromBlob(state.current.blob);
    pfCache.blobUrl = state.current.previewUrl;
    setStatus("Preview ready.", 100);
    updatePreview();
  } catch (err) {
    console.error("Photo frame preview init failed:", err);
    setStatus("Couldn't prepare preview.", 0);
  } finally {
    pfCache.isProcessing = false;
  }
}
