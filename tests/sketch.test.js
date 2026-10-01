import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_EDGE,
  applyHatching,
  applySketch,
  detectEdges,
  hatchCut,
  lineDensity,
  toGrayscale,
  tone,
} from "../src/lib/core/sketch.js";

// Small frames on purpose: these tests are about the arithmetic, and a big one
// would only make the suite slower and use more memory for no extra signal.
const W = 64;
const H = 64;
const STEP_X = 32;

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

/** A hard vertical step: dark on the left, light on the right. */
function stepFrame() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = x < STEP_X ? 20 : 235;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

/** A deterministic frame with a hard check, so edges come out at every scale. */
function noiseFrame() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = ((x * 37 + y * 91) % 256) < 128 ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

const MODES = ["sobel", "laplacian", "pencil", "colored-pencil", "hatching"];

const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

/** The columns that carry an edge, counted over the interior rows. */
function edgeColumns(edges) {
  const found = new Set();
  for (let y = 1; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      if (edges[y * W + x] > 0) found.add(x);
    }
  }
  return [...found].sort((a, b) => a - b);
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

/** Mean grey of a frame, for comparing one result against another. */
function meanGrey(frame) {
  let sum = 0;
  for (let i = 0; i < frame.data.length; i += 4) {
    sum += (frame.data[i] + frame.data[i + 1] + frame.data[i + 2]) / 3;
  }
  return sum / (W * H);
}

const rgb = (frame, x, y) => {
  const j = (y * W + x) * 4;
  return [frame.data[j], frame.data[j + 1], frame.data[j + 2]];
};

describe("tone", () => {
  test("reads a grey as itself", () => {
    // The weights are float, so white is 255 to within rounding rather than
    // exactly 255, which is why nothing downstream of here rounds twice.
    near(tone(0, 0, 0), 0);
    near(tone(255, 255, 255), 255);
    near(tone(128, 128, 128), 128);
  });

  test("weighs green most, blue least", () => {
    const [r, g, b] = toGrayscale({
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]),
    });
    assert.ok(r < g, `red ${r} should weigh less than green ${g}`);
    assert.ok(b < r, `blue ${b} should weigh less than red ${r}`);
  });
});

