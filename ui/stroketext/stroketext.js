// Stroke Text Effect Module
// Full-featured outlined/stroke text with fill, glow, shadow, and decorative effects
// Uses layered canvas architecture: base + text preview + UI overlay

// ─── STATE ───────────────────────────────────────────────────────────
const st = {
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
  // Interaction state
  dragging: null,       // 'text' | 'rotate' | null
  dragStart: null,      // {x, y} in canvas coords
  itemStart: null,      // snapshot of item pos/rot at drag start
  // Cached bounding box (recomputed on text/font/size change)
  cachedBounds: null,
};

// ─── DEFAULT STYLE ───────────────────────────────────────────────────
function defaultStyle() {
  return {
    // Text content
    text: 'Stroke Text',
    fontFamily: 'Inter',
    fontSize: 72,
    fontBold: true,
    fontItalic: false,
    textAlign: 'center',
    // Position
    x: 0,
    y: 0,
    rotation: 0,       // degrees
    maxWidth: 0,       // 0 = no wrap
    lineHeight: 1.2,
    // Fill
    fillType: 'solid', // 'solid' | 'linear' | 'radial' | 'none'
    fillColor: '#ffffff',
    fillOpacity: 100,
    gradColor1: '#ffffff',
    gradColor2: '#333333',
    gradAngle: 0,      // degrees for linear gradient
    // Stroke
    strokeEnabled: true,
    strokeColor: '#000000',
    strokeWidth: 3,
    strokeOpacity: 100,
    strokePosition: 'outside', // 'outside' | 'center' | 'inside'
    lineJoin: 'round',
    // Double stroke
    doubleStrokeEnabled: false,
    doubleStrokeColor: '#ff6b35',
    doubleStrokeWidth: 6,
    // Outer glow
    glowEnabled: false,
    glowColor: '#00ffff',
    glowBlur: 20,
    glowOpacity: 80,
    glowLayers: 3,
    // Drop shadow
    shadowEnabled: false,
    shadowColor: 'rgba(0,0,0,0.6)',
    shadowBlur: 15,
    shadowOffsetX: 5,
    shadowOffsetY: 8,
    // Inner shadow
    innerShadowEnabled: false,
    innerShadowColor: 'rgba(0,0,0,0.4)',
    innerShadowBlur: 5,
    innerShadowOffsetX: 2,
    innerShadowOffsetY: 2,
    // Master opacity
    masterOpacity: 100,
  };
}

// ─── INIT / DESTROY ──────────────────────────────────────────────────
export function init(imgElement, getOriginalImageData, pushToUndoStack) {
  st.getOriginalImageData = getOriginalImageData;
  st.pushToUndoStack = pushToUndoStack;
  st.sourceImg = imgElement;

  const parent = imgElement.parentElement;
  st.canvasW = imgElement.naturalWidth || imgElement.width;
  st.canvasH = imgElement.naturalHeight || imgElement.height;

  // Create base canvas from image
  st.baseCanvas = document.createElement('canvas');
  st.baseCanvas.width = st.canvasW;
  st.baseCanvas.height = st.canvasH;
  st.baseCanvas.className = 'st-base-canvas';
  st.baseCtx = st.baseCanvas.getContext('2d');
  st.baseCtx.drawImage(imgElement, 0, 0, st.canvasW, st.canvasH);

  // Create text preview canvas
  st.textCanvas = document.createElement('canvas');
  st.textCanvas.width = st.canvasW;
  st.textCanvas.height = st.canvasH;
  st.textCanvas.className = 'st-text-canvas';
  st.textCtx = st.textCanvas.getContext('2d');

  // Create overlay canvas
  st.overlayCanvas = document.createElement('canvas');
  st.overlayCanvas.width = st.canvasW;
  st.overlayCanvas.height = st.canvasH;
  st.overlayCanvas.className = 'st-overlay-canvas';
  st.overlayCtx = st.overlayCanvas.getContext('2d');

  // Build canvas stack
  const stack = document.createElement('div');
  stack.className = 'st-canvas-stack';
  stack.appendChild(st.baseCanvas);
  stack.appendChild(st.textCanvas);
  stack.appendChild(st.overlayCanvas);

  // Hide original image and insert stack
  imgElement.style.display = 'none';
  parent.appendChild(stack);

  st.isActive = true;

  // Default item centered on the canvas
  st.style = defaultStyle();
  st.style.x = st.canvasW / 2;
  st.style.y = st.canvasH / 2;

  bindOverlayEvents();
  bindUIEvents();
  invalidateBounds();
  renderAll();
  buildPresetThumbnails();
}

export function destroy() {
  if (!st.isActive) return;
  st.isActive = false;

  cancelAnimationFrame(st.rafId);
  unbindOverlayEvents();

  const stack = st.overlayCanvas?.parentElement;
  if (stack) stack.remove();

  if (st.sourceImg) st.sourceImg.style.display = '';

  st.baseCanvas = null;
  st.baseCtx = null;
  st.textCanvas = null;
  st.overlayCanvas = null;
  st.textCtx = null;
  st.overlayCtx = null;
  st.sourceImg = null;
  st.style = null;
  st.dragging = null;
  st.cachedBounds = null;
}

