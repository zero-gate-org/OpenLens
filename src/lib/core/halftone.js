/**
 * The halftone screen: the arithmetic behind a print-style dot pattern.
 *
 * A halftone borrows the way cheap newsprint fakes tone. The frame is cut into
 * a lattice of cells, each cell is reduced to one number, and a mark whose size
 * follows that number is printed in the middle of it. Regular, and unmistakably
 * printed.
 *
 * The screen angle rotates the lattice. Two rules keep that honest, and both
 * are the reason this module is arithmetic rather than a pile of canvas calls:
 *
 * 1. A mark is printed where its cell centre turns up on the frame, and it
 *    takes its tone from the picture *there*. Sampling the tone from the
 *    unrotated lattice instead is the obvious shortcut and it is wrong: it
 *    prints a rotated screen showing a flat one, and every mark that rotates
 *    off the page is ink nobody can see.
 * 2. The lattice is laid over the turned frame, not over the upright one, so a
 *    tilted screen still covers all four corners.
 *
 * Everything here is pure arithmetic over a plain `{ width, height, data }`
 * object, which is the shape `ImageData` has. No canvas is created and no
 * `ImageData` is constructed, so the whole module runs in plain Node and can be
 * unit tested without a browser. Turning a result back into real pixels is the
 * caller's job.
 *
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 * @typedef {{x: number, y: number, w: number, h: number, cx: number, cy: number}} Cell
 * @typedef {{channel: "c" | "m" | "y" | "k" | "l", angle: number, colour: number[]}} CmykScreen
 * @typedef {{isCancelled?: () => boolean, onProgress?: (ratio: number) => void}} PassOptions
 */

/**
 * Marks smaller than this are not printed.
 *
 * A dot a fraction of a pixel across covers no whole pixel on a real screen
 * and turns a smooth ramp into a field of one-pixel speckle, which reads as
 * noise rather than as tone. The legacy sampler used the same cut.
 */
export const MIN_DOT_RADIUS = 0.3;

/**
 * Half-thickness of the "line" mark, as a fraction of its half-length.
 * Thin enough to read as a stroke rather than a block, thick enough to survive
 * a cell of four pixels.
 */
export const LINE_RATIO = 0.28;

/**
 * Image pixels one chunk may touch before the main thread is handed back.
 * Halftone reads and writes about twice the frame in total, so the budget is
 * expressed in pixels rather than in taps: there is no kernel to count.
 */
const PIXELS_PER_CHUNK = 500_000;

/**
 * The four screens a CMYK print is made of, in the legacy order.
 * @type {CmykScreen[]}
 */
export const CMYK_SCREENS = [
  { channel: "c", angle: 15, colour: [0, 255, 255] },
  { channel: "m", angle: 75, colour: [255, 0, 255] },
  { channel: "y", angle: 0, colour: [255, 255, 0] },
  { channel: "k", angle: 45, colour: [0, 0, 0] },
];

/** Degrees that leave a lattice looking exactly as it did. */
export const QUARTER_TURNS = [0, 90, 180, 270];

let nextTask = null;

/** A real task with no timer clamp, for handing the main thread back. */
function channelTask() {
  const channel = new MessageChannel();
  /** @type {(() => void) | null} */
  let resume = null;
  channel.port1.onmessage = () => {
    const fn = resume;
    resume = null;
    fn?.();
  };
  return () =>
    new Promise((resolve) => {
      resume = () => resolve();
      channel.port2.postMessage(0);
    });
}

/**
 * Hand the main thread back for one real task.
 *
 * A `MessageChannel` round trip is the cheapest task a browser offers, and
 * unlike `setTimeout` it is not clamped to 4ms once timers start nesting. This
 * chain is hundreds of tasks deep on a large image, so that clamp would add
 * seconds of dead time. Built on first use, so an arithmetic-only caller (a
 * unit test, say) never creates a port it has no use for, and outside a browser
 * a plain timer is both enough and safe: an open port would keep a Node process
 * alive forever.
 */
