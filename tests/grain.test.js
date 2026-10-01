import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MAX_OFFSET, applyGrain, grainNoise, luminance } from "../src/lib/core/grain.js";

// Small frames on purpose: these tests are about the arithmetic, and a big one
// would only make the suite slower and use more memory for no extra signal.
const W = 64;
const H = 48;

/** A deterministic test frame, opaque, with every channel populated. */
function makeFrame(red = (x, y) => (x * 5 + y * 3) % 256) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = red(x, y);
      data[i + 1] = (x * 9 + y * 17) % 256;
      data[i + 2] = (x * 31 + y * 11) % 256;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

/** A frame of one flat colour, for the tests about a single tone. */
function flatFrame(r, g, b) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width: W, height: H, data };
}

const same = (a, b) => a.data.every((value, i) => value === b.data[i]);

/** Every settings set is exercised against the same frame. */
const NOISE_TYPES = ["uniform", "luminance", "color"];
const SHAPES = ["square", "random"];
const PLACEMENTS = ["everywhere", "highlights", "shadows"];
const BLEND_MODES = ["add", "overlay", "soft-light"];

function everySetting(extra = {}) {
  const all = [];
  for (const noiseType of NOISE_TYPES) {
    for (const shape of SHAPES) {
      for (const placement of PLACEMENTS) {
        for (const blendMode of BLEND_MODES) {
          all.push({ noiseType, shape, placement, blendMode, strength: 100, blend: 100, grainSize: 3, seed: 5, ...extra });
        }
      }
    }
  }
  return all;
}

describe("grainNoise", () => {
  test("is a function of its three inputs and nothing else", () => {
    assert.equal(grainNoise(12, 34, 56), grainNoise(12, 34, 56));
  });

  test("changes with the seed", () => {
    assert.notEqual(grainNoise(12, 34, 56), grainNoise(12, 34, 57));
  });

  test("stays inside 0..1", () => {
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const v = grainNoise(x, y, 7);
        assert.ok(v >= 0 && v < 1, `${v} is outside 0..1`);
      }
    }
  });

  test("spreads its output over the whole range", () => {
    // A hash that clumps would still be in range, and would still be
    // deterministic, and would still produce a picture that looks like grain
    // for a while. Bucketing is the only thing that catches a broken mixer.
    const buckets = new Array(16).fill(0);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        buckets[Math.floor(grainNoise(x, y, 42) * 16)] += 1;
      }
    }
    for (const count of buckets) {
      assert.ok(count > 64 * 64 / 16 / 2, `a bucket holds only ${count} of 4096`);
    }
  });

  test("is not periodic over a large image", () => {
    // The legacy hash was a sine, which loses its low bits at a few thousand
    // pixels and starts repeating a diagonal band. A wide row far from the
    // origin is where that shows up.
    const seen = new Set();
    for (let x = 0; x < 4096; x++) seen.add(grainNoise(x, 3000, 1));
    assert.ok(seen.size > 4000, `only ${seen.size} distinct values across 4096 pixels`);
  });
});

describe("luminance", () => {
  test("anchors black and white", () => {
    // The coefficients do not sum to exactly one, so white lands a rounding
    // step under 1. Anything comparing a luminance against a cut is unaffected
    // at that distance, and pretending the sum is exact would hide a real one.
    assert.equal(luminance(0, 0, 0), 0);
    assert.ok(Math.abs(luminance(255, 255, 255) - 1) < 1e-9);
  });

  test("weighs green most", () => {
    assert.ok(luminance(0, 255, 0) > luminance(255, 0, 0));
    assert.ok(luminance(255, 0, 0) > luminance(0, 0, 255));
  });
});

