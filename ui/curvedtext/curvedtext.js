// Curved Text Effect Module
// Renders text along circular arc, cubic Bezier, or sinusoidal wave paths
// Uses layered canvas architecture: base + text preview + path overlay

// ─── STATE ───────────────────────────────────────────────────────────
const ct = {
  items: [],
  selectedIndex: -1,
  mode: 'arc', // 'arc' | 'bezier' | 'wave'
  baseCanvas: null,
  textCanvas: null,
  overlayCanvas: null,
  baseCtx: null,
  textCtx: null,
  overlayCtx: null,
  canvasW: 0,
  canvasH: 0,
  isActive: false,
  dragging: null, // { handleKey, itemId }
  loadedFonts: new Set(),
  rafId: null,
  getOriginalImageData: null,
  pushToUndoStack: null,
  commitBlobCallback: null,
};

// ─── DEFAULTS ────────────────────────────────────────────────────────
function defaultItem() {
  return {
    id: Date.now() + Math.random(),
    text: 'Curved Text',
    mode: 'arc',
    fontFamily: 'Arial',
    fontSize: 48,
    fontBold: false,
    fontItalic: false,
    color: '#ffffff',
    letterSpacing: 0,
    alignment: 'start', // 'start' | 'center' | 'end'
    strokeEnabled: false,
    strokeColor: '#000000',
    strokeWidth: 2,
    shadowEnabled: false,
    shadowColor: 'rgba(0,0,0,0.5)',
    shadowBlur: 8,
    shadowOffsetX: 3,
    shadowOffsetY: 3,
    // Arc params
    arcCx: 0,
    arcCy: 0,
    arcRadius: 200,
    arcStartAngle: 0, // degrees
    arcSide: 'above', // 'above' | 'below'
    // Bezier params
    bezierP0: { x: 0, y: 0 },
    bezierP1: { x: 0, y: 0 },
    bezierP2: { x: 0, y: 0 },
    bezierP3: { x: 0, y: 0 },
    // Wave params
    waveCenterX: 0,
    waveCenterY: 0,
    waveAmplitude: 30,
    waveFrequency: 0.015,
    wavePhase: 0, // degrees
    // visibility
    visible: true,
  };
}

// ─── INIT / DESTROY ──────────────────────────────────────────────────
export function init(imgElement, getOriginalImageData, pushToUndoStack) {
  ct.getOriginalImageData = getOriginalImageData;
  ct.pushToUndoStack = pushToUndoStack;
  ct.sourceImg = imgElement;

  const parent = imgElement.parentElement;
  ct.canvasW = imgElement.naturalWidth || imgElement.width;
  ct.canvasH = imgElement.naturalHeight || imgElement.height;

  // Create base canvas from image
  ct.baseCanvas = document.createElement('canvas');
  ct.baseCanvas.width = ct.canvasW;
  ct.baseCanvas.height = ct.canvasH;
  ct.baseCanvas.className = 'ct-base-canvas';
  ct.baseCtx = ct.baseCanvas.getContext('2d');
  ct.baseCtx.drawImage(imgElement, 0, 0, ct.canvasW, ct.canvasH);

  // Create text preview canvas
  ct.textCanvas = document.createElement('canvas');
  ct.textCanvas.width = ct.canvasW;
  ct.textCanvas.height = ct.canvasH;
  ct.textCanvas.className = 'ct-text-canvas';
  ct.textCtx = ct.textCanvas.getContext('2d');

  // Create overlay canvas
  ct.overlayCanvas = document.createElement('canvas');
  ct.overlayCanvas.width = ct.canvasW;
  ct.overlayCanvas.height = ct.canvasH;
  ct.overlayCanvas.className = 'ct-overlay-canvas';
  ct.overlayCtx = ct.overlayCanvas.getContext('2d');

  // Build canvas stack
  const stack = document.createElement('div');
  stack.className = 'ct-canvas-stack';
  stack.appendChild(ct.baseCanvas);
  stack.appendChild(ct.textCanvas);
  stack.appendChild(ct.overlayCanvas);

  // Hide original image and insert stack
  imgElement.style.display = 'none';
  parent.appendChild(stack);

  ct.isActive = true;

  // Default item centered on the canvas
  const item = defaultItem();
  item.arcCx = ct.canvasW / 2;
  item.arcCy = ct.canvasH / 2;
  item.bezierP0 = { x: ct.canvasW * 0.15, y: ct.canvasH * 0.5 };
  item.bezierP1 = { x: ct.canvasW * 0.35, y: ct.canvasH * 0.2 };
  item.bezierP2 = { x: ct.canvasW * 0.65, y: ct.canvasH * 0.8 };
  item.bezierP3 = { x: ct.canvasW * 0.85, y: ct.canvasH * 0.5 };
  item.waveCenterX = ct.canvasW / 2;
  item.waveCenterY = ct.canvasH / 2;
  ct.items = [item];
  ct.selectedIndex = 0;

  bindOverlayEvents();
  bindUIEvents();
  renderAll();
  rebuildItemList();
}

export function destroy() {
  if (!ct.isActive) return;
  ct.isActive = false;

  cancelAnimationFrame(ct.rafId);
  unbindOverlayEvents();

  // Remove canvas stack
  const stack = ct.overlayCanvas?.parentElement;
  if (stack) stack.remove();

  // Restore original image visibility
  if (ct.sourceImg) ct.sourceImg.style.display = '';

  ct.baseCanvas = null;
  ct.baseCtx = null;
  ct.textCanvas = null;
  ct.overlayCanvas = null;
  ct.textCtx = null;
  ct.overlayCtx = null;
  ct.sourceImg = null;
  ct.items = [];
  ct.selectedIndex = -1;
  ct.dragging = null;
}

