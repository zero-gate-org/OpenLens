import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_SIZE,
  clampToBounds,
  fitToAspect,
  moveBox,
  resizeBox,
  seedBox,
} from "../src/lib/core/geometry.js";

const W = 1000;
const H = 800;
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

/** Every box must sit inside the image, whatever the pointer did. */
function assertInside(box) {
  assert.ok(box.x >= -1e-9, `x ${box.x} < 0`);
  assert.ok(box.y >= -1e-9, `y ${box.y} < 0`);
  assert.ok(box.x + box.w <= W + 1e-9, `right ${box.x + box.w} > ${W}`);
  assert.ok(box.y + box.h <= H + 1e-9, `bottom ${box.y + box.h} > ${H}`);
}

const BOX = { x: 200, y: 100, w: 400, h: 300 };

describe("clampToBounds", () => {
  test("leaves a valid box alone", () => {
    assert.deepEqual(clampToBounds(BOX, W, H), BOX);
  });

  test("shrinks an oversized box and pulls it back in", () => {
    const out = clampToBounds({ x: -50, y: 900, w: 2000, h: 900 }, W, H);
    assert.deepEqual(out, { x: 0, y: 0, w: 1000, h: 800 });
  });
});

describe("seedBox", () => {
  test("is centred and inset", () => {
    const box = seedBox(W, H);
    near(box.x, 50);
    near(box.y, 40);
    near(box.w, 900);
    near(box.h, 720);
    assertInside(box);
  });
});

describe("moveBox", () => {
  test("translates by the pointer delta", () => {
    const out = moveBox(BOX, { x: 300, y: 200 }, { x: 350, y: 260 }, W, H);
    assert.deepEqual(out, { x: 250, y: 160, w: 400, h: 300 });
  });

  test("cannot be dragged off the image", () => {
    const out = moveBox(BOX, { x: 300, y: 200 }, { x: -5000, y: -5000 }, W, H);
    assert.deepEqual(out, { x: 0, y: 0, w: 400, h: 300 });

    const far = moveBox(BOX, { x: 300, y: 200 }, { x: 9999, y: 9999 }, W, H);
    assert.deepEqual(far, { x: W - 400, y: H - 300, w: 400, h: 300 });
  });
});

describe("resizeBox: corners", () => {
  test("se grows from the fixed top-left corner", () => {
    const out = resizeBox("se", BOX, { x: 700, y: 500 }, W, H);
    assert.deepEqual(out, { x: 200, y: 100, w: 500, h: 400 });
  });

  test("nw grows from the fixed bottom-right corner", () => {
    const out = resizeBox("nw", BOX, { x: 100, y: 50 }, W, H);
    assert.deepEqual(out, { x: 100, y: 50, w: 500, h: 350 });
  });

  test("a corner shrinks to the minimum, not through the anchor", () => {
    // Dragging just past the anchor is a collapse, not a huge expansion.
    const out = resizeBox("se", BOX, { x: 205, y: 105 }, W, H);
    assert.equal(out.w, MIN_SIZE);
    assert.equal(out.h, MIN_SIZE);
    assert.equal(out.x, 200);
    assert.equal(out.y, 100);
  });

  test("a corner expands to fill the room, and no more", () => {
    // A long drag must stop at the image edge, not run past it.
    const out = resizeBox("se", BOX, { x: 99999, y: 99999 }, W, H);
    assert.deepEqual(out, { x: 200, y: 100, w: 800, h: 700 });
    assertInside(out);
  });
});