describe("applyGrain: determinism", () => {
  test("the same seed and settings give byte identical output", () => {
    const frame = makeFrame();
    for (const settings of everySetting()) {
      const a = applyGrain(frame, settings);
      const b = applyGrain(frame, settings);
      assert.ok(same(a, b), `not reproducible for ${JSON.stringify(settings)}`);
    }
  });

  test("a different seed gives different output", () => {
    const frame = makeFrame();
    for (const settings of everySetting()) {
      const a = applyGrain(frame, { ...settings, seed: 1 });
      const b = applyGrain(frame, { ...settings, seed: 2 });
      assert.ok(!same(a, b), `seed made no difference for ${JSON.stringify(settings)}`);
    }
  });

  test("a larger grain size gives a different pattern", () => {
    const frame = makeFrame();
    const fine = applyGrain(frame, { strength: 100, grainSize: 1, seed: 3 });
    const coarse = applyGrain(frame, { strength: 100, grainSize: 4, seed: 3 });
    assert.ok(!same(fine, coarse));
  });

  test("re-running a pass over its own output is not a fixed point", () => {
    // Not a requirement, but a grain that undid itself would look alive. Worth
    // knowing, so it is pinned.
    const frame = makeFrame();
    const once = applyGrain(frame, { strength: 80, seed: 3 });
    const twice = applyGrain(once, { strength: 80, seed: 3 });
    assert.ok(!same(once, twice));
  });
});

describe("applyGrain: range and format", () => {
  test("every channel stays inside 0..255, in every mode", () => {
    const frame = makeFrame();
    for (const settings of everySetting()) {
      const out = applyGrain(frame, settings);
      for (let i = 0; i < out.data.length; i++) {
        assert.ok(out.data[i] >= 0 && out.data[i] <= 255, `byte ${i} is ${out.data[i]}`);
      }
    }
  });

  test("the strongest setting stays inside the range without clipping away", () => {
    // At full strength the offset is MAX_OFFSET, so a mid grey on a strong
    // offset has to move by roughly that much. A pass that quietly clipped
    // would still be in range and would still look plausible.
    const frame = flatFrame(128, 128, 128);
    const out = applyGrain(frame, { noiseType: "uniform", strength: 100, blendMode: "add", blend: 100, seed: 9 });
    let biggest = 0;
    for (let i = 0; i < out.data.length; i += 4) biggest = Math.max(biggest, Math.abs(out.data[i] - 128));
    assert.ok(biggest > MAX_OFFSET * 0.9, `the strongest offset reached only ${biggest}`);
    assert.ok(biggest <= MAX_OFFSET, `the offset overshot to ${biggest}`);
  });

  test("the frame size is carried through unchanged", () => {
    const out = applyGrain(makeFrame(), { strength: 50 });
    assert.equal(out.width, W);
    assert.equal(out.height, H);
    assert.equal(out.data.length, W * H * 4);
  });

  test("the source frame is never written to", () => {
    // The preview keeps the sharp frame and re-grains it on every control
    // change. A pass that wrote in place would show up as grain that deepens
    // each time a slider moves.
    const frame = makeFrame();
    const before = Uint8ClampedArray.from(frame.data);
    applyGrain(frame, { noiseType: "color", strength: 100, grainSize: 4, seed: 8 });
    assert.ok(same(frame, { width: W, height: H, data: before }));
  });

  test("alpha is left alone", () => {
    const frame = makeFrame();
    for (let i = 3; i < frame.data.length; i += 4) frame.data[i] = i % 256;
    const out = applyGrain(frame, { noiseType: "color", strength: 100, seed: 4 });
    for (let i = 3; i < out.data.length; i += 4) {
      assert.equal(out.data[i], frame.data[i]);
    }
  });
});

