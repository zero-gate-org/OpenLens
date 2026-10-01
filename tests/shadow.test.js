import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BLUR_RANGE,
  DIRECTIONS,
  NO_SUBJECT_MASS,
  OFFSET_LIMIT,
  OFFSET_RANGE,
  OPACITY_RANGE,
  SHADOW_DEFAULTS,
  buildShadow,
  clampOffset,
  compositeShadow,
  depthFactor,
  effectiveOffset,
  fitOffset,
  hasSubject,
  isShadowIdentity,
  normalizeShadowOptions,
  offsetMask,
  offsetRoom,
  sampleMask,
  shadowKey,
  shadowOutsideShare,
  subjectBounds,
  subjectMass,
} from "../src/lib/core/shadow.js";

// Small frames on purpose. These tests are about the arithmetic, the edge rule
// and the degenerate cases, and a big one would only make the suite slower and
// use more memory for no extra signal. The largest here is 256x256.
const W = 64;
const H = 64;

/** Every byte of a frame is a byte, so every byte is in 0..255. */
function assertBytes(frame) {
  for (let i = 0; i < frame.data.length; i++) {
    assert.ok(Number.isInteger(frame.data[i]), `byte ${i} is not an integer`);
    assert.ok(frame.data[i] >= 0 && frame.data[i] <= 255, `byte ${i} is ${frame.data[i]}`);
  }
}

/** Byte-for-byte the same buffer. */
function assertIdentical(out, frame, note = "") {
  assert.equal(out.width, frame.width, `width ${note}`);
  assert.equal(out.height, frame.height, `height ${note}`);
  assert.equal(out.data.length, frame.data.length, `length ${note}`);
  for (let i = 0; i < frame.data.length; i++) {
    assert.equal(out.data[i], frame.data[i], `byte ${i} ${note}`);
  }
}

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

/** A frame whose red channel is its column and whose blue channel is its row. */
function probeFrame(w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x;
      data[i + 1] = 255 - x;
      data[i + 2] = y;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** The foreground mask of a filled rectangle, as alpha only. */
function rectMask(x0, y0, x1, y1, alpha = 255, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      data[(y * w + x) * 4 + 3] = inside ? alpha : 0;
    }
  }
  return { width: w, height: h, data };
}

/** Settings that describe nothing at all. */
const NOTHING = { offsetX: 0, offsetY: 0, blur: 0, opacity: 0, depth: 0 };

// ---------------------------------------------------------------

describe("normalizeShadowOptions", () => {
  test("fills in the legacy defaults", () => {
    assert.deepEqual(normalizeShadowOptions({}), SHADOW_DEFAULTS);
  });

  test("keeps the legacy default range: 10px across and down, 15px blur, 60%", () => {
    assert.equal(SHADOW_DEFAULTS.offsetX, 10);
    assert.equal(SHADOW_DEFAULTS.offsetY, 10);
    assert.equal(SHADOW_DEFAULTS.blur, 15);
    assert.equal(SHADOW_DEFAULTS.opacity, 60);
    // The legacy hard-coded dark factor was 0.15, so a depth of 85 renders
    // exactly what the old panel rendered.
    assert.ok(Math.abs(depthFactor(SHADOW_DEFAULTS.depth) - 0.15) < 1e-9);
  });

  test("rounds and holds every setting inside its range", () => {
    assert.equal(clampOffset(2.4), 2);
    assert.equal(clampOffset(-2.6), -3);
    assert.equal(clampOffset(1e9), OFFSET_LIMIT);
    assert.equal(clampOffset(-1e9), -OFFSET_LIMIT);
    assert.equal(clampOffset("nonsense"), 0);

    const o = normalizeShadowOptions({
      offsetX: 1e9,
      offsetY: -1e9,
      blur: -5,
      opacity: 900,
      depth: -900,
    });
    assert.equal(o.offsetX, OFFSET_LIMIT);
    assert.equal(o.offsetY, -OFFSET_LIMIT);
    assert.equal(o.blur, BLUR_RANGE.min);
    assert.equal(o.opacity, OPACITY_RANGE.max);
    assert.equal(o.depth, 0);
  });

  test("NaN from a stale control cannot reach the loop", () => {
    const o = normalizeShadowOptions({ offsetX: NaN, offsetY: Infinity, blur: -Infinity });
    assert.ok(Number.isFinite(o.offsetX));
    assert.ok(Number.isFinite(o.offsetY));
    assert.ok(Number.isFinite(o.blur));
    assert.equal(o.blur, BLUR_RANGE.min);
  });

  test("the slider ranges match the clamps", () => {
    assert.equal(OFFSET_RANGE.min, -OFFSET_LIMIT);
    assert.equal(OFFSET_RANGE.max, OFFSET_LIMIT);
    assert.equal(OPACITY_RANGE.min, 0);
    assert.equal(OPACITY_RANGE.max, 100);
  });

  test("depth 0 leaves a pixel as it was and depth 100 blackens it", () => {
    assert.equal(depthFactor(0), 1);
    assert.equal(depthFactor(100), 0);
    assert.equal(depthFactor(50), 0.5);
    assert.equal(depthFactor("nonsense"), 1);
  });

  test("every direction preset is a unit step or nothing at all", () => {
    assert.deepEqual(DIRECTIONS.map((d) => d.value), ["left", "up", "right", "down", "none"]);
    for (const d of DIRECTIONS) {
      assert.ok(Math.abs(d.dx) <= 1 && Math.abs(d.dy) <= 1, `${d.value} is not a unit step`);
      if (d.value !== "none") {
        assert.equal(Math.hypot(d.dx, d.dy), 1, `${d.value} is not a direction`);
      }
    }
  });

  test("two settings with the same key are the same settings", () => {
    assert.equal(shadowKey({ offsetX: 4, blur: 9 }), shadowKey({ blur: 9, offsetX: 4 }));
    assert.notEqual(shadowKey({ offsetX: 4 }), shadowKey({ offsetX: 5 }));
    assert.notEqual(shadowKey({ offsetX: 4, keepInFrame: true }), shadowKey({ offsetX: 4 }));
  });
});

