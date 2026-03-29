// Pattern Text Fill Effect Module
// Fills text glyphs with repeating geometric patterns (dots, stripes, grids, etc.)
// Uses layered canvas architecture: base + text preview + UI overlay

// ─── STATE ───────────────────────────────────────────────────────────
const pt = {
  baseCanvas: null,
  textCanvas: null,
  overlayCanvas: null,
  baseCtx: null,
  textCtx: null,
  overlayCtx: null,
  canvasW: 0,
  canvasH: 0,
  isActive: false,
  sourceImg: null,
  getOriginalImageData: null,
  pushToUndoStack: null,
  commitBlobCallback: null,
  loadedFonts: new Set(),
  rafId: null,
  dragging: null,
  dragStart: null,
  itemStart: null,
  cachedBounds: null,
  patternCache: new Map(),
  currentPatternTile: null,
  stampCanvas: null,
  stampCtx: null,
  stampDrawing: false,
  stampLastX: 0,
  stampLastY: 0,
};

// ─── PATTERN CACHE ───────────────────────────────────────────────────
function getCachedPattern(ctx, type, config) {
  const key = JSON.stringify({ type, ...config });
  if (pt.patternCache.has(key)) return pt.patternCache.get(key);
  const tile = generatePatternTile(type, config);
  if (!tile) return null;
  const pattern = ctx.createPattern(tile, 'repeat');
  pt.patternCache.set(key, pattern);
  return pattern;
}

function clearPatternCache() {
  pt.patternCache.clear();
}

function createTile(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ─── PATTERN GENERATORS (12) ─────────────────────────────────────────

// 1. Polka Dots
function generatePolkaDots(config) {
  const dotSize = config.dotSize || 12;
  const spacing = config.spacing || 8;
  const tileSize = dotSize + spacing;
  const tile = createTile(tileSize, tileSize);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.background || 'transparent';
  ctx.fillRect(0, 0, tileSize, tileSize);
  ctx.fillStyle = config.foreground || '#000';
  ctx.beginPath();
  ctx.arc(tileSize / 2, tileSize / 2, dotSize / 2, 0, Math.PI * 2);
  ctx.fill();
  if (config.offset) {
    ctx.beginPath();
    ctx.arc(0, 0, dotSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tileSize, 0, dotSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, tileSize, dotSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tileSize, tileSize, dotSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  return tile;
}

// 2. Diagonal Stripes
function generateDiagonalStripes(config) {
  const sw = config.stripeWidth || 8;
  const angle = config.angle || 45;
  const rad = angle * Math.PI / 180;
  const tw = Math.max(4, Math.round(sw / Math.abs(Math.sin(rad)) || sw));
  const th = Math.max(4, Math.round(sw / Math.abs(Math.cos(rad)) || sw));
  const tile = createTile(tw * 2, th * 2);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.background || 'transparent';
  ctx.fillRect(0, 0, tile.width, tile.height);
  ctx.fillStyle = config.foreground || '#000';
  ctx.save();
  ctx.translate(tile.width / 2, tile.height / 2);
  ctx.rotate(rad);
  ctx.translate(-tile.width / 2, -tile.height / 2);
  ctx.fillRect(-tile.width, -sw / 2, tile.width * 3, sw);
  ctx.fillRect(-tile.width, tile.height / 2 - sw / 2, tile.width * 3, sw);
  ctx.fillRect(-tile.width, tile.height - sw / 2, tile.width * 3, sw);
  ctx.restore();
  return tile;
}

// 3. Checkerboard
function generateCheckerboard(config) {
  const cellSize = config.cellSize || 16;
  const tile = createTile(cellSize * 2, cellSize * 2);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.color1 || '#000';
  ctx.fillRect(0, 0, tile.width, tile.height);
  ctx.fillStyle = config.color2 || '#fff';
  ctx.fillRect(0, 0, cellSize, cellSize);
  ctx.fillRect(cellSize, cellSize, cellSize, cellSize);
  if (config.diamond) {
    const t2 = createTile(cellSize * 2, cellSize * 2);
    const c2 = t2.getContext('2d');
    c2.translate(cellSize, cellSize);
    c2.rotate(Math.PI / 4);
    c2.translate(-cellSize, -cellSize);
    c2.drawImage(tile, 0, 0);
    return t2;
  }
  return tile;
}

// 4. Crosshatch
function generateCrosshatch(config) {
  const spacing = config.spacing || 16;
  const lw = config.lineWidth || 1;
  const angle = config.angle || 0;
  const tile = createTile(spacing, spacing);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.background || 'transparent';
  ctx.fillRect(0, 0, spacing, spacing);
  ctx.strokeStyle = config.color || '#000';
  ctx.lineWidth = lw;
  ctx.save();
  ctx.translate(spacing / 2, spacing / 2);
  ctx.rotate(angle * Math.PI / 180);
  ctx.translate(-spacing / 2, -spacing / 2);
  ctx.beginPath();
  ctx.moveTo(0, spacing / 2);
  ctx.lineTo(spacing, spacing / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(spacing / 2, 0);
  ctx.lineTo(spacing / 2, spacing);
  ctx.stroke();
  ctx.restore();
  return tile;
}

// 5. Diagonal Crosshatch
function generateDiagCrosshatch(config) {
  const spacing = config.spacing || 16;
  const lw = config.lineWidth || 1;
  const tile = createTile(spacing, spacing);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.background || 'transparent';
  ctx.fillRect(0, 0, spacing, spacing);
  ctx.strokeStyle = config.color || '#000';
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(spacing, spacing);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(spacing, 0);
  ctx.lineTo(0, spacing);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-spacing, 0);
  ctx.lineTo(0, spacing);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(spacing, spacing);
  ctx.lineTo(spacing * 2, 0);
  ctx.stroke();
  return tile;
}

// 6. Honeycomb
function generateHoneycomb(config) {
  const r = config.hexRadius || 14;
  const gap = config.gap || 2;
  const hexH = r * Math.sqrt(3);
  const tileW = r * 3;
  const tileH = hexH;
  const tile = createTile(tileW, tileH);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.background || 'transparent';
  ctx.fillRect(0, 0, tileW, tileH);
  ctx.fillStyle = config.foreground || '#000';
  const drawHex = (cx, cy, radius) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * 60) * Math.PI / 180;
      const x = cx + radius * Math.cos(a);
      const y = cy + radius * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  const hr = r - gap;
  drawHex(r, hexH / 2, hr);
  ctx.fill();
  drawHex(r * 2.5, 0, hr);
  ctx.fill();
  drawHex(r * 2.5, hexH, hr);
  ctx.fill();
  drawHex(-r * 0.5, 0, hr);
  ctx.fill();
  drawHex(-r * 0.5, hexH, hr);
  ctx.fill();
  return tile;
}

// 7. Zigzag / Chevron
function generateZigzag(config) {
  const zw = config.zigWidth || 24;
  const zh = config.zigHeight || 12;
  const lw = config.zigLineWidth || 2;
  const tile = createTile(zw * 2, zh * 2);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.background || 'transparent';
  ctx.fillRect(0, 0, tile.width, tile.height);
  ctx.strokeStyle = config.foreground || '#000';
  ctx.lineWidth = lw;
  ctx.lineJoin = 'miter';
  if (config.zigFilled) {
    ctx.fillStyle = config.foreground || '#000';
    // Top row filled triangles
    ctx.beginPath();
    ctx.moveTo(0, zh);
    ctx.lineTo(zw / 2, 0);
    ctx.lineTo(zw, zh);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(zw, zh);
    ctx.lineTo(zw * 1.5, 0);
    ctx.lineTo(zw * 2, zh);
    ctx.closePath();
    ctx.fill();
    // Bottom row filled triangles (mirrored)
    ctx.beginPath();
    ctx.moveTo(0, zh);
    ctx.lineTo(zw / 2, tile.height);
    ctx.lineTo(zw, zh);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(zw, zh);
    ctx.lineTo(zw * 1.5, tile.height);
    ctx.lineTo(zw * 2, zh);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, zh);
    ctx.lineTo(zw / 2, 0);
    ctx.lineTo(zw, zh);
    ctx.lineTo(zw * 1.5, 0);
    ctx.lineTo(zw * 2, zh);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, zh);
    ctx.lineTo(zw / 2, tile.height);
    ctx.lineTo(zw, zh);
    ctx.lineTo(zw * 1.5, tile.height);
    ctx.lineTo(zw * 2, zh);
    ctx.stroke();
  }
  return tile;
}

