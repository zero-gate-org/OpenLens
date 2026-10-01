import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BLEND_MODES,
  DEFAULT_STOPS,
  MIN_STOPS,
  RAMP_STEPS,
  addStop,
  addStopAt,
  applyRamp,
  buildLut,
  moveStop,
  rampColor,
  removeStop,
  reverseStops,
  sortStops,
  tone,
  toneIndex,
} from "../src/lib/core/ramp.js";

// Small frames on purpose: these tests are about the arithmetic, and a big one
// would only make the suite slower and use more memory for no extra signal.
const W = 64;
const H = 64;

/** The colour the lookup holds for one brightness. */
function at(lut, t) {
  const i = Math.round(t * (RAMP_STEPS - 1)) * 3;
  return [lut[i], lut[i + 1], lut[i + 2]];
}

const BLACK_WHITE = [
  { pos: 0, hex: "#000000" },
  { pos: 1, hex: "#ffffff" },
];

const THREE = [
  { pos: 0, hex: "#000000" },
  { pos: 0.5, hex: "#ff0000" },
  { pos: 1, hex: "#ffffff" },
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

/** A full range of greys, in bands, so every tone the lookup can see appears. */
function greyRampFrame() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = ((y * W + x) % RAMP_STEPS);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
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

const rgb = (frame, x, y) => {
  const j = (y * W + x) * 4;
  return [frame.data[j], frame.data[j + 1], frame.data[j + 2]];
};

describe("sortStops", () => {
  test("puts out of order stops into ascending order", () => {
    const sorted = sortStops([
      { pos: 1, hex: "#ffffff" },
      { pos: 0, hex: "#000000" },
      { pos: 0.5, hex: "#ff0000" },
    ]);
    assert.deepEqual(
      sorted.map((stop) => stop.pos),
      [0, 0.5, 1],
    );
  });

  test("leaves the caller's array alone", () => {
    const original = [
      { pos: 1, hex: "#ffffff" },
      { pos: 0, hex: "#000000" },
    ];
    const snapshot = [...original];
    sortStops(original);
    assert.deepEqual(original, snapshot);
  });

  test("clamps a position outside 0..1 rather than trusting it", () => {
    const sorted = sortStops([
      { pos: -3, hex: "#000000" },
      { pos: 9, hex: "#ffffff" },
    ]);
    assert.deepEqual(
      sorted.map((stop) => stop.pos),
      [0, 1],
    );
  });

  test("an unreadable position becomes 0 rather than NaN", () => {
    const sorted = sortStops([
      { pos: Number.NaN, hex: "#000000" },
      { pos: 0.5, hex: "#ff0000" },
    ]);
    assert.ok(
      sorted.every((stop) => Number.isFinite(stop.pos)),
      "a NaN position survived the sort",
    );
  });
});

describe("buildLut", () => {
  test("two stops map black to the first and white to the last", () => {
    const lut = buildLut([
      { pos: 0, hex: "#123456" },
      { pos: 1, hex: "#abcdef" },
    ]);
    assert.deepEqual(at(lut, 0), [0x12, 0x34, 0x56]);
    assert.deepEqual(at(lut, 1), [0xab, 0xcd, 0xef]);
  });

  test("a ramp that does not reach both ends holds its end colours", () => {
    // The ramp spans only the middle half, so the shadows and the highlights
    // outside it both hold the nearest stop rather than inventing a colour.
    const stops = [
      { pos: 0.25, hex: "#ff0000" },
      { pos: 0.75, hex: "#0000ff" },
    ];
    const lut = buildLut(stops);

    assert.deepEqual(rampColor(0, stops), [0xff, 0, 0]);
    assert.deepEqual(rampColor(0.25, stops), [0xff, 0, 0]);
    assert.deepEqual(rampColor(0.5, stops), [0x80, 0, 0x80]);
    assert.deepEqual(rampColor(0.75, stops), [0, 0, 0xff]);
    assert.deepEqual(rampColor(1, stops), [0, 0, 0xff]);

    // The table agrees with the continuous function at every tone it holds.
    for (let i = 0; i < RAMP_STEPS; i++) {
      const t = i / (RAMP_STEPS - 1);
      assert.deepEqual(at(lut, t), rampColor(t, stops), `tone ${t} disagrees`);
    }
  });

  test("a three stop ramp interpolates the middle correctly", () => {
    const lut = buildLut(THREE);
    assert.deepEqual(at(lut, 0), [0, 0, 0]);
    assert.deepEqual(at(lut, 1), [255, 255, 255]);

    // The lookup holds 256 tones at i/255, so the entry nearest the middle
    // stop is 128/255 and sits just past it. Reading the exact middle is
    // `rampColor`'s job, and the two agree at every tone they share.
    assert.deepEqual(at(lut, 0.5), rampColor(128 / 255, THREE));
    assert.deepEqual(rampColor(0.5, THREE), [0xff, 0, 0]);

    // A quarter of the way along is half way along the first segment.
    const quarter = rampColor(0.25, THREE);
    assert.ok(quarter[0] > 120 && quarter[0] < 135, `red at 0.25 is ${quarter[0]}`);
    assert.equal(quarter[1], 0);
    assert.equal(quarter[2], 0);

    // Three quarters is half way along the second.
    const threeQuarters = rampColor(0.75, THREE);
    assert.equal(threeQuarters[0], 255);
    assert.ok(
      threeQuarters[1] > 120 && threeQuarters[1] < 135,
      `green at 0.75 is ${threeQuarters[1]}`,
    );
    assert.ok(
      threeQuarters[2] > 120 && threeQuarters[2] < 135,
      `blue at 0.75 is ${threeQuarters[2]}`,
    );
  });

  test("out of order stops give the same lookup as sorted ones", () => {
    const sorted = buildLut(THREE);
    const shuffled = buildLut([THREE[2], THREE[0], THREE[1]]);
    assert.deepEqual([...sorted], [...shuffled]);
  });

  test("one stop paints the whole range with its own colour", () => {
    const lut = buildLut([{ pos: 0.3, hex: "#ff8800" }]);
    for (const t of [0, 0.2, 0.3, 0.5, 0.9, 1]) {
      assert.deepEqual(at(lut, t), [0xff, 0x88, 0x00], `t ${t} is not the single stop`);
    }
    assert.ok(lut.every((v) => Number.isFinite(v)), "the lookup produced a NaN");
  });

  test("two stops at the same position do not divide by zero", () => {
    const lower = [0x11, 0x22, 0x33];
    const upper = [0x44, 0x55, 0x66];
    const lut = buildLut([
      { pos: 0.5, hex: "#112233" },
      { pos: 0.5, hex: "#445566" },
    ]);
    assert.ok(lut.every((v) => Number.isFinite(v)), "a zero width span produced a NaN");

    // A zero width span is a hard edge rather than a gradient: everything
    // below the shared position holds the lower stop, everything above it the
    // upper one. Which side wins the stop itself is arbitrary, but it has to
    // be the same answer every time, or the same tone would come out as two
    // colours on two identical pixels.
    const edge = Math.round(0.5 * (RAMP_STEPS - 1));
    const tone = (i) => at(lut, i / (RAMP_STEPS - 1));
    for (let i = 0; i < edge; i++) assert.deepEqual(tone(i), lower);
    for (let i = edge + 1; i < RAMP_STEPS; i++) assert.deepEqual(tone(i), upper);

    // And a tone on either side of it still produces one colour per pixel.
    const frame = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
    };
    const out = applyRamp(frame, {
      stops: [
        { pos: 0.5, hex: "#112233" },
        { pos: 0.5, hex: "#445566" },
      ],
      blend: "replace",
      intensity: 1,
    });
    assert.deepEqual([out.data[0], out.data[1], out.data[2]], lower);
    assert.deepEqual([out.data[4], out.data[5], out.data[6]], upper);
  });

  test("an empty ramp is black rather than a crash", () => {
    const lut = buildLut([]);
    assert.ok(lut.every((v) => v === 0));
  });

  test("the lookup is 256 entries of three bytes", () => {
    assert.equal(buildLut(BLACK_WHITE).length, RAMP_STEPS * 3);
    assert.equal(RAMP_STEPS, 256);
  });
});