// ─── APPLY (flatten to base) ─────────────────────────────────────────
export function apply() {
  if (!ct.isActive || !ct.baseCanvas || !ct.textCanvas) return;

  // Clear base canvas and re-draw original image
  ct.baseCtx.clearRect(0, 0, ct.canvasW, ct.canvasH);
  ct.baseCtx.drawImage(ct.sourceImg, 0, 0, ct.canvasW, ct.canvasH);

  // Flatten all visible text items onto base
  ct.baseCtx.drawImage(ct.textCanvas, 0, 0);
}

// ─── RENDERING ───────────────────────────────────────────────────────
function clearTextCanvas() {
  if (ct.textCtx) ct.textCtx.clearRect(0, 0, ct.canvasW, ct.canvasH);
}

function renderAll() {
  if (!ct.isActive) return;
  clearTextCanvas();
  for (const item of ct.items) {
    if (!item.visible) continue;
    renderTextItem(item);
  }
  renderOverlay();
}

function renderTextItem(item) {
  const ctx = ct.textCtx;
  const fontStr = buildFontString(item);

  // Wait for font to be ready if loaded
  ctx.font = fontStr;

  if (item.shadowEnabled) {
    ctx.shadowColor = item.shadowColor;
    ctx.shadowBlur = item.shadowBlur;
    ctx.shadowOffsetX = item.shadowOffsetX;
    ctx.shadowOffsetY = item.shadowOffsetY;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  if (item.mode === 'arc') {
    renderArcText(ctx, item);
  } else if (item.mode === 'bezier') {
    renderBezierText(ctx, item);
  } else if (item.mode === 'wave') {
    renderWaveText(ctx, item);
  }

  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function buildFontString(item) {
  const style = item.fontItalic ? 'italic ' : '';
  const weight = item.fontBold ? 'bold ' : '';
  return `${style}${weight}${item.fontSize}px "${item.fontFamily}"`;
}

// ─── ARC TEXT ────────────────────────────────────────────────────────
function renderArcText(ctx, item) {
  const { arcCx: cx, arcCy: cy, arcRadius: r, text, letterSpacing, color, alignment, arcSide } = item;
  if (!text || r <= 0) return;

  ctx.save();
  ctx.font = buildFontString(item);

  // Compute total arc length
  let totalWidth = 0;
  const widths = [];
  for (let i = 0; i < text.length; i++) {
    const w = ctx.measureText(text[i]).width;
    widths.push(w);
    totalWidth += w + letterSpacing;
  }
  totalWidth -= letterSpacing; // no trailing spacing

  const totalAngle = totalWidth / r;
  let startAngleDeg = item.arcStartAngle;
  if (alignment === 'center') {
    startAngleDeg -= (totalAngle * 180 / Math.PI) / 2;
  } else if (alignment === 'end') {
    startAngleDeg -= (totalAngle * 180 / Math.PI);
  }

  let angle = startAngleDeg * Math.PI / 180;
  const direction = arcSide === 'above' ? 1 : -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const charWidth = widths[i];
    const charAngle = angle + (charWidth / 2) / r * direction;

    ctx.save();
    ctx.translate(
      cx + r * Math.cos(charAngle),
      cy + r * Math.sin(charAngle)
    );
    if (arcSide === 'above') {
      ctx.rotate(charAngle + Math.PI / 2);
    } else {
      ctx.rotate(charAngle - Math.PI / 2);
    }

    if (item.strokeEnabled && item.strokeWidth > 0) {
      ctx.strokeStyle = item.strokeColor;
      ctx.lineWidth = item.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(char, 0, 0);
    }
    ctx.fillStyle = color;
    ctx.fillText(char, 0, 0);
    ctx.restore();

    angle += (charWidth + letterSpacing) / r * direction;
  }

  ctx.restore();
}

// ─── BEZIER TEXT ─────────────────────────────────────────────────────
function bezierPoint(t, P0, P1, P2, P3) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * P0.x + 3 * mt * mt * t * P1.x + 3 * mt * t * t * P2.x + t * t * t * P3.x,
    y: mt * mt * mt * P0.y + 3 * mt * mt * t * P1.y + 3 * mt * t * t * P2.y + t * t * t * P3.y,
  };
}

function buildArcLengthTable(P0, P1, P2, P3, samples) {
  const table = new Float64Array(samples);
  let cumLen = 0;
  let prev = bezierPoint(0, P0, P1, P2, P3);
  for (let i = 1; i < samples; i++) {
    const t = i / (samples - 1);
    const pt = bezierPoint(t, P0, P1, P2, P3);
    const dx = pt.x - prev.x;
    const dy = pt.y - prev.y;
    cumLen += Math.sqrt(dx * dx + dy * dy);
    table[i] = cumLen;
    prev = pt;
  }
  return { table, totalLength: cumLen };
}

function pointAtArcLength(d, P0, P1, P2, P3, arcTable) {
  const { table, totalLength } = arcTable;
  const samples = table.length;
  if (d <= 0) return bezierPoint(0, P0, P1, P2, P3);
  if (d >= totalLength) return bezierPoint(1, P0, P1, P2, P3);

  // Binary search
  let lo = 0, hi = samples - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] < d) lo = mid;
    else hi = mid;
  }

  const segLen = table[hi] - table[lo];
  const frac = segLen > 0 ? (d - table[lo]) / segLen : 0;
  const t = (lo + frac) / (samples - 1);
  return bezierPoint(t, P0, P1, P2, P3);
}

