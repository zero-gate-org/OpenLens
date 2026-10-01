/**
 * The Kuwahara filter, in the two forms a painterly effect needs, plus the two
 * finishing passes that go with it.
 *
 * Kuwahara works one pixel at a time. Around the pixel, split the
 * neighbourhood into a few regions, and for each region work out how flat it is
 * (the variance of its luminance) and what its average colour is. Take the
 * average colour of the flattest region. Because each region is one-sided, the
 * result never mixes a pixel with a region on the other side of an edge, which
 * is what turns a photograph into patches of paint instead of into a blur.
 *
 * Two forms, and they are not the same filter:
 *
 *  - Standard, four quadrants. Each quadrant is measured in constant time from
 *    a summed area table, so the cost per pixel does not depend on the radius.
 *  - Generalized, N sectors of a disc, Gaussian weighted. A radius 4 disc split
 *    into 8 sectors smooths better than four square quadrants, and costs
 *    O(radius² · sectors) per pixel, which is the difference between an
 *    interactive control and a tab that stops responding.
 *
 * On memory. The legacy worker built five summed area tables, one per channel
 * plus the luminance and its square, and read the winning quadrant's mean
 * colour straight out of them. That is 5 × 8 bytes × (w+1)(h+1), which is
 * about 500 MB on a twelve megapixel frame. Only the variance needs constant
 * time, so this builds one table with the two luminance sums interleaved
 * (16 bytes per pixel, about 200 MB at that size) and sums the winner's colour
 * directly. At radius 4 that is 25 taps in one contiguous block rather than 15
 * scattered reads into five tables larger than the frame's cache, and it is
 * three and a half times less memory to build.
 *
 * Everything here is pure arithmetic over a plain `{ width, height, data }`
 * object, which is the shape `ImageData` has. No canvas is created, no
 * `ImageData` is constructed and no DOM or worker API is touched, so the whole
 * module runs in plain Node and can be unit tested without a browser, and the
 * same code runs unchanged inside a Web Worker. Turning a result back into real
 * pixels is the caller's job.
 *
 * Every parameter that can divide is guarded, because a panel can put every one
 * of them at an extreme. A radius of 0, a pass count of 0 and a sector count
 * below the minimum the maths needs are all clamped by `normalizeOptions`, and
 * the two passes below also return the frame untouched rather than producing a
 * NaN if they are called with one directly. The sector count has a floor for a
 * real reason: with a handful of sectors a disc is barely a disc, and a sector
 * narrow enough to hold no pixel at all has a weight sum of zero, which is a
 * division by zero if it is not skipped.
 *
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 * @typedef {"standard" | "generalized"} KuwaharaMode
 *
 * @typedef {object} KuwaharaOptions
 * @property {KuwaharaMode} [mode]        which of the two forms to run
 * @property {number} [radius]            window half width, in pixels
 * @property {number} [passes]            how many times to run it over its own output
 * @property {number} [sectors]           sectors per pixel, generalized only
 * @property {number} [saturation]        0..100, colour pushed away from grey
 * @property {number} [sharpen]           0..100, unsharp mask on the result
 * @property {(ratio: number) => void} [onProgress]  0..1 across the whole call
 */

// The one colour conversion this needs is the HSL round trip in `lomo.js`, which
// is already unit tested. At a factor of 1 it returns the pixel untouched, so a
// frame with no saturation boost comes out bit for bit as it went in.
import { saturatePixel } from "./lomo.js";

/** sRGB luminance weights. The same three the rest of the app measures with. */
const LUM_R = 0.2126;
const LUM_G = 0.7152;
const LUM_B = 0.0722;

/**
 * The saturation boost, in percent, is a multiple of this much.
 *
 * 100 % is 1.5 times the saturation, which is the ceiling the legacy slider
 * reached. Pushing colour much past that stops looking like paint and starts
 * looking like a poster.
 */
const SATURATION_CEILING = 0.5;

/** 100 % of the edge sharpen is this much of the unsharp mask. */
const SHARPEN_CEILING = 1.5;

/** A radius below this has no window, so it is the identity rather than a pass. */
export const MIN_RADIUS = 1;
export const MAX_RADIUS = 15;
export const MIN_PASSES = 1;
export const MAX_PASSES = 4;

/**
 * The fewest sectors a generalized pass will run.
 *
 * Four is the number of regions the standard form uses, so anything fewer is a
 * disc with pieces cut out of it rather than a finer subdivision of one.
 */
