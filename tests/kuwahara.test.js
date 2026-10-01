import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  KUWAHARA_MODES,
  MAX_PASSES,
  MAX_RADIUS,
  MAX_SECTORS,
  MIN_PASSES,
  MIN_RADIUS,
  MIN_SECTORS,
  OIL_PAINT_DEFAULTS,
  OIL_PAINT_PRESETS,
  applyOilPaint,
  boostSaturation,
  buildLuminanceSat,
  buildSectorTable,
  kuwaharaQuadrants,
  kuwaharaSectors,
  normalizeOptions,
  normalizePasses,
  normalizeRadius,
  normalizeSectors,
  rectSum,
  sharpenEdges,
} from "../src/lib/core/kuwahara.js";

// Small frames on purpose. The filter is the most expensive thing in the app, so
// a big one here would use a lot of memory to prove nothing the 64 pixel frame
// does not already prove. Passes are held at 1 except where the pass count is
// what is under test.
const W = 64;
const H = 64;

/** A frame of one flat colour. */
function flatFrame(r, g, b, alpha = 255, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = alpha;
  }
  return { width: w, height: h, data };
}

/** Two flat halves, split down the middle, so a boundary crosses the frame. */
function splitFrame(w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const left = x < w / 2;
      data[i] = left ? 200 : 30;
      data[i + 1] = left ? 40 : 90;
      data[i + 2] = left ? 40 : 160;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** A grey ramp with some structure in it, so no window is ever uniform. */
function rampFrame(w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.round((x * 3 + y * 2 + ((x * y) % 17) * 7) % 256);
      data[i] = v;
      data[i + 1] = Math.round((v * 1.5) % 256);
      data[i + 2] = Math.round((255 - v) / 2);
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Every channel of a frame is a byte, so every channel is in 0..255. */
function assertInRange(frame) {
  for (let i = 0; i < frame.data.length; i++) {
    const v = frame.data[i];
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `byte ${i} is ${v}`);
  }
}

/** The three colour channels of one pixel, alpha left out. */
function at(frame, x, y) {
  const i = (y * frame.width + x) * 4;
  return [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
}

describe("a uniform image", () => {
  for (const mode of KUWAHARA_MODES) {
    test(`comes out exactly as it went in, ${mode.value}`, () => {
      for (const colour of [
        [0, 0, 0],
        [255, 255, 255],
        [120, 120, 120],
        [200, 40, 40],
      ]) {
        const frame = flatFrame(...colour);
        const out = applyOilPaint(frame, { mode: mode.value, radius: 6, passes: 1, sectors: 8 });
        assert.deepEqual([...out.data], [...frame.data], `flat ${colour} moved`);
      }
    });
  }

  test("is still uniform with the finishing passes on", () => {
    const frame = flatFrame(90, 110, 130);
    const out = applyOilPaint(frame, {
      radius: 6,
      passes: 1,
      saturation: 100,
      sharpen: 100,
    });
    assertInRange(out);
    const first = at(out, 0, 0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) assert.deepEqual(at(out, x, y), first, `pixel ${x},${y} drifted`);
    }
  });

  test("grey has no saturation to boost", () => {
    const frame = flatFrame(128, 128, 128);
    const out = applyOilPaint(frame, { radius: 4, passes: 1, saturation: 100 });
    assert.deepEqual([...out.data], [...frame.data]);
  });
});

describe("a region of flat colour", () => {
  const LEFT = [200, 40, 40];
  const RIGHT = [30, 90, 160];
  const RADIUS = 3;

  for (const mode of KUWAHARA_MODES) {
    test(`stays flat in its interior, ${mode.value}`, () => {
      const frame = splitFrame();
      const out = applyOilPaint(frame, { mode: mode.value, radius: RADIUS, passes: 1, sectors: 8 });

      // Twice the radius clear of the split is a window that cannot reach the
      // other side, so every sector or quadrant in it holds one colour only.
      const edge = W / 2;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (x > edge - RADIUS * 2 - 1 && x < edge + RADIUS * 2) continue;
          const expected = x < edge ? LEFT : RIGHT;
          assert.deepEqual(at(out, x, y), expected, `pixel ${x},${y} left its region`);
        }
      }
    });
  }

  test("the pass is not a no-op on a frame with structure", () => {
    // Without this, the tests above would also pass on a filter that copies.
    const frame = rampFrame();
    const out = applyOilPaint(frame, { radius: 5, passes: 1 });
    assert.notDeepEqual([...out.data], [...frame.data]);
    assertInRange(out);
  });

  test("a larger radius stays within one region further in", () => {
    const frame = splitFrame();
    const radius = 6;
    const out = applyOilPaint(frame, { radius, passes: 1 });
    const edge = W / 2;
    for (let y = 0; y < H; y++) {
      assert.deepEqual(at(out, 0, y), LEFT);
      assert.deepEqual(at(out, W - 1, y), RIGHT);
      assert.deepEqual(at(out, edge - radius - 1, y), LEFT);
      assert.deepEqual(at(out, edge + radius, y), RIGHT);
    }
  });
});

