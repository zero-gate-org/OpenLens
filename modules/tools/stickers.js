// Stickers & Emoji Overlays Module
// Full interactive sticker layer with drag, resize, rotate, delete support

import { SVG_STICKERS } from './svg-stickers.js';

// ─── STATE ───────────────────────────────────────────────────────────
const stk = {
  stickers: [],
  nextId: 1,
  nextZIndex: 1,
  baseCanvas: null,
  overlayCanvas: null,
  baseCtx: null,
  overlayCtx: null,
  canvasW: 0,
  canvasH: 0,
  isActive: false,
  dirty: true,
  rafId: null,
  interaction: null, // { type: 'move'|'resize'|'rotate', stickerId, handleIndex, startAngle, startDist, startMouseX, startMouseY }
  getOriginalImageData: null,
  pushToUndoStack: null,
  commitBlobCallback: null,
  sourceImg: null,
  panelEl: null,
  layersEl: null,
  countWarnEl: null,
  myStickers: [],
  shiftHeld: false,
};

// ─── EMOJI DATA ──────────────────────────────────────────────────────
const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    icon: '\u{1F600}',
    emojis: [
      '\u{1F600}','\u{1F601}','\u{1F602}','\u{1F603}','\u{1F604}','\u{1F605}',
      '\u{1F606}','\u{1F609}','\u{1F60A}','\u{1F60D}','\u{1F60E}','\u{1F60F}',
      '\u{1F618}','\u{1F61C}','\u{1F61D}','\u{1F61E}','\u{1F620}','\u{1F621}',
      '\u{1F622}','\u{1F623}','\u{1F624}','\u{1F625}','\u{1F628}','\u{1F629}',
      '\u{1F62A}','\u{1F62B}','\u{1F62D}','\u{1F630}','\u{1F631}','\u{1F632}',
      '\u{1F633}','\u{1F634}','\u{1F635}','\u{1F636}','\u{1F637}','\u{1F641}',
      '\u{1F642}','\u{1F643}','\u{1F644}','\u{1F920}','\u{1F921}','\u{1F922}',
      '\u{1F923}','\u{1F924}','\u{1F925}','\u{1F927}','\u{1F928}','\u{1F929}',
    ]
  },
  {
    name: 'Animals',
    icon: '\u{1F436}',
    emojis: [
      '\u{1F436}','\u{1F431}','\u{1F42D}','\u{1F439}','\u{1F430}','\u{1F43B}',
      '\u{1F43C}','\u{1F428}','\u{1F42F}','\u{1F42E}','\u{1F437}','\u{1F438}',
      '\u{1F435}','\u{1F427}','\u{1F426}','\u{1F424}','\u{1F423}','\u{1F425}',
      '\u{1F43A}','\u{1F417}','\u{1F434}','\u{1F41D}','\u{1F41B}','\u{1F40C}',
      '\u{1F41E}','\u{1F41F}','\u{1F420}','\u{1F421}','\u{1F422}','\u{1F419}',
    ]
  },
  {
    name: 'Food',
    icon: '\u{1F355}',
    emojis: [
      '\u{1F355}','\u{1F354}','\u{1F35F}','\u{1F357}','\u{1F356}','\u{1F32D}',
      '\u{1F35E}','\u{1F35C}','\u{1F359}','\u{1F35A}','\u{1F35B}','\u{1F35D}',
      '\u{1F363}','\u{1F366}','\u{1F367}','\u{1F368}','\u{1F369}','\u{1F370}',
      '\u{1F382}','\u{1F36A}','\u{1F36B}','\u{1F36C}','\u{1F36D}','\u{1F36E}',
      '\u{1F34E}','\u{1F34F}','\u{1F34A}','\u{1F34B}','\u{1F34C}','\u{1F349}',
    ]
  },
  {
    name: 'Activities',
    icon: '\u{26BD}',
    emojis: [
      '\u{26BD}','\u{1F3C8}','\u{1F3C0}','\u{26BE}','\u{1F3BE}','\u{1F3D0}',
      '\u{1F3C9}','\u{1F3B1}','\u{1F3B3}','\u{1F3CF}','\u{1F3AF}','\u{1F3A8}',
      '\u{1F3AA}','\u{1F3AD}','\u{1F3A4}','\u{1F3A7}','\u{1F3B2}','\u{1F004}',
      '\u{1F3B0}','\u{1F3AE}','\u{1F3B8}','\u{1F3B9}','\u{1F3BA}','\u{1F3BB}',
      '\u{1F9E9}','\u{1F9E8}','\u{2660}','\u{2665}','\u{2666}','\u{2663}',
    ]
  },
  {
    name: 'Travel',
    icon: '\u{1F30D}',
    emojis: [
      '\u{1F30D}','\u{1F30E}','\u{1F30F}','\u{1F310}','\u{1F3E0}','\u{1F3E1}',
      '\u{1F3D6}','\u{1F3E5}','\u{26EA}','\u{1F3ED}','\u{1F3E8}','\u{1F697}',
      '\u{1F695}','\u{1F699}','\u{1F68C}','\u{1F682}','\u{2708}','\u{1F680}',
      '\u{1F6F8}','\u{26F5}','\u{1F6A2}','\u{1F6F9}','\u{1F683}','\u{1F6F4}',
    ]
  },
  {
    name: 'Objects',
    icon: '\u{1F4A1}',
    emojis: [
      '\u{1F4A1}','\u{1F4A3}','\u{1F525}','\u{1F4A5}','\u{2728}','\u{2B50}',
      '\u{1F31F}','\u{1F4AB}','\u{1F4AC}','\u{1F4DD}','\u{1F4CB}','\u{1F4CE}',
      '\u{2702}','\u{1F511}','\u{1F512}','\u{1F513}','\u{1F4CA}','\u{1F4C8}',
      '\u{1F4C9}','\u{1F4BC}','\u{1F4BB}','\u{1F4F1}','\u{1F4F7}','\u{1F3A5}',
      '\u{1F4FA}','\u{1F4FB}','\u{231A}','\u{1F514}','\u{1F515}','\u{1F50D}',
    ]
  },
  {
    name: 'Symbols',
    icon: '\u{2764}',
    emojis: [
      '\u{2764}','\u{1F49B}','\u{1F49A}','\u{1F499}','\u{1F49C}','\u{1F5A4}',
      '\u{1F494}','\u{1F495}','\u{1F496}','\u{1F497}','\u{1F498}','\u{1F49D}',
      '\u{2763}','\u{1F493}','\u{270C}','\u{1F44D}','\u{1F44E}','\u{1F44A}',
      '\u{270A}','\u{270B}','\u{1F91A}','\u{1F590}','\u{1F44B}','\u{1F44F}',
      '\u{1F64F}','\u{1F44C}','\u{1F91D}','\u{1F91E}','\u{1F91F}','\u{1F448}',
    ]
  },
  {
    name: 'Celebration',
    icon: '\u{1F389}',
    emojis: [
      '\u{1F389}','\u{1F38A}','\u{1F38B}','\u{1F38D}','\u{1F38E}','\u{1F38F}',
      '\u{1F390}','\u{1F391}','\u{1F380}','\u{1F381}','\u{1F382}','\u{1F383}',
      '\u{1F384}','\u{1F385}','\u{1F386}','\u{1F387}','\u{1F388}','\u{1F393}',
      '\u{1F3FF}','\u{1F3A3}','\u{1F3A1}','\u{1F38C}','\u{1F3A9}','\u{1F9E7}',
      '\u{1F9E6}','\u{1F3BD}','\u{1F397}','\u{1F39F}','\u{1F3F3}','\u{1F3F4}',
    ]
  }
];

