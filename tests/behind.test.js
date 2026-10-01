import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BEHIND_DEFAULTS,
  EMPTY_TEXT_MESSAGE,
  FEATHER_RANGE,
  FULL_COVERAGE_MASS,
  FULL_COVERAGE_MESSAGE,
  NO_SUBJECT_MESSAGE,
  OPACITY_RANGE,
  PLATES,
  PLATE_BLUR_RANGE,
  TEXT_SHADOW,
  ZERO_OPACITY_MESSAGE,
  behindKey,
  buildBehind,
  clampFeather,
  clipBoxToFrame,
  compositeBehind,
  fullCoverageMask,
  makePlate,
  normalizeBehind,
} from "../src/lib/core/behind.js";
import { featherMask } from "../src/lib/core/gaussian.js";
import { subjectMass } from "../src/lib/core/shadow.js";

// Small frames on purpose. These tests are about the compositing order, the mask
// edge and the degenerate cases, and a big one would only make the suite slower
// and use more memory for no extra signal. The largest here is 32x32.
const W = 8;
const H = 8;

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

/** An ink sheet covering the whole frame. */
function fullInk(r, g, b, alpha = 255) {
  return { x: 0, y: 0, w: W, h: H, data: flatFrame(r, g, b, alpha).data };
}

/** A mask of one flat alpha, which is what a "foreground" sheet reduces to. */
function flatMask(alpha, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = alpha;
  }
  return { width: w, height: h, data };
}

/** A coverage plane of one flat value, as `featherMask` returns. */
function flatCoverage(alpha, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h);
  data.fill(alpha);
  return data;
}

/** The pixel at (x, y) as [r, g, b, a]. */
function pixel(frame, x, y) {
  const i = (y * frame.width + x) * 4;
  return [frame.data[i], frame.data[i + 1], frame.data[i + 2], frame.data[i + 3]];
}

const RED = flatFrame(255, 0, 0);
const GREEN = flatFrame(0, 255, 0);
const BLUE = flatFrame(0, 0, 255);

describe("normalizeBehind", () => {
  test("fills in the defaults", () => {
    assert.deepEqual(normalizeBehind(), {
      plate: BEHIND_DEFAULTS.plate,
      plateBlur: BEHIND_DEFAULTS.plateBlur,
      plateColor: BEHIND_DEFAULTS.plateColor,
      feather: BEHIND_DEFAULTS.feather,
      opacity: BEHIND_DEFAULTS.opacity,
      textKey: "",
    });
  });

  test("holds every setting inside its range", () => {
    const o = normalizeBehind({
      plate: "solid",
      plateBlur: 9999,
      plateColor: "#FFF",
      feather: -12,
      opacity: 480,
    });
    assert.equal(o.plate, "solid");
    assert.equal(o.plateBlur, PLATE_BLUR_RANGE.max);
    assert.equal(o.plateColor, "#ffffff");
    assert.equal(o.feather, FEATHER_RANGE.min);
    assert.equal(o.opacity, OPACITY_RANGE.max);
  });

  test("falls back to the default plate for anything unknown", () => {
    assert.equal(normalizeBehind({ plate: "wood" }).plate, BEHIND_DEFAULTS.plate);
    for (const plate of PLATES) {
      assert.equal(normalizeBehind({ plate: plate.value }).plate, plate.value);
    }
  });

  test("every plate mode is one of the three the panel offers", () => {
    assert.deepEqual(
      PLATES.map((p) => p.value),
      ["blur", "solid", "original"],
    );
  });

  test("a feather of zero is a real setting, not an error", () => {
    assert.equal(clampFeather(0), 0);
    assert.equal(normalizeBehind({ feather: 0 }).feather, 0);
  });
});

