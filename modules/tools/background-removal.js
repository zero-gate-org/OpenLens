import { state } from "../core/state.js";
import { dom } from "../core/dom.js";
import { withOperation, setStatus, renameExtension } from "../core/utils.js";
import { syncUndoButtons } from "../ui-controller.js";
import { FRIENDLY_STATUS, progressMessage } from "../core/messages.js";

let bgRemovalModulePromise = null;

export async function getBackgroundRemovalModule() {
  if (!bgRemovalModulePromise) {
    bgRemovalModulePromise = import(
      "https://cdn.jsdelivr.net/npm/@imgly/background-removal/+esm"
    );
  }
  return bgRemovalModulePromise;
}

export async function applyBackgroundRemoval(commitBlobCallback) {
  if (!state.current) return;

  await withOperation("Background removal", async () => {
    setStatus(FRIENDLY_STATUS.gettingReady, 10);
    const { removeBackground } = await getBackgroundRemovalModule();
    const model = dom.bgModel.value;

    const blob = await removeBackground(state.current.blob, {
      model,
      progress(key, current, total) {
        const ratio = total > 0 ? Math.round((current / total) * 100) : 0;
        const phase = progressMessage({ key, defaultPhase: "Removing background…" });
        setStatus(`${phase} ${ratio}%`, ratio);
      },
    });

    const nextName = renameExtension(state.current.name, "png");
    await commitBlobCallback(blob, "Background removal", nextName);
  }, syncUndoButtons);
}

export function initBackgroundRemovalListeners(commitBlobCallback) {
  dom.removeBackground.addEventListener("click", () => applyBackgroundRemoval(commitBlobCallback));
}