const EMOJI_SEARCH_MAP = EMOJI_CATEGORIES.flatMap(cat =>
  cat.emojis.map(e => ({ emoji: e, category: cat.name }))
);

// ─── DEFAULT STICKER ─────────────────────────────────────────────────
function createSticker(type, content, x, y) {
  const id = 'stk_' + (stk.nextId++);
  const size = 80;
  return {
    id,
    type,
    content,
    x: x || stk.canvasW / 2,
    y: y || stk.canvasH / 2,
    width: size,
    height: size,
    rotation: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    visible: true,
    selected: false,
    zIndex: stk.nextZIndex++,
    cachedImage: null,
  };
}

// ─── SVG CACHE ───────────────────────────────────────────────────────
function cacheSvgImage(sticker) {
  if (sticker.cachedImage) return;
  const blob = new Blob([sticker.content], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    sticker.cachedImage = img;
    URL.revokeObjectURL(url);
    markDirty();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function cachePngImage(sticker) {
  if (sticker.cachedImage) return;
  const img = new Image();
  img.onload = () => {
    sticker.cachedImage = img;
    markDirty();
  };
  img.src = sticker.content;
}

// ─── RENDERING ───────────────────────────────────────────────────────
function markDirty() {
  stk.dirty = true;
  if (!stk.rafId) {
    stk.rafId = requestAnimationFrame(renderLoop);
  }
}

function renderLoop() {
  stk.rafId = null;
  if (!stk.dirty || !stk.overlayCtx) return;
  stk.dirty = false;
  renderAll();
}

function renderAll() {
  const ctx = stk.overlayCtx;
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, stk.canvasW, stk.canvasH);

  const sorted = [...stk.stickers].filter(s => s.visible).sort((a, b) => a.zIndex - b.zIndex);
  for (const sticker of sorted) {
    renderSticker(ctx, sticker);
  }
  ctx.restore();
}

function renderSticker(ctx, sticker) {
  ctx.save();
  ctx.globalAlpha = sticker.opacity;
  ctx.translate(sticker.x, sticker.y);
  ctx.rotate(sticker.rotation * Math.PI / 180);
  ctx.scale(sticker.flipX ? -1 : 1, sticker.flipY ? -1 : 1);

  if (sticker.type === 'emoji') {
    ctx.font = `${sticker.height}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sticker.content, 0, 0);
  } else if (sticker.type === 'svg') {
    if (sticker.cachedImage) {
      ctx.drawImage(sticker.cachedImage, -sticker.width / 2, -sticker.height / 2, sticker.width, sticker.height);
    }
  } else if (sticker.type === 'png') {
    if (sticker.cachedImage) {
      ctx.drawImage(sticker.cachedImage, -sticker.width / 2, -sticker.height / 2, sticker.width, sticker.height);
    }
  }

  ctx.restore();

  if (sticker.selected) {
    drawHandles(ctx, sticker);
  }
}

function drawHandles(ctx, sticker) {
  ctx.save();
  ctx.translate(sticker.x, sticker.y);
  ctx.rotate(sticker.rotation * Math.PI / 180);

  // Bounding box
  ctx.setLineDash([5, 3]);
  ctx.strokeStyle = '#abffcb';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-sticker.width / 2, -sticker.height / 2, sticker.width, sticker.height);
  ctx.setLineDash([]);

  // 8 resize handles
  const handles = getHandlePositions(sticker);
  for (const h of handles) {
    ctx.fillStyle = '#abffcb';
    ctx.fillRect(h.x - 4, h.y - 4, 8, 8);
    ctx.strokeStyle = '#0c1012';
    ctx.lineWidth = 1;
    ctx.strokeRect(h.x - 4, h.y - 4, 8, 8);
  }

  // Rotation handle
  const topCenter = { x: 0, y: -sticker.height / 2 };
  const rotHandleY = topCenter.y - 30;
  ctx.beginPath();
  ctx.moveTo(topCenter.x, topCenter.y);
  ctx.lineTo(topCenter.x, rotHandleY);
  ctx.strokeStyle = '#abffcb';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(topCenter.x, rotHandleY, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#abffcb';
  ctx.fill();
  ctx.strokeStyle = '#0c1012';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();

  // Delete button (unrotated screen space at top-right)
  ctx.save();
  ctx.translate(sticker.x, sticker.y);
  ctx.rotate(sticker.rotation * Math.PI / 180);
  const delX = sticker.width / 2 + 12;
  const delY = -sticker.height / 2 - 12;
  ctx.beginPath();
  ctx.arc(delX, delY, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#ff756f';
  ctx.fill();
  ctx.strokeStyle = '#0c1012';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(delX - 4, delY - 4);
  ctx.lineTo(delX + 4, delY + 4);
  ctx.moveTo(delX + 4, delY - 4);
  ctx.lineTo(delX - 4, delY + 4);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Flip buttons below bounding box
  const flipY = sticker.height / 2 + 22;
  // Horizontal flip
  ctx.beginPath();
  ctx.arc(-16, flipY, 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(171,255,203,0.2)';
  ctx.fill();
  ctx.strokeStyle = '#abffcb';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#abffcb';
  ctx.fillText('\u2194', -16, flipY);

  // Vertical flip
  ctx.beginPath();
  ctx.arc(16, flipY, 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(171,255,203,0.2)';
  ctx.fill();
  ctx.strokeStyle = '#abffcb';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#abffcb';
  ctx.fillText('\u2195', 16, flipY);

  ctx.restore();
}

function getHandlePositions(sticker) {
  const hw = sticker.width / 2;
  const hh = sticker.height / 2;
  return [
    { x: -hw, y: -hh, cursor: 'nw-resize', index: 0 },
    { x: 0,   y: -hh, cursor: 'n-resize',  index: 1 },
    { x: hw,  y: -hh, cursor: 'ne-resize', index: 2 },
    { x: -hw, y: 0,   cursor: 'w-resize',  index: 3 },
    { x: hw,  y: 0,   cursor: 'e-resize',  index: 4 },
    { x: -hw, y: hh,  cursor: 'sw-resize', index: 5 },
    { x: 0,   y: hh,  cursor: 's-resize',  index: 6 },
    { x: hw,  y: hh,  cursor: 'se-resize', index: 7 },
  ];
}

// ─── HIT TESTING ─────────────────────────────────────────────────────
function isPointInRotatedRect(px, py, sticker) {
  const dx = px - sticker.x;
  const dy = py - sticker.y;
  const rad = -sticker.rotation * Math.PI / 180;
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
  const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
  return (
    localX >= -sticker.width / 2 && localX <= sticker.width / 2 &&
    localY >= -sticker.height / 2 && localY <= sticker.height / 2
  );
}

function hitTestHandle(px, py, sticker, handleIndex) {
  const handles = getHandlePositions(sticker);
  const h = handles[handleIndex];
  const rad = sticker.rotation * Math.PI / 180;
  const hx = sticker.x + h.x * Math.cos(rad) - h.y * Math.sin(rad);
  const hy = sticker.y + h.x * Math.sin(rad) + h.y * Math.cos(rad);
  const dist = Math.sqrt((px - hx) ** 2 + (py - hy) ** 2);
  return dist <= 12;
}

function hitTestRotationHandle(px, py, sticker) {
  const rad = sticker.rotation * Math.PI / 180;
  const topX = 0;
  const topY = -sticker.height / 2;
  const rotX = topX;
  const rotY = topY - 30;
  const hx = sticker.x + rotX * Math.cos(rad) - rotY * Math.sin(rad);
  const hy = sticker.y + rotX * Math.sin(rad) + rotY * Math.cos(rad);
  const dist = Math.sqrt((px - hx) ** 2 + (py - hy) ** 2);
  return dist <= 14;
}

function hitTestDeleteButton(px, py, sticker) {
  const rad = sticker.rotation * Math.PI / 180;
  const delLocalX = sticker.width / 2 + 12;
  const delLocalY = -sticker.height / 2 - 12;
  const dx = sticker.x + delLocalX * Math.cos(rad) - delLocalY * Math.sin(rad);
  const dy = sticker.y + delLocalX * Math.sin(rad) + delLocalY * Math.cos(rad);
  const dist = Math.sqrt((px - dx) ** 2 + (py - dy) ** 2);
  return dist <= 14;
}

function hitTestFlipButtons(px, py, sticker) {
  const rad = sticker.rotation * Math.PI / 180;
  const flipY = sticker.height / 2 + 22;
  for (const fx of [-16, 16]) {
    const hx = sticker.x + fx * Math.cos(rad) - flipY * Math.sin(rad);
    const hy = sticker.y + fx * Math.sin(rad) + flipY * Math.cos(rad);
    if (Math.sqrt((px - hx) ** 2 + (py - hy) ** 2) <= 14) {
      return fx === -16 ? 'flipX' : 'flipY';
    }
  }
  return null;
}

function getCanvasPoint(e) {
  const rect = stk.overlayCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (stk.canvasW / rect.width),
    y: (e.clientY - rect.top) * (stk.canvasH / rect.height),
  };
}

function getAngle(cx, cy, px, py) {
  return Math.atan2(py - cy, px - cx) * 180 / Math.PI;
}

// ─── POINTER INTERACTION ─────────────────────────────────────────────
function onPointerDown(e) {
  if (!stk.isActive) return;
  const p = getCanvasPoint(e);
  const selected = stk.stickers.filter(s => s.selected);

  // 1. Delete button of selected stickers
  for (const s of selected) {
    if (hitTestDeleteButton(p.x, p.y, s)) {
      deleteSticker(s.id);
      return;
    }
  }

  // 2. Flip buttons
  for (const s of selected) {
    const flip = hitTestFlipButtons(p.x, p.y, s);
    if (flip) {
      s[flip] = !s[flip];
      markDirty();
      return;
    }
  }

  // 3. Rotation handle
  for (const s of selected) {
    if (hitTestRotationHandle(p.x, p.y, s)) {
      stk.interaction = {
        type: 'rotate',
        stickerId: s.id,
        startAngle: getAngle(s.x, s.y, p.x, p.y),
        startRotation: s.rotation,
      };
      return;
    }
  }

  // 4. Resize handles
  for (const s of selected) {
    const handles = getHandlePositions(s);
    for (let i = 0; i < handles.length; i++) {
      if (hitTestHandle(p.x, p.y, s, i)) {
        const dist = Math.sqrt((p.x - s.x) ** 2 + (p.y - s.y) ** 2);
        stk.interaction = {
          type: 'resize',
          stickerId: s.id,
          handleIndex: i,
          startDist: dist,
          startWidth: s.width,
          startHeight: s.height,
        };
        return;
      }
    }
  }

  // 5. Click on sticker body (select + move)
  // Check from top z-index down
  const sorted = [...stk.stickers].filter(s => s.visible).sort((a, b) => b.zIndex - a.zIndex);
  for (const s of sorted) {
    if (isPointInRotatedRect(p.x, p.y, s)) {
      selectSticker(s.id, !e.shiftKey);
      stk.interaction = {
        type: 'move',
        stickerId: s.id,
        startMouseX: p.x,
        startMouseY: p.y,
        startX: s.x,
        startY: s.y,
      };
      markDirty();
      return;
    }
  }

  // 6. Click on empty space - deselect all
  deselectAll();
}

function onPointerMove(e) {
  if (!stk.interaction) updateCursor(e);
  if (!stk.interaction || !stk.isActive) return;

  const p = getCanvasPoint(e);
  const s = stk.stickers.find(st => st.id === stk.interaction.stickerId);
  if (!s) return;

  if (stk.interaction.type === 'move') {
    s.x = stk.interaction.startX + (p.x - stk.interaction.startMouseX);
    s.y = stk.interaction.startY + (p.y - stk.interaction.startMouseY);
    markDirty();
  } else if (stk.interaction.type === 'rotate') {
    const currentAngle = getAngle(s.x, s.y, p.x, p.y);
    const delta = currentAngle - stk.interaction.startAngle;
    s.rotation = stk.interaction.startRotation + delta;
    markDirty();
  } else if (stk.interaction.type === 'resize') {
    const dist = Math.sqrt((p.x - s.x) ** 2 + (p.y - s.y) ** 2);
    const scale = dist / stk.interaction.startDist;
    if (stk.shiftHeld) {
      // Non-proportional
      s.width = Math.max(20, stk.interaction.startWidth * scale);
      s.height = Math.max(20, stk.interaction.startHeight * scale);
    } else {
      // Proportional
      const aspect = stk.interaction.startWidth / stk.interaction.startHeight;
      s.width = Math.max(20, stk.interaction.startWidth * scale);
      s.height = Math.max(20, s.width / aspect);
    }
    markDirty();
  }
}

function onPointerUp() {
  stk.interaction = null;
}

function updateCursor(e) {
  const p = getCanvasPoint(e);
  const selected = stk.stickers.filter(s => s.selected);

  for (const s of selected) {
    if (hitTestDeleteButton(p.x, p.y, s)) { stk.overlayCanvas.style.cursor = 'pointer'; return; }
    const flip = hitTestFlipButtons(p.x, p.y, s);
    if (flip) { stk.overlayCanvas.style.cursor = 'pointer'; return; }
    if (hitTestRotationHandle(p.x, p.y, s)) { stk.overlayCanvas.style.cursor = 'grab'; return; }
    for (let i = 0; i < 8; i++) {
      if (hitTestHandle(p.x, p.y, s, i)) {
        stk.overlayCanvas.style.cursor = getHandlePositions(s)[i].cursor;
        return;
      }
    }
  }

  const sorted = [...stk.stickers].filter(s => s.visible).sort((a, b) => b.zIndex - a.zIndex);
  for (const s of sorted) {
    if (isPointInRotatedRect(p.x, p.y, s)) {
      stk.overlayCanvas.style.cursor = 'move';
      return;
    }
  }

  stk.overlayCanvas.style.cursor = 'default';
}

// ─── SELECTION ───────────────────────────────────────────────────────
function selectSticker(id, exclusive) {
  if (exclusive) {
    stk.stickers.forEach(s => s.selected = false);
  }
  const s = stk.stickers.find(st => st.id === id);
  if (s) s.selected = true;
  markDirty();
  updateLayersPanel();
}

function deselectAll() {
  stk.stickers.forEach(s => s.selected = false);
  markDirty();
  updateLayersPanel();
}

function deleteSticker(id) {
  const idx = stk.stickers.findIndex(s => s.id === id);
  if (idx !== -1) {
    const s = stk.stickers[idx];
    if (s.cachedImage && s.type === 'svg') {
      // Cached images from blob URLs are already revoked
    }
    stk.stickers.splice(idx, 1);
    markDirty();
    updateLayersPanel();
    updateCountWarning();
  }
}

function duplicateSelected() {
  const sel = stk.stickers.find(s => s.selected);
  if (!sel) return;
  const copy = { ...sel };
  copy.id = 'stk_' + (stk.nextId++);
  copy.x += 20;
  copy.y += 20;
  copy.zIndex = stk.nextZIndex++;
  copy.selected = false;
  copy.cachedImage = sel.cachedImage; // share cache
  stk.stickers.push(copy);
  selectSticker(copy.id, true);
  markDirty();
  updateLayersPanel();
  updateCountWarning();
}

// ─── KEYBOARD ────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (!stk.isActive) return;
  stk.shiftHeld = e.shiftKey;

  const sel = stk.stickers.find(s => s.selected);
  if (!sel) {
    if (e.key === 'Escape') deselectAll();
    return;
  }

  const nudge = e.shiftKey ? 10 : 1;

  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      deleteSticker(sel.id);
      break;
    case 'Escape':
      deselectAll();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      sel.x -= nudge;
      markDirty();
      break;
    case 'ArrowRight':
      e.preventDefault();
      sel.x += nudge;
      markDirty();
      break;
    case 'ArrowUp':
      e.preventDefault();
      sel.y -= nudge;
      markDirty();
      break;
    case 'ArrowDown':
      e.preventDefault();
      sel.y += nudge;
      markDirty();
      break;
    case 'r':
    case 'R':
      if (!e.ctrlKey && !e.metaKey) {
        sel.rotation = 0;
        markDirty();
      }
      break;
    case 'f':
    case 'F':
      if (!e.ctrlKey && !e.metaKey) {
        sel.flipX = !sel.flipX;
        markDirty();
      }
      break;
    case 'v':
    case 'V':
      if (!e.ctrlKey && !e.metaKey) {
        sel.flipY = !sel.flipY;
        markDirty();
      }
      break;
    case 'd':
    case 'D':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        duplicateSelected();
      }
      break;
    case ']':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        sel.zIndex++;
        markDirty();
        updateLayersPanel();
      }
      break;
    case '[':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        sel.zIndex = Math.max(1, sel.zIndex - 1);
        markDirty();
        updateLayersPanel();
      }
      break;
  }
}

function onKeyUp(e) {
  stk.shiftHeld = e.shiftKey;
}

// ─── TOUCH PINCH ─────────────────────────────────────────────────────
let pinchState = null;

function onTouchStart(e) {
  if (!stk.isActive) return;
  if (e.touches.length === 2) {
    const sel = stk.stickers.find(s => s.selected);
    if (!sel) return;
    e.preventDefault();
    const t1 = getCanvasPoint(e.touches[0]);
    const t2 = getCanvasPoint(e.touches[1]);
    pinchState = {
      stickerId: sel.id,
      startDist: Math.sqrt((t1.x - t2.x) ** 2 + (t1.y - t2.y) ** 2),
      startWidth: sel.width,
      startHeight: sel.height,
    };
  }
}

function onTouchMove(e) {
  if (!pinchState || e.touches.length !== 2) return;
  e.preventDefault();
  const s = stk.stickers.find(st => st.id === pinchState.stickerId);
  if (!s) return;
  const t1 = getCanvasPoint(e.touches[0]);
  const t2 = getCanvasPoint(e.touches[1]);
  const dist = Math.sqrt((t1.x - t2.x) ** 2 + (t1.y - t2.y) ** 2);
  const scale = dist / pinchState.startDist;
  const aspect = pinchState.startWidth / pinchState.startHeight;
  s.width = Math.max(20, pinchState.startWidth * scale);
  s.height = Math.max(20, s.width / aspect);
  markDirty();
}

function onTouchEnd() {
  pinchState = null;
}

// ─── EMOJI PICKER ────────────────────────────────────────────────────
function buildEmojiPicker(container) {
  const tabsEl = container.querySelector('.stk-category-tabs');
  const gridEl = container.querySelector('.stk-emoji-grid');
  const searchEl = container.querySelector('.stk-search-input');

  let activeCategory = 0;

  function renderTabs() {
    tabsEl.innerHTML = '';
    EMOJI_CATEGORIES.forEach((cat, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stk-category-tab' + (i === activeCategory ? ' active' : '');
      btn.innerHTML = `<span class="stk-category-tab-emoji">${cat.icon}</span> ${cat.name}`;
      btn.addEventListener('click', () => {
        activeCategory = i;
        renderTabs();
        renderGrid(cat.emojis);
      });
      tabsEl.appendChild(btn);
    });
  }

  function renderGrid(emojis) {
    gridEl.innerHTML = '';
    for (const emoji of emojis) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stk-grid-btn';
      btn.textContent = emoji;
      btn.title = emoji;
      btn.addEventListener('click', () => addEmojiSticker(emoji));
      gridEl.appendChild(btn);
    }
  }

  function filterEmojis(query) {
    if (!query) {
      renderGrid(EMOJI_CATEGORIES[activeCategory].emojis);
      return;
    }
    const q = query.toLowerCase();
    const filtered = EMOJI_SEARCH_MAP
      .filter(e => e.category.toLowerCase().includes(q) || e.emoji.includes(query))
      .map(e => e.emoji);
    renderGrid([...new Set(filtered)]);
  }

  searchEl.addEventListener('input', () => filterEmojis(searchEl.value));

  renderTabs();
  renderGrid(EMOJI_CATEGORIES[0].emojis);
}

function addEmojiSticker(emoji) {
  if (stk.stickers.length >= 50) {
    alert('Maximum 50 stickers reached.');
    return;
  }
  const sticker = createSticker('emoji', emoji);
  stk.stickers.push(sticker);
  selectSticker(sticker.id, true);
  markDirty();
  updateLayersPanel();
  updateCountWarning();
}

// ─── SVG LIBRARY ─────────────────────────────────────────────────────
function buildSvgPicker(container) {
  const gridEl = container.querySelector('.stk-svg-grid');
  gridEl.innerHTML = '';
  for (const item of SVG_STICKERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stk-svg-btn';
    btn.title = item.name;
    btn.innerHTML = item.svg;
    btn.addEventListener('click', () => addSvgSticker(item.svg));
    gridEl.appendChild(btn);
  }
}

function addSvgSticker(svgContent) {
  if (stk.stickers.length >= 50) {
    alert('Maximum 50 stickers reached.');
    return;
  }
  const sticker = createSticker('svg', svgContent);
  cacheSvgImage(sticker);
  stk.stickers.push(sticker);
  selectSticker(sticker.id, true);
  markDirty();
  updateLayersPanel();
  updateCountWarning();
}

// ─── UPLOAD ──────────────────────────────────────────────────────────
function initUpload(container) {
  const uploadInput = container.querySelector('.stk-upload-input');
  const myStickersEl = container.querySelector('.stk-my-stickers');

  loadMyStickers();

  container.querySelector('.stk-upload-btn').addEventListener('click', () => {
    uploadInput.click();
  });

  uploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      stk.myStickers.push(dataUrl);
      saveMyStickers();
      renderMyStickers(myStickersEl);
    };
    reader.readAsDataURL(file);
    uploadInput.value = '';
  });

  renderMyStickers(myStickersEl);
}

function loadMyStickers() {
  try {
    const data = sessionStorage.getItem('openlens_my_stickers');
    stk.myStickers = data ? JSON.parse(data) : [];
  } catch {
    stk.myStickers = [];
  }
}

function saveMyStickers() {
  try {
    sessionStorage.setItem('openlens_my_stickers', JSON.stringify(stk.myStickers));
  } catch { /* quota exceeded */ }
}

function renderMyStickers(container) {
  container.innerHTML = '';
  stk.myStickers.forEach((dataUrl, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stk-my-sticker-btn';
    const img = document.createElement('img');
    img.src = dataUrl;
    btn.appendChild(img);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'stk-my-sticker-delete';
    delBtn.textContent = '\u00D7';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stk.myStickers.splice(i, 1);
      saveMyStickers();
      renderMyStickers(container);
    });
    btn.appendChild(delBtn);

    btn.addEventListener('click', () => addUploadedSticker(dataUrl));
    container.appendChild(btn);
  });
}

function addUploadedSticker(dataUrl) {
  if (stk.stickers.length >= 50) {
    alert('Maximum 50 stickers reached.');
    return;
  }
  const isSvg = dataUrl.startsWith('data:image/svg');
  const sticker = createSticker(isSvg ? 'svg' : 'png', dataUrl);
  if (isSvg) {
    // For SVG data URLs, we need to fetch and convert
    fetch(dataUrl).then(r => r.text()).then(svgText => {
      sticker.content = svgText;
      sticker.type = 'svg';
      cacheSvgImage(sticker);
    });
  } else {
    cachePngImage(sticker);
  }
  stk.stickers.push(sticker);
  selectSticker(sticker.id, true);
  markDirty();
  updateLayersPanel();
  updateCountWarning();
}

// ─── LAYERS PANEL ────────────────────────────────────────────────────
function updateLayersPanel() {
  if (!stk.layersEl) return;
  stk.layersEl.innerHTML = '';

  const sorted = [...stk.stickers].sort((a, b) => b.zIndex - a.zIndex);

  if (sorted.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'stk-layer-empty';
    empty.textContent = 'No stickers added yet';
    stk.layersEl.appendChild(empty);
    return;
  }

  for (const s of sorted) {
    const row = document.createElement('div');
    row.className = 'stk-layer-row' + (s.selected ? ' selected' : '');
    row.dataset.stickerId = s.id;

    // Drag handle
    const dragHandle = document.createElement('span');
    dragHandle.className = 'stk-layer-drag-handle';
    dragHandle.textContent = '\u2630';
    dragHandle.draggable = true;
    dragHandle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', s.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.appendChild(dragHandle);

    // Preview
    const preview = document.createElement('div');
    preview.className = 'stk-layer-preview';
    if (s.type === 'emoji') {
      preview.textContent = s.content;
    } else if (s.type === 'png' && s.cachedImage) {
      const img = document.createElement('img');
      img.src = s.content;
      preview.appendChild(img);
    } else {
      preview.textContent = '\u{1F4CE}';
    }
    row.appendChild(preview);

    // Name
    const name = document.createElement('span');
    name.className = 'stk-layer-name';
    name.textContent = s.type === 'emoji' ? `Emoji ${s.content}` : `Sticker #${s.zIndex}`;
    row.appendChild(name);

    // Opacity
    const opacityInput = document.createElement('input');
    opacityInput.type = 'number';
    opacityInput.className = 'stk-layer-opacity';
    opacityInput.min = '0';
    opacityInput.max = '100';
    opacityInput.value = Math.round(s.opacity * 100);
    opacityInput.addEventListener('change', () => {
      s.opacity = Math.max(0, Math.min(1, parseInt(opacityInput.value) / 100));
      markDirty();
    });
    row.appendChild(opacityInput);

    // Visibility toggle
    const visBtn = document.createElement('button');
    visBtn.type = 'button';
    visBtn.className = 'stk-layer-btn' + (s.visible ? ' stk-layer-btn-active' : '');
    visBtn.textContent = '\u{1F441}';
    visBtn.title = 'Toggle visibility';
    visBtn.addEventListener('click', () => {
      s.visible = !s.visible;
      visBtn.classList.toggle('stk-layer-btn-active', s.visible);
      markDirty();
    });
    row.appendChild(visBtn);

    // Move up
    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'stk-layer-btn';
    upBtn.textContent = '\u25B2';
    upBtn.title = 'Bring forward';
    upBtn.addEventListener('click', () => {
      s.zIndex++;
      markDirty();
      updateLayersPanel();
    });
    row.appendChild(upBtn);

    // Move down
    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'stk-layer-btn';
    downBtn.textContent = '\u25BC';
    downBtn.title = 'Send backward';
    downBtn.addEventListener('click', () => {
      s.zIndex = Math.max(1, s.zIndex - 1);
      markDirty();
      updateLayersPanel();
    });
    row.appendChild(downBtn);

    // Delete
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'stk-layer-btn stk-layer-btn-danger';
    delBtn.textContent = '\u2715';
    delBtn.title = 'Delete sticker';
    delBtn.addEventListener('click', () => deleteSticker(s.id));
    row.appendChild(delBtn);

    // Click to select
    row.addEventListener('click', (e) => {
      if (e.target.closest('.stk-layer-btn') || e.target.closest('.stk-layer-opacity') || e.target.closest('.stk-layer-drag-handle')) return;
      selectSticker(s.id, true);
    });

    // Drop target for reorder
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.style.borderTop = '2px solid var(--accent)';
    });
    row.addEventListener('dragleave', () => {
      row.style.borderTop = '';
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.style.borderTop = '';
      const draggedId = e.dataTransfer.getData('text/plain');
      const dragged = stk.stickers.find(st => st.id === draggedId);
      if (dragged && dragged.id !== s.id) {
        dragged.zIndex = s.zIndex + 1;
        markDirty();
        updateLayersPanel();
      }
    });

    stk.layersEl.appendChild(row);
  }
}

