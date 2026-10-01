import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CHANNELS,
  CURVE_STEPS,
  LOOKS,
  MIN_CURVE_POINTS,
  VIGNETTE_SHAPES,
  applyLomo,
  buildCurveLut,
  buildCurveLutFor,
  curveEndpoints,
  curveInsertionPoint,
  curveLevel,
  curvePath,
  defaultCurves,
  lomoPixel,
  normalizeCurve,
  saturatePixel,
  vignetteFalloff,
  vignetteGeometry,
  warmthShift,
} from "../src/lib/core/lomo.js";

// Small frames on purpose: these tests are about the arithmetic, and a big one
// would only make the suite slower and use more memory for no extra signal.
const W = 64;
const H = 64;

/** The identity curve: every level comes out as itself. */
const IDENTITY = [
  { x: 0, y: 0 },
  { x: CURVE_STEPS - 1, y: CURVE_STEPS - 1 },
];

/** A frame of one flat colour. */
function flatFrame(r, g, b, alpha = 255) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = alpha;
  }
  return { width: W, height: H, data };
}

/** Every tone the table can see, in bands, so every level appears at least once. */
function greyRampFrame() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    const v = (i / 4) % CURVE_STEPS;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width: W, height: H, data };
}

/** Every channel of a frame is a byte, so every channel is in 0..255. */
function assertInRange(frame) {
  assert.equal(frame.width, W);
  assert.equal(frame.height, H);
  for (let i = 0; i < frame.data.length; i++) {
    const v = frame.data[i];
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `byte ${i} is ${v}`);
  }
}

/** Every entry of a table is a finite level. */
function assertFiniteLut(lut, label) {
  assert.equal(lut.length, CURVE_STEPS);
  for (let i = 0; i < CURVE_STEPS; i++) {
    assert.ok(Number.isFinite(lut[i]), `${label}[${i}] is ${lut[i]}`);
    assert.ok(lut[i] >= 0 && lut[i] <= 255, `${label}[${i}] is ${lut[i]}`);
  }
}

describe("buildCurveLut: the identity", () => {
  test("an identity curve returns the input unchanged", () => {
    const lut = buildCurveLut(IDENTITY);
    assertFiniteLut(lut, "identity");
    for (let i = 0; i < CURVE_STEPS; i++) {
      assert.equal(lut[i], i, `level ${i} came out as ${lut[i]}`);
    }
  });

  test("a frame through the identity curve and neutral settings is itself", () => {
    const frame = greyRampFrame();
    const out = applyLomo(frame, {
      curves: { R: IDENTITY, G: IDENTITY, B: IDENTITY },
      saturation: 1,
      warmth: 0,
      intensity: 1,
      vignette: 0,
    });
    assert.deepEqual([...out.data], [...frame.data]);
  });

  test("a straight line through two points is the identity too", () => {
    const lut = buildCurveLut([
      { x: 0, y: 0 },
      { x: 64, y: 64 },
      { x: 200, y: 200 },
    ]);
    for (const i of [0, 1, 63, 64, 100, 199, 254, 255]) {
      assert.ok(Math.abs(lut[i] - i) <= 1, `level ${i} came out as ${lut[i]}`);
    }
  });
});

