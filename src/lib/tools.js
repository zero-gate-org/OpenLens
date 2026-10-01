/**
 * The tool list, as data.
 *
 * This is the single source of truth for what tools exist, what they are
 * called, which group they belong to, and which key opens them. It imports
 * icons and nothing else: no tool components, no state, no workers, no pixel
 * arithmetic.
 *
 * That restraint is the whole point of the file. `registry.js` adds the heavy
 * half, the component that implements each tool, and the landing page needs
 * only this half. Keeping them apart means the marketing page can list all
 * twenty-five tools, with their icons and their shortcuts, without dragging a
 * single one of their implementations into the bundle. Before this split the
 * landing page shipped the whole editor: 465KB of tool code, workers and
 * segmentation model loader, to render a list of labels.
 *
 * Adding a tool is still one entry here plus the component and one line in
 * `registry.js`. See `PORTING.md`.
 */

import CropIcon from "phosphor-svelte/lib/Crop";
import ArrowsOutSimpleIcon from "phosphor-svelte/lib/ArrowsOutSimple";
import ArrowClockwiseIcon from "phosphor-svelte/lib/ArrowClockwise";
import MagicWandIcon from "phosphor-svelte/lib/MagicWand";
import DropHalfIcon from "phosphor-svelte/lib/DropHalf";
import ApertureIcon from "phosphor-svelte/lib/Aperture";
import ArrowsLeftRightIcon from "phosphor-svelte/lib/ArrowsLeftRight";
import CircleHalfTiltIcon from "phosphor-svelte/lib/CircleHalfTilt";
import StackSimpleIcon from "phosphor-svelte/lib/StackSimple";
import GradientIcon from "phosphor-svelte/lib/Gradient";
import CirclesIcon from "phosphor-svelte/lib/CirclesFour";
import StampIcon from "phosphor-svelte/lib/Stamp";
import FrameCornersIcon from "phosphor-svelte/lib/FrameCorners";
import GrainsIcon from "phosphor-svelte/lib/Grains";
import PencilSimpleIcon from "phosphor-svelte/lib/PencilSimple";
import SwatchesIcon from "phosphor-svelte/lib/Swatches";
import BroadcastIcon from "phosphor-svelte/lib/Broadcast";
import CircleDashedIcon from "phosphor-svelte/lib/CircleDashed";
import CameraIcon from "phosphor-svelte/lib/Camera";
import PaintBrushIcon from "phosphor-svelte/lib/PaintBrush";
import TextTIcon from "phosphor-svelte/lib/TextT";
import TextBIcon from "phosphor-svelte/lib/TextB";
import StickerIcon from "phosphor-svelte/lib/Sticker";
import GridFourIcon from "phosphor-svelte/lib/GridFour";
import SelectionBackgroundIcon from "phosphor-svelte/lib/SelectionBackground";

/**
 * @typedef {object} ToolMeta
 * @property {string} id stable, and what `?tool=` carries
 * @property {string} label what the rail and the panel call it
 * @property {string} group a key of `TOOL_GROUPS`
 * @property {any} icon the Phosphor component the rail draws
 * @property {string} shortcut the single key that switches to it
 * @property {string} hint one line of guidance, shown under the rail label
 */

