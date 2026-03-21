// Oil Paint (Kuwahara) Web Worker
// Supports: Standard Kuwahara (4 quadrants, SAT-based O(1)), Generalized Kuwahara (N sectors),
// multi-pass, saturation boost, edge sharpening (unsharp mask).

// ─── Utility ──────────────────────────────────────────────────────────

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// ─── Summed Area Table builder ─────────────────────────────────────────
// Builds SAT from pixel data. SAT arrays are (W+1)*(H+1) to allow safe index-1 lookups.

function buildSAT(data, width, height, extractFn) {
  const w1 = width + 1;
  const sat = new Float64Array(w1 * (height + 1));
  // Row 0 and col 0 are zero-padded (already 0 from Float64Array init)
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const row = y + 1;
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      rowSum += extractFn(data, pi);
      // sat[row][x+1] = rowSum + sat[row-1][x+1]
      sat[row * w1 + (x + 1)] = rowSum + sat[(row - 1) * w1 + (x + 1)];
    }
  }
  return sat;
}

// Sum of rectangle (x1,y1) to (x2,y2) inclusive, using SAT with 1-offset.
function satSum(sat, w1, x1, y1, x2, y2) {
  // Clamp to valid range
  if (x1 < 0) x1 = 0;
  if (y1 < 0) y1 = 0;
  const a = sat[(y2 + 1) * w1 + (x2 + 1)];
  const b = y1 > 0 ? sat[y1 * w1 + (x2 + 1)] : 0;
  const c = x1 > 0 ? sat[(y2 + 1) * w1 + x1] : 0;
  const d = (x1 > 0 && y1 > 0) ? sat[y1 * w1 + x1] : 0;
  return a - b - c + d;
}

// ─── Standard Kuwahara (4 quadrants, SAT-based O(1)) ─────────────────

function kuwaharaStandard(src, width, height, radius) {
  const dst = new Uint8ClampedArray(src.length);
  const w1 = width + 1;

  // Build SATs
  const satR = buildSAT(src, width, height, (d, i) => d[i]);
  const satG = buildSAT(src, width, height, (d, i) => d[i + 1]);
  const satB = buildSAT(src, width, height, (d, i) => d[i + 2]);
  const satLum = buildSAT(src, width, height, (d, i) => luminance(d[i], d[i + 1], d[i + 2]));
  const satLum2 = buildSAT(src, width, height, (d, i) => {
    const l = luminance(d[i], d[i + 1], d[i + 2]);
    return l * l;
  });

  const totalPixels = width * height;
  const reportEvery = Math.max(5000, Math.floor(totalPixels / 50));
  let lastProgress = 0;

  // Report 0% immediately so UI knows we started
  self.postMessage({ type: 'progress', percent: 0 });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Define quadrant bounds
      // Q1 top-left:     [x-R, y-R] to [x, y]
      // Q2 top-right:    [x,   y-R] to [x+R, y]
      // Q3 bottom-left:  [x-R, y]   to [x, y+R]
      // Q4 bottom-right: [x,   y]   to [x+R, y+R]

      const q1x1 = x - radius, q1y1 = y - radius, q1x2 = x, q1y2 = y;
      const q2x1 = x, q2y1 = y - radius, q2x2 = x + radius, q2y2 = y;
      const q3x1 = x - radius, q3y1 = y, q3x2 = x, q3y2 = y + radius;
      const q4x1 = x, q4y1 = y, q4x2 = x + radius, q4y2 = y + radius;

      const quads = [
        { x1: q1x1, y1: q1y1, x2: q1x2, y2: q1y2 },
        { x1: q2x1, y1: q2y1, x2: q2x2, y2: q2y2 },
        { x1: q3x1, y1: q3y1, x2: q3x2, y2: q3y2 },
        { x1: q4x1, y1: q4y1, x2: q4x2, y2: q4y2 },
      ];

      let minVar = Infinity;
      let bestMeanR = 0, bestMeanG = 0, bestMeanB = 0;

      for (let q = 0; q < 4; q++) {
        const { x1, y1, x2, y2 } = quads[q];

        // Clamp quadrant bounds
        const cx1 = Math.max(0, x1);
        const cy1 = Math.max(0, y1);
        const cx2 = Math.min(width - 1, x2);
        const cy2 = Math.min(height - 1, y2);

        const count = (cx2 - cx1 + 1) * (cy2 - cy1 + 1);
        if (count <= 0) continue;

        const sumR = satSum(satR, w1, cx1, cy1, cx2, cy2);
        const sumG = satSum(satG, w1, cx1, cy1, cx2, cy2);
        const sumB = satSum(satB, w1, cx1, cy1, cx2, cy2);
        const sumLum = satSum(satLum, w1, cx1, cy1, cx2, cy2);
        const sumLum2 = satSum(satLum2, w1, cx1, cy1, cx2, cy2);

        const meanLum = sumLum / count;
        const variance = (sumLum2 / count) - (meanLum * meanLum);

        if (variance < minVar) {
          minVar = variance;
          bestMeanR = sumR / count;
          bestMeanG = sumG / count;
          bestMeanB = sumB / count;
        }
      }

      dst[idx]     = clamp(Math.round(bestMeanR), 0, 255);
      dst[idx + 1] = clamp(Math.round(bestMeanG), 0, 255);
      dst[idx + 2] = clamp(Math.round(bestMeanB), 0, 255);
      dst[idx + 3] = src[idx + 3];

      // Progress reporting
      const pi = y * width + x;
      if (pi - lastProgress >= reportEvery) {
        self.postMessage({ type: 'progress', percent: Math.round((pi / totalPixels) * 100) });
        lastProgress = pi;
      }
    }
  }

  return dst;
}

