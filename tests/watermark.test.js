import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TILE_ORIGINS,
  MIN_TILE_PITCH,
  POSITIONS,
  anchorRatios,
  autoSizes,
  containSize,
  estimateTextWidth,
  fontStack,
  placeMark,
  safeInset,
  scaleSize,
  textBox,
  tileOrigins,
  tilePitch,
} from "../src/lib/core/watermarklayout.js";

const W = 1000;
const H = 800;
const FRAME = { width: W, height: H };
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

/** A 100 by 40 mark, small enough to be placed anywhere without resizing. */
const MARK = { w: 100, h: 40 };

/** Every placed mark must sit wholly inside the frame. */
function assertInside(box, frame = FRAME) {
  assert.ok(box.x >= -1e-9, `x ${box.x} < 0`);
  assert.ok(box.y >= -1e-9, `y ${box.y} < 0`);
  assert.ok(box.x + box.w <= frame.width + 1e-9, `right ${box.x + box.w} > ${frame.width}`);
  assert.ok(box.y + box.h <= frame.height + 1e-9, `bottom ${box.y + box.h} > ${frame.height}`);
}

describe("anchorRatios", () => {
  test("covers the nine anchors of a three by three grid", () => {
    assert.equal(POSITIONS.length, 9);
    for (const id of POSITIONS) {
      const ratio = anchorRatios(id);
      assert.ok([0, 0.5, 1].includes(ratio.x), `${id} x ${ratio.x}`);
      assert.ok([0, 0.5, 1].includes(ratio.y), `${id} y ${ratio.y}`);
    }
  });

  test("corners sit at the near edge, centre at the middle, far side at 1", () => {
    assert.deepEqual(anchorRatios("top-left"), { x: 0, y: 0 });
    assert.deepEqual(anchorRatios("center"), { x: 0.5, y: 0.5 });
    assert.deepEqual(anchorRatios("bottom-right"), { x: 1, y: 1 });
  });

  test("an unknown position falls back to the centre", () => {
    assert.deepEqual(anchorRatios("nowhere"), { x: 0.5, y: 0.5 });
  });
});

describe("safeInset", () => {
  test("is a percentage of each axis", () => {
    assert.deepEqual(safeInset(10, W, H), { x: 100, y: 80 });
  });

  test("no margin means no inset", () => {
    assert.deepEqual(safeInset(0, W, H), { x: 0, y: 0 });
  });

  test("clamps a negative margin to nothing", () => {
    assert.deepEqual(safeInset(-30, W, H), { x: 0, y: 0 });
  });

  test("never eats more than half an axis, so the band cannot invert", () => {
    // 50% would be exactly half; anything past it would cross over.
    assert.deepEqual(safeInset(50, W, H), { x: 500, y: 400 });
    assert.deepEqual(safeInset(100, W, H), { x: 500, y: 400 });
    assert.deepEqual(safeInset(200, W, H), { x: 500, y: 400 });
  });

  test("stays inside a very small frame", () => {
    const inset = safeInset(20, 30, 20);
    assert.ok(inset.x * 2 <= 30);
    assert.ok(inset.y * 2 <= 20);
  });
});

describe("placeMark: anchoring", () => {
  test("top left puts the mark at the near corner", () => {
    const box = placeMark({ position: "top-left" }, MARK, FRAME);
    assert.deepEqual(box, { x: 0, y: 0, w: 100, h: 40 });
  });

  test("bottom right puts the mark at the far corner", () => {
    const box = placeMark({ position: "bottom-right" }, MARK, FRAME);
    assert.deepEqual(box, { x: W - 100, y: H - 40, w: 100, h: 40 });
  });

  test("centre puts the mark in the middle of the frame", () => {
    const box = placeMark({ position: "center" }, MARK, FRAME);
    assert.deepEqual(box, { x: 450, y: 380, w: 100, h: 40 });
  });

  test("the middle row is vertically centred, whatever the column", () => {
    const left = placeMark({ position: "middle-left" }, MARK, FRAME);
    const right = placeMark({ position: "middle-right" }, MARK, FRAME);
    near(left.y + left.h / 2, H / 2);
    near(right.y + right.h / 2, H / 2);
  });

  test("an unknown anchor is treated as the centre", () => {
    const box = placeMark({ position: "nowhere" }, MARK, FRAME);
    assert.deepEqual(box, placeMark({ position: "center" }, MARK, FRAME));
  });
});