/** @type {ToolMeta[]} */
export const TOOL_META = [
  {
    id: "crop",
    label: "Crop",
    group: "transform",
    icon: CropIcon,
    shortcut: "1",
    hint: "Drag the handles on the image, or type exact pixels.",
  },
  {
    id: "resize",
    label: "Resize",
    group: "transform",
    icon: ArrowsOutSimpleIcon,
    shortcut: "2",
    hint: "Set exact pixels or a scale percentage.",
  },
  {
    id: "rotate",
    label: "Rotate",
    group: "transform",
    icon: ArrowClockwiseIcon,
    shortcut: "3",
    hint: "Preview the angle on the image before applying.",
  },
  {
    id: "bgremove",
    label: "Remove BG",
    group: "ai",
    icon: MagicWandIcon,
    shortcut: "4",
    hint: "Runs a segmentation model on device. The download stays local.",
  },
  {
    id: "blur",
    label: "Blur",
    group: "ai",
    icon: DropHalfIcon,
    shortcut: "5",
    hint: "Keeps the subject sharp and blurs the background.",
  },
  {
    id: "colorsplash",
    label: "Color Splash",
    group: "ai",
    icon: CircleHalfTiltIcon,
    shortcut: "8",
    hint: "Keeps the subject in colour and turns the background grey.",
  },
  {
    id: "shadowinjection",
    label: "Shadow",
    group: "ai",
    icon: StackSimpleIcon,
    shortcut: "h",
    hint: "Drop a cast shadow behind the subject, with an offset, a blur and a depth.",
  },
  {
    id: "tiltshift",
    label: "Tilt-Shift",
    group: "filters",
    icon: ApertureIcon,
    shortcut: "6",
    hint: "Keeps a band sharp and blurs the rest, with colour and tone controls.",
  },
  {
    id: "duotone",
    label: "Duotone",
    group: "filters",
    icon: GradientIcon,
    shortcut: "9",
    hint: "Map the image onto a ramp between two colours.",
  },
  {
    id: "halftone",
    label: "Halftone",
    group: "filters",
    icon: CirclesIcon,
    shortcut: "0",
    hint: "Break the image into a print-style screen of dots.",
  },
  {
    id: "filmgrain",
    label: "Film Grain",
    group: "filters",
    icon: GrainsIcon,
    shortcut: "g",
    hint: "Add seeded noise, weighted towards the highlights or the shadows.",
  },
  {
    id: "sketch",
    label: "Sketch",
    group: "filters",
    icon: PencilSimpleIcon,
    shortcut: "s",
    hint: "Turns the image into a line drawing, with paper and ink colours.",
  },
  {
    id: "gradientmap",
    label: "Gradient Map",
    group: "filters",
    icon: SwatchesIcon,
    shortcut: "m",
    hint: "Remap the tonal range of the image onto a ramp of colours.",
  },
  {
    id: "glitch",
    label: "Glitch",
    group: "filters",
    icon: BroadcastIcon,
    shortcut: "x",
    hint: "Break the image up with slicing, channel shift, scanlines and block datamosh.",
  },
  {
    id: "chromaticaberration",
    label: "Chromatic Aberration",
    group: "filters",
    icon: CircleDashedIcon,
    shortcut: "a",
    hint: "Pull the red and blue channels apart, sideways or out from the centre.",
  },
  {
    id: "lomo",
    label: "Lomo",
    group: "filters",
    icon: CameraIcon,
    shortcut: "l",
    hint: "Emulate a film look with a tone curve per channel, saturation, warmth and a vignette.",
  },
  {
    id: "oilpaint",
    label: "Oil Paint",
    group: "filters",
    icon: PaintBrushIcon,
    shortcut: "o",
    hint: "Flattens the image into painterly patches, with optional colour and edge finishing.",
  },
  {
    id: "curvedtext",
    label: "Curved Text",
    group: "text",
    icon: TextTIcon,
    shortcut: "t",
    hint: "Bend text along an arc, with a radius, a sweep and a start angle.",
  },
  {
    id: "stroketext",
    label: "Stroke Text",
    group: "text",
    icon: TextBIcon,
    shortcut: "k",
    hint: "Outlined display text, with a stroke width, a fill and a choice of paint order.",
  },
  {
    id: "stickers",
    label: "Stickers",
    group: "text",
    icon: StickerIcon,
    shortcut: "e",
    hint: "Place marks on the picture, then move, scale, turn, reorder or hide them.",
  },
  {
    id: "patterntext",
    label: "Pattern Text",
    group: "text",
    icon: GridFourIcon,
    shortcut: "r",
    hint: "Fill words with a repeating mark, with a pattern scale and a turn.",
  },
  {
    id: "photoframe",
    label: "Photo Frame",
    group: "output",
    icon: FrameCornersIcon,
    shortcut: "p",
    hint: "Add a border around the picture, with an optional caption in the bottom band.",
  },
  {
    id: "textbehind",
    label: "Text Behind",
    group: "text",
    icon: SelectionBackgroundIcon,
    shortcut: "d",
    hint: "Put words behind the subject, with a soft edge around it.",
  },
  {
    id: "convert",
    label: "Convert",
    group: "output",
    icon: ArrowsLeftRightIcon,
    shortcut: "7",
    hint: "Re-encode as PNG, JPEG or WebP. JPEG drops transparency, so it lands on white.",
  },
  {
    id: "watermark",
    label: "Watermark",
    group: "output",
    icon: StampIcon,
    shortcut: "w",
    hint: "Stamp text or a logo over the picture, once or tiled.",
  },
];

/**
 * The groups, in rail order. A group with no tools is not a bug worth hiding,
 * so this is a plain list and `registry.js` filters on what exists.
 */
export const TOOL_GROUP_META = [
  { id: "transform", label: "Transform" },
  { id: "ai", label: "AI" },
  { id: "filters", label: "Filters" },
  { id: "text", label: "Text" },
  { id: "output", label: "Output" },
];

export const DEFAULT_TOOL = "crop";
