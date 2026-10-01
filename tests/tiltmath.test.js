import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  bandGeometry,
  bandRamp,
  bandWeight,
  hslToRgb,
  rgbToHsl,
  smoothstep,
  toneKey,
  tonePixel,
  vignetteFalloff,
} from "../src/lib/core/tiltmath.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

/** Percentage settings as the sliders produce them. */
const MID = { focusPosition: 50, transitionWidth: 20 };

describe("smoothstep", () => {
  test("is pinned at both ends", () => {
    near(smoothstep(0), 0);
    near(smoothstep(1), 1);
  });

  test("passes through the middle of the interval", () => {
    near(smoothstep(0.5), 0.5);
  });

  test("is an S curve, so the two halves mirror each other", () => {
    // Not symmetric about 0.5: the shape is a step with eased edges, which
    // is exactly why the ramp into the band has no visible seam.
    for (const t of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
      near(smoothstep(t) + smoothstep(1 - t), 1);
    }
  });

  test("is monotonic across the unit interval", () => {
    let previous = -1;
    for (let i = 0; i <= 100; i += 1) {
      const value = smoothstep(i / 100);
      assert.ok(value >= previous, `dropped at ${i / 100}`);
      previous = value;
    }
  });

  test("is steeper in the middle than at the ends", () => {
    const middle = smoothstep(0.51) - smoothstep(0.49);
    const end = smoothstep(0.02) - smoothstep(0.01);
    assert.ok(middle > end, "the ease should flatten out at both ends");
  });
});

describe("bandGeometry", () => {
  test("reads focus position and transition as percentages of the height", () => {
    const g = bandGeometry(1000, 50, 20);
    near(g.focus, 500);
    near(g.half, 100);
    near(g.top, 400);
    near(g.bottom, 600);
  });

  test("a full width transition puts the band edges outside the frame", () => {
    const g = bandGeometry(800, 0, 100);
    near(g.top, -400);
    near(g.bottom, 400);
  });
});

describe("bandWeight", () => {
  const geometry = bandGeometry(1000, MID.focusPosition, MID.transitionWidth);

  test("is fully sharp across the whole band, edges included", () => {
    for (const y of [400, 401, 500, 599, 600]) {
      near(bandWeight(y, geometry), 1);
    }
  });

  test("ramps out from the band edge to fully blurred", () => {
    // One row past the edge the ramp has barely begun.
    near(bandWeight(399, geometry), 1 - smoothstep(0.01));
    // A tenth of the transition out is still almost sharp.
    assert.ok(bandWeight(390, geometry) > 0.9, "sharpness is bleeding too far");
    // Halfway out is half and half.
    near(bandWeight(350, geometry), 0.5);
    // One full transition width out, and anything further, is fully blurred.
    near(bandWeight(300, geometry), 0);
    near(bandWeight(0, geometry), 0);
    near(bandWeight(999, geometry), 0);
  });

  test("is half sharp at half the transition distance on both sides", () => {
    near(bandWeight(350, geometry), 0.5);
    near(bandWeight(650, geometry), 0.5);
  });

  test("never leaves 0..1", () => {
    for (const transition of [-40, 0, 5, 50, 100, 400]) {
      for (const focus of [-50, 0, 33, 50, 100, 150]) {
        const g = bandGeometry(200, focus, transition);
        for (let y = 0; y < 200; y += 1) {
          const w = bandWeight(y, g);
          assert.ok(w >= 0 && w <= 1, `weight ${w} at y ${y}`);
        }
      }
    }
  });

  test("a zero width band keeps only its centre row sharp", () => {
    const g = bandGeometry(100, 50, 0);
    near(g.half, 0);
    near(g.top, 50);
    near(g.bottom, 50);
    near(bandWeight(50, g), 1);
    near(bandWeight(0, g), 0);
    near(bandWeight(99, g), 0);
  });

  test("is symmetric about the band centre", () => {
    const g = bandGeometry(1000, 30, 24);
    for (let d = 0; d < 300; d += 1) {
      near(bandWeight(300 - d, g), bandWeight(300 + d, g));
    }
  });
});

