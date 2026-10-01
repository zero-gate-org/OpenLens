import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ABERRATION_DEFAULTS,
  ABERRATION_MODES,
  OFFSET_LIMIT,
  OFFSET_RANGE,
  STRENGTH_RANGE,
  applyAberration,
  clampIntensity,
  clampOffset,
  clampStrength,
  isIdentity,
  normalizeOptions,
  radialScale,
  samplePixel,
} from "../src/lib/core/aberration.js";

// Small frames on purpose: these tests are about the arithmetic and about the
// edge rule, and a big one would only make the suite slower and use more memory
// for no extra signal.
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

/**
 * A frame whose red channel is its column and whose blue channel is its row.
 *
 * With both dimensions at most 256 every pixel carries its own position, so the
 * coordinate a channel was sampled from is recoverable from the output alone.
 * That is what turns the edge rule from a claim into something a test can read
 * back.
 */
function axialProbe(w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x;
      data[i + 1] = 255;
      data[i + 2] = y;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/**
 * The same, with green carrying the column instead of red.
 *
 * A radial pass holds red in place and moves green and blue, so the column has
 * to be readable out of green for the radial tests to say anything.
 */
function radialProbe(w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 0;
      data[i + 1] = x;
      data[i + 2] = y;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Every byte of a frame is a byte, so every byte is in 0..255. */
function assertInRange(frame) {
  assert.equal(frame.data.length, frame.width * frame.height * 4);
  for (let i = 0; i < frame.data.length; i++) {
    const v = frame.data[i];
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `byte ${i} is ${v}`);
  }
}

/** Byte for byte the same, which is a stronger claim than deep equality. */
function assertIdentical(out, frame) {
  assert.equal(out.data.length, frame.data.length);
  for (let i = 0; i < frame.data.length; i++) {
    assert.equal(out.data[i], frame.data[i], `byte ${i}: ${out.data[i]} != ${frame.data[i]}`);
  }
}

const NOTHING = { offsetRX: 0, offsetRY: 0, offsetBX: 0, offsetBY: 0 };

describe("clampOffset / clampStrength / clampIntensity", () => {
  test("hold a value inside the tool's range", () => {
    assert.equal(clampOffset(7), 7);
    assert.equal(clampOffset(-7), -7);
    assert.equal(clampOffset(1e9), OFFSET_LIMIT);
    assert.equal(clampOffset(-1e9), -OFFSET_LIMIT);
    assert.equal(clampStrength(1e9), STRENGTH_RANGE.max);
    assert.equal(clampStrength(-1e9), STRENGTH_RANGE.min);
    assert.equal(clampIntensity(4), 1);
    assert.equal(clampIntensity(-4), 0);
    assert.equal(clampIntensity(0.25), 0.25);
  });

  test("round an offset to whole pixels", () => {
    assert.equal(clampOffset(2.4), 2);
    assert.equal(clampOffset(-2.4), -2);
  });

  test("turn anything unreadable into a neutral value", () => {
    // A non-finite setting is a neutral one, not an extreme one. Only a finite
    // number is worth clamping to a limit.
    assert.equal(clampOffset(NaN), 0);
    assert.equal(clampOffset(Infinity), 0);
    assert.equal(clampOffset(-Infinity), 0);
    assert.equal(clampOffset(undefined), 0);
    assert.equal(clampOffset("nonsense"), 0);
    assert.equal(clampStrength(NaN), 0);
    assert.equal(clampStrength(Infinity), 0);
    assert.equal(clampIntensity(NaN), 1);
    assert.equal(clampIntensity(Infinity), 1);
  });
});

describe("normalizeOptions", () => {
  test("fills in the defaults", () => {
    assert.deepEqual(normalizeOptions(), {
      mode: "axial",
      strength: ABERRATION_DEFAULTS.strength,
      offsetRX: ABERRATION_DEFAULTS.offsetRX,
      offsetRY: ABERRATION_DEFAULTS.offsetRY,
      offsetBX: ABERRATION_DEFAULTS.offsetBX,
      offsetBY: ABERRATION_DEFAULTS.offsetBY,
      intensity: ABERRATION_DEFAULTS.intensity,
    });
  });

  test("an unreadable mode falls back rather than throwing", () => {
    assert.equal(normalizeOptions({ mode: "sideways" }).mode, "axial");
    assert.equal(normalizeOptions({ mode: "radial" }).mode, "radial");
  });

  test("keeps the strength of a radial pass and the offsets of an axial one", () => {
    const o = normalizeOptions({ mode: "radial", strength: 80, offsetRX: 12 });
    assert.equal(o.strength, 80);
    assert.equal(o.offsetRX, 12);
  });
});

describe("isIdentity", () => {
  test("all offsets at zero is the identity", () => {
    assert.equal(isIdentity({ mode: "axial", ...NOTHING, intensity: 1 }), true);
  });

  test("a radial pass with no strength is the identity", () => {
    assert.equal(isIdentity({ mode: "radial", strength: 0, intensity: 1 }), true);
  });

  test("zero intensity is the identity whatever else is set", () => {
    assert.equal(isIdentity({ mode: "axial", offsetRX: -20, offsetBX: 20, intensity: 0 }), true);
    assert.equal(isIdentity({ mode: "radial", strength: 100, intensity: 0 }), true);
  });

  test("any real shift is not the identity", () => {
    assert.equal(isIdentity({ mode: "axial", offsetRX: -1, intensity: 1 }), false);
    assert.equal(isIdentity({ mode: "radial", strength: 1, intensity: 1 }), false);
  });
});

describe("radialScale", () => {
  test("is 1 at zero strength, so a radial pass cannot move", () => {
    for (const channel of [0, 1, 2]) assert.equal(radialScale(0, channel), 1);
  });

  test("never shrinks a channel, and pushes blue further than green", () => {
    assert.ok(radialScale(100, 1) > 1);
    assert.ok(radialScale(100, 2) > radialScale(100, 1));
    assert.equal(radialScale(100, 0), 1);
    for (const strength of [-5, 0, 1, 50, 100, 5000]) {
      for (const channel of [0, 1, 2]) {
        assert.ok(radialScale(strength, channel) >= 1, `channel ${channel} shrank`);
      }
    }
  });
});

describe("samplePixel: the edge rule", () => {
  test("clamps a sample outside the frame to the nearest edge pixel", () => {
    assert.equal(samplePixel(-1, 0, W, H), 0);
    assert.equal(samplePixel(0, -1, W, H), 0);
    assert.equal(samplePixel(W, 0, W, H), W - 1);
    assert.equal(samplePixel(0, H, W, H), W * (H - 1));
    assert.equal(samplePixel(W + 500, H + 500, W, H), W * H - 1);
    assert.equal(samplePixel(W + 500, -500, W, H), W - 1);
    assert.equal(samplePixel(-500, H + 500, W, H), W * (H - 1));
    assert.equal(samplePixel(-500, -500, W, H), 0);
  });

  test("leaves a sample already inside the frame alone", () => {
    assert.equal(samplePixel(0, 0, W, H), 0);
    assert.equal(samplePixel(1, 1, W, H), W + 1);
    assert.equal(samplePixel(W - 1, H - 1, W, H), W * H - 1);
  });

  test("rounds the sample point to the nearest pixel", () => {
    assert.equal(samplePixel(10.4, 0, W, H), 10);
    assert.equal(samplePixel(10.6, 0, W, H), 11);
    assert.equal(samplePixel(-0.4, 0, W, H), 0);
    assert.equal(samplePixel(-0.6, 0, W, H), 0);
    assert.equal(samplePixel(0, 10.6, W, H), 11 * W);
  });

  test("no coordinate at a maximum offset reads outside the buffer", () => {
    const frame = axialProbe();
    let reads = 0;

    // A set of coordinates chosen to cover the frame, its border by one, and
    // distances far past it. Every one of them has to land on a real byte.
    const distances = [-1e9, -1e6, -OFFSET_LIMIT - 1, -OFFSET_LIMIT, -1, 0, 1, OFFSET_LIMIT,
      OFFSET_LIMIT + 1, 1e6, 1e9];
    for (const dx of distances) {
      for (const dy of distances) {
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const index = samplePixel(x + dx, y + dy, W, H);
            assert.ok(index >= 0 && index < W * H, `index ${index} out of frame at ${x},${y}`);
            for (let channel = 0; channel < 4; channel++) {
              const byte = index * 4 + channel;
              assert.ok(byte >= 0 && byte < frame.data.length, `byte ${byte} out of buffer`);
              reads += 1;
            }
          }
        }
      }
    }

    assert.equal(reads, distances.length * distances.length * W * H * 4);
  });

  test("non-finite coordinates cannot escape the frame", () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, "nonsense", {}]) {
      const index = samplePixel(bad, bad, W, H);
      assert.ok(index >= 0 && index < W * H, `${String(bad)} gave ${index}`);
      assert.equal(index, 0);
    }
  });

  test("an empty frame has no pixel to sample", () => {
    assert.equal(samplePixel(0, 0, 0, 0), 0);
    assert.equal(samplePixel(5, 5, 0, H), 0);
    assert.equal(samplePixel(5, 5, W, 0), 0);
  });
});

