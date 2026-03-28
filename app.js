// Core modules
import { state } from "./modules/core/state.js";
import { dom } from "./modules/core/dom.js";

// File handling
import { loadFile, commitBlob, undo, resetToOriginal, downloadCurrent, discardImage } from "./modules/file-handler.js";

// UI controller
import { 
  renderCurrentImage, 
  syncUndoButtons, 
  switchToEditor, 
  initViewSwitching, 
  initToolSwitcher, 
  initWindowResize 
} from "./modules/ui-controller.js";

// Tool modules
import { initCropListeners } from "./modules/tools/crop.js";
import { initResizeListeners } from "./modules/tools/resize.js";
import { initRotateListeners } from "./modules/tools/rotate.js";
import { initConvertListeners } from "./modules/tools/convert.js";
import { initBackgroundRemovalListeners } from "./modules/tools/background-removal.js";
import { initSelectiveBlurListeners } from "./modules/tools/selective-blur.js";
import { initTiltShiftListeners } from "./modules/tools/tilt-shift.js";
import { initTextOverlayListeners } from "./modules/tools/text-overlay.js";
import { initColorSplashListeners } from "./modules/tools/color-splash.js";
import { initShadowInjectionListeners } from "./modules/tools/shadow-injection.js";
import { initGradientMapListeners } from "./modules/tools/gradient-map.js";
import { initDuotoneListeners } from "./modules/tools/duotone.js";
import { initHalftoneListeners } from "./modules/tools/halftone.js";
import { initChromaticAberrationListeners } from "./modules/tools/chromatic-aberration.js";
import { initGlitchListeners } from "./modules/tools/glitch.js";
import { initFilmGrainListeners } from "./modules/tools/film-grain.js";
import { initLomoListeners } from "./modules/tools/lomo.js";
import { initOilPaintListeners } from "./modules/tools/oil-paint.js";
import { initSketchListeners } from "./modules/tools/sketch.js";
import { init as initStickers, destroy as destroyStickers, setCommitBlobCallback as setStickersCommitBlobCallback } from "./ui/stickers/stickers.js";

// Wrapper for commitBlob that includes rendering
async function commitBlobWithRender(blob, label, name) {
  await commitBlob(blob, label, name, async () => {
    await renderCurrentImage(document.querySelector("#tool-switcher"));
  });
}

// Initialize file input handlers
function initFileHandlers() {
  const handleDrop = (event) => {
    event.preventDefault();
    dom.dropzone.classList.remove("is-active");
    const [file] = event.dataTransfer.files || [];
    if (file) loadFile(file, 
      () => switchToEditor(document.querySelector("#tool-switcher")?.value || "crop"),
      async () => await renderCurrentImage(document.querySelector("#tool-switcher"))
    );
  };

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
    if (file) loadFile(file,
      () => switchToEditor(document.querySelector("#tool-switcher")?.value || "crop"),
      async () => await renderCurrentImage(document.querySelector("#tool-switcher"))
    );
    event.target.value = "";
  });
}

// Initialize undo/reset/download handlers
function initHistoryHandlers() {
  dom.undoButton.addEventListener("click", () => {
    undo(
      async () => await renderCurrentImage(document.querySelector("#tool-switcher")),
      syncUndoButtons
    );
  });

  dom.resetButton.addEventListener("click", () => {
    resetToOriginal(
      async () => await renderCurrentImage(document.querySelector("#tool-switcher")),
      syncUndoButtons
    );
  });

  dom.downloadButton.addEventListener("click", downloadCurrent);

  dom.discardImage?.addEventListener("click", () => {
    if (state.busy) return;
    discardImage();
    syncUndoButtons();
  });
}

// Initialize all tool listeners
function initToolListeners() {
  initCropListeners(commitBlobWithRender);
  initResizeListeners(commitBlobWithRender);
  initRotateListeners(commitBlobWithRender);
  initConvertListeners(commitBlobWithRender);
  initBackgroundRemovalListeners(commitBlobWithRender);
  initSelectiveBlurListeners(commitBlobWithRender);
  initTiltShiftListeners(commitBlobWithRender);
  initTextOverlayListeners(commitBlobWithRender, syncUndoButtons);
  initColorSplashListeners(commitBlobWithRender);
  initShadowInjectionListeners(commitBlobWithRender);
  initGradientMapListeners(commitBlobWithRender);
  initDuotoneListeners(commitBlobWithRender);
  initHalftoneListeners(commitBlobWithRender);
  initChromaticAberrationListeners(commitBlobWithRender);
  initGlitchListeners(commitBlobWithRender);
  initFilmGrainListeners(commitBlobWithRender);
  initLomoListeners(commitBlobWithRender);
  initOilPaintListeners(commitBlobWithRender);
  initSketchListeners(commitBlobWithRender);
}

// Initialize the application
function init() {
  initFileHandlers();
  initHistoryHandlers();
  initToolListeners();
  initViewSwitching();
  initToolSwitcher();
  initWindowResize();
  syncUndoButtons();
}

// Start the app
init();