function renderBezierText(ctx, item) {
  const { bezierP0, bezierP1, bezierP2, bezierP3, text, letterSpacing, color, alignment } = item;
  if (!text) return;

  ctx.save();
  ctx.font = buildFontString(item);

  const samples = 1000;
  const arcTable = buildArcLengthTable(bezierP0, bezierP1, bezierP2, bezierP3, samples);

  // Compute total text width
  let totalWidth = 0;
  const widths = [];
  for (let i = 0; i < text.length; i++) {
    const w = ctx.measureText(text[i]).width;
    widths.push(w);
    totalWidth += w + letterSpacing;
  }
  totalWidth -= letterSpacing;

  let d = 0;
  if (alignment === 'center') {
    d = (arcTable.totalLength - totalWidth) / 2;
  } else if (alignment === 'end') {
    d = arcTable.totalLength - totalWidth;
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const charWidth = widths[i];
    const charD = d + charWidth / 2;

    const pos = pointAtArcLength(charD, bezierP0, bezierP1, bezierP2, bezierP3, arcTable);
    const tangent = pointAtArcLength(charD + 0.5, bezierP0, bezierP1, bezierP2, bezierP3, arcTable);
    const angle = Math.atan2(tangent.y - pos.y, tangent.x - pos.x);

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);

    if (item.strokeEnabled && item.strokeWidth > 0) {
      ctx.strokeStyle = item.strokeColor;
      ctx.lineWidth = item.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(char, 0, 0);
    }
    ctx.fillStyle = color;
    ctx.fillText(char, 0, 0);
    ctx.restore();

    d += charWidth + letterSpacing;
  }

  ctx.restore();
}

// ─── WAVE TEXT ───────────────────────────────────────────────────────
function renderWaveText(ctx, item) {
  const { waveCenterX, waveCenterY, waveAmplitude, waveFrequency, wavePhase, text, letterSpacing, color, alignment } = item;
  if (!text) return;

  ctx.save();
  ctx.font = buildFontString(item);

  let totalWidth = 0;
  const widths = [];
  for (let i = 0; i < text.length; i++) {
    const w = ctx.measureText(text[i]).width;
    widths.push(w);
    totalWidth += w + letterSpacing;
  }
  totalWidth -= letterSpacing;

  let startX = waveCenterX - totalWidth / 2;
  if (alignment === 'start') {
    startX = waveCenterX - totalWidth / 2;
  } else if (alignment === 'center') {
    startX = waveCenterX - totalWidth / 2;
  } else if (alignment === 'end') {
    startX = waveCenterX - totalWidth / 2;
  }

  const phaseRad = wavePhase * Math.PI / 180;
  let x = startX;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const charWidth = widths[i];
    const charX = x + charWidth / 2;
    const charY = waveCenterY + waveAmplitude * Math.sin((charX - waveCenterX) * waveFrequency + phaseRad);

    // Tangent angle
    const tangentY = waveAmplitude * waveFrequency * Math.cos((charX - waveCenterX) * waveFrequency + phaseRad);
    const angle = Math.atan2(tangentY, 1);

    ctx.save();
    ctx.translate(charX, charY);
    ctx.rotate(angle);

    if (item.strokeEnabled && item.strokeWidth > 0) {
      ctx.strokeStyle = item.strokeColor;
      ctx.lineWidth = item.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(char, 0, 0);
    }
    ctx.fillStyle = color;
    ctx.fillText(char, 0, 0);
    ctx.restore();

    x += charWidth + letterSpacing;
  }

  ctx.restore();
}

// ─── OVERLAY RENDERING ──────────────────────────────────────────────
function renderOverlay() {
  const ctx = ct.overlayCtx;
  ctx.clearRect(0, 0, ct.canvasW, ct.canvasH);

  if (ct.selectedIndex < 0 || ct.selectedIndex >= ct.items.length) return;
  const item = ct.items[ct.selectedIndex];
  if (!item.visible) return;

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;

  if (item.mode === 'arc') {
    renderArcOverlay(ctx, item);
  } else if (item.mode === 'bezier') {
    renderBezierOverlay(ctx, item);
  } else if (item.mode === 'wave') {
    renderWaveOverlay(ctx, item);
  }

  ctx.setLineDash([]);
  ctx.restore();
}

function renderArcOverlay(ctx, item) {
  const { arcCx, arcCy, arcRadius } = item;

  // Circle outline
  ctx.strokeStyle = 'rgba(99,102,241,0.6)';
  ctx.beginPath();
  ctx.arc(arcCx, arcCy, arcRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Center handle
  drawHandle(ctx, arcCx, arcCy, 8, 'rgba(99,102,241,0.9)', 'Center');

  // Radius handle
  const rAngle = item.arcStartAngle * Math.PI / 180;
  const rX = arcCx + arcRadius * Math.cos(rAngle);
  const rY = arcCy + arcRadius * Math.sin(rAngle);
  drawHandle(ctx, rX, rY, 7, 'rgba(251,191,36,0.9)', 'Radius');

  // Start angle handle (at a different angle offset)
  const saAngle = (item.arcStartAngle + 30) * Math.PI / 180;
  const saX = arcCx + arcRadius * Math.cos(saAngle);
  const saY = arcCy + arcRadius * Math.sin(saAngle);
  drawHandle(ctx, saX, saY, 7, 'rgba(239,68,68,0.9)', 'Start Angle');
}

function renderBezierOverlay(ctx, item) {
  const { bezierP0, bezierP1, bezierP2, bezierP3 } = item;

  // Bezier curve
  ctx.strokeStyle = 'rgba(99,102,241,0.6)';
  ctx.beginPath();
  ctx.moveTo(bezierP0.x, bezierP0.y);
  ctx.bezierCurveTo(bezierP1.x, bezierP1.y, bezierP2.x, bezierP2.y, bezierP3.x, bezierP3.y);
  ctx.stroke();

  // Control arms
  ctx.strokeStyle = 'rgba(148,163,184,0.4)';
  ctx.beginPath();
  ctx.moveTo(bezierP0.x, bezierP0.y);
  ctx.lineTo(bezierP1.x, bezierP1.y);
  ctx.moveTo(bezierP3.x, bezierP3.y);
  ctx.lineTo(bezierP2.x, bezierP2.y);
  ctx.stroke();

  // Handles
  drawHandle(ctx, bezierP0.x, bezierP0.y, 8, 'rgba(34,197,94,0.9)', 'P0');
  drawHandle(ctx, bezierP1.x, bezierP1.y, 7, 'rgba(59,130,246,0.9)', 'P1');
  drawHandle(ctx, bezierP2.x, bezierP2.y, 7, 'rgba(59,130,246,0.9)', 'P2');
  drawHandle(ctx, bezierP3.x, bezierP3.y, 8, 'rgba(34,197,94,0.9)', 'P3');
}

function renderWaveOverlay(ctx, item) {
  const { waveCenterX, waveCenterY, waveAmplitude, waveFrequency, wavePhase } = item;
  const phaseRad = wavePhase * Math.PI / 180;

  // Draw wave preview
  ctx.strokeStyle = 'rgba(99,102,241,0.6)';
  ctx.beginPath();
  const waveStartX = 0;
  const waveEndX = ct.canvasW;
  for (let x = waveStartX; x <= waveEndX; x += 3) {
    const y = waveCenterY + waveAmplitude * Math.sin((x - waveCenterX) * waveFrequency + phaseRad);
    if (x === waveStartX) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Center handle
  drawHandle(ctx, waveCenterX, waveCenterY, 8, 'rgba(99,102,241,0.9)', 'Center');

  // Amplitude handle (up from center)
  const ampX = waveCenterX;
  const ampY = waveCenterY - waveAmplitude;
  drawHandle(ctx, ampX, ampY, 7, 'rgba(251,191,36,0.9)', 'Amplitude');

  // Frequency/phase handle
  const fpX = waveCenterX + 150;
  const fpY = waveCenterY + waveAmplitude * Math.sin((fpX - waveCenterX) * waveFrequency + phaseRad);
  drawHandle(ctx, fpX, fpY, 7, 'rgba(239,68,68,0.9)', 'Shape');
}

function drawHandle(ctx, x, y, radius, color, label) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // White border
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Label
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y - radius - 5);
  ctx.restore();
}