describe("bandRamp", () => {
  const H = 1000;

  test("has one weight per row", () => {
    assert.equal(bandRamp(H, 50, 20).length, H);
  });

  test("agrees with the single row function", () => {
    const g = bandGeometry(H, 65, 30);
    const ramp = bandRamp(H, 65, 30);
    for (let y = 0; y < H; y += 1) near(ramp[y], bandWeight(y, g));
  });

  test("rises to the band from the top edge and is bounded on the way", () => {
    const ramp = bandRamp(H, MID.focusPosition, MID.transitionWidth);
    let previous = -1;
    for (let y = 0; y <= 400; y += 1) {
      assert.ok(ramp[y] >= 0 && ramp[y] <= 1, `weight ${ramp[y]} at y ${y}`);
      assert.ok(ramp[y] >= previous, `weight fell at y ${y}`);
      previous = ramp[y];
    }
    near(ramp[400], 1);
  });

  test("falls away below the band and is bounded on the way", () => {
    const ramp = bandRamp(H, MID.focusPosition, MID.transitionWidth);
    let previous = 2;
    for (let y = 600; y < H; y += 1) {
      assert.ok(ramp[y] >= 0 && ramp[y] <= 1, `weight ${ramp[y]} at y ${y}`);
      assert.ok(ramp[y] <= previous, `weight rose at y ${y}`);
      previous = ramp[y];
    }
    near(ramp[600], 1);
  });

  test("changes gradually, so no row band can show a seam", () => {
    // A 20% transition over 1000 rows is 100 rows of ramp. smoothstep peaks
    // at 1.5x the average slope, so the largest step can be about 0.015.
    const ramp = bandRamp(H, MID.focusPosition, MID.transitionWidth);
    let largest = 0;
    for (let y = 1; y < H; y += 1) {
      largest = Math.max(largest, Math.abs(ramp[y] - ramp[y - 1]));
    }
    assert.ok(largest < 0.02, `largest step was ${largest}`);
  });

  test("a band at the very top still blurs the rest of the frame", () => {
    const ramp = bandRamp(H, 0, 20);
    near(ramp[0], 1);
    near(ramp[99], 1);
    assert.ok(ramp[400] < 0.001, "middle of the frame should be blurred");
  });
});

describe("rgbToHsl and hslToRgb", () => {
  test("greys have no hue and no saturation", () => {
    const hsl = rgbToHsl(0.5, 0.5, 0.5, [0, 0, 0]);
    near(hsl[0], 0);
    near(hsl[1], 0);
    near(hsl[2], 0.5);
  });

  test("a round trip is lossless", () => {
    const scratch = [0, 0, 0];
    for (const rgb of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.2, 0.4, 0.6],
      [0.9, 0.9, 0.1],
      [0.02, 0.02, 0.03],
    ]) {
      const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2], scratch);
      const back = hslToRgb(hsl[0], hsl[1], hsl[2], [0, 0, 0]);
      near(back[0], rgb[0]);
      near(back[1], rgb[1]);
      near(back[2], rgb[2]);
    }
  });

  test("saturated primaries land on hue 0, 1/3 and 2/3", () => {
    const red = rgbToHsl(1, 0, 0, [0, 0, 0]);
    near(red[0], 0, 1e-9);
    near(red[1], 1);
    const green = rgbToHsl(0, 1, 0, [0, 0, 0]);
    near(green[0], 1 / 3, 1e-6);
    const blue = rgbToHsl(0, 0, 1, [0, 0, 0]);
    near(blue[0], 2 / 3, 1e-6);
  });
});