describe("applyAberration: identity", () => {
  test("all offsets at zero returns the input byte-identically", () => {
    const frame = axialProbe();
    const out = applyAberration(frame, { mode: "axial", ...NOTHING, intensity: 1 });
    assert.equal(out.width, W);
    assert.equal(out.height, H);
    assertIdentical(out, frame);
  });

  test("the identity holds at a maximum offset of zero and at full intensity", () => {
    const frame = flatFrame(12, 200, 77);
    assertIdentical(
      applyAberration(frame, { mode: "axial", ...NOTHING, intensity: 1 }),
      frame,
    );
  });

  test("a radial pass at zero strength returns the input byte-identically", () => {
    const frame = radialProbe();
    assertIdentical(applyAberration(frame, { mode: "radial", strength: 0, intensity: 1 }), frame);
  });

  test("zero intensity returns the input byte-identically whatever is set", () => {
    const frame = axialProbe();
    assertIdentical(
      applyAberration(frame, {
        mode: "axial",
        offsetRX: -OFFSET_LIMIT,
        offsetRY: OFFSET_LIMIT,
        offsetBX: OFFSET_LIMIT,
        offsetBY: -OFFSET_LIMIT,
        intensity: 0,
      }),
      frame,
    );
    assertIdentical(
      applyAberration(frame, { mode: "radial", strength: 100, intensity: 0 }),
      frame,
    );
  });

  test("the pass never writes into the buffer it was handed", () => {
    const frame = axialProbe();
    const before = Uint8ClampedArray.from(frame.data);
    applyAberration(frame, { mode: "axial", offsetRX: 7, offsetBX: -7, intensity: 1 });
    assertIdentical({ width: W, height: H, data: before }, frame);
  });
});