describe("behindKey", () => {
  test("separates the settings that change the pixels", () => {
    const base = { plate: "blur", plateBlur: 10, feather: 4, opacity: 100 };
    const keys = new Set([
      behindKey(base),
      behindKey({ ...base, plate: "solid" }),
      behindKey({ ...base, plateBlur: 11 }),
      behindKey({ ...base, plateColor: "#101010" }),
      behindKey({ ...base, feather: 5 }),
      behindKey({ ...base, opacity: 99 }),
      behindKey({ ...base, textKey: "HELLO" }),
    ]);
    assert.equal(keys.size, 7);
  });

  test("the caller's ink signature is part of the key", () => {
    assert.notEqual(behindKey({ textKey: "a" }), behindKey({ textKey: "b" }));
    assert.equal(behindKey({ textKey: "a" }), behindKey({ textKey: "a" }));
  });
});

describe("clipBoxToFrame", () => {
  test("leaves a box already inside alone", () => {
    assert.deepEqual(clipBoxToFrame({ x: 2, y: 3, w: 4, h: 1 }, W, H), {
      x: 2,
      y: 3,
      w: 4,
      h: 1,
    });
  });

  test("cuts a box that hangs off the edge down to the frame", () => {
    assert.deepEqual(clipBoxToFrame({ x: -3, y: -2, w: 6, h: 5 }, W, H), {
      x: 0,
      y: 0,
      w: 3,
      h: 3,
    });
  });

  test("a box entirely off the picture has no area across it", () => {
    const out = clipBoxToFrame({ x: 40, y: 0, w: 4, h: 4 }, W, H);
    assert.equal(out.w, 0, "nothing of it is across the frame");
    assert.equal(out.h, 4, "its own height is untouched");
  });

  test("a frame with no size is not a frame", () => {
    assert.equal(clipBoxToFrame({ x: 1, y: 1, w: 2, h: 2 }, 0, 0).w, 0);
  });
});

describe("makePlate", () => {
  test("a solid plate is one opaque colour", async () => {
    const plate = await makePlate(RED, { plate: "solid", plateColor: "#123456" });
    assert.deepEqual(pixel(plate, 0, 0), [0x12, 0x34, 0x56, 255]);
    assertIdentical(plate, { width: W, height: H, data: plate.data });
  });

  test("an unreadable colour is black, never transparent", async () => {
    const plate = await makePlate(RED, { plate: "solid", plateColor: "nonsense" });
    assert.deepEqual(pixel(plate, 0, 0), [0, 0, 0, 255]);
  });

  test("the original plate is a copy, and never the same buffer", async () => {
    const plate = await makePlate(BLUE, { plate: "original" });
    assertIdentical(plate, BLUE);
    assert.notEqual(plate.data, BLUE.data);
  });

  test("a plate blur of zero leaves the picture as it was", async () => {
    const plate = await makePlate(flatFrame(10, 20, 30), { plate: "blur", plateBlur: 0 });
    assertIdentical(plate, flatFrame(10, 20, 30));
  });

  test("a plate blur keeps a flat field flat", async () => {
    const plate = await makePlate(flatFrame(90, 120, 150), { plate: "blur", plateBlur: 3 });
    assert.deepEqual(pixel(plate, 0, 0), [90, 120, 150, 255]);
  });

  test("a cancelled blur gives no plate", async () => {
    const plate = await makePlate(BLUE, { plate: "blur", plateBlur: 4 }, {
      isCancelled: () => true,
    });
    assert.equal(plate, null);
  });
});