describe("applyGrain: strength and intensity", () => {
  test("a strength of zero returns the input unchanged", () => {
    const frame = makeFrame();
    for (const settings of everySetting({ strength: 0 })) {
      assert.ok(same(applyGrain(frame, settings), frame), `not an identity for ${JSON.stringify(settings)}`);
    }
  });

  test("an intensity of zero returns the input unchanged", () => {
    const frame = makeFrame();
    for (const blendMode of BLEND_MODES) {
      const out = applyGrain(frame, { strength: 100, blend: 0, blendMode, seed: 6 });
      assert.ok(same(out, frame), `${blendMode} changed the frame at zero intensity`);
    }
  });

  test("strength is monotone, so the slider cannot go backwards", () => {
    // Measured as mean absolute movement from the source, which is the only
    // sense in which "stronger" is meaningful for a random field.
    const frame = makeFrame();
    const travel = (strength) => {
      const out = applyGrain(frame, { noiseType: "uniform", strength, seed: 12, blendMode: "add" });
      let total = 0;
      for (let i = 0; i < out.data.length; i++) total += Math.abs(out.data[i] - frame.data[i]);
      return total / out.data.length;
    };
    const weak = travel(20);
    const strong = travel(80);
    assert.ok(strong > weak * 2, `${strong} is not clearly more than ${weak}`);
  });
});

describe("applyGrain: tonal placement", () => {
  const flat = () => flatFrame(128, 128, 128);
  const white = () => flatFrame(255, 255, 255);
  const black = () => flatFrame(0, 0, 0);
  const settings = { strength: 100, noiseType: "uniform", blend: 100, seed: 21 };
  // The linear mode, for the tests that are only about the mask. It is the one
  // mode that can move a clipped channel, so with it a frame changing proves
  // the mask let it through rather than the blend holding it back.
  const linear = { ...settings, blendMode: "add" };

  test("everywhere grains every tone", () => {
    assert.ok(!same(applyGrain(flat(), { ...linear, placement: "everywhere" }), flat()));
    assert.ok(!same(applyGrain(white(), { ...linear, placement: "everywhere" }), white()));
    assert.ok(!same(applyGrain(black(), { ...linear, placement: "everywhere" }), black()));
  });

  test("highlights weighting leaves pure white unchanged", () => {
    // Two things hold a white frame still, and the fixed point test below
    // separates them: the mask admits it, because white is the definition of a
    // highlight, and the default soft light blend returns 255 whatever the
    // grain is. So a highlight setting never speckles a blown highlight.
    assert.ok(same(applyGrain(white(), { ...settings, placement: "highlights" }), white()));
  });

  test("shadows weighting leaves pure black unchanged", () => {
    // The same pair of reasons, mirrored.
    assert.ok(same(applyGrain(black(), { ...settings, placement: "shadows" }), black()));
  });

  test("a mid tone is neither a highlight nor a shadow", () => {
    // 128 is 0.5, and the cuts are at 0.7 and 0.3, so both masks skip it and
    // copy it through untouched rather than rounding a partial weight.
    const mid = flat();
    assert.ok(same(applyGrain(mid, { ...linear, placement: "highlights" }), mid));
    assert.ok(same(applyGrain(mid, { ...linear, placement: "shadows" }), mid));
  });

  test("a mask copies the tone it excludes through untouched", () => {
    // The mask half of the pair of guarantees above, with the linear mode so
    // the blend cannot be what is holding the frame still. Together with the
    // two fixed point tests this covers a clipped tone twice: once as the tone
    // a mask leaves out, and once as the tone the blend will not move.
    assert.ok(same(applyGrain(black(), { ...linear, placement: "highlights" }), black()));
    assert.ok(same(applyGrain(white(), { ...linear, placement: "shadows" }), white()));
  });

  test("a clipped channel is a fixed point of the blend modes", () => {
    // This is what actually protects the clips, and it is pinned separately
    // from the mask: soft light and overlay return 0 and 255 whatever the grain
    // is, so a clipped channel cannot move in either direction. Only the
    // linear mode can take one off its stop, because only it sums.
    for (const blendMode of ["overlay", "soft-light"]) {
      assert.ok(same(applyGrain(white(), { ...settings, blendMode }), white()), `${blendMode} moved white`);
      assert.ok(same(applyGrain(black(), { ...settings, blendMode }), black()), `${blendMode} moved black`);
    }
    assert.ok(!same(applyGrain(white(), { ...settings, blendMode: "add" }), white()));
  });
});