describe("applyAberration: channels and alpha", () => {
  test("every output channel stays within 0..255", () => {
    const frames = [axialProbe(), radialProbe(), flatFrame(0, 0, 0), flatFrame(255, 255, 255, 128)];
    const settings = [
      { mode: "axial", offsetRX: OFFSET_LIMIT, offsetRY: -OFFSET_LIMIT, offsetBX: -OFFSET_LIMIT, offsetBY: OFFSET_LIMIT },
      { mode: "axial", offsetRX: -OFFSET_LIMIT, offsetRY: 0, offsetBX: OFFSET_LIMIT, offsetBY: 0 },
      { mode: "radial", strength: 100 },
      { mode: "radial", strength: 50 },
      { mode: "axial", offsetRX: 3, offsetBY: -2, intensity: 0.5 },
    ];
    for (const frame of frames) {
      for (const options of settings) {
        assertInRange(applyAberration(frame, { ...options, intensity: options.intensity ?? 1 }));
      }
    }
  });

  test("output alpha is preserved exactly", () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = i % 256;
      data[i * 4 + 1] = (i * 7) % 256;
      data[i * 4 + 2] = (i * 13) % 256;
      data[i * 4 + 3] = [0, 1, 64, 128, 200, 255][i % 6];
    }
    const frame = { width: W, height: H, data };

    for (const options of [
      { mode: "axial", offsetRX: -OFFSET_LIMIT, offsetRY: 3, offsetBX: OFFSET_LIMIT, offsetBY: -3 },
      { mode: "radial", strength: 100 },
      { mode: "axial", offsetRX: 5, offsetBX: -5, intensity: 0.25 },
    ]) {
      const out = applyAberration(frame, { ...options, intensity: options.intensity ?? 1 });
      for (let p = 0; p < W * H; p++) {
        assert.equal(
          out.data[p * 4 + 3],
          data[p * 4 + 3],
          `alpha moved at pixel ${p}`,
        );
      }
    }
  });

  test("a fully transparent pixel keeps its transparency", () => {
    const frame = flatFrame(255, 255, 255, 0);
    const out = applyAberration(frame, { mode: "radial", strength: 100 });
    for (let p = 0; p < W * H; p++) assert.equal(out.data[p * 4 + 3], 0);
  });

  test("green is never sampled in an axial pass", () => {
    const frame = axialProbe();
    const out = applyAberration(frame, {
      mode: "axial",
      offsetRX: -OFFSET_LIMIT,
      offsetRY: OFFSET_LIMIT,
      offsetBX: OFFSET_LIMIT,
      offsetBY: -OFFSET_LIMIT,
      intensity: 1,
    });
    for (let p = 0; p < W * H; p++) assert.equal(out.data[p * 4 + 1], 255);
  });

  test("red is never sampled in a radial pass", () => {
    const frame = radialProbe();
    const out = applyAberration(frame, { mode: "radial", strength: 100, intensity: 1 });
    for (let p = 0; p < W * H; p++) assert.equal(out.data[p * 4], 0);
  });
});

