/**
 * Stroke text layout and stroke geometry.
 *
 * Deliberately free of runes, of the DOM and of canvas: everything here takes
 * numbers and returns numbers. Glyph advances arrive from the caller, measured
 * on a real canvas, because this module has no font and cannot invent one, and
 * an estimate puts the letters visibly in the wrong place.
 *
 * The one idea worth reading twice is the frame of reference. `blockLayout`
 * works in the text's *own* frame with the anchor point at the origin, so
 * nothing here knows where on the picture the words sit or which way they
 * point. `rotationMatrix` turns that into the placement, and the stage layer
 * and the commit canvas both consume the same matrix, so the preview and the
 * committed pixels cannot drift apart.
 *
 * Every length is in image pixels, so nothing here knows what the stage
 * happens to be zoomed to.
 */

const DEG = Math.PI / 180;

/** Widest stroke on offer. Beyond this the ring swallows the letter it wraps. */
export const MAX_STROKE_WIDTH = 50;

/** Text size bounds, in image pixels. */
export const MIN_TEXT_SIZE = 10;
export const MAX_TEXT_SIZE = 300;

/** What falls back for the ascent and descent when a font reports neither. */
const ASCENT_RATIO = 0.8;
const DESCENT_RATIO = 0.2;

/** A canvas `miterLimit` low enough to stop a spike on a sharp corner. */
export const MITER_LIMIT = 2;

/**
 * Where the stroke sits relative to the fill.
 *
 * Stroking a glyph path draws the stroke centred on the outline, so half of it
 * always falls inside the letter and half outside. The order decides which half
 * the fill hides, and that is the whole difference between the two:
 *
 *   - `stroke-first` strokes, then fills, so the fill covers the inner half
 *     and what is left is a clean ring sitting outside the letter.
 *   - `fill-first` fills, then strokes, so the inner half lands on top of the
 *     fill and eats into it.
 *
 * Neither is a trick: both are one `strokeText` and one `fillText` in the order
 * named. The names are the order, so `paintOps` is a lookup rather than a
 * branch.
 */
export const PAINT_ORDERS = [
  { value: "stroke-first", label: "Stroke behind" },
  { value: "fill-first", label: "Fill behind" },
];

/** How the stroke turns a corner. `round` suits display lettering best. */
export const LINE_JOINS = [
  { value: "round", label: "Round" },
  { value: "miter", label: "Miter" },
  { value: "bevel", label: "Bevel" },
];

/** Which edge of the block the anchor point sits on. */
export const ALIGNMENTS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * `0`, never `-0`.
 *
 * A sine of zero is zero, and negating it is negative zero, which compares
 * unequal to zero and prints as `-0` in the matrix string the layer hands to
 * SVG. Neither is wrong on screen, and both are a nuisance in a diff and in a
 * comparison, so the sign is folded away at the point the number is made.
 */
const flat = (n) => (n === 0 ? 0 : n);

/**
 * A stroke width inside the range the tool offers.
 *
 * The floor is 0 and that is a real value, not an error: a width of 0 means no
 * stroke at all. A negative width is not a thinner stroke, it is a mistake, and
 * passing one to a canvas context would ask for a hairline outline rather than
 * nothing, so it clamps to the floor and the caller is expected to drop the
 * stroke op entirely (see `paintOps`).
 *
 * A non-finite width, which is what an empty number field produces, also lands
 * on the floor.
 */
export function clampStrokeWidth(width, max = MAX_STROKE_WIDTH) {
  const n = Number(width);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, Math.max(0, num(max)));
}

/**
 * The draw operations for a composition, in the order they must happen.
 *
 * The return value is the single source of truth for paint order: the commit
 * canvas walks it op by op, and the stage layer turns it into one
 * `paint-order` value. Two callers cannot disagree about what "stroke first"
 * means, because neither of them decides it.
 *
 * A stroke of zero width contributes no op, so a zero width can never reach a
 * context as a hairline. With nothing to draw the list is empty, which is the
 * honest answer and lets the panel say so.
 *
 * @returns {("stroke" | "fill")[]}
 */
export function paintOps({ paintOrder = "stroke-first", strokeWidth = 0, fill = true } = {}) {
  const stroke = clampStrokeWidth(strokeWidth) > 0;
  if (!stroke) return fill ? ["fill"] : [];

  if (!fill) return ["stroke"];
  return paintOrder === "fill-first" ? ["fill", "stroke"] : ["stroke", "fill"];
}