// ─── HIT TESTING ─────────────────────────────────────────────────────
function hitTestHandles(px, py) {
  if (ct.selectedIndex < 0 || ct.selectedIndex >= ct.items.length) return null;
  const item = ct.items[ct.selectedIndex];
  if (!item.visible) return null;

  const threshold = 12;

  if (item.mode === 'arc') {
    // Center
    if (dist(px, py, item.arcCx, item.arcCy) < threshold) return { handleKey: 'arcCenter' };
    // Radius handle
    const rAngle = item.arcStartAngle * Math.PI / 180;
    const rX = item.arcCx + item.arcRadius * Math.cos(rAngle);
    const rY = item.arcCy + item.arcRadius * Math.sin(rAngle);
    if (dist(px, py, rX, rY) < threshold) return { handleKey: 'arcRadius' };
    // Start angle handle
    const saAngle = (item.arcStartAngle + 30) * Math.PI / 180;
    const saX = item.arcCx + item.arcRadius * Math.cos(saAngle);
    const saY = item.arcCy + item.arcRadius * Math.sin(saAngle);
    if (dist(px, py, saX, saY) < threshold) return { handleKey: 'arcStartAngle' };
  } else if (item.mode === 'bezier') {
    if (dist(px, py, item.bezierP0.x, item.bezierP0.y) < threshold) return { handleKey: 'bezierP0' };
    if (dist(px, py, item.bezierP1.x, item.bezierP1.y) < threshold) return { handleKey: 'bezierP1' };
    if (dist(px, py, item.bezierP2.x, item.bezierP2.y) < threshold) return { handleKey: 'bezierP2' };
    if (dist(px, py, item.bezierP3.x, item.bezierP3.y) < threshold) return { handleKey: 'bezierP3' };
  } else if (item.mode === 'wave') {
    if (dist(px, py, item.waveCenterX, item.waveCenterY) < threshold) return { handleKey: 'waveCenter' };
    const ampY = item.waveCenterY - item.waveAmplitude;
    if (dist(px, py, item.waveCenterX, ampY) < threshold) return { handleKey: 'waveAmplitude' };
    const fpX = item.waveCenterX + 150;
    const phaseRad = item.wavePhase * Math.PI / 180;
    const fpY = item.waveCenterY + item.waveAmplitude * Math.sin((fpX - item.waveCenterX) * item.waveFrequency + phaseRad);
    if (dist(px, py, fpX, fpY) < threshold) return { handleKey: 'waveShape' };
  }

  return null;
}