describe("isShadowIdentity", () => {
  test("no offset and no blur is the identity", () => {
    assert.equal(isShadowIdentity({ ...NOTHING, opacity: 100, depth: 100 }), true);
  });

  test("no opacity is the identity", () => {
    assert.equal(
      isShadowIdentity({ offsetX: 40, offsetY: -30, blur: 30, opacity: 0, depth: 100 }),
      true,
    );
  });

  test("no depth is the identity, because the shadow matches what is behind it", () => {
    assert.equal(
      isShadowIdentity({ offsetX: 40, offsetY: -30, blur: 30, opacity: 100, depth: 0 }),
      true,
    );
  });

  test("a real offset, a real blur or a real depth is not the identity", () => {
    assert.equal(isShadowIdentity({ offsetX: 1, offsetY: 0, blur: 0, opacity: 100, depth: 100 }), false);
    assert.equal(isShadowIdentity({ offsetX: 0, offsetY: 0, blur: 1, opacity: 100, depth: 100 }), false);
    assert.equal(isShadowIdentity({ offsetX: 1, offsetY: 0, blur: 1, opacity: 100, depth: 100 }), false);
  });
});

describe("sampleMask: the edge rule", () => {
  test("reads the alpha of a point inside the frame", () => {
    const mask = rectMask(10, 10, 20, 20, 128);
    assert.equal(sampleMask(mask, 15, 15), 128);
    assert.equal(sampleMask(mask, 0, 0), 0);
    assert.equal(sampleMask(mask, 10, 20), 128);
  });

  test("outside the frame is empty, not the border and not the far side", () => {
    const mask = rectMask(0, 0, W - 1, H - 1, 255);
    assert.equal(sampleMask(mask, -1, 0), 0);
    assert.equal(sampleMask(mask, 0, -1), 0);
    assert.equal(sampleMask(mask, W, 0), 0);
    assert.equal(sampleMask(mask, 0, H), 0);
    assert.equal(sampleMask(mask, 1e9, 1e9), 0);
    assert.equal(sampleMask(mask, -1e9, -1e9), 0);
  });

  test("a non-finite point is empty rather than a read past the buffer", () => {
    const mask = rectMask(0, 0, W - 1, H - 1, 255);
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, "nonsense", {}]) {
      assert.equal(sampleMask(mask, bad, bad), 0, `${String(bad)} read something`);
    }
    assert.equal(sampleMask(null, 3, 3), 0);
    assert.equal(sampleMask({ width: 0, height: 0, data: new Uint8ClampedArray(4) }, 0, 0), 0);
  });

  test("no offset at the slider limit reads outside the buffer", () => {
    const mask = rectMask(0, 0, W - 1, H - 1, 200, 256, 256);
    let reads = 0;

    // A set of coordinates that covers the frame, its border by one, and
    // distances far past it. Every one has to land on a real byte or on nothing.
    const distances = [-1e9, -OFFSET_LIMIT - 1, -OFFSET_LIMIT, -1, 0, 1, OFFSET_LIMIT,
      OFFSET_LIMIT + 1, 1e9];
    for (const dx of distances) {
      for (const dy of distances) {
        for (let y = 0; y < 256; y++) {
          for (let x = 0; x < 256; x++) {
            const value = sampleMask(mask, x + dx, y + dy);
            assert.ok(value >= 0 && value <= 255, `alpha ${value} at ${x},${y}`);
            // An empty sample is not a read, so the count is a lower bound.
            reads += value === 0 ? 0 : 1;
          }
        }
      }
    }

    assert.ok(reads > 0);
  });
});

