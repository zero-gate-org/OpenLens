import { destroyCropper, ensureCropper } from "../crop.js";
import { tvoDestroy, tvoInitAsync } from "../text-overlay.js";
import { activateBlurTool, deactivateBlurTool } from "../selective-blur.js";
import { activateTiltShiftTool, deactivateTiltShiftTool } from "../tilt-shift.js";
import { activateSplashTool, deactivateSplashTool } from "../color-splash.js";
import { activateShadowTool, deactivateShadowTool } from "../shadow-injection.js";
import { activateDuotoneTool, deactivateDuotoneTool } from "../duotone.js";
import { activateGradientMapTool, deactivateGradientMapTool } from "../gradient-map.js";
import { activateHalftoneTool, deactivateHalftoneTool } from "../halftone.js";
import { activateChromaticAberrationTool, deactivateChromaticAberrationTool } from "../chromatic-aberration.js";
import { activateGlitchTool, deactivateGlitchTool } from "../glitch.js";
import { activateFilmGrainTool, deactivateFilmGrainTool } from "../film-grain.js";
import { activateLomoTool, deactivateLomoTool } from "../lomo.js";
import { activateOilPaintTool, deactivateOilPaintTool } from "../oil-paint.js";
import { activateSketchTool, deactivateSketchTool } from "../sketch.js";
import { activateWatermarkTool, deactivateWatermarkTool } from "../watermark.js";
import { activatePhotoFrameTool, deactivatePhotoFrameTool } from "../photo-frame.js";
import {
  init as initCurvedText,
  destroy as destroyCurvedText,
  setCommitBlobCallback,
} from "../curvedtext.js";
import {
  init as initStrokeText,
  destroy as destroyStrokeText,
  setCommitBlobCallback as setStrokeCommitBlobCallback,
} from "../stroketext.js";
import {
  init as initStickers,
  destroy as destroyStickers,
  setCommitBlobCallback as setStickersCommitBlobCallback,
} from "../stickers.js";
import {
  init as initPatternText,
  destroy as destroyPatternText,
  setCommitBlobCallback as setPatternTextCommitBlobCallback,
} from "../pattern-text.js";
import { pushHistory } from "../../file-handler.js";
import { getCurrentSnapshot, makeCommitCallback } from "./shared.js";

const TOOL_DEACTIVATORS = {
  blur: deactivateBlurTool,
  tiltshift: deactivateTiltShiftTool,
  colorsplash: deactivateSplashTool,
  shadowinjection: deactivateShadowTool,
  duotone: deactivateDuotoneTool,
  gradientmap: deactivateGradientMapTool,
  halftone: deactivateHalftoneTool,
  chromaticaberration: deactivateChromaticAberrationTool,
  glitch: deactivateGlitchTool,
  filmgrain: deactivateFilmGrainTool,
  lomo: deactivateLomoTool,
  oilpaint: deactivateOilPaintTool,
  watermark: deactivateWatermarkTool,
  sketch: deactivateSketchTool,
  photoframe: deactivatePhotoFrameTool,
};

const EFFECT_TOOL_IDS = Object.keys(TOOL_DEACTIVATORS);

function deactivateTools(toolIds) {
  toolIds.forEach((toolId) => {
    TOOL_DEACTIVATORS[toolId]?.();
  });
}

function deactivateTextAuthoringTools() {
  destroyCurvedText();
  destroyStrokeText();
  destroyStickers();
  destroyPatternText();
}

function initCanvasTextTool({
  state,
  dom,
  fitCanvasToImagePreview,
  rerenderCurrentImage,
  initTool,
  setCommitCallback,
  historyLabel,
}) {
  if (!state.current) return;
  dom.cropSurface.style.display = "";
  fitCanvasToImagePreview();
  initTool(
    dom.cropImage,
    () => getCurrentSnapshot(state),
    () => pushHistory(historyLabel)
  );
  setCommitCallback(makeCommitCallback(rerenderCurrentImage));
}

function effectToolsExcept(activeTool) {
  return EFFECT_TOOL_IDS.filter((toolId) => toolId !== activeTool);
}