describe("buildCurveLut: clamping", () => {
  test("a control point outside 0..1 is clamped", () => {
    // Positions are written as 0..1 fractions by the panel tests elsewhere;
    // this is the same rule one scale up: nothing outside 0..255 survives.
    const lut = buildCurveLut([
      { x: -500, y: -500 },
      { x: 128, y: 900 },
      { x: 9000, y: 9000 },
    ]);
    assert.equal(lut[0], 0, "a point below zero must not reach below the table");
    assert.ok(lut[CURVE_STEPS - 1] <= CURVE_STEPS - 1);
    assertFiniteLut(lut, "clamped");
  });

  test("normalizeCurve clamps, rounds and sorts", () => {
    const out = normalizeCurve([
      { x: 200.6, y: 10 },
      { x: -5, y: 999 },
      { x: 128, y: 128 },
    ]);
    assert.deepEqual(out, [
      { x: 0, y: 255 },
      { x: 128, y: 128 },
      { x: 201, y: 10 },
    ]);
  });

  test("normalizeCurve reads anything unreadable as zero", () => {
    const out = normalizeCurve([
      { x: Number.NaN, y: "nope" },
      { x: 60, y: 60 },
    ]);
    assert.equal(out[0].x, 0);
    assert.equal(out[0].y, 0);
    assert.equal(out.length, 2);
  });

  test("a point off the end of the table pulls the curve with it", () => {
    const lut = buildCurveLut([{ x: 0, y: 40 }, { x: 128, y: 90 }]);
    assert.equal(lut[0], 40, "black lifted to 40 stays lifted");
    assert.equal(lut[CURVE_STEPS - 1], 255, "white is pinned at the top");
  });
});

describe("buildCurveLut: degenerate curves", () => {
  test("a single point is safe", () => {
    const lut = buildCurveLut([{ x: 128, y: 200 }]);
    assertFiniteLut(lut, "one point");
    assert.equal(curveLevel(lut, 128), 200);
    assert.equal(lut[0], 0);
    assert.equal(lut[CURVE_STEPS - 1], 255);
  });

  test("no points at all is the identity", () => {
    const lut = buildCurveLut([]);
    for (let i = 0; i < CURVE_STEPS; i++) assert.equal(lut[i], i, `level ${i}`);
  });

  test("every point collapsed on one position is safe", () => {
    const lut = buildCurveLut([
      { x: 128, y: 128 },
      { x: 128, y: 128 },
      { x: 128, y: 128 },
    ]);
    assertFiniteLut(lut, "collapsed");
  });

  test("every point collapsed on the shadow end is safe", () => {
    const lut = buildCurveLut([
      { x: 0, y: 60 },
      { x: 0, y: 60 },
    ]);
    assertFiniteLut(lut, "collapsed low");
  });

  test("every point collapsed on the highlight end is safe", () => {
    const lut = buildCurveLut([
      { x: 255, y: 60 },
      { x: 255, y: 60 },
    ]);
    assertFiniteLut(lut, "collapsed high");
  });

  test("a missing list is treated as no points", () => {
    assertFiniteLut(buildCurveLut(undefined), "undefined");
    assertFiniteLut(buildCurveLutFor([]), "prepared empty");
  });

  test("normalizeCurve keeps one point per position, the later one winning", () => {
    const out = normalizeCurve([
      { x: 128, y: 10 },
      { x: 128, y: 90 },
    ]);
    assert.deepEqual(out, [{ x: 128, y: 90 }]);
  });

  test("the endpoints are added and never counted as the operator's points", () => {
    const pts = curveEndpoints([{ x: 64, y: 64 }]);
    assert.equal(pts[0].x, 0);
    assert.equal(pts[pts.length - 1].x, CURVE_STEPS - 1);
    for (let i = 1; i < pts.length; i++) {
      assert.ok(pts[i].x > pts[i - 1].x, "positions must be strictly increasing");
    }
  });

  test("two points is the fewest a curve can have", () => {
    assert.equal(MIN_CURVE_POINTS, 2);
  });
});

describe("buildCurveLut: monotone", () => {
  test("a curve never folds back on itself", () => {
    // A steep rise then a flat top is exactly the shape that overshoots under a
    // non-monotone spline, and an overshoot pushes a level out of range.
    const lut = buildCurveLut([
      { x: 0, y: 0 },
      { x: 10, y: 255 },
      { x: 20, y: 255 },
      { x: 255, y: 255 },
    ]);
    assertFiniteLut(lut, "step");
    for (let i = 1; i < CURVE_STEPS; i++) {
      assert.ok(lut[i] >= lut[i - 1], `level ${i} dips below level ${i - 1}`);
    }
  });

  test("every look's curves are finite and in range", () => {
    for (const look of LOOKS) {
      for (const ch of CHANNELS) {
        assertFiniteLut(buildCurveLut(look.curves[ch.value]), `${look.name} ${ch.value}`);
      }
    }
  });

  test("the default curves match the first look", () => {
    const curves = defaultCurves();
    for (const ch of CHANNELS) {
      assert.deepEqual(curves[ch.value], LOOKS[0].curves[ch.value]);
    }
  });
});

