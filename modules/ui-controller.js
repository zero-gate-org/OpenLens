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

  if (!isTextoverlayActive) {
    destroyCropper();
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
  } else {
    tvoDestroy();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    fitCanvasToImagePreview();
    tvoUpdateFgStatus();
    await tvoInitAsync(syncUndoButtons);
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
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
    if (state.current) {
      await tvoInitAsync(syncUndoButtons);
    }
    return;
  }

  tvoDestroy();
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
    fitCanvasToImagePreview();
    ensureCropper();
  } else if (tool === "blur") {
    destroyCropper();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    if (state.current) {
      await activateBlurTool();
    }
  } else if (tool === "tiltshift") {
    destroyCropper();
    deactivateBlurTool();
    deactivateSplashTool();
    deactivateShadowTool();
    if (state.current) {
      await activateTiltShiftTool();
    }
  } else if (tool === "colorsplash") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateShadowTool();
    if (state.current) {
      await activateSplashTool();
    }
  } else if (tool === "shadowinjection") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateDuotoneTool();
    if (state.current) {
      await activateShadowTool();
    }
  } else if (tool === "duotone") {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    if (state.current) {
      await activateDuotoneTool();
    }
  } else {
    destroyCropper();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    deactivateDuotoneTool();
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