describe("applyGrain: noise modes", () => {
  const frame = () => makeFrame(() => 140);
  const settings = { strength: 100, grainSize: 1, blendMode: "add", blend: 100, seed: 33 };

  test("uniform moves all three channels by the same amount, so grain stays grey", () => {
    // A flat mid grey frame, because the claim is about the offsets and a
    // channel sitting against 0 or 255 clamps, which would make two equal
    // offsets come out as two different movements. Same offset on every
    // channel, not the same value: grain cannot push a pixel off the grey axis.
    const source = flatFrame(128, 128, 128);
    const out = applyGrain(source, { ...settings, noiseType: "uniform" });
    for (let i = 0; i < out.data.length; i += 4) {
      const dr = out.data[i] - source.data[i];
      const dg = out.data[i + 1] - source.data[i + 1];
      const db = out.data[i + 2] - source.data[i + 2];
      assert.equal(dr, dg);
      assert.equal(dg, db);
    }
  });

  test("luminance leaves red and blue exactly where they were", () => {
    const source = frame();
    const out = applyGrain(source, { ...settings, noiseType: "luminance" });
    for (let i = 0; i < out.data.length; i += 4) {
      assert.equal(out.data[i], source.data[i]);
      assert.equal(out.data[i + 2], source.data[i + 2]);
    }
  });

  test("luminance moves green, so it is not a no-op", () => {
    const source = frame();
    const out = applyGrain(source, { ...settings, noiseType: "luminance" });
    let moved = 0;
    for (let i = 1; i < out.data.length; i += 4) {
      if (out.data[i] !== source.data[i]) moved += 1;
    }
    assert.ok(moved > (W * H) * 0.9, `only ${moved} of ${W * H} green channels moved`);
  });

  test("color moves each channel on its own", () => {
    const out = applyGrain(frame(), { ...settings, noiseType: "color" });
    let differing = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i] !== out.data[i + 1]) differing += 1;
    }
    assert.ok(differing > (W * H) / 2, `only ${differing} of ${W * H} pixels went off grey`);
  });
});

describe("applyGrain: grain size", () => {
  test("a size of one gives a fresh cell per pixel", () => {
    const frame = makeFrame(() => 128);
    const out = applyGrain(frame, { noiseType: "uniform", strength: 100, grainSize: 1, shape: "random", blendMode: "add", blend: 100, seed: 15 });
    let differing = 0;
    for (let i = 4; i < out.data.length; i += 4) {
      if (out.data[i] !== out.data[i - 4]) differing += 1;
    }
    assert.ok(differing > (W * H) * 0.9, `neighbouring pixels matched ${W * H - differing} times`);
  });

  test("square cells are flat inside a block and differ between blocks", () => {
    const frame = makeFrame(() => 128);
    const cell = 4;
    const out = applyGrain(frame, { noiseType: "uniform", strength: 100, grainSize: cell, shape: "square", blendMode: "add", blend: 100, seed: 15 });
    const at = (x, y) => out.data[(y * W + x) * 4];
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [3, 3]]) {
      assert.equal(at(x, y), at(0, 0), `cell was not flat at ${x},${y}`);
    }
    assert.notEqual(at(cell, 0), at(0, 0));
  });

  test("a cell of eight stays on its grid", () => {
    // The grid has to be exact or the blocks drift and the grain looks
    // stretched: the whole of 0..7 is one cell, the whole of 8..15 is the
    // next, and the row index is divided the same way as the column.
    const frame = makeFrame(() => 128);
    const cell = 8;
    const out = applyGrain(frame, { noiseType: "uniform", strength: 100, grainSize: cell, shape: "square", blendMode: "add", blend: 100, seed: 15 });
    const at = (x, y) => out.data[(y * W + x) * 4];
    assert.equal(at(0, 0), at(7, 7));
    assert.equal(at(cell, 0), at(cell * 2 - 1, cell - 1));
    assert.notEqual(at(0, 0), at(cell, 0));
  });
});
