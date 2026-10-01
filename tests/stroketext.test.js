import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_STROKE_WIDTH,
  boxCorner,
  clampStrokeWidth,
  frameOverflow,
  lineLayout,
  matrixString,
  paintOps,
  rotationForPoint,
  rotationMatrix,
  scaledSize,
  transformBox,
  transformPoint,
  unrotate,
  wrapGlyphs,
  blockLayout,
} from "../src/lib/core/stroketext.js";
import { measureAdvances } from "../src/lib/core/textarc.js";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

/**
 * A stand-in for the canvas, so the tests never load a font.
 *
 * `i` is narrow and `m` is wide, which is the whole point: an estimate cannot
 * tell them apart, and a single measurement reused across a run would put every
 * glyph in "mimi" at the width of an `i` or the width of an `m` depending on
 * which character happened to be measured first.
 */
const narrow = (char) => (char === "i" ? 10 : 40);

/** A measured run, the only source of advances in here. */
const run = (text, tracking = 0) => measureAdvances(text, narrow, tracking);

describe("clampStrokeWidth", () => {
  test("holds a width inside the range on offer", () => {
    assert.equal(clampStrokeWidth(3), 3);
    assert.equal(clampStrokeWidth(MAX_STROKE_WIDTH), MAX_STROKE_WIDTH);
  });

  test("clamps at a floor of 0", () => {
    // A negative width is a mistake, not a thinner stroke. Passing one to a
    // context would ask for a hairline outline, so it lands on the floor.
    assert.equal(clampStrokeWidth(-1), 0);
    assert.equal(clampStrokeWidth(-9999), 0);
    assert.equal(clampStrokeWidth(0), 0);
  });

  test("clamps a non-finite width to the floor", () => {
    assert.equal(clampStrokeWidth(NaN), 0);
    assert.equal(clampStrokeWidth(undefined), 0);
    assert.equal(clampStrokeWidth("not a number"), 0);
  });

  test("clamps at the ceiling", () => {
    assert.equal(clampStrokeWidth(9999), MAX_STROKE_WIDTH);
  });
});

describe("paintOps", () => {
  test("stroke first for one paint order", () => {
    assert.deepEqual(paintOps({ paintOrder: "stroke-first", strokeWidth: 6, fill: true }), [
      "stroke",
      "fill",
    ]);
  });

  test("fill first for the other", () => {
    assert.deepEqual(paintOps({ paintOrder: "fill-first", strokeWidth: 6, fill: true }), [
      "fill",
      "stroke",
    ]);
  });

  test("a stroke width of 0 yields no stroke op", () => {
    // Both orders, so the guarantee cannot be an accident of the order.
    for (const paintOrder of ["stroke-first", "fill-first"]) {
      assert.deepEqual(paintOps({ paintOrder, strokeWidth: 0, fill: true }), ["fill"]);
      assert.deepEqual(paintOps({ paintOrder, strokeWidth: -4, fill: true }), ["fill"]);
    }
  });

  test("a negative width is a no-stroke, never a hairline", () => {
    assert.deepEqual(paintOps({ strokeWidth: -1, fill: true }), ["fill"]);
  });

  test("fill off leaves the stroke alone", () => {
    assert.deepEqual(paintOps({ paintOrder: "stroke-first", strokeWidth: 4, fill: false }), ["stroke"]);
  });

  test("fill off and no stroke leaves nothing to draw", () => {
    assert.deepEqual(paintOps({ paintOrder: "fill-first", strokeWidth: 0, fill: false }), []);
  });

  test("an unknown order is the default, stroke first", () => {
    assert.deepEqual(paintOps({ paintOrder: "sideways", strokeWidth: 4, fill: true }), [
      "stroke",
      "fill",
    ]);
  });
});

describe("measureAdvances", () => {
  test("an empty string yields no glyphs", () => {
    assert.deepEqual(measureAdvances("", narrow).glyphs, []);
    assert.equal(measureAdvances("", narrow).total, 0);
  });

  test("measures each glyph on its own, not one value reused", () => {
    const glyphs = measureAdvances("mimi", narrow).glyphs;
    assert.deepEqual(
      glyphs.map((g) => g.width),
      [40, 10, 40, 10],
    );
  });
});