/**
 * Group a run into runs of spaces and runs of non-spaces.
 *
 * Words are what the wrapper breaks between, so it has to see them as units
 * rather than as characters. Each token carries the advance it would add to a
 * line, tracking included, so the wrapper can ask the question "does this word
 * still fit" without re-deriving the arithmetic.
 */
function tokenize(glyphs, track) {
  const out = [];
  let current = null;

  for (const glyph of glyphs) {
    const isSpace = glyph.char === " ";
    if (!current || current.isSpace !== isSpace) {
      current = { isSpace, glyphs: [], advance: 0 };
      out.push(current);
    }
    // Tracking sits between glyphs, so a token's first glyph is charged nothing.
    if (current.glyphs.length) current.advance += track;
    current.glyphs.push(glyph);
    current.advance += Math.max(0, num(glyph.width));
  }

  return out;
}

/** Greedy word wrapping for one paragraph, which has no newlines in it. */
function wrapParagraph(glyphs, limit, track) {
  const lines = [];
  let line = [];
  let width = 0;
  let gap = 0;

  const endLine = () => {
    lines.push(line);
    line = [];
    width = 0;
    gap = 0;
  };

  for (const token of tokenize(glyphs, track)) {
    if (token.isSpace) {
      // Spaces hang off the end of the line until a word arrives. If the line
      // breaks first they are dropped, which is why they are not in the line.
      if (line.length > 0) gap += token.advance;
      continue;
    }

    const separator = line.length > 0 ? gap : 0;
    if (limit > 0 && line.length > 0 && width + separator + token.advance > limit) {
      endLine();
    } else {
      width += separator;
    }

    for (const glyph of token.glyphs) line.push(glyph);
    width += token.advance;
    gap = 0;
  }

  endLine();
  return lines;
}

/**
 * Break a measured run into lines.
 *
 * Wrapping works on advances the caller already measured, one per character, so
 * nothing here needs a font and nothing has to guess. Breaks happen between
 * words, and three rules about the edges are all visible in the result rather
 * than hidden:
 *
 *   - A newline in the text starts a new line, and two newlines leave the blank
 *     line between them, because that is what the operator typed.
 *   - A line never begins with the space that preceded its first word, and a
 *     line never ends with one. The spaces at a break are dropped rather than
 *     leading the next line.
 *   - A single word longer than the limit is never split. There is no hyphen to
 *     break on and inventing one would put a mark in the picture that the
 *     operator never asked for, so the word overflows and the panel reports it.
 *
 * A `maxWidth` of 0 or less means no wrapping, so only explicit newlines break.
 *
 * @param {{char: string, width: number}[]} glyphs in reading order
 * @returns {{char: string, width: number}[][]} one array per line
 */
export function wrapGlyphs(glyphs, { maxWidth = 0, letterSpacing = 0 } = {}) {
  const source = Array.isArray(glyphs) ? glyphs : [];
  if (source.length === 0) return [];

  const limit = num(maxWidth);
  const track = num(letterSpacing);

  const lines = [];
  let paragraph = [];

  const endParagraph = () => {
    for (const line of wrapParagraph(paragraph, limit, track)) lines.push(line);
    paragraph = [];
  };

  for (const glyph of source) {
    if (glyph.char === "\n") {
      endParagraph();
      continue;
    }
    paragraph.push(glyph);
  }
  endParagraph();

  return lines;
}


/**
 * One measured line, placed against an alignment point at the origin.
 *
 * Each glyph is reported by its left edge, because that is where a canvas
 * context with `textAlign: "left"` starts it and where an SVG `<text>` with
 * `text-anchor: "start"` starts it. Reporting a left edge rather than a centre
 * is what lets the two renderers use the same numbers.
 *
 * Positions are monotonic and the gap between two neighbours is exactly the
 * first glyph's advance plus the tracking, so a run never bunches up or drifts.
 *
 * @returns {{glyphs: {char: string, x: number, width: number}[], width: number, start: number}}
 */
export function lineLayout({ glyphs = [], letterSpacing = 0, align = "center" } = {}) {
  const source = Array.isArray(glyphs) ? glyphs : [];
  if (source.length === 0) return { glyphs: [], width: 0, start: 0 };

  const track = num(letterSpacing);
  const widths = source.map((glyph) => Math.max(0, num(glyph.width)));
  const total = widths.reduce((sum, w) => sum + w, 0) + (source.length > 1 ? track * (source.length - 1) : 0);

  const offset = align === "left" ? 0 : align === "right" ? flat(-total) : flat(-total / 2);

  const out = [];
  let pen = offset;
  for (let i = 0; i < source.length; i += 1) {
    out.push({ char: source[i].char, x: pen, width: widths[i] });
    pen += widths[i] + track;
  }

  return { glyphs: out, width: total, start: offset };
}