// 8. Concentric Circles
function generateCircles(config) {
  const spacing = config.circleSpacing || 30;
  const lw = config.circleLineWidth || 2;
  const tile = createTile(spacing * 2, spacing * 2);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.background || 'transparent';
  ctx.fillRect(0, 0, tile.width, tile.height);
  ctx.strokeStyle = config.foreground || '#000';
  ctx.lineWidth = lw;
  const rings = 4;
  for (let i = 1; i <= rings; i++) {
    const r = (spacing / rings) * i;
    // Center rings
    ctx.beginPath();
    ctx.arc(tile.width / 2, tile.height / 2, r, 0, Math.PI * 2);
    ctx.stroke();
    // Corner quarter-rings for tiling
    [0, tile.width].forEach(cx => {
      [0, tile.height].forEach(cy => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      });
    });
  }
  return tile;
}

// 9. Halftone Dots (variable size)
function generateHalftone(config) {
  const cellSize = config.htCellSize || 8;
  const minR = config.htMinRadius || 1;
  const maxR = config.htMaxRadius || 4;
  const freq = config.htFrequency || 1.5;
  const cols = 8;
  const rows = 8;
  const tile = createTile(cellSize * cols, cellSize * rows);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.background || 'transparent';
  ctx.fillRect(0, 0, tile.width, tile.height);
  ctx.fillStyle = config.foreground || '#000';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const phase = (col / cols + row / rows) * Math.PI;
      const t = (Math.sin(phase * freq) + 1) / 2;
      const r = minR + t * (maxR - minR);
      ctx.beginPath();
      ctx.arc(col * cellSize + cellSize / 2, row * cellSize + cellSize / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return tile;
}

// 10. Brick / Weave
function generateBrick(config) {
  const bw = config.brickW || 40;
  const bh = config.brickH || 20;
  const gap = config.brickGap || 2;
  const tile = createTile(bw * 2, bh * 2);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.mortarColor || '#f5f0e1';
  ctx.fillRect(0, 0, tile.width, tile.height);
  ctx.fillStyle = config.brickColor || '#b5651d';
  if (config.weaveMode) {
    // Weave pattern: alternating over/under strips
    for (let i = 0; i < 4; i++) {
      if (i % 2 === 0) {
        ctx.fillRect(0, i * bh + gap, tile.width, bh - gap * 2);
      } else {
        ctx.fillRect(i % 4 < 2 ? 0 : bw, i * bh + gap, bw - gap * 2, bh - gap * 2);
        ctx.fillRect(i % 4 >= 2 ? 0 : bw + bw / 2, i * bh + gap, bw - gap * 2, bh - gap * 2);
      }
    }
  } else {
    // Standard brick
    ctx.fillRect(gap, gap, bw - gap * 2, bh - gap * 2);
    ctx.fillRect(bw + gap, gap, bw - gap * 2, bh - gap * 2);
    ctx.fillRect(bw / 2 + gap, bh + gap, bw - gap * 2, bh - gap * 2);
    ctx.fillRect(bw + bw / 2 + gap, bh + gap, bw - gap * 2, bh - gap * 2);
  }
  return tile;
}

// 11. Stars
function generateStars(config) {
  const outerR = config.starOuter || 10;
  const innerR = config.starInner || 4;
  const spacing = config.starSpacing || 6;
  const points = config.starPoints || 5;
  const tileSize = outerR * 2 + spacing;
  const tile = createTile(tileSize, tileSize);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = config.background || 'transparent';
  ctx.fillRect(0, 0, tileSize, tileSize);
  ctx.fillStyle = config.foreground || '#000';
  const cx = tileSize / 2;
  const cy = tileSize / 2;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i * Math.PI / points) - Math.PI / 2;
    i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
            : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
  return tile;
}

// 12. Custom Stamp
function generateStamp(config) {
  if (!pt.stampCanvas) return null;
  if (config.stampScale && config.stampScale !== 1) {
    const s = config.stampScale;
    const w = Math.round(64 * s);
    const h = Math.round(64 * s);
    const tile = createTile(w, h);
    const ctx = tile.getContext('2d');
    ctx.drawImage(pt.stampCanvas, 0, 0, w, h);
    return tile;
  }
  return pt.stampCanvas;
}

// ─── DISPATCH ─────────────────────────────────────────────────────────
function generatePatternTile(type, config) {
  switch (type) {
    case 'polka': return generatePolkaDots(config);
    case 'stripes': return generateDiagonalStripes(config);
    case 'checker': return generateCheckerboard(config);
    case 'crosshatch': return generateCrosshatch(config);
    case 'diagcross': return generateDiagCrosshatch(config);
    case 'honeycomb': return generateHoneycomb(config);
    case 'zigzag': return generateZigzag(config);
    case 'circles': return generateCircles(config);
    case 'halftone': return generateHalftone(config);
    case 'brick': return generateBrick(config);
    case 'stars': return generateStars(config);
    case 'stamp': return generateStamp(config);
    default: return null;
  }
}

// ─── DEFAULT STYLE ───────────────────────────────────────────────────
function defaultStyle() {
  return {
    text: 'Pattern\nText',
    fontFamily: 'Inter',
    fontSize: 120,
    fontBold: true,
    fontItalic: false,
    textAlign: 'center',
    x: 0,
    y: 0,
    rotation: 0,
    maxWidth: 0,
    lineHeight: 1.2,
    letterSpacing: 4,
    // Pattern
    patternType: 'polka',
    patternScale: 1.0,
    patternRotation: 0,
    patternOffsetX: 0,
    patternOffsetY: 0,
    foreground: '#000000',
    background: 'transparent',
    // Pattern-specific
    dotSize: 12,
    dotSpacing: 8,
    dotOffset: false,
    stripeWidth: 8,
    stripeAngle: 45,
    cellSize: 16,
    checkerColor1: '#000000',
    checkerColor2: '#ffffff',
    checkerDiamond: false,
    crossSpacing: 16,
    crossLineWidth: 2,
    crossAngle: 0,
    diagSpacing: 16,
    diagLineWidth: 1,
    hexRadius: 14,
    hexGap: 2,
    zigWidth: 24,
    zigHeight: 12,
    zigLineWidth: 2,
    zigFilled: false,
    circleSpacing: 30,
    circleLineWidth: 2,
    htCellSize: 8,
    htMinRadius: 1,
    htMaxRadius: 4,
    htFrequency: 1.5,
    brickW: 40,
    brickH: 20,
    brickGap: 2,
    brickColor: '#b5651d',
    mortarColor: '#f5f0e1',
    weaveMode: false,
    starOuter: 10,
    starInner: 4,
    starSpacing: 6,
    starPoints: 5,
    stampScale: 1,
    // Stroke
    strokeEnabled: false,
    strokeColor: '#000000',
    strokeWidth: 3,
    // Shadow
    shadowEnabled: false,
    shadowColor: 'rgba(0,0,0,0.5)',
    shadowBlur: 15,
    shadowOffsetX: 5,
    shadowOffsetY: 8,
    // Background band
    bgBandEnabled: false,
    bgBandColor: '#ffffff',
    bgBandOpacity: 80,
    bgBandPadding: 20,
    // Master
    masterOpacity: 100,
  };
}

