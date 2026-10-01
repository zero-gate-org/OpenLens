import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BASE_CELL,
  DEFAULT_PATTERN,
  MAX_PATTERN_SCALE,
  MIN_PATTERN_CELL,
  MIN_PATTERN_SCALE,
  PATTERN_KINDS,
  VISIBLE_CELL,
  clampPatternScale,
  isTooFine,
  normalizePatternAngle,
  patternCell,
  patternDef,
  patternSample,
  patternTransform,
  sampleAt,
  tileShapes,
} from "../src/lib/core/patternfill.js";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

const KINDS = PATTERN_KINDS.map((kind) => kind.value);

/** A tile drawn for one kind, at the default scale and turn. */
const def = (over) => patternDef({ kind: "stripes", color: "#000000", ...over });

describe("clampPatternScale", () => {
  test("holds a scale inside the range on offer", () => {
    assert.equal(clampPatternScale(1), 1);
    assert.equal(clampPatternScale(MAX_PATTERN_SCALE), MAX_PATTERN_SCALE);
  });

  test("clamps a scale of zero at a positive minimum, never at zero", () => {
    // A scale of zero asks a renderer for a tile of no size at all, which is a
    // divide by zero rather than a pattern. It has to land somewhere positive.
    assert.equal(MIN_PATTERN_SCALE > 0, true);
    assert.equal(clampPatternScale(0), MIN_PATTERN_SCALE);
    assert.equal(clampPatternScale(-4), MIN_PATTERN_SCALE);
    assert.ok(clampPatternScale(0) > 0);
  });

  test("clamps a non-finite scale to the authored size", () => {
    assert.equal(clampPatternScale(NaN), 1);
    assert.equal(clampPatternScale(undefined), 1);
    assert.equal(clampPatternScale("not a number"), 1);
    // An infinity would be an infinite period, which is a solid block with no
    // pattern in it. The authored size is a size a renderer can draw.
    assert.equal(clampPatternScale(Infinity), 1);
    assert.equal(clampPatternScale(-Infinity), 1);
  });

  test("clamps at the ceiling", () => {
    assert.equal(clampPatternScale(9999), MAX_PATTERN_SCALE);
  });
});

describe("patternCell", () => {
  test("is the base cell at a scale of 1", () => {
    assert.equal(patternCell(1), BASE_CELL);
  });

  test("a zero scale still yields a tile a renderer can draw", () => {
    const cell = patternCell(0);
    assert.ok(Number.isFinite(cell));
    assert.ok(cell >= MIN_PATTERN_CELL, `cell ${cell} below the floor`);
    assert.ok(cell > 0, `cell ${cell} is not drawable`);
  });

  test("is a whole number, so the two renderers size their tile the same", () => {
    // A tile of 23.7 is 24px of canvas and a 23.7 unit pattern box, which is a
    // visible seam rather than a rounding difference.
    for (const scale of [0.13, 0.31, 0.77, 1, 2.5, 3.333]) {
      assert.equal(Number.isInteger(patternCell(scale)), true);
    }
  });

  test("never falls below the floor however small the scale is", () => {
    assert.ok(patternCell(MIN_PATTERN_SCALE) >= MIN_PATTERN_CELL);
    assert.ok(patternCell(0) >= MIN_PATTERN_CELL);
  });

  test("grows with the scale", () => {
    assert.ok(patternCell(2) > patternCell(1));
    assert.ok(patternCell(1) > patternCell(0.5));
  });
});

describe("isTooFine", () => {
  test("a cell under the visible floor cannot read as marks", () => {
    assert.equal(isTooFine(VISIBLE_CELL - 1), true);
    assert.equal(isTooFine(VISIBLE_CELL), false);
    assert.equal(isTooFine(BASE_CELL), false);
  });
});

