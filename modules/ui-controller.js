import { state } from "./core/state.js";
import { dom } from "./core/dom.js";
import { formatBytes } from "./core/utils.js";
import { destroyCropper, ensureCropper } from "./tools/crop.js";
import { tvoDestroy, tvoInitAsync, tvoUpdateFgStatus } from "./tools/text-overlay.js";
import { activateBlurTool, deactivateBlurTool, clearBlurCache } from "./tools/selective-blur.js";
import { activateTiltShiftTool, deactivateTiltShiftTool } from "./tools/tilt-shift.js";
import { activateSplashTool, deactivateSplashTool, clearSplashCache } from "./tools/color-splash.js";
import { activateShadowTool, deactivateShadowTool, clearShadowCache } from "./tools/shadow-injection.js";
import { activateDuotoneTool, deactivateDuotoneTool, clearDuotoneCache } from "./tools/duotone.js";
import { activateGradientMapTool, deactivateGradientMapTool } from "./tools/gradient-map.js";
import { activateHalftoneTool, deactivateHalftoneTool } from "./tools/halftone.js";
import { activateChromaticAberrationTool, deactivateChromaticAberrationTool } from "./tools/chromatic-aberration.js";
import { activateGlitchTool, deactivateGlitchTool } from "./tools/glitch.js";
import { activateFilmGrainTool, deactivateFilmGrainTool } from "./tools/film-grain.js";
import { activateLomoTool, deactivateLomoTool, clearLomoCache } from "./tools/lomo.js";
import { activateOilPaintTool, deactivateOilPaintTool } from "./tools/oil-paint.js";
import { activateSketchTool, deactivateSketchTool, clearSketchCache } from "./tools/sketch.js";
import { init as initCurvedText, destroy as destroyCurvedText, setCommitBlobCallback } from "../ui/curvedtext/curvedtext.js";
import { init as initStrokeText, destroy as destroyStrokeText, setCommitBlobCallback as setStrokeCommitBlobCallback } from "../ui/stroketext/stroketext.js";
import { init as initStickers, destroy as destroyStickers, setCommitBlobCallback as setStickersCommitBlobCallback } from "../ui/stickers/stickers.js";
import { commitBlob, pushHistory } from "./file-handler.js";

export function syncUndoButtons() {
  const disabled = !state.current || state.busy;
  dom.undoButton.disabled = disabled || state.history.length === 0;
  dom.resetButton.disabled = disabled || !state.original;
  dom.downloadButton.disabled = disabled;
}

