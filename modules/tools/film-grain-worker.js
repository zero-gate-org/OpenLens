// Film Grain Web Worker — luminance noise processing for large images

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

function hashNoise(x, y, seed) {
  let n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.3) * 43758.5453;
  return n - Math.floor(n);
}

function pixelLuminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

self.onmessage = function (e) {
  const { pixelBuffer, width, height, params } = e.data;
  const data = new Uint8ClampedArray(pixelBuffer);

  const { noiseType, strength, grainSize, shape, highlightsOnly, shadowsOnly, fixedGrain, seed, blend } = params;
  const delta = (strength / 100) * 80;
  const strengthNorm = delta / 255;
  const gs = Math.max(1, Math.round(grainSize));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      let noiseX, noiseY;
      if (gs > 1) {
        if (shape === "square") {
          noiseX = Math.floor(x / gs) * gs;
          noiseY = Math.floor(y / gs) * gs;
        } else {
          noiseX = Math.floor(x / gs);
          noiseY = Math.floor(y / gs);
        }
      } else {
        noiseX = x;
        noiseY = y;
      }

      let noiseR = 0, noiseG = 0, noiseB = 0;

      if (noiseType === "uniform") {
        let noise;
        if (fixedGrain) {
          noise = (hashNoise(noiseX, noiseY, seed) - 0.5) * 2 * delta;
        } else {
          noise = (Math.random() - 0.5) * 2 * delta;
        }
        noiseR = noiseG = noiseB = noise;
      } else if (noiseType === "luminance") {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const [h, s, l] = rgbToHsl(r, g, b);

        let noise;
        if (fixedGrain) {
          noise = (hashNoise(noiseX, noiseY, seed) - 0.5) * 2 * strengthNorm;
        } else {
          noise = (Math.random() - 0.5) * 2 * strengthNorm;
        }

        const newL = clamp(l + noise, 0, 1);
        const [nr, ng, nb] = hslToRgb(h, s, newL);
        noiseR = nr - r;
        noiseG = ng - g;
        noiseB = nb - b;
      } else if (noiseType === "color") {
        if (fixedGrain) {
          noiseR = (hashNoise(noiseX, noiseY, seed) - 0.5) * 2 * delta;
          noiseG = (hashNoise(noiseX + 0.5, noiseY + 0.5, seed + 1) - 0.5) * 2 * delta;
          noiseB = (hashNoise(noiseX + 1.0, noiseY + 1.0, seed + 2) - 0.5) * 2 * delta;
        } else {
          noiseR = (Math.random() - 0.5) * 2 * delta;
          noiseG = (Math.random() - 0.5) * 2 * delta;
          noiseB = (Math.random() - 0.5) * 2 * delta;
        }
      }

      let applyNoise = true;
      if (highlightsOnly || shadowsOnly) {
        const lum = pixelLuminance(data[i], data[i + 1], data[i + 2]);
        if (highlightsOnly && shadowsOnly) {
          applyNoise = lum > 0.6 || lum < 0.4;
        } else if (highlightsOnly) {
          applyNoise = lum > 0.6;
        } else if (shadowsOnly) {
          applyNoise = lum < 0.4;
        }
      }

      if (applyNoise) {
        const bFactor = blend / 100;
        data[i]     = clamp(Math.round(data[i]     + noiseR * bFactor), 0, 255);
        data[i + 1] = clamp(Math.round(data[i + 1] + noiseG * bFactor), 0, 255);
        data[i + 2] = clamp(Math.round(data[i + 2] + noiseB * bFactor), 0, 255);
      }
      // alpha channel stays unchanged
    }
  }

  self.postMessage({ pixelBuffer: pixelBuffer }, [pixelBuffer]);
};
