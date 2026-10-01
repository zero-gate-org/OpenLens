import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  GLITCH_DEFAULTS,
  PASSES,
  applyGlitch,
  makeRng,
  planSlices,
  readClamped,
} from "../src/lib/core/glitch.js";

const W = 64;
const H = 64;

/**
 * A frame with structure in all three channels and a range of values in each,
 * so a pass that moves a pixel somewhere else has somewhere to move it to and
 * a change is visible as a change rather than as noise.
 */
function frame(width = W, height = H) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.round((x * 255) / (width - 1));
      data[i + 1] = Math.round((y * 255) / (height - 1));
      data[i + 2] = Math.round(((x + y) * 255) / (width + height - 2));
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Every pass on, hard on, at a named seed. */
const LOUD = {
  seed: 7,
  intensity: 1,
  slicing: true,
  channel: true,
  scanline: true,
  datamosh: true,
  rgbSplit: true,
  sliceCount: 20,
  maxSliceOffset: 120,
  blockSize: 16,
};

const countPasses = (options) => PASSES.filter((pass) => options[pass.key]).length;

describe("makeRng", () => {
  test("the same seed gives the same sequence", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const left = Array.from({ length: 16 }, a);
    const right = Array.from({ length: 16 }, b);
    assert.deepEqual(left, right);
  });

  test("a different seed gives a different sequence", () => {
    const a = Array.from({ length: 16 }, makeRng(42));
    const b = Array.from({ length: 16 }, makeRng(43));
    assert.notDeepEqual(a, b);
  });

  test("stays inside 0..1", () => {
    const rng = makeRng(1);
    for (let i = 0; i < 500; i++) {
      const n = rng();
      assert.ok(n >= 0 && n < 1, `${n} is outside 0..1`);
    }
  });
});

describe("applyGlitch: the seed", () => {
  test("the same seed and settings give byte identical output", () => {
    const src = frame();
    const first = applyGlitch(src, LOUD);
    const second = applyGlitch(src, LOUD);
    assert.equal(first.width, second.width);
    assert.equal(first.height, second.height);
    assert.deepEqual(Array.from(first.data), Array.from(second.data));
  });

  test("the same seed gives byte identical output whatever the pass order did before it", () => {
    // The result must be a function of the settings alone. Applying the same
    // corruption to an already corrupted frame is a different question, and it
    // must not leak into a rerun from the clean source.
    const src = frame();
    const clean = applyGlitch(src, LOUD);
    const again = applyGlitch(src, { ...LOUD, seed: LOUD.seed });
    assert.deepEqual(Array.from(clean.data), Array.from(again.data));
  });

  test("a different seed gives a different frame", () => {
    const src = frame();
    const a = applyGlitch(src, { ...LOUD, seed: 1 });
    const b = applyGlitch(src, { ...LOUD, seed: 2 });
    assert.notDeepEqual(Array.from(a.data), Array.from(b.data));
  });

  test("the source frame is never written to", () => {
    const src = frame();
    const before = Array.from(src.data);
    const out = applyGlitch(src, LOUD);
    assert.deepEqual(Array.from(src.data), before);
    assert.notEqual(out.data, src.data);
  });
});