describe("lineLayout", () => {
  test("an empty string yields no glyphs", () => {
    assert.deepEqual(lineLayout({ glyphs: run("").glyphs }).glyphs, []);
    assert.equal(lineLayout({ glyphs: [] }).width, 0);
  });

  test("positions are monotonic and evenly spaced by advance", () => {
    const placed = lineLayout({ glyphs: run("mimi").glyphs, align: "left" });
    // Every neighbour is the previous glyph's advance plus no tracking, and the
    // advances differ per glyph, so an even spacing here is per-glyph spacing.
    near(placed.glyphs[1].x - placed.glyphs[0].x, 40);
    near(placed.glyphs[2].x - placed.glyphs[1].x, 10);
    near(placed.glyphs[3].x - placed.glyphs[2].x, 40);

    for (let i = 1; i < placed.glyphs.length; i += 1) {
      assert.ok(placed.glyphs[i].x > placed.glyphs[i - 1].x, "positions must increase");
    }
  });

  test("tracking is the gap between glyphs and nothing else", () => {
    const placed = lineLayout({ glyphs: run("mimi").glyphs, align: "left", letterSpacing: 5 });
    near(placed.glyphs[1].x - placed.glyphs[0].x, 45);
    near(placed.width, 40 + 10 + 40 + 10 + 15);
  });

  test("alignment moves the run, not its spacing", () => {
    const glyphs = run("mimi").glyphs;
    const left = lineLayout({ glyphs, align: "left" });
    const centre = lineLayout({ glyphs, align: "center" });
    const right = lineLayout({ glyphs, align: "right" });

    assert.equal(left.glyphs[0].x, 0);
    near(centre.glyphs[0].x, -left.width / 2);
    near(right.glyphs[0].x, -left.width);

    // The run is the same length wherever it is anchored.
    assert.equal(centre.width, left.width);
    assert.equal(right.width, left.width);
  });

  test("a run of zero advances has no positions to report", () => {
    // Nothing was measured, so nothing may be placed. A single measured value
    // reused across every glyph would put a whole word in the same place.
    const placed = lineLayout({ glyphs: [{ char: "a", width: 0 }, { char: "b", width: 0 }] });
    assert.equal(placed.width, 0);
    assert.deepEqual(placed.glyphs.map((g) => g.x), [0, 0]);
  });
});

describe("wrapGlyphs", () => {
  test("an empty string yields no glyphs", () => {
    assert.deepEqual(wrapGlyphs(run("").glyphs, { maxWidth: 100 }), []);
  });

  test("no wrap width means one line per paragraph", () => {
    const lines = wrapGlyphs(run("mimi").glyphs, { maxWidth: 0 });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].length, 4);
  });

  test("a newline starts a line and a blank line survives", () => {
    const lines = wrapGlyphs(run("m\n\ni").glyphs, { maxWidth: 0 });
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.map((line) => line.length), [1, 0, 1]);
  });

  test("a long line breaks on a space, never inside a word", () => {
    // "mimi mimi" is 160px of ink plus four 20px spaces. A 100px budget has to
    // break somewhere, and the only break available is a space.
    const lines = wrapGlyphs(run("mimi mimi").glyphs, { maxWidth: 100 });
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0].map((g) => g.char), ["m", "i", "m", "i"]);
    assert.deepEqual(lines[1].map((g) => g.char), ["m", "i", "m", "i"]);
  });

  test("a line never ends in the space that broke it", () => {
    const lines = wrapGlyphs(run("mimi mimi").glyphs, { maxWidth: 100 });
    for (const line of lines) {
      assert.notEqual(line[line.length - 1].char, " ");
    }
  });

  test("a word longer than the budget is never split", () => {
    // Four wide glyphs are 160px against a 100px budget. Breaking mid-word would
    // invent a hyphen nobody asked for, so the word overflows instead.
    const lines = wrapGlyphs(run("mmmm").glyphs, { maxWidth: 100 });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].length, 4);
  });

  test("every glyph survives the wrap", () => {
    const text = "mimi mimi mimi";
    const lines = wrapGlyphs(run(text).glyphs, { maxWidth: 100 });
    assert.equal(lines.flat().map((g) => g.char).join(""), text.split(" ").join(""));
  });
});