describe("resizeBox: edges", () => {
  test("e only moves the right edge", () => {
    const out = resizeBox("e", BOX, { x: 900, y: 0 }, W, H);
    assert.deepEqual(out, { x: 200, y: 100, w: 700, h: 300 });
  });

  test("w moves the left edge and keeps the right edge pinned", () => {
    const out = resizeBox("w", BOX, { x: 100, y: 0 }, W, H);
    assert.deepEqual(out, { x: 100, y: 100, w: 500, h: 300 });
    assert.equal(out.x + out.w, BOX.x + BOX.w);
  });

  test("n moves the top edge and keeps the bottom edge pinned", () => {
    const out = resizeBox("n", BOX, { x: 0, y: 0 }, W, H);
    assert.deepEqual(out, { x: 200, y: 0, w: 400, h: 400 });
    assert.equal(out.y + out.h, BOX.y + BOX.h);
  });

  test("s moves the bottom edge and keeps the top edge pinned", () => {
    const out = resizeBox("s", BOX, { x: 0, y: 700 }, W, H);
    assert.deepEqual(out, { x: 200, y: 100, w: 400, h: 600 });
    assert.equal(out.y, BOX.y);
  });

  test("an edge handle cannot grow past the image edge", () => {
    const out = resizeBox("e", BOX, { x: 99999, y: 0 }, W, H);
    assert.deepEqual(out, { x: 200, y: 100, w: 800, h: 300 });
    assertInside(out);
  });

  test("an edge handle stops at the minimum instead of flipping", () => {
    // Dragging "e" left of the anchor collapses to the minimum width and
    // stays anchored; it does not jump to the other side of the box.
    const out = resizeBox("e", BOX, { x: 199, y: 0 }, W, H);
    assert.equal(out.w, MIN_SIZE);
    assert.equal(out.x, BOX.x);
    assertInside(out);
  });
});

describe("resizeBox: locked aspect", () => {
  test("a square lock makes an edge handle usable", () => {
    // The whole point: with a 1:1 lock, dragging "e" must still change the
    // height, otherwise the handle looks broken.
    const out = resizeBox("e", BOX, { x: 600, y: 0 }, W, H, 1);
    assert.equal(out.w, 400);
    assert.equal(out.h, 400);
    assert.equal(out.x, 200);
  });

  test("a locked edge keeps the opposite edge pinned", () => {
    const out = resizeBox("e", BOX, { x: 600, y: 0 }, W, H, 1);
    assert.equal(out.x + out.w, 600);
  });

  test("a locked edge stays centred on its original midpoint", () => {
    const out = resizeBox("e", BOX, { x: 600, y: 0 }, W, H, 1);
    const midBefore = BOX.y + BOX.h / 2;
    const midAfter = out.y + out.h / 2;
    near(midBefore, midAfter);
  });

  test("a corner honours the ratio exactly", () => {
    const out = resizeBox("se", BOX, { x: 700, y: 999 }, W, H, 16 / 9);
    near(out.w / out.h, 16 / 9);
    assertInside(out);
  });

  test("a 1:1 corner drag produces a square", () => {
    const out = resizeBox("se", BOX, { x: 800, y: 200 }, W, H, 1);
    assert.equal(out.w, out.h);
  });

  test("a locked corner never overflows a short image", () => {
    // 16:9 from a wide, short box would need more height than exists.
    const out = resizeBox("se", BOX, { x: 700, y: 500 }, W, H, 16 / 9);
    assertInside(out);
    near(out.w / out.h, 16 / 9);
  });

  test("a locked vertical edge still works", () => {
    const out = resizeBox("s", BOX, { x: 0, y: 600 }, W, H, 2);
    near(out.w / out.h, 2);
    assertInside(out);
  });

  test("ratio 0 means free, and stays free", () => {
    const out = resizeBox("se", BOX, { x: 700, y: 200 }, W, H, 0);
    assert.equal(out.w, 500);
    assert.equal(out.h, 100);
  });
});

describe("fitToAspect", () => {
  test("re-centres a wide box into a square", () => {
    const out = fitToAspect(BOX, 1, W, H);
    assert.equal(out.w, out.h);
    const cxBefore = BOX.x + BOX.w / 2;
    const cxAfter = out.x + out.w / 2;
    near(cxBefore, cxAfter);
  });

  test("clamps to the image when the ratio needs more height than exists", () => {
    // 0.1 would need 4000px of height for a 400px width; the image has 800.
    const out = fitToAspect(BOX, 0.1, W, H);
    assert.equal(out.h, H);
    assert.equal(out.w, H * 0.1);
    assertInside(out);
  });

  test("an extreme ratio shrinks the box rather than growing it", () => {
    // Locking 100:1 keeps the current width, because a crop tool should not
    // silently enlarge the selection to fill the frame.
    const out = fitToAspect(BOX, 100, W, H);
    assert.equal(out.w, BOX.w);
    near(out.h, BOX.w / 100);
    assertInside(out);
  });

  test("is a no-op for a free ratio", () => {
    assert.deepEqual(fitToAspect(BOX, 0, W, H), BOX);
  });
});