describe("curvePath", () => {
  test("the identity curve is the diagonal of the view box", () => {
    const d = curvePath(buildCurveLut(IDENTITY), 4);
    assert.equal(d, "M0.00 256.00 L85.33 170.67 L170.67 85.33 L256.00 0.00");
  });

  test("every coordinate is a finite number", () => {
    const lut = buildCurveLut([{ x: 128, y: 200 }]);
    const d = curvePath(lut, 32);
    const pairs = d.replace(/^[ML]/, "").split(/[ML]/);
    assert.ok(pairs.length >= 2, `expected at least two pairs in "${d}"`);
    for (const pair of pairs) {
      const [x, y] = pair.trim().split(/\s+/).map(Number);
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `bad pair "${pair}"`);
    }
  });

  test("a degenerate curve still draws", () => {
    assert.ok(curvePath(buildCurveLut([]), 2).startsWith("M"));
    assert.ok(curvePath(buildCurveLut(undefined), 0).startsWith("M"));
  });
});

describe("curveInsertionPoint", () => {
  test("lands in the widest gap", () => {
    const spot = curveInsertionPoint([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 200, y: 200 },
      { x: 255, y: 255 },
    ]);
    assert.ok(spot.x > 10 && spot.x < 200, `x ${spot.x} is not in the widest gap`);
  });

  test("sits on the curve already, so adding a point changes nothing", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 60, y: 90 },
      { x: 255, y: 255 },
    ];
    const spot = curveInsertionPoint(points);
    assert.equal(curveLevel(buildCurveLut(points), spot.x), spot.y);
  });

  test("never lands on a position a point already holds", () => {
    const spot = curveInsertionPoint([
      { x: 0, y: 0 },
      { x: 128, y: 128 },
      { x: 255, y: 255 },
    ]);
    assert.notEqual(spot.x, 128);
  });

  test("is safe on an empty curve", () => {
    const spot = curveInsertionPoint([]);
    assert.ok(Number.isInteger(spot.x) && spot.x >= 0 && spot.x <= 255);
    assert.ok(Number.isInteger(spot.y) && spot.y >= 0 && spot.y <= 255);
  });
});

describe("warmthShift", () => {
  test("warmth is zero at the neutral setting", () => {
    const out = [0, 0, 0];
    warmthShift(30, 90, 200, 0, out);
    assert.deepEqual(out, [30, 90, 200]);
  });

  test("no warmth setting at all is also neutral", () => {
    const out = [0, 0, 0];
    warmthShift(10, 20, 30, Number.NaN, out);
    assert.deepEqual(out, [10, 20, 30]);
  });

  test("warm moves red up and blue down by the same amount", () => {
    const out = [0, 0, 0];
    warmthShift(100, 100, 100, 15, out);
    assert.deepEqual(out, [115, 100, 85]);
  });

  test("cold moves them the other way", () => {
    const out = [0, 0, 0];
    warmthShift(100, 100, 100, -30, out);
    assert.deepEqual(out, [70, 100, 130]);
  });

  test("runs out of levels at the ends rather than wrapping", () => {
    const out = [0, 0, 0];
    warmthShift(250, 0, 5, 20, out);
    assert.deepEqual(out, [255, 0, 0]);
  });
});

