import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob, renameExtension } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS } from "../core/messages.js";

export async function applyConvert(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Convert", async () => {
    const targetFormat = dom.formatSelect.value;
    const targetMime = MIME_BY_FORMAT[targetFormat];
    const quality = targetFormat === "png" ? undefined : currentQuality();
    setStatus(FRIENDLY_STATUS.savingChanges, 34);

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
    await commitBlobCallback(blob, "Convert", nextName);
  }, syncUndoButtons);
}

export function initConvertListeners(commitBlobCallback) {
  dom.qualityRange.addEventListener("input", () => {
    dom.qualityOutput.textContent = `${dom.qualityRange.value}%`;
  });
  
  dom.applyConvert.addEventListener("click", () => applyConvert(commitBlobCallback));
}