// ─── INIT / DESTROY ──────────────────────────────────────────────────
export function init(imgElement, getOriginalImageData, pushToUndoStack) {
  pt.getOriginalImageData = getOriginalImageData;
  pt.pushToUndoStack = pushToUndoStack;
  pt.sourceImg = imgElement;

  const parent = imgElement.parentElement;
  pt.canvasW = imgElement.naturalWidth || imgElement.width;
  pt.canvasH = imgElement.naturalHeight || imgElement.height;

  pt.baseCanvas = document.createElement('canvas');
  pt.baseCanvas.width = pt.canvasW;
  pt.baseCanvas.height = pt.canvasH;
  pt.baseCanvas.className = 'pt-base-canvas';
  pt.baseCtx = pt.baseCanvas.getContext('2d');
  pt.baseCtx.drawImage(imgElement, 0, 0, pt.canvasW, pt.canvasH);

  pt.textCanvas = document.createElement('canvas');
  pt.textCanvas.width = pt.canvasW;
  pt.textCanvas.height = pt.canvasH;
  pt.textCanvas.className = 'pt-text-canvas';
  pt.textCtx = pt.textCanvas.getContext('2d');

  pt.overlayCanvas = document.createElement('canvas');
  pt.overlayCanvas.width = pt.canvasW;
  pt.overlayCanvas.height = pt.canvasH;
  pt.overlayCanvas.className = 'pt-overlay-canvas';
  pt.overlayCtx = pt.overlayCanvas.getContext('2d');

  const stack = document.createElement('div');
  stack.className = 'pt-canvas-stack';
  stack.appendChild(pt.baseCanvas);
  stack.appendChild(pt.textCanvas);
  stack.appendChild(pt.overlayCanvas);

  imgElement.style.display = 'none';
  parent.appendChild(stack);

  pt.isActive = true;
  pt.style = defaultStyle();
  pt.style.x = pt.canvasW / 2;
  pt.style.y = pt.canvasH / 2;

  initStampPad();
  bindOverlayEvents();
  bindUIEvents();
  invalidateBounds();
  renderAll();
  buildPatternThumbnails();
  showPatternControls(pt.style.patternType);
}

export function destroy() {
  if (!pt.isActive) return;
  pt.isActive = false;
  cancelAnimationFrame(pt.rafId);
  unbindOverlayEvents();
  clearPatternCache();

  const stack = pt.overlayCanvas?.parentElement;
  if (stack) stack.remove();

  if (pt.sourceImg) pt.sourceImg.style.display = '';

  pt.baseCanvas = null;
  pt.baseCtx = null;
  pt.textCanvas = null;
  pt.overlayCanvas = null;
  pt.textCtx = null;
  pt.overlayCtx = null;
  pt.sourceImg = null;
  pt.style = null;
  pt.dragging = null;
  pt.cachedBounds = null;
  pt.currentPatternTile = null;
}

// ─── APPLY (flatten to base) ─────────────────────────────────────────
export function apply() {
  if (!pt.isActive || !pt.baseCanvas || !pt.textCanvas) return;
  pt.baseCtx.clearRect(0, 0, pt.canvasW, pt.canvasH);
  pt.baseCtx.drawImage(pt.sourceImg, 0, 0, pt.canvasW, pt.canvasH);
  pt.baseCtx.drawImage(pt.textCanvas, 0, 0);
}

// ─── TEXT WRAPPING ───────────────────────────────────────────────────
function wrapText(ctx, text, maxWidth) {
  if (maxWidth <= 0) return text.split('\n');
  const paragraphs = text.split('\n');
  const lines = [];
  for (const para of paragraphs) {
    const words = para.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    lines.push(current);
  }
  return lines;
}

// ─── BOUNDING BOX ────────────────────────────────────────────────────
function buildFontString() {
  const s = pt.style;
  const style = s.fontItalic ? 'italic ' : '';
  const weight = s.fontBold ? 'bold ' : '';
  return `${style}${weight}${s.fontSize}px "${s.fontFamily}"`;
}

function computeBounds() {
  const ctx = pt.textCtx;
  const s = pt.style;
  ctx.save();
  ctx.font = buildFontString();
  const maxWidth = s.maxWidth > 0 ? s.maxWidth : pt.canvasW;
  const lines = wrapText(ctx, s.text || '', maxWidth);
  const lineH = s.fontSize * s.lineHeight;
  let maxW = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width + (line.length - 1) * (s.letterSpacing || 0);
    if (w > maxW) maxW = w;
  }
  ctx.restore();

  const totalH = lines.length * lineH;
  let offsetX = 0;
  if (s.textAlign === 'center') offsetX = -maxW / 2;
  else if (s.textAlign === 'right') offsetX = -maxW;

  return {
    x: s.x + offsetX,
    y: s.y - totalH + lineH * 0.15,
    w: maxW,
    h: totalH,
    lines,
    lineH,
  };
}

function getBounds() {
  if (!pt.cachedBounds) pt.cachedBounds = computeBounds();
  return pt.cachedBounds;
}

function invalidateBounds() {
  pt.cachedBounds = null;
}

// ─── GET PATTERN CONFIG FOR CURRENT STYLE ────────────────────────────
function getPatternConfig() {
  const s = pt.style;
  switch (s.patternType) {
    case 'polka':
      return { dotSize: s.dotSize, spacing: s.dotSpacing, offset: s.dotOffset, foreground: s.foreground, background: s.background };
    case 'stripes':
      return { stripeWidth: s.stripeWidth, angle: s.stripeAngle, foreground: s.foreground, background: s.background };
    case 'checker':
      return { cellSize: s.cellSize, color1: s.checkerColor1, color2: s.checkerColor2, diamond: s.checkerDiamond };
    case 'crosshatch':
      return { spacing: s.crossSpacing, lineWidth: s.crossLineWidth, angle: s.crossAngle, color: s.foreground, background: s.background };
    case 'diagcross':
      return { spacing: s.diagSpacing, lineWidth: s.diagLineWidth, color: s.foreground, background: s.background };
    case 'honeycomb':
      return { hexRadius: s.hexRadius, gap: s.hexGap, foreground: s.foreground, background: s.background };
    case 'zigzag':
      return { zigWidth: s.zigWidth, zigHeight: s.zigHeight, zigLineWidth: s.zigLineWidth, zigFilled: s.zigFilled, foreground: s.foreground, background: s.background };
    case 'circles':
      return { circleSpacing: s.circleSpacing, circleLineWidth: s.circleLineWidth, foreground: s.foreground, background: s.background };
    case 'halftone':
      return { htCellSize: s.htCellSize, htMinRadius: s.htMinRadius, htMaxRadius: s.htMaxRadius, htFrequency: s.htFrequency, foreground: s.foreground, background: s.background };
    case 'brick':
      return { brickW: s.brickW, brickH: s.brickH, brickGap: s.brickGap, brickColor: s.brickColor, mortarColor: s.mortarColor, weaveMode: s.weaveMode };
    case 'stars':
      return { starOuter: s.starOuter, starInner: s.starInner, starSpacing: s.starSpacing, starPoints: s.starPoints, foreground: s.foreground, background: s.background };
    case 'stamp':
      return { stampScale: s.stampScale, foreground: s.foreground, background: s.background };
    default:
      return { foreground: s.foreground, background: s.background };
  }
}

// ─── CORE RENDERING ──────────────────────────────────────────────────
function clearTextCanvas() {
  if (pt.textCtx) pt.textCtx.clearRect(0, 0, pt.canvasW, pt.canvasH);
}

function renderAll() {
  if (!pt.isActive) return;
  clearTextCanvas();
  const s = pt.style;
  if (!s.text) { renderOverlay(); return; }

  const ctx = pt.textCtx;
  const bounds = getBounds();

  ctx.save();
  ctx.globalAlpha = s.masterOpacity / 100;

  const pivotX = s.x;
  const pivotY = s.y;
  ctx.translate(pivotX, pivotY);
  ctx.rotate(s.rotation * Math.PI / 180);
  ctx.translate(-pivotX, -pivotY);

  renderPatternTextLayers(ctx, bounds);

  ctx.restore();
  renderOverlay();
}