describe("applyAberration: edge sampling", () => {
  test("an axial shift at the maximum offset clamps to the edge it points at", () => {
    const frame = axialProbe();
    const out = applyAberration(frame, {
      mode: "axial",
      offsetRX: OFFSET_LIMIT,
      offsetRY: 0,
      offsetBX: 0,
      offsetBY: 0,
      intensity: 1,
    });

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        // Red came from column min(W - 1, x + 20) of the same row, and every
        // pixel of that column holds exactly that column number. A sample from
        // outside the frame could not produce a value in this range.
        assert.equal(
          out.data[i],
          Math.min(W - 1, x + OFFSET_LIMIT),
          `red at ${x},${y} is ${out.data[i]}`,
        );
        // Blue was left at zero offset, so it still reports its own row.
        assert.equal(out.data[i + 2], y);
      }
    }
  });

  test("a negative offset clamps to the opposite edge", () => {
    const frame = axialProbe();
    const out = applyAberration(frame, {
      mode: "axial",
      offsetRX: -OFFSET_LIMIT,
      offsetRY: 0,
      offsetBX: 0,
      offsetBY: 0,
      intensity: 1,
    });

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        assert.equal(out.data[(y * W + x) * 4], Math.max(0, x - OFFSET_LIMIT));
      }
    }
  });

  test("a vertical offset clamps the row it points away from", () => {
    const frame = axialProbe();
    const out = applyAberration(frame, {
      mode: "axial",
      offsetRX: 0,
      offsetRY: 0,
      offsetBX: 0,
      offsetBY: OFFSET_LIMIT,
      intensity: 1,
    });

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        assert.equal(out.data[(y * W + x) * 4 + 2], Math.min(H - 1, y + OFFSET_LIMIT));
      }
    }
  });

  test("a radial pass at the maximum strength samples only inside the frame", () => {
    const w = W;
    const h = H;
    const frame = radialProbe(w, h);
    const out = applyAberration(frame, { mode: "radial", strength: 100, intensity: 1 });

    const cx = w * 0.5;
    const cy = h * 0.5;
    const scaleG = radialScale(100, 1);
    const scaleB = radialScale(100, 2);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Green reports the column it was sampled from, blue the row.
        assert.equal(
          out.data[i + 1],
          clampInt(Math.round(cx + (x - cx) * scaleG), w),
          `green at ${x},${y} is ${out.data[i + 1]}`,
        );
        assert.equal(
          out.data[i + 2],
          clampInt(Math.round(cy + (y - cy) * scaleB), h),
          `blue at ${x},${y} is ${out.data[i + 2]}`,
        );
        assert.ok(out.data[i + 1] >= 0 && out.data[i + 1] < w);
        assert.ok(out.data[i + 2] >= 0 && out.data[i + 2] < h);
      }
    }
  });

  test("a radial pass at the maximum strength leaves the centre alone", () => {
    // A scale about the centre is the identity at the centre, which is the
    // property that keeps the middle of the picture clean. An odd sized frame
    // has a pixel exactly on the centre, so that one pixel can be checked.
    const odd = 65;
    const frame = radialProbe(odd, odd);
    const out = applyAberration(frame, { mode: "radial", strength: 100, intensity: 1 });
    const centre = (odd - 1) / 2;
    const i = (centre * odd + centre) * 4;
    assert.equal(out.data[i + 1], centre);
    assert.equal(out.data[i + 2], centre);
  });

  test("intensity mixes a clamped sample with the pixel, never with nothing", () => {
    const frame = axialProbe();
    const out = applyAberration(frame, {
      mode: "axial",
      offsetRX: OFFSET_LIMIT,
      offsetRY: 0,
      offsetBX: 0,
      offsetBY: 0,
      intensity: 0.5,
    });
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const expected = Math.round(x + 0.5 * (Math.min(W - 1, x + OFFSET_LIMIT) - x));
        assert.equal(out.data[(y * W + x) * 4], expected);
      }
    }
  });
});