function updateCountWarning() {
  if (!stk.countWarnEl) return;
  if (stk.stickers.length >= 30) {
    stk.countWarnEl.classList.remove('hidden');
    stk.countWarnEl.querySelector('.stk-count-text').textContent =
      `${stk.stickers.length}/50 stickers. Consider reducing for performance.`;
  } else {
    stk.countWarnEl.classList.add('hidden');
  }
}

// ─── APPLY ───────────────────────────────────────────────────────────
function applyStickersToCanvas() {
  if (!stk.baseCanvas || !stk.pushToUndoStack || !stk.commitBlobCallback) return;
  if (stk.stickers.length === 0) return;

  // Push undo state before applying
  stk.pushToUndoStack();

  const ctx = stk.baseCtx;
  const sorted = [...stk.stickers].filter(s => s.visible).sort((a, b) => a.zIndex - b.zIndex);

  // Scale factor: base canvas is at full resolution, but we need to render
  // using the sticker coordinates which are in canvasW/canvasH space
  const scaleX = stk.baseCanvas.width / stk.canvasW;
  const scaleY = stk.baseCanvas.height / stk.canvasH;

  ctx.save();
  for (const sticker of sorted) {
    ctx.save();
    ctx.globalAlpha = sticker.opacity;
    ctx.translate(sticker.x * scaleX, sticker.y * scaleY);
    ctx.rotate(sticker.rotation * Math.PI / 180);
    ctx.scale(
      (sticker.flipX ? -1 : 1) * scaleX,
      (sticker.flipY ? -1 : 1) * scaleY
    );

    if (sticker.type === 'emoji') {
      ctx.font = `${sticker.height}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sticker.content, 0, 0);
    } else if (sticker.type === 'svg') {
      if (sticker.cachedImage) {
        ctx.drawImage(sticker.cachedImage, -sticker.width / 2, -sticker.height / 2, sticker.width, sticker.height);
      }
    } else if (sticker.type === 'png') {
      if (sticker.cachedImage) {
        ctx.drawImage(sticker.cachedImage, -sticker.width / 2, -sticker.height / 2, sticker.width, sticker.height);
      }
    }

    ctx.restore();
  }
  ctx.restore();

  // Export
  stk.baseCanvas.toBlob((blob) => {
    if (blob) {
      stk.commitBlobCallback(blob, 'Stickers', 'stickers.png');
    }
  }, 'image/png');

  // Clear stickers
  stk.stickers = [];
  markDirty();
  updateLayersPanel();
  updateCountWarning();
}

// ─── INIT / DESTROY ──────────────────────────────────────────────────
export function init(imgElement, getOriginalImageData, pushToUndoStack) {
  destroy();

  stk.getOriginalImageData = getOriginalImageData;
  stk.pushToUndoStack = pushToUndoStack;
  stk.sourceImg = imgElement;

  const parent = imgElement.parentElement;
  stk.canvasW = imgElement.naturalWidth || imgElement.width;
  stk.canvasH = imgElement.naturalHeight || imgElement.height;

  // Create stack wrapper
  const stack = document.createElement('div');
  stack.className = 'stk-canvas-stack';
  stack.id = 'stk-canvas-stack';

  // Base canvas
  stk.baseCanvas = document.createElement('canvas');
  stk.baseCanvas.width = stk.canvasW;
  stk.baseCanvas.height = stk.canvasH;
  stk.baseCanvas.className = 'stk-base-canvas';
  stk.baseCtx = stk.baseCanvas.getContext('2d');
  stk.baseCtx.drawImage(imgElement, 0, 0, stk.canvasW, stk.canvasH);

  // Overlay canvas
  stk.overlayCanvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  stk.overlayCanvas.width = stk.canvasW * dpr;
  stk.overlayCanvas.height = stk.canvasH * dpr;
  stk.overlayCanvas.className = 'stk-overlay-canvas';
  stk.overlayCanvas.style.width = stk.canvasW + 'px';
  stk.overlayCanvas.style.height = stk.canvasH + 'px';
  stk.overlayCtx = stk.overlayCanvas.getContext('2d');

  stack.appendChild(stk.baseCanvas);
  stack.appendChild(stk.overlayCanvas);

  // Hide the original image and insert our stack
  imgElement.style.display = 'none';
  parent.insertBefore(stack, imgElement);

  // Style stack to match image size
  stack.style.display = 'inline-block';
  stack.style.position = 'relative';

  // Event listeners
  stk.overlayCanvas.addEventListener('pointerdown', onPointerDown);
  stk.overlayCanvas.addEventListener('pointermove', onPointerMove);
  stk.overlayCanvas.addEventListener('pointerup', onPointerUp);
  stk.overlayCanvas.addEventListener('pointercancel', onPointerUp);
  stk.overlayCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
  stk.overlayCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
  stk.overlayCanvas.addEventListener('touchend', onTouchEnd);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // Build panel
  buildPanel();

  stk.isActive = true;
  markDirty();
}

function buildPanel() {
  const panel = document.querySelector('#stickers-sidebar-panel');
  if (!panel) return;
  stk.panelEl = panel;

  panel.innerHTML = `
    <div class="stk-panel">
      <div class="stk-panel-section">
        <div class="stk-section-header" data-toggle="emoji-section">
          <span>Emoji</span>
          <span class="stk-section-arrow">\u25BC</span>
        </div>
        <div class="stk-section-body" id="stk-emoji-section">
          <div class="stk-search-wrap">
            <span class="stk-search-icon">\u{1F50D}</span>
            <input type="text" class="stk-search-input" placeholder="Search emoji..." />
          </div>
          <div class="stk-category-tabs"></div>
          <div class="stk-grid stk-emoji-grid"></div>
        </div>
      </div>

      <div class="stk-panel-section">
        <div class="stk-section-header" data-toggle="svg-section">
          <span>Stickers</span>
          <span class="stk-section-arrow">\u25BC</span>
        </div>
        <div class="stk-section-body" id="stk-svg-section">
          <div class="stk-svg-grid"></div>
        </div>
      </div>

      <div class="stk-panel-section">
        <div class="stk-section-header" data-toggle="upload-section">
          <span>My Stickers</span>
          <span class="stk-section-arrow">\u25BC</span>
        </div>
        <div class="stk-section-body" id="stk-upload-section">
          <div class="stk-upload-area">
            <label class="stk-upload-btn">
              \u2B06 Upload Sticker
              <input type="file" class="stk-upload-input" accept="image/*,.svg" />
            </label>
            <div class="stk-my-stickers"></div>
          </div>
        </div>
      </div>

      <div class="stk-panel-section">
        <div class="stk-section-header" data-toggle="layers-section">
          <span>Layers</span>
          <span class="stk-section-arrow">\u25BC</span>
        </div>
        <div class="stk-section-body" id="stk-layers-section">
          <div class="stk-layers-panel"></div>
        </div>
      </div>

      <div class="stk-count-warn hidden">
        <span class="stk-count-text"></span>
      </div>

      <div class="stk-apply-row">
        <button type="button" class="stk-apply-btn stk-apply-btn-ghost" id="stk-clear-all">Clear All</button>
        <button type="button" class="stk-apply-btn stk-apply-btn-primary" id="stk-apply">Apply</button>
      </div>
    </div>
  `;

  // Section collapse toggles
  panel.querySelectorAll('.stk-section-header[data-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.stk-panel-section').classList.toggle('collapsed');
    });
  });

  // Build emoji picker
  buildEmojiPicker(panel);

  // Build SVG picker
  buildSvgPicker(panel);

  // Init upload
  initUpload(panel);

  // Layers ref
  stk.layersEl = panel.querySelector('.stk-layers-panel');
  stk.countWarnEl = panel.querySelector('.stk-count-warn');
  updateLayersPanel();
  updateCountWarning();

  // Apply button
  panel.querySelector('#stk-apply').addEventListener('click', applyStickersToCanvas);

  // Clear all
  panel.querySelector('#stk-clear-all').addEventListener('click', () => {
    if (stk.stickers.length === 0) return;
    stk.stickers = [];
    markDirty();
    updateLayersPanel();
    updateCountWarning();
  });
}

export function destroy() {
  if (stk.rafId) {
    cancelAnimationFrame(stk.rafId);
    stk.rafId = null;
  }

  // Remove canvas stack
  const stack = document.getElementById('stk-canvas-stack');
  if (stack) {
    const parent = stack.parentElement;
    // Show original image again
    const img = parent.querySelector('img:not(.stk-base-canvas)');
    if (img) img.style.display = '';
    stack.remove();
  }

  // Remove event listeners
  if (stk.overlayCanvas) {
    stk.overlayCanvas.removeEventListener('pointerdown', onPointerDown);
    stk.overlayCanvas.removeEventListener('pointermove', onPointerMove);
    stk.overlayCanvas.removeEventListener('pointerup', onPointerUp);
    stk.overlayCanvas.removeEventListener('pointercancel', onPointerUp);
    stk.overlayCanvas.removeEventListener('touchstart', onTouchStart);
    stk.overlayCanvas.removeEventListener('touchmove', onTouchMove);
    stk.overlayCanvas.removeEventListener('touchend', onTouchEnd);
  }
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);

  // Reset state
  stk.stickers = [];
  stk.nextId = 1;
  stk.nextZIndex = 1;
  stk.baseCanvas = null;
  stk.overlayCanvas = null;
  stk.baseCtx = null;
  stk.overlayCtx = null;
  stk.isActive = false;
  stk.dirty = false;
  stk.interaction = null;
  pinchState = null;

  // Clear panel
  if (stk.panelEl) {
    stk.panelEl.innerHTML = '<div class="stk-layer-empty" style="padding:24px;text-align:center;color:var(--muted);font-size:0.72rem;">Load an image to start adding stickers.</div>';
  }
}

export function setCommitBlobCallback(fn) {
  stk.commitBlobCallback = fn;
}

export function fitCanvasToImage() {
  // Call after parent resize
  if (stk.overlayCanvas) {
    markDirty();
  }
}
