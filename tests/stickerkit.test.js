import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CATALOGUE,
  CATALOGUE_OPTIONS,
  MAX_STICKER_SIZE,
  MIN_STICKER_SIZE,
  RASTER_MAX,
  RASTER_MIN,
  boundsOf,
  clampOpacity,
  clampRotation,
  clampSize,
  containsPoint,
  createItem,
  frameStatus,
  insertItem,
  invertMatrix,
  itemBox,
  matrixString,
  moveItemId,
  normalizeDegrees,
  paintOrder,
  placementMatrix,
  placementPoint,
  rasterSizeFor,
  removeItem,
  reorderItem,
  stickerAspect,
  stickerByKey,
  stickerDataUrl,
  stickerSvgMarkup,
  transformPoint,
  viewBoxSize,
} from "../src/lib/core/stickerkit.js";

const W = 1200;
const H = 900;
const FRAME = { width: W, height: H };
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// ---------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------

describe("CATALOGUE", () => {
  test("is not empty", () => {
    assert.ok(CATALOGUE.length > 0, "the catalogue has no entries");
  });

  test("every entry has a name, a key and non-empty path data", () => {
    for (const def of CATALOGUE) {
      assert.equal(typeof def.key, "string");
      assert.ok(def.key.trim() !== "", `key is empty for ${def.name}`);
      assert.equal(typeof def.name, "string");
      assert.ok(def.name.trim() !== "", `name is empty for ${def.key}`);
      assert.equal(typeof def.body, "string");
      assert.ok(def.body.trim() !== "", `path data is empty for ${def.key}`);
      // A body of pure whitespace would render as nothing at all.
      assert.match(def.body, /<(path|polygon|circle|rect|ellipse|line)\b/, `${def.key} draws no shape`);
    }
  });

  test("every entry has a viewBox of four positive numbers", () => {
    for (const def of CATALOGUE) {
      assert.equal(typeof def.viewBox, "string");
      const parts = def.viewBox.trim().split(/[\s,]+/);
      assert.equal(parts.length, 4, `${def.key} viewBox is "${def.viewBox}"`);
      const nums = parts.map(Number);
      for (const n of nums) assert.ok(Number.isFinite(n), `${def.key} viewBox has "${n}"`);
      assert.ok(nums[2] > 0 && nums[3] > 0, `${def.key} viewBox has no area`);
    }
  });

  test("keys are unique, and so are the selectable options", () => {
    const keys = new Set(CATALOGUE.map((def) => def.key));
    assert.equal(keys.size, CATALOGUE.length);

    const values = new Set(CATALOGUE_OPTIONS.map((option) => option.value));
    assert.equal(values.size, CATALOGUE.length);
  });

  test("no entry reaches outside the app, so no canvas is ever tainted", () => {
    for (const def of CATALOGUE) {
      assert.doesNotMatch(def.body, /<image\b/i, `${def.key} uses <image>`);
      assert.doesNotMatch(def.body, /href\s*=/i, `${def.key} has an href`);
      assert.doesNotMatch(def.body, /url\s*\(/i, `${def.key} references a url()`);
      assert.doesNotMatch(def.body, /@import/i, `${def.key} imports a stylesheet`);
      assert.doesNotMatch(def.body, /<foreignObject/i, `${def.key} uses foreignObject`);
      assert.doesNotMatch(def.body, /https?:|data:/i, `${def.key} names an external resource`);
      assert.doesNotMatch(def.body, /font-family/i, `${def.key} needs a font`);
    }
  });

  test("the assembled document references nothing external", () => {
    for (const def of CATALOGUE) {
      const markup = stickerSvgMarkup(def);
      assert.match(markup, /<svg\b/);
      assert.match(markup, new RegExp(`viewBox="${def.viewBox}"`));
      // The SVG namespace is a name, not a fetch: it identifies the language
      // and the browser never requests it. Nothing else may name a URL.
      const withoutNamespace = markup.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "");
      assert.doesNotMatch(withoutNamespace, /https?:/i, `${def.key} names a URL`);
    }
  });

  test("a data URL is a data URL and round trips the markup", () => {
    const def = CATALOGUE[0];
    const url = stickerDataUrl(def);
    assert.ok(url.startsWith("data:image/svg+xml;charset=utf-8,"));
    assert.equal(decodeURIComponent(url.slice(url.indexOf(",") + 1)), stickerSvgMarkup(def));
    assert.equal(stickerDataUrl(null), "");
  });

  test("the raster width is honoured and stays square-ish", () => {
    const def = CATALOGUE[0];
    const markup = stickerSvgMarkup(def, 512);
    assert.match(markup, /width="512"/);

    const { w, h } = viewBoxSize(def);
    const height = Math.round((512 * h) / w);
    assert.match(markup, new RegExp(`height="${height}"`));
  });
});