describe("detectEdges", () => {
  test("a flat field has no edges at all", () => {
    const { edges } = detectEdges(flatFrame(90, 90, 90), { threshold: 0 });
    for (let i = 0; i < edges.length; i++) {
      assert.equal(edges[i], 0, `pixel ${i} has strength ${edges[i]}`);
    }
  });

  test("a flat field stays flat for every threshold and line weight", () => {
    for (const mode of MODES) {
      for (const lineWeight of [1, 3, 5]) {
        const { edges } = detectEdges(flatFrame(30, 200, 120), { mode, threshold: 0, lineWeight });
        assert.ok(
          edges.every((v) => v === 0),
          `${mode} at weight ${lineWeight} found an edge in a flat field`,
        );
      }
    }
  });

  test("a hard step puts its edges at the step", () => {
    const { edges } = detectEdges(stepFrame(), { threshold: 80 });
    // A Sobel kernel reads the three columns around a pixel, so the step
    // between 31 and 32 shows up in both of them and nowhere else.
    assert.deepEqual(edgeColumns(edges), [STEP_X - 1, STEP_X]);
  });

  test("a hard step is found by both detectors", () => {
    for (const mode of ["sobel", "laplacian"]) {
      const columns = edgeColumns(detectEdges(stepFrame(), { mode, threshold: 80 }).edges);
      assert.ok(
        columns.includes(STEP_X - 1) && columns.includes(STEP_X),
        `${mode} missed the step: ${columns}`,
      );
    }
  });

  test("edge magnitude is bounded by MAX_EDGE and is never NaN", () => {
    for (const frame of [stepFrame(), noiseFrame(), flatFrame(0, 0, 0)]) {
      for (const mode of ["sobel", "laplacian"]) {
        const { edges } = detectEdges(frame, { mode, threshold: 0, lineWeight: 5 });
        for (let i = 0; i < edges.length; i++) {
          const v = edges[i];
          assert.ok(Number.isFinite(v), `${mode} produced ${v} at ${i}`);
          assert.ok(v >= 0 && v <= MAX_EDGE, `${mode} produced ${v} at ${i}`);
        }
      }
    }
  });

  test("an edge survives only at or above the threshold", () => {
    const frame = noiseFrame();
    // One run with no cut at all is the ground truth the other runs are
    // compared against, pixel for pixel, so an edge cannot be invented or
    // quietly reweighted on its way through the cut.
    const raw = [...detectEdges(frame, { threshold: 0 }).edges];
    for (const threshold of [0, 64, 160, MAX_EDGE]) {
      const cut = detectEdges(frame, { threshold }).edges;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] < threshold) {
          assert.equal(cut[i], 0, `pixel ${i} at strength ${raw[i]} survived a cut of ${threshold}`);
        } else {
          assert.equal(cut[i], raw[i], `pixel ${i} changed under a cut of ${threshold}`);
        }
      }
    }
  });

  test("a threshold of MAX_EDGE keeps only the strongest edges", () => {
    const { edges } = detectEdges(noiseFrame(), { threshold: MAX_EDGE });
    let kept = 0;
    for (let i = 0; i < edges.length; i++) {
      if (edges[i] === 0) continue;
      kept += 1;
      assert.equal(edges[i], MAX_EDGE, `pixel ${i} survived at ${edges[i]}`);
    }
    assert.ok(kept > 0, "a frame of hard steps should saturate somewhere");
    assert.ok(kept < edges.length, "a threshold of MAX_EDGE kept everything");
  });

  test("a higher threshold never keeps more edges than a lower one", () => {
    const frame = noiseFrame();
    let previous = Infinity;
    for (const threshold of [0, 32, 64, 128, 200]) {
      const { edges } = detectEdges(frame, { threshold });
      let kept = 0;
      for (let i = 0; i < edges.length; i++) if (edges[i] > 0) kept += 1;
      assert.ok(kept <= previous, `threshold ${threshold} kept ${kept}, above ${previous}`);
      previous = kept;
    }
    assert.ok(previous > 0, "the lowest threshold kept nothing at all");
  });

  test("line weight widens the line without raising its strength", () => {
    const thin = detectEdges(stepFrame(), { threshold: 0, lineWeight: 1 });
    const thick = detectEdges(stepFrame(), { threshold: 0, lineWeight: 3 });

    assert.ok(
      edgeColumns(thick.edges).length > edgeColumns(thin.edges).length,
      "line weight 3 did not widen the line",
    );
    // A max filter cannot invent strength, so the peak is the same line.
    assert.equal(Math.max(...thick.edges), Math.max(...thin.edges));
  });

  test("every angle is a real direction in radians", () => {
    const { angles } = detectEdges(noiseFrame(), { mode: "sobel", threshold: 0 });
    assert.ok(angles, "sobel should report a direction for every pixel");
    for (let i = 0; i < angles.length; i++) {
      assert.ok(Number.isFinite(angles[i]), `angle ${i} is ${angles[i]}`);
      assert.ok(angles[i] >= -Math.PI && angles[i] <= Math.PI, `angle ${i} is ${angles[i]}`);
    }
  });

  test("the Laplacian reports no direction, because it has none", () => {
    assert.equal(detectEdges(noiseFrame(), { mode: "laplacian" }).angles, null);
  });
});

describe("lineDensity", () => {
  test("spans 0 to 1 over the strength range", () => {
    assert.equal(lineDensity(0), 0);
    assert.equal(lineDensity(MAX_EDGE), 1);
    assert.equal(lineDensity(MAX_EDGE / 2), 0.5);
  });

  test("clamps anything outside it", () => {
    assert.equal(lineDensity(-40), 0);
    assert.equal(lineDensity(900), 1);
  });
});