describe("rampColor", () => {
  test("agrees with the lookup", () => {
    // Compared at the tones the lookup is actually sampled at. `at` rounds a
    // tone to an entry, so asking rampColor about the middle of the range
    // rather than about entry 128 would be asking about a different tone and
    // could differ by a single step of rounding.
    const lut = buildLut(THREE);
    for (let i = 0; i < RAMP_STEPS; i++) {
      const t = i / (RAMP_STEPS - 1);
      assert.deepEqual(rampColor(t, THREE), at(lut, t), `tone ${t} disagrees`);
    }
  });

  test("clamps a tone outside the range rather than extrapolating", () => {
    assert.deepEqual(rampColor(-4, THREE), rampColor(0, THREE));
    assert.deepEqual(rampColor(4, THREE), rampColor(1, THREE));
  });
});

describe("reverseStops", () => {
  test("mirrors the positions and keeps them ordered", () => {
    const reversed = reverseStops(THREE);
    assert.deepEqual(
      reversed.map((stop) => stop.pos),
      [0, 0.5, 1],
    );
    assert.deepEqual(
      reversed.map((stop) => stop.hex),
      ["#ffffff", "#ff0000", "#000000"],
    );
  });

  test("is its own inverse", () => {
    const once = reverseStops(THREE);
    const twice = reverseStops(once);
    assert.deepEqual(twice, sortStops(THREE));
  });

  test("reversing the ramp reverses the output", () => {
    const forward = applyRamp(greyRampFrame(), { stops: THREE, blend: "replace" });
    const backward = applyRamp(greyRampFrame(), {
      stops: reverseStops(THREE),
      blend: "replace",
    });

    // A tone and its mirror must land on the mirrored colour. Every tone is
    // checked, because the ramp has a stop in the middle and a mirror that is
    // merely right at the ends would still pass a spot check.
    for (let v = 0; v < RAMP_STEPS; v++) {
      const mirror = RAMP_STEPS - 1 - v;
      const a = applyRamp(
        { width: 1, height: 1, data: new Uint8ClampedArray([v, v, v, 255]) },
        { stops: THREE },
      );
      const b = applyRamp(
        { width: 1, height: 1, data: new Uint8ClampedArray([mirror, mirror, mirror, 255]) },
        { stops: reverseStops(THREE) },
      );
      assert.deepEqual(
        [a.data[0], a.data[1], a.data[2]],
        [b.data[0], b.data[1], b.data[2]],
        `tone ${v} did not mirror`,
      );
    }

    // And the same statement holds over a whole frame at once: the reversed
    // ramp applied to a frame is the forward ramp applied to the frame read
    // back to front.
    const mirrored = new Uint8ClampedArray(forward.data.length);
    for (let p = 0; p < W * H; p++) {
      const from = (W * H - 1 - p) * 4;
      mirrored[p * 4] = forward.data[from];
      mirrored[p * 4 + 1] = forward.data[from + 1];
      mirrored[p * 4 + 2] = forward.data[from + 2];
      mirrored[p * 4 + 3] = forward.data[from + 3];
    }
    assert.deepEqual([...backward.data], [...mirrored]);
  });

  test("the lookup itself mirrors, for any ramp", () => {
    // The frame statement above can be satisfied by a lookup that mirrors
    // only where a frame happened to land. This is the direct one.
    const ramp = [
      { pos: 0.1, hex: "#102030" },
      { pos: 0.35, hex: "#80c040" },
      { pos: 0.9, hex: "#ff00ff" },
    ];
    const forward = buildLut(ramp);
    const backward = buildLut(reverseStops(ramp));
    for (let i = 0; i < RAMP_STEPS; i++) {
      for (let c = 0; c < 3; c++) {
        assert.equal(
          forward[i * 3 + c],
          backward[(RAMP_STEPS - 1 - i) * 3 + c],
          `entry ${i} channel ${c} did not mirror`,
        );
      }
    }
  });
});