describe("stickerByKey", () => {
  test("finds a real mark", () => {
    const def = CATALOGUE[3];
    assert.equal(stickerByKey(def.key), def);
  });

  test("returns null for an unknown or absent key", () => {
    assert.equal(stickerByKey("not-a-sticker"), null);
    assert.equal(stickerByKey(""), null);
    assert.equal(stickerByKey(undefined), null);
    assert.equal(stickerByKey(null), null);
  });
});

describe("viewBoxSize and stickerAspect", () => {
  test("reads the viewBox", () => {
    const def = CATALOGUE.find((d) => d.viewBox === "0 0 60 100");
    assert.deepEqual(viewBoxSize(def), { w: 60, h: 100 });
    near(stickerAspect(def), 100 / 60);
  });

  test("accepts comma separated values, which the SVG grammar allows", () => {
    // The catalogue does not currently use one, so this is checked against a
    // literal: the parser should not depend on the spelling the file happens to
    // have chosen.
    assert.deepEqual(viewBoxSize({ viewBox: "0,0,60,100" }), { w: 60, h: 100 });
  });

  test("falls back to a unit square rather than dividing by zero", () => {
    assert.deepEqual(viewBoxSize({ viewBox: "0 0 0 0" }), { w: 1, h: 1 });
    assert.deepEqual(viewBoxSize({ viewBox: "nonsense" }), { w: 1, h: 1 });
    assert.deepEqual(viewBoxSize(null), { w: 1, h: 1 });
  });
});

// ---------------------------------------------------------------------
// Clamps
// ---------------------------------------------------------------------

describe("clampSize", () => {
  test("holds a size inside the range on offer", () => {
    assert.equal(clampSize(200), 200);
    assert.equal(clampSize(MIN_STICKER_SIZE), MIN_STICKER_SIZE);
    assert.equal(clampSize(MAX_STICKER_SIZE), MAX_STICKER_SIZE);
  });

  test("clamps at a positive floor, never at zero", () => {
    // Zero is not a smaller sticker, it is a sticker that cannot be seen or
    // grabbed, so it reads as one that was lost.
    assert.equal(clampSize(0), MIN_STICKER_SIZE);
    assert.equal(clampSize(-1), MIN_STICKER_SIZE);
    assert.equal(clampSize(-99999), MIN_STICKER_SIZE);
    assert.ok(MIN_STICKER_SIZE > 0);
  });

  test("clamps a non-finite size to the floor", () => {
    assert.equal(clampSize(NaN), MIN_STICKER_SIZE);
    assert.equal(clampSize(undefined), MIN_STICKER_SIZE);
    assert.equal(clampSize("not a number"), MIN_STICKER_SIZE);
  });

  test("clamps at the ceiling", () => {
    assert.equal(clampSize(1e9), MAX_STICKER_SIZE);
  });

  test("a floor above the ceiling cannot invert the range", () => {
    assert.equal(clampSize(50, 100, 10), 100);
  });
});

describe("itemBox", () => {
  test("keeps the mark's own proportions", () => {
    const def = stickerByKey("lightning"); // viewBox 60 x 100
    const box = itemBox({ size: 300 }, def);
    assert.equal(box.w, 300);
    near(box.h, 500);
  });

  test("a size of zero still yields a box with area", () => {
    const def = CATALOGUE[0];
    const box = itemBox({ size: 0 }, def);
    assert.equal(box.w, MIN_STICKER_SIZE);
    assert.ok(box.h > 0);
  });
});