describe("hatchCut", () => {
  test("density 0 puts the cut above every possible strength", () => {
    assert.equal(hatchCut(0), MAX_EDGE);
  });

  test("density 100 puts the cut at nothing", () => {
    assert.equal(hatchCut(100), 0);
  });

  test("density falls as the cut rises", () => {
    let previous = Infinity;
    for (const density of [0, 25, 50, 75, 100]) {
      const cut = hatchCut(density);
      assert.ok(cut >= 0 && cut <= MAX_EDGE, `cut for ${density} is ${cut}`);
      assert.ok(cut <= previous, `cut for ${density} rose to ${cut}`);
      previous = cut;
    }
  });
});

describe("applySketch", () => {
  test("every mode keeps every channel inside 0..255", () => {
    const frames = [flatFrame(0, 0, 0), flatFrame(255, 255, 255), stepFrame(), noiseFrame()];
    const settings = [
      { threshold: 0, lineWeight: 1 },
      { threshold: 255, lineWeight: 5 },
      { threshold: 40, lineWeight: 2, blend: 0 },
      { threshold: 40, lineWeight: 2, blend: 100 },
      { threshold: 40, lineWeight: 1, blend: 50, hatchLength: 20, hatchDensity: 100 },
      { threshold: 40, lineWeight: 1, blend: 50, hatchLength: 4, hatchDensity: 0 },
      { threshold: 0, lineWeight: 1, ink: "#000000", paper: "#ffffff" },
      { threshold: 0, lineWeight: 1, ink: "#ffffff", paper: "#000000" },
    ];

    for (const mode of MODES) {
      for (const frame of frames) {
        for (const setting of settings) {
          const out = applySketch(frame, { ...setting, mode });
          assertInRange(out);
        }
      }
    }
  });

  test("reads a flat field as bare paper", () => {
    for (const mode of ["sobel", "laplacian", "pencil"]) {
      const out = applySketch(flatFrame(120, 40, 200), {
        mode,
        threshold: 0,
        blend: 0,
        paper: "#f5f0e8",
        ink: "#1a1a1a",
      });
      assert.deepEqual(rgb(out, 10, 10), [0xf5, 0xf0, 0xe8], `${mode} did not leave bare paper`);
    }
  });

  test("puts ink on a step and paper either side of it", () => {
    const out = applySketch(stepFrame(), {
      mode: "sobel",
      threshold: 80,
      paper: "#ffffff",
      ink: "#1a1a1a",
    });
    assert.deepEqual(rgb(out, 5, 30), [0xff, 0xff, 0xff], "the dark side should be bare paper");
    assert.deepEqual(rgb(out, 31, 30), [0x1a, 0x1a, 0x1a], "the step should be ink");
    assert.deepEqual(rgb(out, 58, 30), [0xff, 0xff, 0xff], "the light side should be bare paper");
  });

  test("keeps the source alpha outside hatching", () => {
    for (const mode of ["sobel", "laplacian", "pencil", "colored-pencil"]) {
      const out = applySketch(flatFrame(10, 200, 30, 128), { mode, threshold: 0, blend: 0 });
      for (let i = 3; i < out.data.length; i += 4) {
        assert.equal(out.data[i], 128, `${mode} changed alpha at byte ${i}`);
      }
    }
  });

  test("is a function of its inputs and nothing else", () => {
    const frame = noiseFrame();
    const a = applySketch(frame, { threshold: 60, lineWeight: 2 });
    const b = applySketch(frame, { threshold: 60, lineWeight: 2 });
    assert.deepEqual([...a.data], [...b.data]);
  });

  test("never writes into the frame it was given", () => {
    const frame = noiseFrame();
    const before = [...frame.data];
    applySketch(frame, { mode: "hatching", threshold: 0, hatchDensity: 100 });
    assert.deepEqual([...frame.data], before);
  });

  test("Colour keeps the hues of the picture", () => {
    const out = applySketch(flatFrame(220, 40, 30), {
      mode: "colored-pencil",
      threshold: 0,
      blend: 100,
    });
    const [r, g, b] = rgb(out, 30, 30);
    assert.ok(r > g && r > b, `red should stay the largest channel, got ${r}, ${g}, ${b}`);
  });

  test("Tone puts the original back under the ink, and zero does not", () => {
    const light = applySketch(flatFrame(240, 240, 240), { mode: "pencil", threshold: 0, blend: 100 });
    const dark = applySketch(flatFrame(10, 10, 10), { mode: "pencil", threshold: 0, blend: 100 });
    assert.ok(
      meanGrey(dark) < meanGrey(light),
      "a dark frame should stay darker under the ink than a light one",
    );

    const flat = applySketch(flatFrame(240, 240, 240), {
      mode: "pencil",
      threshold: 0,
      blend: 0,
      paper: "#ffffff",
      ink: "#1a1a1a",
    });
    assert.deepEqual(rgb(flat, 30, 30), [0xff, 0xff, 0xff], "a blend of 0 should be bare paper");
  });
});

