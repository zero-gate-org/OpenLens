import { state } from "../core/state.js";
import { dom } from "../core/dom.js";
import { setBusy, setStatus, loadImageElementFromBlob, canvasToBlob, renameExtension } from "../core/utils.js";
import { FRIENDLY_STATUS, progressMessage } from "../core/messages.js";
import { getBackgroundRemovalModule } from "./background-removal.js";
import { destroyCropper } from "./crop.js";
import { pushHistory } from "../file-handler.js";

export function tvoHasTransparentForeground() {
  if (!state.current) return false;
  if (!state.tvoForegroundReady) return false;
  return state.current && state.current.format === "png";
}

export function tvoGetTextProps() {
  const fontFamily = dom.tvoFontFamily.value;
  const fontSize = Number(dom.tvoFontSize.value);
  const fontColor = dom.tvoFontColor.value;
  const fontBold = dom.tvoFontBold.checked;
  const letterSpacing = Number(dom.tvoLetterSpacing.value);
  const textShadow = dom.tvoShadow.checked;
  const activeAlign = document.querySelector(".btn-toggle[data-align].active");
  const textAlign = activeAlign ? activeAlign.dataset.align : "center";
  return { fontFamily, fontSize, fontColor, fontBold, letterSpacing, textShadow, textAlign };
}

export function tvoApplyTextProps(textObj) {
  const props = tvoGetTextProps();
  textObj.set({
    fontFamily: props.fontFamily,
    fontSize: props.fontSize,
    fill: props.fontColor,
    fontWeight: props.fontBold ? "bold" : "normal",
    charSpacing: Math.round(props.letterSpacing * 100 / props.fontSize),
    textAlign: props.textAlign,
    shadow: props.textShadow ? {
      color: "rgba(0,0,0,0.5)",
      blur: 8,
      offsetX: 2,
      offsetY: 2,
    } : null,
  });
  textObj.setCoords();
  state.fabricCanvas.renderAll();
}

