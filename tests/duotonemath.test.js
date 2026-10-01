import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  duotoneKey,
  duotonePixel,
  hexToRgb,
  normalizeHex,
  rampColor,
  rampInto,
} from "../src/lib/core/duotonemath.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

/** Channel arrays, so a test can walk one channel without naming it. */
const toRgb = ([r, g, b]) => ({ r, g, b });
const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };
const SHADOW = [0x1e, 0x00, 0x3c];
const HIGHLIGHT = [0xf5, 0xe6, 0x42];
const SPOTIFY = { shadow: toRgb(SHADOW), highlight: toRgb(HIGHLIGHT) };
const FULL = { shadow: SPOTIFY.shadow, highlight: SPOTIFY.highlight, intensity: 1 };

/** One pixel through the effect, as bytes. */
function tone(r, g, b, settings = FULL) {
  return duotonePixel(r, g, b, settings, [0, 0, 0], [0, 0, 0]);
}

describe("hexToRgb", () => {
  test("reads a six digit colour", () => {
    assert.deepEqual(hexToRgb("#f7e733"), { r: 247, g: 231, b: 51 });
  });

  test("expands the three digit shorthand", () => {
    assert.deepEqual(hexToRgb("#f0a"), { r: 255, g: 0, b: 170 });
  });

  test("survives a missing hash, stray spaces and lowercase", () => {
    assert.deepEqual(hexToRgb(" f7E733 "), { r: 247, g: 231, b: 51 });
  });

  test("falls back to black rather than NaN", () => {
    // One bad value must not be able to turn the whole panel into NaN.
    assert.deepEqual(hexToRgb("nonsense"), BLACK);
    assert.deepEqual(hexToRgb(undefined), BLACK);
  });
});

describe("normalizeHex", () => {
  test("rewrites any spelling as lowercase six digits", () => {
    assert.equal(normalizeHex("#F0A"), "#ff00aa");
    assert.equal(normalizeHex("f0A"), "#ff00aa");
    assert.equal(normalizeHex("#0A0A2A"), "#0a0a2a");
  });

  test("says two spellings of one colour are the same colour", () => {
    // This is what lets a preset stay selected against a colour field.
    assert.equal(normalizeHex("#F0A"), normalizeHex("#ff00aa"));
  });
});

describe("rampColor", () => {
  test("t of 0 is the shadow colour", () => {
    assert.deepEqual(rampColor(0, SPOTIFY.shadow, SPOTIFY.highlight), SHADOW);
  });

  test("t of 1 is the highlight colour", () => {
    assert.deepEqual(rampColor(1, SPOTIFY.shadow, SPOTIFY.highlight), HIGHLIGHT);
  });

  test("runs on a straight line between the two", () => {
    const middle = rampColor(0.5, BLACK, WHITE);
    near(middle[0], 127.5, 1);
    near(middle[1], 127.5, 1);
    near(middle[2], 127.5, 1);
  });

  test("clamps below the interval", () => {
    const start = rampColor(0, SPOTIFY.shadow, SPOTIFY.highlight);
    assert.deepEqual(rampColor(-0.5, SPOTIFY.shadow, SPOTIFY.highlight), start);
    assert.deepEqual(rampColor(-9999, BLACK, WHITE), [0, 0, 0]);
  });

  test("clamps above the interval", () => {
    const end = rampColor(1, SPOTIFY.shadow, SPOTIFY.highlight);
    assert.deepEqual(rampColor(1.5, SPOTIFY.shadow, SPOTIFY.highlight), end);
    assert.deepEqual(rampColor(9999, BLACK, WHITE), [255, 255, 255]);
  });

  test("is monotonic on every channel", () => {
    // A ramp that dips would put a band of a third colour in the middle of
    // the picture, so every channel has to only ever rise or only ever fall.
    for (let channel = 0; channel < 3; channel += 1) {
      let previous = -Infinity;
      for (let i = 0; i <= 100; i += 1) {
        const value = rampColor(i / 100, SPOTIFY.shadow, SPOTIFY.highlight)[channel];
        if (HIGHLIGHT[channel] >= SHADOW[channel]) {
          assert.ok(value >= previous, `channel ${channel} fell at ${i / 100}`);
        } else {
          assert.ok(value <= previous, `channel ${channel} rose at ${i / 100}`);
        }
        previous = value;
      }
    }
  });

  test("a flat ramp is the same colour everywhere", () => {
    const grey = { r: 90, g: 90, b: 90 };
    for (const t of [0, 0.2, 0.5, 0.9, 1]) {
      assert.deepEqual(rampColor(t, grey, grey), [90, 90, 90]);
    }
  });

  test("stays inside 0 to 255 on a violent ramp", () => {
    for (const t of [-1, 0, 0.5, 1, 2]) {
      for (const channel of rampColor(t, { r: 0, g: 200, b: 255 }, { r: 255, g: 0, b: 3 })) {
        assert.ok(channel >= 0 && channel <= 255, `${channel} out of range at t ${t}`);
      }
    }
  });
});

