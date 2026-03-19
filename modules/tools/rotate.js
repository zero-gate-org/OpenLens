import { state, MIME_BY_FORMAT } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, currentQuality, canvasToBlob, loadImageElementFromBlob } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";

export async function rotateBy(degrees, commitBlobCallback) {
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
    await commitBlobCallback(blob, "Rotate", state.current.name);
  }, syncUndoButtons);
}

export function initRotateListeners(commitBlobCallback) {
  dom.rotateLeft.addEventListener("click", () => rotateBy(-90, commitBlobCallback));
  dom.rotateRight.addEventListener("click", () => rotateBy(90, commitBlobCallback));
  dom.applyRotate.addEventListener("click", () => rotateBy(Number(dom.rotateAngle.value) || 0, commitBlobCallback));
}
