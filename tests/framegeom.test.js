import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_OUTPUT_PIXELS,
  MAX_OUTPUT_SIDE,
  MIN_CAPTION_SIZE,
  captionBand,
  captionLayout,
  cleanBorders,
  cornerRadius,
  fitBorders,
  frameGeometry,
  hexToRgba,
  isIdentity,
  maxCorner,
  outputSize,
  uniformBorders,
} from "../src/lib/core/framegeom.js";

/** A measurement that stands in for a canvas: half an em per character. */
const measure = (text, size) => String(text).length * size * 0.5;

const IMG_W = 1000;
const IMG_H = 800;

/** The frame, as the two axes add up, plus the opening it leaves. */
function geometry(borders, radius = 0) {
  return frameGeometry({ width: IMG_W, height: IMG_H, borders, cornerRadius: radius });
}

describe("output size", () => {
  test("is the input plus the sum of the borders", () => {
    const out = outputSize(1000, 800, { top: 40, right: 30, bottom: 140, left: 20 });
    assert.equal(out.width, 1000 + 20 + 30);
    assert.equal(out.height, 800 + 40 + 140);
  });

  test("a uniform border adds it on both axes", () => {
    const out = outputSize(1000, 800, uniformBorders(32));
    assert.equal(out.width, 1064);
    assert.equal(out.height, 864);
  });

  test("asymmetric edges each add to their own axis", () => {
    const g = geometry({ top: 0, right: 80, bottom: 0, left: 80 });
    assert.equal(g.width, IMG_W + 160);
    assert.equal(g.height, IMG_H);
  });

  test("never takes a single pixel from the picture", () => {
    // The frame is added around the image, so the picture keeps its own size and
    // sits at (left, top) inside the result.
    const g = geometry({ top: 44, right: 44, bottom: 150, left: 44 });
    assert.equal(g.picture.width, IMG_W);
    assert.equal(g.picture.height, IMG_H);
    assert.deepEqual(g.opening, { x: 44, y: 44, w: 1000, h: 800 });
    assert.equal(g.opening.x + g.opening.w, g.width - 44);
    assert.equal(g.opening.y + g.opening.h, g.height - 150);
  });
});

describe("identity", () => {
  test("all-zero borders with no shadow is exactly the input", () => {
    const g = geometry(cleanBorders(undefined));
    assert.equal(g.width, IMG_W);
    assert.equal(g.height, IMG_H);
  });

  test("zero borders, no shadow and no radius is the identity", () => {
    assert.equal(
      isIdentity({
        borders: { top: 0, right: 0, bottom: 0, left: 0 },
        cornerRadius: 0,
        shadowEnabled: false,
        shadowOpacity: 0,
        transparentBg: false,
      }),
      true,
    );
  });

  test("a single pixel of border is not the identity", () => {
    assert.equal(
      isIdentity({
        borders: { top: 1, right: 0, bottom: 0, left: 0 },
        cornerRadius: 0,
        shadowEnabled: false,
        shadowOpacity: 0,
        transparentBg: false,
      }),
      false,
    );
  });

  test("a corner radius on its own is not the identity", () => {
    // Zero borders and a radius cuts the picture's own corners, so it is a
    // change even though no border was added.
    assert.equal(
      isIdentity({
        borders: { top: 0, right: 0, bottom: 0, left: 0 },
        cornerRadius: 8,
        shadowEnabled: false,
        shadowOpacity: 0,
        transparentBg: false,
      }),
      false,
    );
  });

  test("a shadow at zero opacity casts nothing, so it is not a change", () => {
    const settings = {
      borders: { top: 0, right: 0, bottom: 0, left: 0 },
      cornerRadius: 0,
      shadowEnabled: true,
      shadowOpacity: 0,
      transparentBg: false,
    };
    assert.equal(isIdentity(settings), true);
    assert.equal(isIdentity({ ...settings, shadowOpacity: 20 }), false);
  });
});