describe("blockLayout", () => {
  test("an empty block has no glyphs and no box", () => {
    const block = blockLayout({ lines: [], size: 40 });
    assert.deepEqual(block.glyphs, []);
    assert.deepEqual(block.box, { x: 0, y: 0, w: 0, h: 0 });
    assert.equal(block.height, 0);
  });

  test("one row is centred on the anchor and the baselines step by the row", () => {
    const block = blockLayout({ lines: [run("mimi").glyphs], size: 100, lineHeight: 1.2 });
    assert.equal(block.lineCount, 1);
    near(block.box.y, -60);
    near(block.box.h, 120);
    // Every glyph on the only row shares one baseline.
    for (const glyph of block.glyphs) assert.equal(glyph.y, block.glyphs[0].y);
  });

  test("a taller block steps each row's baseline by the row height", () => {
    const block = blockLayout({
      lines: [run("m").glyphs, run("m").glyphs, run("m").glyphs],
      size: 100,
      lineHeight: 1.2,
    });
    assert.equal(block.lineCount, 3);
    near(block.box.h, 360);
    near(block.glyphs[1].y - block.glyphs[0].y, 120);
    near(block.glyphs[2].y - block.glyphs[1].y, 120);
  });

  test("the ascent and descent decide where the baseline sits in its row", () => {
    const a = blockLayout({ lines: [run("m").glyphs], size: 100, lineHeight: 1, ascent: 80, descent: 20 });
    const b = blockLayout({ lines: [run("m").glyphs], size: 100, lineHeight: 1, ascent: 40, descent: 40 });
    // A 60/40 split hangs the baseline lower inside its row than an 80/20 one.
    near(a.glyphs[0].y, 30);
    near(b.glyphs[0].y, 0);
  });

  test("the widest row sets the box width and the alignment offsets it", () => {
    const lines = [run("mimi").glyphs, run("m").glyphs];
    const centre = blockLayout({ lines, size: 40, align: "center" });
    const left = blockLayout({ lines, size: 40, align: "left" });
    assert.equal(centre.box.w, 100);
    near(centre.box.x, -50);
    assert.equal(left.box.x, 0);
  });
});