// ─── APPLY (flatten to base) ─────────────────────────────────────────
export function apply() {
  if (!st.isActive || !st.baseCanvas || !st.textCanvas) return;
  st.baseCtx.clearRect(0, 0, st.canvasW, st.canvasH);
  st.baseCtx.drawImage(st.sourceImg, 0, 0, st.canvasW, st.canvasH);
  st.baseCtx.drawImage(st.textCanvas, 0, 0);
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
  const s = st.style;
  const style = s.fontItalic ? 'italic ' : '';
  const weight = s.fontBold ? 'bold ' : '';
  return `${style}${weight}${s.fontSize}px "${s.fontFamily}"`;
}

function computeBounds() {
  const ctx = st.textCtx;
  const s = st.style;
  ctx.save();
  ctx.font = buildFontString();
  const maxWidth = s.maxWidth > 0 ? s.maxWidth : st.canvasW;
  const lines = wrapText(ctx, s.text || '', maxWidth);
  const lineH = s.fontSize * s.lineHeight;
  let maxW = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
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
  if (!st.cachedBounds) st.cachedBounds = computeBounds();
  return st.cachedBounds;
}

function invalidateBounds() {
  st.cachedBounds = null;
}

// ─── CORE RENDERING ──────────────────────────────────────────────────
function clearTextCanvas() {
  if (st.textCtx) st.textCtx.clearRect(0, 0, st.canvasW, st.canvasH);
}

function renderAll() {
  if (!st.isActive) return;
  clearTextCanvas();
  const s = st.style;
  if (!s.text) { renderOverlay(); return; }

  const ctx = st.textCtx;
  const bounds = getBounds();

  ctx.save();
  ctx.globalAlpha = s.masterOpacity / 100;

  // Rotation pivot at the anchor point (x, y)
  const pivotX = s.x;
  const pivotY = s.y;
  ctx.translate(pivotX, pivotY);
  ctx.rotate(s.rotation * Math.PI / 180);
  ctx.translate(-pivotX, -pivotY);

  // Render layers in order
  renderStyledTextLayers(ctx, bounds);

  ctx.restore();
  renderOverlay();
}

function renderStyledTextLayers(ctx, bounds) {
  const s = st.style;
  const fontStr = buildFontString();
  const { lines, lineH } = bounds;

  ctx.font = fontStr;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = s.textAlign;
  ctx.lineJoin = s.lineJoin;
  ctx.miterLimit = 2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineX = s.x;
    const lineY = bounds.y + (i + 1) * lineH - lineH * 0.15;

    // 1. Drop shadow (behind everything)
    if (s.shadowEnabled) {
      ctx.save();
      ctx.font = fontStr;
      ctx.textAlign = s.textAlign;
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = s.lineJoin;
      ctx.miterLimit = 2;
      ctx.shadowColor = s.shadowColor;
      ctx.shadowBlur = s.shadowBlur;
      ctx.shadowOffsetX = s.shadowOffsetX;
      ctx.shadowOffsetY = s.shadowOffsetY;
      ctx.fillStyle = s.fillType !== 'none' ? (s.fillType === 'solid' ? s.fillColor : s.gradColor1) : s.shadowColor;
      ctx.fillText(line, lineX, lineY);
      ctx.restore();
    }

    // 2. Outer glow (multiple stroke layers)
    if (s.glowEnabled && s.strokeEnabled) {
      renderGlowLine(ctx, line, lineX, lineY, s);
      ctx.font = fontStr;
      ctx.textAlign = s.textAlign;
      ctx.lineJoin = s.lineJoin;
      ctx.miterLimit = 2;
    }

    // 3. Double stroke (outer stroke first)
    if (s.doubleStrokeEnabled && s.strokeEnabled) {
      ctx.save();
      ctx.strokeStyle = s.doubleStrokeColor;
      ctx.lineWidth = s.doubleStrokeWidth;
      ctx.lineJoin = s.lineJoin;
      ctx.miterLimit = 2;
      ctx.globalAlpha = (s.masterOpacity / 100) * 0.01;
      if (s.strokePosition === 'outside') {
        ctx.lineWidth = s.strokeWidth * 2 + s.doubleStrokeWidth * 2;
      }
      ctx.strokeText(line, lineX, lineY);
      ctx.restore();
      ctx.font = fontStr;
      ctx.textAlign = s.textAlign;
    }

    // 4. Main stroke
    if (s.strokeEnabled && s.strokeWidth > 0) {
      ctx.save();
      ctx.strokeStyle = s.strokeColor;
      ctx.lineWidth = s.strokeWidth;
      ctx.lineJoin = s.lineJoin;
      ctx.miterLimit = 2;
      ctx.globalAlpha = (s.masterOpacity / 100) * (s.strokeOpacity / 100);
      if (s.strokePosition === 'outside') {
        ctx.lineWidth = s.strokeWidth * 2;
      }
      ctx.strokeText(line, lineX, lineY);
      ctx.restore();
      ctx.font = fontStr;
      ctx.textAlign = s.textAlign;
    }

    // 5. Inner shadow (composited inside fill)
    if (s.innerShadowEnabled) {
      renderInnerShadowLine(ctx, line, lineX, lineY, s);
      ctx.font = fontStr;
      ctx.textAlign = s.textAlign;
      ctx.lineJoin = s.lineJoin;
      ctx.miterLimit = 2;
    }

    // 6. Fill
    if (s.fillType !== 'none') {
      ctx.save();
      ctx.globalAlpha = (s.masterOpacity / 100) * (s.fillOpacity / 100);
      ctx.fillStyle = getFillStyle(ctx, lineX, lineY, s);
      ctx.fillText(line, lineX, lineY);
      ctx.restore();
      ctx.font = fontStr;
      ctx.textAlign = s.textAlign;
    }
  }
}