function dist(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── OVERLAY POINTER EVENTS ──────────────────────────────────────────
function getCanvasPoint(e) {
  const rect = ct.overlayCanvas.getBoundingClientRect();
  const scaleX = ct.canvasW / rect.width;
  const scaleY = ct.canvasH / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function onPointerDown(e) {
  if (!ct.isActive) return;
  const pt = getCanvasPoint(e);
  const hit = hitTestHandles(pt.x, pt.y);
  if (hit) {
    ct.dragging = { handleKey: hit.handleKey, itemId: ct.items[ct.selectedIndex].id };
    ct.overlayCanvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
}

function onPointerMove(e) {
  if (!ct.dragging || !ct.isActive) return;

  const item = ct.items.find(i => i.id === ct.dragging.itemId);
  if (!item) return;

  const pt = getCanvasPoint(e);
  const key = ct.dragging.handleKey;

  if (key === 'arcCenter') {
    item.arcCx = pt.x;
    item.arcCy = pt.y;
  } else if (key === 'arcRadius') {
    const dx = pt.x - item.arcCx;
    const dy = pt.y - item.arcCy;
    item.arcRadius = Math.max(10, Math.sqrt(dx * dx + dy * dy));
    item.arcStartAngle = Math.atan2(dy, dx) * 180 / Math.PI;
  } else if (key === 'arcStartAngle') {
    const dx = pt.x - item.arcCx;
    const dy = pt.y - item.arcCy;
    item.arcStartAngle = Math.atan2(dy, dx) * 180 / Math.PI - 30;
  } else if (key.startsWith('bezierP')) {
    const ptKey = key.replace('bezier', 'b');
    const map = { bezierP0: 'bezierP0', bezierP1: 'bezierP1', bezierP2: 'bezierP2', bezierP3: 'bezierP3' };
    const prop = map[key];
    if (prop) item[prop] = { x: pt.x, y: pt.y };
  } else if (key === 'waveCenter') {
    item.waveCenterX = pt.x;
    item.waveCenterY = pt.y;
  } else if (key === 'waveAmplitude') {
    item.waveAmplitude = Math.max(0, item.waveCenterY - pt.y);
  } else if (key === 'waveShape') {
    const dx = pt.x - item.waveCenterX;
    const dy = pt.y - item.waveCenterY;
    if (dx > 0) {
      item.waveFrequency = Math.max(0.001, Math.min(0.05, dy / (dx * 50)));
    }
    const phaseRad = Math.atan2(dy, dx);
    item.wavePhase = phaseRad * 180 / Math.PI;
  }

  scheduleRender();
  syncSlidersFromItem(item);
}

function onPointerUp(e) {
  if (ct.dragging) {
    ct.overlayCanvas.releasePointerCapture(e.pointerId);
    ct.dragging = null;
  }
}

function scheduleRender() {
  if (ct.rafId) return;
  ct.rafId = requestAnimationFrame(() => {
    ct.rafId = null;
    renderAll();
  });
}

function bindOverlayEvents() {
  if (!ct.overlayCanvas) return;
  ct.overlayCanvas.addEventListener('pointerdown', onPointerDown);
  ct.overlayCanvas.addEventListener('pointermove', onPointerMove);
  ct.overlayCanvas.addEventListener('pointerup', onPointerUp);
  ct.overlayCanvas.addEventListener('pointercancel', onPointerUp);
}

function unbindOverlayEvents() {
  if (!ct.overlayCanvas) return;
  ct.overlayCanvas.removeEventListener('pointerdown', onPointerDown);
  ct.overlayCanvas.removeEventListener('pointermove', onPointerMove);
  ct.overlayCanvas.removeEventListener('pointerup', onPointerUp);
  ct.overlayCanvas.removeEventListener('pointercancel', onPointerUp);
}

// ─── UI BINDINGS ─────────────────────────────────────────────────────
let uiBound = false;

function bindUIEvents() {
  if (uiBound) return;
  uiBound = true;

  // Text input
  const textInput = document.querySelector('#ct-text');
  if (textInput) {
    let debounceTimer;
    textInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const item = selectedItem();
        if (item) {
          item.text = textInput.value;
          renderAll();
          updateItemLabel(item);
        }
      }, 50);
    });
  }

  // Path type selector
  document.querySelectorAll('.ct-path-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ct-path-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      ct.mode = mode;
      const item = selectedItem();
      if (item) {
        item.mode = mode;
        showModeSections(mode);
        renderAll();
        updateItemLabel(item);
      }
    });
  });

  // Font family
  const fontSelect = document.querySelector('#ct-font-family');
  if (fontSelect) {
    fontSelect.addEventListener('change', () => {
      const item = selectedItem();
      if (item) { item.fontFamily = fontSelect.value; renderAll(); }
    });
  }

  // Google font input
  const gfontInput = document.querySelector('#ct-google-font');
  if (gfontInput) {
    gfontInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const fontName = gfontInput.value.trim();
        if (fontName) {
          await loadGoogleFont(fontName);
          const item = selectedItem();
          if (item) { item.fontFamily = fontName; renderAll(); }
        }
      }
    });
  }

  // Font size
  const fontSize = document.querySelector('#ct-font-size');
  const fontSizeVal = document.querySelector('#ct-font-size-val');
  if (fontSize && fontSizeVal) {
    fontSize.addEventListener('input', () => {
      fontSizeVal.textContent = `${fontSize.value}px`;
      const item = selectedItem();
      if (item) { item.fontSize = Number(fontSize.value); renderAll(); }
    });
  }

  // Bold / Italic
  const fontBold = document.querySelector('#ct-font-bold');
  if (fontBold) {
    fontBold.addEventListener('change', () => {
      const item = selectedItem();
      if (item) { item.fontBold = fontBold.checked; renderAll(); }
    });
  }

  const fontItalic = document.querySelector('#ct-font-italic');
  if (fontItalic) {
    fontItalic.addEventListener('change', () => {
      const item = selectedItem();
      if (item) { item.fontItalic = fontItalic.checked; renderAll(); }
    });
  }

  // Letter spacing
  const letterSpacing = document.querySelector('#ct-letter-spacing');
  const letterSpacingVal = document.querySelector('#ct-letter-spacing-val');
  if (letterSpacing && letterSpacingVal) {
    letterSpacing.addEventListener('input', () => {
      letterSpacingVal.textContent = `${letterSpacing.value}px`;
      const item = selectedItem();
      if (item) { item.letterSpacing = Number(letterSpacing.value); renderAll(); }
    });
  }

  // Color
  const colorPicker = document.querySelector('#ct-color');
  if (colorPicker) {
    colorPicker.addEventListener('input', () => {
      const item = selectedItem();
      if (item) { item.color = colorPicker.value; renderAll(); }
    });
  }

  // Alignment
  document.querySelectorAll('.ct-align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ct-align-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const item = selectedItem();
      if (item) { item.alignment = btn.dataset.align; renderAll(); }
    });
  });

  // Arc side
  document.querySelectorAll('.ct-side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ct-side-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const item = selectedItem();
      if (item) { item.arcSide = btn.dataset.side; renderAll(); }
    });
  });

  // Arc radius slider
  const arcRadius = document.querySelector('#ct-arc-radius');
  const arcRadiusVal = document.querySelector('#ct-arc-radius-val');
  if (arcRadius && arcRadiusVal) {
    arcRadius.addEventListener('input', () => {
      arcRadiusVal.textContent = `${arcRadius.value}px`;
      const item = selectedItem();
      if (item) { item.arcRadius = Number(arcRadius.value); renderAll(); }
    });
  }

  // Arc start angle slider
  const arcAngle = document.querySelector('#ct-arc-angle');
  const arcAngleVal = document.querySelector('#ct-arc-angle-val');
  if (arcAngle && arcAngleVal) {
    arcAngle.addEventListener('input', () => {
      arcAngleVal.textContent = `${arcAngle.value}deg`;
      const item = selectedItem();
      if (item) { item.arcStartAngle = Number(arcAngle.value); renderAll(); }
    });
  }

  // Wave amplitude
  const waveAmp = document.querySelector('#ct-wave-amplitude');
  const waveAmpVal = document.querySelector('#ct-wave-amplitude-val');
  if (waveAmp && waveAmpVal) {
    waveAmp.addEventListener('input', () => {
      waveAmpVal.textContent = `${waveAmp.value}px`;
      const item = selectedItem();
      if (item) { item.waveAmplitude = Number(waveAmp.value); renderAll(); }
    });
  }

  // Wave frequency
  const waveFreq = document.querySelector('#ct-wave-frequency');
  const waveFreqVal = document.querySelector('#ct-wave-frequency-val');
  if (waveFreq && waveFreqVal) {
    waveFreq.addEventListener('input', () => {
      waveFreqVal.textContent = waveFreq.value;
      const item = selectedItem();
      if (item) { item.waveFrequency = Number(waveFreq.value); renderAll(); }
    });
  }

  // Wave phase
  const wavePhase = document.querySelector('#ct-wave-phase');
  const wavePhaseVal = document.querySelector('#ct-wave-phase-val');
  if (wavePhase && wavePhaseVal) {
    wavePhase.addEventListener('input', () => {
      wavePhaseVal.textContent = `${wavePhase.value}deg`;
      const item = selectedItem();
      if (item) { item.wavePhase = Number(wavePhase.value); renderAll(); }
    });
  }

  // Stroke enable
  const strokeEnable = document.querySelector('#ct-stroke-enable');
  if (strokeEnable) {
    strokeEnable.addEventListener('change', () => {
      const item = selectedItem();
      if (item) { item.strokeEnabled = strokeEnable.checked; renderAll(); }
    });
  }

  // Stroke color
  const strokeColor = document.querySelector('#ct-stroke-color');
  if (strokeColor) {
    strokeColor.addEventListener('input', () => {
      const item = selectedItem();
      if (item) { item.strokeColor = strokeColor.value; renderAll(); }
    });
  }

  // Stroke width
  const strokeWidth = document.querySelector('#ct-stroke-width');
  const strokeWidthVal = document.querySelector('#ct-stroke-width-val');
  if (strokeWidth && strokeWidthVal) {
    strokeWidth.addEventListener('input', () => {
      strokeWidthVal.textContent = `${strokeWidth.value}px`;
      const item = selectedItem();
      if (item) { item.strokeWidth = Number(strokeWidth.value); renderAll(); }
    });
  }

  // Shadow enable
  const shadowEnable = document.querySelector('#ct-shadow-enable');
  if (shadowEnable) {
    shadowEnable.addEventListener('change', () => {
      const item = selectedItem();
      if (item) { item.shadowEnabled = shadowEnable.checked; renderAll(); }
    });
  }

  // Shadow color
  const shadowColor = document.querySelector('#ct-shadow-color');
  if (shadowColor) {
    shadowColor.addEventListener('input', () => {
      const item = selectedItem();
      if (item) { item.shadowColor = shadowColor.value; renderAll(); }
    });
  }

  // Shadow blur
  const shadowBlur = document.querySelector('#ct-shadow-blur');
  const shadowBlurVal = document.querySelector('#ct-shadow-blur-val');
  if (shadowBlur && shadowBlurVal) {
    shadowBlur.addEventListener('input', () => {
      shadowBlurVal.textContent = `${shadowBlur.value}px`;
      const item = selectedItem();
      if (item) { item.shadowBlur = Number(shadowBlur.value); renderAll(); }
    });
  }

  // Shadow offset X
  const shadowOX = document.querySelector('#ct-shadow-ox');
  const shadowOXVal = document.querySelector('#ct-shadow-ox-val');
  if (shadowOX && shadowOXVal) {
    shadowOX.addEventListener('input', () => {
      shadowOXVal.textContent = `${shadowOX.value}px`;
      const item = selectedItem();
      if (item) { item.shadowOffsetX = Number(shadowOX.value); renderAll(); }
    });
  }

  // Shadow offset Y
  const shadowOY = document.querySelector('#ct-shadow-oy');
  const shadowOYVal = document.querySelector('#ct-shadow-oy-val');
  if (shadowOY && shadowOYVal) {
    shadowOY.addEventListener('input', () => {
      shadowOYVal.textContent = `${shadowOY.value}px`;
      const item = selectedItem();
      if (item) { item.shadowOffsetY = Number(shadowOY.value); renderAll(); }
    });
  }

  // Add item button
  const addBtn = document.querySelector('#ct-add-item');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      addItem();
    });
  }

  // Presets
  document.querySelectorAll('.ct-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyPreset(btn.dataset.preset);
    });
  });

  // Apply
  const applyBtn = document.querySelector('#ct-apply');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      apply();
      if (ct.commitBlobCallback) {
        exportAndCommit();
      }
    });
  }

  // Reset
  const resetBtn = document.querySelector('#ct-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetToDefault();
    });
  }
}

