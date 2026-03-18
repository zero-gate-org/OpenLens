import Pica from "https://cdn.jsdelivr.net/npm/pica@9.0.1/+esm";

const pica = new Pica();

const dom = {
  dropzone: document.querySelector("#dropzone"),
  fileInput: document.querySelector("#file-input"),
  pickFile: document.querySelector("#pick-file"),
  editorPanel: document.querySelector("#editor-panel"),
  cropImage: document.querySelector("#crop-image"),
  previewImage: document.querySelector("#preview-image"),
  fileName: document.querySelector("#file-name"),
  metaDimensions: document.querySelector("#meta-dimensions"),
  metaFormat: document.querySelector("#meta-format"),
  metaSize: document.querySelector("#meta-size"),
  metaHistory: document.querySelector("#meta-history"),
  statusText: document.querySelector("#status-text"),
  progressBar: document.querySelector("#progress-bar"),
  undoButton: document.querySelector("#undo-button"),
  resetButton: document.querySelector("#reset-button"),
  downloadButton: document.querySelector("#download-button"),
  cropWidth: document.querySelector("#crop-width"),
  cropHeight: document.querySelector("#crop-height"),
  applyCrop: document.querySelector("#apply-crop"),
  aspectRatio: document.querySelector("#aspect-ratio"),
  resizeWidth: document.querySelector("#resize-width"),
  resizeHeight: document.querySelector("#resize-height"),
  lockRatio: document.querySelector("#lock-ratio"),
  applyResize: document.querySelector("#apply-resize"),
  rotateLeft: document.querySelector("#rotate-left"),
  rotateRight: document.querySelector("#rotate-right"),
  rotateAngle: document.querySelector("#rotate-angle"),
  applyRotate: document.querySelector("#apply-rotate"),
  formatSelect: document.querySelector("#format-select"),
  qualityRange: document.querySelector("#quality-range"),
  qualityOutput: document.querySelector("#quality-output"),
  applyConvert: document.querySelector("#apply-convert"),
  bgModel: document.querySelector("#bg-model"),
  removeBackground: document.querySelector("#remove-background"),
  tvoText: document.querySelector("#tvo-text"),
  tvoFontFamily: document.querySelector("#tvo-font-family"),
  tvoFontSize: document.querySelector("#tvo-font-size"),
  tvoFontSizeVal: document.querySelector("#tvo-font-size-val"),
  tvoFontColor: document.querySelector("#tvo-font-color"),
  tvoFontBold: document.querySelector("#tvo-font-bold"),
  tvoLetterSpacing: document.querySelector("#tvo-letter-spacing"),
  tvoLetterSpacingVal: document.querySelector("#tvo-letter-spacing-val"),
  tvoShadow: document.querySelector("#tvo-shadow"),
  tvoAlignBtns: document.querySelectorAll(".btn-toggle[data-align]"),
  tvoFgStatus: document.querySelector("#tvo-fg-status"),
  tvoLoadFg: document.querySelector("#tvo-load-fg"),
  tvoLayerPanel: document.querySelector("#tvo-layer-panel"),
  tvoPreview: document.querySelector("#tvo-preview"),
  tvoApply: document.querySelector("#tvo-apply"),
  canvasArea: document.querySelector(".canvas-area"),
  cropSurface: document.querySelector(".crop-surface"),
};

const state = {
  cropper: null,
  original: null,
  current: null,
  history: [],
  busy: false,
  fabricCanvas: null,
  fabricObjects: { background: null, text: null, foreground: null },
  fabricInitialized: false,
  textoverlayPreviewMode: false,
  textoverlayLayers: [],
  draggedLayerIndex: null,
  tvoForegroundReady: false,
};

const MIME_BY_FORMAT = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function createImageState({ blob, name, width, height }) {
  const format = inferFormat(blob.type || "", name);
  return {
    blob,
    name: renameExtension(name || "image", format),
    width,
    height,
    mime: MIME_BY_FORMAT[format] || blob.type || "image/png",
    format,
  };
}

function inferFormat(mime, name = "") {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "webp") return "webp";
  return "png";
}