function renderPatternTextLayers(ctx, bounds) {
  const s = pt.style;
  const fontStr = buildFontString();
  const { lines, lineH } = bounds;

  ctx.font = fontStr;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = s.textAlign;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineX = s.x;
    const lineY = bounds.y + (i + 1) * lineH - lineH * 0.15;

    // Background band
    if (s.bgBandEnabled) {
      ctx.save();
      const m = ctx.measureText(line);
      const pad = s.bgBandPadding;
      const bandH = lineH + pad;
      const bandY = lineY - lineH + lineH * 0.15 - pad / 2;
      let bandX = lineX;
      if (s.textAlign === 'center') bandX = lineX - m.width / 2 - pad;
      else if (s.textAlign === 'right') bandX = lineX - m.width - pad;
      else bandX = lineX - pad;
      ctx.fillStyle = s.bgBandColor;
      ctx.globalAlpha = (s.masterOpacity / 100) * (s.bgBandOpacity / 100);
      ctx.fillRect(bandX, bandY, m.width + pad * 2, bandH);
      ctx.restore();
      ctx.font = fontStr;
      ctx.textAlign = s.textAlign;
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
    }

    // Shadow
    if (s.shadowEnabled) {
      ctx.save();
      ctx.font = fontStr;
      ctx.textAlign = s.textAlign;
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      ctx.shadowColor = s.shadowColor;
      ctx.shadowBlur = s.shadowBlur;
      ctx.shadowOffsetX = s.shadowOffsetX;
      ctx.shadowOffsetY = s.shadowOffsetY;
      // Use foreground color so shadow renders properly
      const tile = generatePatternTile(s.patternType, getPatternConfig());
      if (tile) {
        const scaledTile = scaleTile(tile, s.patternScale);
        const pattern = ctx.createPattern(scaledTile, 'repeat');
        if (pattern) {
          const matrix = createPatternMatrix(lineX, lineY, bounds, i, lineH);
          pattern.setTransform(matrix);
          ctx.fillStyle = pattern;
        }
      } else {
        ctx.fillStyle = s.foreground;
      }
      ctx.fillText(line, lineX, lineY);
      ctx.restore();
      ctx.font = fontStr;
      ctx.textAlign = s.textAlign;
      ctx.lineJoin = 'round';
    }

    // Pattern fill
    ctx.save();
    ctx.font = fontStr;
    ctx.textAlign = s.textAlign;
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';

    const tile = generatePatternTile(s.patternType, getPatternConfig());
    if (tile) {
      const scaledTile = scaleTile(tile, s.patternScale);
      const rotatedTile = rotateTile(scaledTile, s.patternRotation);
      const pattern = ctx.createPattern(rotatedTile, 'repeat');
      if (pattern) {
        const matrix = createPatternMatrix(lineX, lineY, bounds, i, lineH);
        pattern.setTransform(matrix);
        ctx.fillStyle = pattern;
        ctx.fillText(line, lineX, lineY);
      }
    }
    ctx.restore();
    ctx.font = fontStr;
    ctx.textAlign = s.textAlign;
    ctx.lineJoin = 'round';

    // Stroke
    if (s.strokeEnabled && s.strokeWidth > 0) {
      ctx.save();
      ctx.strokeStyle = s.strokeColor;
      ctx.lineWidth = s.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, lineX, lineY);
      ctx.restore();
      ctx.font = fontStr;
      ctx.textAlign = s.textAlign;
    }
  }
}

function scaleTile(tile, scale) {
  if (scale === 1 || scale === 0) return tile;
  const w = Math.max(1, Math.round(tile.width * scale));
  const h = Math.max(1, Math.round(tile.height * scale));
  const scaled = createTile(w, h);
  const ctx = scaled.getContext('2d');
  ctx.drawImage(tile, 0, 0, w, h);
  return scaled;
}

function rotateTile(tile, degrees) {
  if (!degrees || degrees === 0) return tile;
  const rad = degrees * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = Math.ceil(tile.width * cos + tile.height * sin);
  const h = Math.ceil(tile.width * sin + tile.height * cos);
  const rotated = createTile(w, h);
  const ctx = rotated.getContext('2d');
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(tile, -tile.width / 2, -tile.height / 2);
  return rotated;
}

function createPatternMatrix(lineX, lineY, bounds, lineIndex, lineH) {
  const s = pt.style;
  const matrix = new DOMMatrix();
  const offsetX = s.x - bounds.w / 2 + (s.patternOffsetX || 0);
  const offsetY = bounds.y + (s.patternOffsetY || 0);
  matrix.translateSelf(offsetX, offsetY);
  return matrix;
}

