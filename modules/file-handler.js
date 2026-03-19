import { state } from "./core/state.js";
import { dom } from "./core/dom.js";
import { createImageState, setBusy, setStatus, revokeUrl, loadImageElementFromBlob } from "./core/utils.js";
import { destroyCropper } from "./tools/crop.js";

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
    switchToEditorCallback();
    await setImageState(state.original, renderCallback);
    setStatus("Image ready. All edits stay in the browser.", 100);
  } catch (error) {
    console.error(error);
    setStatus("This file could not be decoded in the browser.", 0);
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
  setStatus("Restoring original image...", 30);

  setImageState(state.original, renderCallback)
    .then(() => {
      setStatus("Original image restored.", 100);
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