function idle() {
  if (nextTask) return nextTask();

  nextTask =
    typeof window !== "undefined" && typeof MessageChannel === "function"
      ? channelTask()
      : () => new Promise((resolve) => setTimeout(resolve, 0));

  return nextTask();
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Lattice rows to process per chunk. Zero means run straight through. */
function rowsPerChunk(extent, cellSize) {
  const rows = Math.max(1, Math.ceil((extent.bottom - extent.top) / cellSize));
  if (rows * cellSize * cellSize <= PIXELS_PER_CHUNK) return 0;
  return Math.max(1, Math.floor(PIXELS_PER_CHUNK / (cellSize * cellSize)));
}

/**
 * Split a `#rgb` or `#rrggbb` string into 0-255 channels.
 *
 * The native colour input only ever produces the long form, so anything else
 * is a caller bug and falls back to opaque black rather than propagating NaN
 * into every pixel of the frame.
 *
 * @param {string} hex
 * @returns {{r: number, g: number, b: number}}
 */
export function hexToRgb(hex) {
  const text = typeof hex === "string" ? hex.trim().replace(/^#/, "") : "";
  const full =
    text.length === 3
      ? text
          .split("")
          .map((c) => c + c)
          .join("")
      : text;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(value)) return { r: 0, g: 0, b: 0 };
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * sRGB-relative luminance of one pixel, 0 (black) to 1 (white).
 * The same weights the legacy sampler used.
 */
export function pixelLuma(data, index) {
  return (
    (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255
  );
}

/**
 * Ink radius for one cell, in pixels.
 *
 * The screen is subtractive, as a press is: a dark cell takes a big mark of ink
 * and a bright one takes none, which is what a photograph has to look right.
 * The radius never exceeds half the cell, so marks stay in their own cells and
 * can never merge into a solid block.
 *
 * @param {number} luminance 0 (black) to 1 (white)
 * @param {number} cellSize  the lattice pitch, in pixels
 * @returns {number} 0 to cellSize / 2, never NaN
 */
export function dotRadius(luminance, cellSize) {
  const half = Math.max(0, Number(cellSize) || 0) / 2;
  const tone = Number.isFinite(luminance) ? clamp01(luminance) : 1;
  return half * (1 - tone);
}

/**
 * The complementary measurement: how much of a cell is left as bare paper.
 *
 * This is the other half of the same screen, `cellSize / 2 - dotRadius`, named
 * separately because it is the number a print designer actually asks about: a
 * highlight keeps its full disc of paper, a shadow keeps none. The radius a
 * mark is drawn at is the ink one; this is what is left over.
 *
 * @param {number} luminance 0 (black) to 1 (white)
 * @param {number} cellSize  the lattice pitch, in pixels
 * @returns {number} 0 to cellSize / 2, never NaN
 */
export function paperRadius(luminance, cellSize) {
  const half = Math.max(0, Number(cellSize) || 0) / 2;
  const tone = Number.isFinite(luminance) ? clamp01(luminance) : 1;
  return half * tone;
}

/**
 * Ink radius for one CMYK channel.
 *
 * The opposite sense to the grayscale screen, and deliberately so: a channel
 * is a quantity of ink already present in the colour, not a brightness. Pure
 * black is full key ink, so it takes the largest mark.
 *
 * @param {number} amount 0 (no ink) to 1 (full ink)
 * @param {number} cellSize
 * @returns {number} 0 to cellSize / 2, never NaN
 */
export function channelRadius(amount, cellSize) {
  const half = Math.max(0, Number(cellSize) || 0) / 2;
  const tone = Number.isFinite(amount) ? clamp01(amount) : 0;
  return half * tone;
}

/**
 * Separation of one sRGB pixel into printing inks, 0 to 1 each.
 *
 * The naive GCR version, and the one the legacy tool used: the darkest of the
 * three channels becomes key, and what is left over is split between cyan,
 * magenta and yellow. It is not colour management, but it is what a four
 * screen print looks like, which is the point.
 *
 * @returns {{c: number, m: number, y: number, k: number}}
 */
export function rgbToCmyk(r, g, b) {
  const rn = clamp01(r / 255);
  const gn = clamp01(g / 255);
  const bn = clamp01(b / 255);
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };

  const spread = 1 - k;
  return {
    c: (1 - rn - k) / spread,
    m: (1 - gn - k) / spread,
    y: (1 - bn - k) / spread,
    k,
  };
}

/** Rotation of a point about the centre of the frame, in degrees. */
function rotateAboutCentre(x, y, width, height, cos, sin) {
  const dx = x - width / 2;
  const dy = y - height / 2;
  return {
    x: width / 2 + dx * cos - dy * sin,
    y: height / 2 + dx * sin + dy * cos,
  };
}

/**
 * Where a lattice point ends up on the frame once the screen is turned.
 *
 * @param {number} cx lattice x
 * @param {number} cy lattice y
 * @param {number} width
 * @param {number} height
 * @param {number} degrees
 * @returns {{x: number, y: number}}
 */
export function screenPoint(cx, cy, width, height, degrees) {
  const radians = (Number(degrees) || 0) * (Math.PI / 180);
  return rotateAboutCentre(cx, cy, width, height, Math.cos(radians), Math.sin(radians));
}

/**
 * The area the lattice has to cover, in lattice coordinates.
 *
 * For an unturned screen this is the frame itself. Turning the screen moves
 * marks outward, so the lattice grows to the turned frame plus one cell: a
 * quarter turn leaves it exactly where it started, which is the whole of what
 * "a 90 degree screen is the same screen" means here, and any other angle grows
 * it just enough that all four corners still get ink.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} cellSize
 * @param {number[]} degreesList every screen angle that has to fit
 * @returns {{left: number, top: number, right: number, bottom: number}}
 */
export function latticeExtent(width, height, cellSize, degreesList = [0]) {
  const pitch = Math.max(1, Math.round(Number(cellSize) || 1));
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const degrees of degreesList) {
    for (const [x, y] of [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ]) {
      const p = screenPoint(x, y, width, height, degrees);
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
  }

  // One spare cell on every side. A mark is at most half a cell across, so this
  // is the most that can be needed, and it costs one row and one column of
  // reads per side rather than the whole frame.
  return {
    left: Math.floor(left / pitch) * pitch - pitch,
    top: Math.floor(top / pitch) * pitch - pitch,
    right: Math.ceil(right / pitch) * pitch + pitch,
    bottom: Math.ceil(bottom / pitch) * pitch + pitch,
  };
}

/**
 * The cells a lattice extent is cut into.
 *
 * Independent of the screen angle, which is what the legacy sampler did, and
 * what makes a quarter turn provably the same screen: same pitch, same cells,
 * and a rotation that permutes them.
 *
 * @param {{left: number, top: number, right: number, bottom: number}} extent
 * @param {number} cellSize the lattice pitch, rounded to a whole pixel
 * @param {number} [top] first row to emit, for rendering a band at a time
 * @returns {Cell[]}
 */
export function cellRects(extent, cellSize, top = extent.top) {
  const pitch = Math.max(1, Math.round(Number(cellSize) || 1));
  const first = Math.max(extent.top, Math.floor(top));
  const last = Math.min(extent.bottom, first + Math.max(0, Math.ceil(extent.bottom - first)));
  const cells = [];

  for (let y = first; y < last; y += pitch) {
    const h = Math.min(pitch, extent.bottom - y);
    for (let x = extent.left; x < extent.right; x += pitch) {
      const w = Math.min(pitch, extent.right - x);
      cells.push({ x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
    }
  }

  return cells;
}

/**
 * Mean luminance of one cell, 0 to 1.
 *
 * `step` samples every nth pixel. The legacy sampler dropped to every second
 * pixel on a frame wider than 1920, which halves the work on exactly the images
 * that can least afford it, and is invisible once the result is a dot a few
 * pixels across.
 *
 * Reads outside the frame are skipped rather than clamped, so a cell hanging
 * over the edge takes the tone of the part of the picture that is on it.
 *
 * @param {Pixels} pixels
 * @param {Cell} cell
 * @param {number} [step]
 * @returns {number}
 */
export function cellLuminance(pixels, cell, step = 1) {
  const { width, height, data } = pixels;
  const stride = Math.max(1, Math.round(step));
  let sum = 0;
  let count = 0;

  for (let y = cell.y; y < cell.y + cell.h; y += stride) {
    if (y < 0 || y >= height) continue;
    const row = y * width;
    for (let x = cell.x; x < cell.x + cell.w; x += stride) {
      if (x < 0 || x >= width) continue;
      sum += pixelLuma(data, (row + x) * 4);
      count += 1;
    }
  }

  // A cell with no picture in it is paper, not a divide by zero that would put
  // NaN into a radius.
  return count > 0 ? sum / count : 1;
}

/**
 * Mean ink coverage of one cell, per CMYK channel, 0 to 1.
 *
 * The grayscale path reduces a cell to one number by averaging luminance. The
 * four process screens need four, and they all come out of the same read, so
 * the separation happens per pixel and the averaging happens once at the end.
 *
 * @param {Pixels} pixels
 * @param {Cell} cell
 * @param {number} [step]
 * @returns {{c: number, m: number, y: number, k: number}}
 */
export function cellChannelMeans(pixels, cell, step = 1) {
  const { width, height, data } = pixels;
  const stride = Math.max(1, Math.round(step));
  let c = 0;
  let m = 0;
  let y = 0;
  let k = 0;
  let count = 0;

  for (let py = cell.y; py < cell.y + cell.h; py += stride) {
    if (py < 0 || py >= height) continue;
    const row = py * width;
    for (let px = cell.x; px < cell.x + cell.w; px += stride) {
      if (px < 0 || px >= width) continue;
      const i = (row + px) * 4;
      const value = rgbToCmyk(data[i], data[i + 1], data[i + 2]);
      c += value.c;
      m += value.m;
      y += value.y;
      k += value.k;
      count += 1;
    }
  }

  if (count === 0) return { c: 0, m: 0, y: 0, k: 0 };
  return { c: c / count, m: m / count, y: y / count, k: k / count };
}

/**
 * Axis-aligned pixel bounds of a mark, clipped to the frame.
 *
 * @param {number} x mark centre on the frame
 * @param {number} y
 * @param {number} extentX half-width of the mark
 * @param {number} extentY half-height of the mark
 * @param {number} width
 * @param {number} height
 * @returns {{x0: number, y0: number, x1: number, y1: number}} x1/y1 exclusive
 */
export function markBounds(x, y, extentX, extentY, width, height) {
  return {
    x0: Math.max(0, Math.floor(x - extentX)),
    y0: Math.max(0, Math.floor(y - extentY)),
    x1: Math.min(width, Math.ceil(x + extentX)),
    y1: Math.min(height, Math.ceil(y + extentY)),
  };
}

/** Half-extents of a mark, before the screen angle is applied. */
function shapeExtents(shape, radius) {
  switch (shape) {
    case "line":
      return { x: radius, y: radius * LINE_RATIO };
    default:
      return { x: radius, y: radius };
  }
}

/**
 * How much of a pixel a mark covers, 0 to 1.
 *
 * `dx` and `dy` are the offset from the mark centre, already turned into the
 * screen's own axes by the caller, so a rotated screen costs one rotation per
 * pixel rather than a rotated rasteriser. The half pixel of feathering is what
 * stops a four pixel cell from looking like a staircase.
 */
function coverageAt(shape, dx, dy, radius) {
  const ux = Math.abs(dx);
  const uy = Math.abs(dy);

  if (shape === "square") {
    return clamp01(radius + 0.5 - ux) * clamp01(radius + 0.5 - uy);
  }
  if (shape === "line") {
    return clamp01(radius + 0.5 - ux) * clamp01(radius * LINE_RATIO + 0.5 - uy);
  }
  // A disc: distance to the centre. hypot rather than a squared test, because
  // this is the innermost loop of the whole tool.
  return clamp01(radius + 0.5 - Math.hypot(ux, uy));
}

/**
 * Print one mark.
 *
 * Two blends, one loop. A grayscale mark is ink of its own laid over the
 * paper, so a pixel moves towards the ink colour by its coverage. A CMYK mark
 * is one process colour laid over the others, so a pixel is multiplied by the
 * mix of paper and ink that the mark covers, which is the compositing the
 * legacy tool got from four canvases and a multiply.
 *
 * @param {Uint8ClampedArray} out
 * @param {number} width
 * @param {number} height
 * @param {number} mx mark centre on the frame
 * @param {number} my
 * @param {number} radius
 * @param {string} shape
 * @param {number} degrees
 * @param {number[]} colour
 * @param {boolean} subtractive
 */
function printMark(out, width, height, mx, my, radius, shape, degrees, colour, subtractive) {
  const { x: extentX, y: extentY } = shapeExtents(shape, radius);
  // A rotated square reaches its corners further out than its sides, so the
  // bounds have to allow for the diagonal or marks get clipped into hexagons.
  const corners = Math.abs(Math.cos((Number(degrees) || 0) * (Math.PI / 180))) +
    Math.abs(Math.sin((Number(degrees) || 0) * (Math.PI / 180)));
  const bounds = markBounds(
    mx,
    my,
    extentX * corners + 1,
    extentY * corners + 1,
    width,
    height,
  );
  if (bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0) return;

  const radians = (Number(degrees) || 0) * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Per-channel ink strength. Opaque ink lays its own colour down; process ink
  // is 1 on the channels it leaves alone and 0 on the one it removes.
  const strength = subtractive
    ? [colour[0] / 255, colour[1] / 255, colour[2] / 255]
    : [1, 1, 1];

  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    const rowBase = y * width;

    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      // Turn the offset from the mark centre into the screen's axes.
      const dx = x + 0.5 - mx;
      const dy = y + 0.5 - my;
      const coverage = coverageAt(
        shape,
        dx * cos + dy * sin,
        -dx * sin + dy * cos,
        radius,
      );
      if (coverage <= 0) continue;

      const i = (rowBase + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        // A press lays ink where the mark covers and bare paper where it does
        // not, and a pixel is multiplied by that mix. A channel the ink leaves
        // alone has a strength of 1 and comes through untouched, which is what
        // keeps a red page red instead of going black wherever a yellow dot
        // happens to land.
        const target = subtractive
          ? out[i + c] * (1 - coverage + coverage * strength[c])
          : out[i + c] + (colour[c] - out[i + c]) * coverage;
        out[i + c] = target;
      }
    }
  }
}

/**
 * Lay the paper down, one flat colour over the whole frame.
 * @returns {Uint8ClampedArray}
 */
function layPaper(width, height, paper, alpha) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = paper.r;
    out[i + 1] = paper.g;
    out[i + 2] = paper.b;
    // The screen prints on the sheet, so what shows through is whatever was
    // transparent in the source. An opaque photo is unaffected.
    out[i + 3] = alpha ? alpha[i + 3] : 255;
  }
  return out;
}