export async function tvoInitAsync(syncUndoCallback) {
  if (!state.current) return;
  if (state.fabricInitialized) return;

  destroyCropper();
  setBusy(true);

  const originalBlob = state.original ? state.original.blob : state.current.blob;

  if (!tvoHasTransparentForeground()) {
    setStatus(FRIENDLY_STATUS.gettingReady, 10);
    dom.tvoFgStatus.textContent = "Preparing your cutout…";
    dom.tvoFgStatus.style.color = "var(--accent)";

    try {
      const { removeBackground } = await getBackgroundRemovalModule();
      const blob = await removeBackground(state.current.blob, {
        model: dom.bgModel?.value || "medium",
        progress(key, current, total) {
          const ratio = total > 0 ? Math.round((current / total) * 100) : 0;
          const phase = progressMessage({ key });
          setStatus(`${phase} ${ratio}%`, ratio);
        },
      });

      const image = await loadImageElementFromBlob(blob);
      const { createImageState } = await import("../core/utils.js");
      state.current = createImageState({
        blob,
        name: renameExtension(state.current.name, "png"),
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      pushHistory("Foreground detection");
      setStatus("Ready.", 60);
    } catch (err) {
      console.error(err);
      setStatus("Couldn’t prepare cutout. Using original image.", 0);
      dom.tvoFgStatus.textContent = "Couldn’t prepare cutout. Using original image.";
      dom.tvoFgStatus.style.color = "var(--danger)";
    }
  }

  const canvasEl = document.createElement("canvas");
  canvasEl.id = "fabric-canvas";

  const wrap = document.createElement("div");
  wrap.className = "textoverlay-canvas-wrap";
  wrap.appendChild(canvasEl);

  dom.canvasArea.style.position = "relative";
  dom.canvasArea.style.overflow = "hidden";
  dom.canvasArea.appendChild(wrap);

  state.fabricCanvas = new fabric.Canvas("fabric-canvas", {
    selection: true,
    preserveObjectStacking: true,
  });

  const canvasW = dom.canvasArea.clientWidth - 48;
  const canvasH = dom.canvasArea.clientHeight - 48;

  const origImg = await loadImageElementFromBlob(originalBlob);
  const scale = Math.min(1, canvasW / origImg.naturalWidth, canvasH / origImg.naturalHeight);
  const dispW = Math.round(origImg.naturalWidth * scale);
  const dispH = Math.round(origImg.naturalHeight * scale);

  state.fabricCanvas.setWidth(dispW);
  state.fabricCanvas.setHeight(dispH);

  const fabricBg = new fabric.Image(origImg, {
    selectable: false,
    evented: false,
  });
  fabricBg.scaleToWidth(dispW);
  state.fabricCanvas.backgroundImage = fabricBg;
  state.fabricObjects.background = fabricBg;

  const textObj = new fabric.IText(dom.tvoText.value || "Your Text Here", {
    left: dispW / 2,
    top: dispH / 2,
    originX: "center",
    originY: "center",
    editable: true,
  });
  tvoApplyTextProps(textObj);
  state.fabricCanvas.add(textObj);

  if (state.current.blob) {
    const fgImg = await loadImageElementFromBlob(state.current.blob);
    const fabricFg = new fabric.Image(fgImg, {
      selectable: true,
      hasControls: true,
      hasBorders: true,
      cornerColor: "rgba(171,255,203,0.8)",
      cornerStrokeColor: "rgba(171,255,203,0.8)",
      transparentCorners: false,
      borderColor: "rgba(171,255,203,0.6)",
    });
    fabricFg.scaleToWidth(dispW);
    fabricFg.set({
      left: dispW / 2,
      top: dispH / 2,
      originX: "center",
      originY: "center",
    });
    fabricFg.setCoords();
    state.fabricCanvas.add(fabricFg);
    state.fabricObjects.foreground = fabricFg;

    const textIdx = state.fabricCanvas.getObjects().indexOf(textObj);
    const fgIdx = state.fabricCanvas.getObjects().indexOf(fabricFg);
    if (textIdx < fgIdx) {
      state.fabricCanvas.moveTo(textObj, fgIdx);
      state.fabricCanvas.moveTo(fabricFg, textIdx);
    }
  }

  state.fabricObjects.text = textObj;
  state.fabricCanvas.setActiveObject(textObj);

  state.fabricCanvas.renderAll();
  state.fabricInitialized = true;
  state.tvoForegroundReady = true;

  tvoUpdateFgStatus();
  tvoBuildLayerPanel();
  setStatus("Ready. Drag text to position, reorder layers below.", 100);

  setBusy(false);
  syncUndoCallback();

  window.addEventListener("resize", () => tvoOnResize(syncUndoCallback));
}

export function tvoDestroy() {
  if (!state.fabricInitialized) return;
  window.removeEventListener("resize", tvoOnResize);

  if (state.fabricCanvas) {
    state.fabricCanvas.dispose();
    state.fabricCanvas = null;
  }

  const wrap = dom.canvasArea.querySelector(".textoverlay-canvas-wrap");
  if (wrap) wrap.remove();

  dom.canvasArea.style.position = "";
  dom.canvasArea.style.overflow = "";
  dom.cropSurface.style.display = "";

  state.fabricObjects = { background: null, text: null, foreground: null };
  state.fabricInitialized = false;
  state.textoverlayPreviewMode = false;
  state.tvoForegroundReady = false;
  state.textoverlayLayers = [];
  state.draggedLayerIndex = null;
}

function tvoOnResize(syncUndoCallback) {
  if (!state.fabricCanvas || !state.current) return;
  tvoDestroy();
  tvoInitAsync(syncUndoCallback);
}

export function tvoUpdateFgStatus() {
  if (!state.current) return;
  if (tvoHasTransparentForeground()) {
    dom.tvoFgStatus.textContent = "Cutout ready. Drag text to position, reorder layers below.";
    dom.tvoFgStatus.style.color = "var(--accent)";
  } else {
    dom.tvoFgStatus.textContent = "We’ll prepare the cutout automatically when you open this tool.";
    dom.tvoFgStatus.style.color = "var(--muted)";
  }
}

export async function tvoLoadForeground(syncUndoCallback) {
  if (!state.fabricCanvas || !state.current) return;

  tvoDestroy();
  setBusy(true);
  setStatus(FRIENDLY_STATUS.gettingReady, 10);
  dom.tvoFgStatus.textContent = "Rebuilding cutout…";

  try {
    const { removeBackground } = await getBackgroundRemovalModule();
    const blob = await removeBackground(state.current.blob, {
      model: dom.bgModel?.value || "medium",
      progress(key, current, total) {
        const ratio = total > 0 ? Math.round((current / total) * 100) : 0;
        const phase = progressMessage({ key });
        setStatus(`${phase} ${ratio}%`, ratio);
      },
    });

    const image = await loadImageElementFromBlob(blob);
    const { createImageState } = await import("../core/utils.js");
    const nextName = renameExtension(state.current.name, "png");

    state.current = createImageState({
      blob,
      name: nextName,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    pushHistory("Foreground re-detection");

    setStatus("Ready.", 70);
    setBusy(false);
    await tvoInitAsync(syncUndoCallback);
  } catch (err) {
    console.error(err);
    setStatus("Couldn’t rebuild cutout. Try again.", 0);
    dom.tvoFgStatus.textContent = "Couldn’t rebuild cutout. Try again.";
    dom.tvoFgStatus.style.color = "var(--danger)";
    setBusy(false);
    syncUndoCallback();
  }
}

export function tvoBuildLayerPanel() {
  if (!dom.tvoLayerPanel) return;
  dom.tvoLayerPanel.innerHTML = "";

  const layers = [];

  layers.push({
    id: "background",
    name: "Background",
    sub: state.original ? `${state.original.width} × ${state.original.height}` : (state.current ? `${state.current.width} × ${state.current.height}` : "No image"),
    thumb: state.original ? state.original.previewUrl : (state.current ? state.current.previewUrl : null),
    locked: true,
    obj: state.fabricObjects.background,
    canvasIdx: -1,
  });

  const canvasObjs = state.fabricCanvas ? state.fabricCanvas.getObjects() : [];
  canvasObjs.forEach((obj) => {
    if (obj === state.fabricObjects.background) return;
    if (obj === state.fabricObjects.text) {
      layers.push({
        id: "text",
        name: "Text",
        sub: dom.tvoText.value || "Your Text Here",
        thumb: null,
        locked: false,
        obj,
        canvasIdx: canvasObjs.indexOf(obj),
      });
    }
    if (obj === state.fabricObjects.foreground) {
      layers.push({
        id: "foreground",
        name: "Foreground Object",
        sub: "Drag to resize",
        thumb: state.current ? state.current.previewUrl : null,
        locked: false,
        obj,
        canvasIdx: canvasObjs.indexOf(obj),
      });
    }
  });

  const finalLayers = layers.filter(Boolean);
  state.textoverlayLayers = finalLayers;

  finalLayers.forEach((layer, index) => {
    const item = document.createElement("div");
    item.className = "layer-item" + (layer.locked ? " locked" : "");
    item.dataset.index = index;
    item.draggable = !layer.locked;

    item.innerHTML = `
      <span class="layer-drag-handle">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
      </span>
      ${layer.thumb ? `<img class="layer-item-thumb" src="${layer.thumb}" alt="" />` : `<div class="layer-item-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg></div>`}
      <div class="layer-item-info">
        <div class="layer-item-name">${layer.name}</div>
        <div class="layer-item-sub">${layer.sub}</div>
      </div>
      <button class="layer-visibility ${layer.visible && !layer.locked ? "visible" : ""}" data-index="${index}" title="${layer.locked ? "Locked" : "Toggle visibility"}" ${layer.locked ? "disabled" : ""}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    `;

    if (!layer.locked) {
      item.addEventListener("dragstart", tvoOnLayerDragStart);
      item.addEventListener("dragover", tvoOnLayerDragOver);
      item.addEventListener("dragleave", tvoOnLayerDragLeave);
      item.addEventListener("drop", tvoOnLayerDrop);
      item.addEventListener("dragend", tvoOnLayerDragEnd);
    }

    const visBtn = item.querySelector(".layer-visibility");
    if (visBtn && !layer.locked && layer.obj) {
      const isVisible = state.fabricCanvas.getObjects().includes(layer.obj);
      visBtn.classList.toggle("visible", isVisible);
      visBtn.addEventListener("click", () => tvoToggleLayerVisibility(finalLayers.indexOf(layer)));
    }

    dom.tvoLayerPanel.appendChild(item);
  });
}

function tvoOnLayerDragStart(e) {
  const index = Number(e.currentTarget.dataset.index);
  state.draggedLayerIndex = index;
  e.dataTransfer.effectAllowed = "move";
  e.currentTarget.classList.add("dragging");
}

function tvoOnLayerDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const item = e.currentTarget;
  if (Number(item.dataset.index) !== state.draggedLayerIndex) {
    item.classList.add("drag-over");
  }
}

function tvoOnLayerDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function tvoOnLayerDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  const fromIdx = state.draggedLayerIndex;
  const toIdx = Number(e.currentTarget.dataset.index);
  if (fromIdx === null || isNaN(toIdx) || fromIdx === toIdx) return;

  const fromLayer = state.textoverlayLayers[fromIdx];
  const toLayer = state.textoverlayLayers[toIdx];
  if (!fromLayer || !toLayer) return;
  if (fromLayer.locked || toLayer.locked) return;
  if (!fromLayer.obj || !toLayer.obj) return;

  const fromObjIdx = fromLayer.canvasIdx;
  const toObjIdx = toLayer.canvasIdx;
  if (fromObjIdx < 0 || toObjIdx < 0) return;

  state.fabricCanvas.moveTo(fromLayer.obj, toObjIdx);
  state.fabricCanvas.moveTo(toLayer.obj, fromObjIdx);
  state.fabricCanvas.renderAll();
  tvoBuildLayerPanel();
}

function tvoOnLayerDragEnd(e) {
  e.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".layer-item").forEach((item) => {
    item.classList.remove("drag-over", "dragging");
  });
  state.draggedLayerIndex = null;
}

function tvoToggleLayerVisibility(index) {
  const layer = state.textoverlayLayers[index];
  if (!layer || layer.locked || !layer.obj) return;
  const isCurrentlyVisible = state.fabricCanvas.getObjects().includes(layer.obj);
  if (isCurrentlyVisible) {
    state.fabricCanvas.remove(layer.obj);
  } else {
    state.fabricCanvas.add(layer.obj);
  }
  state.fabricCanvas.renderAll();
  tvoBuildLayerPanel();
}

export async function tvoApply(commitBlobCallback) {
  if (!state.fabricCanvas || !state.current) return;

  setStatus(FRIENDLY_STATUS.compositing, 30);

  try {
    const origW = state.original ? state.original.width : state.current.width;
    const origH = state.original ? state.original.height : state.current.height;
    const maxDim = Math.max(origW, origH, 2000);
    const scale = maxDim / Math.max(origW, origH);
    const exportW = Math.round(origW * scale);
    const exportH = Math.round(origH * scale);

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = exportW;
    exportCanvas.height = exportH;

    const dispW = state.fabricCanvas.getWidth();
    const dispH = state.fabricCanvas.getHeight();
    const scaleX = exportW / dispW;
    const scaleY = exportH / dispH;

    const tempCanvas = state.fabricCanvas.toCanvasElement();
    const ctx = exportCanvas.getContext("2d");
    ctx.scale(scaleX, scaleY);
    ctx.drawImage(tempCanvas, 0, 0, dispW, dispH);

    const blob = await canvasToBlob(exportCanvas, "image/png", undefined);
    const nextName = renameExtension(state.current.name, "png");
    await commitBlobCallback(blob, "Text Behind Object", nextName);
    state.tvoForegroundReady = false;

    setStatus("Applied.", 100);
  } catch (err) {
    console.error(err);
    setStatus("Couldn’t apply changes.", 0);
  }
}

export function initTextOverlayListeners(commitBlobCallback, syncUndoCallback) {
  dom.tvoText.addEventListener("input", () => {
    if (!state.fabricObjects.text) return;
    state.fabricObjects.text.set("text", dom.tvoText.value || "Your Text Here");
    state.fabricCanvas.renderAll();
    tvoBuildLayerPanel();
  });
  
  dom.tvoFontFamily.addEventListener("change", () => {
    if (!state.fabricObjects.text) return;
    tvoApplyTextProps(state.fabricObjects.text);
  });
  
  dom.tvoFontSize.addEventListener("input", () => {
    dom.tvoFontSizeVal.textContent = `${dom.tvoFontSize.value}px`;
    if (!state.fabricObjects.text) return;
    tvoApplyTextProps(state.fabricObjects.text);
  });
  
  dom.tvoFontColor.addEventListener("input", () => {
    if (!state.fabricObjects.text) return;
    tvoApplyTextProps(state.fabricObjects.text);
  });
  
  dom.tvoFontBold.addEventListener("change", () => {
    if (!state.fabricObjects.text) return;
    tvoApplyTextProps(state.fabricObjects.text);
  });
  
  dom.tvoLetterSpacing.addEventListener("input", () => {
    dom.tvoLetterSpacingVal.textContent = `${dom.tvoLetterSpacing.value}px`;
    if (!state.fabricObjects.text) return;
    tvoApplyTextProps(state.fabricObjects.text);
  });
  
  dom.tvoShadow.addEventListener("change", () => {
    if (!state.fabricObjects.text) return;
    tvoApplyTextProps(state.fabricObjects.text);
  });
  
  dom.tvoAlignBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      dom.tvoAlignBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (!state.fabricObjects.text) return;
      tvoApplyTextProps(state.fabricObjects.text);
    });
  });
  
  dom.tvoLoadFg.addEventListener("click", () => tvoLoadForeground(syncUndoCallback));
  dom.tvoApply.addEventListener("click", () => tvoApply(commitBlobCallback));
}