describe("offsetMask", () => {
  test("moves the subject right and down by the offset", () => {
    const mask = rectMask(20, 20, 23, 23);
    const moved = offsetMask(mask, 5, 3);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const movedAlpha = moved.data[(y * W + x) * 4 + 3];
        const expected = x >= 25 && x <= 28 && y >= 23 && y <= 26 ? 255 : 0;
        assert.equal(movedAlpha, expected, `alpha at ${x},${y}`);
      }
    }
  });

  test("a zero offset is the shape it was given", () => {
    const mask = rectMask(10, 12, 14, 18, 137);
    const moved = offsetMask(mask, 0, 0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        assert.equal(
          moved.data[(y * W + x) * 4 + 3],
          mask.data[(y * W + x) * 4 + 3],
          `alpha at ${x},${y}`,
        );
      }
    }
  });

  test("the part pushed off the frame is gone, not folded back in", () => {
    // The offset clamp is 50 and the frame is 64 wide, so this subject can be
    // pushed most of the way out but not all of it. What matters is that
    // nothing arrives at the left edge: a clamped sample would stripe it and a
    // wrapped one would bring the subject back in.
    const mask = rectMask(0, 0, 19, 9);
    const moved = offsetMask(mask, OFFSET_LIMIT, 0);

    let lit = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const alpha = moved.data[(y * W + x) * 4 + 3];
        if (x < OFFSET_LIMIT) {
          assert.equal(alpha, 0, `a sample wrapped to ${x},${y}`);
        }
        if (alpha > 0) lit += 1;
      }
    }

    // 20 columns of subject, 6 of which walked off the right edge.
    assert.equal(lit, (W - OFFSET_LIMIT) * 10);
  });

  test("colour is left at zero, because only the alpha is ever read", () => {
    const colour = new Uint8ClampedArray([9, 8, 7, 255]);
    const mask = { width: 1, height: 1, data: colour };
    const moved = offsetMask(mask, 0, 0);
    assert.deepEqual([...moved.data], [0, 0, 0, 255]);
  });

  test("an empty frame costs nothing and reads nothing", () => {
    assert.deepEqual(offsetMask(null, 10, 10), { width: 0, height: 0, data: new Uint8ClampedArray(0) });
    const short = { width: 4, height: 4, data: new Uint8ClampedArray(16) };
    const moved = offsetMask(short, 1, 1);
    assert.equal(moved.width, 4);
    assert.equal(moved.height, 1);
  });
});