describe("normalizePatternAngle", () => {
  test("wraps into 0 to 360", () => {
    assert.equal(normalizePatternAngle(0), 0);
    assert.equal(normalizePatternAngle(90), 90);
    assert.equal(normalizePatternAngle(359.5), 359.5);
  });

  test("a full turn is no turn at all", () => {
    assert.equal(normalizePatternAngle(360), 0);
    assert.equal(normalizePatternAngle(-360), 0);
    assert.equal(normalizePatternAngle(720), 0);
  });

  test("negative angles wrap forwards, not to a negative", () => {
    // Wrapping rather than clamping is what keeps the whole turn reachable from
    // any starting point: -30 and 330 are the same picture.
    assert.equal(normalizePatternAngle(-30), 330);
    assert.equal(normalizePatternAngle(-90), 270);
    assert.ok(normalizePatternAngle(-450) >= 0);
    assert.equal(normalizePatternAngle(-450), 270);
  });

  test("beyond a full turn comes back into range", () => {
    assert.equal(normalizePatternAngle(450), 90);
    assert.equal(normalizePatternAngle(1234), 154);
  });

  test("a non-finite angle is no turn", () => {
    assert.equal(normalizePatternAngle(NaN), 0);
    assert.equal(normalizePatternAngle(undefined), 0);
    assert.equal(normalizePatternAngle("sideways"), 0);
  });

  test("the result is never negative zero", () => {
    // -0 compares unequal to 0 and prints as "-0" in a matrix string.
    assert.ok(Object.is(normalizePatternAngle(-0), 0));
    assert.ok(Object.is(normalizePatternAngle(-360), 0));
  });
});

describe("patternSample", () => {
  test("returns 0 or 1, never anything in between", () => {
    for (const kind of KINDS) {
      for (let i = 0; i < 40; i += 1) {
        const value = patternSample(kind, i * 3.7, i * -1.9, 24);
        assert.ok(value === 0 || value === 1, `${kind} returned ${value}`);
      }
    }
  });

  test("the grid mark answers in range for any input at all", () => {
    // The grid mark divides the coordinate by the cell, so an input that is not
    // a number is exactly where a NaN would leak out. Every one of these has to
    // come back as a real 0 or 1.
    const inputs = [
      0, -0, 1, -1, 0.5, -0.5, 1e9, -1e9, 1e-9, -1e-9,
      Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER,
      NaN, Infinity, -Infinity,
      "12", "not a number", "", null, undefined, {}, [],
    ];

    for (const input of inputs) {
      for (const cell of [2, 3, 6, 24, 96]) {
        for (const y of [0, -7.5, 1e6]) {
          const value = patternSample("grid", input, y, cell);
          assert.ok(
            value === 0 || value === 1,
            `grid(${String(input)}, ${String(y)}, ${cell}) returned ${value}`,
          );
        }
      }
    }
  });

  test("the grid mark draws both a vertical and a horizontal line per cell", () => {
    const cell = 24;
    // Dead centre of the cell in each axis is the gap, and the cell corner is
    // the line. Two lines per axis is what makes a grid rather than one.
    assert.equal(patternSample("grid", 12, 12, cell), 0);
    assert.equal(patternSample("grid", 0, 12, cell), 1);
    assert.equal(patternSample("grid", 12, 0, cell), 1);
  });

  test("a zero cell cannot divide by zero", () => {
    for (const kind of KINDS) {
      const value = patternSample(kind, 10, 10, 0);
      assert.ok(value === 0 || value === 1, `${kind} returned ${value}`);
    }
  });

  test("an unknown kind draws nothing", () => {
    assert.equal(patternSample("nope", 5, 5, 24), 0);
    assert.equal(patternSample(undefined, 5, 5, 24), 0);
  });

  test("stripes put the ink in the first half of the cell", () => {
    assert.equal(patternSample("stripes", 1, 5, 24), 1);
    assert.equal(patternSample("stripes", 20, 5, 24), 0);
  });

  test("checks alternate in both directions", () => {
    assert.equal(patternSample("checks", 5, 5, 24), 1);
    assert.equal(patternSample("checks", 18, 5, 24), 0);
    assert.equal(patternSample("checks", 5, 18, 24), 0);
    assert.equal(patternSample("checks", 18, 18, 24), 1);
  });

  test("dots put one mark in the middle of the cell", () => {
    assert.equal(patternSample("dots", 12, 12, 24), 1);
    assert.equal(patternSample("dots", 0, 0, 24), 0);
  });
});