/**
 * A whole block of lines, in the text's own frame with the anchor at (0, 0).
 *
 * The anchor is the alignment point across and the vertical centre of the block
 * down, which is what makes `Across` and `Down` in the panel mean the place on
 * the picture rather than a baseline whose position depends on the font.
 *
 * The box is the line box, not the ink: `lines` rows of `size * lineHeight`,
 * centred on the anchor. Ink is smaller than that by design, since the line box
 * is the thing that means the same thing for every font.
 *
 * `ascent` and `descent` are the font's own metrics, in pixels above and below
 * the baseline. They place each baseline inside its row, and default to a plain
 * 80/20 of the size when a browser reports neither.
 *
 * @param {{
 *   lines?: {char: string, width: number}[][],
 *   align?: string,
 *   size?: number,
 *   lineHeight?: number,
 *   ascent?: number,
 *   descent?: number,
 *   letterSpacing?: number,
 * }} options
 * @returns {{glyphs: {char: string, x: number, y: number, width: number}[],
 *            box: {x: number, y: number, w: number, h: number},
 *            width: number, height: number, lineCount: number}}
 */
export function blockLayout({
  lines = [],
  align = "center",
  size = 16,
  lineHeight = 1.2,
  ascent,
  descent,
  letterSpacing = 0,
} = {}) {
  const rows = Array.isArray(lines) ? lines : [];
  const rowHeight = Math.max(0, num(size)) * Math.max(0, num(lineHeight));
  const asc = Number.isFinite(ascent) ? Number(ascent) : Math.max(0, num(size)) * ASCENT_RATIO;
  const desc = Number.isFinite(descent) ? Number(descent) : Math.max(0, num(size)) * DESCENT_RATIO;

  if (rows.length === 0) {
    return {
      glyphs: [],
      box: { x: 0, y: 0, w: 0, h: 0 },
      width: 0,
      height: 0,
      lineCount: 0,
    };
  }

  const laid = rows.map((row) => lineLayout({ glyphs: row, letterSpacing, align }));
  const width = laid.reduce((widest, row) => Math.max(widest, row.width), 0);
  const height = rows.length * rowHeight;
  const top = flat(-height / 2);

  // A row's own vertical centre sits half a row down, and the baseline hangs
  // below that by however much of the em is descender rather than ascender, so
  // a row is optically centred whichever way the font's metrics lean.
  const shift = (asc - desc) / 2;

  const glyphs = [];
  for (let i = 0; i < rows.length; i += 1) {
    const baseline = top + (i + 0.5) * rowHeight + shift;
    for (const glyph of laid[i].glyphs) {
      glyphs.push({ char: glyph.char, x: glyph.x, y: baseline, width: glyph.width });
    }
  }

  return {
    glyphs,
    box: {
      x: align === "left" ? 0 : align === "right" ? flat(-width) : flat(-width / 2),
      y: top,
      w: width,
      h: height,
    },
    width,
    height,
    lineCount: rows.length,
  };
}

/**
 * The affine matrix that puts the text's own frame on the picture.
 *
 * Translation and rotation about the anchor, which is what every consumer
 * needs and no more. Returning the six numbers rather than a transform string
 * means the commit canvas can hand them straight to `setTransform` and the
 * layer can hand them straight to `matrix(...)`, from the same object.
 *
 * SVG spells this `matrix(a b c d e f)` and canvas takes the same six in the
 * same order, so `matrixString` is a formatting helper and nothing more.
 */
export function rotationMatrix({ x = 0, y = 0, rotationDeg = 0 } = {}) {
  const angle = num(rotationDeg) * DEG;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    a: flat(cos),
    b: flat(sin),
    c: flat(-sin),
    d: flat(cos),
    e: num(x),
    f: num(y),
  };
}

/** The SVG `matrix(...)` form of a matrix from `rotationMatrix`. */
export function matrixString(matrix) {
  const m = matrix ?? {};
  return `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(round2).join(" ")})`;
}

/** Trim the numbers: a matrix string six figures long is nobody's friend. */
const round2 = (n) => flat(Math.round(num(n) * 100) / 100);

/** Apply a matrix to a point. */
export function transformPoint(matrix, point) {
  const m = matrix ?? {};
  const x = num(point?.x);
  const y = num(point?.y);
  return {
    x: num(m.a) * x + num(m.c) * y + num(m.e),
    y: num(m.b) * x + num(m.d) * y + num(m.f),
  };
}