describe("moveStop", () => {
  test("keeps the ramp ordered when a stop crosses another", () => {
    const moved = moveStop(THREE, 0, 0.9);
    assert.deepEqual(
      moved.map((stop) => stop.pos),
      [0.5, 0.9, 1],
    );
    assert.deepEqual(
      moved.map((stop) => stop.hex),
      ["#ff0000", "#000000", "#ffffff"],
    );
  });

  test("clamps a position outside the ramp", () => {
    assert.equal(moveStop(THREE, 1, -5)[0].pos, 0);
    assert.equal(moveStop(THREE, 0, 5).at(-1).pos, 1);
  });

  test("an out of range index changes nothing", () => {
    assert.deepEqual(moveStop(THREE, 9, 0.2), sortStops(THREE));
  });
});

describe("addStop and addStopAt", () => {
  test("addStop keeps the ramp ordered", () => {
    const next = addStop(THREE, 0.1, "#00ff00");
    assert.deepEqual(
      next.map((stop) => stop.pos),
      [0, 0.1, 0.5, 1],
    );
  });

  test("addStopAt takes the colour already on the ramp", () => {
    const next = addStopAt(BLACK_WHITE, 0.5);
    assert.equal(next.length, 3);
    const added = next.find((stop) => stop.pos === 0.5);
    assert.equal(added.hex, "#808080", `a stop on a grey ramp is ${added.hex}`);
  });

  test("a stop added to a ramp carries its id through", () => {
    const next = addStopAt(BLACK_WHITE, 0.25, "gm-9");
    assert.equal(next.find((stop) => stop.id === "gm-9")?.pos, 0.25);
  });
});