// ─── Generalized Kuwahara (N sectors, Gaussian-weighted) ──────────────

function kuwaharaGeneralized(src, width, height, radius, sectors) {
  const dst = new Uint8ClampedArray(src.length);
  const sigma = radius / 2;
  const twoSigmaSq = 2 * sigma * sigma;
  const totalPixels = width * height;
  const reportEvery = Math.max(5000, Math.floor(totalPixels / 50));
  let lastProgress = 0;

  // Report 0% immediately so UI knows we started
  self.postMessage({ type: 'progress', percent: 0 });

  // Pre-compute Gaussian weights for the kernel
  const kernelSize = radius + 1;
  const weights = new Float64Array(kernelSize * kernelSize);
  for (let ky = 0; ky < kernelSize; ky++) {
    for (let kx = 0; kx < kernelSize; kx++) {
      const d2 = kx * kx + ky * ky;
      weights[ky * kernelSize + kx] = Math.exp(-d2 / twoSigmaSq);
    }
  }

  const angleStep = (2 * Math.PI) / sectors;
  const halfAngle = angleStep / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      let minVar = Infinity;
      let bestMeanR = 0, bestMeanG = 0, bestMeanB = 0;

      for (let s = 0; s < sectors; s++) {
        const centerAngle = s * angleStep;
        const aMin = centerAngle - halfAngle;
        const aMax = centerAngle + halfAngle;

        let wSumR = 0, wSumG = 0, wSumB = 0, wSumLum = 0, wSumLum2 = 0, wTotal = 0;

        for (let ky = -radius; ky <= radius; ky++) {
          const py = y + ky;
          if (py < 0 || py >= height) continue;

          for (let kx = -radius; kx <= radius; kx++) {
            const px = x + kx;
            if (px < 0 || px >= width) continue;

            // Check if this offset falls within the sector's arc
            const angle = Math.atan2(ky, kx);
            let inSector = false;

            if (aMin >= -Math.PI && aMax <= Math.PI) {
              inSector = angle >= aMin && angle < aMax;
            } else if (aMin < -Math.PI) {
              inSector = angle >= (aMin + 2 * Math.PI) || angle < aMax;
            } else {
              inSector = angle >= aMin || angle < (aMax - 2 * Math.PI);
            }

            if (!inSector) continue;

            const wIdx = Math.min(Math.abs(ky), radius) * kernelSize + Math.min(Math.abs(kx), radius);
            const w = weights[wIdx];
            const pi = (py * width + px) * 4;

            const r = src[pi], g = src[pi + 1], b = src[pi + 2];
            const lum = luminance(r, g, b);

            wSumR += w * r;
            wSumG += w * g;
            wSumB += w * b;
            wSumLum += w * lum;
            wSumLum2 += w * lum * lum;
            wTotal += w;
          }
        }

        if (wTotal <= 0) continue;

        const meanLum = wSumLum / wTotal;
        const variance = (wSumLum2 / wTotal) - (meanLum * meanLum);

        if (variance < minVar) {
          minVar = variance;
          bestMeanR = wSumR / wTotal;
          bestMeanG = wSumG / wTotal;
          bestMeanB = wSumB / wTotal;
        }
      }

      dst[idx]     = clamp(Math.round(bestMeanR), 0, 255);
      dst[idx + 1] = clamp(Math.round(bestMeanG), 0, 255);
      dst[idx + 2] = clamp(Math.round(bestMeanB), 0, 255);
      dst[idx + 3] = src[idx + 3];

      const pi = y * width + x;
      if (pi - lastProgress >= reportEvery) {
        self.postMessage({ type: 'progress', percent: Math.round((pi / totalPixels) * 100) });
        lastProgress = pi;
      }
    }
  }

  return dst;
}