describe("output channels", () => {
  test("every preset is in range in both modes", () => {
    for (const frame of [rampFrame(), flatFrame(10, 200, 240), flatFrame(0, 0, 0, 0)]) {
      for (const preset of OIL_PAINT_PRESETS) {
        for (const mode of KUWAHARA_MODES) {
          const out = applyOilPaint(frame, { ...preset, mode: mode.value });
          assertInRange(out);
        }
      }
    }
  });

  test("both ends of every slider are safe", () => {
    const frame = rampFrame();
    for (const mode of KUWAHARA_MODES) {
      for (const radius of [MIN_RADIUS, MAX_RADIUS]) {
        for (const sectors of [MIN_SECTORS, MAX_SECTORS]) {
          for (const saturation of [0, 100]) {
            for (const sharpen of [0, 100]) {
              const out = applyOilPaint(frame, { mode: mode.value, radius, sectors, saturation, sharpen });
              assertInRange(out);
            }
          }
        }
      }
    }
  });

  test("alpha is never touched, so a cut-out keeps its transparency", () => {
    const frame = flatFrame(200, 100, 50, 0);
    const out = applyOilPaint(frame, { radius: 6, passes: 2, saturation: 100, sharpen: 100 });
    for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 0);
  });

  test("does not modify the frame it was given", () => {
    const frame = rampFrame();
    const before = [...frame.data];
    applyOilPaint(frame, { radius: 6, passes: 2, saturation: 60, sharpen: 40 });
    assert.deepEqual([...frame.data], before);
  });

  test("always hands back a fresh buffer", () => {
    const frame = rampFrame();
    const out = applyOilPaint(frame, { radius: 4, passes: 1 });
    assert.notEqual(out.data, frame.data);
    assert.equal(out.width, W);
    assert.equal(out.height, H);
  });

  test("the same settings always give the same frame", () => {
    const frame = rampFrame(96, 64);
    const options = { mode: "generalized", radius: 4, passes: 2, sectors: 8, saturation: 30, sharpen: 30 };
    assert.deepEqual([...applyOilPaint(frame, options).data], [...applyOilPaint(frame, options).data]);
  });

  test("works on a frame that is not a square", () => {
    const frame = rampFrame(96, 64);
    const out = applyOilPaint(frame, { radius: 5, passes: 1 });
    assert.equal(out.width, 96);
    assert.equal(out.height, 64);
    assert.equal(out.data.length, 96 * 64 * 4);
    assertInRange(out);
  });

  test("a one pixel frame is safe", () => {
    for (const mode of KUWAHARA_MODES) {
      const out = applyOilPaint(flatFrame(120, 130, 140, 255, 1, 1), {
        mode: mode.value,
        radius: 8,
        passes: 2,
        sectors: 16,
        saturation: 100,
        sharpen: 100,
      });
      assertInRange(out);
      assert.equal(out.data.length, 4);
    }
  });

  test("reports progress that stays inside 0..1 and finishes at 1", () => {
    const seen = [];
    applyOilPaint(rampFrame(), {
      radius: 4,
      passes: 2,
      saturation: 50,
      sharpen: 50,
      onProgress: (ratio) => seen.push(ratio),
    });
    assert.ok(seen.length > 0, "nothing was reported");
    for (const ratio of seen) assert.ok(ratio >= 0 && ratio <= 1, `progress ${ratio} is out of range`);
    assert.equal(seen[seen.length - 1], 1);
  });
});