describe("applyAberration: degenerate frames", () => {
  test("a one by one frame is safe", () => {
    const frame = flatFrame(10, 20, 30, 128, 1, 1);
    for (const options of [
      { mode: "axial", offsetRX: OFFSET_LIMIT, offsetRY: -OFFSET_LIMIT, offsetBX: OFFSET_LIMIT, offsetBY: -OFFSET_LIMIT, intensity: 1 },
      { mode: "radial", strength: 100, intensity: 1 },
    ]) {
      const out = applyAberration(frame, options);
      assert.equal(out.width, 1);
      assert.equal(out.height, 1);
      assert.deepEqual([...out.data], [10, 20, 30, 128]);
    }
  });

  test("a one pixel wide frame is safe", () => {
    const frame = flatFrame(10, 20, 30, 128, 1, H);
    for (const options of [
      { mode: "axial", offsetRX: OFFSET_LIMIT, offsetRY: -OFFSET_LIMIT, offsetBX: -OFFSET_LIMIT, offsetBY: OFFSET_LIMIT, intensity: 1 },
      { mode: "radial", strength: 100, intensity: 1 },
    ]) {
      const out = applyAberration(frame, options);
      assert.equal(out.width, 1);
      assert.equal(out.height, H);
      assertInRange(out);
      for (let p = 0; p < H; p++) {
        assert.equal(out.data[p * 4 + 1], 20);
        assert.equal(out.data[p * 4 + 3], 128);
      }
    }
  });

  test("a one pixel tall frame is safe", () => {
    const frame = flatFrame(10, 20, 30, 128, W, 1);
    for (const options of [
      { mode: "axial", offsetRX: OFFSET_LIMIT, offsetRY: OFFSET_LIMIT, offsetBX: -OFFSET_LIMIT, offsetBY: -OFFSET_LIMIT, intensity: 1 },
      { mode: "radial", strength: 100, intensity: 1 },
    ]) {
      const out = applyAberration(frame, options);
      assert.equal(out.width, W);
      assert.equal(out.height, 1);
      assertInRange(out);
      for (let p = 0; p < W; p++) {
        assert.equal(out.data[p * 4 + 1], 20);
        assert.equal(out.data[p * 4 + 3], 128);
      }
    }
  });

  test("a single channel row and column reports its own position, still in frame", () => {
    const column = radialProbe(1, 32);
    const out = applyAberration(column, { mode: "radial", strength: 100, intensity: 1 });
    for (let y = 0; y < 32; y++) {
      const value = out.data[y * 4 + 2];
      assert.ok(value >= 0 && value < 32, `row ${y} sampled to ${value}`);
    }

    const row = radialProbe(32, 1);
    const outRow = applyAberration(row, { mode: "radial", strength: 100, intensity: 1 });
    for (let x = 0; x < 32; x++) {
      const value = outRow.data[x * 4 + 1];
      assert.ok(value >= 0 && value < 32, `column ${x} sampled to ${value}`);
    }
  });

  test("a two by two frame is safe", () => {
    const frame = axialProbe(2, 2);
    for (const options of [
      { mode: "axial", offsetRX: OFFSET_LIMIT, offsetRY: OFFSET_LIMIT, intensity: 1 },
      { mode: "radial", strength: 100, intensity: 1 },
    ]) {
      assertInRange(applyAberration(frame, options));
    }
  });

  test("an empty frame gives an empty frame rather than throwing", () => {
    const empty = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    assert.deepEqual(applyAberration(empty, { mode: "radial", strength: 100 }), {
      width: 0,
      height: 0,
      data: new Uint8ClampedArray(0),
    });

    const noHeight = { width: W, height: 0, data: new Uint8ClampedArray(0) };
    assert.equal(applyAberration(noHeight).data.length, 0);
  });

  test("a buffer shorter than its own frame gives the whole rows that fit", () => {
    const data = new Uint8ClampedArray(W * 2 * 4);
    const out = applyAberration({ width: W, height: H, data }, { mode: "radial", strength: 100 });
    assert.equal(out.width, W);
    assert.equal(out.height, 2);
    assertInRange(out);
  });

  test("a missing frame gives an empty frame rather than throwing", () => {
    assert.equal(applyAberration(undefined).data.length, 0);
    assert.equal(applyAberration(null).data.length, 0);
    assert.equal(applyAberration({}).data.length, 0);
  });
});

