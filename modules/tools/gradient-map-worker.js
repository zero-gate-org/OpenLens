self.onmessage = function (e) {
  const { pixelBuffer, lut, intensity, blendMode } = e.data;
  const data = new Uint8ClampedArray(pixelBuffer);
  const len = data.length;

  if (blendMode === "replace") {
    for (let i = 0; i < len; i += 4) {
      const lum = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      const idx = lum * 3;
      data[i]     = Math.round(data[i]     + intensity * (lut[idx]     - data[i]));
      data[i + 1] = Math.round(data[i + 1] + intensity * (lut[idx + 1] - data[i + 1]));
      data[i + 2] = Math.round(data[i + 2] + intensity * (lut[idx + 2] - data[i + 2]));
    }
  } else if (blendMode === "luminosity") {
    for (let i = 0; i < len; i += 4) {
      const lum = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      const idx = lum * 3;
      const mappedR = lut[idx];
      const mappedG = lut[idx + 1];
      const mappedB = lut[idx + 2];
      const mappedLum = 0.2126 * mappedR + 0.7152 * mappedG + 0.0722 * mappedB;
      const origLum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const lumDiff = mappedLum - origLum;
      const r = data[i] + lumDiff;
      const g = data[i + 1] + lumDiff;
      const b = data[i + 2] + lumDiff;
      data[i]     = clamp(Math.round(data[i]     + intensity * (r - data[i])));
      data[i + 1] = clamp(Math.round(data[i + 1] + intensity * (g - data[i + 1])));
      data[i + 2] = clamp(Math.round(data[i + 2] + intensity * (b - data[i + 2])));
    }
  } else if (blendMode === "color") {
    for (let i = 0; i < len; i += 4) {
      const lum = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      const idx = lum * 3;
      const mappedR = lut[idx];
      const mappedG = lut[idx + 1];
      const mappedB = lut[idx + 2];
      const mappedHsl = rgbToHsl(mappedR, mappedG, mappedB);
      const origHsl = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const blended = hslToRgb(mappedHsl[0], mappedHsl[1], origHsl[2]);
      data[i]     = clamp(Math.round(data[i]     + intensity * (blended[0] - data[i])));
      data[i + 1] = clamp(Math.round(data[i + 1] + intensity * (blended[1] - data[i + 1])));
      data[i + 2] = clamp(Math.round(data[i + 2] + intensity * (blended[2] - data[i + 2])));
    }
  } else if (blendMode === "multiply") {
    for (let i = 0; i < len; i += 4) {
      const lum = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      const idx = lum * 3;
      const mappedR = (data[i]     * lut[idx])     / 255;
      const mappedG = (data[i + 1] * lut[idx + 1]) / 255;
      const mappedB = (data[i + 2] * lut[idx + 2]) / 255;
      data[i]     = clamp(Math.round(data[i]     + intensity * (mappedR - data[i])));
      data[i + 1] = clamp(Math.round(data[i + 1] + intensity * (mappedG - data[i + 1])));
      data[i + 2] = clamp(Math.round(data[i + 2] + intensity * (mappedB - data[i + 2])));
    }
  }

  self.postMessage({ pixelBuffer: pixelBuffer }, [pixelBuffer]);
};

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
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
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