describe("compositeBehind: the order of the three steps", () => {
  test("background, then the text, then the subject", () => {
    // Red plate, green words, blue subject, half coverage on every pixel.
    // Read the order off the answer: a subject last gives half blue over half
    // green; a subject first would give whole green on top of half blue.
    const out = compositeBehind(BLUE, RED, fullInk(0, 255, 0), flatCoverage(128));
    const [r, g, b] = pixel(out, 0, 0);

    assert.equal(r, 0, "the plate red must be fully gone once green is over it");
    assert.ok(Math.abs(g - 128) <= 1, `green ${g} should be half the word over half the subject`);
    assert.ok(Math.abs(b - 128) <= 1, `blue ${b} should be half the subject over half the word`);
    assertBytes(out);
  });

  test("a full coverage mask hides the words completely", () => {
    const out = compositeBehind(BLUE, RED, fullInk(0, 255, 0), flatCoverage(255));
    assertIdentical(out, BLUE, "the subject is the only thing left");
  });

  test("an all zero mask makes the subject invisible and the words show", () => {
    const out = compositeBehind(BLUE, RED, fullInk(0, 255, 0), flatCoverage(0));
    assertIdentical(out, GREEN, "plate under the words, and no subject at all");
  });

  test("the words sit on the plate where the mask is empty", () => {
    const coverage = flatCoverage(0);
    const out = compositeBehind(BLUE, RED, fullInk(255, 255, 255, 128), coverage);
    const [r, g, b] = pixel(out, 0, 0);
    assert.ok(Math.abs(r - 255) <= 1, `red ${r}, the plate is red`);
    assert.ok(Math.abs(g - 128) <= 1, `green ${g}, half a white word over red`);
    assert.ok(Math.abs(b - 128) <= 1, `blue ${b}, half a white word over red`);
  });

  test("an ink sheet is a window onto the frame, not a second frame", () => {
    // A sheet two pixels wide at x=2: only columns 2 and 3 carry words.
    const ink = { x: 2, y: 0, w: 2, h: H, data: flatFrame(0, 255, 0).data };
    const out = compositeBehind(BLUE, RED, ink, flatCoverage(0));
    assert.deepEqual(pixel(out, 1, 0), [255, 0, 0, 255], "left of the sheet is bare plate");
    assert.deepEqual(pixel(out, 2, 0), [0, 255, 0, 255], "in the sheet is word");
    assert.deepEqual(pixel(out, 3, 0), [0, 255, 0, 255], "in the sheet is word");
    assert.deepEqual(pixel(out, 4, 0), [255, 0, 0, 255], "right of the sheet is bare plate");
    assertBytes(out);
  });

  test("a sheet that hangs off the frame only paints what is on it", () => {
    const ink = { x: 6, y: 0, w: 6, h: H, data: flatFrame(0, 255, 0).data };
    const out = compositeBehind(BLUE, RED, ink, flatCoverage(0));
    assert.deepEqual(pixel(out, 5, 0), [255, 0, 0, 255], "before the sheet");
    assert.deepEqual(pixel(out, 7, 0), [0, 255, 0, 255], "inside the sheet");
  });

  test("no ink means the plate is the whole background", () => {
    const out = compositeBehind(BLUE, RED, null, flatCoverage(0));
    assertIdentical(out, RED);
  });

  test("opacity of zero hides the words without touching anything else", () => {
    const out = compositeBehind(BLUE, RED, fullInk(0, 255, 0), flatCoverage(0), { opacity: 0 });
    assertIdentical(out, RED);
  });

  test("half opacity is half a word", () => {
    const out = compositeBehind(BLUE, RED, fullInk(0, 255, 0), flatCoverage(0), { opacity: 50 });
    const [r, g] = pixel(out, 0, 0);
    assert.ok(Math.abs(r - 128) <= 1, `red ${r}`);
    assert.ok(Math.abs(g - 128) <= 1, `green ${g}`);
  });

  test("a transparent source contributes its transparency to the subject", () => {
    // A fully transparent frame has nothing to draw, so the plate shows through
    // even where the mask says subject.
    const clear = flatFrame(255, 255, 255, 0);
    const out = compositeBehind(clear, RED, fullInk(0, 255, 0), flatCoverage(255));
    assert.deepEqual(pixel(out, 0, 0), [0, 255, 0, 255]);
  });

  test("no coverage plane leaves the picture alone", () => {
    // The subject could not be measured, and the only answer that cannot delete
    // it is to change nothing.
    const out = compositeBehind(BLUE, RED, fullInk(0, 255, 0), null);
    assertIdentical(out, BLUE);
  });

  test("never touches the buffers it was handed", () => {
    const original = flatFrame(1, 2, 3);
    const plate = flatFrame(4, 5, 6);
    const ink = fullInk(7, 8, 9);
    const coverage = flatCoverage(128);
    const before = [
      original.data.slice(),
      plate.data.slice(),
      ink.data.slice(),
      coverage.slice(),
    ];
    compositeBehind(original, plate, ink, coverage);
    before.forEach((snapshot, n) => {
      const live = [original.data, plate.data, ink.data, coverage][n];
      for (let i = 0; i < snapshot.length; i++) {
        assert.equal(live[i], snapshot[i], `input ${n} byte ${i} was written to`);
      }
    });
  });
});