describe("applyAberration: oversized offsets", () => {
  test("an absurd offset is held at the tool's limit and never reads past the frame", () => {
    const frame = axialProbe();
    const out = applyAberration(frame, {
      mode: "axial",
      offsetRX: 1e9,
      offsetRY: -1e9,
      offsetBX: Number.MAX_SAFE_INTEGER,
      offsetBY: -Number.MAX_SAFE_INTEGER,
      intensity: 1,
    });

    assertInRange(out);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        // Every absurd offset saturated to the tool's limit, so red ran 20
        // columns right and blue 20 rows up, and both stopped at the edge.
        assert.equal(out.data[i], Math.min(W - 1, x + OFFSET_LIMIT));
        assert.equal(out.data[i + 2], Math.max(0, y - OFFSET_LIMIT));
      }
    }
  });

  test("a coordinate past the frame lands on the edge pixel, not past the buffer", () => {
    const frame = axialProbe();
    // `samplePixel` takes any number at all, so a caller that bypasses the
    // settings clamp still cannot read outside the buffer.
    assert.equal(samplePixel(1e9, 1e9, frame.width, frame.height), frame.data.length / 4 - 1);
    assert.equal(samplePixel(-1e9, -1e9, frame.width, frame.height), 0);
    const out = applyAberration(frame, {
      mode: "axial",
      offsetRX: 0,
      offsetRY: 0,
      offsetBX: 0,
      offsetBY: 0,
      intensity: 1,
    });
    assertInRange(out);
  });

  test("an infinite or unreadable offset cannot produce a channel outside 0..255", () => {
    const frame = axialProbe();
    for (const bad of [Infinity, -Infinity, NaN, undefined, null, "left"]) {
      const out = applyAberration(frame, {
        mode: "axial",
        offsetRX: bad,
        offsetRY: bad,
        offsetBX: bad,
        offsetBY: bad,
        intensity: 1,
      });
      assertInRange(out);
    }
  });

  test("an absurd strength is held at the slider's limit", () => {
    const frame = radialProbe();
    const wild = applyAberration(frame, { mode: "radial", strength: 1e9, intensity: 1 });
    const max = applyAberration(frame, { mode: "radial", strength: 100, intensity: 1 });
    assertIdentical(wild, max);
  });
});

describe("ABERRATION_MODES / ranges", () => {
  test("offers the two styles the panel can be in", () => {
    assert.deepEqual(
      ABERRATION_MODES.map((mode) => mode.value),
      ["axial", "radial"],
    );
  });

  test("the offset range is the slider range", () => {
    assert.equal(OFFSET_RANGE.min, -OFFSET_LIMIT);
    assert.equal(OFFSET_RANGE.max, OFFSET_LIMIT);
    assert.equal(STRENGTH_RANGE.min, 0);
    assert.equal(STRENGTH_RANGE.max, 100);
  });
});

/** The clamp the edge rule applies, written out for the test to read against. */
function clampInt(value, limit) {
  if (!(value > 0)) return 0;
  return value > limit - 1 ? limit - 1 : value;
}