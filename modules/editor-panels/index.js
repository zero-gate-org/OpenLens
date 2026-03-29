import cropPanel from "../../ui/crop/panel.js";
import resizePanel from "../../ui/resize/panel.js";
import rotatePanel from "../../ui/rotate/panel.js";
import convertPanel from "../../ui/convert/panel.js";
import bgremovePanel from "../../ui/background-removal/panel.js";
import blurPanel from "../../ui/selective-blur/panel.js";
import tiltshiftPanel from "../../ui/tilt-shift/panel.js";
import colorsplashPanel from "../../ui/color-splash/panel.js";
import shadowinjectionPanel from "../../ui/shadow-injection/panel.js";
import gradientmapPanel from "../../ui/gradientmap/panel.js";
import duotonePanel from "../../ui/duotone/panel.js";
import halftonePanel from "../../ui/halftone/panel.js";
import chromaticaberrationPanel from "../../ui/chromatic-aberration/panel.js";
import glitchPanel from "../../ui/glitch/panel.js";
import filmgrainPanel from "../../ui/film-grain/panel.js";
import lomoPanel from "../../ui/lomo/panel.js";
import oilpaintPanel from "../../ui/oil-paint/panel.js";
import sketchPanel from "../../ui/sketch/panel.js";
import textoverlayPanel from "../../ui/textoverlay/panel.js";
import curvedtextPanel from "../../ui/curvedtext/panel.js";
import stroketextPanel from "../../ui/stroketext/panel.js";
import stickersPanel from "../../ui/stickers/panel.js";
import patterntextPanel from "../../ui/patterntext/panel.js";
import watermarkPanel from "../../ui/watermark/panel.js";

export const PANEL_MARKUP_BY_TOOL = {
  "crop": cropPanel,
  "resize": resizePanel,
  "rotate": rotatePanel,
  "convert": convertPanel,
  "bgremove": bgremovePanel,
  "blur": blurPanel,
  "tiltshift": tiltshiftPanel,
  "colorsplash": colorsplashPanel,
  "shadowinjection": shadowinjectionPanel,
  "gradientmap": gradientmapPanel,
  "duotone": duotonePanel,
  "halftone": halftonePanel,
  "chromaticaberration": chromaticaberrationPanel,
  "glitch": glitchPanel,
  "filmgrain": filmgrainPanel,
  "lomo": lomoPanel,
  "oilpaint": oilpaintPanel,
  "sketch": sketchPanel,
  "textoverlay": textoverlayPanel,
  "curvedtext": curvedtextPanel,
  "stroketext": stroketextPanel,
  "stickers": stickersPanel,
  "patterntext": patterntextPanel,
  "watermark": watermarkPanel,
};

export const PANEL_ORDER = [
  "crop",
  "resize",
  "rotate",
  "convert",
  "bgremove",
  "blur",
  "tiltshift",
  "colorsplash",
  "shadowinjection",
  "gradientmap",
  "duotone",
  "halftone",
  "chromaticaberration",
  "glitch",
  "filmgrain",
  "lomo",
  "oilpaint",
  "sketch",
  "textoverlay",
  "curvedtext",
  "stroketext",
  "stickers",
  "patterntext",
  "watermark",
];

export function buildPanelsMarkup() {
  return PANEL_ORDER.map((tool) => PANEL_MARKUP_BY_TOOL[tool]).join("\n\n");
}