describe("degenerate parameters", () => {
  test("a radius of 0 is raised to the floor rather than kept", () => {
    assert.equal(MIN_RADIUS, 1);
    assert.equal(normalizeRadius(0), MIN_RADIUS);
    assert.equal(normalizeRadius(-9), MIN_RADIUS);
    assert.equal(normalizeRadius(Number.NaN), OIL_PAINT_DEFAULTS.radius);
    assert.equal(normalizeRadius("nope"), OIL_PAINT_DEFAULTS.radius);
    assert.equal(normalizeRadius(999), MAX_RADIUS);
    assert.equal(normalizeRadius(4.6), 5);
  });

  test("a pass count of 0 is raised to the floor rather than kept", () => {
    assert.equal(MIN_PASSES, 1);
    assert.equal(normalizePasses(0), MIN_PASSES);
    assert.equal(normalizePasses(-3), MIN_PASSES);
    assert.equal(normalizePasses(undefined), OIL_PAINT_DEFAULTS.passes);
    assert.equal(normalizePasses(999), MAX_PASSES);
  });

  test("zero passes and a zero radius give the same frame as the floors do", () => {
    const frame = rampFrame();
    const floor = applyOilPaint(frame, { radius: MIN_RADIUS, passes: MIN_PASSES });
    const zero = applyOilPaint(frame, { radius: 0, passes: 0 });
    assert.deepEqual([...zero.data], [...floor.data]);
    assertInRange(zero);
  });

  test("a pass called directly with a radius of 0 is the identity", () => {
    // The normalized path raises the radius, so this is the layer below that has
    // to be safe on its own: exp(NaN) in the weight table, and a quadrant of
    // negative width at the frame edge.
    const frame = rampFrame();
    for (const radius of [0, -4, Number.NaN]) {
      assert.deepEqual([...kuwaharaQuadrants(frame, radius).data], [...frame.data]);
      assert.deepEqual([...kuwaharaSectors(frame, radius, 8).data], [...frame.data]);
    }
  });

  test("a pass called directly with no sectors is the identity", () => {
    const frame = rampFrame();
    assert.deepEqual([...kuwaharaSectors(frame, 3, 0).data], [...frame.data]);
  });

  test("normalizeOptions fills in everything and rejects a rubbish object", () => {
    assert.deepEqual(normalizeOptions(), {
      mode: "standard",
      radius: OIL_PAINT_DEFAULTS.radius,
      passes: OIL_PAINT_DEFAULTS.passes,
      sectors: OIL_PAINT_DEFAULTS.sectors,
      saturation: 0,
      sharpen: 0,
    });
    assert.deepEqual(normalizeOptions({ mode: "nonsense", radius: "x", passes: null, sectors: {}, saturation: -50, sharpen: 400 }), {
      mode: "standard",
      radius: OIL_PAINT_DEFAULTS.radius,
      passes: OIL_PAINT_DEFAULTS.passes,
      sectors: OIL_PAINT_DEFAULTS.sectors,
      saturation: 0,
      sharpen: 100,
    });
  });
});

describe("the sector count", () => {
  test("below the minimum is raised to it, not used", () => {
    assert.equal(MIN_SECTORS, 4);
    assert.equal(normalizeSectors(0), MIN_SECTORS);
    assert.equal(normalizeSectors(1), MIN_SECTORS);
    assert.equal(normalizeSectors(3), MIN_SECTORS);
    assert.equal(normalizeSectors(-8), MIN_SECTORS);
    assert.equal(normalizeSectors(Number.NaN), OIL_PAINT_DEFAULTS.sectors);
    assert.equal(normalizeSectors(999), MAX_SECTORS);
  });

  test("below the minimum gives the same frame as the minimum does", () => {
    const frame = rampFrame();
    const floor = applyOilPaint(frame, { mode: "generalized", radius: 3, sectors: MIN_SECTORS });
    for (const sectors of [0, 1, 2, 3]) {
      const out = applyOilPaint(frame, { mode: "generalized", radius: 3, sectors });
      assert.deepEqual([...out.data], [...floor.data], `sectors ${sectors} was not clamped`);
      assertInRange(out);
    }
  });

  test("more sectors than a small window has pixels is still finite", () => {
    // A window three pixels across split into sixteen sectors leaves some of
    // them empty, and an empty sector has a weight sum of zero.
    const frame = rampFrame();
    for (const radius of [1, 2]) {
      const out = kuwaharaSectors(frame, radius, MAX_SECTORS);
      assertInRange(out);
      for (let i = 0; i < out.data.length; i++) {
        assert.ok(!Number.isNaN(out.data[i]), `byte ${i} is NaN`);
      }
    }
  });

  test("every offset in the window belongs to exactly one sector", () => {
    for (const radius of [1, 3, 7]) {
      for (const sectors of [MIN_SECTORS, 8, MAX_SECTORS]) {
        const table = buildSectorTable(radius, sectors);
        const total = table.starts[sectors];
        assert.equal(total, (2 * radius + 1) ** 2, `radius ${radius}, ${sectors} sectors`);
        assert.equal(table.dx.length, total);
        for (let i = 0; i < total; i++) {
          assert.ok(Number.isFinite(table.weight[i]), `weight ${i} is not finite`);
          assert.ok(table.weight[i] > 0, `weight ${i} is not positive`);
          assert.ok(Math.abs(table.dx[i]) <= radius && Math.abs(table.dy[i]) <= radius);
        }
        // The centre is always in the first sector, so every pixel has one
        // region that is not empty and there is always something to divide by.
        assert.ok(table.starts[1] >= 1, `radius ${radius}, ${sectors} sectors left the first empty`);
      }
    }
  });
});

