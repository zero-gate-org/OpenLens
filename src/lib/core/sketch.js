/**
 * Sketch: a line drawing, built from detected edges.
 *
 * There are two halves to this tool and they are separated on purpose. The
 * first is measurement: a frame is reduced to grey, a convolution turns that
 * into an edge map, line weight widens it and a sensitivity cuts it back. The
 * second is drawing: those edges become ink on paper, or strokes of hatching
 * where tone was dark.
 *
 * Everything here is pure arithmetic over a plain `{ width, height, data }`
 * object, which is the shape `ImageData` has. No canvas is created, no
 * `ImageData` is constructed and no `ImageData` global is touched, so the
 * whole module runs in plain Node and can be unit tested without a browser,
 * and the same code runs unchanged inside a Web Worker. Turning a result back
 * into real pixels is the caller's job.
 *
 * The hatching half is worth a note. The legacy tool drew it as thousands of
 * one pixel canvas strokes on the main thread, which is why hatching felt
 * heavier than the other modes. Here it is an accumulation buffer: each stroke
 * adds ink coverage, overlaps add up, and one pass over the buffer turns
 * coverage into colour. Same picture, and it can live in the worker with
 * everything else.
 *
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 * @typedef {"sobel" | "laplacian" | "pencil" | "colored-pencil" | "hatching"} SketchMode
 *
 * @typedef {object} SketchOptions
 * @property {SketchMode} [mode]         which drawing to run
 * @property {number} [threshold]        0..255, edges weaker than this are dropped
 * @property {number} [lineWeight]       1..5, how far every line is widened
 * @property {number} [blend]            0..100, how much tone shows under the ink
 * @property {string} [ink]              `#rrggbb`, the colour of a line
 * @property {string} [paper]            `#rrggbb`, the colour the lines sit on
 * @property {number} [hatchLength]      4..20, stroke length in pixels
 * @property {number} [hatchDensity]     0..100, how much of the frame is hatched
 *
 * @typedef {object} Edges
 * @property {number} width
 * @property {number} height
 * @property {Float32Array} edges        0..255, 0 where no line was found
 * @property {Float32Array | null} angles radians, the direction of each edge
 */

import { hexToRgb } from "./duotonemath.js";

/**
 * The largest edge strength there is, in 0..255 units.
 *
 * Every mode normalises against this, so it is the scale the sensitivity
 * slider is quoted in: 0 catches everything, 255 catches only the hardest
 * steps in the frame.
 */
export const MAX_EDGE = 255;

/**
 * The spacing of the samples along one hatch stroke, in pixels.
 *
 * One sample per pixel, spread over the four pixels it falls between. A
 * denser sampling would cost more for an edge no viewer can resolve.
 */
const HATCH_STEP = 1;

/**
 * How much of the original tone a full blend puts under the ink, 0..1.
 *
 * The legacy tool folded grey in at 0.3, and the number is kept: a blend of
 * 100 is a hint of the picture underneath the lines, not a wash over them.
 */
const TONE_WEIGHT = 0.3;

/**
 * Perceptual grey of one pixel, 0..255.
 *
 * The same weights the rest of the app uses, so a mid grey here is the same
 * mid grey everywhere else.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number} 0..255
 */
export function tone(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Reduce a frame to one grey value per pixel.
 *
 * @param {Pixels} pixels
 * @returns {Float32Array} 0..255
 */
export function toGrayscale(pixels) {
  const { data } = pixels;
  const out = new Float32Array(pixels.width * pixels.height);
  for (let i = 0; i < out.length; i++) {
    const j = i * 4;
    out[i] = tone(data[j], data[j + 1], data[j + 2]);
  }
  return out;
}

/**
 * Sobel gradient magnitude and direction, over a frame of grey.
 *
 * The horizontal and vertical kernels are evaluated in the same pass. The
 * legacy tool ran them as two full convolutions, which reads the same nine
 * values twice; the arithmetic here is identical and the frame is walked once.
 *
 * The one pixel border is left at zero, as it is in every convolution of a
 * fixed size kernel: a line there would be half invented.
 *
 * @param {Float32Array} gray
 * @param {number} width
 * @param {number} height
 * @returns {{edges: Float32Array, angles: Float32Array}}
 */
function sobelEdges(gray, width, height) {
  const edges = new Float32Array(width * height);
  const angles = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    const top = (y - 1) * width;
    const mid = y * width;
    const bottom = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const tl = gray[top + x - 1];
      const tc = gray[top + x];
      const tr = gray[top + x + 1];
      const ml = gray[mid + x - 1];
      const mr = gray[mid + x + 1];
      const bl = gray[bottom + x - 1];
      const bc = gray[bottom + x];
      const br = gray[bottom + x + 1];

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const magnitude = Math.sqrt(gx * gx + gy * gy);

      const i = mid + x;
      edges[i] = magnitude > MAX_EDGE ? MAX_EDGE : magnitude;
      // The direction of the gradient, which is perpendicular to the line
      // the gradient found. Hatching uses that to stroke across it.
      angles[i] = Math.atan2(gy, gx);
    }
  }

  return { edges, angles };
}