describe("tonePixel", () => {
  const NEUTRAL = {
    vibrance: 1,
    saturation: 1,
    brightness: 1,
    contrast: 1,
    vignette: 0,
  };
  const scratch = [0, 0, 0];

  const tone = (rgb, settings, falloff = 1) =>
    tonePixel(rgb[0], rgb[1], rgb[2], settings, falloff, scratch, [0, 0, 0]);

  const saturationOf = (rgb) => rgbToHsl(rgb[0], rgb[1], rgb[2], [0, 0, 0])[1];

  test("neutral settings change nothing", () => {
    for (const rgb of [[0.5, 0.5, 0.5], [0.2, 0.4, 0.6], [0.9, 0.1, 0.35]]) {
      const out = tone(rgb, NEUTRAL);
      near(out[0], rgb[0]);
      near(out[1], rgb[1]);
      near(out[2], rgb[2]);
    }
  });

  test("vibrance lifts a muted colour more than a vivid one", () => {
    const settings = { ...NEUTRAL, vibrance: 1.5 };
    const muted = [0.5, 0.4, 0.3];
    const vivid = [1, 0, 0];

    const mutedBefore = saturationOf(muted);
    const mutedAfter = saturationOf(tone(muted, settings));
    const vividAfter = saturationOf(tone(vivid, settings));

    assert.ok(mutedAfter - mutedBefore > 0.3, "muted colour barely moved");
    near(vividAfter, 1);
  });

  test("saturation scales every colour by the same amount", () => {
    const settings = { ...NEUTRAL, saturation: 1.5 };
    for (const rgb of [[0.5, 0.4, 0.3], [0.9, 0.5, 0.1]]) {
      const before = saturationOf(rgb);
      const after = saturationOf(tone(rgb, settings));
      near(after, Math.min(1, before * 1.5), 1e-6);
    }
  });

  test("saturation cannot go past fully saturated", () => {
    const out = tone([0.6, 0.4, 0.2], { ...NEUTRAL, saturation: 3 });
    assert.ok(out.every((c) => c >= 0 && c <= 1), out.join(","));
  });

  test("brightness is a plain multiply", () => {
    const out = tone([0.4, 0.6, 0.8], { ...NEUTRAL, brightness: 1.05 });
    near(out[0], 0.42);
    near(out[1], 0.63);
    near(out[2], 0.84);
  });

  test("contrast pivots around mid grey", () => {
    const out = tone([0.25, 0.25, 0.25], { ...NEUTRAL, contrast: 1.4 });
    near(out[0], (0.25 - 0.5) * 1.4 + 0.5);
    near(tone([0.5, 0.5, 0.5], { ...NEUTRAL, contrast: 1.4 })[0], 0.5);
  });

  test("the vignette darkens every channel by the same factor", () => {
    const settings = { ...NEUTRAL, vignette: 1 };
    const plain = tone([0.8, 0.6, 0.4], settings);
    const darkened = tone([0.8, 0.6, 0.4], settings, 0.5);
    near(darkened[0], plain[0] * 0.5);
    near(darkened[1], plain[1] * 0.5);
    near(darkened[2], plain[2] * 0.5);
  });
});

describe("vignetteFalloff", () => {
  const maxDistance = Math.sqrt(200 * 200 + 100 * 100);

  test("leaves the image alone when the strength is zero", () => {
    near(vignetteFalloff(200, 100, maxDistance, 0), 1);
  });

  test("is exactly 1 in the middle", () => {
    near(vignetteFalloff(0, 0, maxDistance, 0.8), 1);
  });

  test("darkens furthest at a corner", () => {
    const corner = vignetteFalloff(200, 100, maxDistance, 0.5);
    const edge = vignetteFalloff(200, 0, maxDistance, 0.5);
    const mid = vignetteFalloff(100, 50, maxDistance, 0.5);
    assert.ok(corner < edge, "corner should be darker than the edge midpoint");
    assert.ok(edge < mid, "edge midpoint should be darker than the half way point");
    near(corner, 1 - 0.5);
  });

  test("stays positive up to the full strength", () => {
    assert.ok(vignetteFalloff(200, 100, maxDistance, 1) >= 0);
  });
});

describe("toneKey", () => {
  const a = { vibrance: 1.4, saturation: 1.9, brightness: 1.05, contrast: 1.4, vignette: 0.25 };

  test("equal settings give equal keys", () => {
    assert.equal(toneKey(a), toneKey({ ...a }));
  });

  test("a single changed setting gives a different key", () => {
    for (const field of ["vibrance", "saturation", "brightness", "contrast", "vignette"]) {
      assert.notEqual(toneKey(a), toneKey({ ...a, [field]: a[field] + 0.01 }), field);
    }
  });
});