describe("removeStop", () => {
  test("removes the stop it was pointed at", () => {
    const next = removeStop(THREE, 1);
    assert.deepEqual(
      next.map((stop) => stop.hex),
      ["#000000", "#ffffff"],
    );
  });

  test("refuses to go below the minimum", () => {
    assert.equal(removeStop(BLACK_WHITE, 0).length, MIN_STOPS);
    assert.equal(removeStop(BLACK_WHITE, 1).length, MIN_STOPS);
    assert.equal(removeStop(THREE, 0).length, 2);
  });

  test("a two stop ramp survives any number of removals", () => {
    let stops = DEFAULT_STOPS;
    for (let i = 0; i < 5; i++) stops = removeStop(stops, 0);
    assert.equal(stops.length, MIN_STOPS);
    assert.ok(buildLut(stops).every((v) => Number.isFinite(v)));
  });
});

describe("tone and toneIndex", () => {
  test("reads a grey as itself", () => {
    assert.equal(toneIndex(0, 0, 0), 0);
    assert.equal(toneIndex(255, 255, 255), 255);
    assert.equal(toneIndex(128, 128, 128), 128);
  });

  test("stays inside the table for every grey", () => {
    for (let v = 0; v <= 255; v++) {
      const index = toneIndex(v, v, v);
      assert.ok(index >= 0 && index <= 255, `grey ${v} indexed at ${index}`);
    }
  });

  test("weighs green most and blue least", () => {
    assert.ok(tone(0, 255, 0) > tone(255, 0, 0));
    assert.ok(tone(255, 0, 0) > tone(0, 0, 255));
  });
});

