import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  compositeWithMask,
  createGaussianKernel,
  featherMask,
  gaussianBlur,
} from "../src/lib/core/gaussian.js";

/**
 * A plain {width, height, data} stand-in for ImageData. Nothing here touches a
 * canvas, which is the point: the arithmetic is testable in plain Node.
 */
function pixels(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const [r, g, b, a] = fill(p % width, Math.floor(p / width));
    data[p * 4] = r;
    data[p * 4 + 1] = g;
    data[p * 4 + 2] = b;
    data[p * 4 + 3] = a;
  }
  return { width, height, data };
}

/** The red channel of one pixel, which is all these fixtures vary. */
const red = (frame, x, y) => frame.data[(y * frame.width + x) * 4];
const near = (a, b, tol = 1) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const total = (kernel) => kernel.reduce((n, w) => n + w, 0);

/** 16 wide, split down the middle: black on the left, white on the right. */
const split = () => pixels(16, 4, (x) => (x < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255]));

/** Columns of a frame whose value belongs to neither of the two flat regions. */
const inBetween = (frame) =>
  [...Array(frame.width).keys()].filter((x) => red(frame, x, 0) > 0 && red(frame, x, 0) < 255);

describe("createGaussianKernel", () => {
  test("a zero radius is one tap of exactly 1", () => {
    // exp(0 / 0) is NaN, so a zero radius has to be special cased rather than
    // left to the formula.
    const kernel = createGaussianKernel(0);
    assert.equal(kernel.length, 1);
    assert.equal(kernel[0], 1);
    near(total(kernel), 1, 0);
  });

  test("the weights sum to one, so a blur conserves brightness", () => {
    for (const radius of [1, 2, 3, 7, 15, 50]) {
      const kernel = createGaussianKernel(radius);
      assert.equal(kernel.length, radius * 2 + 1);
      near(total(kernel), 1, 1e-6);
    }
  });

  test("a kernel is symmetric about its centre", () => {
    for (const radius of [1, 4, 9]) {
      const kernel = createGaussianKernel(radius);
      for (let i = 0; i < kernel.length; i++) {
        near(kernel[i], kernel[kernel.length - 1 - i], 1e-9);
      }
    }
  });

  test("the centre tap is the heaviest one", () => {
    const kernel = createGaussianKernel(6);
    for (let i = 0; i < kernel.length; i++) {
      assert.ok(kernel[i] <= kernel[(kernel.length - 1) / 2]);
    }
  });
});

describe("gaussianBlur", () => {
  test("a flat image is left exactly as it was", async () => {
    // Weights summing to one means averaging a constant returns the constant.
    // A different value per channel, so a channel mix-up cannot hide.
    const flat = pixels(9, 7, () => [200, 100, 50, 255]);
    const out = await gaussianBlur(flat, 3);

    assert.equal(out.width, 9);
    assert.equal(out.height, 7);
    for (let p = 0; p < out.data.length; p++) near(out.data[p], flat.data[p]);
  });

  test("a zero radius copies the pixels instead of aliasing them", async () => {
    const flat = pixels(4, 4, () => [10, 20, 30, 255]);
    const out = await gaussianBlur(flat, 0);

    assert.deepEqual([...out.data], [...flat.data]);
    assert.notEqual(out.data, flat.data);
  });

  test("the source frame is never written to", async () => {
    const source = pixels(8, 8, (x) => [x * 30, 0, 0, 255]);
    const before = [...source.data];
    await gaussianBlur(source, 3);
    assert.deepEqual([...source.data], before);
  });

  test("a cancelled pass gives up rather than returning half a frame", async () => {
    const flat = pixels(32, 32, () => [1, 2, 3, 255]);
    assert.equal(await gaussianBlur(flat, 2, { isCancelled: () => true }), null);
  });

  describe("two distinct regions", () => {
    test("the hard seam becomes a band of values that belong to neither", async () => {
      const hard = await gaussianBlur(split(), 0);
      const blurred = await gaussianBlur(split(), 2);

      assert.deepEqual(inBetween(hard), [], "the starting point is a single step");
      // The distance between the two regions is now a gradient rather than a
      // line: pixels that belonged to one side or the other now sit between
      // them, which is what blurring an edge looks like in numbers.
      assert.ok(inBetween(blurred).length >= 3, "the seam did not spread");
    });

    test("the spread is a monotonic ramp, and it stays local", async () => {
      const out = await gaussianBlur(split(), 2);
      const row = [...Array(16).keys()].map((x) => red(out, x, 0));

      for (let x = 1; x < 16; x++) {
        assert.ok(row[x] >= row[x - 1], `the ramp is not monotonic at x=${x}`);
      }
      // A blur is a spread, not a wash: the far ends keep their own values.
      assert.equal(row[0], 0);
      assert.equal(row[15], 255);
    });

    test("a wider radius spreads the seam further", async () => {
      const tight = await gaussianBlur(split(), 1);
      const wide = await gaussianBlur(split(), 5);

      assert.notEqual(red(tight, 7, 0), red(wide, 7, 0));
      assert.ok(inBetween(wide).length > inBetween(tight).length);
    });
  });
});

describe("featherMask", () => {
  const edge = () => pixels(9, 1, (x) => [255, 255, 255, x < 4 ? 255 : 0]);

  test("no feather is the mask alpha, exactly", async () => {
    const plane = await featherMask(edge(), 0);
    assert.deepEqual([...plane], [255, 255, 255, 255, 0, 0, 0, 0, 0]);
  });

  test("a feather turns the cut-out into a gradient", async () => {
    const plane = await featherMask(edge(), 2);

    // The mask says nothing at all about columns 4 and 5; after feathering they
    // are half covered, so the sharp subject meets the blurred background over
    // a couple of pixels instead of on one line.
    assert.equal(plane[0], 255, "coverage far from the edge should not move");
    assert.equal(plane[8], 0, "coverage far from the edge should not move");
    assert.ok(plane[4] > 0 && plane[4] < 255, "the edge itself should be in between");
    for (let x = 1; x < 8; x++) {
      assert.ok(plane[x] >= plane[x + 1], `coverage rises again at x=${x}`);
    }
  });

  test("a flat mask stays flat at any feather", async () => {
    const solid = await featherMask(pixels(9, 1, () => [0, 0, 0, 255]), 3);
    const none = await featherMask(pixels(9, 1, () => [0, 0, 0, 0]), 3);
    assert.deepEqual([...solid], Array(9).fill(255));
    assert.deepEqual([...none], Array(9).fill(0));
  });

  test("a cancelled pass gives up", async () => {
    const mask = pixels(32, 32, () => [0, 0, 0, 255]);
    assert.equal(await featherMask(mask, 6, { isCancelled: () => true }), null);
  });
});

describe("compositeWithMask", () => {
  const sharp = pixels(3, 1, () => [200, 200, 200, 255]);
  const soft = pixels(3, 1, () => [50, 50, 50, 255]);

  test("opaque coverage keeps the sharp pixel", () => {
    const out = compositeWithMask(sharp, soft, new Uint8ClampedArray([255, 255, 255]));
    assert.deepEqual([...out.data], [...sharp.data]);
  });

  test("clear coverage takes the blurred pixel", () => {
    const out = compositeWithMask(sharp, soft, new Uint8ClampedArray([0, 0, 0]));
    assert.deepEqual([...out.data], [...soft.data]);
  });

  test("partial coverage splits the difference and keeps the original alpha", () => {
    const out = compositeWithMask(sharp, soft, new Uint8ClampedArray([128, 128, 128]));
    near(red(out, 0, 0), 125, 1);
    assert.equal(out.data[3], 255);
  });
});
