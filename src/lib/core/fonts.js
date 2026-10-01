/**
 * The font list, in one place.
 *
 * This app loads no web fonts. `--font-ui` in `styles/tokens.css` is a system
 * stack, so offering a named font the browser does not have means the canvas
 * silently draws the fallback and the control lies about what you are seeing.
 * Every entry here is either a generic CSS family or a platform font that is
 * present on the operating systems people actually use, which is the whole
 * honest set.
 *
 * One list, three tools. Do not copy it into a tool: import it.
 */
export const FONT_FAMILIES = [
  { value: "system-ui", label: "System" },
  { value: "Georgia", label: "Georgia" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New" },
  { value: "Impact", label: "Impact" },
  { value: "Verdana", label: "Verdana" },
  { value: "Trebuchet MS", label: "Trebuchet MS" },
  { value: "Comic Sans MS", label: "Comic Sans MS" },
];

/** The value used when nothing has been chosen. */
export const DEFAULT_FONT = "system-ui";

/** True for a family this app is willing to offer. */
export function isKnownFont(family) {
  return FONT_FAMILIES.some((font) => font.value === family);
}