describe("applyRamp", () => {
  test("every blend keeps every channel inside 0..255", () => {
    const frames = [flatFrame(0, 0, 0), flatFrame(255, 255, 255), greyRampFrame()];
    const ramps = [BLACK_WHITE, THREE, reverseStops(THREE), [{ pos: 0.5, hex: "#3d7fff" }]];

    for (const { value: blend } of BLEND_MODES) {
      for (const frame of frames) {
        for (const stops of ramps) {
          for (const intensity of [0, 0.25, 0.5, 1]) {
            const out = applyRamp(frame, { stops, intensity, blend });
            assertInRange(out);
          }
        }
      }
    }
  });

  test("intensity 0 leaves the frame exactly as it was", () => {
    for (const { value: blend } of BLEND_MODES) {
      const frame = greyRampFrame();
      const out = applyRamp(frame, { stops: THREE, intensity: 0, blend });
      assert.deepEqual([...out.data], [...frame.data], `${blend} changed the frame at intensity 0`);
    }
  });

  test("intensity 1 with replace puts the ramp down", () => {
    const out = applyRamp(flatFrame(0, 0, 0), {
      stops: [
        { pos: 0, hex: "#0000ff" },
        { pos: 1, hex: "#ff0000" },
      ],
      intensity: 1,
      blend: "replace",
    });
    assert.deepEqual(rgb(out, 0, 0), [0, 0, 0xff]);

    const white = applyRamp(flatFrame(255, 255, 255), {
      stops: [
        { pos: 0, hex: "#0000ff" },
        { pos: 1, hex: "#ff0000" },
      ],
      intensity: 1,
      blend: "replace",
    });
    assert.deepEqual(rgb(white, 0, 0), [0xff, 0, 0]);
  });

  test("alpha is carried through untouched", () => {
    for (const { value: blend } of BLEND_MODES) {
      const out = applyRamp(flatFrame(20, 30, 40, 128), {
        stops: THREE,
        intensity: 1,
        blend,
      });
      for (let i = 3; i < out.data.length; i += 4) {
        assert.equal(out.data[i], 128, `${blend} changed alpha`);
      }
    }
  });

  test("luminosity moves the tone and leaves the hues alone", () => {
    const before = [150, 180, 210];
    const frame = { width: 1, height: 1, data: new Uint8ClampedArray([...before, 255]) };
    // A ramp that is not grey is what makes this test say anything: a grey
    // ramp maps a grey to itself, so the tone it moves is already in place.
    const out = applyRamp(frame, {
      stops: [
        { pos: 0, hex: "#000000" },
        { pos: 1, hex: "#ff0000" },
      ],
      intensity: 1,
      blend: "luminosity",
    });
    // Adding the same amount to every channel is what keeps a hue a hue: the
    // gaps between the channels do not move, only their common level does.
    const after = [out.data[0], out.data[1], out.data[2]];
    assert.equal(after[1] - after[0], before[1] - before[0]);
    assert.equal(after[2] - after[1], before[2] - before[1]);
    assert.ok(after[0] < before[0], `luminosity did not darken: ${after}`);
  });

  test("multiply darkens with the ramp", () => {
    const frame = { width: 1, height: 1, data: new Uint8ClampedArray([200, 200, 200, 255]) };
    const out = applyRamp(frame, {
      stops: [
        { pos: 0, hex: "#000000" },
        { pos: 1, hex: "#808080" },
      ],
      intensity: 1,
      blend: "multiply",
    });
    assert.ok(out.data[0] < 200, `multiply did not darken: ${out.data[0]}`);
    assert.ok(out.data[0] >= 0, "multiply went below zero");
  });

  test("colour takes the ramp's hue over the original lightness", () => {
    // The distinguishing claim of this mode is that the lightness of the pixel
    // survives and only the hue and saturation change. The ramp below is much
    // darker than the pixel it maps, so replace and colour disagree here, and a
    // check that only looked at "is it purple" would pass under either.
    const ramp = [
      { pos: 0, hex: "#000000" },
      { pos: 0.5, hex: "#400080" },
      { pos: 1, hex: "#ffffff" },
    ];
    const frame = { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) };
    const settings = { stops: ramp, intensity: 1, blend: "color" };

    const coloured = applyRamp(frame, settings);
    const replaced = applyRamp(frame, { ...settings, blend: "replace" });
    const [r, g, b] = [coloured.data[0], coloured.data[1], coloured.data[2]];

    for (const v of [r, g, b]) {
      assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `channel is ${v}`);
    }

    const lightness = ([cr, cg, cb]) => (Math.max(cr, cg, cb) + Math.min(cr, cg, cb)) / 2;
    assert.ok(
      Math.abs(lightness([r, g, b]) - lightness([128, 128, 128])) < 3,
      `lightness was not kept: ${[r, g, b]}`,
    );
    assert.notDeepEqual([r, g, b], [replaced.data[0], replaced.data[1], replaced.data[2]]);
    // The ramp's purple arrived: blue and red both rose well clear of green.
    assert.ok(b > g + 60 && r > g, `the ramp's chroma did not arrive: ${[r, g, b]}`);
  });

  test("an unknown blend is treated as replace rather than as a hole", () => {
    const frame = flatFrame(10, 200, 90);
    const known = applyRamp(frame, { stops: THREE, intensity: 1, blend: "replace" });
    const odd = applyRamp(frame, {
      stops: THREE,
      intensity: 1,
      blend: /** @type {any} */ ("not-a-blend"),
    });
    assert.deepEqual([...odd.data], [...known.data]);
  });

  test("an out of range intensity is clamped, not trusted", () => {
    const frame = greyRampFrame();
    const none = applyRamp(frame, { stops: THREE, intensity: -1, blend: "replace" });
    const all = applyRamp(frame, { stops: THREE, intensity: 1, blend: "replace" });
    const over = applyRamp(frame, { stops: THREE, intensity: 4, blend: "replace" });

    assert.deepEqual([...none.data], [...frame.data]);
    assert.deepEqual([...over.data], [...all.data]);
  });

  test("out of order stops are sorted before use", () => {
    const frame = greyRampFrame();
    const ordered = applyRamp(frame, { stops: sortStops(THREE), blend: "replace" });
    const shuffled = applyRamp(frame, {
      stops: [THREE[1], THREE[2], THREE[0]],
      blend: "replace",
    });
    assert.deepEqual([...ordered.data], [...shuffled.data]);
  });

  test("the source frame is never written to", () => {
    const frame = greyRampFrame();
    const before = [...frame.data];
    applyRamp(frame, { stops: THREE, intensity: 1, blend: "replace" });
    assert.deepEqual([...frame.data], before);
  });

  test("a single stop paints the frame with that colour", () => {
    const out = applyRamp(greyRampFrame(), {
      stops: [{ pos: 0.7, hex: "#ff8800" }],
      intensity: 1,
      blend: "replace",
    });
    assert.deepEqual(rgb(out, 0, 0), [0xff, 0x88, 0x00]);
    assertInRange(out);
  });
});