export const MIN_SECTORS = 4;
export const MAX_SECTORS = 16;

export const KUWAHARA_MODES = [
  { value: "standard", label: "Standard" },
  { value: "generalized", label: "Generalized" },
];

/**
 * What a panel starts on.
 *
 * The legacy panel's own starting values: radius 4, one pass, eight sectors,
 * and both finishing passes off, because those two are an addition to the
 * effect rather than part of it.
 */
export const OIL_PAINT_DEFAULTS = {
  mode: "standard",
  radius: 4,
  passes: 1,
  sectors: 8,
  saturation: 0,
  sharpen: 0,
};

/**
 * Ready made settings.
 *
 * The legacy four, unchanged, because each one is a complete look rather than
 * the settings that happen to differ, so a preset can be read against the panel
 * above it and matched exactly.
 */
export const OIL_PAINT_PRESETS = [
  { name: "Watercolour", mode: "standard", radius: 3, passes: 1, sectors: 8, saturation: 20, sharpen: 0 },
  { name: "Oil painting", mode: "standard", radius: 6, passes: 2, sectors: 8, saturation: 30, sharpen: 30 },
  { name: "Heavy impasto", mode: "standard", radius: 10, passes: 3, sectors: 8, saturation: 50, sharpen: 0 },
  { name: "Smooth style", mode: "generalized", radius: 5, passes: 1, sectors: 8, saturation: 10, sharpen: 0 },
];

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * One integer inside a range, with anything unreadable read as the default.
 *
 * A slider cannot produce a NaN, but a number field can produce one and a
 * future caller can pass a string, and every one of those values reaches the
 * arithmetic that indexes an array and divides by it.
 *
 * @param {unknown} value
 * @param {number} low
 * @param {number} high
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, low, high, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(low, Math.min(high, n));
}

/** @param {unknown} value @returns {number} 0..100 */
export function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** @param {unknown} value @returns {number} 1..15 */
export function normalizeRadius(value) {
  return clampInt(value, MIN_RADIUS, MAX_RADIUS, OIL_PAINT_DEFAULTS.radius);
}

/** @param {unknown} value @returns {number} 1..4 */
export function normalizePasses(value) {
  return clampInt(value, MIN_PASSES, MAX_PASSES, OIL_PAINT_DEFAULTS.passes);
}

/**
 * @param {unknown} value
 * @returns {number} 4..16
 */
export function normalizeSectors(value) {
  return clampInt(value, MIN_SECTORS, MAX_SECTORS, OIL_PAINT_DEFAULTS.sectors);
}

/**
 * Every option read safely, so the arithmetic below never has to check again.
 *
 * @param {KuwaharaOptions} [options]
 * @returns {{mode: KuwaharaMode, radius: number, passes: number, sectors: number,
 *   saturation: number, sharpen: number}}
 */
export function normalizeOptions(options = {}) {
  return {
    mode: options?.mode === "generalized" ? "generalized" : "standard",
    radius: normalizeRadius(options?.radius),
    passes: normalizePasses(options?.passes),
    sectors: normalizeSectors(options?.sectors),
    saturation: clampPercent(options?.saturation),
    sharpen: clampPercent(options?.sharpen),
  };
}

// ---------------------------------------------------------------------------
// The luminance summed area table
// ---------------------------------------------------------------------------

/**
 * The sums a variance needs about every rectangle, in one table.
 *
 * A summed area table holds the sum of everything above and to the left of each
 * pixel, so the sum of any rectangle is four of those entries added and
 * subtracted, whatever its size. Both quantities a variance needs sit in the
 * same table, one after the other, so reading a rectangle touches one cache
 * line pair rather than two distant arrays.
 *
 * Row zero and column zero are left at zero, which is what lets `rectSum` do
 * plain arithmetic with no tests for the edges: the entry that would be read
 * outside the table is exactly the zero that belongs there.
 *
 * Float64, not Float32. The table accumulates the whole frame before any
 * rectangle is read out of it, and the total reaches 255 × 12,000,000 for the
 * first sum, which is past what a float32 mantissa can hold without losing the
 * small rectangles that are the entire point of the table.
 *
 * @param {Pixels} pixels
 * @returns {{width: number, height: number, table: Float64Array}}
 */