// ─── Saturation Boost ─────────────────────────────────────────────────

function boostSaturation(data, width, height, amount) {
  // amount: 0 = no boost, 100 = 1.5x saturation
  const factor = 1 + (amount / 100) * 0.5;
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const newS = Math.min(1, s * factor);
    const [r, g, b] = hslToRgb(h, newS, l);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

// ─── Edge Sharpening (Unsharp Mask) ───────────────────────────────────

function sharpenUnsharpMask(src, width, height, amount) {
  // Simple 3x3 unsharp mask: sharpened = original + amount * (original - blurred)
  const dst = new Uint8ClampedArray(src.length);
  const strength = (amount / 100) * 1.5; // Scale 0-100 to 0-1.5

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[idx + c];
        // Average of 4-connected neighbors (box blur approximation)
        let sum = 0, count = 0;
        if (x > 0) { sum += src[idx - 4 + c]; count++; }
        if (x < width - 1) { sum += src[idx + 4 + c]; count++; }
        if (y > 0) { sum += src[((y - 1) * width + x) * 4 + c]; count++; }
        if (y < height - 1) { sum += src[((y + 1) * width + x) * 4 + c]; count++; }
        const blurred = sum / count;
        const sharpened = center + strength * (center - blurred);
        dst[idx + c] = clamp(Math.round(sharpened), 0, 255);
      }
      dst[idx + 3] = src[idx + 3];
    }
  }
  return dst;
}

// ─── Main handler ─────────────────────────────────────────────────────

self.onmessage = function (e) {
  const { type } = e.data;

  if (type === 'process') {
    const { pixelBuffer, width, height, params } = e.data;
    const src = new Uint8ClampedArray(pixelBuffer);
    const { mode, radius, passes, sectors, saturationBoost, edgeSharpening } = params;

    // Confirm receipt immediately
    self.postMessage({ type: 'progress', percent: 0 });

    let current = new Uint8ClampedArray(src);

    for (let pass = 0; pass < passes; pass++) {
      self.postMessage({ type: 'progress', percent: Math.round((pass / passes) * 80), pass: pass + 1 });

      if (mode === 'generalized') {
        current = kuwaharaGeneralized(current, width, height, radius, sectors);
      } else {
        current = kuwaharaStandard(current, width, height, radius);
      }
    }

    // Post-processing
    if (saturationBoost > 0) {
      self.postMessage({ type: 'progress', percent: 85 });
      boostSaturation(current, width, height, saturationBoost);
    }

    if (edgeSharpening > 0) {
      self.postMessage({ type: 'progress', percent: 92 });
      current = sharpenUnsharpMask(current, width, height, edgeSharpening);
    }

    self.postMessage({ type: 'progress', percent: 100 });
    self.postMessage({ type: 'done', pixelBuffer: current.buffer }, [current.buffer]);
  }
};