describe("sampleAt: periodicity", () => {
  test("stripes at no turn repeat with exactly the cell as their period", () => {
    const d = def({ kind: "stripes", scale: 1, angleDeg: 0 });
    const cell = d.cell;

    for (let i = 0; i < 60; i += 1) {
      const x = i * 0.83 - 11.4;
      const y = i * -1.37 + 4.1;
      assert.equal(
        sampleAt(d, x, y),
        sampleAt(d, x + cell, y),
        `not periodic across at x=${x}`,
      );
      assert.equal(
        sampleAt(d, x, y),
        sampleAt(d, x, y + cell),
        `not periodic down at y=${y}`,
      );
    }
  });

  test("half the period is the opposite of the stripe, not the same stripe", () => {
    // If a half cell also repeated, the tile would be half the size it claims
    // and the two renderers would disagree about how big the pattern is.
    const d = def({ kind: "stripes", angleDeg: 0 });
    for (let i = 0; i < 20; i += 1) {
      const x = i * 1.7;
      assert.notEqual(sampleAt(d, x, 0), sampleAt(d, x + d.cell / 2, 0));
    }
  });

  test("every kind repeats with exactly the cell at no turn", () => {
    for (const kind of KINDS) {
      const d = def({ kind, angleDeg: 0 });
      for (let i = 0; i < 25; i += 1) {
        const x = i * 2.3 - 7;
        const y = i * -0.9 + 3;
        assert.equal(sampleAt(d, x, y), sampleAt(d, x + d.cell, y), `${kind} across`);
        assert.equal(sampleAt(d, x, y), sampleAt(d, x, y + d.cell), `${kind} down`);
      }
    }
  });

  test("repeats across the origin as well as to the right of it", () => {
    // A modulo that keeps the sign of the dividend would put the pattern out
    // of step on the left of zero and only look right on the right.
    for (const kind of KINDS) {
      const d = def({ kind, angleDeg: 0 });
      assert.equal(sampleAt(d, -1, -1), sampleAt(d, d.cell - 1, -1), kind);
      assert.equal(sampleAt(d, -d.cell - 3, 4), sampleAt(d, -3, 4), kind);
    }
  });

  test("the turn moves the tile rather than the sampling", () => {
    // A quarter turn of a square cell is the same cell seen from another
    // side, so the field rotates: what was on the x axis is now on the y axis.
    const straight = def({ kind: "grid", angleDeg: 0 });
    const turned = def({ kind: "grid", angleDeg: 90 });
    for (let i = 1; i < 20; i += 1) {
      const x = i * 1.1;
      const y = i * 0.7;
      assert.equal(sampleAt(turned, x, y), sampleAt(straight, y, -x));
    }
  });
});