/**
 * Laplacian magnitude, over a frame of grey.
 *
 * The second derivative rather than the first, so it answers a step the same
 * on both sides of it, and is nearly blind to a smooth gradient. A face
 * drawn with it has fewer, harder lines than the same face drawn with Sobel.
 *
 * @param {Float32Array} gray
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array} 0..255
 */
function laplacianEdges(gray, width, height) {
  const edges = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    const top = (y - 1) * width;
    const mid = y * width;
    const bottom = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const lap =
        4 * gray[mid + x] - gray[top + x] - gray[mid + x - 1] - gray[mid + x + 1] - gray[bottom + x];
      const magnitude = Math.abs(lap);
      edges[mid + x] = magnitude > MAX_EDGE ? MAX_EDGE : magnitude;
    }
  }

  return edges;
}

/**
 * Widen every line, as a square max filter of the given radius.
 *
 * The legacy tool scanned the whole square per pixel, which is 81 reads a
 * pixel at the heaviest line weight. A square max is exactly a row max
 * followed by a column max, so the two passes below are the same filter for
 * 2(2r+1) reads instead, and the result is identical.
 *
 * @param {Float32Array} buffer
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @returns {Float32Array} a new buffer
 */
function dilateMax(buffer, width, height, radius) {
  const r = Math.max(1, Math.floor(radius));
  const across = new Float32Array(buffer.length);
  const out = new Float32Array(buffer.length);

  for (let y = 0; y < height; y++) {
    const base = y * width;
    for (let x = 0; x < width; x++) {
      const from = Math.max(0, x - r);
      const to = Math.min(width - 1, x + r);
      let best = 0;
      for (let k = from; k <= to; k++) {
        const value = buffer[base + k];
        if (value > best) best = value;
      }
      across[base + x] = best;
    }
  }

  for (let y = 0; y < height; y++) {
    const from = Math.max(0, y - r);
    const to = Math.min(height - 1, y + r);
    const base = y * width;
    for (let x = 0; x < width; x++) {
      let best = 0;
      for (let k = from; k <= to; k++) {
        const value = across[k * width + x];
        if (value > best) best = value;
      }
      out[base + x] = best;
    }
  }

  return out;
}

/**
 * Find the lines in a frame, widen them, and cut them back to what the
 * sensitivity keeps.
 *
 * The returned buffer always belongs to the caller, so the threshold pass can
 * write into it in place without touching the source frame.
 *
 * @param {Pixels} pixels
 * @param {SketchOptions} [options]
 * @returns {Edges}
 */
export function detectEdges(pixels, options = {}) {
  const { mode = "sobel", threshold = 80, lineWeight = 1 } = options;
  const { width, height } = pixels;

  const gray = toGrayscale(pixels);
  const directional = mode !== "laplacian";
  const found = directional
    ? sobelEdges(gray, width, height)
    : { edges: laplacianEdges(gray, width, height), angles: null };

  const edges = lineWeight > 1 ? dilateMax(found.edges, width, height, lineWeight) : found.edges;

  const cut = Math.max(0, Math.min(MAX_EDGE, threshold));
  for (let i = 0; i < edges.length; i++) {
    if (edges[i] < cut) edges[i] = 0;
  }

  return { width, height, edges, angles: found.angles };
}

/**
 * How much of an edge's strength becomes ink, 0..1.
 *
 * @param {number} strength 0..255
 * @returns {number} 0..1
 */
export function lineDensity(strength) {
  if (!(strength > 0)) return 0;
  return strength >= MAX_EDGE ? 1 : strength / MAX_EDGE;
}

/**
 * The strength a pixel has to reach before it is hatched, 0..255.
 *
 * Density reads as "how much of the frame carries strokes", so it inverts into
 * a cut: 0 percent puts the cut above every possible strength and nothing is
 * drawn, 100 percent puts it at zero and every edge the sensitivity kept is
 * drawn.
 *
 * @param {number} density 0..100
 * @returns {number} 0..255
 */
export function hatchCut(density) {
  const span = Math.max(0, Math.min(100, density)) / 100;
  return (1 - span) * MAX_EDGE;
}