export function buildLuminanceSat(pixels) {
  const { width, height, data } = pixels;
  const w1 = width + 1;
  const table = new Float64Array(2 * w1 * (height + 1));

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    let rowSumSq = 0;
    const rowBase = (y + 1) * w1;
    const prevBase = y * w1;

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = LUM_R * data[i] + LUM_G * data[i + 1] + LUM_B * data[i + 2];
      rowSum += lum;
      rowSumSq += lum * lum;

      const at = 2 * (rowBase + x + 1);
      const above = 2 * (prevBase + x + 1);
      table[at] = rowSum + table[above];
      table[at + 1] = rowSumSq + table[above + 1];
    }
  }

  return { width: w1, height: height + 1, table };
}

/**
 * The sum of the luminance and of its square over one rectangle, inclusive.
 *
 * `out` is written rather than returned, because this runs four times per pixel
 * and a pair of fresh numbers per quadrant is a pair of fresh numbers per pixel
 * for the collector to chase.
 *
 * @param {{width: number, height: number, table: Float64Array}} sat from `buildLuminanceSat`
 * @param {number} x1 left edge, 0 or more
 * @param {number} y1 top edge, 0 or more
 * @param {number} x2 right edge, inside the frame
 * @param {number} y2 bottom edge, inside the frame
 * @param {number[]} out two slots, reused by every call
 * @returns {number[]} `out`
 */
export function rectSum(sat, x1, y1, x2, y2, out) {
  const w1 = sat.width;
  const table = sat.table;
  const bottom = (y2 + 1) * w1;
  const top = y1 * w1;

  out[0] = table[2 * (bottom + x2 + 1)] - table[2 * (top + x2 + 1)] - table[2 * (bottom + x1)] + table[2 * (top + x1)];
  out[1] =
    table[2 * (bottom + x2 + 1) + 1] - table[2 * (top + x2 + 1) + 1] - table[2 * (bottom + x1) + 1] + table[2 * (top + x1) + 1];
  return out;
}

// ---------------------------------------------------------------------------
// Standard Kuwahara: four quadrants
// ---------------------------------------------------------------------------

/**
 * The flattest of the four quadrants around each pixel.
 *
 * One pass, in constant time per pixel: four rectangles out of the table for
 * the variance, then a walk over the winner for its mean colour. The four
 * quadrants are measured in order and a later one has to be strictly flatter to
 * win, which is what makes a hard edge resolve towards the upper left rather
 * than flickering between two equally flat regions.
 *
 * The window clamps at the frame edge, so a border replicates rather than
 * turning into a band of black.
 *
 * @param {Pixels} pixels
 * @param {number} radius in pixels, at least 1
 * @param {{onProgress?: (ratio: number) => void}} [pass]
 * @returns {Pixels}
 */
export function kuwaharaQuadrants(pixels, radius, pass = {}) {
  const { width, height, data } = pixels;
  const out = new Uint8ClampedArray(data.length);
  const r = Math.round(radius);
  // No window, no filter. Returning a copy rather than the input is deliberate:
  // the caller transfers the input buffer away and needs something to hand back.
  if (!(r >= 1) || width < 1 || height < 1) {
    out.set(data);
    return { width, height, data: out };
  }

  const onProgress = pass.onProgress ?? null;
  const sat = buildLuminanceSat(pixels);
  const pair = [0, 0];
  // About twenty reports over a pass, which is enough for a progress bar and
  // not enough to spend the pass calling back.
  const band = Math.max(1, Math.floor(height / 20));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = x - r;
      const right = x + r;
      const top = y - r;
      const bottom = y + r;

      let bestVariance = Infinity;
      let winX1 = x;
      let winY1 = y;
      let winX2 = x;
      let winY2 = y;
      let winCount = 1;

      for (let q = 0; q < 4; q++) {
        // q0 top left, q1 top right, q2 bottom left, q3 bottom right.
        const leftHalf = q === 0 || q === 2;
        const topHalf = q === 0 || q === 1;

        const x1 = Math.max(0, leftHalf ? left : x);
        const y1 = Math.max(0, topHalf ? top : y);
        const x2 = Math.min(width - 1, leftHalf ? x : right);
        const y2 = Math.min(height - 1, topHalf ? y : bottom);

        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        if (count <= 0) continue;

        rectSum(sat, x1, y1, x2, y2, pair);
        const mean = pair[0] / count;
        const variance = pair[1] / count - mean * mean;

        if (variance < bestVariance) {
          bestVariance = variance;
          winX1 = x1;
          winY1 = y1;
          winX2 = x2;
          winY2 = y2;
          winCount = count;
        }
      }

      // The winner's mean colour, read from the frame rather than from a third
      // table. Its bounds are contiguous and in cache, which is why this is not
      // the slow part of the pass.
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let yy = winY1; yy <= winY2; yy++) {
        let i = (yy * width + winX1) * 4;
        for (let xx = winX1; xx <= winX2; xx++) {
          rSum += data[i];
          gSum += data[i + 1];
          bSum += data[i + 2];
          i += 4;
        }
      }

      const at = (y * width + x) * 4;
      // A clamped array rounds and refuses to leave 0..255, so a mean cannot
      // escape the range and a NaN would land on 0 rather than on a hole.
      out[at] = rSum / winCount;
      out[at + 1] = gSum / winCount;
      out[at + 2] = bSum / winCount;
      out[at + 3] = data[at + 3];
    }

    if (onProgress && (y + 1) % band === 0) onProgress((y + 1) / height);
  }

  return { width, height, data: out };
}

