/* sketch-worker.js — Web Worker for Sketch / Pencil Drawing Effect
   Handles: grayscale conversion, convolution (Sobel / Laplacian),
   dilation, and output assembly. Uses structured clone (no transfer). */

self.onmessage = function (e) {
  const {
    pixelBuffer,
    width,
    height,
    mode,
    threshold,
    lineWeight,
    blendAmount,
    paperColor,
    inkColor,
  } = e.data;

  const src = new Uint8ClampedArray(pixelBuffer);
  const pixelCount = width * height;

  // ── Step 1: Grayscale Conversion ──────────────────────────────────────
  const grayscale = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const j = i * 4;
    grayscale[i] = 0.2126 * src[j] + 0.7152 * src[j + 1] + 0.0722 * src[j + 2];
  }

  // ── Step 2: Edge Detection ────────────────────────────────────────────
  let edgeBuffer;
  let angleBuffer = null;

  if (mode === "sobel" || mode === "pencil" || mode === "colored-pencil" || mode === "hatching") {
    const result = sobelEdgeDetection(grayscale, width, height);
    edgeBuffer = result.edges;
    angleBuffer = result.angles;
  } else {
    edgeBuffer = laplacianEdgeDetection(grayscale, width, height);
  }

  // ── Step 2.5: Line Weight Dilation ────────────────────────────────────
  if (lineWeight > 1) {
    edgeBuffer = dilateMax(edgeBuffer, width, height, lineWeight);
  }

  // ── Step 3: Thresholding ──────────────────────────────────────────────
  for (let i = 0; i < pixelCount; i++) {
    if (edgeBuffer[i] < threshold) {
      edgeBuffer[i] = 0;
    }
  }

  // ── Step 4: Build Output ──────────────────────────────────────────────

  if (mode === "hatching") {
    // Hatching: return Float32Arrays as regular arrays for structured clone
    const edgeArr = Array.from(edgeBuffer);
    const angleArr = angleBuffer ? Array.from(angleBuffer) : [];
    self.postMessage({ mode: "hatching", edgeBuffer: edgeArr, angleBuffer: angleArr, width, height });
    return;
  }

  // Parse ink/paper colors
  const ink = hexToRgbComponents(inkColor);
  const paper = hexToRgbComponents(paperColor);

  // Build result as plain array (structured clone friendly)
  const dst = new Array(src.length);

  if (mode === "pencil") {
    const blend = blendAmount / 100;
    for (let i = 0; i < pixelCount; i++) {
      const j = i * 4;
      const invertedEdge = 255 - edgeBuffer[i];
      const gray = grayscale[i];
      const sketch = invertedEdge * (1 - blend) + gray * blend * 0.3;
      const t = sketch / 255;
      dst[j]     = clampByte(ink.r + t * (paper.r - ink.r));
      dst[j + 1] = clampByte(ink.g + t * (paper.g - ink.g));
      dst[j + 2] = clampByte(ink.b + t * (paper.b - ink.b));
      dst[j + 3] = src[j + 3];
    }
  } else if (mode === "colored-pencil") {
    const blend = blendAmount / 100;
    for (let i = 0; i < pixelCount; i++) {
      const j = i * 4;
      const invertedEdge = 255 - edgeBuffer[i];
      const gray = grayscale[i];
      const sketchVal = invertedEdge * (1 - blend) + gray * blend * 0.3;
      const factor = sketchVal / 255;
      dst[j]     = clampByte(src[j]     * factor);
      dst[j + 1] = clampByte(src[j + 1] * factor);
      dst[j + 2] = clampByte(src[j + 2] * factor);
      dst[j + 3] = src[j + 3];
    }
  } else {
    // Sobel or Laplacian
    for (let i = 0; i < pixelCount; i++) {
      const j = i * 4;
      const invertedEdge = 255 - edgeBuffer[i];
      const t = invertedEdge / 255;
      dst[j]     = clampByte(ink.r + t * (paper.r - ink.r));
      dst[j + 1] = clampByte(ink.g + t * (paper.g - ink.g));
      dst[j + 2] = clampByte(ink.b + t * (paper.b - ink.b));
      dst[j + 3] = src[j + 3];
    }
  }

  self.postMessage({ mode: mode, pixels: dst, width: width, height: height });
};

// ─── Convolution Helper ────────────────────────────────────────────────

function convolve(grayscale, width, height, kernel) {
  const output = new Float32Array(width * height);
  const kSize = Math.sqrt(kernel.length);
  const half = Math.floor(kSize / 2);
  for (let y = half; y < height - half; y++) {
    for (let x = half; x < width - half; x++) {
      let sum = 0;
      for (let ky = 0; ky < kSize; ky++) {
        for (let kx = 0; kx < kSize; kx++) {
          const px = x + kx - half;
          const py = y + ky - half;
          sum += grayscale[py * width + px] * kernel[ky * kSize + kx];
        }
      }
      output[y * width + x] = sum;
    }
  }
  return output;
}

// ─── Sobel Edge Detection ──────────────────────────────────────────────

function sobelEdgeDetection(grayscale, width, height) {
  const Kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const Ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  const gx = convolve(grayscale, width, height, Kx);
  const gy = convolve(grayscale, width, height, Ky);

  const edges = new Float32Array(width * height);
  const angles = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const magnitude = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
    edges[i] = Math.min(255, magnitude);
    angles[i] = Math.atan2(gy[i], gx[i]);
  }

  return { edges, angles };
}

// ─── Laplacian Edge Detection ──────────────────────────────────────────

function laplacianEdgeDetection(grayscale, width, height) {
  const K = [0, -1, 0, -1, 4, -1, 0, -1, 0];
  const result = convolve(grayscale, width, height, K);

  for (let i = 0; i < result.length; i++) {
    result[i] = Math.min(255, Math.abs(result[i]));
  }

  return result;
}

// ─── Morphological Dilation (Max Filter) ───────────────────────────────

function dilateMax(buffer, width, height, radius) {
  const output = new Float32Array(buffer.length);
  const r = Math.floor(radius);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (buffer[ny * width + nx] > maxVal) {
              maxVal = buffer[ny * width + nx];
            }
          }
        }
      }
      output[y * width + x] = maxVal;
    }
  }

  return output;
}

// ─── Utility ───────────────────────────────────────────────────────────

function hexToRgbComponents(hex) {
  const v = parseInt(hex.slice(1), 16);
  return {
    r: (v >> 16) & 0xff,
    g: (v >> 8) & 0xff,
    b: v & 0xff,
  };
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