describe("vignetteFalloff", () => {
  const size = vignetteGeometry(400, 300);

  test("vignette is zero intensity at the zero setting", () => {
    for (const shape of VIGNETTE_SHAPES) {
      for (const [dx, dy] of [[0, 0], [100, 50], [-190, -140], [200, 150]]) {
        assert.equal(vignetteFalloff(dx, dy, size, 0, shape.value), 1);
      }
    }
  });

  test("the centre is never darkened, whatever the strength", () => {
    for (const shape of VIGNETTE_SHAPES) {
      assert.equal(vignetteFalloff(0, 0, size, 1, shape.value), 1);
    }
  });

  test("darkens towards the edge and never past black", () => {
    const corner = vignetteFalloff(-199, -149, size, 0.8, "round");
    const middle = vignetteFalloff(0, 0, size, 0.8, "round");
    assert.ok(corner < middle, `corner ${corner} is not darker than centre ${middle}`);
    assert.ok(corner >= 0 && corner <= 1);
  });

  test("a single pixel frame does not divide by zero", () => {
    const tiny = vignetteGeometry(1, 1);
    for (const shape of VIGNETTE_SHAPES) {
      assert.ok(Number.isFinite(vignetteFalloff(0.5, 0.5, tiny, 0.9, shape.value)));
      assert.ok(Number.isFinite(vignetteFalloff(0, 0, { cx: 0, cy: 0, corner: 0 }, 0.9, shape.value)));
    }
  });

  test("an oval darkens the middle of an edge sooner than a round one", () => {
    // An oval is measured against its own half size, so it reaches the corner
    // ramp at the mid point of an edge rather than at the corner itself.
    const oval = vignetteFalloff(199, 0, size, 0.8, "oval");
    const round = vignetteFalloff(199, 0, size, 0.8, "round");
    assert.ok(oval < round, `oval ${oval} is not darker than round ${round}`);
  });

  test("a frame with no vignette set is untouched", () => {
    const frame = flatFrame(200, 180, 160);
    const out = applyLomo(frame, {
      curves: { R: IDENTITY, G: IDENTITY, B: IDENTITY },
      saturation: 1,
      warmth: 0,
      intensity: 0,
      vignette: 0,
    });
    assert.deepEqual([...out.data], [...frame.data]);
  });
});

describe("saturatePixel", () => {
  test("a factor of 1 changes nothing", () => {
    const out = [0, 0, 0];
    saturatePixel(180, 60, 40, 1, out);
    assert.deepEqual(out, [180, 60, 40]);
  });

  test("a grey has no saturation to change", () => {
    const out = [0, 0, 0];
    saturatePixel(120, 120, 120, 2.5, out);
    assert.deepEqual(out, [120, 120, 120]);
  });

  test("more saturation moves away from grey, less moves back", () => {
    const up = [0, 0, 0];
    const down = [0, 0, 0];
    saturatePixel(150, 100, 100, 2, up);
    saturatePixel(150, 100, 100, 0.5, down);
    assert.ok(up[0] - up[1] > 100 - 100, "the spread should widen");
    assert.ok(up[0] > 150 && up[1] < 100);
    assert.ok(down[0] < 150 && down[1] > 100);
  });

  test("stays inside 0..255 at every factor", () => {
    const out = [0, 0, 0];
    for (const factor of [0, 0.5, 1, 2.5, 10]) {
      saturatePixel(255, 0, 0, factor, out);
      for (let i = 0; i < 3; i++) {
        assert.ok(Number.isInteger(out[i]) && out[i] >= 0 && out[i] <= 255);
      }
    }
  });
});

describe("lomoPixel", () => {
  const lut = buildCurveLut([{ x: 0, y: 20 }, { x: 255, y: 240 }]);

  test("an intensity of 0 returns the pixel untouched", () => {
    const scratch = [0, 0, 0];
    const out = [0, 0, 0];
    lomoPixel(90, 120, 150, lut, lut, lut, 2, 30, 0, scratch, out);
    assert.deepEqual(out, [90, 120, 150]);
  });

  test("an intensity of 1 returns the whole result", () => {
    const scratch = [0, 0, 0];
    const out = [0, 0, 0];
    lomoPixel(0, 0, 0, lut, lut, lut, 1, 0, 1, scratch, out);
    assert.deepEqual(out, [20, 20, 20]);
  });

  test("a half intensity lands between the two", () => {
    const scratch = [0, 0, 0];
    const out = [0, 0, 0];
    lomoPixel(0, 0, 0, lut, lut, lut, 1, 0, 0.5, scratch, out);
    assert.deepEqual(out, [10, 10, 10]);
  });
});

