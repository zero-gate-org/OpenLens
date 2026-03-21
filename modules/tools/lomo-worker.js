// lomo-worker.js — Web Worker for tone curves, saturation, and warmth processing
// Receives: pixelBuffer, width, height, lutR, lutG, lutB, saturation, warmth, intensity
// Returns:  { pixelBuffer } (transferred)

self.onmessage = function (e) {
  const { pixelBuffer, width, height, lutR, lutG, lutB, saturation, warmth, intensity } = e.data;
  const data = new Uint8ClampedArray(pixelBuffer);
  const len = data.length;

  const hasSaturation = saturation !== 1.0;
  const hasWarmth = warmth !== 0;
  const hasIntensity = intensity < 1.0;

  // Build a backup of original data for intensity blending
  let original = null;
  if (hasIntensity) {
    original = new Uint8ClampedArray(data);
  }

  // Pass 1: Apply tone curves
  for (let i = 0; i < len; i += 4) {
    data[i] = lutR[data[i]];
    data[i + 1] = lutG[data[i + 1]];
    data[i + 2] = lutB[data[i + 2]];
    // Alpha untouched
  }

  // Pass 2: Saturation boost via HSL
  if (hasSaturation) {
    for (let i = 0; i < len; i += 4) {
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;

      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const l = (max + min) / 2;

      if (max === min) continue;

      const d = max - min;
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      let h;
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;

      const newS = Math.min(1, s * saturation);

      // HSL to RGB
      const q = l < 0.5 ? l * (1 + newS) : l + newS - l * newS;
      const p = 2 * l - q;
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };

      data[i] = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
      data[i + 1] = Math.round(hue2rgb(p, q, h) * 255);
      data[i + 2] = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
    }
  }

  // Pass 3: Warmth shift (R up, B down for warmth > 0; reverse for warmth < 0)
  if (hasWarmth) {
    for (let i = 0; i < len; i += 4) {
      const r = data[i] + warmth;
      const b = data[i + 2] - warmth;
      data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }

  // Pass 4: Intensity blend with original
  if (hasIntensity && original) {
    const t = intensity;
    for (let i = 0; i < len; i += 4) {
      data[i] = original[i] + t * (data[i] - original[i]);
      data[i + 1] = original[i + 1] + t * (data[i + 1] - original[i + 1]);
      data[i + 2] = original[i + 2] + t * (data[i + 2] - original[i + 2]);
    }
  }

  self.postMessage({ pixelBuffer: pixelBuffer }, [pixelBuffer]);
};