describe("applyHatching", () => {
  test("a density of zero leaves the paper colour", () => {
    const out = applyHatching(noiseFrame(), { threshold: 0, hatchDensity: 0, paper: "#f5f0e8" });
    for (let i = 0; i < out.data.length; i += 4) {
      assert.deepEqual([out.data[i], out.data[i + 1], out.data[i + 2]], [0xf5, 0xf0, 0xe8]);
    }
  });

  test("a density of zero on the harshest frame in the suite is still paper", () => {
    const frame = stepFrame();
    const out = applySketch(frame, { mode: "hatching", threshold: 0, hatchDensity: 0, ink: "#000000" });
    assert.deepEqual(rgb(out, 10, 10), [0xff, 0xff, 0xff]);
    assert.deepEqual(rgb(out, 50, 10), [0xff, 0xff, 0xff]);
  });

  test("a higher density lays more ink", () => {
    const frame = noiseFrame();
    let previous = 255;
    for (const hatchDensity of [0, 25, 50, 75, 100]) {
      const out = applyHatching(frame, {
        threshold: 0,
        lineWeight: 1,
        hatchLength: 8,
        hatchDensity,
        ink: "#000000",
        paper: "#ffffff",
      });
      const mean = meanGrey(out);
      assert.ok(mean <= previous, `density ${hatchDensity} raised the mean to ${mean}`);
      previous = mean;
    }
    assert.ok(previous < 255, "a density of 100 drew no ink at all");
  });

  test("a longer stroke lays more ink", () => {
    const frame = noiseFrame();
    const short = applyHatching(frame, { threshold: 0, hatchLength: 4, hatchDensity: 100 });
    const long = applyHatching(frame, { threshold: 0, hatchLength: 20, hatchDensity: 100 });
    assert.ok(meanGrey(long) < meanGrey(short), "a longer stroke did not darken the frame");
  });

  test("the result is opaque, because a hatched sheet is not transparent", () => {
    const out = applyHatching(flatFrame(10, 10, 10, 40), { threshold: 0, hatchDensity: 100 });
    for (let i = 3; i < out.data.length; i += 4) {
      assert.equal(out.data[i], 255, `alpha at byte ${i} is ${out.data[i]}`);
    }
  });

  test("a flat field hatches to bare paper, even at full density", () => {
    // Every strength is zero, and the cut at full density is zero, so nothing
    // can clear the test.
    const out = applyHatching(flatFrame(200, 100, 50), { threshold: 0, hatchDensity: 100 });
    assert.deepEqual(rgb(out, 20, 20), [0xff, 0xff, 0xff]);
  });
});