describe("applyLomo", () => {
  test("every output channel stays within 0..255", () => {
    const frames = [
      flatFrame(0, 0, 0),
      flatFrame(255, 255, 255),
      flatFrame(255, 0, 0, 128),
      greyRampFrame(),
    ];

    for (const frame of frames) {
      for (const look of LOOKS) {
        const out = applyLomo(frame, {
          curves: look.curves,
          saturation: look.saturation,
          warmth: look.warmth,
          intensity: 1,
          vignette: look.vignette,
          shape: "round",
        });
        assertInRange(out);
      }
    }
  });

  test("survives settings at both ends of every slider", () => {
    const frame = greyRampFrame();
    for (const saturation of [0, 1, 3]) {
      for (const warmth of [-50, 0, 50]) {
        for (const intensity of [0, 0.5, 1]) {
          for (const vignette of [0, 1]) {
            for (const shape of VIGNETTE_SHAPES) {
              const out = applyLomo(frame, {
                curves: defaultCurves(),
                saturation,
                warmth,
                intensity,
                vignette,
                shape: shape.value,
              });
              assertInRange(out);
            }
          }
        }
      }
    }
  });

  test("alpha is never touched, so a cut-out keeps its transparency", () => {
    const frame = flatFrame(200, 100, 50, 0);
    const out = applyLomo(frame, {
      curves: defaultCurves(),
      saturation: 2,
      warmth: 40,
      intensity: 1,
      vignette: 1,
    });
    assert.equal(out.data[3], 0);
  });

  test("does not modify the frame it was given", () => {
    const frame = greyRampFrame();
    const before = [...frame.data];
    applyLomo(frame, { curves: defaultCurves(), saturation: 2, warmth: 20, vignette: 1 });
    assert.deepEqual([...frame.data], before);
  });

  test("a half intensity mixes rather than replaces", () => {
    const frame = flatFrame(40, 40, 40);
    const full = applyLomo(frame, {
      curves: defaultCurves(),
      saturation: 1,
      warmth: 0,
      intensity: 1,
      vignette: 0,
    });
    const half = applyLomo(frame, {
      curves: defaultCurves(),
      saturation: 1,
      warmth: 0,
      intensity: 0.5,
      vignette: 0,
    });
    for (let i = 0; i < frame.data.length; i += 4) {
      const expected = Math.round(40 + 0.5 * (full.data[i] - 40));
      assert.equal(half.data[i], expected);
    }
  });

  test("the same settings always give the same frame", () => {
    const frame = greyRampFrame();
    const options = { curves: defaultCurves(), saturation: 1.6, warmth: 15, vignette: 0.7 };
    const a = applyLomo(frame, options);
    const b = applyLomo(frame, options);
    assert.deepEqual([...a.data], [...b.data]);
  });

  test("the vignette darkens the corner more than the middle", () => {
    const frame = flatFrame(200, 200, 200);
    const out = applyLomo(frame, {
      curves: { R: IDENTITY, G: IDENTITY, B: IDENTITY },
      saturation: 1,
      warmth: 0,
      intensity: 1,
      vignette: 0.8,
    });
    const at = (x, y) => out.data[(y * W + x) * 4];
    assert.ok(at(2, 2) < at(W / 2, H / 2), "the corner is not darker than the middle");
    // An even frame has no pixel exactly on the centre, so the middle pixel
    // sits half a pixel out and picks up a fraction of a level.
    assert.ok(Math.abs(at(W / 2, H / 2) - 200) <= 2, `middle is ${at(W / 2, H / 2)}`);
  });
});