export async function activateToolRuntime(tool, context) {
  const { state, dom, fitCanvasToImagePreview, syncUndoButtons, rerenderCurrentImage } = context;

  const textEditorModeDeactivations = EFFECT_TOOL_IDS;
  const sketchModeDeactivations = [
    "blur",
    "tiltshift",
    "colorsplash",
    "shadowinjection",
    "duotone",
    "gradientmap",
    "halftone",
    "chromaticaberration",
    "glitch",
    "filmgrain",
    "lomo",
    "oilpaint",
  ];

  if (tool === "textoverlay") {
    dom.cropSurface.style.display = "none";
    tvoDestroy();
    deactivateTextAuthoringTools();
    deactivateTools(EFFECT_TOOL_IDS);
    if (state.current) {
      await tvoInitAsync(syncUndoButtons);
    }
    return;
  }

  tvoDestroy();
  deactivateTextAuthoringTools();
  dom.cropSurface.style.display = "";

  switch (tool) {
    case "crop":
      deactivateTools(EFFECT_TOOL_IDS);
      fitCanvasToImagePreview();
      ensureCropper();
      return;

    case "blur":
      destroyCropper();
      deactivateTools(effectToolsExcept("blur"));
      if (state.current) await activateBlurTool();
      return;

    case "tiltshift":
      destroyCropper();
      deactivateTools(effectToolsExcept("tiltshift"));
      if (state.current) await activateTiltShiftTool();
      return;

    case "colorsplash":
      destroyCropper();
      deactivateTools(effectToolsExcept("colorsplash"));
      if (state.current) await activateSplashTool();
      return;

    case "shadowinjection":
      destroyCropper();
      deactivateTools(effectToolsExcept("shadowinjection"));
      if (state.current) await activateShadowTool();
      return;

    case "duotone":
      destroyCropper();
      deactivateTools(effectToolsExcept("duotone"));
      if (state.current) await activateDuotoneTool();
      return;

    case "gradientmap":
      destroyCropper();
      deactivateTools(effectToolsExcept("gradientmap"));
      if (state.current) await activateGradientMapTool();
      return;

    case "halftone":
      destroyCropper();
      deactivateTools(effectToolsExcept("halftone"));
      if (state.current) await activateHalftoneTool();
      return;

    case "chromaticaberration":
      destroyCropper();
      deactivateTools(effectToolsExcept("chromaticaberration"));
      if (state.current) await activateChromaticAberrationTool();
      return;

    case "glitch":
      destroyCropper();
      deactivateTools(effectToolsExcept("glitch"));
      if (state.current) await activateGlitchTool();
      return;

    case "filmgrain":
      destroyCropper();
      deactivateTools(effectToolsExcept("filmgrain"));
      if (state.current) await activateFilmGrainTool();
      return;

    case "lomo":
      destroyCropper();
      deactivateTools(effectToolsExcept("lomo"));
      if (state.current) await activateLomoTool();
      return;

    case "oilpaint":
      destroyCropper();
      deactivateTools(effectToolsExcept("oilpaint"));
      if (state.current) await activateOilPaintTool();
      return;

    case "sketch":
      destroyCropper();
      deactivateTools(sketchModeDeactivations);
      if (state.current) await activateSketchTool();
      return;

    case "watermark":
      destroyCropper();
      deactivateTools(effectToolsExcept("watermark"));
      if (state.current) await activateWatermarkTool();
      return;

    case "curvedtext":
      destroyCropper();
      deactivateTools(textEditorModeDeactivations);
      initCanvasTextTool({
        state,
        dom,
        fitCanvasToImagePreview,
        rerenderCurrentImage,
        initTool: initCurvedText,
        setCommitCallback: setCommitBlobCallback,
        historyLabel: "Curved Text",
      });
      return;

    case "stroketext":
      destroyCropper();
      deactivateTools(textEditorModeDeactivations);
      initCanvasTextTool({
        state,
        dom,
        fitCanvasToImagePreview,
        rerenderCurrentImage,
        initTool: initStrokeText,
        setCommitCallback: setStrokeCommitBlobCallback,
        historyLabel: "Stroke Text",
      });
      return;

    case "stickers":
      destroyCropper();
      deactivateTools(textEditorModeDeactivations);
      initCanvasTextTool({
        state,
        dom,
        fitCanvasToImagePreview,
        rerenderCurrentImage,
        initTool: initStickers,
        setCommitCallback: setStickersCommitBlobCallback,
        historyLabel: "Stickers",
      });
      return;

    case "patterntext":
      destroyCropper();
      deactivateTools(textEditorModeDeactivations);
      initCanvasTextTool({
        state,
        dom,
        fitCanvasToImagePreview,
        rerenderCurrentImage,
        initTool: initPatternText,
        setCommitCallback: setPatternTextCommitBlobCallback,
        historyLabel: "Pattern Text",
      });
      return;

    case "photoframe":
      destroyCropper();
      deactivateTools(effectToolsExcept("photoframe"));
      if (state.current) await activatePhotoFrameTool();
      return;

    default:
      destroyCropper();
      deactivateTools(EFFECT_TOOL_IDS);
      return;
  }
}