describe("rampInto", () => {
  test("writes into the array it was given", () => {
    const scratch = [1, 2, 3];
    assert.equal(rampInto(0, SPOTIFY.shadow, SPOTIFY.highlight, scratch), scratch);
    assert.deepEqual(scratch, [SPOTIFY.shadow.r, SPOTIFY.shadow.g, SPOTIFY.shadow.b]);
  });
});

describe("duotonePixel", () => {
  test("mid grey lands between the two colours", () => {
    // 128 grey is t = 0.502, so the ramp colour is the two presets mixed
    // about half way, and every channel has to sit between its own endpoints.
    const out = tone(128, 128, 128);
    for (let channel = 0; channel < 3; channel += 1) {
      const lo = Math.min(SHADOW[channel], HIGHLIGHT[channel]);
      const hi = Math.max(SHADOW[channel], HIGHLIGHT[channel]);
      assert.ok(out[channel] > lo && out[channel] < hi, `channel ${channel} = ${out[channel]}`);
    }
  });

  test("black becomes the shadow colour and white the highlight colour", () => {
    assert.deepEqual(tone(0, 0, 0), SHADOW);
    assert.deepEqual(tone(255, 255, 255), HIGHLIGHT);
  });

  test("intensity 0 is the identity", () => {
    const out = tone(30, 140, 220, { ...FULL, intensity: 0 });
    assert.deepEqual(out, [30, 140, 220]);
  });

  test("intensity 1 is the bare ramp", () => {
    const out = tone(64, 64, 64, { ...FULL, intensity: 1 });
    assert.deepEqual(out, rampColor(64 / 255, SPOTIFY.shadow, SPOTIFY.highlight));
  });

  test("half intensity sits between the original and the full ramp", () => {
    const original = tone(200, 10, 90, { ...FULL, intensity: 0 });
    const full = tone(200, 10, 90, { ...FULL, intensity: 1 });
    const half = tone(200, 10, 90, { ...FULL, intensity: 0.5 });

    for (let channel = 0; channel < 3; channel += 1) {
      const lo = Math.min(original[channel], full[channel]);
      const hi = Math.max(original[channel], full[channel]);
      assert.ok(half[channel] >= lo && half[channel] <= hi, `channel ${channel}`);
    }
  });

  test("measures brightness, not the dominant channel", () => {
    // A saturated red and a saturated blue have the same dominant channel
    // and very different brightness, so they must not land on the same tone.
    const red = tone(255, 0, 0);
    const blue = tone(0, 0, 255);
    assert.notDeepEqual(red, blue);
    // Red is far brighter than blue, so it must be much nearer the highlight.
    assert.ok(red[0] > red[2], "red should read brighter than blue");
  });

  test("an intensity outside 0 to 1 is clamped, not extrapolated", () => {
    assert.deepEqual(tone(128, 128, 128, { ...FULL, intensity: -1 }), tone(128, 128, 128, { ...FULL, intensity: 0 }));
    assert.deepEqual(tone(128, 128, 128, { ...FULL, intensity: 4 }), tone(128, 128, 128, { ...FULL, intensity: 1 }));
  });

  test("writes into the caller's scratch arrays", () => {
    const ramp = [0, 0, 0];
    const out = [0, 0, 0];
    assert.equal(duotonePixel(128, 128, 128, FULL, ramp, out), out);
    assert.deepEqual(ramp, rampColor(128 / 255, SPOTIFY.shadow, SPOTIFY.highlight));
  });
  test("every channel is an integer byte", () => {
    for (let value = 0; value <= 255; value += 5) {
      for (const channel of tone(value, 200 - value, value / 2)) {
        assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255, `${channel}`);
      }
    }
  });
});

describe("duotoneKey", () => {
  test("settings that draw the same picture share a key", () => {
    assert.equal(duotoneKey(FULL), duotoneKey({ ...FULL }));
  });

  test("every setting changes the key", () => {
    const base = duotoneKey(FULL);
    assert.notEqual(base, duotoneKey({ ...FULL, intensity: 0.5 }));
    assert.notEqual(base, duotoneKey({ ...FULL, shadow: { r: 1, g: 0, b: 0x3c } }));
    assert.notEqual(base, duotoneKey({ ...FULL, highlight: { r: 0xf5, g: 0xe6, b: 43 } }));
  });

  test("the shadow and the highlight cannot be swapped into the same key", () => {
    const shadowFirst = duotoneKey({
      shadow: { r: 1, g: 2, b: 3 },
      highlight: { r: 4, g: 5, b: 6 },
      intensity: 1,
    });
    const highlightFirst = duotoneKey({
      shadow: { r: 4, g: 5, b: 6 },
      highlight: { r: 1, g: 2, b: 3 },
      intensity: 1,
    });
    assert.notEqual(shadowFirst, highlightFirst);
  });
});
