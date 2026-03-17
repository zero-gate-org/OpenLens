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
};

const state = {
  cropper: null,
  original: null,
  current: null,
  history: [],
  busy: false,
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
    if (!element.closest(".dropzone") && !element.closest(".view-landing") && !element.classList.contains("back-btn") && !element.classList.contains("tool-switcher")) {
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
  if (!window.Cropper) {
    throw new Error("CropperJS failed to load.");
  }

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

  destroyCropper();

  await new Promise((resolve, reject) => {
    dom.cropImage.onload = resolve;
    dom.cropImage.onerror = reject;
    dom.cropImage.src = state.current.previewUrl;
  });

  fitCanvasToImagePreview();

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

// --- Tool sidebar switching ---
const toolSwitcher = document.querySelector("#tool-switcher");

function activateTool(tool) {
  document.querySelectorAll(".sidebar-panel").forEach((p) => {
    p.classList.toggle("is-active", p.dataset.panel === tool);
  });
  if (toolSwitcher.value !== tool) toolSwitcher.value = tool;
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