describe("the mask edge", () => {
  test("a feather of zero hands the mask through untouched", async () => {
    const mask = flatMask(200);
    const coverage = await featherMask(mask, 0);
    assert.equal(coverage.length, W * H, "one byte per pixel, not four");
    for (let i = 0; i < coverage.length; i++) {
      assert.equal(coverage[i], 200, `plane byte ${i}`);
    }
  });

  test("a feather spreads the mask outwards, so an edge is a ramp", async () => {
    // Left half is subject, right half is not. Feathered, the first columns of
    // the background pick up some subject rather than stepping to zero.
    const half = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W / 2; x++) half[(y * W + x) * 4 + 3] = 255;
    }
    const mask = { width: W, height: H, data: half };

    const sharp = await featherMask(mask, 0);
    const soft = await featherMask(mask, 2);
    const row = 0;

    assert.equal(sharp[row * W + (W / 2 - 1)], 255, "the hard mask ends at a step");
    assert.ok(
      soft[row * W + (W / 2 - 1)] < 255,
      "the feathered edge is below full subject at the last subject pixel",
    );
    assert.ok(
      soft[row * W + (W / 2)] > 0,
      "the feathered edge has reached into the first background pixel",
    );

    for (let i = 0; i < soft.length; i++) {
      assert.ok(soft[i] >= 0 && soft[i] <= 255, `coverage byte ${i} is ${soft[i]}`);
    }
  });

  test("a feather averages, so it cannot invent coverage that was not there", async () => {
    const ramp = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < ramp.length; i += 4) ramp[i + 3] = (i / 4) * 37 % 256;
    const mask = { width: W, height: H, data: ramp };

    const radius = 3;
    const soft = await featherMask(mask, radius);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // The neighbourhood the pass actually reads, edge samples included.
        let peak = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = Math.min(H - 1, Math.max(0, y + dy));
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = Math.min(W - 1, Math.max(0, x + dx));
            peak = Math.max(peak, ramp[(yy * W + xx) * 4 + 3]);
          }
        }
        assert.ok(
          soft[y * W + x] <= peak + 1,
          `pixel ${y * W + x} is ${soft[y * W + x]} where the neighbourhood peaks at ${peak}`,
        );
      }
    }
  });

  test("a feather does not erode the inside of the subject", async () => {
    // A solid block of subject in the corner. Everything more than one radius
    // inside it must still read as full coverage, or the feather would be eating
    // the subject rather than joining to it.
    const block = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H / 2; y++) {
      for (let x = 0; x < W / 2; x++) block[(y * W + x) * 4 + 3] = 255;
    }
    const mask = { width: W, height: H, data: block };
    const soft = await featherMask(mask, 2);

    assert.equal(soft[0], 255, "the far corner of the block is untouched");
    assert.equal(soft[1 * W + 1], 255, "a pixel inside the block is untouched");
    assert.ok(soft[1 * W + (W / 2)] > 0, "but the join outside it has softened");
  });

  test("a feather of zero leaves a hard line, which is why it is not the default", () => {
    assert.notEqual(BEHIND_DEFAULTS.feather, 0);
    assert.ok(BEHIND_DEFAULTS.feather >= FEATHER_RANGE.min);
    assert.ok(BEHIND_DEFAULTS.feather <= FEATHER_RANGE.max);
  });

  test("the shadow can spread no further than the ink sheet was padded", () => {
    assert.equal(TEXT_SHADOW.reach, TEXT_SHADOW.blur + Math.max(TEXT_SHADOW.offsetX, TEXT_SHADOW.offsetY));
    assert.ok(TEXT_SHADOW.reach > 0);
  });
});

