import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  angleLabel,
  bboxFor,
  cssTransform,
  normalizeAngle,
} from "../src/lib/core/transform.js";
import { formatBytes, inferFormat, looksLikeImage, renameExtension } from "../src/lib/core/format.js";

const W = 400;
const H = 200;
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

describe("normalizeAngle", () => {
  test("wraps into 0-360", () => {
    assert.equal(normalizeAngle(-90), 270);
    assert.equal(normalizeAngle(450), 90);
    assert.equal(normalizeAngle(0), 0);
  });

  test("snaps to quarter turns, killing float dust", () => {
    // Without snapping, cos(90deg) = 6.1e-17 and ceil() adds a phantom pixel.
    assert.equal(normalizeAngle(90.0000001), 90);
    assert.equal(normalizeAngle(179.9999999), 180);
  });

  test("leaves a genuine off-axis angle alone", () => {
    near(normalizeAngle(31.5), 31.5);
  });
});

describe("bboxFor", () => {
  test("quarter turns swap the axes exactly", () => {
    assert.deepEqual(bboxFor(W, H, 90), { w: H, h: W });
    assert.deepEqual(bboxFor(W, H, 270), { w: H, h: W });
    assert.deepEqual(bboxFor(W, H, 180), { w: W, h: H });
    assert.deepEqual(bboxFor(W, H, 0), { w: W, h: H });
  });

  test("a quarter turn adds no stray pixel", () => {
    for (const angle of [90, 180, 270, 360, -90, 450]) {
      const box = bboxFor(W, H, angle);
      assert.ok(Number.isInteger(box.w) && box.w === Math.round(box.w));
    }
  });

  test("45 degrees on a square is the diagonal", () => {
    const box = bboxFor(100, 100, 45);
    near(box.w, Math.ceil(100 * Math.SQRT2));
    near(box.w, box.h);
  });

  test("always returns at least one pixel", () => {
    const box = bboxFor(1, 1, 33);
    assert.ok(box.w >= 1 && box.h >= 1);
  });
});

describe("angleLabel", () => {
  test("drops the decimal on whole degrees", () => {
    assert.equal(angleLabel(90), "90°");
    assert.equal(angleLabel(-45), "315°");
  });

  test("keeps one decimal for fine angles", () => {
    assert.equal(angleLabel(31.5), "31.5°");
  });
});

describe("cssTransform", () => {
  test("is none when there is nothing pending", () => {
    assert.equal(cssTransform({}), "none");
    assert.equal(cssTransform({ angle: 0, flipX: false, flipY: false }), "none");
  });

  test("composes rotation and flip", () => {
    const out = cssTransform({ angle: 90, flipX: true });
    assert.match(out, /rotate\(90deg\)/);
    assert.match(out, /scale\(-1, 1\)/);
  });
});

describe("inferFormat", () => {
  test("prefers the MIME type", () => {
    assert.equal(inferFormat("image/jpeg", "x.png"), "jpeg");
    assert.equal(inferFormat("image/webp"), "webp");
  });

  test("reports the real source format for anything it can open", () => {
    // The important case: an AVIF must not be labelled png, or a plain
    // download would hand back AVIF bytes under a .png name.
    assert.equal(inferFormat("image/avif"), "avif");
    assert.equal(inferFormat("", "photo.HEIC"), "png");
  });

  test("falls back to the extension", () => {
    assert.equal(inferFormat("", "a.JPG"), "jpeg");
    assert.equal(inferFormat("", "a.webp"), "webp");
    assert.equal(inferFormat("", "noextension"), "png");
  });
});

describe("renameExtension", () => {
  test("uses jpg for jpeg", () => {
    assert.equal(renameExtension("photo.jpeg", "jpeg"), "photo.jpg");
    assert.equal(renameExtension("photo.png", "png"), "photo.png");
    assert.equal(renameExtension("photo.avif", "png"), "photo.png");
  });

  test("always produces a name, even from an extension-only string", () => {
    assert.equal(renameExtension(".png", "png"), "image.png");
  });
});

describe("looksLikeImage", () => {
  test("accepts an image mime", () => {
    assert.ok(looksLikeImage({ type: "image/png", name: "a" }));
  });

  test("accepts a known extension when the browser reports no type", () => {
    assert.ok(looksLikeImage({ type: "", name: "holiday.JPEG" }));
  });

  test("rejects a document", () => {
    assert.equal(looksLikeImage({ type: "application/pdf", name: "a.pdf" }), false);
    assert.equal(looksLikeImage({ type: "", name: "notes.txt" }), false);
    assert.equal(looksLikeImage(null), false);
  });
});

describe("formatBytes", () => {
  test("scales the unit", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.equal(formatBytes(5 * 1024 * 1024), "5.00 MB");
  });
});