describe("clampOpacity", () => {
  test("holds a whole percentage", () => {
    assert.equal(clampOpacity(40), 40);
    assert.equal(clampOpacity(0), 0);
    assert.equal(clampOpacity(100), 100);
    assert.equal(clampOpacity(55.6), 56);
  });

  test("clamps outside 0 to 100", () => {
    assert.equal(clampOpacity(-5), 0);
    assert.equal(clampOpacity(180), 100);
  });

  test("a non-finite opacity is fully opaque rather than invisible", () => {
    assert.equal(clampOpacity(NaN), 100);
    assert.equal(clampOpacity(undefined), 100);
  });
});

describe("normalizeDegrees", () => {
  test("wraps into one turn", () => {
    assert.equal(normalizeDegrees(0), 0);
    assert.equal(normalizeDegrees(90), 90);
    assert.equal(normalizeDegrees(359.5), 359.5);
  });

  test("360 normalises to 0, not to 360", () => {
    // Two angles that point the same way must be the same number.
    assert.equal(normalizeDegrees(360), 0);
    assert.equal(normalizeDegrees(720), 0);
  });

  test("negative angles wrap rather than clamp", () => {
    assert.equal(normalizeDegrees(-90), 270);
    assert.equal(normalizeDegrees(-450), 270);
  });

  test("stays inside 0 to 360 for any input", () => {
    for (const value of [-1080, -359, -1, 0, 1, 359, 360, 361, 5000, 123456]) {
      const n = normalizeDegrees(value);
      assert.ok(n >= 0 && n < 360, `${value} normalised to ${n}`);
    }
  });

  test("a non-finite angle is 0", () => {
    assert.equal(normalizeDegrees(NaN), 0);
    assert.equal(normalizeDegrees("sideways"), 0);
  });
});

describe("clampRotation", () => {
  test("normalises and rounds", () => {
    assert.equal(clampRotation(370), 10);
    assert.equal(clampRotation(-90), 270);
    assert.equal(clampRotation(44.6), 45);
    assert.equal(clampRotation(NaN), 0);
  });
});

// ---------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------

describe("placementMatrix", () => {
  const def = CATALOGUE.find((d) => d.viewBox === "0 0 100 100");

  test("an upright mark lands centred on its point", () => {
    const m = placementMatrix({ x: 500, y: 400, size: 200 }, def);
    const topLeft = transformPoint(m, { x: 0, y: 0 });
    const bottomRight = transformPoint(m, { x: 100, y: 100 });
    near(topLeft.x, 400);
    near(topLeft.y, 300);
    near(bottomRight.x, 600);
    near(bottomRight.y, 500);
  });

  test("a turned mark moves its corners off the axis", () => {
    const m = placementMatrix({ x: 500, y: 400, size: 200, rotation: 90 }, def);
    // The centre does not move when the mark turns.
    const centre = transformPoint(m, { x: 50, y: 50 });
    near(centre.x, 500, 1e-6);
    near(centre.y, 400, 1e-6);
    // The mark's own right edge now points down the picture, not across it.
    const corner = transformPoint(m, { x: 100, y: 0 });
    near(corner.x, 600, 1e-6);
    near(corner.y, 500, 1e-6);
  });

  test("mirroring moves the mark but keeps it on its point", () => {
    const flipped = placementMatrix({ x: 500, y: 400, size: 200, flipX: true }, def);
    const corner = transformPoint(flipped, { x: 0, y: 0 });
    // The far edge swaps sides: the box is the same, the content is mirrored.
    near(corner.x, 600);
    near(corner.y, 300);
  });

  test("a size of zero still produces an invertible matrix", () => {
    const m = placementMatrix({ x: 10, y: 10, size: 0 }, def);
    assert.ok(invertMatrix(m), "a zero size collapsed the matrix");
  });

  test("matrixString is an SVG transform value", () => {
    const text = matrixString(placementMatrix({ x: 1, y: 2, size: 10 }, def));
    assert.match(text, /^matrix\(-?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+\)$/);
  });
});

describe("invertMatrix", () => {
  test("round trips a point", () => {
    const m = placementMatrix({ x: 300, y: 200, size: 120, rotation: 37 }, CATALOGUE[0]);
    const inverse = invertMatrix(m);
    const there = transformPoint(m, { x: 40, y: 60 });
    const back = transformPoint(inverse, there);
    near(back.x, 40, 1e-6);
    near(back.y, 60, 1e-6);
  });

  test("refuses a singular matrix rather than dividing by it", () => {
    assert.equal(invertMatrix({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }), null);
  });
});