// ─── SYNC SLIDERS FROM ITEM ─────────────────────────────────────────
function syncSlidersFromItem(item) {
  if (!item) return;

  const set = (id, val) => { const el = document.querySelector(id); if (el) el.value = val; };
  const setOut = (id, val) => { const el = document.querySelector(id); if (el) el.textContent = val; };

  set('#ct-arc-radius', item.arcRadius);
  setOut('#ct-arc-radius-val', `${item.arcRadius}px`);
  set('#ct-arc-angle', item.arcStartAngle);
  setOut('#ct-arc-angle-val', `${item.arcStartAngle}deg`);
  set('#ct-wave-amplitude', item.waveAmplitude);
  setOut('#ct-wave-amplitude-val', `${item.waveAmplitude}px`);
  set('#ct-wave-frequency', item.waveFrequency);
  setOut('#ct-wave-frequency-val', item.waveFrequency);
  set('#ct-wave-phase', item.wavePhase);
  setOut('#ct-wave-phase-val', `${item.wavePhase}deg`);
}

// ─── SYNC UI FROM ITEM ──────────────────────────────────────────────
function syncUIFromItem(item) {
  if (!item) return;

  const setVal = (sel, val) => { const el = document.querySelector(sel); if (el) el.value = val; };
  const setCheck = (sel, val) => { const el = document.querySelector(sel); if (el) el.checked = val; };
  const setOut = (sel, val) => { const el = document.querySelector(sel); if (el) el.textContent = val; };

  setVal('#ct-text', item.text);
  setVal('#ct-font-family', item.fontFamily);
  setVal('#ct-font-size', item.fontSize);
  setOut('#ct-font-size-val', `${item.fontSize}px`);
  setCheck('#ct-font-bold', item.fontBold);
  setCheck('#ct-font-italic', item.fontItalic);
  setVal('#ct-letter-spacing', item.letterSpacing);
  setOut('#ct-letter-spacing-val', `${item.letterSpacing}px`);
  setVal('#ct-color', item.color);

  // Alignment
  document.querySelectorAll('.ct-align-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.align === item.alignment);
  });

  // Arc side
  document.querySelectorAll('.ct-side-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.side === item.arcSide);
  });

  // Path type
  document.querySelectorAll('.ct-path-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === item.mode);
  });
  showModeSections(item.mode);

  // Arc
  setVal('#ct-arc-radius', item.arcRadius);
  setOut('#ct-arc-radius-val', `${item.arcRadius}px`);
  setVal('#ct-arc-angle', item.arcStartAngle);
  setOut('#ct-arc-angle-val', `${item.arcStartAngle}deg`);

  // Wave
  setVal('#ct-wave-amplitude', item.waveAmplitude);
  setOut('#ct-wave-amplitude-val', `${item.waveAmplitude}px`);
  setVal('#ct-wave-frequency', item.waveFrequency);
  setOut('#ct-wave-frequency-val', item.waveFrequency);
  setVal('#ct-wave-phase', item.wavePhase);
  setOut('#ct-wave-phase-val', `${item.wavePhase}deg`);

  // Stroke
  setCheck('#ct-stroke-enable', item.strokeEnabled);
  setVal('#ct-stroke-color', item.strokeColor);
  setVal('#ct-stroke-width', item.strokeWidth);
  setOut('#ct-stroke-width-val', `${item.strokeWidth}px`);

  // Shadow
  setCheck('#ct-shadow-enable', item.shadowEnabled);
  setVal('#ct-shadow-color', item.shadowColor);
  setVal('#ct-shadow-blur', item.shadowBlur);
  setOut('#ct-shadow-blur-val', `${item.shadowBlur}px`);
  setVal('#ct-shadow-ox', item.shadowOffsetX);
  setOut('#ct-shadow-ox-val', `${item.shadowOffsetX}px`);
  setVal('#ct-shadow-oy', item.shadowOffsetY);
  setOut('#ct-shadow-oy-val', `${item.shadowOffsetY}px`);
}

