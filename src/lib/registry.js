/**
 * Tool registry.
 *
 * The tool list itself lives in `tools.js`, which holds the metadata and the
 * icons and nothing else. This file is the join: it attaches each tool's
 * component to its metadata and exports the lookups the editor needs.
 *
 * The split exists so the landing page can list every tool without importing
 * this file. Importing the registry means importing all twenty-five tool
 * components, and with them the workers and the segmentation model loader. The
 * landing page wants twenty-five labels and twenty-five icons, and the editor
 * already has the definitions, so the definitions were put where the cheap half
 * of them could be read on their own.
 *
 * Everything here is derived from `TOOL_META` rather than restated: the rail,
 * the routing, the keyboard cycling and the panel host all read this file, so
 * they cannot disagree with each other.
 */

import CropTool from "./tools/CropTool.svelte";
import ResizeTool from "./tools/ResizeTool.svelte";
import RotateTool from "./tools/RotateTool.svelte";
import BgRemoveTool from "./tools/BgRemoveTool.svelte";
import BlurTool from "./tools/BlurTool.svelte";
import TiltShiftTool from "./tools/TiltShiftTool.svelte";
import ConvertTool from "./tools/ConvertTool.svelte";
import ColorSplashTool from "./tools/ColorSplashTool.svelte";
import ShadowInjectionTool from "./tools/ShadowInjectionTool.svelte";
import DuotoneTool from "./tools/DuotoneTool.svelte";
import HalftoneTool from "./tools/HalftoneTool.svelte";
import WatermarkTool from "./tools/WatermarkTool.svelte";
import PhotoFrameTool from "./tools/PhotoFrameTool.svelte";
import FilmGrainTool from "./tools/FilmGrainTool.svelte";
import SketchTool from "./tools/SketchTool.svelte";
import GradientMapTool from "./tools/GradientMapTool.svelte";
import GlitchTool from "./tools/GlitchTool.svelte";
import ChromaticAberrationTool from "./tools/ChromaticAberrationTool.svelte";
import LomoTool from "./tools/LomoTool.svelte";
import OilPaintTool from "./tools/OilPaintTool.svelte";
import CurvedTextTool from "./tools/CurvedTextTool.svelte";
import StrokeTextTool from "./tools/StrokeTextTool.svelte";
import StickersTool from "./tools/StickersTool.svelte";
import PatternTextTool from "./tools/PatternTextTool.svelte";
import TextBehindTool from "./tools/TextBehindTool.svelte";

import { TOOL_META, TOOL_GROUP_META, DEFAULT_TOOL } from "./tools.js";

/**
 * The component behind each id.
 *
 * A lookup rather than a `component` field on the metadata, because a
 * component in `tools.js` is exactly the coupling this file exists to contain:
 * the moment a tool component is imported there, so is its worker.
 */
const COMPONENTS = {
  crop: CropTool,
  resize: ResizeTool,
  rotate: RotateTool,
  bgremove: BgRemoveTool,
  blur: BlurTool,
  colorsplash: ColorSplashTool,
  shadowinjection: ShadowInjectionTool,
  tiltshift: TiltShiftTool,
  duotone: DuotoneTool,
  halftone: HalftoneTool,
  filmgrain: FilmGrainTool,
  sketch: SketchTool,
  gradientmap: GradientMapTool,
  glitch: GlitchTool,
  chromaticaberration: ChromaticAberrationTool,
  lomo: LomoTool,
  oilpaint: OilPaintTool,
  curvedtext: CurvedTextTool,
  stroketext: StrokeTextTool,
  stickers: StickersTool,
  patterntext: PatternTextTool,
  photoframe: PhotoFrameTool,
  textbehind: TextBehindTool,
  convert: ConvertTool,
  watermark: WatermarkTool,
};

export const TOOL_GROUPS = TOOL_GROUP_META.filter((group) =>
  TOOL_META.some((tool) => tool.group === group.id),
);

/**
 * The full list, metadata plus implementations.
 *
 * @type {Array<typeof TOOL_META[number] & { component: any }>}
 */
export const TOOLS = TOOL_META.map((tool) => ({
  ...tool,
  component: COMPONENTS[tool.id],
}));

export { DEFAULT_TOOL };

const BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

export function toolById(id) {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_TOOL);
}

export function isKnownTool(id) {
  return BY_ID.has(id);
}

export function normalizeTool(id) {
  return isKnownTool(id) ? id : DEFAULT_TOOL;
}

/** Index-based neighbour for the arrow-key / bracket shortcuts. */
export function stepTool(id, delta) {
  const i = TOOLS.findIndex((tool) => tool.id === id);
  const next = (i + delta + TOOLS.length) % TOOLS.length;
  return TOOLS[next].id;
}

export function toolByShortcut(key) {
  return TOOLS.find((tool) => tool.shortcut === key);
}

export const TOOL_IDS = TOOLS.map((tool) => tool.id);
