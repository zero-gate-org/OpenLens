import { state } from "./core/state.js";
import { dom } from "./core/dom.js";
import { createImageState, setBusy, setStatus, revokeUrl, loadImageElementFromBlob } from "./core/utils.js";
import { FRIENDLY_STATUS } from "./core/messages.js";
import { destroyCropper } from "./tools/crop.js";
import { clearBlurCache } from "./tools/selective-blur.js";
import { clearTiltShiftCache } from "./tools/tilt-shift.js";
import { tvoDestroy } from "./tools/text-overlay.js";
import { clearSplashCache } from "./tools/color-splash.js";
import { clearShadowCache } from "./tools/shadow-injection.js";
import { clearDuotoneCache } from "./tools/duotone.js";
import { clearGradientMapCache } from "./tools/gradient-map.js";
import { clearHalftoneCache } from "./tools/halftone.js";
import { clearChromaticAberrationCache } from "./tools/chromatic-aberration.js";
import { clearFilmGrainCache } from "./tools/film-grain.js";
import { clearOilPaintCache } from "./tools/oil-paint.js";
import { destroy as destroyCurvedText } from "./tools/curvedtext.js";
import { destroy as destroyStickers } from "./tools/stickers.js";
import { clearWatermarkCache } from "./tools/watermark.js";

export function pushHistory(label) {
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

export function clearHistory() {
  state.history.forEach((entry) => {
    if (entry.snapshot?.previewUrl) revokeUrl(entry.snapshot.previewUrl);
  });
  state.history = [];
}

export function discardImage() {
  // Drop any in-flight operation UI state
  setBusy(false);

  // Tool cleanups
  destroyCropper();
  clearBlurCache();
  clearTiltShiftCache();
  clearSplashCache();
  clearShadowCache();
  clearDuotoneCache();
  clearGradientMapCache();
  clearHalftoneCache();
  clearChromaticAberrationCache();
  clearFilmGrainCache();
  clearOilPaintCache();
  tvoDestroy();
  destroyCurvedText();
  destroyStickers();
  clearWatermarkCache();

  // Revoke object URLs
  if (state.current?.previewUrl) revokeUrl(state.current.previewUrl);
  clearHistory();

  // Reset state
  state.current = null;
  state.original = null;
  state.busy = false;

  // Reset UI
  dom.editorPanel.classList.add("is-hidden");
  dom.dropzone.classList.remove("has-image");
  dom.cropImage.src = "";
  dom.previewImage.src = "";
  dom.fileName.textContent = "No file loaded";
  dom.metaDimensions.textContent = "-";
  dom.metaFormat.textContent = "-";
  dom.metaSize.textContent = "-";
  dom.metaHistory.textContent = "0 steps";
  setStatus("Choose an image to start.", 0);
}

export async function setImageState(nextImage, renderCallback) {
  if (state.current?.previewUrl) revokeUrl(state.current.previewUrl);

  state.current = {
    ...nextImage,
    previewUrl: URL.createObjectURL(nextImage.blob),
  };

  if (renderCallback) await renderCallback();
}

export async function commitBlob(blob, label, name, renderCallback) {
  if (!state.current) return;
  pushHistory(label);
  const image = await loadImageElementFromBlob(blob);
  await setImageState(
    createImageState({
      blob,
      name: name || state.current.name,
      width: image.naturalWidth,
      height: image.naturalHeight,
    }),
    renderCallback
  );
}

export async function loadFile(file, switchToEditorCallback, renderCallback) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("Choose a valid image file.", 0);
    return;
  }

  setBusy(true);
  setStatus(FRIENDLY_STATUS.loadingImage, 18);

  try {
    const image = await loadImageElementFromBlob(file);
    destroyCropper();
    clearBlurCache();
    clearTiltShiftCache();
    clearSplashCache();
    clearShadowCache();
  clearDuotoneCache();
  clearGradientMapCache();
  clearHalftoneCache();
  clearChromaticAberrationCache();
  clearFilmGrainCache();
  clearOilPaintCache();
  destroyCurvedText();
  destroyStickers();
  clearWatermarkCache();
  clearHistory();
    state.original = createImageState({
      blob: file,
      name: file.name || "image.png",
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    switchToEditorCallback();
    await setImageState(state.original, renderCallback);
    setStatus("Image ready.", 100);
  } catch (error) {
    console.error(error);
    setStatus("Couldn’t open this image.", 0);
  } finally {
    setBusy(false);
  }
}

export function undo(renderCallback, syncUndoCallback) {
  if (state.history.length === 0 || state.busy) return;
  const previous = state.history.pop();
  if (!previous) return;

  setBusy(true);
  setStatus(`Restored ${previous.label}.`, 100);
  setImageState(previous.snapshot, renderCallback)
    .finally(() => {
      revokeUrl(previous.snapshot.previewUrl);
      setBusy(false);
      syncUndoCallback();
    });
}

export function resetToOriginal(renderCallback, syncUndoCallback) {
  if (!state.original || state.busy) return;
  setBusy(true);
  clearHistory();
  setStatus("Restoring original…", 30);

  setImageState(state.original, renderCallback)
    .then(() => {
      setStatus("Restored.", 100);
    })
    .finally(() => {
      setBusy(false);
      syncUndoCallback();
    });
}

export function downloadCurrent() {
  if (!state.current) return;
  const link = document.createElement("a");
  link.href = state.current.previewUrl;
  link.download = state.current.name;
  link.click();
}