// ─── OVERLAY RENDERING ──────────────────────────────────────────────
function renderOverlay() {
  const ctx = pt.overlayCtx;
  ctx.clearRect(0, 0, pt.canvasW, pt.canvasH);
  if (!pt.style || !pt.style.text) return;

  const bounds = getBounds();
  const s = pt.style;

  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rotation * Math.PI / 180);
  ctx.translate(-s.x, -s.y);

  const pad = 8;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(99,102,241,0.7)';
  ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);

  // Corner resize handles (larger, square)
  ctx.setLineDash([]);
  const handleSize = 8;
  const corners = [
    { x: bounds.x - pad, y: bounds.y - pad, cursor: 'nw' },
    { x: bounds.x + bounds.w + pad, y: bounds.y - pad, cursor: 'ne' },
    { x: bounds.x - pad, y: bounds.y + bounds.h + pad, cursor: 'sw' },
    { x: bounds.x + bounds.w + pad, y: bounds.y + bounds.h + pad, cursor: 'se' },
  ];
  for (const c of corners) {
    ctx.fillStyle = 'rgba(99,102,241,0.95)';
    ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
  }

  // Rotation handle
  const rotHandleY = bounds.y - pad - 30;
  const rotHandleX = bounds.x + bounds.w / 2;
  ctx.strokeStyle = 'rgba(99,102,241,0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(bounds.x + bounds.w / 2, bounds.y - pad);
  ctx.lineTo(rotHandleX, rotHandleY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(251,191,36,0.9)';
  ctx.beginPath();
  ctx.arc(rotHandleX, rotHandleY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(s.rotation)}°`, rotHandleX, rotHandleY - 10);

  ctx.restore();
}

// ─── HIT TESTING ─────────────────────────────────────────────────────
function getCanvasPoint(e) {
  const rect = pt.overlayCanvas.getBoundingClientRect();
  const scaleX = pt.canvasW / rect.width;
  const scaleY = pt.canvasH / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function hitTest(px, py) {
  if (!pt.style || !pt.style.text) return null;
  const bounds = getBounds();
  const s = pt.style;
  const pad = 8;
  const handleSize = 12;

  const rad = -s.rotation * Math.PI / 180;
  const dx = px - s.x;
  const dy = py - s.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad) + s.x;
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad) + s.y;

  // Rotation handle
  const rotHandleX = bounds.x + bounds.w / 2;
  const rotHandleY = bounds.y - pad - 30;
  if (Math.hypot(lx - rotHandleX, ly - rotHandleY) < 12) return 'rotate';

  // Corner resize handles
  const corners = [
    { x: bounds.x - pad, y: bounds.y - pad, type: 'resize-nw' },
    { x: bounds.x + bounds.w + pad, y: bounds.y - pad, type: 'resize-ne' },
    { x: bounds.x - pad, y: bounds.y + bounds.h + pad, type: 'resize-sw' },
    { x: bounds.x + bounds.w + pad, y: bounds.y + bounds.h + pad, type: 'resize-se' },
  ];
  for (const c of corners) {
    if (Math.abs(lx - c.x) < handleSize && Math.abs(ly - c.y) < handleSize) return c.type;
  }

  // Bounding box interior
  if (lx >= bounds.x - pad && lx <= bounds.x + bounds.w + pad &&
      ly >= bounds.y - pad && ly <= bounds.y + bounds.h + pad) return 'text';

  return null;
}

// ─── OVERLAY POINTER EVENTS ──────────────────────────────────────────
function onPointerDown(e) {
  if (!pt.isActive) return;
  const pt2 = getCanvasPoint(e);
  const hit = hitTest(pt2.x, pt2.y);
  if (hit) {
    pt.dragging = hit;
    pt.dragStart = { x: pt2.x, y: pt2.y };
    pt.itemStart = { x: pt.style.x, y: pt.style.y, rotation: pt.style.rotation, fontSize: pt.style.fontSize };
    pt.overlayCanvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
}

function onPointerMove(e) {
  if (!pt.dragging || !pt.isActive) return;
  const pt2 = getCanvasPoint(e);

  if (pt.dragging === 'text') {
    pt.style.x = pt.itemStart.x + (pt2.x - pt.dragStart.x);
    pt.style.y = pt.itemStart.y + (pt2.y - pt.dragStart.y);
    syncPositionInputs();
  } else if (pt.dragging === 'rotate') {
    const dx = pt2.x - pt.style.x;
    const dy = pt2.y - pt.style.y;
    pt.style.rotation = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    syncRotationSlider();
  } else if (pt.dragging.startsWith('resize-')) {
    // Resize by dragging corner handles — changes fontSize
    const bounds = getBounds();
    const s = pt.style;
    const rad = -s.rotation * Math.PI / 180;
    const dx = pt2.x - pt.dragStart.x;
    const dy = pt2.y - pt.dragStart.y;
    // Use horizontal drag distance as primary resize axis
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Determine direction: dragging outward (away from center) grows
    const centerX = bounds.x + bounds.w / 2;
    const centerY = bounds.y + bounds.h / 2;
    const dirX = pt.dragStart.x > centerX ? 1 : -1;
    const dirY = pt.dragStart.y > centerY ? 1 : -1;
    const outward = dx * dirX + dy * dirY;
    const scaleFactor = 1 + (outward / Math.max(bounds.w, bounds.h)) * 0.8;
    const newSize = Math.max(20, Math.min(400, Math.round(pt.itemStart.fontSize * scaleFactor)));
    pt.style.fontSize = newSize;
    setVal('#pt-font-size', newSize);
    setOut('#pt-font-size-val', `${newSize}px`);
    invalidateBounds();
  }

  scheduleRender();
}

function onPointerUp(e) {
  if (pt.dragging) {
    pt.overlayCanvas.releasePointerCapture(e.pointerId);
    pt.dragging = null;
  }
}

function scheduleRender() {
  if (pt.rafId) return;
  pt.rafId = requestAnimationFrame(() => {
    pt.rafId = null;
    invalidateBounds();
    renderAll();
  });
}

function bindOverlayEvents() {
  if (!pt.overlayCanvas) return;
  pt.overlayCanvas.addEventListener('pointerdown', onPointerDown);
  pt.overlayCanvas.addEventListener('pointermove', onPointerMove);
  pt.overlayCanvas.addEventListener('pointerup', onPointerUp);
  pt.overlayCanvas.addEventListener('pointercancel', onPointerUp);
}

function unbindOverlayEvents() {
  if (!pt.overlayCanvas) return;
  pt.overlayCanvas.removeEventListener('pointerdown', onPointerDown);
  pt.overlayCanvas.removeEventListener('pointermove', onPointerMove);
  pt.overlayCanvas.removeEventListener('pointerup', onPointerUp);
  pt.overlayCanvas.removeEventListener('pointercancel', onPointerUp);
}

// ─── UI SYNC HELPERS ─────────────────────────────────────────────────
function syncPositionInputs() {
  setVal('#pt-x', Math.round(pt.style.x));
  setVal('#pt-y', Math.round(pt.style.y));
}

function syncRotationSlider() {
  setVal('#pt-rotation', Math.round(pt.style.rotation));
  setOut('#pt-rotation-val', `${Math.round(pt.style.rotation)}°`);
}

function setVal(sel, val) { const el = document.querySelector(sel); if (el) el.value = val; }
function setOut(sel, val) { const el = document.querySelector(sel); if (el) el.textContent = val; }
function setCheck(sel, val) { const el = document.querySelector(sel); if (el) el.checked = val; }

// ─── STAMP PAD ───────────────────────────────────────────────────────
function initStampPad() {
  pt.stampCanvas = document.createElement('canvas');
  pt.stampCanvas.width = 64;
  pt.stampCanvas.height = 64;
  pt.stampCtx = pt.stampCanvas.getContext('2d');
  pt.stampCtx.fillStyle = '#ffffff';
  pt.stampCtx.fillRect(0, 0, 64, 64);
  pt.stampCtx.strokeStyle = '#000000';
  pt.stampCtx.lineWidth = 3;
  pt.stampCtx.lineCap = 'round';
  pt.stampCtx.lineJoin = 'round';

  const pad = document.querySelector('#pt-stamp-canvas');
  if (pad) {
    pad.addEventListener('pointerdown', onStampDown);
    pad.addEventListener('pointermove', onStampMove);
    pad.addEventListener('pointerup', onStampUp);
    pad.addEventListener('pointercancel', onStampUp);
  }
}

function onStampDown(e) {
  pt.stampDrawing = true;
  const rect = e.target.getBoundingClientRect();
  const sx = 64 / rect.width;
  const sy = 64 / rect.height;
  pt.stampLastX = (e.clientX - rect.left) * sx;
  pt.stampLastY = (e.clientY - rect.top) * sy;
  e.target.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onStampMove(e) {
  if (!pt.stampDrawing) return;
  const rect = e.target.getBoundingClientRect();
  const sx = 64 / rect.width;
  const sy = 64 / rect.height;
  const x = (e.clientX - rect.left) * sx;
  const y = (e.clientY - rect.top) * sy;
  pt.stampCtx.beginPath();
  pt.stampCtx.moveTo(pt.stampLastX, pt.stampLastY);
  pt.stampCtx.lineTo(x, y);
  pt.stampCtx.stroke();
  pt.stampLastX = x;
  pt.stampLastY = y;
  clearPatternCache();
  if (pt.style.patternType === 'stamp') scheduleRender();
}

function onStampUp(e) {
  pt.stampDrawing = false;
}

function refreshStampPreview() {
  const preview = document.querySelector('#pt-stamp-preview');
  if (!preview) return;
  const ctx = preview.getContext('2d');
  ctx.clearRect(0, 0, preview.width, preview.height);
  ctx.drawImage(pt.stampCanvas, 0, 0, preview.width, preview.height);
}

// ─── PATTERN CONTROLS VISIBILITY ─────────────────────────────────────
function showPatternControls(type) {
  document.querySelectorAll('.pt-pattern-controls').forEach(el => {
    el.style.display = el.dataset.pattern === type ? '' : 'none';
  });
}

// ─── UI BINDINGS ─────────────────────────────────────────────────────
let uiBound = false;

function bindUIEvents() {
  if (uiBound) return;
  uiBound = true;

  // Text input (debounced)
  bindTextInput('#pt-text', 40);

  // Font family
  const fontSelect = document.querySelector('#pt-font-family');
  if (fontSelect) {
    fontSelect.addEventListener('change', () => {
      pt.style.fontFamily = fontSelect.value;
      invalidateBounds();
      renderAll();
    });
  }

  // Google font input
  const gfontInput = document.querySelector('#pt-google-font');
  if (gfontInput) {
    gfontInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const fontName = gfontInput.value.trim();
        if (fontName) {
          await loadGoogleFont(fontName);
          pt.style.fontFamily = fontName;
          invalidateBounds();
          renderAll();
        }
      }
    });
  }

  // Font size
  bindSlider('#pt-font-size', '#pt-font-size-val', v => { pt.style.fontSize = Number(v); invalidateBounds(); }, 'px');

  // Bold / Italic
  bindCheck('#pt-font-bold', v => { pt.style.fontBold = v; invalidateBounds(); });
  bindCheck('#pt-font-italic', v => { pt.style.fontItalic = v; invalidateBounds(); });

  // Letter spacing
  bindSlider('#pt-letter-spacing', '#pt-letter-spacing-val', v => { pt.style.letterSpacing = Number(v); invalidateBounds(); }, 'px');

  // Line height
  bindSlider('#pt-line-height', '#pt-line-height-val', v => { pt.style.lineHeight = Number(v); invalidateBounds(); }, 'x', 0.01);

  // Text align
  document.querySelectorAll('.pt-align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pt-align-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pt.style.textAlign = btn.dataset.align;
      invalidateBounds();
      renderAll();
    });
  });

  // Position X / Y
  const xInput = document.querySelector('#pt-x');
  if (xInput) xInput.addEventListener('change', () => { pt.style.x = Number(xInput.value); invalidateBounds(); renderAll(); });
  const yInput = document.querySelector('#pt-y');
  if (yInput) yInput.addEventListener('change', () => { pt.style.y = Number(yInput.value); invalidateBounds(); renderAll(); });

  // Rotation
  bindSlider('#pt-rotation', '#pt-rotation-val', v => { pt.style.rotation = Number(v); }, '°');

  // Pattern type selection
  document.querySelectorAll('.pt-pattern-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.pt-pattern-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      pt.style.patternType = card.dataset.pattern;
      clearPatternCache();
      showPatternControls(pt.style.patternType);
      invalidateBounds();
      renderAll();
    });
  });

  // Pattern scale
  bindSlider('#pt-pattern-scale', '#pt-pattern-scale-val', v => { pt.style.patternScale = Number(v); clearPatternCache(); }, 'x');

  // Pattern rotation
  bindSlider('#pt-pattern-rotation', '#pt-pattern-rotation-val', v => { pt.style.patternRotation = Number(v); clearPatternCache(); }, '°');

  // Shared: foreground/background
  bindColor('#pt-foreground', v => { pt.style.foreground = v; clearPatternCache(); renderAll(); });
  bindColor('#pt-background', v => { pt.style.background = v; clearPatternCache(); renderAll(); });

  // ── Pattern-specific controls ──
  // Polka dots
  bindSlider('#pt-dot-size', '#pt-dot-size-val', v => { pt.style.dotSize = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-dot-spacing', '#pt-dot-spacing-val', v => { pt.style.dotSpacing = Number(v); clearPatternCache(); }, 'px');
  bindCheck('#pt-dot-offset', v => { pt.style.dotOffset = v; clearPatternCache(); renderAll(); });

  // Diagonal stripes
  bindSlider('#pt-stripe-width', '#pt-stripe-width-val', v => { pt.style.stripeWidth = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-stripe-angle', '#pt-stripe-angle-val', v => { pt.style.stripeAngle = Number(v); clearPatternCache(); }, '°');

  // Checkerboard
  bindSlider('#pt-cell-size', '#pt-cell-size-val', v => { pt.style.cellSize = Number(v); clearPatternCache(); }, 'px');
  bindColor('#pt-checker-color1', v => { pt.style.checkerColor1 = v; clearPatternCache(); renderAll(); });
  bindColor('#pt-checker-color2', v => { pt.style.checkerColor2 = v; clearPatternCache(); renderAll(); });
  bindCheck('#pt-checker-diamond', v => { pt.style.checkerDiamond = v; clearPatternCache(); renderAll(); });

  // Crosshatch
  bindSlider('#pt-cross-spacing', '#pt-cross-spacing-val', v => { pt.style.crossSpacing = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-cross-lw', '#pt-cross-lw-val', v => { pt.style.crossLineWidth = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-cross-angle', '#pt-cross-angle-val', v => { pt.style.crossAngle = Number(v); clearPatternCache(); }, '°');

  // Diagonal crosshatch
  bindSlider('#pt-diag-spacing', '#pt-diag-spacing-val', v => { pt.style.diagSpacing = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-diag-lw', '#pt-diag-lw-val', v => { pt.style.diagLineWidth = Number(v); clearPatternCache(); }, 'px');

  // Honeycomb
  bindSlider('#pt-hex-radius', '#pt-hex-radius-val', v => { pt.style.hexRadius = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-hex-gap', '#pt-hex-gap-val', v => { pt.style.hexGap = Number(v); clearPatternCache(); }, 'px');

  // Zigzag
  bindSlider('#pt-zig-width', '#pt-zig-width-val', v => { pt.style.zigWidth = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-zig-height', '#pt-zig-height-val', v => { pt.style.zigHeight = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-zig-lw', '#pt-zig-lw-val', v => { pt.style.zigLineWidth = Number(v); clearPatternCache(); }, 'px');
  bindCheck('#pt-zig-filled', v => { pt.style.zigFilled = v; clearPatternCache(); renderAll(); });

  // Circles
  bindSlider('#pt-circle-spacing', '#pt-circle-spacing-val', v => { pt.style.circleSpacing = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-circle-lw', '#pt-circle-lw-val', v => { pt.style.circleLineWidth = Number(v); clearPatternCache(); }, 'px');

  // Halftone
  bindSlider('#pt-ht-cell', '#pt-ht-cell-val', v => { pt.style.htCellSize = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-ht-minr', '#pt-ht-minr-val', v => { pt.style.htMinRadius = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-ht-maxr', '#pt-ht-maxr-val', v => { pt.style.htMaxRadius = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-ht-freq', '#pt-ht-freq-val', v => { pt.style.htFrequency = Number(v); clearPatternCache(); }, 'x');

  // Brick
  bindSlider('#pt-brick-w', '#pt-brick-w-val', v => { pt.style.brickW = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-brick-h', '#pt-brick-h-val', v => { pt.style.brickH = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-brick-gap', '#pt-brick-gap-val', v => { pt.style.brickGap = Number(v); clearPatternCache(); }, 'px');
  bindColor('#pt-brick-color', v => { pt.style.brickColor = v; clearPatternCache(); renderAll(); });
  bindColor('#pt-mortar-color', v => { pt.style.mortarColor = v; clearPatternCache(); renderAll(); });
  bindCheck('#pt-weave-mode', v => { pt.style.weaveMode = v; clearPatternCache(); renderAll(); });

  // Stars
  bindSlider('#pt-star-outer', '#pt-star-outer-val', v => { pt.style.starOuter = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-star-inner', '#pt-star-inner-val', v => { pt.style.starInner = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-star-spacing', '#pt-star-spacing-val', v => { pt.style.starSpacing = Number(v); clearPatternCache(); }, 'px');
  bindSlider('#pt-star-points', '#pt-star-points-val', v => { pt.style.starPoints = Number(v); clearPatternCache(); }, '');

  // Stamp
  bindSlider('#pt-stamp-scale', '#pt-stamp-scale-val', v => { pt.style.stampScale = Number(v); clearPatternCache(); }, 'x');
  const clearBtn = document.querySelector('#pt-stamp-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      pt.stampCtx.fillStyle = '#ffffff';
      pt.stampCtx.fillRect(0, 0, 64, 64);
      pt.stampCtx.fillStyle = '#000000';
      clearPatternCache();
      refreshStampPreview();
      if (pt.style.patternType === 'stamp') scheduleRender();
    });
  }
  const invertBtn = document.querySelector('#pt-stamp-invert');
  if (invertBtn) {
    invertBtn.addEventListener('click', () => {
      const imgData = pt.stampCtx.getImageData(0, 0, 64, 64);
      for (let i = 0; i < imgData.data.length; i += 4) {
        imgData.data[i] = 255 - imgData.data[i];
        imgData.data[i + 1] = 255 - imgData.data[i + 1];
        imgData.data[i + 2] = 255 - imgData.data[i + 2];
      }
      pt.stampCtx.putImageData(imgData, 0, 0);
      clearPatternCache();
      refreshStampPreview();
      if (pt.style.patternType === 'stamp') scheduleRender();
    });
  }

  // ── Stroke & Shadow ──
  bindCheck('#pt-stroke-enable', v => { pt.style.strokeEnabled = v; renderAll(); });
  bindColor('#pt-stroke-color', v => { pt.style.strokeColor = v; renderAll(); });
  bindSlider('#pt-stroke-width', '#pt-stroke-width-val', v => { pt.style.strokeWidth = Number(v); }, 'px');

  bindCheck('#pt-shadow-enable', v => { pt.style.shadowEnabled = v; renderAll(); });
  bindColor('#pt-shadow-color', v => { pt.style.shadowColor = v; renderAll(); });
  bindSlider('#pt-shadow-blur', '#pt-shadow-blur-val', v => { pt.style.shadowBlur = Number(v); }, 'px');
  bindSlider('#pt-shadow-ox', '#pt-shadow-ox-val', v => { pt.style.shadowOffsetX = Number(v); }, 'px');
  bindSlider('#pt-shadow-oy', '#pt-shadow-oy-val', v => { pt.style.shadowOffsetY = Number(v); }, 'px');

  // ── Background band ──
  bindCheck('#pt-bg-enable', v => { pt.style.bgBandEnabled = v; renderAll(); });
  bindColor('#pt-bg-color', v => { pt.style.bgBandColor = v; renderAll(); });
  bindSlider('#pt-bg-opacity', '#pt-bg-opacity-val', v => { pt.style.bgBandOpacity = Number(v); }, '%');
  bindSlider('#pt-bg-padding', '#pt-bg-padding-val', v => { pt.style.bgBandPadding = Number(v); }, 'px');

  // Master opacity
  bindSlider('#pt-master-opacity', '#pt-master-opacity-val', v => { pt.style.masterOpacity = Number(v); }, '%');

  // Apply / Reset
  const applyBtn = document.querySelector('#pt-apply');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      apply();
      if (pt.commitBlobCallback) exportAndCommit();
    });
  }

  const resetBtn = document.querySelector('#pt-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetToDefault);
  }
}

function bindTextInput(sel, debounceMs) {
  const el = document.querySelector(sel);
  if (!el) return;
  let timer;
  el.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      pt.style.text = el.value;
      invalidateBounds();
      renderAll();
    }, debounceMs || 30);
  });
}

function bindSlider(rangeSel, outSel, onChange, suffix, divisor) {
  const range = document.querySelector(rangeSel);
  const out = document.querySelector(outSel);
  if (!range || !out) return;
  range.addEventListener('input', () => {
    const v = divisor ? (Number(range.value) / divisor) : range.value;
    out.textContent = `${v}${suffix}`;
    onChange(range.value);
    invalidateBounds();
    renderAll();
  });
}

function bindColor(sel, onChange) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.addEventListener('input', () => {
    onChange(el.value);
  });
}

function bindCheck(sel, onChange) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.addEventListener('change', () => onChange(el.checked));
}

// ─── PRESETS ─────────────────────────────────────────────────────────
const PRESETS = {
  'newspaper': {
    patternType: 'crosshatch', crossSpacing: 8, crossLineWidth: 1, foreground: '#000000', background: '#ffffff',
    fontFamily: 'Impact', fontSize: 120, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
  'polka-party': {
    patternType: 'polka', dotSize: 12, dotSpacing: 6, foreground: '#ff6b6b', background: '#ffffff',
    fontFamily: 'Inter', fontSize: 120, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
  'blueprint': {
    patternType: 'crosshatch', crossSpacing: 10, crossLineWidth: 1, foreground: '#1a3a5c', background: '#d0e8ff',
    fontFamily: 'Courier New', fontSize: 120, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
  'gold-honeycomb': {
    patternType: 'honeycomb', hexRadius: 14, hexGap: 2, foreground: '#ffd700', background: '#000000',
    fontFamily: 'Montserrat', fontSize: 120, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
  'candy-stripe': {
    patternType: 'stripes', stripeWidth: 10, stripeAngle: 45, foreground: '#ff3366', background: '#ffffff',
    fontFamily: 'Inter', fontSize: 120, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
  'houndstooth': {
    patternType: 'checker', cellSize: 12, checkerColor1: '#000000', checkerColor2: '#ffffff', checkerDiamond: true,
    fontFamily: 'Georgia', fontSize: 120, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
  'night-sky': {
    patternType: 'stars', starOuter: 8, starInner: 3, starSpacing: 4, starPoints: 5, foreground: '#ffffff', background: '#0a0a2e',
    fontFamily: 'Oswald', fontSize: 120, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
  'crossword': {
    patternType: 'crosshatch', crossSpacing: 16, crossLineWidth: 1, foreground: '#000000', background: '#ffffff',
    fontFamily: 'Georgia', fontSize: 120, fontBold: false, strokeEnabled: false, shadowEnabled: false,
  },
  'circuit-board': {
    patternType: 'diagcross', diagSpacing: 12, diagLineWidth: 1, foreground: '#00ff41', background: '#0a0a0a',
    fontFamily: 'Courier New', fontSize: 100, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
  'retro-halftone': {
    patternType: 'halftone', htCellSize: 8, htMinRadius: 1, htMaxRadius: 4, htFrequency: 1.5, foreground: '#000000', background: '#fdf6e3',
    fontFamily: 'Inter', fontSize: 120, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
  'ocean-wave': {
    patternType: 'zigzag', zigWidth: 20, zigHeight: 8, zigLineWidth: 2, zigFilled: false, foreground: '#0077be', background: '#ffffff',
    fontFamily: 'Montserrat', fontSize: 120, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
  'urban-brick': {
    patternType: 'brick', brickW: 40, brickH: 20, brickGap: 2, brickColor: '#b5651d', mortarColor: '#f5f0e1',
    fontFamily: 'Oswald', fontSize: 120, fontBold: true, strokeEnabled: false, shadowEnabled: false,
  },
};

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  const defaults = defaultStyle();
  Object.assign(pt.style, defaults, preset);
  pt.style.x = pt.canvasW / 2;
  pt.style.y = pt.canvasH / 2;
  clearPatternCache();
  syncUIFromStyle();
  showPatternControls(pt.style.patternType);
  updatePatternCardSelection(pt.style.patternType);
  invalidateBounds();
  renderAll();
}

function updatePatternCardSelection(type) {
  document.querySelectorAll('.pt-pattern-card').forEach(c => {
    c.classList.toggle('active', c.dataset.pattern === type);
  });
}

// ─── SYNC UI FROM STYLE ──────────────────────────────────────────────
function syncUIFromStyle() {
  const s = pt.style;
  setVal('#pt-text', s.text);
  setVal('#pt-font-family', s.fontFamily);
  setVal('#pt-font-size', s.fontSize);
  setOut('#pt-font-size-val', `${s.fontSize}px`);
  setCheck('#pt-font-bold', s.fontBold);
  setCheck('#pt-font-italic', s.fontItalic);
  setVal('#pt-letter-spacing', s.letterSpacing);
  setOut('#pt-letter-spacing-val', `${s.letterSpacing}px`);
  setVal('#pt-line-height', Math.round(s.lineHeight * 100));
  setOut('#pt-line-height-val', `${s.lineHeight}x`);
  setVal('#pt-x', Math.round(s.x));
  setVal('#pt-y', Math.round(s.y));
  setVal('#pt-rotation', Math.round(s.rotation));
  setOut('#pt-rotation-val', `${Math.round(s.rotation)}°`);

  document.querySelectorAll('.pt-align-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.align === s.textAlign);
  });

  setVal('#pt-pattern-scale', s.patternScale);
  setOut('#pt-pattern-scale-val', `${s.patternScale}x`);
  setVal('#pt-pattern-rotation', s.patternRotation);
  setOut('#pt-pattern-rotation-val', `${s.patternRotation}°`);
  setVal('#pt-foreground', s.foreground);
  setVal('#pt-background', s.background);

  // Pattern-specific
  setVal('#pt-dot-size', s.dotSize); setOut('#pt-dot-size-val', `${s.dotSize}px`);
  setVal('#pt-dot-spacing', s.dotSpacing); setOut('#pt-dot-spacing-val', `${s.dotSpacing}px`);
  setCheck('#pt-dot-offset', s.dotOffset);
  setVal('#pt-stripe-width', s.stripeWidth); setOut('#pt-stripe-width-val', `${s.stripeWidth}px`);
  setVal('#pt-stripe-angle', s.stripeAngle); setOut('#pt-stripe-angle-val', `${s.stripeAngle}°`);
  setVal('#pt-cell-size', s.cellSize); setOut('#pt-cell-size-val', `${s.cellSize}px`);
  setVal('#pt-checker-color1', s.checkerColor1);
  setVal('#pt-checker-color2', s.checkerColor2);
  setCheck('#pt-checker-diamond', s.checkerDiamond);
  setVal('#pt-cross-spacing', s.crossSpacing); setOut('#pt-cross-spacing-val', `${s.crossSpacing}px`);
  setVal('#pt-cross-lw', s.crossLineWidth); setOut('#pt-cross-lw-val', `${s.crossLineWidth}px`);
  setVal('#pt-cross-angle', s.crossAngle); setOut('#pt-cross-angle-val', `${s.crossAngle}°`);
  setVal('#pt-diag-spacing', s.diagSpacing); setOut('#pt-diag-spacing-val', `${s.diagSpacing}px`);
  setVal('#pt-diag-lw', s.diagLineWidth); setOut('#pt-diag-lw-val', `${s.diagLineWidth}px`);
  setVal('#pt-hex-radius', s.hexRadius); setOut('#pt-hex-radius-val', `${s.hexRadius}px`);
  setVal('#pt-hex-gap', s.hexGap); setOut('#pt-hex-gap-val', `${s.hexGap}px`);
  setVal('#pt-zig-width', s.zigWidth); setOut('#pt-zig-width-val', `${s.zigWidth}px`);
  setVal('#pt-zig-height', s.zigHeight); setOut('#pt-zig-height-val', `${s.zigHeight}px`);
  setVal('#pt-zig-lw', s.zigLineWidth); setOut('#pt-zig-lw-val', `${s.zigLineWidth}px`);
  setCheck('#pt-zig-filled', s.zigFilled);
  setVal('#pt-circle-spacing', s.circleSpacing); setOut('#pt-circle-spacing-val', `${s.circleSpacing}px`);
  setVal('#pt-circle-lw', s.circleLineWidth); setOut('#pt-circle-lw-val', `${s.circleLineWidth}px`);
  setVal('#pt-ht-cell', s.htCellSize); setOut('#pt-ht-cell-val', `${s.htCellSize}px`);
  setVal('#pt-ht-minr', s.htMinRadius); setOut('#pt-ht-minr-val', `${s.htMinRadius}px`);
  setVal('#pt-ht-maxr', s.htMaxRadius); setOut('#pt-ht-maxr-val', `${s.htMaxRadius}px`);
  setVal('#pt-ht-freq', s.htFrequency); setOut('#pt-ht-freq-val', `${s.htFrequency}x`);
  setVal('#pt-brick-w', s.brickW); setOut('#pt-brick-w-val', `${s.brickW}px`);
  setVal('#pt-brick-h', s.brickH); setOut('#pt-brick-h-val', `${s.brickH}px`);
  setVal('#pt-brick-gap', s.brickGap); setOut('#pt-brick-gap-val', `${s.brickGap}px`);
  setVal('#pt-brick-color', s.brickColor);
  setVal('#pt-mortar-color', s.mortarColor);
  setCheck('#pt-weave-mode', s.weaveMode);
  setVal('#pt-star-outer', s.starOuter); setOut('#pt-star-outer-val', `${s.starOuter}px`);
  setVal('#pt-star-inner', s.starInner); setOut('#pt-star-inner-val', `${s.starInner}px`);
  setVal('#pt-star-spacing', s.starSpacing); setOut('#pt-star-spacing-val', `${s.starSpacing}px`);
  setVal('#pt-star-points', s.starPoints); setOut('#pt-star-points-val', s.starPoints);
  setVal('#pt-stamp-scale', s.stampScale); setOut('#pt-stamp-scale-val', `${s.stampScale}x`);

  // Stroke
  setCheck('#pt-stroke-enable', s.strokeEnabled);
  setVal('#pt-stroke-color', s.strokeColor);
  setVal('#pt-stroke-width', s.strokeWidth);
  setOut('#pt-stroke-width-val', `${s.strokeWidth}px`);

  // Shadow
  setCheck('#pt-shadow-enable', s.shadowEnabled);
  setVal('#pt-shadow-color', s.shadowColor);
  setVal('#pt-shadow-blur', s.shadowBlur); setOut('#pt-shadow-blur-val', `${s.shadowBlur}px`);
  setVal('#pt-shadow-ox', s.shadowOffsetX); setOut('#pt-shadow-ox-val', `${s.shadowOffsetX}px`);
  setVal('#pt-shadow-oy', s.shadowOffsetY); setOut('#pt-shadow-oy-val', `${s.shadowOffsetY}px`);

  // Background band
  setCheck('#pt-bg-enable', s.bgBandEnabled);
  setVal('#pt-bg-color', s.bgBandColor);
  setVal('#pt-bg-opacity', s.bgBandOpacity); setOut('#pt-bg-opacity-val', `${s.bgBandOpacity}%`);
  setVal('#pt-bg-padding', s.bgBandPadding); setOut('#pt-bg-padding-val', `${s.bgBandPadding}px`);

  // Master
  setVal('#pt-master-opacity', s.masterOpacity); setOut('#pt-master-opacity-val', `${s.masterOpacity}%`);
}

// ─── RESET ───────────────────────────────────────────────────────────
function resetToDefault() {
  pt.style = defaultStyle();
  pt.style.x = pt.canvasW / 2;
  pt.style.y = pt.canvasH / 2;
  clearPatternCache();
  syncUIFromStyle();
  showPatternControls(pt.style.patternType);
  updatePatternCardSelection(pt.style.patternType);
  invalidateBounds();
  renderAll();
}

// ─── GOOGLE FONTS ────────────────────────────────────────────────────
async function loadGoogleFont(fontName) {
  const family = fontName.replace(/\s+/g, '+');
  if (pt.loadedFonts.has(family)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@400;700&display=swap`;
  document.head.appendChild(link);
  pt.loadedFonts.add(family);

  try {
    await document.fonts.ready;
  } catch (_) {
    await new Promise(r => setTimeout(r, 500));
  }
}

