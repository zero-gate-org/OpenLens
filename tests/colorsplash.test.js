import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_COLOUR_ID,
  SPLASH_COLOURS,
  familyWeight,
  hslToRgb,
  hueDistance,
  luma,
  rgbToHsl,
  splashKey,
  splashPixel,
} from "../src/lib/core/colorsplash.js";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

/** A byte triple, which is what a decoded image hands the maths. */
const bytes = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const family = (id) => SPLASH_COLOURS.find((c) => c.id === id);

/** Run one pixel through the splash and return bytes. */
function splash(r, g, b, coverage, which) {
  const hsl = [0, 0, 0];
  const out = [0, 0, 0];
  splashPixel(r, g, b, coverage, family(which), hsl, out);
  return out.map((v) => v * 255);
}

const ORIGINAL = DEFAULT_COLOUR_ID;

describe("luma", () => {
  test("black is 0 and white is 1", () => {
    near(luma(0, 0, 0), 0);
    near(luma(255, 255, 255), 1);
  });

  test("a neutral grey is its own value, so greying it is a no-op", () => {
    near(luma(128, 128, 128), 128 / 255);
    near(luma(64, 64, 64), 64 / 255);
  });

  test("green carries the most weight, blue the least", () => {
    // Rec.709 weights. Worth pinning: the whole background pass is built on
    // this, and a swap of the ends is a visible shift in skin and foliage.
    assert.ok(luma(0, 255, 0) > luma(255, 0, 0));
    assert.ok(luma(255, 0, 0) > luma(0, 0, 255));
  });
});

describe("splashPixel: grey pixels", () => {
  test("a pure grey pixel is unchanged by the pass", () => {
    for (const v of [0, 32, 128, 200, 255]) {
      const [r, g, b] = splash(v, v, v, 1, ORIGINAL);
      near(r, v, 0.5);
      near(g, v, 0.5);
      near(b, v, 0.5);
    }
  });

  test("a grey pixel is also unchanged in a colour family", () => {
    const [r, g, b] = splash(120, 120, 120, 1, "red");
    near(r, 120, 0.5);
    near(g, 120, 0.5);
    near(b, 120, 0.5);
  });
});

describe("splashPixel: colour", () => {
  test("a fully saturated red stays red in the red family", () => {
    const [r, g, b] = splash(255, 0, 0, 1, "red");
    near(r, 255, 0.5);
    near(g, 0, 0.5);
    near(b, 0, 0.5);
  });

  test("the same red loses its colour in the blue family", () => {
    const [r, g, b] = splash(255, 0, 0, 1, "blue");
    // Red is as far from blue as the wheel allows, so the pixel ends up as
    // its own luma: a neutral.
    for (const channel of [r, g, b]) near(channel, luma(255, 0, 0) * 255, 0.5);
    near(r, g, 0.5);
    near(g, b, 0.5);
  });

  test("a colour in its own family survives at full strength", () => {
    for (const preset of SPLASH_COLOURS) {
      if (preset.hue === null) continue;
      const [r, g, b] = bytes(preset.hex);
      const out = splash(r, g, b, 1, preset.id);
      near(out[0], r, 0.5);
      near(out[1], g, 0.5);
      near(out[2], b, 0.5);
    }
  });

  test("desaturation does not change luminance", () => {
    // The point of pulling toward luma rather than toward a fixed grey: the
    // background keeps its exposure, so a dark subject does not gain a fog.
    const [r, g, b] = splash(180, 60, 200, 0, "red");
    near(r, luma(180, 60, 200) * 255, 0.5);
    near(g, r, 0.5);
    near(b, r, 0.5);
  });

  test("no coverage is grey whatever the family says", () => {
    for (const preset of SPLASH_COLOURS) {
      const [r, g, b] = splash(20, 220, 90, 0, preset.id);
      near(r, g, 0.5);
      near(g, b, 0.5);
    }
  });

  test("half coverage is halfway between colour and grey", () => {
    const [r, g, b] = splash(255, 0, 0, 0.5, "red");
    const grey = luma(255, 0, 0) * 255;
    near(r, 255 + (grey - 255) * 0.5, 0.5);
    near(g, 0 + (grey - 0) * 0.5, 0.5);
    near(b, 0 + (grey - 0) * 0.5, 0.5);
  });

  test("coverage is clamped by being a mix, not by a branch", () => {
    // A feathered mask can overshoot on a hard edge. The result must stay in
    // range rather than wrapping to the far end of the channel.
    for (const coverage of [-0.2, 1.4]) {
      const [r, g, b] = splash(200, 40, 40, coverage, "red");
      for (const channel of [r, g, b]) {
        assert.ok(channel >= -0.001 && channel <= 255.001, `${channel} out of range`);
      }
    }
  });
});

describe("hueDistance", () => {
  test("is zero for a hue and itself", () => {
    near(hueDistance(0.25, 0.25), 0);
  });

  test("never exceeds half a turn", () => {
    near(hueDistance(0, 0.5), 0.5);
    assert.ok(hueDistance(0, 0.9) <= 0.5);
  });

  test("wraps around the ends of the wheel", () => {
    // Red sits at 0, so a colour at 0.98 is next to it, not opposite.
    near(hueDistance(0, 0.98), 0.02);
    near(hueDistance(0.98, 0.02), 0.04);
  });
});