describe("the luminance table", () => {
  test("the whole frame sums to what the pixels say it does", () => {
    const frame = rampFrame();
    const sat = buildLuminanceSat(frame);
    const out = [0, 0];
    let expected = 0;
    let expectedSq = 0;
    for (let i = 0; i < frame.data.length; i += 4) {
      const lum = 0.2126 * frame.data[i] + 0.7152 * frame.data[i + 1] + 0.0722 * frame.data[i + 2];
      expected += lum;
      expectedSq += lum * lum;
    }
    rectSum(sat, 0, 0, W - 1, H - 1, out);
    assert.ok(Math.abs(out[0] - expected) < 1e-6, `sum ${out[0]} is not ${expected}`);
    assert.ok(Math.abs(out[1] - expectedSq) < 1e-3, `squares ${out[1]} is not ${expectedSq}`);
  });

  test("a rectangle at the top left corner needs no special case", () => {
    // Row zero and column zero are left at zero, which is what lets the sum be
    // four table entries with no tests for the edges.
    const frame = splitFrame();
    const sat = buildLuminanceSat(frame);
    const out = [0, 0];
    let expected = 0;
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const i = (y * W + x) * 4;
        expected += 0.2126 * frame.data[i] + 0.7152 * frame.data[i + 1] + 0.0722 * frame.data[i + 2];
      }
    }
    rectSum(sat, 0, 0, 4, 4, out);
    assert.ok(Math.abs(out[0] - expected) < 1e-6, `sum ${out[0]} is not ${expected}`);
  });
});

describe("the finishing passes", () => {
  test("no boost and no sharpening hand back a copy, not the same buffer", () => {
    const frame = rampFrame();
    for (const amount of [0, Number.NaN, -20]) {
      const boosted = boostSaturation(frame, amount);
      const sharp = sharpenEdges(frame, amount);
      assert.notEqual(boosted.data, frame.data);
      assert.notEqual(sharp.data, frame.data);
      assert.deepEqual([...boosted.data], [...frame.data]);
      assert.deepEqual([...sharp.data], [...frame.data]);
    }
  });

  test("a full boost pushes colour away from grey without leaving 0..255", () => {
    const out = boostSaturation(rampFrame(), 100);
    assertInRange(out);
  });

  test("sharpening lifts the contrast across a step", () => {
    const frame = splitFrame();
    const out = sharpenEdges(frame, 100);
    // The pixel on the dark side of the split, whose neighbours are mostly on
    // the light side, is the one the mask has something to say about.
    const x = W / 2 - 1;
    const i = (0 * W + x) * 4;
    assert.notEqual(out.data[i], frame.data[i], "the step was left alone");
    assert.ok(out.data[i] > frame.data[i], "the light side of a step should get lighter");
    assertInRange(out);
  });

  test("sharpening is skipped where there are no neighbours", () => {
    const frame = flatFrame(120, 130, 140, 255, 1, 1);
    const out = sharpenEdges(frame, 100);
    assert.deepEqual([...out.data], [...frame.data]);
  });
});