// ─── PATTERN THUMBNAILS ──────────────────────────────────────────────
function buildPatternThumbnails() {
  document.querySelectorAll('.pt-pattern-card').forEach(card => {
    const type = card.dataset.pattern;
    const thumb = card.querySelector('.pt-pattern-thumb');
    if (!thumb) return;
    const tc = document.createElement('canvas');
    tc.width = 60;
    tc.height = 60;
    const tctx = tc.getContext('2d');

    const config = getDefaultThumbnailConfig(type);
    const tile = generatePatternTile(type, config);
    if (tile) {
      const pattern = tctx.createPattern(tile, 'repeat');
      if (pattern) {
        tctx.fillStyle = pattern;
        tctx.fillRect(0, 0, 60, 60);
      }
    } else {
      tctx.fillStyle = '#333';
      tctx.fillRect(0, 0, 60, 60);
      tctx.fillStyle = '#888';
      tctx.font = '9px Inter';
      tctx.textAlign = 'center';
      tctx.fillText('Draw', 30, 32);
    }

    thumb.innerHTML = '';
    thumb.appendChild(tc);
  });
}

function getDefaultThumbnailConfig(type) {
  switch (type) {
    case 'polka': return { dotSize: 8, spacing: 4, foreground: '#abffcb', background: '#1a1f25' };
    case 'stripes': return { stripeWidth: 6, angle: 45, foreground: '#abffcb', background: '#1a1f25' };
    case 'checker': return { cellSize: 10, color1: '#abffcb', color2: '#1a1f25' };
    case 'crosshatch': return { spacing: 12, lineWidth: 1, color: '#abffcb', background: '#1a1f25' };
    case 'diagcross': return { spacing: 10, lineWidth: 1, color: '#abffcb', background: '#1a1f25' };
    case 'honeycomb': return { hexRadius: 10, gap: 1, foreground: '#abffcb', background: '#1a1f25' };
    case 'zigzag': return { zigWidth: 12, zigHeight: 6, zigLineWidth: 1.5, foreground: '#abffcb', background: '#1a1f25' };
    case 'circles': return { circleSpacing: 18, circleLineWidth: 1, foreground: '#abffcb', background: '#1a1f25' };
    case 'halftone': return { htCellSize: 6, htMinRadius: 0.5, htMaxRadius: 3, htFrequency: 1.2, foreground: '#abffcb', background: '#1a1f25' };
    case 'brick': return { brickW: 24, brickH: 12, brickGap: 1, brickColor: '#abffcb', mortarColor: '#1a1f25' };
    case 'stars': return { starOuter: 8, starInner: 3, starSpacing: 4, starPoints: 5, foreground: '#abffcb', background: '#1a1f25' };
    case 'stamp': return null;
    default: return { foreground: '#abffcb', background: '#1a1f25' };
  }
}