describe("rotationMatrix", () => {
  test("no rotation is a pure translation", () => {
    const m = rotationMatrix({ x: 10, y: 20, rotationDeg: 0 });
    assert.deepEqual(m, { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
  });

  test("a quarter turn leaves the frame's origin, the anchor, put", () => {
    // The text frame has its anchor at the origin, so the origin is the one
    // point a rotation cannot move. Anything else in the frame swings about it.
    const origin = { x: 100, y: 100 };
    const p = transformPoint(rotationMatrix({ ...origin, rotationDeg: 90 }), { x: 0, y: 0 });
    near(p.x, 100);
    near(p.y, 100);
  });

  test("a point a quarter turn away lands a quarter turn round", () => {
    const m = rotationMatrix({ x: 0, y: 0, rotationDeg: 90 });
    const p = transformPoint(m, { x: 10, y: 0 });
    near(p.x, 0);
    near(p.y, 10);
  });

  test("matrixString spells the same six numbers as SVG wants", () => {
    const m = rotationMatrix({ x: 5, y: 6, rotationDeg: 90 });
    assert.equal(matrixString(m), "matrix(0 1 -1 0 5 6)");
  });
});

describe("unrotate", () => {
  test("round trips a point through the placement", () => {
    const place = { x: 30, y: 40, rotationDeg: 25 };
    const world = transformPoint(rotationMatrix(place), { x: 7, y: -3 });
    const back = unrotate(place, world);
    near(back.x, 7);
    near(back.y, -3);
  });

  test("with no rotation it is a plain offset", () => {
    const back = unrotate({ x: 10, y: 10, rotationDeg: 0 }, { x: 13, y: 12 });
    near(back.x, 3);
    near(back.y, 2);
  });
});

describe("rotationForPoint", () => {
  test("a handle straight above the anchor reads 0", () => {
    near(rotationForPoint({ x: 0, y: 0 }, { x: 0, y: -10 }), 0);
  });

  test("a handle to the right reads 90", () => {
    near(rotationForPoint({ x: 5, y: 5 }, { x: 15, y: 5 }), 90);
  });
});

describe("transformBox", () => {
  test("an unrotated box comes back as itself", () => {
    const box = { x: 1, y: 2, w: 3, h: 4 };
    const out = transformBox(box, rotationMatrix({ x: 0, y: 0, rotationDeg: 0 }));
    near(out.x, 1);
    near(out.y, 2);
    near(out.w, 3);
    near(out.h, 4);
  });

  test("a quarter turn swaps width for height", () => {
    const out = transformBox({ x: 0, y: 0, w: 100, h: 20 }, rotationMatrix({ x: 0, y: 0, rotationDeg: 90 }));
    near(out.w, 20);
    near(out.h, 100);
  });

  test("the box grows around the anchor, not away from it", () => {
    // 45 degrees on a square is bigger than the square, and both ends of the
    // diagonal must still be the far corners.
    const out = transformBox({ x: -50, y: -50, w: 100, h: 100 }, rotationMatrix({ rotationDeg: 45 }));
    near(out.w, Math.sqrt(2) * 100);
    near(out.h, Math.sqrt(2) * 100);
  });
});

describe("boxCorner", () => {
  test("names a corner of the block in the frame the matrix describes", () => {
    const place = { x: 100, y: 50, rotationDeg: 0 };
    const m = rotationMatrix(place);
    const box = { x: -10, y: -20, w: 30, h: 40 };

    const se = boxCorner(box, m, "se");
    near(se.x, 120);
    near(se.y, 70);

    const nw = boxCorner(box, m, "nw");
    near(nw.x, 90);
    near(nw.y, 30);
  });
});

describe("scaledSize", () => {
  test("measures against where the drag started, not the live size", () => {
    // Start 100px out at 80px, end 150px out. The answer is 120, whatever the
    // current size happens to be, so a drag cannot compound on itself.
    assert.equal(scaledSize(150, 100, 80, 10, 300), 120);
  });

  test("a handle that has not moved leaves the size alone", () => {
    assert.equal(scaledSize(100, 100, 80, 10, 300), 80);
  });

  test("a drag that starts on the anchor has no ratio, so nothing changes", () => {
    assert.equal(scaledSize(150, 0, 80, 10, 300), 80);
  });

  test("clamps to the size the tool offers", () => {
    assert.equal(scaledSize(1000, 100, 80, 10, 300), 300);
    assert.equal(scaledSize(1, 100, 80, 10, 300), 10);
  });
});

describe("frameOverflow", () => {
  const FRAME = { width: 1000, height: 800 };

  test("a box inside the frame reports nothing", () => {
    const out = frameOverflow({ x: 100, y: 100, w: 200, h: 100 }, FRAME);
    assert.equal(out.any, false);
    assert.deepEqual(out.edges, []);
  });

  test("a box flush to the edge is not an overflow", () => {
    // Half a pixel of slack, so a line that lands exactly on the edge is not an
    // overflow the operator cannot get rid of.
    const out = frameOverflow({ x: 0, y: 0, w: 1000, h: 800 }, FRAME);
    assert.equal(out.any, false);
  });

  test("names every edge the box runs past", () => {
    const out = frameOverflow({ x: -10, y: -10, w: 2000, h: 2000 }, FRAME);
    assert.equal(out.any, true);
    assert.deepEqual(out.edges, ["left", "right", "top", "bottom"]);
  });

  test("a block past one edge names that edge only", () => {
    assert.deepEqual(frameOverflow({ x: 900, y: 100, w: 200, h: 100 }, FRAME).edges, ["right"]);
  });

  test("a frame with no size cannot be overflowed", () => {
    // No image on stage is not a reason to warn about the frame.
    const out = frameOverflow({ x: -50, y: -50, w: 100, h: 100 }, { width: 0, height: 0 });
    assert.equal(out.any, false);
  });
});