function renameExtension(name, format) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  const ext = format === "jpeg" ? "jpg" : format;
  return `${base}.${ext}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setBusy(isBusy) {
  state.busy = isBusy;
  document.querySelectorAll("button, input, select").forEach((element) => {
    const isTVOControl = element.closest('[data-panel="textoverlay"]');
    const isFabricCanvas = element.closest(".textoverlay-canvas-wrap");
    if (!element.closest(".dropzone") && !element.closest(".view-landing") && !element.classList.contains("back-btn") && !element.classList.contains("tool-switcher") && !isTVOControl && !isFabricCanvas) {
      element.disabled = isBusy;
    }
  });
  dom.pickFile.disabled = false;
}

function setStatus(message, progress = 0) {
  dom.statusText.textContent = message;
  dom.progressBar.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
}

function revokeUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

function destroyCropper() {
  if (state.cropper) {
    state.cropper.destroy();
    state.cropper = null;
  }
}

function ensureCropper() {
  if (!state.current || state.cropper) return;
  if (!window.Cropper) {
    throw new Error("CropperJS failed to load.");
  }

  if (!dom.cropImage.complete || dom.cropImage.naturalWidth === 0) {
    dom.cropImage.onload = () => {
      dom.cropImage.onload = null;
      ensureCropper();
    };
    return;
  }

  state.cropper = new window.Cropper(dom.cropImage, {
    viewMode: 1,
    dragMode: "move",
    responsive: true,
    background: false,
    autoCropArea: 0.84,
    restore: false,
    ready() {
      // Make the crop box clearly visible/active on first sight by defaulting
      // to a slightly smaller selector than the image preview.
      const canvasData = this.cropper.getCanvasData();
      const size = Math.min(canvasData.width, canvasData.height) * 0.78;
      const left = canvasData.left + (canvasData.width - size) / 2;
      const top = canvasData.top + (canvasData.height - size) / 2;
      this.cropper.setCropBoxData({ left, top, width: size, height: size });
    },
    crop(event) {
      dom.cropWidth.value = Math.round(event.detail.width);
      dom.cropHeight.value = Math.round(event.detail.height);
    },
  });

  applyAspectRatio();
}

function loadImageElementFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      revokeUrl(url);
      resolve(image);
    };
    image.onerror = () => {
      revokeUrl(url);
      reject(new Error("Failed to decode image"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode image"));
      },
      mime,
      quality
    );
  });
}

function pushHistory(label) {
  if (!state.current) return;
  state.history.push({
    label,
    snapshot: {
      ...state.current,
      previewUrl: URL.createObjectURL(state.current.blob),
    },
  });
  if (state.history.length > 12) {
    const removed = state.history.shift();
    if (removed?.snapshot?.previewUrl) revokeUrl(removed.snapshot.previewUrl);
  }
}

function clearHistory() {
  state.history.forEach((entry) => {
    if (entry.snapshot?.previewUrl) revokeUrl(entry.snapshot.previewUrl);
  });
  state.history = [];
}

async function renderCurrentImage() {
  if (!state.current) return;

  dom.editorPanel.classList.remove("is-hidden");
  dom.dropzone.classList.add("has-image");
  dom.fileName.textContent = state.current.name;
  dom.previewImage.src = state.current.previewUrl;
  dom.metaDimensions.textContent = `${state.current.width} × ${state.current.height}`;
  dom.metaFormat.textContent = state.current.format.toUpperCase();
  dom.metaSize.textContent = formatBytes(state.current.blob.size);
  dom.metaHistory.textContent = `${state.history.length} step${state.history.length === 1 ? "" : "s"}`;

  dom.resizeWidth.value = state.current.width;
  dom.resizeHeight.value = state.current.height;
  dom.formatSelect.value = state.current.format;

  const isTextoverlayActive = toolSwitcher?.value === "textoverlay";

  if (!isTextoverlayActive) {
    destroyCropper();
    await new Promise((resolve, reject) => {
      dom.cropImage.onload = resolve;
      dom.cropImage.onerror = reject;
      dom.cropImage.src = state.current.previewUrl;
    });
    fitCanvasToImagePreview();
    if (toolSwitcher?.value === "crop") ensureCropper();
  } else {
    tvoDestroy();
    fitCanvasToImagePreview();
    tvoUpdateFgStatus();
    await tvoInitAsync();
  }
  syncUndoButtons();
}

function fitCanvasToImagePreview() {
  const canvasArea = document.querySelector(".canvas-area");
  const cropSurface = document.querySelector(".crop-surface");
  if (!canvasArea || !cropSurface || !state.current) return;

  // Keep the visual "canvas" a bit larger than the image when space allows.
  // If the image is too large for the viewport, it will naturally scale down
  // in the preview (CropperJS fits to container). This does NOT change the
  // underlying uploaded blob in any way.
  const availableW = Math.max(0, canvasArea.clientWidth - 48); // canvas-area has padding
  const availableH = Math.max(0, canvasArea.clientHeight - 48);
  if (availableW === 0 || availableH === 0) return;

  const pad = 56; // visual breathing room around image
  const desiredW = state.current.width + pad;
  const desiredH = state.current.height + pad;

  const scale = Math.min(1, availableW / desiredW, availableH / desiredH);
  const surfaceW = Math.max(220, Math.floor(desiredW * scale));
  const surfaceH = Math.max(220, Math.floor(desiredH * scale));

  cropSurface.style.width = `${surfaceW}px`;
  cropSurface.style.height = `${surfaceH}px`;
}

window.addEventListener("resize", () => {
  if (!state.current) return;
  // Re-fit the preview container; if a cropper exists, force it to reflow.
  fitCanvasToImagePreview();
  if (state.cropper) state.cropper.resize();
});

function syncUndoButtons() {
  const disabled = !state.current || state.busy;
  dom.undoButton.disabled = disabled || state.history.length === 0;
  dom.resetButton.disabled = disabled || !state.original;
  dom.downloadButton.disabled = disabled;
}

async function setImageState(nextImage) {
  if (state.current?.previewUrl) revokeUrl(state.current.previewUrl);

  state.current = {
    ...nextImage,
    previewUrl: URL.createObjectURL(nextImage.blob),
  };

  await renderCurrentImage();
}

async function commitBlob(blob, label, name) {
  if (!state.current) return;
  pushHistory(label);
  const image = await loadImageElementFromBlob(blob);
  await setImageState(
    createImageState({
      blob,
      name: name || state.current.name,
      width: image.naturalWidth,
      height: image.naturalHeight,
    })
  );
}

function currentQuality() {
  return Number(dom.qualityRange.value) / 100;
}

function applyAspectRatio() {
  if (!state.cropper) return;
  const value = dom.aspectRatio.value;
  state.cropper.setAspectRatio(value === "free" ? NaN : Number(value));
}

function syncLockedDimensions(from) {
  if (!state.current || !dom.lockRatio.checked) return;
  const ratio = state.current.width / state.current.height;

  if (from === "width") {
    const width = Number(dom.resizeWidth.value);
    if (Number.isFinite(width) && width > 0) {
      dom.resizeHeight.value = Math.max(1, Math.round(width / ratio));
    }
  }

  if (from === "height") {
    const height = Number(dom.resizeHeight.value);
    if (Number.isFinite(height) && height > 0) {
      dom.resizeWidth.value = Math.max(1, Math.round(height * ratio));
    }
  }
}

async function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("Choose a valid image file.", 0);
    return;
  }

  setBusy(true);
  setStatus("Loading image locally...", 18);

  try {
    const image = await loadImageElementFromBlob(file);
    destroyCropper();
    clearHistory();
    state.original = createImageState({
      blob: file,
      name: file.name || "image.png",
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    switchToEditor(toolSwitcher?.value || "crop");
    await setImageState(state.original);
    setStatus("Image ready. All edits stay in the browser.", 100);
  } catch (error) {
    console.error(error);
    setStatus("This file could not be decoded in the browser.", 0);
  } finally {
    setBusy(false);
    syncUndoButtons();
  }
}

async function withOperation(label, action) {
  if (!state.current || state.busy) return;

  setBusy(true);
  try {
    await action();
    setStatus(`${label} complete.`, 100);
  } catch (error) {
    console.error(error);
    setStatus(error.message || `${label} failed.`, 0);
  } finally {
    setBusy(false);
    syncUndoButtons();
  }
}

async function applyCrop() {
  if (!state.cropper || !state.current) return;

  await withOperation("Crop", async () => {
    setStatus("Cropping image...", 35);
    const canvas = state.cropper.getCroppedCanvas({
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    });
    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);
    await commitBlob(blob, "Crop", state.current.name);
  });
}

async function applyResize() {
  if (!state.current) return;

  const width = Math.max(1, Number(dom.resizeWidth.value));
  const height = Math.max(1, Number(dom.resizeHeight.value));

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    setStatus("Resize values must be valid numbers.", 0);
    return;
  }

  await withOperation("Resize", async () => {
    setStatus("Resizing with high-quality resampling...", 28);
    const sourceImage = await loadImageElementFromBlob(state.current.blob);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = sourceImage.naturalWidth;
    sourceCanvas.height = sourceImage.naturalHeight;
    sourceCanvas.getContext("2d").drawImage(sourceImage, 0, 0);

    const destinationCanvas = document.createElement("canvas");
    destinationCanvas.width = width;
    destinationCanvas.height = height;

    try {
      await pica.resize(sourceCanvas, destinationCanvas, { quality: 3 });
    } catch (error) {
      console.warn("Pica resize failed, falling back to canvas drawImage.", error);
      const context = destinationCanvas.getContext("2d");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(sourceCanvas, 0, 0, width, height);
    }

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(destinationCanvas, mime, quality);
    await commitBlob(blob, "Resize", state.current.name);
  });
}

async function rotateBy(degrees) {
  if (!state.current) return;

  await withOperation(`Rotate ${degrees}°`, async () => {
    setStatus(`Rotating ${degrees}°...`, 24);
    const image = await loadImageElementFromBlob(state.current.blob);
    const radians = (degrees * Math.PI) / 180;
    const normalized = ((degrees % 360) + 360) % 360;
    const rightAngle = normalized === 90 || normalized === 270;
    const canvas = document.createElement("canvas");
    if (rightAngle) {
      canvas.width = image.naturalHeight;
      canvas.height = image.naturalWidth;
    } else if (normalized === 0 || normalized === 180) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
    } else {
      const sin = Math.abs(Math.sin(radians));
      const cos = Math.abs(Math.cos(radians));
      canvas.width = Math.ceil(image.naturalWidth * cos + image.naturalHeight * sin);
      canvas.height = Math.ceil(image.naturalWidth * sin + image.naturalHeight * cos);
    }
    const context = canvas.getContext("2d");
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(radians);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

    const mime = MIME_BY_FORMAT[state.current.format] || "image/png";
    const quality = state.current.format === "png" ? undefined : currentQuality();
    const blob = await canvasToBlob(canvas, mime, quality);
    await commitBlob(blob, "Rotate", state.current.name);
  });
}

async function applyConvert() {
  if (!state.current) return;

  await withOperation("Convert", async () => {
    const targetFormat = dom.formatSelect.value;
    const targetMime = MIME_BY_FORMAT[targetFormat];
    const quality = targetFormat === "png" ? undefined : currentQuality();
    setStatus(`Encoding ${targetFormat.toUpperCase()} locally...`, 34);

    const image = await loadImageElementFromBlob(state.current.blob);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");

    if (targetFormat === "jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(image, 0, 0);
    const blob = await canvasToBlob(canvas, targetMime, quality);
    const nextName = renameExtension(state.current.name, targetFormat);
    await commitBlob(blob, "Convert", nextName);
  });
}

let bgRemovalModulePromise = null;

async function getBackgroundRemovalModule() {
  if (!bgRemovalModulePromise) {
    bgRemovalModulePromise = import(
      "https://cdn.jsdelivr.net/npm/@imgly/background-removal/+esm"
    );
  }
  return bgRemovalModulePromise;
}

async function applyBackgroundRemoval() {
  if (!state.current) return;

  await withOperation("Background removal", async () => {
    setStatus("Loading background removal model...", 10);
    const { removeBackground } = await getBackgroundRemovalModule();
    const model = dom.bgModel.value;

    const blob = await removeBackground(state.current.blob, {
      model,
      progress(key, current, total) {
        const ratio = total > 0 ? Math.round((current / total) * 100) : 0;
        const phase = String(key).includes("download") ? "Downloading model" : "Removing background";
        setStatus(`${phase}... ${ratio}%`, ratio);
      },
    });

    const nextName = renameExtension(state.current.name, "png");
    await commitBlob(blob, "Background removal", nextName);
  });
}

// ============================================================
// TEXT BEHIND OBJECT (FABRIC.JS LAYER EDITOR)
// ============================================================

function tvoSetStatus(msg) {
  setStatus(msg);
}

function tvoHasTransparentForeground() {
  if (!state.current) return false;
  if (!state.tvoForegroundReady) return false;
  return state.current && state.current.format === "png";
}

function tvoGetTextProps() {
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

function tvoApplyTextProps(textObj) {
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

async function tvoInitAsync() {
  if (!state.current) return;
  if (state.fabricInitialized) return;

  destroyCropper();

  const originalBlob = state.original ? state.original.blob : state.current.blob;

  if (!tvoHasTransparentForeground()) {
    tvoSetStatus("Detecting foreground object...", 10);
    dom.tvoFgStatus.textContent = "Automatically detecting foreground object...";
    dom.tvoFgStatus.style.color = "var(--accent)";

    try {
      const { removeBackground } = await getBackgroundRemovalModule();
      const blob = await removeBackground(state.current.blob, {
        model: dom.bgModel?.value || "medium",
        progress(key, current, total) {
          const ratio = total > 0 ? Math.round((current / total) * 100) : 0;
          const phase = String(key).includes("download") ? "Downloading model" : "Detecting foreground";
          setStatus(`${phase}... ${ratio}%`, ratio);
        },
      });

      const image = await loadImageElementFromBlob(blob);
      state.current = createImageState({
        blob,
        name: renameExtension(state.current.name, "png"),
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      pushHistory("Foreground detection");
      tvoSetStatus("Foreground detected. Setting up editor...", 60);
    } catch (err) {
      console.error(err);
      tvoSetStatus("Foreground detection failed. Using original image.", 0);
      dom.tvoFgStatus.textContent = "Detection failed. Proceeding with original image.";
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
  tvoSetStatus("Text Behind Object ready. Drag text to position, reorder layers below.", 100);

  window.addEventListener("resize", tvoOnResize);
}

function tvoDestroy() {
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

function tvoOnResize() {
  if (!state.fabricCanvas || !state.current) return;
  tvoDestroy();
  tvoInitAsync();
}

function tvoUpdateFgStatus() {
  if (!state.current) return;
  if (tvoHasTransparentForeground()) {
    dom.tvoFgStatus.textContent = "Foreground object detected. Drag text to position, reorder layers below.";
    dom.tvoFgStatus.style.color = "var(--accent)";
  } else {
    dom.tvoFgStatus.textContent = "Foreground will be detected automatically when you enter this tool.";
    dom.tvoFgStatus.style.color = "var(--muted)";
  }
}

async function tvoLoadForeground() {
  if (!state.fabricCanvas || !state.current) return;

  tvoDestroy();
  tvoSetStatus("Re-detecting foreground object...", 10);
  dom.tvoFgStatus.textContent = "Re-detecting foreground object...";

  try {
    const { removeBackground } = await getBackgroundRemovalModule();
    const blob = await removeBackground(state.current.blob, {
      model: dom.bgModel?.value || "medium",
      progress(key, current, total) {
        const ratio = total > 0 ? Math.round((current / total) * 100) : 0;
        const phase = String(key).includes("download") ? "Downloading model" : "Detecting foreground";
        setStatus(`${phase}... ${ratio}%`, ratio);
      },
    });

    const image = await loadImageElementFromBlob(blob);
    const newBlob = blob;
    const nextName = renameExtension(state.current.name, "png");

    state.current = createImageState({
      blob: newBlob,
      name: nextName,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    pushHistory("Foreground re-detection");

    tvoSetStatus("Foreground re-detected. Setting up editor...", 70);
    await tvoInitAsync();
  } catch (err) {
    console.error(err);
    tvoSetStatus("Foreground re-detection failed.", 0);
    dom.tvoFgStatus.textContent = "Re-detection failed. Try again.";
    dom.tvoFgStatus.style.color = "var(--danger)";
  }
}

function tvoBuildLayerPanel() {
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

async function tvoApply() {
  if (!state.fabricCanvas || !state.current) return;

  tvoSetStatus("Compositing layers...", 30);

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
    await commitBlob(blob, "Text Behind Object", nextName);
    state.tvoForegroundReady = false;

    tvoSetStatus("Text behind object applied.", 100);
  } catch (err) {
    console.error(err);
    tvoSetStatus("Failed to apply text behind object.", 0);
  }
}

function undo() {
  if (state.history.length === 0 || state.busy) return;
  const previous = state.history.pop();
  if (!previous) return;

  setBusy(true);
  setStatus(`Restored ${previous.label}.`, 100);
  setImageState(previous.snapshot)
    .finally(() => {
      revokeUrl(previous.snapshot.previewUrl);
      setBusy(false);
      syncUndoButtons();
    });
}

function resetToOriginal() {
  if (!state.original || state.busy) return;
  setBusy(true);
  clearHistory();
  setStatus("Restoring original image...", 30);

  setImageState(state.original)
    .then(() => {
      setStatus("Original image restored.", 100);
    })
    .finally(() => {
      setBusy(false);
      syncUndoButtons();
    });
}

function downloadCurrent() {
  if (!state.current) return;
  const link = document.createElement("a");
  link.href = state.current.previewUrl;
  link.download = state.current.name;
  link.click();
}

function handleDrop(event) {
  event.preventDefault();
  dom.dropzone.classList.remove("is-active");
  const [file] = event.dataTransfer.files || [];
  if (file) loadFile(file);
}

dom.pickFile.addEventListener("click", (event) => {
  event.stopPropagation();
  dom.fileInput.click();
});
dom.dropzone.addEventListener("click", () => dom.fileInput.click());
dom.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dom.dropzone.classList.add("is-active");
});
dom.dropzone.addEventListener("dragleave", () => {
  dom.dropzone.classList.remove("is-active");
});
dom.dropzone.addEventListener("drop", handleDrop);
dom.dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    dom.fileInput.click();
  }
});
dom.fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (file) loadFile(file);
  event.target.value = "";
});

dom.cropWidth.addEventListener("input", () => {
  if (!state.cropper) return;
  const w = Number(dom.cropWidth.value);
  if (w > 0) state.cropper.setData({ width: w });
});
dom.cropHeight.addEventListener("input", () => {
  if (!state.cropper) return;
  const h = Number(dom.cropHeight.value);
  if (h > 0) state.cropper.setData({ height: h });
});
dom.aspectRatio.addEventListener("change", applyAspectRatio);
dom.resizeWidth.addEventListener("input", () => syncLockedDimensions("width"));
dom.resizeHeight.addEventListener("input", () => syncLockedDimensions("height"));
dom.qualityRange.addEventListener("input", () => {
  dom.qualityOutput.textContent = `${dom.qualityRange.value}%`;
});

dom.applyCrop.addEventListener("click", applyCrop);
dom.applyResize.addEventListener("click", applyResize);
dom.rotateLeft.addEventListener("click", () => rotateBy(-90));
dom.rotateRight.addEventListener("click", () => rotateBy(90));
dom.applyRotate.addEventListener("click", () => rotateBy(Number(dom.rotateAngle.value) || 0));
dom.applyConvert.addEventListener("click", applyConvert);
dom.removeBackground.addEventListener("click", applyBackgroundRemoval);
dom.undoButton.addEventListener("click", undo);
dom.resetButton.addEventListener("click", resetToOriginal);
dom.downloadButton.addEventListener("click", downloadCurrent);

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
dom.tvoLoadFg.addEventListener("click", tvoLoadForeground);
dom.tvoApply.addEventListener("click", tvoApply);

// --- Tool sidebar switching ---
const toolSwitcher = document.querySelector("#tool-switcher");

async function activateTool(tool) {
  if (tool === "textoverlay") {
    document.querySelectorAll(".sidebar-panel").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === tool);
    });
    if (toolSwitcher.value !== tool) toolSwitcher.value = tool;
    dom.cropSurface.style.display = "none";
    tvoDestroy();
    if (state.current) {
      await tvoInitAsync();
    }
    return;
  }

  tvoDestroy();
  dom.cropSurface.style.display = "";

  document.querySelectorAll(".sidebar-panel").forEach((p) => {
    p.classList.toggle("is-active", p.dataset.panel === tool);
  });
  if (toolSwitcher.value !== tool) toolSwitcher.value = tool;

  if (tool === "crop") {
    fitCanvasToImagePreview();
    ensureCropper();
  } else {
    destroyCropper();
  }
}

toolSwitcher.addEventListener("change", () => {
  activateTool(toolSwitcher.value);
});

// --- View switching: landing <-> editor ---
const appEl = document.querySelector(".app");

function switchToEditor(tool) {
  appEl.dataset.view = "editor";
  activateTool(tool);
}

function switchToLanding() {
  appEl.dataset.view = "landing";
}

document.querySelectorAll(".tool-card").forEach((card) => {
  card.addEventListener("click", () => {
    switchToEditor(card.dataset.selectTool);
  });
});

document.querySelector("#back-to-landing").addEventListener("click", switchToLanding);

syncUndoButtons();