describe("placeMark: the margin", () => {
  test("pushes a corner mark inward from both near edges", () => {
    const box = placeMark({ position: "top-left", margin: 5 }, MARK, FRAME);
    assert.deepEqual(box, { x: 50, y: 40, w: 100, h: 40 });
  });

  test("pushes a far corner mark inward from the far edges", () => {
    const box = placeMark({ position: "bottom-right", margin: 5 }, MARK, FRAME);
    // 5% of 1000 and of 800, measured from the edge the mark ends on.
    assert.deepEqual(box, { x: W - 100 - 50, y: H - 40 - 40, w: 100, h: 40 });
  });

  test("a centred mark moves with the band, not with the corner", () => {
    const box = placeMark({ position: "center", margin: 10 }, MARK, FRAME);
    const bandCx = W / 2;
    near(box.x + box.w / 2, bandCx);
    near(box.y + box.h / 2, H / 2);
  });

  test("the inset uses each axis, so a wide frame and a square one differ", () => {
    const wide = placeMark({ position: "top-left", margin: 10 }, MARK, { width: 2000, height: 100 });
    const square = placeMark({ position: "top-left", margin: 10 }, MARK, { width: 500, height: 500 });
    assert.deepEqual([wide.x, wide.y], [200, 10]);
    assert.deepEqual([square.x, square.y], [50, 50]);
  });

  test("a mark wider than the band is pulled back inside, not off the frame", () => {
    // The margin is a request; the frame is the hard limit. A 480px mark on a
    // 500px frame cannot have 50px of air on the left, so the clamp takes the
    // 30px it cannot honour back off the right rather than pushing it over.
    const box = placeMark({ position: "top-left", margin: 10 }, { w: 480, h: 40 }, { width: 500, height: 500 });
    assertInside(box, { width: 500, height: 500 });
    assert.equal(box.x + box.w, 500);
  });
});

describe("placeMark: clamping", () => {
  test("an offset cannot push a mark off the frame", () => {
    for (const position of POSITIONS) {
      for (const [offsetX, offsetY] of [
        [99999, 99999],
        [-99999, -99999],
        [500, -500],
      ]) {
        const box = placeMark({ position, offsetX, offsetY }, MARK, FRAME);
        assertInside(box);
      }
    }
  });

  test("an offset can still override the margin, up to the edge", () => {
    // A 10% margin is 100px across and 80px down. A -50px nudge must reach
    // past the 100px inset, which is the whole point of a nudge.
    const box = placeMark({ position: "top-left", margin: 10, offsetX: -50 }, MARK, FRAME);
    assert.deepEqual([box.x, box.y], [50, 80]);
  });

  test("a frame too small for the margin still places a mark", () => {
    const box = placeMark({ position: "center", margin: 40 }, MARK, { width: 60, height: 20 });
    assertInside(box, { width: 60, height: 20 });
  });
});

describe("placeMark: an oversized mark", () => {
  test("is scaled to fit rather than clipped silently", () => {
    const box = placeMark({ position: "center" }, { w: 4000, h: 1000 }, FRAME);
    assert.equal(box.w, W);
    assert.equal(box.h, 250);
    assertInside(box);
  });

  test("keeps its aspect, so it is smaller rather than squashed", () => {
    const box = placeMark({ position: "center" }, { w: 1000, h: 3000 }, FRAME);
    near(box.w / box.h, 1000 / 3000);
    assert.ok(box.h <= H + 1e-9);
    assert.ok(box.w <= W + 1e-9);
  });

  test("lands on the near corner at a corner anchor", () => {
    const box = placeMark({ position: "top-left" }, { w: 5000, h: 5000 }, FRAME);
    assertInside(box);
    assert.equal(box.x, 0);
    assert.equal(box.y, 0);
  });

  test("a mark that fits exactly is left alone", () => {
    const box = placeMark({ position: "center" }, { w: W, h: H }, FRAME);
    assert.deepEqual(box, { x: 0, y: 0, w: W, h: H });
  });
});

describe("containSize", () => {
  test("leaves a mark that already fits", () => {
    assert.deepEqual(containSize({ w: 50, h: 20 }, { w: 100, h: 100 }), { w: 50, h: 20 });
  });

  test("shrinks to the tighter axis", () => {
    assert.deepEqual(containSize({ w: 200, h: 100 }, { w: 100, h: 100 }), { w: 100, h: 50 });
    assert.deepEqual(containSize({ w: 100, h: 400 }, { w: 100, h: 100 }), { w: 25, h: 100 });
  });

  test("never grows a mark", () => {
    const out = containSize({ w: 10, h: 10 }, { w: 1000, h: 1000 });
    assert.deepEqual(out, { w: 10, h: 10 });
  });

  test("an empty mark stays empty instead of becoming NaN", () => {
    assert.deepEqual(containSize({ w: 0, h: 0 }, { w: 0, h: 0 }), { w: 0, h: 0 });
  });
});

describe("scaleSize", () => {
  test("a percentage of a natural size", () => {
    assert.deepEqual(scaleSize({ w: 400, h: 200 }, 50), { w: 200, h: 100 });
  });

  test("a negative percentage is treated as none", () => {
    assert.deepEqual(scaleSize({ w: 400, h: 200 }, -10), { w: 0, h: 0 });
  });
});