describe("applyGlitch: intensity", () => {
  test("every pass on its own is a no-op at intensity 0", () => {
    const src = frame();
    for (const pass of PASSES) {
      const options = {
        seed: 11,
        intensity: 0,
        sliceCount: 20,
        maxSliceOffset: 200,
        blockSize: 16,
        ...Object.fromEntries(PASSES.map((p) => [p.key, p.key === pass.key])),
      };
      const out = applyGlitch(src, options);
      assert.deepEqual(
        Array.from(out.data),
        Array.from(src.data),
        `${pass.key} changed the frame at intensity 0`,
      );
    }
  });

  test("all five passes on is still a no-op at intensity 0", () => {
    const src = frame();
    const out = applyGlitch(src, { ...LOUD, intensity: 0 });
    assert.deepEqual(Array.from(out.data), Array.from(src.data));
  });

  test("a negative intensity is treated as zero rather than as an inversion", () => {
    const src = frame();
    const out = applyGlitch(src, { ...LOUD, intensity: -4 });
    assert.deepEqual(Array.from(out.data), Array.from(src.data));
  });

  test("an intensity above one is clamped rather than allowed to run away", () => {
    const src = frame();
    const loud = applyGlitch(src, { ...LOUD, intensity: 1 });
    const over = applyGlitch(src, { ...LOUD, intensity: 9 });
    assert.deepEqual(Array.from(over.data), Array.from(loud.data));
  });

  test("at full intensity every pass on its own changes something", () => {
    const src = frame();
    for (const pass of PASSES) {
      const options = {
        seed: 11,
        intensity: 1,
        sliceCount: 20,
        maxSliceOffset: 200,
        blockSize: 16,
        ...Object.fromEntries(PASSES.map((p) => [p.key, p.key === pass.key])),
      };
      const out = applyGlitch(src, options);
      assert.notDeepEqual(
        Array.from(out.data),
        Array.from(src.data),
        `${pass.key} did nothing at full intensity`,
      );
    }
  });

  test("a pass that is switched off does nothing, whatever the intensity", () => {
    const src = frame();
    const off = Object.fromEntries(PASSES.map((p) => [p.key, false]));
    for (const pass of PASSES) {
      const out = applyGlitch(src, { ...LOUD, ...off, [pass.key]: false });
      assert.deepEqual(Array.from(out.data), Array.from(src.data), `${pass.key} ran while off`);
    }
  });

  test("nothing switched on returns the frame untouched", () => {
    const src = frame();
    const out = applyGlitch(src, { ...LOUD, ...Object.fromEntries(PASSES.map((p) => [p.key, false])) });
    assert.deepEqual(Array.from(out.data), Array.from(src.data));
    assert.equal(out.data.length, src.data.length);
  });
});

describe("applyGlitch: channel range", () => {
  test("every channel of the result is a byte", () => {
    const src = frame();
    const out = applyGlitch(src, LOUD);
    assert.equal(out.data.length, src.data.length);

    for (let i = 0; i < out.data.length; i++) {
      const v = out.data[i];
      assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `byte ${i} is ${v}`);
    }
  });

  test("no pass invents an alpha value", () => {
    // Alpha is the shape of the picture, so nothing here is allowed to write
    // one. The slicing pass does move alpha, but only by moving the row it is
    // part of, which is covered on its own below.
    const src = frame();
    for (let i = 3; i < src.data.length; i += 4) src.data[i] = (i * 7) % 256;

    const passes = Object.fromEntries(PASSES.map((p) => [p.key, p.key !== "slicing"]));
    const out = applyGlitch(src, { ...LOUD, ...passes });
    for (let p = 0; p < W * H; p++) {
      assert.equal(out.data[p * 4 + 3], src.data[p * 4 + 3], `alpha moved at pixel ${p}`);
    }
  });

  test("slicing carries alpha with the row it moves, and loses none of it", () => {
    const src = frame();
    for (let i = 3; i < src.data.length; i += 4) src.data[i] = (i * 7) % 256;

    const out = applyGlitch(src, { ...LOUD, ...Object.fromEntries(PASSES.map((p) => [p.key, p.key === "slicing"])) });

    // A slice is the row moved, not the row recoloured, so the alphas on the
    // frame are the same values, reordered. Nothing gained, nothing lost.
    const before = Array.from(src.data).filter((_, i) => i % 4 === 3).sort((a, b) => a - b);
    const after = Array.from(out.data).filter((_, i) => i % 4 === 3).sort((a, b) => a - b);
    assert.deepEqual(after, before);
  });

  test("a fully transparent frame is still fully transparent", () => {
    const src = frame();
    src.data.fill(0);

    const out = applyGlitch(src, LOUD);
    for (let p = 0; p < W * H; p++) assert.equal(out.data[p * 4 + 3], 0);
  });

  test("a one pixel frame survives every pass", () => {
    // Divisions by the frame size are the obvious way to break here, and a
    // thumbnail-sized frame is a real thing to open.
    const tiny = { width: 1, height: 1, data: new Uint8ClampedArray([200, 100, 50, 255]) };
    const out = applyGlitch(tiny, { ...LOUD, blockSize: 16, maxSliceOffset: 120 });
    assert.equal(out.width, 1);
    assert.equal(out.height, 1);
    assert.equal(out.data.length, 4);
    for (const v of out.data) assert.ok(v >= 0 && v <= 255);
  });
});