describe("limits", () => {
  test("a huge frame is clamped, not attempted", () => {
    const fit = fitBorders(4000, 3000, uniformBorders(9000));
    assert.equal(fit.limited, true);
    const out = outputSize(4000, 3000, fit.borders);
    assert.ok(out.width <= MAX_OUTPUT_SIDE, `${out.width} > ${MAX_OUTPUT_SIDE}`);
    assert.ok(out.height <= MAX_OUTPUT_SIDE, `${out.height} > ${MAX_OUTPUT_SIDE}`);
    assert.ok(out.width * out.height <= MAX_OUTPUT_PIXELS);
  });

  test("a modest frame is left exactly as asked", () => {
    const fit = fitBorders(1000, 800, uniformBorders(40));
    assert.equal(fit.limited, false);
    assert.deepEqual(fit.borders, uniformBorders(40));
    assert.equal(fit.scale, 1);
  });

  test("clamping keeps the frame's proportions", () => {
    // Sides stay smaller than the bottom, because both axes shrank by the same
    // factor. A frame that came back lopsided would not be the frame that was
    // asked for.
    const fit = fitBorders(7000, 5000, { top: 100, right: 100, bottom: 900, left: 100 });
    assert.equal(fit.limited, true);
    assert.ok(fit.borders.bottom > fit.borders.top, "bottom lost its share of the frame");
    assert.ok(fit.borders.top > 0, "the sides were rounded away entirely");
    const out = outputSize(7000, 5000, fit.borders);
    assert.ok(out.width * out.height <= MAX_OUTPUT_PIXELS);
  });

  test("a picture already over the area ceiling gets no frame at all", () => {
    const fit = fitBorders(16000, 16000, uniformBorders(100));
    assert.equal(fit.overArea, true);
    assert.deepEqual(fit.borders, { top: 0, right: 0, bottom: 0, left: 0 });
  });

  test("a picture already over the side ceiling gets no frame either", () => {
    const fit = fitBorders(MAX_OUTPUT_SIDE, 400, uniformBorders(50));
    assert.equal(fit.limited, true);
    assert.equal(fit.borders.right, 0);
    assert.equal(fit.borders.left, 0);
  });
});

describe("corner radius", () => {
  test("clamps at half the shorter side, so it is a pill not an inversion", () => {
    assert.equal(maxCorner(400, 200), 100);
    assert.equal(cornerRadius(400, 400, 200), 100);
    assert.equal(cornerRadius(100000, 400, 200), 100);
  });

  test("a modest radius passes through untouched", () => {
    assert.equal(cornerRadius(12, 1000, 800), 12);
  });

  test("a radius on a zero-radius box clamps to zero", () => {
    assert.equal(cornerRadius(40, 0, 0), 0);
  });

  test("the geometry reports the clamp so the panel can say so", () => {
    const g = geometry(uniformBorders(40), 900);
    assert.equal(g.radiusWanted, 900);
    assert.equal(g.radius, maxCorner(g.width, g.height));
    assert.equal(g.radiusClamped, true);
  });

  test("a radius inside the limit is not reported as clamped", () => {
    const g = geometry(uniformBorders(40), 8);
    assert.equal(g.radius, 8);
    assert.equal(g.radiusClamped, false);
  });
});

describe("caption band", () => {
  test("starts where the picture ends", () => {
    const g = geometry({ top: 40, right: 40, bottom: 150, left: 40 });
    const band = captionBand({ opening: g.opening, borders: g.borders });
    assert.equal(band.y, g.opening.y + g.opening.h);
    assert.equal(band.h, 150);
    assert.equal(band.w, g.opening.w);
    assert.equal(band.x, g.opening.x);
  });

  test("never overlaps the opening, for any borders at all", () => {
    const cases = [
      { top: 0, right: 0, bottom: 1, left: 0 },
      { top: 0, right: 0, bottom: 300, left: 0 },
      { top: 300, right: 0, bottom: 1, left: 0 },
      { top: 1, right: 300, bottom: 300, left: 300 },
      uniformBorders(1),
      uniformBorders(400),
      { top: 0, right: 0, bottom: 0, left: 0 },
    ];

    for (const borders of cases) {
      const g = geometry(borders);
      const band = captionBand({ opening: g.opening, borders: g.borders });
      if (!band) continue;
      assert.ok(
        band.y >= g.opening.y + g.opening.h - 1e-9,
        `band top ${band.y} overlaps opening bottom ${g.opening.y + g.opening.h}`,
      );
      assert.ok(band.y + band.h <= g.height + 1e-9);
      assert.ok(band.x >= g.opening.x - 1e-9);
      assert.ok(band.x + band.w <= g.width - g.borders.right + 1e-9);
    }
  });

  test("no bottom band means no caption band, not a band of zero height", () => {
    const g = geometry({ top: 40, right: 40, bottom: 0, left: 40 });
    assert.equal(captionBand({ opening: g.opening, borders: g.borders }), null);
  });
});