// ─── MODE SECTIONS VISIBILITY ────────────────────────────────────────
function showModeSections(mode) {
  document.querySelectorAll('.ct-arc-only').forEach(el => el.classList.toggle('show', mode === 'arc'));
  document.querySelectorAll('.ct-bezier-only').forEach(el => el.classList.toggle('show', mode === 'bezier'));
  document.querySelectorAll('.ct-wave-only').forEach(el => el.classList.toggle('show', mode === 'wave'));
}

// ─── MULTI-ITEM SUPPORT ─────────────────────────────────────────────
function selectedItem() {
  if (ct.selectedIndex < 0 || ct.selectedIndex >= ct.items.length) return null;
  return ct.items[ct.selectedIndex];
}

function addItem() {
  const item = defaultItem();
  item.arcCx = ct.canvasW / 2;
  item.arcCy = ct.canvasH / 2;
  item.bezierP0 = { x: ct.canvasW * 0.15, y: ct.canvasH * 0.5 };
  item.bezierP1 = { x: ct.canvasW * 0.35, y: ct.canvasH * 0.2 };
  item.bezierP2 = { x: ct.canvasW * 0.65, y: ct.canvasH * 0.8 };
  item.bezierP3 = { x: ct.canvasW * 0.85, y: ct.canvasH * 0.5 };
  item.waveCenterX = ct.canvasW / 2;
  item.waveCenterY = ct.canvasH / 2;
  ct.items.push(item);
  ct.selectedIndex = ct.items.length - 1;
  rebuildItemList();
  syncUIFromItem(item);
  renderAll();
}

function deleteItem(index) {
  if (ct.items.length <= 1) return;
  ct.items.splice(index, 1);
  if (ct.selectedIndex >= ct.items.length) ct.selectedIndex = ct.items.length - 1;
  rebuildItemList();
  syncUIFromItem(selectedItem());
  renderAll();
}

function toggleItemVisibility(index) {
  ct.items[index].visible = !ct.items[index].visible;
  rebuildItemList();
  renderAll();
}

function selectItem(index) {
  ct.selectedIndex = index;
  rebuildItemList();
  syncUIFromItem(selectedItem());
  renderAll();
}