// ─── PRESET THUMBNAILS ───────────────────────────────────────────────
function buildPresetThumbnails() {
  document.querySelectorAll('.pt-preset-card').forEach(card => {
    const name = card.dataset.preset;
    const preset = PRESETS[name];
    if (!preset) return;
    const thumb = card.querySelector('.pt-preset-thumb');
    if (!thumb) return;
    const tc = document.createElement('canvas');
    tc.width = 80;
    tc.height = 40;
    const tctx = tc.getContext('2d');

    tctx.fillStyle = preset.background || '#1a1f25';
    tctx.fillRect(0, 0, 80, 40);

    const config = { ...getDefaultThumbnailConfig(preset.patternType), ...preset };
    const tile = generatePatternTile(preset.patternType, config);
    if (tile) {
      const pattern = tctx.createPattern(tile, 'repeat');
      if (pattern) {
        tctx.fillStyle = pattern;
        tctx.fillRect(0, 0, 80, 40);
      }
    }

    thumb.innerHTML = '';
    thumb.appendChild(tc);
  });
}

// ─── EXPORT ──────────────────────────────────────────────────────────
async function exportAndCommit() {
  if (!pt.commitBlobCallback || !pt.baseCanvas) return;
  try {
    const blob = await new Promise((resolve, reject) => {
      pt.baseCanvas.toBlob(b => b ? resolve(b) : reject(new Error('Export failed')), 'image/png');
    });
    pt.commitBlobCallback(blob, 'Pattern Text', 'pattern-text.png');
  } catch (err) {
    console.error('Pattern text export failed:', err);
  }
}

// ─── SET COMMIT CALLBACK ─────────────────────────────────────────────
export function setCommitBlobCallback(fn) {
  pt.commitBlobCallback = fn;
}