describe("familyWeight", () => {
  test("the family hue keeps all of itself", () => {
    near(familyWeight(0.395, family("green")), 1);
  });

  test("a hue one width away keeps nothing", () => {
    const green = family("green");
    near(familyWeight(green.hue + green.width, green), 0);
    near(familyWeight(green.hue - green.width, green), 0);
  });

  test("is halfway out at half a width", () => {
    const blue = family("blue");
    near(familyWeight(blue.hue + blue.width / 2, blue), 0.5, 1e-9);
  });

  test("falls off with distance", () => {
    const red = family("red");
    let previous = 1.1;
    for (let d = 0; d < red.width; d += red.width / 12) {
      const w = familyWeight(red.hue + d, red);
      assert.ok(w <= previous, `not monotonic at ${d}: ${w} > ${previous}`);
      assert.ok(w >= 0 && w <= 1, `${w} out of range`);
      previous = w;
    }
  });

  test("Original keeps every hue", () => {
    for (const hue of [0, 0.25, 0.5, 0.75, 0.999]) {
      near(familyWeight(hue, family(ORIGINAL)), 1);
    }
  });

  test("a missing family keeps everything rather than greying the frame", () => {
    near(familyWeight(0.5, null), 1);
  });
});

describe("rgbToHsl / hslToRgb", () => {
  test("a grey has no saturation and no hue to speak of", () => {
    const hsl = rgbToHsl(0.4, 0.4, 0.4, [0, 0, 0]);
    near(hsl[1], 0);
    near(hsl[2], 0.4);
  });

  test("a fully saturated red is hue 0 at full saturation", () => {
    const hsl = rgbToHsl(1, 0, 0, [0, 0, 0]);
    near(hsl[0], 0);
    near(hsl[1], 1);
    near(hsl[2], 0.5);
  });

  test("round-trips across the cube", () => {
    const hsl = [0, 0, 0];
    const rgb = [0, 0, 0];
    for (const r of [0, 0.2, 0.5, 0.75, 1]) {
      for (const g of [0, 0.35, 0.6, 1]) {
        for (const b of [0, 0.1, 0.9, 1]) {
          rgbToHsl(r, g, b, hsl);
          hslToRgb(hsl[0], hsl[1], hsl[2], rgb);
          near(rgb[0], r, 1e-9);
          near(rgb[1], g, 1e-9);
          near(rgb[2], b, 1e-9);
        }
      }
    }
  });

  test("round-trips every preset swatch", () => {
    // The swatch is what the operator picks, so a mismatch between it and the
    // hue it declares would show up as a colour they did not choose.
    const hsl = [0, 0, 0];
    const rgb = [0, 0, 0];
    for (const preset of SPLASH_COLOURS) {
      const [r, g, b] = bytes(preset.hex).map((v) => v / 255);
      rgbToHsl(r, g, b, hsl);
      hslToRgb(hsl[0], hsl[1], hsl[2], rgb);
      near(rgb[0], r, 1e-9);
      near(rgb[1], g, 1e-9);
      near(rgb[2], b, 1e-9);
    }
  });
});

describe("SPLASH_COLOURS", () => {
  test("ids are unique and every entry is labelled", () => {
    const ids = new Set();
    for (const preset of SPLASH_COLOURS) {
      assert.ok(preset.id && !ids.has(preset.id), `bad id: ${preset.id}`);
      ids.add(preset.id);
      assert.ok(preset.label.length > 0, `${preset.id} has no label`);
      assert.match(preset.hex, /^#[0-9a-f]{6}$/i, `${preset.id} hex`);
    }
  });

  test("the default preset is in the list", () => {
    assert.ok(SPLASH_COLOURS.some((c) => c.id === DEFAULT_COLOUR_ID));
  });

  test("only Original has no hue", () => {
    const open = SPLASH_COLOURS.filter((c) => c.hue === null);
    assert.equal(open.length, 1);
    assert.equal(open[0].id, ORIGINAL);
  });

  test("each declared hue is the hue of its own swatch", () => {
    const hsl = [0, 0, 0];
    for (const preset of SPLASH_COLOURS) {
      if (preset.hue === null) continue;
      const [r, g, b] = bytes(preset.hex).map((v) => v / 255);
      rgbToHsl(r, g, b, hsl);
      // A tolerance rather than an equality: the swatch is 8 bits per channel,
      // so its hue is only pinned to about half a step.
      near(hsl[0], preset.hue, 1 / 128);
    }
  });

  test("no family swallows the colour of another", () => {
    // The presets are crowded: orange and yellow sit 21 degrees apart. If one
    // family kept another's hue outright, picking it would highlight two
    // colours and the control would be lying about what it does.
    for (const a of SPLASH_COLOURS) {
      for (const b of SPLASH_COLOURS) {
        if (a === b || a.hue === null || b.hue === null) continue;
        assert.ok(
          familyWeight(b.hue, a) < 0.5,
          `${a.id} keeps ${b.id} at ${familyWeight(b.hue, a)}`,
        );
      }
    }
  });
});

describe("splashKey", () => {
  test("changes with the feather and with the family", () => {
    const a = splashKey(family("red"), 5);
    assert.notEqual(a, splashKey(family("red"), 6));
    assert.notEqual(a, splashKey(family("blue"), 5));
  });

  test("is stable for the same settings", () => {
    assert.equal(splashKey(family("green"), 5), splashKey(family("green"), 5));
  });

  test("survives a missing family", () => {
    assert.equal(typeof splashKey(null, 5), "string");
  });
});