describe("containsPoint", () => {
  const def = CATALOGUE[0];

  test("finds a point on the mark and rejects one off it", () => {
    const item = { x: 500, y: 400, size: 200 };
    assert.equal(containsPoint(item, def, { x: 500, y: 400 }), true);
    assert.equal(containsPoint(item, def, { x: 500, y: 600 }), false);
  });

  test("accounts for rotation", () => {
    const item = { x: 500, y: 400, size: 200, rotation: 45 };
    assert.equal(containsPoint(item, def, { x: 500, y: 400 }), true);

    // A 200px square turned 45 degrees reaches 141.4px out along each axis, so
    // 120px straight down from the centre is still on the mark and 200px is not.
    // An unrotated test at these distances would have said the opposite for both.
    assert.equal(containsPoint(item, def, { x: 500, y: 520 }), true);
    assert.equal(containsPoint(item, def, { x: 500, y: 600 }), false);

    // And the same point on the unturned mark, to show the two differ.
    assert.equal(containsPoint({ x: 500, y: 400, size: 200 }, def, { x: 500, y: 520 }), false);
  });

  test("a bad point is not on anything", () => {
    assert.equal(containsPoint({ x: 0, y: 0, size: 100 }, def, null), false);
  });
});

// ---------------------------------------------------------------------
// Bounds and frame status
// ---------------------------------------------------------------------

describe("boundsOf", () => {
  const def = CATALOGUE[0];

  test("an upright mark is its own box", () => {
    assert.deepEqual(boundsOf({ x: 500, y: 400, size: 200 }, def), {
      x: 400,
      y: 300,
      w: 200,
      h: 200,
    });
  });

  test("a turned mark's box grows to hold the corners", () => {
    const box = boundsOf({ x: 500, y: 400, size: 200, rotation: 45 }, def);
    assert.ok(box.w > 200, "a 45 degree mark was not widened");
    near(box.w, 200 * Math.SQRT2, 1e-6);
    near(box.x + box.w / 2, 500, 1e-6);
  });
});

describe("frameStatus", () => {
  const def = CATALOGUE[0];

  test("a mark inside the frame touches every edge", () => {
    const status = frameStatus({ x: 600, y: 450, size: 200 }, def, FRAME);
    assert.deepEqual(status, { left: false, right: false, top: false, bottom: false, outside: false });
  });

  test("a mark running past an edge is reported on that edge", () => {
    const status = frameStatus({ x: 20, y: 450, size: 200 }, def, FRAME);
    assert.equal(status.left, true);
    assert.equal(status.outside, false, "partly off is not the same as off");
  });

  test("a mark pushed clean off is reported as outside", () => {
    // This is the case that used to vanish silently.
    const status = frameStatus({ x: -4000, y: 450, size: 200 }, def, FRAME);
    assert.equal(status.outside, true);
  });

  test("an empty frame reports nothing rather than everything", () => {
    const status = frameStatus({ x: 600, y: 450, size: 200 }, def, { width: 0, height: 0 });
    assert.equal(status.outside, false);
  });
});

// ---------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------

describe("placementPoint", () => {
  test("repeated placement does not stack every mark in one spot", () => {
    const seen = new Set();
    for (let i = 0; i < 12; i += 1) {
      const p = placementPoint(i, FRAME);
      seen.add(`${p.x},${p.y}`);
    }
    assert.equal(seen.size, 12, "two placements landed on the same point");
  });

  test("the grid stays inside the frame", () => {
    for (let i = 0; i < 40; i += 1) {
      const p = placementPoint(i, FRAME);
      assert.ok(p.x >= 0 && p.x <= W, `x ${p.x} off the frame`);
      assert.ok(p.y >= 0 && p.y <= H, `y ${p.y} off the frame`);
    }
  });

  test("wrapping past the grid nudges rather than repeating", () => {
    const first = placementPoint(0, FRAME);
    const wrapped = placementPoint(12, FRAME);
    assert.notDeepEqual(wrapped, first);
  });

  test("every wrap is a different point again", () => {
    const seen = new Set();
    for (let i = 0; i < 60; i += 1) {
      const p = placementPoint(i, FRAME);
      seen.add(`${p.x},${p.y}`);
    }
    assert.equal(seen.size, 60);
  });

  test("a bad index is treated as the first slot", () => {
    assert.deepEqual(placementPoint(-3, FRAME), placementPoint(0, FRAME));
    assert.deepEqual(placementPoint(NaN, FRAME), placementPoint(0, FRAME));
  });

  test("an empty frame gives the origin rather than NaN", () => {
    assert.deepEqual(placementPoint(3, { width: 0, height: 0 }), { x: 0, y: 0 });
    assert.deepEqual(placementPoint(3, null), { x: 0, y: 0 });
  });
});