describe("patternDef", () => {
  test("an empty definition falls back to the default pattern, safely", () => {
    for (const input of [undefined, null, {}, "stripes", 7]) {
      const d = patternDef(input);
      assert.equal(d.kind, DEFAULT_PATTERN);
      assert.equal(d.cell, patternCell(1));
      assert.equal(d.angleDeg, 0);
      assert.equal(d.color, "#000000");
    }
  });

  test("nothing in a fallback definition can be NaN", () => {
    const d = patternDef({ kind: "?", scale: "big", angleDeg: "round", color: "#zz" });
    assert.ok(Number.isFinite(d.cell) && d.cell >= MIN_PATTERN_CELL);
    assert.ok(Number.isFinite(d.angleDeg));
    assert.match(d.color, /^#[0-9a-f]{6}$/);
  });

  test("an unknown kind becomes the default rather than an empty tile", () => {
    assert.equal(patternDef({ kind: "plaid" }).kind, DEFAULT_PATTERN);
    assert.ok(tileShapes(patternDef({ kind: "plaid" }).kind, 24).length > 0);
  });

  test("carries a zero scale up to a drawable cell", () => {
    const d = patternDef({ scale: 0 });
    assert.equal(d.cell, patternCell(0));
    assert.ok(d.cell >= MIN_PATTERN_CELL);
  });

  test("normalises the turn it is handed", () => {
    assert.equal(patternDef({ angleDeg: -30 }).angleDeg, 330);
    assert.equal(patternDef({ angleDeg: 450 }).angleDeg, 90);
  });

  test("is idempotent, so a normalised definition can be normalised again", () => {
    // Both renderers normalise, and neither knows whether it was handed a
    // store value or the output of the other one.
    const once = patternDef({ kind: "checks", scale: 0.4, angleDeg: -45 });
    const twice = patternDef(once);
    assert.deepEqual(twice, once);
  });

  test("an explicit cell passes straight through", () => {
    assert.equal(patternDef({ cell: 37 }).cell, 37);
    assert.equal(patternDef({ cell: 0, scale: 2 }).cell, patternCell(2));
  });
});

describe("tileShapes", () => {
  test("every kind draws something inside its own cell", () => {
    for (const kind of KINDS) {
      const shapes = tileShapes(kind, 24);
      assert.ok(shapes.length > 0, `${kind} draws nothing`);
      for (const shape of shapes) {
        const xs = shape.kind === "circle" ? [shape.cx - shape.r, shape.cx + shape.r] : [shape.x, shape.x + shape.w];
        const ys = shape.kind === "circle" ? [shape.cy - shape.r, shape.cy + shape.r] : [shape.y, shape.y + shape.h];
        for (const v of [...xs, ...ys]) {
          assert.ok(v >= -1e-9 && v <= 24 + 1e-9, `${kind} shape reaches ${v}, outside the cell`);
        }
      }
    }
  });

  test("an empty definition draws no tile", () => {
    assert.deepEqual(tileShapes("nope", 24), []);
    assert.deepEqual(tileShapes(undefined, 24), []);
    assert.deepEqual(tileShapes("", 24), []);
  });

  test("a cell of zero still draws one drawable shape", () => {
    // A zero cell would be a divide by zero in a renderer, so it floors rather
    // than collapsing to nothing.
    assert.ok(tileShapes("stripes", 0).length > 0);
  });

  test("stripes are one band across half the cell", () => {
    assert.deepEqual(tileShapes("stripes", 24), [
      { kind: "rect", x: 0, y: 0, w: 12, h: 24 },
    ]);
  });

  test("checks are the two cells of one diagonal", () => {
    assert.deepEqual(tileShapes("checks", 24), [
      { kind: "rect", x: 0, y: 0, w: 12, h: 12 },
      { kind: "rect", x: 12, y: 12, w: 12, h: 12 },
    ]);
  });

  test("dots are one circle on the cell centre", () => {
    assert.deepEqual(tileShapes("dots", 24), [{ kind: "circle", cx: 12, cy: 12, r: 6 }]);
  });

  test("grid lines meet on the cell corner, so they join across tiles", () => {
    const shapes = tileShapes("grid", 24);
    assert.equal(shapes.length, 2);
    assert.deepEqual(shapes[0], { kind: "rect", x: 0, y: 0, w: 2, h: 24 });
    assert.deepEqual(shapes[1], { kind: "rect", x: 0, y: 0, w: 24, h: 2 });
  });

  test("the shape list and the sample agree about where the ink is", () => {
    // The stage layer draws the shapes and the tests sample the field, so the
    // two have to describe the same tile.
    for (const kind of KINDS) {
      const cell = 24;
      const shapes = tileShapes(kind, cell);
      for (let i = 0; i < 200; i += 1) {
        const x = (i * 7.3) % cell;
        const y = (i * 11.9) % cell;
        const inside = shapes.some((shape) =>
          shape.kind === "circle"
            ? (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r ** 2
            : x >= shape.x && x < shape.x + shape.w && y >= shape.y && y < shape.y + shape.h,
        );
        if (inside) {
          assert.equal(patternSample(kind, x, y, cell), 1, `${kind} misses ink at ${x},${y}`);
        }
      }
    }
  });
});

describe("patternTransform", () => {
  test("no turn is the identity", () => {
    assert.deepEqual(patternTransform(def({ angleDeg: 0 })), {
      a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
    });
  });

  test("the turn carries no translation, so it never shifts the tile's origin", () => {
    for (const deg of [0, 37, 90, 180, 270, 359]) {
      const m = patternTransform(def({ angleDeg: deg }));
      assert.equal(m.e, 0);
      assert.equal(m.f, 0);
    }
  });

  test("a quarter turn swaps the axes", () => {
    const m = patternTransform(def({ angleDeg: 90 }));
    near(m.a, 0);
    near(m.b, 1);
    near(m.c, -1);
    near(m.d, 0);
  });

  test("a turn and the same turn a full circle apart are the same matrix", () => {
    const a = patternTransform(def({ angleDeg: 40 }));
    const b = patternTransform(def({ angleDeg: 400 }));
    near(a.a, b.a, 1e-9);
    near(a.b, b.b, 1e-9);
    near(a.c, b.c, 1e-9);
    near(a.d, b.d, 1e-9);
  });

  test("an unreadable definition still gives a usable matrix", () => {
    const m = patternTransform(undefined);
    for (const key of ["a", "b", "c", "d", "e", "f"]) {
      assert.ok(Number.isFinite(m[key]), `${key} is ${m[key]}`);
    }
  });
});