import { state } from "./core/state.js";
import { dom } from "./core/dom.js";
import { formatBytes } from "./core/utils.js";
import { activateToolRuntime, renderToolForCurrentImage } from "./tools/tool-runtime.js";

const DEFAULT_TOOL = "crop";

function getToolSwitcher() {
  return document.querySelector("#tool-switcher");
}

function isKnownTool(tool) {
  const switcher = getToolSwitcher();
  if (!switcher) return false;
  return Array.from(switcher.options).some((option) => option.value === tool);
}

function normalizeTool(tool) {
  return isKnownTool(tool) ? tool : DEFAULT_TOOL;
}

function parseToolFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeTool(params.get("tool") || DEFAULT_TOOL);
}

function updateToolInUrl(tool, replace = false) {
  const normalizedTool = normalizeTool(tool);
  const url = new URL(window.location.href);
  const hasToolParam = url.searchParams.has("tool");
  const current = normalizeTool(url.searchParams.get("tool") || DEFAULT_TOOL);
  if (hasToolParam && current === normalizedTool) return;

  url.searchParams.set("tool", normalizedTool);
  if (replace) {
    history.replaceState(null, "", url.toString());
    return;
  }
  history.pushState(null, "", url.toString());
}

function applyToolFromUrl() {
  const tool = parseToolFromUrl();
  const appEl = document.querySelector(".app");
  const switcher = getToolSwitcher();

  if (appEl) appEl.dataset.view = "editor";

  if (appEl?.dataset.view === "editor" && switcher?.value === tool) {
    return;
  }

  switchToEditor(tool, { updateRouteState: false });
}

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

  await renderToolForCurrentImage(toolSwitcher?.value, {
    state,
    dom,
    fitCanvasToImagePreview,
    syncUndoButtons,
    rerenderCurrentImage: async () => {
      await renderCurrentImage(document.querySelector("#tool-switcher"));
    },
  });
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
  document.querySelectorAll(".sidebar-panel").forEach((p) => {
    p.classList.toggle("is-active", p.dataset.panel === tool);
  });

  const toolSwitcher = document.querySelector("#tool-switcher");
  if (toolSwitcher && toolSwitcher.value !== tool) toolSwitcher.value = tool;

  await activateToolRuntime(tool, {
    state,
    dom,
    fitCanvasToImagePreview,
    syncUndoButtons,
    rerenderCurrentImage: async () => {
      await renderCurrentImage(document.querySelector("#tool-switcher"));
    },
  });
}

export function switchToEditor(tool, options = {}) {
  const { updateRouteState = true, replaceRoute = false } = options;
  const normalizedTool = normalizeTool(tool);
  const appEl = document.querySelector(".app");
  if (appEl) appEl.dataset.view = "editor";
  activateTool(normalizedTool);

  if (updateRouteState) {
    updateToolInUrl(normalizedTool, replaceRoute);
  }
}

export function switchToLanding(options = {}) {
  const { updateRouteState = true } = options;
  const hasLandingView = !!document.querySelector(".view-landing");

  if (!hasLandingView) {
    window.location.href = "./index.html";
    return;
  }

  const appEl = document.querySelector(".app");
  if (appEl) appEl.dataset.view = "landing";

  if (updateRouteState) {
    history.replaceState(null, "", "./index.html");
  }
}

export function initViewSwitching() {
  document.querySelectorAll(".tool-card").forEach((card) => {
    card.addEventListener("click", () => {
      const normalizedTool = normalizeTool(card.dataset.selectTool);
      window.location.href = `./editor.html?tool=${encodeURIComponent(normalizedTool)}`;
    });
  });

  const backButton = document.querySelector("#back-to-landing");
  if (backButton) backButton.addEventListener("click", switchToLanding);
}

export function initToolSwitcher() {
  const toolSwitcher = document.querySelector("#tool-switcher");
  toolSwitcher.addEventListener("change", () => {
    switchToEditor(toolSwitcher.value);
  });
}

export function initRouteState() {
  if (!getToolSwitcher()) return;

  window.addEventListener("popstate", applyToolFromUrl);

  if (window.location.protocol === "file:") {
    const note = document.querySelector("#editor-file-protocol-note");
    if (note) note.hidden = false;
  }

  const params = new URLSearchParams(window.location.search);
  if (!params.has("tool")) {
    switchToEditor(DEFAULT_TOOL, { updateRouteState: true, replaceRoute: true });
    return;
  }

  applyToolFromUrl();
}

export function initWindowResize() {
  window.addEventListener("resize", () => {
    if (!state.current) return;
    fitCanvasToImagePreview();
    if (state.cropper) state.cropper.resize();
  });
}