describe("tilePitch", () => {
  test("is the tile plus the gap", () => {
    assert.equal(tilePitch(200, 20), 220);
    assert.equal(tilePitch(200, 0), 200);
  });

  test("has a floor, so a tiny pitch cannot become a hang", () => {
    assert.equal(tilePitch(0, 0), MIN_TILE_PITCH);
    assert.equal(tilePitch(4, 1), MIN_TILE_PITCH);
    // A negative gap cannot pull the grid inside its own floor either.
    assert.equal(tilePitch(10, -100), MIN_TILE_PITCH);
  });
});

describe("tileOrigins", () => {
  test("neighbours are exactly one pitch apart, on both axes", () => {
    const pitch = 220;
    const origins = tileOrigins(pitch, W, H);
    const rows = new Map();
    for (const { x, y } of origins) {
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(x);
    }

    const ys = [...rows.keys()];
    assert.ok(rows.size > 1, "expected more than one row of cells");
    for (let r = 1; r < ys.length; r += 1) near(ys[r] - ys[r - 1], pitch);

    for (const xs of rows.values()) {
      for (let i = 1; i < xs.length; i += 1) near(xs[i] - xs[i - 1], pitch);
    }
  });

  test("every origin sits on the pitch grid, so the pattern cannot drift", () => {
    const pitch = 137;
    for (const { x, y } of tileOrigins(pitch, 500, 400)) {
      near((x + pitch) % pitch, 0);
      near((y + pitch) % pitch, 0);
    }
  });

  test("covers the whole frame, with a cell of bleed past each edge", () => {
    const pitch = 220;
    const origins = tileOrigins(pitch, W, H);
    const maxX = Math.max(...origins.map((o) => o.x));
    const maxY = Math.max(...origins.map((o) => o.y));
    // A mark the width of one cell at the last origin still reaches the edge.
    assert.ok(maxX + pitch >= W, `maxX ${maxX} leaves a gap`);
    assert.ok(maxY + pitch >= H, `maxY ${maxY} leaves a gap`);
    assert.ok(Math.min(...origins.map((o) => o.x)) < 0);
    assert.ok(Math.min(...origins.map((o) => o.y)) < 0);
  });

  test("a full row is present at every y the frame needs", () => {
    const pitch = 100;
    const rows = new Set(tileOrigins(pitch, W, H).map((o) => o.y));
    for (let y = 0; y < H; y += pitch) {
      assert.ok([...rows].some((row) => row <= y && y < row + pitch), `no cell covers y ${y}`);
    }
  });

  test("a degenerate pitch degrades to a sparse grid rather than a freeze", () => {
    assert.ok(tileOrigins(1, 4000, 4000).length <= MAX_TILE_ORIGINS);
    assert.ok(tileOrigins(0, 100, 100).length > 0);
  });
});

describe("textBox", () => {
  test("uses the measurement when one is given", () => {
    assert.deepEqual(textBox("abc", 40, () => 300), { w: 300, h: 40 });
  });

  test("falls back to an estimate when there is no measurement", () => {
    assert.deepEqual(textBox("abc", 40), { w: 40 * 3 * 0.55, h: 40 });
    near(textBox("abc", 40).w, estimateTextWidth("abc", 40));
  });

  test("a broken measurement is treated as no measurement", () => {
    assert.deepEqual(textBox("abc", 40, () => NaN), textBox("abc", 40));
  });

  test("an empty run has no width", () => {
    assert.deepEqual(textBox("", 40, () => 300), { w: 0, h: 40 });
    assert.equal(estimateTextWidth("", 40), 0);
  });

  test("the estimate grows with the text and with the size", () => {
    assert.ok(estimateTextWidth("abcdef", 40) > estimateTextWidth("abc", 40));
    assert.ok(estimateTextWidth("abc", 80) > estimateTextWidth("abc", 40));
  });
});

describe("fontStack", () => {
  test("spells out style and weight, so nothing is left to a default", () => {
    assert.equal(fontStack("Georgia", {}, 40), "normal normal 40px Georgia");
    assert.equal(fontStack("Georgia", { bold: true }, 40), "normal bold 40px Georgia");
    assert.equal(fontStack("Georgia", { italic: true }, 40), "italic normal 40px Georgia");
    assert.equal(
      fontStack("Impact", { bold: true, italic: true }, 12),
      "italic bold 12px Impact",
    );
  });
});

describe("autoSizes", () => {
  test("scales with the frame width", () => {
    const big = autoSizes(4000);
    const small = autoSizes(1000);
    assert.ok(big.fontSize > small.fontSize);
    assert.ok(big.tileSize > small.tileSize);
  });

  test("never drops below a readable size", () => {
    assert.equal(autoSizes(50).fontSize, 12);
    assert.equal(autoSizes(1).fontSize, 12);
    assert.equal(autoSizes(50).tileSize, 150);
  });

  test("a missing width cannot divide by zero", () => {
    const out = autoSizes(0);
    assert.ok(Number.isFinite(out.fontSize));
    assert.ok(Number.isFinite(out.tileSize));
  });
});
