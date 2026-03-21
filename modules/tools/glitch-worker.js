// ─── Glitch Art Web Worker ─────────────────────────────────────────────
// Handles pixel-based techniques for large images (>2MP).
// Techniques: Channel Shift, Scanline Corruption, Block Datamosh, RGB Band Split
// Slice Offset is canvas-based and runs on main thread.

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getPixelClamped(data, x, y, width, height, channel) {
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));
  return data[(y * width + x) * 4 + channel];
}

function applyChannelShiftBands(src, dst, width, height, rng, intensity) {
  const bandCount = Math.max(1, Math.floor(rng() * 4) + 1);
  const shiftR = Math.round((rng() * 12 + 3) * intensity);
  const shiftB = Math.round((rng() * 12 + 3) * intensity);

  for (let b = 0; b < bandCount; b++) {
    const bandY = Math.floor(rng() * height);
    const bandH = Math.max(5, Math.min(height - bandY, Math.floor(rng() * 80) + 10));

    for (let y = bandY; y < bandY + bandH && y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        dst[idx] = getPixelClamped(src, x + shiftR, y, width, height, 0);
        dst[idx + 1] = src[idx + 1];
        dst[idx + 2] = getPixelClamped(src, x - shiftB, y, width, height, 2);
      }
    }
  }
}

function applyScanlineCorruption(data, width, height, rng, intensity) {
  const rowCount = Math.max(1, Math.floor(height * 0.05));

  for (let i = 0; i < rowCount; i++) {
    const y = Math.floor(rng() * height);
    const srcY = Math.floor(rng() * height);
    const brightness = 1.2 + rng() * 0.8 * intensity;

    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;
      const srcIdx = (srcY * width + x) * 4;
      data[dstIdx] = Math.min(255, Math.round(data[srcIdx] * brightness));
      data[dstIdx + 1] = Math.min(255, Math.round(data[srcIdx + 1] * brightness));
      data[dstIdx + 2] = Math.min(255, Math.round(data[srcIdx + 2] * brightness));
    }
  }
}

function applyBlockDatamosh(data, width, height, rng, blockSize, intensity) {
  const blocksX = Math.floor(width / blockSize);
  const blocksY = Math.floor(height / blockSize);
  const totalBlocks = blocksX * blocksY;
  const moshCount = Math.max(1, Math.floor(totalBlocks * (0.1 + rng() * 0.15)));

  for (let i = 0; i < moshCount; i++) {
    const bx = Math.floor(rng() * blocksX);
    const by = Math.floor(rng() * blocksY);
    const srcBx = Math.floor(rng() * blocksX);
    const srcBy = Math.floor(rng() * blocksY);

    const tintR = 1.0 + (rng() - 0.5) * 0.4 * intensity;
    const tintG = 1.0 + (rng() - 0.5) * 0.4 * intensity;
    const tintB = 1.0 + (rng() - 0.5) * 0.4 * intensity;

    for (let dy = 0; dy < blockSize; dy++) {
      for (let dx = 0; dx < blockSize; dx++) {
        const dstX = bx * blockSize + dx;
        const dstY = by * blockSize + dy;
        const srcX = srcBx * blockSize + dx;
        const srcY = srcBy * blockSize + dy;

        if (dstX >= width || dstY >= height || srcX >= width || srcY >= height) continue;

        const dstIdx = (dstY * width + dstX) * 4;
        const srcIdx = (srcY * width + srcX) * 4;

        data[dstIdx] = Math.min(255, Math.round(data[srcIdx] * tintR));
        data[dstIdx + 1] = Math.min(255, Math.round(data[srcIdx + 1] * tintG));
        data[dstIdx + 2] = Math.min(255, Math.round(data[srcIdx + 2] * tintB));
      }
    }
  }
}

function applyRgbBandSplit(src, dst, width, height, rng, intensity) {
  const bandCount = Math.floor(rng() * 6) + 3;

  for (let b = 0; b < bandCount; b++) {
    const bandY = Math.floor(rng() * height);
    const bandH = Math.max(3, Math.min(height - bandY, Math.floor(rng() * 40) + 5));
    const shiftR = Math.round((20 + rng() * 20) * intensity);
    const shiftB = Math.round((20 + rng() * 20) * intensity);

    for (let y = bandY; y < bandY + bandH && y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        dst[idx] = getPixelClamped(src, x + shiftR, y, width, height, 0);
        dst[idx + 1] = src[idx + 1];
        dst[idx + 2] = getPixelClamped(src, x - shiftB, y, width, height, 2);
      }
    }
  }
}

self.onmessage = function (e) {
  const { pixelBuffer, width, height, params } = e.data;
  const src = new Uint8ClampedArray(pixelBuffer);
  const dst = new Uint8ClampedArray(src);

  const rng = mulberry32(params.seed);
  const intensity = params.intensity;

  if (params.channelEnabled) {
    applyChannelShiftBands(src, dst, width, height, rng, intensity);
  }

  if (params.scanlineEnabled) {
    applyScanlineCorruption(dst, width, height, rng, intensity);
  }

  if (params.datamoshEnabled) {
    applyBlockDatamosh(dst, width, height, rng, params.blockSize, intensity);
  }

  if (params.rgbSplitEnabled) {
    applyRgbBandSplit(src, dst, width, height, rng, intensity);
  }

  self.postMessage({ pixelBuffer: pixelBuffer }, [pixelBuffer]);
};