describe("caption layout", () => {
  const band = { x: 40, y: 840, w: 1000, h: 150 };

  test("an empty caption draws nothing at all", () => {
    const out = captionLayout({ band, text: "", date: "", size: 24, measure });
    assert.equal(out.primary, null);
    assert.equal(out.secondary, null);
    assert.deepEqual(out.dropped, []);
    assert.equal(out.tooWide, false);
  });

  test("whitespace is not a caption", () => {
    const out = captionLayout({ band, text: "   ", date: "", size: 24, measure });
    assert.equal(out.primary, null);
  });

  test("a caption that fits keeps the size it was given", () => {
    const out = captionLayout({ band, text: "Hello", date: "", size: 24, measure });
    assert.equal(out.primary.size, 24);
    assert.equal(out.shrunk, false);
    assert.equal(out.tooWide, false);
  });

  test("a caption too wide for the band is shrunk to fit, not cut", () => {
    const out = captionLayout({ band, text: "x".repeat(120), date: "", size: 24, measure });
    assert.equal(out.shrunk, true);
    assert.equal(out.tooWide, false);
    assert.ok(out.primary.width <= out.availWidth);
    assert.ok(out.primary.size < 24);
    assert.ok(out.primary.size >= MIN_CAPTION_SIZE);
  });

  test("a caption too wide even at the floor size is reported", () => {
    // 200 characters at the 8 px floor is 800 px against a band that only has
    // what the padding leaves. It cannot fit at any size, so it is reported
    // rather than silently cropped.
    const tight = { x: 40, y: 840, w: 200, h: 150 };
    const out = captionLayout({ band: tight, text: "x".repeat(200), date: "", size: 24, measure });
    assert.equal(out.tooWide, true);
    assert.equal(out.primary.size, MIN_CAPTION_SIZE);
    assert.ok(out.primary.width > out.availWidth);
  });

  test("the date line is smaller than the caption", () => {
    const out = captionLayout({ band, text: "Hello", date: "12 Mar 2026", size: 24, measure });
    assert.ok(out.secondary.size < out.primary.size);
    assert.ok(out.secondary.size >= MIN_CAPTION_SIZE);
  });

  test("both lines stay inside the band at every position", () => {
    for (let position = 0; position <= 100; position += 25) {
      const out = captionLayout({ band, text: "Hello", date: "12 Mar 2026", size: 24, position, measure });
      assert.deepEqual(out.dropped, []);
      for (const line of [out.primary, out.secondary]) {
        assert.ok(line.y - line.height / 2 >= band.y - 1e-9, `top escaped at ${position}`);
        assert.ok(line.y + line.height / 2 <= band.y + band.h + 1e-9, `bottom escaped at ${position}`);
      }
    }
  });

  test("a band too short for both lines drops the date, and says so", () => {
    // 22 px is under two minimum type lines and the gap between them, so no
    // amount of shrinking can hold both. The date goes first.
    const thin = { x: 40, y: 878, w: 1000, h: 22 };
    const out = captionLayout({ band: thin, text: "Hello", date: "12 Mar 2026", size: 24, measure });
    assert.deepEqual(out.dropped, ["date"]);
    assert.equal(out.secondary, null);
    assert.ok(out.primary);
    assert.ok(out.primary.y - out.primary.height / 2 >= thin.y - 1e-9);
    assert.ok(out.primary.y + out.primary.height / 2 <= thin.y + thin.h + 1e-9);
  });

  test("a band too short for the caption alone drops it rather than the picture", () => {
    const thin = { x: 40, y: 880, w: 1000, h: 6 };
    const out = captionLayout({ band: thin, text: "Hello", date: "", size: 24, measure });
    assert.equal(out.primary, null);
    assert.deepEqual(out.dropped, ["text"]);
  });

  test("no band means both lines are reported as dropped", () => {
    const out = captionLayout({ band: null, text: "Hello", date: "12 Mar 2026", size: 24, measure });
    assert.equal(out.primary, null);
    assert.deepEqual(out.dropped, ["text", "date"]);
  });

  test("alignment moves the anchor, not the band", () => {
    const left = captionLayout({ band, text: "Hello", date: "", size: 24, align: "left", measure });
    const right = captionLayout({ band, text: "Hello", date: "", size: 24, align: "right", measure });
    const centre = captionLayout({ band, text: "Hello", date: "", size: 24, align: "center", measure });
    assert.equal(left.primary.align, "left");
    assert.ok(left.primary.x < centre.primary.x);
    assert.ok(centre.primary.x < right.primary.x);
  });

  test("falls back to an estimate when there is no canvas to measure with", () => {
    const out = captionLayout({ band, text: "Hello", date: "", size: 24 });
    assert.ok(out.primary.width > 0);
    assert.equal(out.primary.size, 24);
  });
});

describe("hexToRgba", () => {
  test("spells the channels out", () => {
    assert.equal(hexToRgba("#000000", 0.5), "rgba(0, 0, 0, 0.5)");
    assert.equal(hexToRgba("#ffffff", 1), "rgba(255, 255, 255, 1)");
    assert.equal(hexToRgba("#3366ff", 0.25), "rgba(51, 102, 255, 0.25)");
  });

  test("clamps the alpha into 0..1", () => {
    assert.equal(hexToRgba("#123456", 5), "rgba(18, 52, 86, 1)");
    assert.equal(hexToRgba("#123456", -2), "rgba(18, 52, 86, 0)");
  });

  test("expands a short form and survives rubbish", () => {
    assert.equal(hexToRgba("#f00", 1), "rgba(255, 0, 0, 1)");
    assert.equal(hexToRgba("nonsense", 1), "rgba(0, 0, 0, 1)");
  });
});