describe("compositeShadow", () => {
  test("darkens the background and leaves the subject alone", () => {
    const original = flatFrame(200, 200, 200);
    const mask = rectMask(30, 30, 33, 33);
    const shadow = rectMask(34, 34, 37, 37);

    const out = compositeShadow(original, mask, shadow, { opacity: 100, depth: 100 });

    // Where the shadow is, at depth 100, the background is black.
    assert.equal(out.data[(35 * W + 35) * 4], 0);
    // The subject is untouched.
    assert.equal(out.data[(31 * W + 31) * 4], 200);
    // And plain background is left plain.
    assert.equal(out.data[(10 * W + 10) * 4], 200);
  });

  test("a shadow under the subject is hidden by it", () => {
    const original = flatFrame(200, 200, 200);
    const mask = rectMask(30, 30, 33, 33);
    // The same rectangle, as the shadow.
    const shadow = rectMask(30, 30, 33, 33);

    const out = compositeShadow(original, mask, shadow, { opacity: 100, depth: 100 });
    assertIdentical(out, original, "with the shadow exactly behind the subject");
  });

  test("the subject's soft edge is not double counted, so no halo is left", () => {
    const original = flatFrame(200, 200, 200);
    // A subject whose every pixel is half opaque: the case a fractional
    // occlusion darkens, because the shadow sits under a half-subject pixel.
    const mask = rectMask(20, 20, 43, 43, 128);
    const shadow = offsetMask(mask, 0, 0);

    const out = compositeShadow(original, mask, shadow, { opacity: 100, depth: 100 });
    assertIdentical(out, original, "at a zero offset and zero blur");
  });

  test("opacity 0 leaves no halo whatever the shadow", () => {
    const original = flatFrame(120, 60, 200);
    const mask = rectMask(20, 20, 43, 43, 128);
    const shadow = rectMask(0, 0, W - 1, H - 1, 255);

    const out = compositeShadow(original, mask, shadow, { opacity: 0, depth: 100 });
    assertIdentical(out, original);
  });

  test("alpha is carried over untouched", () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 180;
      data[i + 1] = 90;
      data[i + 2] = 40;
      data[i + 3] = 77;
    }
    const original = { width: W, height: H, data };
    const out = compositeShadow(
      original,
      rectMask(0, 0, W - 1, H - 1, 0),
      rectMask(0, 0, W - 1, H - 1, 255),
      { opacity: 100, depth: 100 },
    );
    for (let p = 0; p < W * H; p++) assert.equal(out.data[p * 4 + 3], 77);
  });

  test("every channel stays inside 0..255 for settings no slider can make", () => {
    const original = flatFrame(255, 255, 255);
    const mask = rectMask(10, 10, 20, 20, 255);
    const shadow = rectMask(12, 12, 22, 22, 255);

    for (const options of [
      { opacity: 1e9, depth: 1e9 },
      { opacity: -1e9, depth: -1e9 },
      { opacity: NaN, depth: NaN },
      { opacity: Infinity, depth: -Infinity },
      { opacity: 50, depth: 50 },
    ]) {
      const out = compositeShadow(original, mask, shadow, options);
      assertBytes(out);
    }
  });

  test("a frame shorter than it claims only writes the rows it holds", () => {
    const original = flatFrame(200, 200, 200, 255, W, 8);
    const out = compositeShadow(original, original, original, { opacity: 100, depth: 100 });
    assert.equal(out.height, 8);
    assert.equal(out.data.length, 8 * W * 4);
  });
});

describe("the subject", () => {
  test("finds the extent of a rectangle", () => {
    assert.deepEqual(subjectBounds(rectMask(20, 10, 34, 25)), { x: 20, y: 10, w: 15, h: 16 });
  });

  test("an empty mask has no bounds and no subject", () => {
    assert.equal(subjectBounds(rectMask(0, 0, 0, 0, 0)), null);
    assert.equal(subjectMass(rectMask(0, 0, 0, 0, 0)), 0);
    assert.equal(hasSubject(rectMask(0, 0, 0, 0, 0)), false);
  });

  test("a mask with a single pixel in it is not a subject to cast from", () => {
    const mask = rectMask(32, 32, 32, 32);
    assert.ok(subjectMass(mask) < NO_SUBJECT_MASS);
    assert.equal(hasSubject(mask), false);
  });

  test("a real subject is a subject", () => {
    const mask = rectMask(20, 20, 43, 43);
    assert.ok(subjectMass(mask) > NO_SUBJECT_MASS);
    assert.equal(hasSubject(mask), true);
  });

  test("mass is measured, not guessed", () => {
    // Half the frame at half alpha is about a quarter of the frame.
    const mask = flatFrame(0, 0, 0, 128);
    assert.ok(Math.abs(subjectMass(mask) - 128 / 255) < 1e-9);
    assert.equal(hasSubject(flatFrame(0, 0, 0, 0)), false);
    // A quarter of the frame at full alpha is a quarter of the frame.
    assert.ok(Math.abs(subjectMass(rectMask(0, 0, 31, 31)) - 0.25) < 1e-9);
  });
});