/** Apply a matrix to a box, returning the axis-aligned box around it. */
export function transformBox(box, matrix) {
  const b = box ?? { x: 0, y: 0, w: 0, h: 0 };
  const corners = [
    transformPoint(matrix, { x: b.x, y: b.y }),
    transformPoint(matrix, { x: b.x + b.w, y: b.y }),
    transformPoint(matrix, { x: b.x + b.w, y: b.y + b.h }),
    transformPoint(matrix, { x: b.x, y: b.y + b.h }),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
}

/** A box grown by the same amount on every side. */
export function padBox(box, pad) {
  const p = Math.max(0, num(pad));
  return { x: box.x - p, y: box.y - p, w: box.w + p * 2, h: box.h + p * 2 };
}

/** The world position of a box's corner, in the frame the matrix describes. */
export function boxCorner(box, matrix, corner = "se") {
  const b = box ?? { x: 0, y: 0, w: 0, h: 0 };
  const x = corner.includes("w") ? b.x : b.x + b.w;
  const y = corner.includes("n") ? b.y : b.y + b.h;
  return transformPoint(matrix, { x, y });
}

/**
 * A point taken back into the text's own frame.
 *
 * The inverse of `rotationMatrix` about the same anchor, and the reason a scale
 * handle tracks the pointer along the block's own axis instead of along the
 * screen's: a corner dragged on rotated text still measures the same distance
 * from the anchor whichever way the words point.
 */
export function unrotate({ x = 0, y = 0, rotationDeg = 0 } = {}, point) {
  const angle = -num(rotationDeg) * DEG;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = num(point?.x) - num(x);
  const dy = num(point?.y) - num(y);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/**
 * The rotation, in degrees, that puts a handle at `point`.
 *
 * A handle straight above the anchor reads 0, which is the orientation the
 * words are actually in when the operator has not touched the control, and it
 * is why the 90 degree offset is in here rather than in the caller.
 */
export function rotationForPoint(origin, point) {
  const dx = num(point?.x) - num(origin?.x);
  const dy = num(point?.y) - num(origin?.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI + 90;
}

/**
 * The text size a scale drag has asked for.
 *
 * Measured against where the drag started rather than against the live size, so
 * a drag does not compound: the size is re-measured on every frame as the
 * letters grow, and a ratio taken from the current size would multiply that
 * growth by itself and run away.
 *
 * A drag that has not moved, or one that starts exactly on the anchor, has no
 * ratio to speak of, so the starting size is returned unchanged rather than
 * dividing by zero.
 */
export function scaledSize(distance, startDistance, startSize, min = MIN_TEXT_SIZE, max = MAX_TEXT_SIZE) {
  const base = clamp(num(startSize), min, max);
  const from = Math.abs(num(startDistance));
  if (from < 0.5) return base;
  return clamp(base * (Math.abs(num(distance)) / from), min, max);
}

/** A starting text size for a frame width, so the words are never slab-sized. */
export function defaultTextSize(width) {
  return clamp(Math.round(num(width) * 0.07), MIN_TEXT_SIZE, MAX_TEXT_SIZE);
}

/**
 * Which edges of the frame a box runs past.
 *
 * Reported rather than prevented. A text tool that clamped the anchor to the
 * picture would make the last letter of a long line unreachable, and one that
 * drew silently off the edge would commit a word missing its tail with nothing
 * in the panel to say so. So the box is measured against the frame, the names
 * of the edges it crosses come back, and the panel turns them into a sentence.
 *
 * @returns {{any: boolean, edges: string[]}} edges in a fixed reading order
 */
export function frameOverflow(box, frame) {
  const b = box ?? { x: 0, y: 0, w: 0, h: 0 };
  const w = Math.max(0, num(frame?.width));
  const h = Math.max(0, num(frame?.height));
  // A frame with no size is not a frame. Before an image is on stage there is
  // nothing to be outside of, and a warning about it would be a lie.
  if (w === 0 || h === 0) return { any: false, edges: [] };
  // Half a pixel of slack, so a line that lands exactly on the edge reads as
  // inside rather than as an overflow the operator cannot get rid of.
  const slack = 0.5;

  const edges = [];
  if (b.x < -slack) edges.push("left");
  if (b.x + b.w > w + slack) edges.push("right");
  if (b.y < -slack) edges.push("top");
  if (b.y + b.h > h + slack) edges.push("bottom");

  return { any: edges.length > 0, edges };
}