/**
 * Hatching: fill tone with strokes.
 *
 * Each pixel above the density cut lays one stroke along the direction across
 * its edge, and the strokes accumulate into a coverage buffer. Overlapping
 * strokes darken, which is the whole point: a dark area of the picture is
 * built from crossings, and a light one from a single pass. The buffer is
 * turned into colour in one pass at the end, between ink and paper.
 *
 * The frame comes back opaque whatever the source was, because hatching paints
 * a sheet and the sheet is not transparent. The legacy tool filled its canvas
 * with paper before it drew.
 *
 * @param {Pixels} pixels
 * @param {SketchOptions} [options]
 * @returns {Pixels}
 */
export function applyHatching(pixels, options = {}) {
  const { width, height } = pixels;
  const {
    hatchLength = 8,
    hatchDensity = 60,
    ink: inkColor = "#1a1a1a",
    paper: paperColor = "#ffffff",
  } = options;

  const { edges, angles } = detectEdges(pixels, { ...options, mode: "hatching" });
  const ink = hexToRgb(inkColor);
  const paper = hexToRgb(paperColor);
  const cover = new Float32Array(width * height);
  const cut = hatchCut(hatchDensity);
  const reach = Math.max(1, hatchLength) / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const strength = edges[i];
      // Strictly above the cut, so a density of zero leaves bare paper rather
      // than a handful of fully saturated strokes.
      if (strength <= cut) continue;

      const alpha = lineDensity(strength);
      // A stroke runs across its edge, not along it, which is what makes a
      // hatched area read as tone instead of as more edges.
      const across = (angles ? angles[i] : 0) + Math.PI / 2;
      const dx = Math.cos(across) * HATCH_STEP;
      const dy = Math.sin(across) * HATCH_STEP;

      for (let t = -reach; t <= reach; t += HATCH_STEP) {
        const px = x + dx * t;
        const py = y + dy * t;
        // Off the sheet is off the sheet. The legacy canvas clipped the same
        // way, and letting a sample pile onto the border would draw a frame
        // that is not in the picture.
        if (px < 0 || px >= width || py < 0 || py >= height) continue;

        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        // Past the last pixel the sample is folded into it, so its coverage
        // still adds up to one.
        const x1 = x0 + 1 < width ? x0 + 1 : x0;
        const y1 = y0 + 1 < height ? y0 + 1 : y0;
        const tx = px - x0;
        const ty = py - y0;

        cover[y0 * width + x0] += alpha * (1 - tx) * (1 - ty);
        cover[y0 * width + x1] += alpha * tx * (1 - ty);
        cover[y1 * width + x0] += alpha * (1 - tx) * ty;
        cover[y1 * width + x1] += alpha * tx * ty;
      }
    }
  }

  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < cover.length; i++) {
    const c = cover[i] > 1 ? 1 : cover[i];
    const j = i * 4;
    out[j] = paper.r + (ink.r - paper.r) * c;
    out[j + 1] = paper.g + (ink.g - paper.g) * c;
    out[j + 2] = paper.b + (ink.b - paper.b) * c;
    out[j + 3] = 255;
  }

  return { width, height, data: out };
}

/**
 * Turn a frame into a line drawing.
 *
 * Four modes share one shape. The edge map is the drawing, upside down: a
 * pixel with a line through it is ink, and a pixel with nothing is paper. The
 * pencil modes add a little of the original back, as tone under the ink for
 * the ink and paper mode and as a multiplier for the mode that keeps the
 * picture's own hues.
 *
 * @param {Pixels} pixels
 * @param {SketchOptions} [options]
 * @returns {Pixels} always a new buffer
 */
export function applySketch(pixels, options = {}) {
  const { mode = "sobel", blend = 30, ink: inkColor = "#1a1a1a", paper: paperColor = "#ffffff" } =
    options;

  if (mode === "hatching") return applyHatching(pixels, options);

  const { width, height, data } = pixels;
  const { edges } = detectEdges(pixels, options);
  const ink = hexToRgb(inkColor);
  const paper = hexToRgb(paperColor);

  const toned = mode === "pencil" || mode === "colored-pencil";
  const gray = toned ? toGrayscale(pixels) : null;
  const amount = toned ? Math.max(0, Math.min(100, blend)) / 100 : 0;

  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < width * height; i++) {
    const j = i * 4;
    let t = (MAX_EDGE - edges[i]) / MAX_EDGE;

    if (toned) {
      t = t * (1 - amount) + (gray[i] / MAX_EDGE) * amount * TONE_WEIGHT;
    }

    if (mode === "colored-pencil") {
      out[j] = data[j] * t;
      out[j + 1] = data[j + 1] * t;
      out[j + 2] = data[j + 2] * t;
    } else {
      out[j] = ink.r + t * (paper.r - ink.r);
      out[j + 1] = ink.g + t * (paper.g - ink.g);
      out[j + 2] = ink.b + t * (paper.b - ink.b);
    }

    out[j + 3] = data[j + 3];
  }

  return { width, height, data: out };
}