describe("keeping the shadow in the frame", () => {
  const bounds = subjectBounds(rectMask(20, 20, 43, 43));

  test("the room is the subject's own extent inside the frame", () => {
    assert.deepEqual(offsetRoom(bounds, W, H), { minX: -20, maxX: W - 1 - 43, minY: -20, maxY: H - 1 - 43 });
  });

  test("a fitting offset comes back unchanged", () => {
    assert.deepEqual(fitOffset(10, 10, bounds, W, H), { x: 10, y: 10 });
    assert.deepEqual(fitOffset(-20, -20, bounds, W, H), { x: -20, y: -20 });
    assert.deepEqual(fitOffset(W - 1 - 43, H - 1 - 43, bounds, W, H), {
      x: W - 1 - 43,
      y: H - 1 - 43,
    });
  });

  test("an offset that would walk off the frame is held back to the edge", () => {
    assert.deepEqual(fitOffset(50, -50, bounds, W, H), { x: W - 1 - 43, y: -20 });
    assert.deepEqual(fitOffset(0, 999, bounds, W, H), { x: 0, y: H - 1 - 43 });
    assert.deepEqual(fitOffset(-999, 0, bounds, W, H), { x: -20, y: 0 });
  });

  test("every clamped offset really does keep the shadow inside", () => {
    for (const dx of [-100, -43, -1, 0, 1, 43, 100]) {
      for (const dy of [-100, -43, -1, 0, 1, 43, 100]) {
        const fitted = fitOffset(dx, dy, bounds, W, H);
        assert.ok(fitted.x >= -bounds.x, `x ${fitted.x} puts the shadow off the left`);
        assert.ok(fitted.x <= W - 1 - (bounds.x + bounds.w - 1), `x ${fitted.x} off the right`);
        assert.ok(fitted.y >= -bounds.y, `y ${fitted.y} off the top`);
        assert.ok(fitted.y <= H - 1 - (bounds.y + bounds.h - 1), `y ${fitted.y} off the bottom`);
      }
    }
  });

  test("a subject that fills the frame cannot move and still fit", () => {
    const full = subjectBounds(rectMask(0, 0, W - 1, H - 1));
    assert.deepEqual(fitOffset(30, 30, full, W, H), { x: 0, y: 0 });
  });

  test("the clamp only applies when it is asked for", () => {
    assert.deepEqual(effectiveOffset({ offsetX: 50, offsetY: 50, keepInFrame: false }, bounds, W, H), {
      x: 50,
      y: 50,
    });
    assert.deepEqual(effectiveOffset({ offsetX: 50, offsetY: 50, keepInFrame: true }, bounds, W, H), {
      x: W - 1 - 43,
      y: H - 1 - 43,
    });
    // With no mask yet there is nothing to fit against, so the offset stands.
    assert.deepEqual(effectiveOffset({ offsetX: 50, offsetY: 50, keepInFrame: true }, null, W, H), {
      x: 50,
      y: 50,
    });
  });

  test("the offset that is drawn is the one that fits", () => {
    const mask = rectMask(20, 20, 43, 43);
    const original = flatFrame(200, 200, 200);
    const drawn = effectiveOffset({ offsetX: 50, offsetY: 50, keepInFrame: true }, bounds, W, H);

    // The shadow at that offset has to be inside the frame, so nothing on the
    // right edge or the bottom edge can have been darkened by the subject.
    const out = compositeShadow(
      original,
      mask,
      offsetMask(mask, drawn.x, drawn.y),
      { opacity: 100, depth: 100 },
    );

    const right = (W - 1) * 4;
    assert.equal(out.data[(10 * W + (W - 1)) * 4], 200, "the right edge was darkened");
    assert.equal(out.data[right + H * 0], 200, "the right edge was darkened");
    assert.equal(out.data[(H - 1) * W * 4 + 4], 200, "the bottom edge was darkened");
  });

  test("an offset that cannot fit reports how much of it falls outside", () => {
    // A subject 24px wide, its room runs to +20, so a 30px offset puts a third
    // of it past the right edge.
    assert.equal(shadowOutsideShare({ offsetX: 30, offsetY: 0 }, bounds, W, H), 10 / 24);
    assert.equal(shadowOutsideShare({ offsetX: -30, offsetY: 0 }, bounds, W, H), 10 / 24);
    assert.equal(shadowOutsideShare({ offsetX: 0, offsetY: 30 }, bounds, W, H), 10 / 24);
    // A share is a share: a shadow can be entirely out, and no more than that.
    assert.equal(shadowOutsideShare({ offsetX: 50, offsetY: 50 }, bounds, W, H), 1);
    assert.equal(shadowOutsideShare({ offsetX: 1e6, offsetY: 1e6 }, bounds, W, H), 1);
  });

  test("a fitting offset reports nothing lost", () => {
    assert.equal(shadowOutsideShare({ offsetX: 10, offsetY: -10 }, bounds, W, H), 0);
    assert.equal(shadowOutsideShare({ offsetX: 50, offsetY: 50 }, bounds, W, H), 1);
    // Without a mask there is nothing to lose.
    assert.equal(shadowOutsideShare({ offsetX: 50, offsetY: 50 }, null, W, H), 0);
  });

  test("with no subject there is nothing to fit against, so the offset stands", () => {
    assert.deepEqual(fitOffset(40, -40, null, W, H), { x: 40, y: -40 });
    // Still inside the tool's own range, so a stale value cannot escape it.
    assert.deepEqual(fitOffset(1e6, -1e6, null, W, H), { x: OFFSET_LIMIT, y: -OFFSET_LIMIT });
    assert.deepEqual(fitOffset(0, 0, null, 0, 0), { x: 0, y: 0 });
  });
});