export async function renderCurrentImage(toolSwitcher) {
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
  const isCurvedtextActive = toolSwitcher?.value === "curvedtext";
  const isStroketextActive = toolSwitcher?.value === "stroketext";
  const isStickersActive = toolSwitcher?.value === "stickers";

  if (!isTextoverlayActive && !isCurvedtextActive && !isStroketextActive && !isStickersActive) {
    destroyCropper();
    destroyStickers();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    await new Promise((resolve, reject) => {
      dom.cropImage.onload = resolve;
      dom.cropImage.onerror = reject;
      dom.cropImage.src = state.current.previewUrl;
    });
    fitCanvasToImagePreview();
    if (toolSwitcher?.value === "crop") ensureCropper();
    if (toolSwitcher?.value === "blur") await activateBlurTool();
    if (toolSwitcher?.value === "tiltshift") await activateTiltShiftTool();
    if (toolSwitcher?.value === "colorsplash") await activateSplashTool();
    if (toolSwitcher?.value === "shadowinjection") await activateShadowTool();
    if (toolSwitcher?.value === "duotone") await activateDuotoneTool();
    if (toolSwitcher?.value === "gradientmap") await activateGradientMapTool();
    if (toolSwitcher?.value === "halftone") await activateHalftoneTool();
    if (toolSwitcher?.value === "chromaticaberration") await activateChromaticAberrationTool();
    if (toolSwitcher?.value === "glitch") await activateGlitchTool();
    if (toolSwitcher?.value === "filmgrain") await activateFilmGrainTool();
    if (toolSwitcher?.value === "lomo") await activateLomoTool();
    if (toolSwitcher?.value === "oilpaint") await activateOilPaintTool();
    if (toolSwitcher?.value === "sketch") await activateSketchTool();
  } else if (isTextoverlayActive) {
    tvoDestroy();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    fitCanvasToImagePreview();
    tvoUpdateFgStatus();
    await tvoInitAsync(syncUndoButtons);
  } else if (isCurvedtextActive) {
    destroyCurvedText();
    tvoDestroy();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    await new Promise((resolve, reject) => {
      dom.cropImage.onload = resolve;
      dom.cropImage.onerror = reject;
      dom.cropImage.src = state.current.previewUrl;
    });
    fitCanvasToImagePreview();
    dom.cropSurface.style.display = "";
    initCurvedText(
      dom.cropImage,
      () => state.current ? { ...state.current } : null,
      () => pushHistory("Curved Text")
    );
    setCommitBlobCallback((blob, label, name) => commitBlob(blob, label, name, async () => {
      await renderCurrentImage(document.querySelector("#tool-switcher"));
    }));
  } else if (isStroketextActive) {
    destroyStrokeText();
    destroyCurvedText();
    tvoDestroy();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    await new Promise((resolve, reject) => {
      dom.cropImage.onload = resolve;
      dom.cropImage.onerror = reject;
      dom.cropImage.src = state.current.previewUrl;
    });
    fitCanvasToImagePreview();
    dom.cropSurface.style.display = "";
    initStrokeText(
      dom.cropImage,
      () => state.current ? { ...state.current } : null,
      () => pushHistory("Stroke Text")
    );
    setStrokeCommitBlobCallback((blob, label, name) => commitBlob(blob, label, name, async () => {
      await renderCurrentImage(document.querySelector("#tool-switcher"));
    }));
  } else if (isStickersActive) {
    destroyStickers();
    destroyStrokeText();
    destroyCurvedText();
    tvoDestroy();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    await new Promise((resolve, reject) => {
      dom.cropImage.onload = resolve;
      dom.cropImage.onerror = reject;
      dom.cropImage.src = state.current.previewUrl;
    });
    fitCanvasToImagePreview();
    dom.cropSurface.style.display = "";
    initStickers(
      dom.cropImage,
      () => state.current ? { ...state.current } : null,
      () => pushHistory("Stickers")
    );
    setStickersCommitBlobCallback((blob, label, name) => commitBlob(blob, label, name, async () => {
      await renderCurrentImage(document.querySelector("#tool-switcher"));
    }));
  }
  syncUndoButtons();
}

export function fitCanvasToImagePreview() {
  const canvasArea = document.querySelector(".canvas-area");
  const cropSurface = document.querySelector(".crop-surface");
  if (!canvasArea || !cropSurface || !state.current) return;

  const availableW = Math.max(0, canvasArea.clientWidth - 48);
  const availableH = Math.max(0, canvasArea.clientHeight - 48);
  if (availableW === 0 || availableH === 0) return;

  const pad = 56;
  const desiredW = state.current.width + pad;
  const desiredH = state.current.height + pad;

  const scale = Math.min(1, availableW / desiredW, availableH / desiredH);
  const surfaceW = Math.max(220, Math.floor(desiredW * scale));
  const surfaceH = Math.max(220, Math.floor(desiredH * scale));

  cropSurface.style.width = `${surfaceW}px`;
  cropSurface.style.height = `${surfaceH}px`;
}