// ---------------------------------------------------------------------
// List operations
// ---------------------------------------------------------------------

describe("insertItem", () => {
  test("gives the new item a unique id", () => {
    let list = [];
    list = insertItem(list, { key: "star4" });
    list = insertItem(list, { key: "heart-solid" });

    const ids = list.map((item) => item.id);
    assert.equal(ids.length, 2);
    assert.equal(new Set(ids).size, 2, `ids collided: ${ids.join(",")}`);
  });

  test("does not reuse an id that is already taken", () => {
    const list = [{ id: "sk-1", key: "star4" }, { id: "sk-2", key: "star4" }];
    const next = insertItem(list, { key: "star4" });
    assert.equal(next[2].id, "sk-3");
    assert.equal(new Set(next.map((i) => i.id)).size, 3);
  });

  test("does not mutate the list it was given", () => {
    const list = [{ id: "sk-1", key: "star4" }];
    const next = insertItem(list, { key: "check" });
    assert.equal(list.length, 1);
    assert.equal(next.length, 2);
    assert.notEqual(list[0], next[1]);
  });

  test("inserts at the requested position, defaulting to the end", () => {
    let list = [];
    list = insertItem(list, { key: "a" });
    list = insertItem(list, { key: "c" });
    const middle = insertItem(list, { key: "b" }, 1);
    assert.deepEqual(middle.map((i) => i.key), ["a", "b", "c"]);
    assert.deepEqual(list.map((i) => i.key), ["a", "c"]);
  });

  test("a position outside the list is clamped, not thrown on", () => {
    const list = [{ id: "sk-1", key: "a" }];
    assert.equal(insertItem(list, { key: "b" }, -5).length, 2);
    assert.equal(insertItem(list, { key: "b" }, 99).length, 2);
  });

  test("a null item is not inserted", () => {
    const list = [{ id: "sk-1", key: "a" }];
    assert.deepEqual(insertItem(list, null), list);
  });
});

describe("removeItem", () => {
  test("leaves the rest in order", () => {
    const list = [
      { id: "sk-1", key: "a" },
      { id: "sk-2", key: "b" },
      { id: "sk-3", key: "c" },
    ];
    assert.deepEqual(removeItem(list, "sk-2").map((i) => i.key), ["a", "c"]);
    assert.deepEqual(removeItem(list, "sk-1").map((i) => i.key), ["b", "c"]);
    assert.deepEqual(removeItem(list, "sk-3").map((i) => i.key), ["a", "b"]);
  });

  test("removing something that is not there changes nothing", () => {
    const list = [{ id: "sk-1", key: "a" }];
    assert.deepEqual(removeItem(list, "nope"), list);
    assert.deepEqual(removeItem(null, "sk-1"), []);
  });

  test("emptying the list leaves an empty list, not an error", () => {
    assert.deepEqual(removeItem([{ id: "sk-1", key: "a" }], "sk-1"), []);
  });
});