describe("buildShadow", () => {
  test("a zero offset and a zero blur is the identity", async () => {
    const original = probeFrame();
    const mask = rectMask(20, 20, 43, 43, 190);
    const out = await buildShadow(original, mask, {
      ...NOTHING,
      opacity: 100,
      depth: 100,
      offsetX: 0,
      offsetY: 0,
      blur: 0,
    });

    assertIdentical(out, original);
  });

  test("opacity 0 is the identity at the far end of every other setting", async () => {
    const original = probeFrame();
    const mask = rectMask(4, 4, 60, 60);
    const out = await buildShadow(original, mask, {
      offsetX: OFFSET_LIMIT,
      offsetY: -OFFSET_LIMIT,
      blur: 12,
      opacity: 0,
      depth: 100,
    });

    assertIdentical(out, original);
  });

  test("depth 0 is the identity too, and leaves no halo", async () => {
    const original = flatFrame(90, 130, 170);
    const mask = rectMask(20, 20, 43, 43, 128);
    const out = await buildShadow(original, mask, { offsetX: 30, offsetY: 30, blur: 9, opacity: 100, depth: 0 });

    assertIdentical(out, original);
  });

  test("a real shadow darkens the background and spares the subject", async () => {
    const original = flatFrame(200, 200, 200);
    const mask = rectMask(30, 30, 33, 33);
    const out = await buildShadow(original, mask, {
      offsetX: 8,
      offsetY: 8,
      blur: 0,
      opacity: 100,
      depth: 100,
    });

    assert.equal(out.data[(10 * W + 10) * 4], 200, "the plain background changed");
    assert.equal(out.data[(38 * W + 38) * 4], 0, "the shadow did not land behind the subject");
    assert.equal(out.data[(31 * W + 31) * 4], 200, "the subject was darkened");
  });

  test("the identity is a copy, never the buffer it was handed", async () => {
    const original = probeFrame();
    const out = await buildShadow(original, rectMask(0, 0, W - 1, H - 1), NOTHING);
    assert.notEqual(out.data, original.data);
    assertIdentical(out, original);
  });

  test("a blur at the border replicates the edge and does not wrap", async () => {
    // One opaque column at the left edge. Border replication leaves the spill
    // to its right and nothing at all on the far side; a wrap would light up
    // the right edge as well, which is what reading across the frame looks like.
    const mask = rectMask(0, 0, 0, H - 1, 255);
    const out = await buildShadow(flatFrame(255, 255, 255), mask, {
      offsetX: 0,
      offsetY: 0,
      blur: 6,
      opacity: 100,
      depth: 100,
    });

    const row = 32 * W;
    // The column is the subject, so it keeps its own brightness.
    assert.equal(out.data[row * 4], 255, "the subject was darkened");
    // The blur spills off the subject into the background beside it.
    assert.ok(out.data[(row + 1) * 4] < 255, "no shadow beside the subject");
    assert.ok(out.data[(row + 4) * 4] < 255, "the spill is too short");
    // And it never arrives at the far edge, which is what a wrap would do.
    assert.equal(out.data[(row + 20) * 4], 255, "the far edge was darkened");
    assert.equal(out.data[(row + W - 2) * 4], 255, "the far edge was darkened");
    assert.equal(out.data[(row + W - 1) * 4], 255, "the far edge was darkened");
  });

  test("an offset past the frame drops the part that leaves and spares the rest", async () => {
    // The clamp is 50 and the frame is 64 wide, so a subject against the left
    // edge is pushed most of the way out. The part that leaves is gone, and the
    // part that stays lands against the right edge rather than anywhere else.
    const original = flatFrame(200, 200, 200);
    const mask = rectMask(0, 0, 19, 9);
    const out = await buildShadow(original, mask, {
      offsetX: OFFSET_LIMIT,
      offsetY: 0,
      blur: 0,
      opacity: 100,
      depth: 100,
    });

    assert.equal(out.data[(2 * W + 5) * 4], 200, "the shadow landed where the subject was");
    assert.equal(out.data[(2 * W + 40) * 4], 200, "the shadow spread the wrong way");
    assert.equal(out.data[(2 * W + OFFSET_LIMIT) * 4], 0, "the shadow did not land");
    assert.equal(out.data[(2 * W + W - 1) * 4], 0, "the shadow missed the last column");
    assert.equal(out.data[(20 * W + OFFSET_LIMIT) * 4], 200, "the shadow moved down");

    // And the panel is told how much of it is gone rather than being left to
    // guess from a frame that looks unchanged. Six of the twenty columns left,
    // which is the share reported: the number and the pixels agree.
    const lost = shadowOutsideShare(
      { offsetX: OFFSET_LIMIT, offsetY: 0 },
      subjectBounds(mask),
      W,
      H,
    );
    assert.equal(lost, 6 / 20);
  });

  test("keep in frame holds the offset back so a shadow really is inside", async () => {
    const original = flatFrame(200, 200, 200);
    const mask = rectMask(20, 20, 43, 43);
    const out = await buildShadow(original, mask, {
      offsetX: 50,
      offsetY: 50,
      blur: 0,
      opacity: 100,
      depth: 100,
      keepInFrame: true,
    });

    // With the clamp on, the shadow lands at the last pixel that fits, so the
    // corner of the frame is darkened and not left empty.
    assert.ok(out.data[(H - 1) * W * 4 + (W - 1) * 4] < 200, "the frame edge was not used");
  });

  test("a cancelled blur gives up rather than writing a half frame", async () => {
    const original = flatFrame(200, 200, 200);
    const out = await buildShadow(
      original,
      rectMask(20, 20, 43, 43),
      { offsetX: 6, offsetY: 6, blur: 10, opacity: 100, depth: 100 },
      { isCancelled: () => true },
    );
    assert.equal(out, null);
  });

  test("every channel stays inside 0..255 for every setting the panel can make", async () => {
    const original = probeFrame();
    const mask = rectMask(20, 20, 43, 43, 200);

    for (const options of [
      { offsetX: -OFFSET_LIMIT, offsetY: -OFFSET_LIMIT, blur: 4, opacity: 100, depth: 100 },
      { offsetX: OFFSET_LIMIT, offsetY: OFFSET_LIMIT, blur: 0, opacity: 100, depth: 100 },
      { offsetX: 1, offsetY: 1, blur: 20, opacity: 50, depth: 50 },
      { offsetX: -1, offsetY: 12, blur: 20, opacity: 1, depth: 99, keepInFrame: true },
    ]) {
      const out = await buildShadow(original, mask, options);
      assertBytes(out);
      assert.equal(out.width, W);
      assert.equal(out.height, H);
    }
  });

  test("a 256x256 frame, the largest this suite builds, stays in range", async () => {
    const size = 256;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = i % 256;
      data[i + 1] = 128;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }
    const out = await buildShadow(
      { width: size, height: size, data },
      rectMask(40, 40, 200, 200, 255, size, size),
      { offsetX: -50, offsetY: 50, blur: 12, opacity: 80, depth: 70 },
    );

    assertBytes(out);
    assert.equal(out.width, size);
    assert.equal(out.height, size);
  });

  test("an empty frame gives an empty frame rather than throwing", async () => {
    const out = await buildShadow(null, null, SHADOW_DEFAULTS);
    assert.deepEqual(out, { width: 0, height: 0, data: new Uint8ClampedArray(0) });
  });
});