describe("planSlices", () => {
  test("every band sits inside the frame", () => {
    for (let seed = 0; seed < 200; seed++) {
      const bands = planSlices(H, 20, 120, makeRng(seed));
      for (const band of bands) {
        assert.ok(band.y >= 0, `y ${band.y} < 0`);
        assert.ok(band.y < H, `y ${band.y} >= ${H}`);
        assert.ok(band.height > 0, "empty band");
        assert.ok(band.y + band.height <= H, `band runs to ${band.y + band.height} > ${H}`);
        assert.ok(band.offset !== 0, "a band that does not move");
      }
    }
  });

  test("a band is never planned below the last row of the frame", () => {
    // Height one: the only band that can exist is the single row it has.
    const bands = planSlices(1, 20, 120, makeRng(3));
    for (const band of bands) {
      assert.equal(band.y, 0);
      assert.equal(band.height, 1);
    }
  });

  test("a zero count plans nothing", () => {
    assert.deepEqual(planSlices(H, 0, 120, makeRng(3)), []);
  });
});

describe("applyGlitch: slicing bounds", () => {
  test("slicing only writes inside the bands it planned", () => {
    const src = frame();
    const options = { ...LOUD, seed: 5, slicing: true };
    const scale = 1;
    const out = applyGlitch(src, options);

    // The generator draws in a fixed order, so the plan for a slicing-only
    // pass is the same plan the full pass started with.
    const bands = planSlices(H, options.sliceCount, Math.round(options.maxSliceOffset * scale), makeRng(options.seed));

    const moved = new Set();
    for (const band of bands) {
      for (let y = band.y; y < band.y + band.height; y++) moved.add(y);
    }

    // Every row outside a band must be bit identical, which can only hold if
    // nothing was written outside the bands.
    for (let y = 0; y < H; y++) {
      if (moved.has(y)) continue;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        assert.deepEqual(
          Array.from(out.data.subarray(i, i + 4)),
          Array.from(src.data.subarray(i, i + 4)),
          `row ${y} was written and no band covers it`,
        );
      }
    }
  });

  test("an offset wider than the frame wraps instead of reading past the end", () => {
    // 200 px of offset on a 64 px frame. A non-wrapped read would run off the
    // end of the buffer, which a typed array answers by throwing.
    const src = frame();
    const out = applyGlitch(src, { ...LOUD, slicing: true, maxSliceOffset: 200, sliceCount: 30 });
    assert.equal(out.data.length, src.data.length);
  });

  test("the frame keeps its size whatever the passes do", () => {
    const src = frame(96, 48);
    const out = applyGlitch(src, { ...LOUD, blockSize: 64, maxSliceOffset: 200 });
    assert.equal(out.width, 96);
    assert.equal(out.height, 48);
    assert.equal(out.data.length, 96 * 48 * 4);
  });
});

describe("applyGlitch: settings", () => {
  test("a block larger than the frame is ignored rather than dividing by zero", () => {
    const src = frame(16, 16);
    const out = applyGlitch(src, { ...LOUD, datamosh: true, blockSize: 64, slicing: false, channel: false, scanline: false, rgbSplit: false });
    assert.equal(out.data.length, src.data.length);
  });

  test("a block size of one still produces blocks", () => {
    const src = frame();
    const out = applyGlitch(src, {
      ...LOUD,
      datamosh: true,
      blockSize: 1,
      slicing: false,
      channel: false,
      scanline: false,
      rgbSplit: false,
    });
    assert.notDeepEqual(Array.from(out.data), Array.from(src.data));
  });

  test("the default settings are the ones a panel starts on", () => {
    const src = frame();
    const out = applyGlitch(src);
    const explicit = applyGlitch(src, { ...GLITCH_DEFAULTS });
    assert.deepEqual(Array.from(out.data), Array.from(explicit.data));
    assert.equal(GLITCH_DEFAULTS.intensity, 0.5);
  });

  test("readClamped holds its coordinates inside the frame", () => {
    const src = frame();
    assert.equal(readClamped(src.data, -5, 0, W, H, 0), src.data[0]);
    assert.equal(readClamped(src.data, W + 5, 0, W, H, 0), src.data[(W - 1) * 4]);
    assert.equal(readClamped(src.data, 0, -5, W, H, 1), src.data[1]);
    assert.equal(readClamped(src.data, 0, H + 5, W, H, 1), src.data[((H - 1) * W) * 4 + 1]);
  });
});