// ---------------------------------------------------------------------------
// Generalized Kuwahara: N sectors of a disc
// ---------------------------------------------------------------------------

/**
 * The geometry of a generalized pass, built once and reused for every pixel.
 *
 * The weight of an offset depends only on how far it is from the centre, and
 * which sector it belongs to depends only on its angle, so both are worked out
 * here rather than inside the inner loop. Offsets are grouped by sector, so the
 * inner loop walks one sector's own offsets and accumulates into six local
 * numbers instead of into a per pixel array that would have to be cleared
 * between pixels.
 *
 * The sigma is floored at 0.5 rather than taken from the radius directly,
 * because a radius of 0 makes the exponent's denominator zero and the weight at
 * the centre becomes exp(NaN). The floor makes a degenerate radius a one pixel
 * window instead of a table of NaN.
 *
 * @param {number} radius
 * @param {number} sectors
 * @returns {{dx: Int32Array, dy: Int32Array, weight: Float64Array, starts: Int32Array}}
 */
export function buildSectorTable(radius, sectors) {
  const r = Math.max(1, Math.round(radius));
  const n = Math.max(MIN_SECTORS, Math.round(sectors));
  const size = 2 * r + 1;
  const sigma = Math.max(0.5, r / 2);
  const twoSigmaSq = 2 * sigma * sigma;

  const count = size * size;
  const dx = new Int32Array(count);
  const dy = new Int32Array(count);
  const weight = new Float64Array(count);
  /** Offsets grouped by sector: sector s owns [starts[s], starts[s + 1]). */
  const starts = new Int32Array(n + 1);
  const owner = new Int32Array(count);

  const step = (2 * Math.PI) / n;
  const half = step / 2;

  let total = 0;
  for (let ky = -r; ky <= r; ky++) {
    for (let kx = -r; kx <= r; kx++) {
      const at = (ky + r) * size + (kx + r);
      dx[at] = kx;
      dy[at] = ky;
      weight[at] = Math.exp(-(kx * kx + ky * ky) / twoSigmaSq);
      owner[at] = sectorAt(Math.atan2(ky, kx), step, half, n);
      total++;
    }
  }

  for (let s = 0; s <= n; s++) starts[s] = 0;
  for (let at = 0; at < total; at++) starts[owner[at] + 1] += 1;
  for (let s = 0; s < n; s++) starts[s + 1] += starts[s];

  // Bucket the offsets into their sectors with a counting sort, which is a
  // forward pass and a backward pass rather than an array per sector.
  const order = new Int32Array(total);
  const cursor = Int32Array.from(starts.subarray(0, n));
  for (let at = 0; at < total; at++) {
    const s = owner[at];
    order[cursor[s]++] = at;
  }

  const outDx = new Int32Array(total);
  const outDy = new Int32Array(total);
  const outWeight = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    const at = order[i];
    outDx[i] = dx[at];
    outDy[i] = dy[at];
    outWeight[i] = weight[at];
  }

  return { dx: outDx, dy: outDy, weight: outWeight, starts };
}

/**
 * Which sector one angle falls into, wrapping at the top and the bottom.
 *
 * The sectors tile the whole circle from -half a step to a full turn less half
 * a step, so the first and the last sector are the two that straddle the seam
 * of `atan2`, which is the only reason this is not one comparison.
 *
 * @param {number} angle -PI..PI from atan2
 * @param {number} step
 * @param {number} half
 * @param {number} sectors
 * @returns {number} 0..sectors-1
 */