describe("reorderItem and moveItemId", () => {
  const list = () => [
    { id: "sk-1", key: "a" },
    { id: "sk-2", key: "b" },
    { id: "sk-3", key: "c" },
  ];

  test("reorders to a position", () => {
    assert.deepEqual(reorderItem(list(), "sk-3", 0).map((i) => i.id), ["sk-3", "sk-1", "sk-2"]);
  });

  test("clamps a position past either end", () => {
    assert.deepEqual(reorderItem(list(), "sk-1", 99).map((i) => i.id), ["sk-2", "sk-3", "sk-1"]);
    assert.deepEqual(reorderItem(list(), "sk-3", -4).map((i) => i.id), ["sk-3", "sk-1", "sk-2"]);
  });

  test("an unknown id leaves the order alone", () => {
    assert.deepEqual(reorderItem(list(), "nope", 0).map((i) => i.id), ["sk-1", "sk-2", "sk-3"]);
  });

  test("moves one place at a time", () => {
    assert.deepEqual(moveItemId(list(), "sk-2", 1).map((i) => i.id), ["sk-1", "sk-3", "sk-2"]);
    assert.deepEqual(moveItemId(list(), "sk-2", -1).map((i) => i.id), ["sk-2", "sk-1", "sk-3"]);
  });

  test("moving off either end stays put rather than wrapping", () => {
    assert.deepEqual(moveItemId(list(), "sk-1", -1).map((i) => i.id), ["sk-1", "sk-2", "sk-3"]);
    assert.deepEqual(moveItemId(list(), "sk-3", 1).map((i) => i.id), ["sk-1", "sk-2", "sk-3"]);
  });

  test("a zero or missing delta is a no-op", () => {
    assert.deepEqual(moveItemId(list(), "sk-2", 0).map((i) => i.id), ["sk-1", "sk-2", "sk-3"]);
    assert.deepEqual(moveItemId(list(), "sk-2").map((i) => i.id), ["sk-1", "sk-2", "sk-3"]);
  });

  test("does not mutate the list it was given", () => {
    const original = list();
    reorderItem(original, "sk-3", 0);
    assert.deepEqual(original.map((i) => i.id), ["sk-1", "sk-2", "sk-3"]);
  });
});

describe("paintOrder", () => {
  test("keeps list order and drops hidden marks", () => {
    const list = [
      { id: "a", key: "star4", visible: true },
      { id: "b", key: "check", visible: false },
      { id: "c", key: "crown", visible: true },
    ];
    assert.deepEqual(paintOrder(list).map((i) => i.id), ["a", "c"]);
  });

  test("a mark with no catalogue entry is not drawable, so it is dropped", () => {
    const list = [{ id: "a", key: "gone-from-the-catalogue", visible: true }];
    assert.deepEqual(paintOrder(list), []);
  });

  test("an empty or missing list paints nothing", () => {
    assert.deepEqual(paintOrder([]), []);
    assert.deepEqual(paintOrder(null), []);
  });
});

// ---------------------------------------------------------------------
// Item creation and rasterising
// ---------------------------------------------------------------------

describe("createItem", () => {
  test("builds a usable item from a catalogue key", () => {
    const item = createItem("star4", 0, FRAME);
    assert.equal(item.key, "star4");
    assert.equal(item.rotation, 0);
    assert.equal(item.opacity, 100);
    assert.equal(item.visible, true);
    assert.ok(item.size >= MIN_STICKER_SIZE);
  });

  test("returns null for a key the catalogue does not hold", () => {
    // This is what an empty catalogue looks like to the caller.
    assert.equal(createItem("nope", 0, FRAME), null);
    assert.equal(createItem(null, 0, FRAME), null);
  });

  test("a size is never zero, even on a degenerate frame", () => {
    const item = createItem("star4", 0, { width: 1, height: 1 });
    assert.ok(item.size > 0, "a sticker came out with no size");
  });

  test("successive items do not land on each other", () => {
    const a = createItem("star4", 0, FRAME);
    const b = createItem("star4", 1, FRAME);
    assert.notDeepEqual({ x: a.x, y: a.y }, { x: b.x, y: b.y });
  });
});

describe("rasterSizeFor", () => {
  test("stays inside the raster bounds for any size", () => {
    for (const size of [0, 1, 50, 900, 100000]) {
      const item = { x: 600, y: 450, size, rotation: 33 };
      const raster = rasterSizeFor(item, CATALOGUE[0]);
      assert.ok(raster >= RASTER_MIN, `${size} gave ${raster}`);
      assert.ok(raster <= RASTER_MAX, `${size} gave ${raster}`);
      assert.ok(Number.isInteger(raster));
    }
  });

  test("a bigger mark asks for more detail", () => {
    const small = rasterSizeFor({ x: 0, y: 0, size: 40 }, CATALOGUE[0]);
    const large = rasterSizeFor({ x: 0, y: 0, size: 400 }, CATALOGUE[0]);
    assert.ok(large > small);
  });
});