function getFillStyle(ctx, x, y, s) {
  if (s.fillType === 'solid') return s.fillColor;
  if (s.fillType === 'linear') {
    const rad = s.gradAngle * Math.PI / 180;
    const r = 200;
    const g = ctx.createLinearGradient(
      x - r * Math.cos(rad), y - r * Math.sin(rad),
      x + r * Math.cos(rad), y + r * Math.sin(rad)
    );
    g.addColorStop(0, s.gradColor1);
    g.addColorStop(1, s.gradColor2);
    return g;
  }
  if (s.fillType === 'radial') {
    const g = ctx.createRadialGradient(x, y - s.fontSize * 0.3, 0, x, y, s.fontSize);
    g.addColorStop(0, s.gradColor1);
    g.addColorStop(1, s.gradColor2);
    return g;
  }
  return s.fillColor;
}

function renderGlowLine(ctx, line, x, y, s) {
  const layers = Math.max(1, s.glowLayers);
  for (let i = layers; i >= 1; i--) {
    ctx.save();
    ctx.shadowColor = s.glowColor;
    ctx.shadowBlur = s.glowBlur * (i / layers);
    ctx.strokeStyle = s.glowColor;
    ctx.lineWidth = s.strokeWidth * 0.5;
    ctx.globalAlpha = (s.masterOpacity / 100) * (s.glowOpacity / 100) / layers;
    ctx.lineJoin = s.lineJoin;
    ctx.miterLimit = 2;
    ctx.strokeText(line, x, y);
    ctx.restore();
  }
}

function renderInnerShadowLine(ctx, line, x, y, s) {
  // Simulate inner shadow using offscreen canvas compositing
  let tempCanvas, tempCtx;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      tempCanvas = new OffscreenCanvas(st.canvasW, st.canvasH);
    } else {
      tempCanvas = document.createElement('canvas');
      tempCanvas.width = st.canvasW;
      tempCanvas.height = st.canvasH;
    }
  } catch (e) {
    tempCanvas = document.createElement('canvas');
    tempCanvas.width = st.canvasW;
    tempCanvas.height = st.canvasH;
  }
  tempCtx = tempCanvas.getContext('2d');

  // Draw the filled text shape as a mask
  tempCtx.font = buildFontString();
  tempCtx.textAlign = s.textAlign;
  tempCtx.textBaseline = 'alphabetic';
  tempCtx.fillStyle = '#000';
  tempCtx.fillText(line, x, y);

  // Draw a slightly offset, blurred inverted version
  tempCtx.globalCompositeOperation = 'source-in';
  tempCtx.save();
  tempCtx.shadowColor = s.innerShadowColor;
  tempCtx.shadowBlur = s.innerShadowBlur;
  tempCtx.shadowOffsetX = s.innerShadowOffsetX;
  tempCtx.shadowOffsetY = s.innerShadowOffsetY;
  tempCtx.fillStyle = '#000';
  tempCtx.fillRect(0, 0, st.canvasW, st.canvasH);
  tempCtx.restore();

  // Composite onto main text canvas
  ctx.save();
  ctx.globalAlpha = (s.masterOpacity / 100) * 0.6;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.drawImage(tempCanvas, 0, 0);
  ctx.restore();
}

