import { destroyCropper, ensureCropper } from "../crop.js";
import { tvoDestroy, tvoInitAsync, tvoUpdateFgStatus } from "../text-overlay.js";
import { activateBlurTool, deactivateBlurTool } from "../selective-blur.js";
import { activateTiltShiftTool, deactivateTiltShiftTool } from "../tilt-shift.js";
import { activateSplashTool, deactivateSplashTool } from "../color-splash.js";
import { activateShadowTool, deactivateShadowTool } from "../shadow-injection.js";
import { activateDuotoneTool } from "../duotone.js";
import { activateGradientMapTool } from "../gradient-map.js";
import { activateHalftoneTool } from "../halftone.js";
import { activateChromaticAberrationTool } from "../chromatic-aberration.js";
import { activateGlitchTool } from "../glitch.js";
import { activateFilmGrainTool } from "../film-grain.js";
import { activateLomoTool } from "../lomo.js";
import { activateOilPaintTool } from "../oil-paint.js";
import { activateSketchTool } from "../sketch.js";
import { activateWatermarkTool, deactivateWatermarkTool } from "../watermark.js";
import { activatePhotoFrameTool } from "../photo-frame.js";
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
import {
  getCurrentSnapshot,
  loadCurrentIntoCanvas,
  makeCommitCallback,
} from "./shared.js";

export async function renderToolForCurrentImage(tool, context) {
  const {
    state,
    dom,
    fitCanvasToImagePreview,
    syncUndoButtons,
    rerenderCurrentImage,
  } = context;

  const isTextoverlayActive = tool === "textoverlay";
  const isCurvedtextActive = tool === "curvedtext";
  const isStroketextActive = tool === "stroketext";
  const isStickersActive = tool === "stickers";
  const isPatternTextActive = tool === "patterntext";

  if (
    !isTextoverlayActive &&
    !isCurvedtextActive &&
    !isStroketextActive &&
    !isStickersActive &&
    !isPatternTextActive
  ) {
    destroyCropper();
    destroyStickers();
    destroyPatternText();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateWatermarkTool();
    await loadCurrentIntoCanvas(state, dom);
    fitCanvasToImagePreview();

    if (tool === "crop") ensureCropper();
    if (tool === "blur") await activateBlurTool();
    if (tool === "tiltshift") await activateTiltShiftTool();
    if (tool === "colorsplash") await activateSplashTool();
    if (tool === "shadowinjection") await activateShadowTool();
    if (tool === "duotone") await activateDuotoneTool();
    if (tool === "gradientmap") await activateGradientMapTool();
    if (tool === "halftone") await activateHalftoneTool();
    if (tool === "chromaticaberration") await activateChromaticAberrationTool();
    if (tool === "glitch") await activateGlitchTool();
    if (tool === "filmgrain") await activateFilmGrainTool();
    if (tool === "lomo") await activateLomoTool();
    if (tool === "oilpaint") await activateOilPaintTool();
    if (tool === "sketch") await activateSketchTool();
    if (tool === "watermark") await activateWatermarkTool();
    if (tool === "photoframe") await activatePhotoFrameTool();
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
    await loadCurrentIntoCanvas(state, dom);
    fitCanvasToImagePreview();
    dom.cropSurface.style.display = "";
    initCurvedText(
      dom.cropImage,
      () => getCurrentSnapshot(state),
      () => pushHistory("Curved Text")
    );
    setCommitBlobCallback(makeCommitCallback(rerenderCurrentImage));
  } else if (isStroketextActive) {
    destroyStrokeText();
    destroyCurvedText();
    tvoDestroy();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    await loadCurrentIntoCanvas(state, dom);
    fitCanvasToImagePreview();
    dom.cropSurface.style.display = "";
    initStrokeText(
      dom.cropImage,
      () => getCurrentSnapshot(state),
      () => pushHistory("Stroke Text")
    );
    setStrokeCommitBlobCallback(makeCommitCallback(rerenderCurrentImage));
  } else if (isStickersActive) {
    destroyPatternText();
    destroyStickers();
    destroyStrokeText();
    destroyCurvedText();
    tvoDestroy();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    await loadCurrentIntoCanvas(state, dom);
    fitCanvasToImagePreview();
    dom.cropSurface.style.display = "";
    initStickers(
      dom.cropImage,
      () => getCurrentSnapshot(state),
      () => pushHistory("Stickers")
    );
    setStickersCommitBlobCallback(makeCommitCallback(rerenderCurrentImage));
  } else if (isPatternTextActive) {
    destroyPatternText();
    destroyStickers();
    destroyStrokeText();
    destroyCurvedText();
    tvoDestroy();
    deactivateBlurTool();
    deactivateTiltShiftTool();
    deactivateSplashTool();
    deactivateShadowTool();
    await loadCurrentIntoCanvas(state, dom);
    fitCanvasToImagePreview();
    dom.cropSurface.style.display = "";
    initPatternText(
      dom.cropImage,
      () => getCurrentSnapshot(state),
      () => pushHistory("Pattern Text")
    );
    setPatternTextCommitBlobCallback(makeCommitCallback(rerenderCurrentImage));
  }

  syncUndoButtons();
}