export async function activateTool(tool) {
  if (tool === "textoverlay") {
    document.querySelectorAll(".sidebar-panel").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === tool);
    });
    const toolSwitcher = document.querySelector("#tool-switcher");
    if (toolSwitcher.value !== tool) toolSwitcher.value = tool;
    dom.cropSurface.style.display = "none";
    tvoDestroy();
    destroyCurvedText();
    destroyStrokeText();
    destroyStickers();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await tvoInitAsync(syncUndoButtons);
    }
    return;
  }

  tvoDestroy();
  destroyCurvedText();
  destroyStrokeText();
  destroyStickers();
  dom.cropSurface.style.display = "";

  document.querySelectorAll(".sidebar-panel").forEach((p) => {
    p.classList.toggle("is-active", p.dataset.panel === tool);
  });
  const toolSwitcher = document.querySelector("#tool-switcher");
  if (toolSwitcher.value !== tool) toolSwitcher.value = tool;

  if (tool === "crop") {
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    fitCanvasToImagePreview();
    ensureCropper();
  } else if (tool === "blur") {
    destroyCropper();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateBlurTool();
    }
  } else if (tool === "tiltshift") {
    destroyCropper();
    deactivateBlurTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateTiltShiftTool();
    }
  } else if (tool === "colorsplash") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateSplashTool();
    }
  } else if (tool === "shadowinjection") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateShadowTool();
    }
  } else if (tool === "duotone") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateDuotoneTool();
    }
  } else if (tool === "gradientmap") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateGradientMapTool();
    }
  } else if (tool === "halftone") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateHalftoneTool();
    }
  } else if (tool === "chromaticaberration") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateChromaticAberrationTool();
    }
  } else if (tool === "glitch") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateGlitchTool();
    }
  } else if (tool === "filmgrain") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateFilmGrainTool();
    }
  } else if (tool === "lomo") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    if (state.current) {
      await activateLomoTool();
    }
  } else if (tool === "oilpaint") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateSketchTool();
    if (state.current) {
      await activateOilPaintTool();
    }
  } else if (tool === "sketch") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    destroyCurvedText();
    destroyStrokeText();
    if (state.current) {
      await activateSketchTool();
    }
  } else if (tool === "curvedtext") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    tvoDestroy();

    document.querySelectorAll(".sidebar-panel").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === tool);
    });
    const toolSwitcher = document.querySelector("#tool-switcher");
    if (toolSwitcher.value !== tool) toolSwitcher.value = tool;

    if (state.current) {
      dom.cropSurface.style.display = "";
      fitCanvasToImagePreview();
      const baseCanvas = dom.cropImage;
      initCurvedText(
        baseCanvas,
        () => state.current ? { ...state.current } : null,
        () => pushHistory("Curved Text")
      );
      setCommitBlobCallback((blob, label, name) => commitBlob(blob, label, name, async () => {
        await renderCurrentImage(document.querySelector("#tool-switcher"));
      }));
    }
    return;
  } else if (tool === "stroketext") {
    destroyCropper();
    destroyCurvedText();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    tvoDestroy();

    document.querySelectorAll(".sidebar-panel").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === tool);
    });
    const toolSwitcher = document.querySelector("#tool-switcher");
    if (toolSwitcher.value !== tool) toolSwitcher.value = tool;

    if (state.current) {
      dom.cropSurface.style.display = "";
      fitCanvasToImagePreview();
      const baseCanvas = dom.cropImage;
      initStrokeText(
        baseCanvas,
        () => state.current ? { ...state.current } : null,
        () => pushHistory("Stroke Text")
      );
      setStrokeCommitBlobCallback((blob, label, name) => commitBlob(blob, label, name, async () => {
        await renderCurrentImage(document.querySelector("#tool-switcher"));
      }));
    }
    return;
  } else if (tool === "stickers") {
    destroyCropper();
    destroyCurvedText();
    destroyStrokeText();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    tvoDestroy();

    document.querySelectorAll(".sidebar-panel").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === tool);
    });
    const toolSwitcher = document.querySelector("#tool-switcher");
    if (toolSwitcher.value !== tool) toolSwitcher.value = tool;

    if (state.current) {
      dom.cropSurface.style.display = "";
      fitCanvasToImagePreview();
      const baseCanvas = dom.cropImage;
      initStickers(
        baseCanvas,
        () => state.current ? { ...state.current } : null,
        () => pushHistory("Stickers")
      );
      setStickersCommitBlobCallback((blob, label, name) => commitBlob(blob, label, name, async () => {
        await renderCurrentImage(document.querySelector("#tool-switcher"));
      }));
    }
    return;
  } else {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    deactivateGradientMapTool();
    deactivateHalftoneTool();
    deactivateChromaticAberrationTool();
    deactivateGlitchTool();
    deactivateFilmGrainTool();
    deactivateLomoTool();
    deactivateOilPaintTool();
    deactivateSketchTool();
    destroyCurvedText();
    destroyStrokeText();
    destroyStickers();
  }
}

export function switchToEditor(tool) {
  const appEl = document.querySelector(".app");
  appEl.dataset.view = "editor";
  activateTool(tool);
}

export function switchToLanding() {
  const appEl = document.querySelector(".app");
  appEl.dataset.view = "landing";
}

export function initViewSwitching() {
  document.querySelectorAll(".tool-card").forEach((card) => {
    card.addEventListener("click", () => {
      switchToEditor(card.dataset.selectTool);
    });
  });

  document.querySelector("#back-to-landing").addEventListener("click", switchToLanding);
}

export function initToolSwitcher() {
  const toolSwitcher = document.querySelector("#tool-switcher");
  toolSwitcher.addEventListener("change", () => {
    activateTool(toolSwitcher.value);
  });
}

export function initWindowResize() {
  window.addEventListener("resize", () => {
    if (!state.current) return;
    fitCanvasToImagePreview();
    if (state.cropper) state.cropper.resize();
  });
}