function sectorAt(angle, step, half, sectors) {
  for (let s = 0; s < sectors; s++) {
    const centre = s * step;
    const low = centre - half;
    const high = centre + half;
    if (low < -Math.PI) {
      if (angle >= low + 2 * Math.PI || angle < high) return s;
    } else if (high > Math.PI) {
      if (angle >= low || angle < high - 2 * Math.PI) return s;
    } else if (angle >= low && angle < high) {
      return s;
    }
  }
  return 0;
}

/**
 * The flattest of N Gaussian weighted sectors around each pixel.
 *
 * Smooths better than the four quadrants at the same radius, and costs about
 * three quarters of the disc per sector, so it is the mode to use sparingly and
 * only where the result is worth it. The window clamps at the frame edge.
 *
 * A sector can come out empty on a small window with many sectors, so its
 * weight sum is checked before it is divided by. That check is the whole reason
 * `MIN_SECTORS` is not zero.
 *
 * @param {Pixels} pixels
 * @param {number} radius in pixels, at least 1
 * @param {number} sectors at least 4
 * @param {{onProgress?: (ratio: number) => void}} [pass]
 * @returns {Pixels}
 */
export function kuwaharaSectors(pixels, radius, sectors, pass = {}) {
  const { width, height, data } = pixels;
  const out = new Uint8ClampedArray(data.length);
  const r = Math.round(radius);
  const n = Math.round(sectors);
  if (!(r >= 1) || !(n >= 1) || width < 1 || height < 1) {
    out.set(data);
    return { width, height, data: out };
  }

  const onProgress = pass.onProgress ?? null;
  const table = buildSectorTable(r, n);
  const { dx, dy, weight, starts } = table;
  const band = Math.max(1, Math.floor(height / 20));
  const lastX = width - 1;
  const lastY = height - 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let bestVariance = Infinity;
      let bestR = 0;
      let bestG = 0;
      let bestB = 0;

      for (let s = 0; s < n; s++) {
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let lumSum = 0;
        let lumSqSum = 0;
        let weightSum = 0;

        for (let k = starts[s]; k < starts[s + 1]; k++) {
          const px = x + dx[k];
          const py = y + dy[k];
          const w = weight[k];
          const at = ((py < 0 ? 0 : py > lastY ? lastY : py) * width + (px < 0 ? 0 : px > lastX ? lastX : px)) * 4;

          const r = data[at];
          const g = data[at + 1];
          const b = data[at + 2];
          const lum = LUM_R * r + LUM_G * g + LUM_B * b;

          weightSum += w;
          rSum += w * r;
          gSum += w * g;
          bSum += w * b;
          lumSum += w * lum;
          lumSqSum += w * lum * lum;
        }

        if (!(weightSum > 0)) continue;

        const mean = lumSum / weightSum;
        const variance = lumSqSum / weightSum - mean * mean;

        if (variance < bestVariance) {
          bestVariance = variance;
          bestR = rSum / weightSum;
          bestG = gSum / weightSum;
          bestB = bSum / weightSum;
        }
      }

      const at = (y * width + x) * 4;
      out[at] = bestR;
      out[at + 1] = bestG;
      out[at + 2] = bestB;
      out[at + 3] = data[at + 3];
    }

    if (onProgress && (y + 1) % band === 0) onProgress((y + 1) / height);
  }

  return { width, height, data: out };
}

// ---------------------------------------------------------------------------
// The two finishing passes
// ---------------------------------------------------------------------------

/**
 * Push the colour away from grey, in HSL, so the hue of a patch survives.
 *
 * Done in HSL rather than by scaling the channels because the filter's job has
 * already fixed the brightness of a patch, and scaling the channels would move
 * that too. The conversion is the one `core/lomo.js` already tests, so it is
 * used rather than written again: at 0 % it returns the pixel it was given,
 * which makes an untouched frame bit for bit what it was.
 *
 * @param {Pixels} pixels
 * @param {number} amount 0..100
 * @returns {Pixels}
 */
export function boostSaturation(pixels, amount) {
  const { width, height, data } = pixels;
  const out = new Uint8ClampedArray(data.length);
  const percent = clampPercent(amount);
  if (percent <= 0) {
    out.set(data);
    return { width, height, data: out };
  }

  const factor = 1 + (percent / 100) * SATURATION_CEILING;
  const rgb = [0, 0, 0];

  for (let i = 0; i < data.length; i += 4) {
    saturatePixel(data[i], data[i + 1], data[i + 2], factor, rgb);
    out[i] = rgb[0];
    out[i + 1] = rgb[1];
    out[i + 2] = rgb[2];
    out[i + 3] = data[i + 3];
  }

  return { width, height, data: out };
}