/**
 * The whole screen.
 *
 * Grayscale mode lays the paper down, reduces every cell to one number and
 * prints a mark of ink sized by it. CMYK mode does the same four times over,
 * one process colour at a time on its own fixed angle, and lets the four
 * multiply together into a colour rosette, which is how a four colour press
 * builds tone.
 *
 * The loop hands the main thread back between row bands and gives up entirely
 * if `isCancelled` reports that the caller has moved on. Small images never
 * yield, so a cheap call costs nothing to schedule.
 *
 * @param {Pixels} pixels
 * @param {object} params
 * @param {"grayscale" | "cmyk"} [params.mode]
 * @param {number} [params.cellSize]
 * @param {string} [params.dotColor]
 * @param {string} [params.bgColor]
 * @param {"circle" | "square" | "line"} [params.shape]
 * @param {number} [params.angle]
 * @param {PassOptions} [options]
 * @returns {Promise<Pixels | null>} null when cancelled
 */
export async function renderHalftone(pixels, params = {}, options = {}) {
  const { width, height, data } = pixels;
  const {
    mode = "grayscale",
    cellSize = 10,
    dotColor = "#000000",
    bgColor = "#ffffff",
    shape = "circle",
    angle = 0,
  } = params;
  const { isCancelled = () => false, onProgress = null } = options;

  const cmyk = mode === "cmyk";
  // A CMYK print is always on white: the four inks are subtractive, so the
  // paper is part of the colour.
  const paper = cmyk ? { r: 255, g: 255, b: 255 } : hexToRgb(bgColor);
  const ink = hexToRgb(dotColor);
  const pitch = Math.max(1, Math.round(Number(cellSize) || 1));
  // The legacy sampler halved its reads on a frame wider than 1920.
  const step = width > 1920 ? 2 : 1;

  const out = layPaper(width, height, paper, data);

  /** @type {CmykScreen[]} */
  const screens = cmyk
    ? CMYK_SCREENS
    : [{ channel: "l", angle, colour: [ink.r, ink.g, ink.b] }];
  const extent = latticeExtent(
    width,
    height,
    pitch,
    screens.map((screen) => screen.angle),
  );
  const rows = Math.max(1, Math.ceil((extent.bottom - extent.top) / pitch));
  const band = rowsPerChunk(extent, pitch) || rows;

  for (let row0 = 0; row0 < rows; row0 += band) {
    const rowEnd = Math.min(rows, row0 + band);
    const cells = cellRects(extent, pitch, extent.top + row0 * pitch);

    for (const cell of cells) {
      // The picture area this lattice cell covers once the screen is turned.
      // Reading the tone from here is what makes the rotation honest: a turned
      // screen has to look at the picture through its own turned cells.
      for (const screen of screens) {
        const spot = cellOnFrame(width, height, cell, screen.angle);
        if (!spot) continue;

        const radius = cmyk
          ? channelRadius(cellChannelMeans(pixels, spot, step)[screen.channel], pitch)
          : dotRadius(cellLuminance(pixels, spot, step), pitch);
        if (radius < MIN_DOT_RADIUS) continue;

        const mark = screenPoint(cell.cx, cell.cy, width, height, screen.angle);
        printMark(
          out,
          width,
          height,
          mark.x,
          mark.y,
          radius,
          shape,
          screen.angle,
          screen.colour,
          cmyk,
        );
      }
    }

    onProgress?.(rowEnd / rows);
    if (isCancelled()) return null;
    if (band < rows) await idle();
  }

  onProgress?.(1);
  return { width, height, data: out };
}

/**
 * The area of the frame a lattice cell covers once the screen is turned.
 *
 * A quarter turn lands the cell squarely on a cell of the same pitch, which is
 * why a 90 degree screen is the same screen. Any other angle lands it between
 * cells, so the cell is read where it actually falls and the marks beside it
 * fill the gap.
 *
 * @param {number} width
 * @param {number} height
 * @param {Cell} cell
 * @param {number} degrees
 * @returns {Cell | null} null if the cell has turned off the frame entirely
 */
export function cellOnFrame(width, height, cell, degrees) {
  const centre = screenPoint(cell.cx, cell.cy, width, height, degrees);
  const half = Math.max(cell.w, cell.h) / 2;
  if (centre.x < -half || centre.y < -half || centre.x > width + half || centre.y > height + half) {
    return null;
  }
  return {
    x: Math.floor(centre.x - cell.w / 2),
    y: Math.floor(centre.y - cell.h / 2),
    w: cell.w,
    h: cell.h,
    cx: centre.x,
    cy: centre.y,
  };
}