function updateItemLabel(item) {
  const el = document.querySelector(`.ct-item[data-id="${item.id}"] .ct-item-name`);
  if (el) {
    const label = item.text ? item.text.substring(0, 20) : 'Empty';
    el.textContent = label;
  }
  const sub = document.querySelector(`.ct-item[data-id="${item.id}"] .ct-item-sub`);
  if (sub) sub.textContent = item.mode;
}

function rebuildItemList() {
  const list = document.querySelector('#ct-item-list');
  if (!list) return;
  list.innerHTML = '';

  if (ct.items.length === 0) {
    list.innerHTML = '<div class="ct-item-empty">No text items</div>';
    return;
  }

  ct.items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'ct-item' + (i === ct.selectedIndex ? ' selected' : '');
    el.dataset.id = item.id;

    const label = item.text ? item.text.substring(0, 20) : 'Empty';
    el.innerHTML = `
      <div class="ct-item-icon">T</div>
      <div class="ct-item-info">
        <div class="ct-item-name">${escHtml(label)}</div>
        <div class="ct-item-sub">${item.mode}</div>
      </div>
      <div class="ct-item-actions">
        <button class="ct-item-btn ${item.visible ? 'visible' : ''}" data-action="visibility" data-index="${i}" title="Toggle visibility">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="ct-item-btn" data-action="delete" data-index="${i}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      selectItem(i);
    });

    const visBtn = el.querySelector('[data-action="visibility"]');
    if (visBtn) visBtn.addEventListener('click', () => toggleItemVisibility(i));

    const delBtn = el.querySelector('[data-action="delete"]');
    if (delBtn) delBtn.addEventListener('click', () => deleteItem(i));

    list.appendChild(el);
  });
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── PRESETS ─────────────────────────────────────────────────────────
function applyPreset(name) {
  const item = selectedItem();
  if (!item) return;

  switch (name) {
    case 'badge-top':
      item.mode = 'arc';
      item.arcSide = 'above';
      item.arcRadius = 200;
      item.alignment = 'center';
      item.fontFamily = 'Impact';
      item.fontSize = 48;
      item.fontBold = true;
      item.arcStartAngle = -90;
      break;
    case 'badge-bottom':
      item.mode = 'arc';
      item.arcSide = 'below';
      item.arcRadius = 200;
      item.alignment = 'center';
      item.fontFamily = 'Impact';
      item.fontSize = 48;
      item.fontBold = true;
      item.arcStartAngle = 90;
      break;
    case 'wavy-graffiti':
      item.mode = 'wave';
      item.waveAmplitude = 30;
      item.waveFrequency = 0.015;
      item.fontSize = 64;
      item.fontFamily = 'Impact';
      item.fontBold = true;
      item.waveCenterX = ct.canvasW / 2;
      item.waveCenterY = ct.canvasH / 2;
      break;
    case 'swoosh':
      item.mode = 'bezier';
      item.bezierP0 = { x: ct.canvasW * 0.1, y: ct.canvasH * 0.6 };
      item.bezierP1 = { x: ct.canvasW * 0.3, y: ct.canvasH * 0.2 };
      item.bezierP2 = { x: ct.canvasW * 0.7, y: ct.canvasH * 0.8 };
      item.bezierP3 = { x: ct.canvasW * 0.9, y: ct.canvasH * 0.4 };
      item.fontFamily = 'Arial';
      item.fontSize = 42;
      break;
    case 'circle-stamp':
      item.mode = 'arc';
      item.arcSide = 'above';
      item.arcRadius = 160;
      item.alignment = 'center';
      item.fontFamily = 'Impact';
      item.fontSize = 36;
      item.fontBold = true;
      item.arcStartAngle = -90;
      item.strokeEnabled = true;
      item.strokeWidth = 2;
      break;
  }

  syncUIFromItem(item);
  showModeSections(item.mode);
  renderAll();
  updateItemLabel(item);
}

// ─── RESET ───────────────────────────────────────────────────────────
function resetToDefault() {
  ct.items = [];
  const item = defaultItem();
  item.arcCx = ct.canvasW / 2;
  item.arcCy = ct.canvasH / 2;
  item.bezierP0 = { x: ct.canvasW * 0.15, y: ct.canvasH * 0.5 };
  item.bezierP1 = { x: ct.canvasW * 0.35, y: ct.canvasH * 0.2 };
  item.bezierP2 = { x: ct.canvasW * 0.65, y: ct.canvasH * 0.8 };
  item.bezierP3 = { x: ct.canvasW * 0.85, y: ct.canvasH * 0.5 };
  item.waveCenterX = ct.canvasW / 2;
  item.waveCenterY = ct.canvasH / 2;
  ct.items = [item];
  ct.selectedIndex = 0;
  rebuildItemList();
  syncUIFromItem(item);
  renderAll();
}

// ─── GOOGLE FONTS ────────────────────────────────────────────────────
async function loadGoogleFont(fontName) {
  const family = fontName.replace(/\s+/g, '+');
  if (ct.loadedFonts.has(family)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@400;700&display=swap`;
  document.head.appendChild(link);
  ct.loadedFonts.add(family);

  try {
    await document.fonts.ready;
  } catch (_) {
    // Fallback: wait a bit
    await new Promise(r => setTimeout(r, 500));
  }
}

// ─── EXPORT ──────────────────────────────────────────────────────────
async function exportAndCommit() {
  if (!ct.commitBlobCallback || !ct.baseCanvas) return;

  // Base canvas already has text flattened by apply()
  try {
    const blob = await new Promise((resolve, reject) => {
      ct.baseCanvas.toBlob(b => b ? resolve(b) : reject(new Error('Export failed')), 'image/png');
    });
    ct.commitBlobCallback(blob, 'Curved Text', 'curved-text.png');
  } catch (err) {
    console.error('Curved text export failed:', err);
  }
}

// ─── SET COMMIT CALLBACK ─────────────────────────────────────────────
export function setCommitBlobCallback(fn) {
  ct.commitBlobCallback = fn;
}