/**
 * A four neighbour unsharp mask, which is what puts an edge back.
 *
 * Kuwahara flattens every patch it can, so the boundary between two of them is
 * the only edge left in the picture. Adding the difference between a pixel and
 * its neighbours back onto it darkens one side of that boundary and lightens
 * the other, which is what a loaded brush leaves behind it.
 *
 * Four neighbours rather than the nine a full kernel would use, because this
 * runs over the whole frame after a pass that has already cost a great deal,
 * and four taps is the version that looks the same.
 *
 * A one pixel frame has no neighbours at all, so the mask is skipped there
 * rather than divided by a count of zero.
 *
 * @param {Pixels} pixels
 * @param {number} amount 0..100
 * @returns {Pixels}
 */
export function sharpenEdges(pixels, amount) {
  const { width, height, data } = pixels;
  const out = new Uint8ClampedArray(data.length);
  const percent = clampPercent(amount);
  if (percent <= 0) {
    out.set(data);
    return { width, height, data: out };
  }

  const strength = (percent / 100) * SHARPEN_CEILING;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      // How many of the four neighbours exist here, decided once for the three
      // channels rather than three times.
      const left = x > 0 ? at - 4 : -1;
      const right = x < width - 1 ? at + 4 : -1;
      const up = y > 0 ? at - width * 4 : -1;
      const down = y < height - 1 ? at + width * 4 : -1;
      const count = (left >= 0 ? 1 : 0) + (right >= 0 ? 1 : 0) + (up >= 0 ? 1 : 0) + (down >= 0 ? 1 : 0);

      for (let c = 0; c < 3; c++) {
        const centre = data[at + c];
        if (count === 0) {
          out[at + c] = centre;
          continue;
        }
        let sum = 0;
        if (left >= 0) sum += data[left + c];
        if (right >= 0) sum += data[right + c];
        if (up >= 0) sum += data[up + c];
        if (down >= 0) sum += data[down + c];
        out[at + c] = centre + strength * (centre - sum / count);
      }

      out[at + 3] = data[at + 3];
    }
  }

  return { width, height, data: out };
}

// ---------------------------------------------------------------------------
// The whole effect
// ---------------------------------------------------------------------------

/**
 * The frame, painted.
 *
 * The passes in the order they are named: the filter as many times as asked
 * for, then the colour, then the edge. The sharpening is last because it is
 * reading the boundaries the filter just drew, and moving them earlier would
 * have it measure boundaries that are about to move again.
 *
 * Always a new buffer, and always finite: the output is a `Uint8ClampedArray`,
 * so no channel can land outside 0..255 however the arithmetic behaved on the
 * way there. The input is never modified, because the caller keeps the sharp
 * frame for the next preview and the next pass.
 *
 * @param {Pixels} pixels
 * @param {KuwaharaOptions} [options]
 * @returns {Pixels}
 */
export function applyOilPaint(pixels, options = {}) {
  const { mode, radius, passes, sectors, saturation, sharpen } = normalizeOptions(options);
  const { width, height } = pixels;
  const onProgress = options?.onProgress ?? null;

  // Progress is spread over the steps that will actually run, so the bar does
  // not stall on a step that was never going to happen.
  const steps = passes + (saturation > 0 ? 1 : 0) + (sharpen > 0 ? 1 : 0);
  const report = (done, ratio) => {
    if (onProgress) onProgress(Math.max(0, Math.min(1, (done + ratio) / steps)));
  };

  /** @type {Pixels} */
  let current = { width, height, data: new Uint8ClampedArray(pixels.data) };
  let done = 0;

  for (let pass = 0; pass < passes; pass++) {
    const at = done;
    // A radius of 0 is the identity, so a panel that parks its slider at the
    // bottom still gets its own frame back rather than a table of NaN.
    if (radius >= 1 && width >= 1 && height >= 1) {
      current =
        mode === "generalized"
          ? kuwaharaSectors(current, radius, sectors, { onProgress: (r) => report(at, r) })
          : kuwaharaQuadrants(current, radius, { onProgress: (r) => report(at, r) });
    }
    done += 1;
    report(done, 0);
  }

  if (saturation > 0) {
    current = boostSaturation(current, saturation);
    done += 1;
    report(done, 0);
  }

  if (sharpen > 0) {
    current = sharpenEdges(current, sharpen);
    done += 1;
    report(done, 0);
  }

  return current;
}