// ─── OVERLAY RENDERING ──────────────────────────────────────────────
function renderOverlay() {
  const ctx = st.overlayCtx;
  ctx.clearRect(0, 0, st.canvasW, st.canvasH);
  if (!st.style || !st.style.text) return;

  const bounds = getBounds();
  const s = st.style;

  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rotation * Math.PI / 180);
  ctx.translate(-s.x, -s.y);

  // Dashed bounding box
  const pad = 8;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(99,102,241,0.7)';
  ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);

  // Corner handles
  ctx.setLineDash([]);
  const corners = [
    [bounds.x - pad, bounds.y - pad],
    [bounds.x + bounds.w + pad, bounds.y - pad],
    [bounds.x - pad, bounds.y + bounds.h + pad],
    [bounds.x + bounds.w + pad, bounds.y + bounds.h + pad],
  ];
  for (const [cx, cy] of corners) {
    ctx.fillStyle = 'rgba(99,102,241,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
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

  // Rotation label
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(s.rotation)}°`, rotHandleX, rotHandleY - 10);

  ctx.restore();
}

// ─── HIT TESTING ─────────────────────────────────────────────────────
function getCanvasPoint(e) {
  const rect = st.overlayCanvas.getBoundingClientRect();
  const scaleX = st.canvasW / rect.width;
  const scaleY = st.canvasH / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function hitTest(px, py) {
  if (!st.style || !st.style.text) return null;
  const bounds = getBounds();
  const s = st.style;
  const pad = 8;

  // Transform point to local coords (inverse rotation)
  const rad = -s.rotation * Math.PI / 180;
  const dx = px - s.x;
  const dy = py - s.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad) + s.x;
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad) + s.y;

  // Rotation handle
  const rotHandleX = bounds.x + bounds.w / 2;
  const rotHandleY = bounds.y - pad - 30;
  if (Math.hypot(lx - rotHandleX, ly - rotHandleY) < 12) return 'rotate';

  // Bounding box interior
  if (lx >= bounds.x - pad && lx <= bounds.x + bounds.w + pad &&
      ly >= bounds.y - pad && ly <= bounds.y + bounds.h + pad) return 'text';

  return null;
}

// ─── OVERLAY POINTER EVENTS ──────────────────────────────────────────
function onPointerDown(e) {
  if (!st.isActive) return;
  const pt = getCanvasPoint(e);
  const hit = hitTest(pt.x, pt.y);
  if (hit) {
    st.dragging = hit;
    st.dragStart = { x: pt.x, y: pt.y };
    st.itemStart = { x: st.style.x, y: st.style.y, rotation: st.style.rotation };
    st.overlayCanvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
}

function onPointerMove(e) {
  if (!st.dragging || !st.isActive) return;
  const pt = getCanvasPoint(e);

  if (st.dragging === 'text') {
    st.style.x = st.itemStart.x + (pt.x - st.dragStart.x);
    st.style.y = st.itemStart.y + (pt.y - st.dragStart.y);
    syncPositionInputs();
  } else if (st.dragging === 'rotate') {
    const dx = pt.x - st.style.x;
    const dy = pt.y - st.style.y;
    st.style.rotation = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    syncRotationSlider();
  }

  scheduleRender();
}

function onPointerUp(e) {
  if (st.dragging) {
    st.overlayCanvas.releasePointerCapture(e.pointerId);
    st.dragging = null;
  }
}

function scheduleRender() {
  if (st.rafId) return;
  st.rafId = requestAnimationFrame(() => {
    st.rafId = null;
    invalidateBounds();
    renderAll();
  });
}

function bindOverlayEvents() {
  if (!st.overlayCanvas) return;
  st.overlayCanvas.addEventListener('pointerdown', onPointerDown);
  st.overlayCanvas.addEventListener('pointermove', onPointerMove);
  st.overlayCanvas.addEventListener('pointerup', onPointerUp);
  st.overlayCanvas.addEventListener('pointercancel', onPointerUp);
}

function unbindOverlayEvents() {
  if (!st.overlayCanvas) return;
  st.overlayCanvas.removeEventListener('pointerdown', onPointerDown);
  st.overlayCanvas.removeEventListener('pointermove', onPointerMove);
  st.overlayCanvas.removeEventListener('pointerup', onPointerUp);
  st.overlayCanvas.removeEventListener('pointercancel', onPointerUp);
}

// ─── UI SYNC HELPERS ─────────────────────────────────────────────────
function syncPositionInputs() {
  setVal('#st-x', Math.round(st.style.x));
  setVal('#st-y', Math.round(st.style.y));
}

function syncRotationSlider() {
  setVal('#st-rotation', Math.round(st.style.rotation));
  setOut('#st-rotation-val', `${Math.round(st.style.rotation)}°`);
}

function setVal(sel, val) { const el = document.querySelector(sel); if (el) el.value = val; }
function setOut(sel, val) { const el = document.querySelector(sel); if (el) el.textContent = val; }
function setCheck(sel, val) { const el = document.querySelector(sel); if (el) el.checked = val; }

// ─── UI BINDINGS ─────────────────────────────────────────────────────
let uiBound = false;

function bindUIEvents() {
  if (uiBound) return;
  uiBound = true;

  // Text input (debounced)
  const textInput = document.querySelector('#st-text');
  if (textInput) {
    let timer;
    textInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        st.style.text = textInput.value;
        invalidateBounds();
        renderAll();
      }, 30);
    });
  }

  // Font family
  const fontSelect = document.querySelector('#st-font-family');
  if (fontSelect) {
    fontSelect.addEventListener('change', () => {
      st.style.fontFamily = fontSelect.value;
      invalidateBounds();
      renderAll();
    });
  }

  // Google font input
  const gfontInput = document.querySelector('#st-google-font');
  if (gfontInput) {
    gfontInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const fontName = gfontInput.value.trim();
        if (fontName) {
          await loadGoogleFont(fontName);
          st.style.fontFamily = fontName;
          invalidateBounds();
          renderAll();
        }
      }
    });
  }

  // Font size
  bindSlider('#st-font-size', '#st-font-size-val', v => { st.style.fontSize = Number(v); invalidateBounds(); }, 'px');

  // Bold / Italic
  bindCheck('#st-font-bold', v => { st.style.fontBold = v; invalidateBounds(); });
  bindCheck('#st-font-italic', v => { st.style.fontItalic = v; invalidateBounds(); });

  // Text align
  document.querySelectorAll('.st-align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.st-align-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      st.style.textAlign = btn.dataset.align;
      invalidateBounds();
      renderAll();
    });
  });

  // Position X / Y
  const xInput = document.querySelector('#st-x');
  if (xInput) xInput.addEventListener('change', () => { st.style.x = Number(xInput.value); invalidateBounds(); renderAll(); });
  const yInput = document.querySelector('#st-y');
  if (yInput) yInput.addEventListener('change', () => { st.style.y = Number(yInput.value); invalidateBounds(); renderAll(); });

  // Rotation
  bindSlider('#st-rotation', '#st-rotation-val', v => { st.style.rotation = Number(v); }, '°');

  // Max width (word wrap)
  bindSlider('#st-max-width', '#st-max-width-val', v => { st.style.maxWidth = Number(v); invalidateBounds(); }, 'px');

  // Line height
  bindSlider('#st-line-height', '#st-line-height-val', v => { st.style.lineHeight = Number(v); invalidateBounds(); }, 'x', 0.01);

  // ── FILL TAB ──
  // Fill type
  document.querySelectorAll('.st-fill-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.st-fill-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      st.style.fillType = btn.dataset.filltype;
      showFillSections(st.style.fillType);
      renderAll();
    });
  });

  bindColor('#st-fill-color', v => { st.style.fillColor = v; renderAll(); });
  bindSlider('#st-fill-opacity', '#st-fill-opacity-val', v => { st.style.fillOpacity = Number(v); }, '%');
  bindColor('#st-grad-color1', v => { st.style.gradColor1 = v; renderAll(); });
  bindColor('#st-grad-color2', v => { st.style.gradColor2 = v; renderAll(); });
  bindSlider('#st-grad-angle', '#st-grad-angle-val', v => { st.style.gradAngle = Number(v); }, '°');

  // ── STROKE TAB ──
  bindCheck('#st-stroke-enable', v => { st.style.strokeEnabled = v; renderAll(); });
  bindColor('#st-stroke-color', v => { st.style.strokeColor = v; renderAll(); });
  bindSlider('#st-stroke-width', '#st-stroke-width-val', v => { st.style.strokeWidth = Number(v); }, 'px');
  bindSlider('#st-stroke-opacity', '#st-stroke-opacity-val', v => { st.style.strokeOpacity = Number(v); }, '%');

  // Stroke position
  document.querySelectorAll('.st-stroke-pos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.st-stroke-pos-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      st.style.strokePosition = btn.dataset.pos;
      renderAll();
    });
  });

  // Line join
  document.querySelectorAll('.st-join-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.st-join-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      st.style.lineJoin = btn.dataset.join;
      renderAll();
    });
  });

  // Double stroke
  bindCheck('#st-double-stroke-enable', v => { st.style.doubleStrokeEnabled = v; renderAll(); });
  bindColor('#st-double-stroke-color', v => { st.style.doubleStrokeColor = v; renderAll(); });
  bindSlider('#st-double-stroke-width', '#st-double-stroke-width-val', v => { st.style.doubleStrokeWidth = Number(v); }, 'px');

  // ── GLOW / SHADOW TAB ──
  bindCheck('#st-glow-enable', v => { st.style.glowEnabled = v; renderAll(); });
  bindColor('#st-glow-color', v => { st.style.glowColor = v; renderAll(); });
  bindSlider('#st-glow-blur', '#st-glow-blur-val', v => { st.style.glowBlur = Number(v); }, 'px');
  bindSlider('#st-glow-opacity', '#st-glow-opacity-val', v => { st.style.glowOpacity = Number(v); }, '%');
  bindSlider('#st-glow-layers', '#st-glow-layers-val', v => { st.style.glowLayers = Number(v); }, '');

  bindCheck('#st-shadow-enable', v => { st.style.shadowEnabled = v; renderAll(); });
  bindColor('#st-shadow-color', v => { st.style.shadowColor = v; renderAll(); });
  bindSlider('#st-shadow-blur', '#st-shadow-blur-val', v => { st.style.shadowBlur = Number(v); }, 'px');
  bindSlider('#st-shadow-ox', '#st-shadow-ox-val', v => { st.style.shadowOffsetX = Number(v); }, 'px');
  bindSlider('#st-shadow-oy', '#st-shadow-oy-val', v => { st.style.shadowOffsetY = Number(v); }, 'px');

  bindCheck('#st-inner-shadow-enable', v => { st.style.innerShadowEnabled = v; renderAll(); });
  bindColor('#st-inner-shadow-color', v => { st.style.innerShadowColor = v; renderAll(); });
  bindSlider('#st-inner-shadow-blur', '#st-inner-shadow-blur-val', v => { st.style.innerShadowBlur = Number(v); }, 'px');
  bindSlider('#st-inner-shadow-ox', '#st-inner-shadow-ox-val', v => { st.style.innerShadowOffsetX = Number(v); }, 'px');
  bindSlider('#st-inner-shadow-oy', '#st-inner-shadow-oy-val', v => { st.style.innerShadowOffsetY = Number(v); }, 'px');

  // Master opacity
  bindSlider('#st-master-opacity', '#st-master-opacity-val', v => { st.style.masterOpacity = Number(v); }, '%');

  // Preset cards
  document.querySelectorAll('.st-preset-card').forEach(card => {
    card.addEventListener('click', () => applyPreset(card.dataset.preset));
  });

  // Tab switching
  document.querySelectorAll('.st-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.st-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.st-tab-panel').forEach(p => p.classList.remove('active'));
      const panel = document.querySelector(`.st-tab-panel[data-tab="${btn.dataset.tab}"]`);
      if (panel) panel.classList.add('active');
    });
  });

  // Apply / Reset
  const applyBtn = document.querySelector('#st-apply');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      apply();
      if (st.commitBlobCallback) exportAndCommit();
    });
  }

  const resetBtn = document.querySelector('#st-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetToDefault);
  }
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

function showFillSections(type) {
  document.querySelectorAll('.st-solid-only').forEach(el => el.style.display = type === 'solid' ? '' : 'none');
  document.querySelectorAll('.st-grad-only').forEach(el => el.style.display = (type === 'linear' || type === 'radial') ? '' : 'none');
}

// ─── PRESETS ─────────────────────────────────────────────────────────
const PRESETS = {
  'classic-outline': {
    fillColor: '#ffffff', fillType: 'solid', fillOpacity: 100,
    strokeEnabled: true, strokeColor: '#000000', strokeWidth: 3, strokeOpacity: 100, strokePosition: 'outside',
    doubleStrokeEnabled: false, glowEnabled: false, shadowEnabled: false, innerShadowEnabled: false,
    fontBold: true, fontSize: 72,
  },
  'neon-sign': {
    fillColor: '#ffffff', fillType: 'solid', fillOpacity: 100,
    strokeEnabled: true, strokeColor: '#00ffff', strokeWidth: 2, strokeOpacity: 100, strokePosition: 'center',
    glowEnabled: true, glowColor: '#00ffff', glowBlur: 20, glowOpacity: 80, glowLayers: 3,
    doubleStrokeEnabled: false, shadowEnabled: false, innerShadowEnabled: false,
    fontBold: true, fontSize: 72,
  },
  'retro-chrome': {
    fillColor: '#c0c0c0', fillType: 'linear', fillOpacity: 100,
    gradColor1: '#a0a0a0', gradColor2: '#ffffff', gradAngle: 90,
    strokeEnabled: true, strokeColor: '#333333', strokeWidth: 4, strokeOpacity: 100, strokePosition: 'outside',
    shadowEnabled: true, shadowColor: 'rgba(0,0,0,0.8)', shadowBlur: 8, shadowOffsetX: 3, shadowOffsetY: 3,
    doubleStrokeEnabled: false, glowEnabled: false, innerShadowEnabled: false,
    fontBold: true, fontSize: 72,
  },
  'knockout': {
    fillColor: '#ffffff', fillType: 'none', fillOpacity: 100,
    strokeEnabled: true, strokeColor: '#ffffff', strokeWidth: 2, strokeOpacity: 100, strokePosition: 'center',
    doubleStrokeEnabled: false, glowEnabled: false, shadowEnabled: false, innerShadowEnabled: false,
    fontBold: true, fontSize: 72,
  },
  'double-stroke': {
    fillColor: '#ffffff', fillType: 'solid', fillOpacity: 100,
    strokeEnabled: true, strokeColor: '#000000', strokeWidth: 2, strokeOpacity: 100, strokePosition: 'center',
    doubleStrokeEnabled: true, doubleStrokeColor: '#ff6b35', doubleStrokeWidth: 6,
    glowEnabled: false, shadowEnabled: false, innerShadowEnabled: false,
    fontBold: true, fontSize: 72,
  },
  'comic-book': {
    fillColor: '#ffe135', fillType: 'solid', fillOpacity: 100,
    strokeEnabled: true, strokeColor: '#1a1a1a', strokeWidth: 5, strokeOpacity: 100, strokePosition: 'outside',
    shadowEnabled: true, shadowColor: '#1a1a1a', shadowBlur: 0, shadowOffsetX: 4, shadowOffsetY: 4,
    doubleStrokeEnabled: false, glowEnabled: false, innerShadowEnabled: false,
    fontBold: true, fontSize: 72,
  },
  'soft-shadow': {
    fillColor: '#ffffff', fillType: 'solid', fillOpacity: 100,
    strokeEnabled: false,
    shadowEnabled: true, shadowColor: 'rgba(0,0,0,0.6)', shadowBlur: 15, shadowOffsetX: 5, shadowOffsetY: 8,
    doubleStrokeEnabled: false, glowEnabled: false, innerShadowEnabled: false,
    fontBold: false, fontSize: 72,
  },
  'emboss': {
    fillColor: 'rgba(255,255,255,0.15)', fillType: 'solid', fillOpacity: 100,
    strokeEnabled: true, strokeColor: 'rgba(255,255,255,0.5)', strokeWidth: 1, strokeOpacity: 50, strokePosition: 'center',
    innerShadowEnabled: true, innerShadowColor: 'rgba(0,0,0,0.3)', innerShadowBlur: 2, innerShadowOffsetX: 1, innerShadowOffsetY: 1,
    doubleStrokeEnabled: false, glowEnabled: false, shadowEnabled: false,
    fontBold: true, fontSize: 72,
  },
  'vintage-stamp': {
    fillColor: '#8B0000', fillType: 'solid', fillOpacity: 80,
    strokeEnabled: true, strokeColor: '#8B0000', strokeWidth: 2, strokeOpacity: 80, strokePosition: 'center',
    doubleStrokeEnabled: false, glowEnabled: false, shadowEnabled: false, innerShadowEnabled: false,
    fontFamily: 'Georgia', fontBold: true, fontSize: 72,
  },
  'glassmorphism': {
    fillColor: 'rgba(255,255,255,0.15)', fillType: 'solid', fillOpacity: 100,
    strokeEnabled: true, strokeColor: 'rgba(255,255,255,0.4)', strokeWidth: 1, strokeOpacity: 100, strokePosition: 'center',
    glowEnabled: true, glowColor: 'rgba(255,255,255,0.3)', glowBlur: 15, glowOpacity: 50, glowLayers: 2,
    doubleStrokeEnabled: false, shadowEnabled: false, innerShadowEnabled: false,
    fontBold: false, fontSize: 72,
  },
};

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  Object.assign(st.style, preset);
  syncUIFromStyle();
  invalidateBounds();
  renderAll();
}

function buildPresetThumbnails() {
  document.querySelectorAll('.st-preset-card').forEach(card => {
    const name = card.dataset.preset;
    const preset = PRESETS[name];
    if (!preset) return;
    const thumb = card.querySelector('.st-preset-thumb');
    if (!thumb) return;
    const tc = document.createElement('canvas');
    tc.width = 80;
    tc.height = 40;
    const tctx = tc.getContext('2d');

    // Dark background
    tctx.fillStyle = '#1a1f25';
    tctx.fillRect(0, 0, 80, 40);

    // Apply preset to temp rendering
    tctx.font = `bold 18px Inter, sans-serif`;
    tctx.textAlign = 'center';
    tctx.textBaseline = 'middle';
    tctx.lineJoin = 'round';
    tctx.miterLimit = 2;

    const tx = 40, ty = 20;
    const origStyle = st.style;
    const tempStyle = { ...origStyle, ...preset, x: tx, y: ty, text: 'Aa', masterOpacity: 100 };

    // Glow
    if (tempStyle.glowEnabled && tempStyle.strokeEnabled) {
      const layers = Math.max(1, tempStyle.glowLayers || 3);
      for (let i = layers; i >= 1; i--) {
        tctx.save();
        tctx.shadowColor = tempStyle.glowColor;
        tctx.shadowBlur = (tempStyle.glowBlur || 20) * (i / layers);
        tctx.strokeStyle = tempStyle.glowColor;
        tctx.lineWidth = (tempStyle.strokeWidth || 2) * 0.5;
        tctx.globalAlpha = ((tempStyle.glowOpacity || 80) / 100) / layers;
        tctx.strokeText('Aa', tx, ty);
        tctx.restore();
      }
    }

    // Shadow
    if (tempStyle.shadowEnabled) {
      tctx.save();
      tctx.shadowColor = tempStyle.shadowColor;
      tctx.shadowBlur = tempStyle.shadowBlur;
      tctx.shadowOffsetX = tempStyle.shadowOffsetX;
      tctx.shadowOffsetY = tempStyle.shadowOffsetY;
      tctx.fillStyle = 'rgba(0,0,0,0)';
      tctx.fillText('Aa', tx, ty);
      tctx.restore();
    }

    // Double stroke
    if (tempStyle.doubleStrokeEnabled && tempStyle.strokeEnabled) {
      tctx.save();
      tctx.strokeStyle = tempStyle.doubleStrokeColor;
      tctx.lineWidth = tempStyle.doubleStrokeWidth;
      tctx.strokeText('Aa', tx, ty);
      tctx.restore();
    }

    // Stroke
    if (tempStyle.strokeEnabled && tempStyle.strokeWidth > 0) {
      tctx.save();
      tctx.strokeStyle = tempStyle.strokeColor;
      tctx.lineWidth = tempStyle.strokePosition === 'outside' ? tempStyle.strokeWidth * 2 : tempStyle.strokeWidth;
      tctx.globalAlpha = tempStyle.strokeOpacity / 100;
      tctx.strokeText('Aa', tx, ty);
      tctx.restore();
    }

    // Fill
    if (tempStyle.fillType !== 'none') {
      tctx.save();
      tctx.fillStyle = tempStyle.fillColor;
      tctx.globalAlpha = tempStyle.fillOpacity / 100;
      tctx.fillText('Aa', tx, ty);
      tctx.restore();
    }

    thumb.innerHTML = '';
    thumb.appendChild(tc);
  });
}

// ─── SYNC UI FROM STYLE ──────────────────────────────────────────────
function syncUIFromStyle() {
  const s = st.style;
  setVal('#st-text', s.text);
  setVal('#st-font-family', s.fontFamily);
  setVal('#st-font-size', s.fontSize);
  setOut('#st-font-size-val', `${s.fontSize}px`);
  setCheck('#st-font-bold', s.fontBold);
  setCheck('#st-font-italic', s.fontItalic);
  setVal('#st-x', Math.round(s.x));
  setVal('#st-y', Math.round(s.y));
  setVal('#st-rotation', Math.round(s.rotation));
  setOut('#st-rotation-val', `${Math.round(s.rotation)}°`);
  setVal('#st-max-width', s.maxWidth);
  setOut('#st-max-width-val', `${s.maxWidth}px`);
  setVal('#st-line-height', Math.round(s.lineHeight * 100));
  setOut('#st-line-height-val', `${s.lineHeight}x`);

  // Alignment
  document.querySelectorAll('.st-align-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.align === s.textAlign);
  });

  // Fill
  document.querySelectorAll('.st-fill-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filltype === s.fillType);
  });
  showFillSections(s.fillType);
  setVal('#st-fill-color', s.fillColor);
  setVal('#st-fill-opacity', s.fillOpacity);
  setOut('#st-fill-opacity-val', `${s.fillOpacity}%`);
  setVal('#st-grad-color1', s.gradColor1);
  setVal('#st-grad-color2', s.gradColor2);
  setVal('#st-grad-angle', s.gradAngle);
  setOut('#st-grad-angle-val', `${s.gradAngle}°`);

  // Stroke
  setCheck('#st-stroke-enable', s.strokeEnabled);
  setVal('#st-stroke-color', s.strokeColor);
  setVal('#st-stroke-width', s.strokeWidth);
  setOut('#st-stroke-width-val', `${s.strokeWidth}px`);
  setVal('#st-stroke-opacity', s.strokeOpacity);
  setOut('#st-stroke-opacity-val', `${s.strokeOpacity}%`);
  document.querySelectorAll('.st-stroke-pos-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.pos === s.strokePosition);
  });
  document.querySelectorAll('.st-join-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.join === s.lineJoin);
  });
  setCheck('#st-double-stroke-enable', s.doubleStrokeEnabled);
  setVal('#st-double-stroke-color', s.doubleStrokeColor);
  setVal('#st-double-stroke-width', s.doubleStrokeWidth);
  setOut('#st-double-stroke-width-val', `${s.doubleStrokeWidth}px`);

  // Glow
  setCheck('#st-glow-enable', s.glowEnabled);
  setVal('#st-glow-color', s.glowColor);
  setVal('#st-glow-blur', s.glowBlur);
  setOut('#st-glow-blur-val', `${s.glowBlur}px`);
  setVal('#st-glow-opacity', s.glowOpacity);
  setOut('#st-glow-opacity-val', `${s.glowOpacity}%`);
  setVal('#st-glow-layers', s.glowLayers);
  setOut('#st-glow-layers-val', s.glowLayers);

  // Shadow
  setCheck('#st-shadow-enable', s.shadowEnabled);
  setVal('#st-shadow-color', s.shadowColor);
  setVal('#st-shadow-blur', s.shadowBlur);
  setOut('#st-shadow-blur-val', `${s.shadowBlur}px`);
  setVal('#st-shadow-ox', s.shadowOffsetX);
  setOut('#st-shadow-ox-val', `${s.shadowOffsetX}px`);
  setVal('#st-shadow-oy', s.shadowOffsetY);
  setOut('#st-shadow-oy-val', `${s.shadowOffsetY}px`);

  // Inner shadow
  setCheck('#st-inner-shadow-enable', s.innerShadowEnabled);
  setVal('#st-inner-shadow-color', s.innerShadowColor);
  setVal('#st-inner-shadow-blur', s.innerShadowBlur);
  setOut('#st-inner-shadow-blur-val', `${s.innerShadowBlur}px`);
  setVal('#st-inner-shadow-ox', s.innerShadowOffsetX);
  setOut('#st-inner-shadow-ox-val', `${s.innerShadowOffsetX}px`);
  setVal('#st-inner-shadow-oy', s.innerShadowOffsetY);
  setOut('#st-inner-shadow-oy-val', `${s.innerShadowOffsetY}px`);

  // Master opacity
  setVal('#st-master-opacity', s.masterOpacity);
  setOut('#st-master-opacity-val', `${s.masterOpacity}%`);
}

// ─── RESET ───────────────────────────────────────────────────────────
function resetToDefault() {
  st.style = defaultStyle();
  st.style.x = st.canvasW / 2;
  st.style.y = st.canvasH / 2;
  syncUIFromStyle();
  invalidateBounds();
  renderAll();
}

// ─── GOOGLE FONTS ────────────────────────────────────────────────────
async function loadGoogleFont(fontName) {
  const family = fontName.replace(/\s+/g, '+');
  if (st.loadedFonts.has(family)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@400;700&display=swap`;
  document.head.appendChild(link);
  st.loadedFonts.add(family);

  try {
    await document.fonts.ready;
  } catch (_) {
    await new Promise(r => setTimeout(r, 500));
  }
}

// ─── EXPORT ──────────────────────────────────────────────────────────
async function exportAndCommit() {
  if (!st.commitBlobCallback || !st.baseCanvas) return;
  try {
    const blob = await new Promise((resolve, reject) => {
      st.baseCanvas.toBlob(b => b ? resolve(b) : reject(new Error('Export failed')), 'image/png');
    });
    st.commitBlobCallback(blob, 'Stroke Text', 'stroke-text.png');
  } catch (err) {
    console.error('Stroke text export failed:', err);
  }
}

// ─── SET COMMIT CALLBACK ─────────────────────────────────────────────
export function setCommitBlobCallback(fn) {
  st.commitBlobCallback = fn;
}