describe("fullCoverageMask", () => {
  test("a mask covering the frame is not a subject this tool can use", () => {
    assert.equal(fullCoverageMask(flatMask(255)), true);
    assert.equal(fullCoverageMask(flatMask(0)), false);
  });

  test("a subject with some background around it is fine", () => {
    assert.equal(fullCoverageMask(flatMask(128)), false);
    assert.ok(subjectMass(flatMask(128)) < FULL_COVERAGE_MASS);
  });

  test("an unreadable mask covers nothing", () => {
    assert.equal(fullCoverageMask(null), false);
    assert.equal(fullCoverageMask({ width: 0, height: 0, data: null }), false);
  });
});

describe("buildBehind", () => {
  test("runs the three steps end to end", async () => {
    const out = await buildBehind(
      BLUE,
      flatMask(0),
      fullInk(0, 255, 0),
      { plate: "original", opacity: 100 },
    );
    assertIdentical(out, GREEN, "an empty mask leaves the words on the picture");
    assertBytes(out);
  });

  test("a blurred plate and a solid plate are not the same picture", async () => {
    const probe = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        probe[i] = x === 0 ? 255 : 0;
        probe[i + 3] = 255;
      }
    }
    const picture = { width: W, height: H, data: probe };
    const blurred = await buildBehind(picture, flatMask(0), null, { plate: "blur", plateBlur: 2 });
    const solid = await buildBehind(picture, flatMask(0), null, { plate: "solid", plateColor: "#0000ff" });

    assert.notDeepEqual(pixel(blurred, 0, 0), pixel(solid, 0, 0));
    assert.deepEqual(pixel(solid, 0, 0), [0, 0, 255, 255]);
    assertBytes(blurred);
    assertBytes(solid);
  });

  test("a feather on a half mask lands the subject on the words", async () => {
    // Left half subject, right half background, words across the whole frame.
    const half = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W / 2; x++) half[(y * W + x) * 4 + 3] = 255;
    }
    const mask = { width: W, height: H, data: half };
    const out = await buildBehind(
      BLUE,
      mask,
      fullInk(255, 255, 255),
      { plate: "solid", plateColor: "#000000", feather: 0 },
    );

    assert.deepEqual(pixel(out, 0, 0), [0, 0, 255, 255], "subject, word hidden");
    assert.deepEqual(pixel(out, W - 1, 0), [255, 255, 255, 255], "background, word showing");
  });

  test("a cancelled pass gives no frame", async () => {
    const out = await buildBehind(
      BLUE,
      flatMask(255),
      fullInk(0, 255, 0),
      { plate: "blur", plateBlur: 4, feather: 3 },
      { isCancelled: () => true },
    );
    assert.equal(out, null);
  });
});

describe("what the panel says", () => {
  test("every message is a sentence, and none of them is empty", () => {
    for (const message of [
      EMPTY_TEXT_MESSAGE,
      ZERO_OPACITY_MESSAGE,
      NO_SUBJECT_MESSAGE,
      FULL_COVERAGE_MESSAGE,
    ]) {
      assert.equal(typeof message, "string");
      assert.ok(message.length > 0);
      assert.ok(message.endsWith("."), `"${message}" should read as a sentence`);
    }
  });

  test("no message carries a dash, an emoji or invented precision", () => {
    const messages = [
      EMPTY_TEXT_MESSAGE,
      ZERO_OPACITY_MESSAGE,
      NO_SUBJECT_MESSAGE,
      FULL_COVERAGE_MESSAGE,
      BEHIND_DEFAULTS.plateColor,
      ...PLATES.map((p) => p.label),
    ].join(" ");
    assert.equal(/[\u2013\u2014]/.test(messages), false, "no em or en dashes");
    assert.equal(/[\u{1f300}-\u{1faff}]/u.test(messages), false, "no emoji");
    assert.equal(/\d+(\.\d+)?\s?(ms|fps|mbps|ghz)\b/i.test(messages), false, "no invented timings");
    assert.equal(/\b\d+(\.\d+)?\s?(seconds?|minutes?|hours?)\b/i.test(messages), false, "no invented durations");
  });
});