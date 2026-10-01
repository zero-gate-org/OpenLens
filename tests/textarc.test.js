import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  arcLayout,
  arcPath,
  alongForPoint,
  clamp,
  fitRadius,
  measureAdvances,
  normalizeAngle,
  pointOnArc,
  startAngle,
  sweepDegrees,
  totalSweep,
} from "../src/lib/core/textarc.js";

const DEG = Math.PI / 180;
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

/**
 * A stand-in for the canvas, so the tests never load a font.
 *
 * `i` is narrow and `m` is wide, which is the whole point: an estimate cannot
 * tell them apart, and a string of one is genuinely narrower than a string of
 * the other.
 */
const narrow = (char) => (char === "i" ? 10 : 40);

const narrowWord = measureAdvances("mimi", narrow).total;
const wideWord = measureAdvances("mmmm", narrow).total;

/** The run most of the layout tests bend. */
const RUN = measureAdvances("mimi", narrow);

describe("clamp and normalizeAngle", () => {
  test("clamp holds a value inside its bounds", () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-5, 0, 10), 0);
    assert.equal(clamp(50, 0, 10), 10);
  });

  test("angles wrap into one turn", () => {
    near(normalizeAngle(370), 10);
    near(normalizeAngle(-10), -10);
    near(normalizeAngle(180), 180);
    near(normalizeAngle(190), -170);
    near(normalizeAngle(-720), 0);
  });
});

describe("measureAdvances", () => {
  test("sums the measured glyph widths", () => {
    const run = measureAdvances("mimi", narrow);
    assert.equal(run.glyphs.length, 4);
    assert.equal(run.total, 10 + 40 + 10 + 40);
  });

  test("tracking sits between the glyphs, not after the last one", () => {
    const run = measureAdvances("mimi", narrow, 5);
    // Four glyphs carry three gaps. Charging a gap to every glyph would run the
    // line 5px long and throw off where the anchor lands.
    assert.equal(run.gaps, 15);
    assert.equal(run.total, 115);
  });

  test("a single glyph carries no tracking at all", () => {
    const run = measureAdvances("m", narrow, 5);
    assert.equal(run.gaps, 0);
    assert.equal(run.total, 40);
  });

  test("an empty string measures to nothing", () => {
    const run = measureAdvances("", narrow);
    assert.deepEqual(run.glyphs, []);
    assert.equal(run.total, 0);
  });

  test("a run of spaces has width but no ink", () => {
    // Kept as glyphs so the widths still add up; `arcLayout` is what drops it.
    assert.equal(measureAdvances("  ", narrow).total, 80);
  });

  test("a broken measurement is zero, never NaN", () => {
    const run = measureAdvances("ab", () => NaN);
    assert.equal(run.total, 0);
    assert.ok(run.glyphs.every((glyph) => glyph.width === 0));
  });

  test("counts a character outside the basic plane once", () => {
    const run = measureAdvances("a🙂b", () => 7);
    assert.equal(run.glyphs.length, 3);
    assert.equal(run.glyphs[1].char, "🙂");
    assert.equal(run.total, 21);
  });
});

describe("totalSweep", () => {
  test("is proportional to the measured width at a fixed radius", () => {
    const one = totalSweep(100, 200);
    assert.equal(one, 0.5);
    near(totalSweep(200, 200), one * 2);
    near(totalSweep(300, 200), one * 3);
  });

  test("is inversely proportional to the radius", () => {
    near(totalSweep(100, 400), totalSweep(100, 200) / 2);
  });

  test("a radius of zero is safe and measures zero sweep", () => {
    // The whole degenerate case: dividing by the radius here would put
    // Infinity into the layout and NaN into every position.
    assert.equal(totalSweep(100, 0), 0);
    assert.equal(sweepDegrees(100, 0), 0);
    assert.equal(totalSweep(100, -40), 0);
    assert.ok(Number.isFinite(sweepDegrees(100, 0)));
  });

  test("nothing to place measures zero sweep at any radius", () => {
    assert.equal(totalSweep(0, 200), 0);
    assert.equal(totalSweep("", 200), 0);
  });

  test("degrees reports the same angle in degrees", () => {
    near(sweepDegrees(100, 200), 0.5 / DEG);
  });
});

describe("fitRadius", () => {
  test("a wider string needs a larger radius to fill the same sweep", () => {
    const narrowFit = fitRadius(narrowWord, 120);
    const wideFit = fitRadius(wideWord, 120);
    assert.ok(wideFit > narrowFit);
    // And each one really does fill the arc it was fitted to.
    near(totalSweep(wideWord, wideFit) / DEG, 120);
  });

  test("the same string fits a narrow sweep on a larger radius", () => {
    const narrowSweep = fitRadius(wideWord, 60);
    const wideSweep = fitRadius(wideWord, 240);
    assert.ok(narrowSweep > wideSweep);
    near(totalSweep(wideWord, narrowSweep) / DEG, 60);
    near(totalSweep(wideWord, wideSweep) / DEG, 240);
  });

  test("an empty string needs no radius", () => {
    assert.equal(fitRadius(0, 120), 0);
    assert.equal(fitRadius("", 120), 0);
  });

  test("a sweep of zero is reported as no finite fit", () => {
    // An arc with no length cannot hold text at any radius. Infinity is the
    // honest answer, and the caller clamps it rather than dividing by it.
    assert.equal(fitRadius(wideWord, 0), Infinity);
    assert.equal(fitRadius(wideWord, -30), Infinity);
    assert.ok(Number.isFinite(clamp(fitRadius(wideWord, 0), 1, 2000)));
  });

  test("a half turn is twice the radius of a full turn", () => {
    near(fitRadius(wideWord, 180), fitRadius(wideWord, 360) * 2);
  });
});

describe("startAngle", () => {
  const SWEEP = 0.8;

  test("start hangs the run off the arc's start angle", () => {
    near(startAngle("start", SWEEP, -Math.PI / 2, 1), -Math.PI / 2);
  });

  test("middle centres the run on the arc's start angle", () => {
    const base = -Math.PI / 2;
    near(startAngle("middle", SWEEP, base, 1) + SWEEP / 2, base);
  });

  test("middle centres a run that walks the other way too", () => {
    const base = Math.PI / 2;
    near(startAngle("middle", SWEEP, base, -1) - SWEEP / 2, base);
  });

  test("end finishes the run on the arc's start angle", () => {
    const base = Math.PI / 3;
    near(startAngle("end", SWEEP, base, 1) + SWEEP, base);
    near(startAngle("end", SWEEP, base, -1) - SWEEP, base);
  });

  test("an empty run starts where it is told, whichever way it walks", () => {
    near(startAngle("middle", 0, 1.25, 1), 1.25);
    near(startAngle("end", 0, 1.25, -1), 1.25);
  });

  test("a middle-anchored run is symmetric about the arc's start angle", () => {
    const base = -Math.PI / 2;
    const out = arcLayout({ cx: 0, cy: 0, radius: 200, arcStartDeg: base / DEG, anchor: "middle", ...RUN });
    // The span of the run, not the two outer glyph centres: those sit half an
    // advance inside the ends, and a run whose first and last letters differ in
    // width is not symmetric at its ink, only at its extent.
    const first = Math.atan2(out.head.y, out.head.x);
    near(first + (first + out.sweep), 2 * base);
  });

  test("the same is true of a run anchored to its end", () => {
    const base = Math.PI / 2;
    const out = arcLayout({ cx: 0, cy: 0, radius: 200, arcStartDeg: base / DEG, anchor: "end", ...RUN });
    near(out.start + out.sweep, base);
  });
});

describe("arcLayout", () => {
  test("every glyph lands on the circle, at the centre of its own advance", () => {
    const out = arcLayout({ cx: 100, cy: 200, radius: 150, ...RUN });
    assert.equal(out.glyphs.length, 4);
    for (const glyph of out.glyphs) {
      near(Math.hypot(glyph.x - 100, glyph.y - 200), 150);
    }
    // The first glyph is centred half its own width along the run, not at the
    // very start, so the line is not shifted by half a character.
    const angle = Math.atan2(out.glyphs[0].y - 200, out.glyphs[0].x - 100);
    near(angle, out.start + (RUN.glyphs[0].width / 2) / 150);
  });

  test("consecutive glyphs advance by their width plus the tracking", () => {
    // Arc length between glyph centres, taken from the polar angle so a wrap
    // across the top of the circle cannot fold it.
    const step = (out, i) => {
      const a = out.glyphs[i];
      const b = out.glyphs[i + 1];
      const da = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x);
      return da * 200;
    };
    // "m" then "i": half of each width, so (40 + 10) / 2.
    near(step(arcLayout({ cx: 0, cy: 0, radius: 200, ...RUN }), 0), 25);
    near(step(arcLayout({ cx: 0, cy: 0, radius: 200, letterSpacing: 6, ...RUN }), 0), 31);
  });

  test("a run starting at the top of the circle is upright and reads right", () => {
    const out = arcLayout({ cx: 0, cy: 0, radius: 100, arcStartDeg: -90, anchor: "start", ...RUN });
    // Upright means the baseline at the leading edge of the run is horizontal.
    // Glyph rotation carries the tangent at each glyph's own centre, so the
    // first letter is turned by however far into its advance the centre sits.
    near(out.glyphs[0].angle, (RUN.glyphs[0].width / 2) / 100);
    assert.ok(out.glyphs.at(-1).x > out.glyphs[0].x);
    assert.ok(out.glyphs[0].y < 0);
  });

  test("the below side reads the same way under the bottom of the circle", () => {
    const out = arcLayout({
      cx: 0,
      cy: 0,
      radius: 100,
      direction: -1,
      arcStartDeg: 90,
      anchor: "start",
      ...RUN,
    });
    near(out.glyphs[0].angle, -(RUN.glyphs[0].width / 2) / 100);
    assert.ok(out.glyphs[0].y > 0);
    assert.ok(out.glyphs.at(-1).x > out.glyphs[0].x);
  });

  test("a radius of zero lays the run out as a straight line", () => {
    const out = arcLayout({ cx: 100, cy: 50, radius: 0, ...RUN });
    assert.equal(out.straight, true);
    assert.equal(out.sweep, 0);
    for (const glyph of out.glyphs) {
      assert.ok(Number.isFinite(glyph.x) && Number.isFinite(glyph.y));
      near(glyph.y, 50);
      near(glyph.angle, 0);
    }
    // The run as a whole is centred on the arc centre, so a straight line is
    // never left of frame.
    near(out.head.x, 50);
    near(out.head.y, 50);
    near(out.glyphs.at(-1).x + RUN.glyphs.at(-1).width / 2, 150);
  });

  test("a negative radius is treated as a straight line, not a division", () => {
    const out = arcLayout({ cx: 0, cy: 0, radius: -80, ...RUN });
    assert.equal(out.straight, true);
    assert.ok(out.glyphs.every((glyph) => Number.isFinite(glyph.x)));
  });

  test("an empty string places nothing and does not throw", () => {
    const out = arcLayout({ cx: 10, cy: 10, radius: 200, ...measureAdvances("", narrow) });
    assert.deepEqual(out.glyphs, []);
    assert.equal(out.sweep, 0);
    assert.equal(out.width, 0);
  });

  test("a run of spaces is placed, because the advances are real", () => {
    const out = arcLayout({ cx: 0, cy: 0, radius: 200, ...measureAdvances("   ", narrow) });
    assert.equal(out.glyphs.length, 3);
    for (const glyph of out.glyphs) near(Math.hypot(glyph.x, glyph.y), 200);
  });

  test("text longer than the arc is laid out in full, never clipped", () => {
    const out = arcLayout({ cx: 0, cy: 0, radius: 4, arcStartDeg: 0, anchor: "start", ...RUN });
    // Many turns of arc, and every glyph still has its place on the circle.
    assert.ok(out.sweep > 2 * Math.PI);
    assert.equal(out.glyphs.length, RUN.glyphs.length);
    for (const glyph of out.glyphs) near(Math.hypot(glyph.x, glyph.y), 4);
  });

  test("sliding along the arc turns every glyph by the same angle", () => {
    const here = arcLayout({ cx: 0, cy: 0, radius: 120, arcStartDeg: 0, ...RUN });
    const there = arcLayout({ cx: 0, cy: 0, radius: 120, arcStartDeg: 0, alongDeg: 30, ...RUN });
    for (let i = 0; i < here.glyphs.length; i += 1) {
      near(there.glyphs[i].angle, here.glyphs[i].angle + 30 * DEG);
    }
  });
});

describe("alongForPoint", () => {
  test("puts the leading edge of the run under the pointer", () => {
    const cx = 300;
    const cy = 220;
    const out = arcLayout({ cx, cy, radius: 180, arcStartDeg: 0, anchor: "middle", ...RUN });
    const wanted = 47;
    const want = { x: cx + 180 * Math.cos(wanted * DEG), y: cy + 180 * Math.sin(wanted * DEG) };
    const along = alongForPoint({
      cx,
      cy,
      arcStartDeg: 0,
      anchor: "middle",
      textSweep: out.sweep,
      direction: 1,
      ...want,
    });
    // Not `wanted` itself: the anchor has already pulled the run back by half
    // its sweep, so the slide that lands the head at 47 degrees is 47 plus
    // that half. The round trip below is the property that matters.
    near(along, wanted + out.sweep / 2 / DEG);

    const moved = arcLayout({ cx, cy, radius: 180, arcStartDeg: 0, alongDeg: along, anchor: "middle", ...RUN });
    near(moved.head.x, want.x, 1e-6);
    near(moved.head.y, want.y, 1e-6);
  });

  test("round trips for every anchor and both directions", () => {
    for (const anchor of ["start", "middle", "end"]) {
      for (const direction of [1, -1]) {
        const out = arcLayout({ cx: 0, cy: 0, radius: 140, arcStartDeg: 20, anchor, direction, ...RUN });
        const along = alongForPoint({
          cx: 0,
          cy: 0,
          arcStartDeg: 20,
          anchor,
          textSweep: out.sweep,
          direction,
          x: out.head.x,
          y: out.head.y,
        });
        const moved = arcLayout({
          cx: 0,
          cy: 0,
          radius: 140,
          arcStartDeg: 20,
          alongDeg: along,
          anchor,
          direction,
          ...RUN,
        });
        near(moved.head.x, out.head.x, 1e-6);
        near(moved.head.y, out.head.y, 1e-6);
      }
    }
  });

  test("stays inside one turn however far the pointer goes", () => {
    const value = alongForPoint({ cx: 0, cy: 0, arcStartDeg: 0, x: 100, y: 0 });
    assert.ok(value <= 180 && value > -180);
  });
});

describe("pointOnArc and arcPath", () => {
  test("a point on the circle is the radius away from the centre", () => {
    const p = pointOnArc(10, 20, 5, Math.PI / 2);
    near(p.x, 10);
    near(p.y, 25);
  });

  test("a zero radius puts the point on the centre", () => {
    const p = pointOnArc(10, 20, 0, 1.234);
    near(p.x, 10);
    near(p.y, 20);
  });

  test("a path is drawn for a real arc and not for a degenerate one", () => {
    const arc = arcPath({ cx: 0, cy: 0, radius: 100, start: 0, sweep: Math.PI / 2, direction: 1 });
    assert.match(arc, /^M /);
    assert.match(arc, / A 100 100 0 0 1 /);
    // No length, or no radius, is nothing to draw.
    assert.equal(arcPath({ cx: 0, cy: 0, radius: 100, start: 0, sweep: 0 }), "");
    assert.equal(arcPath({ cx: 0, cy: 0, radius: 0, start: 0, sweep: 1 }), "");
  });

  test("a sweep past a half turn sets the large arc flag", () => {
    assert.match(arcPath({ cx: 0, cy: 0, radius: 100, start: 0, sweep: (3 * Math.PI) / 2 }), / A 100 100 0 1 /);
  });

  test("the two ends of the path sit on the circle", () => {
    const d = arcPath({ cx: 30, cy: 40, radius: 90, start: 0.4, sweep: 1.1, direction: 1 });
    // "M x0 y0 A r r rot large sweep x1 y1"
    const [x0, y0, , , , , , x1, y1] = d.match(/-?[\d.]+/g).map(Number);
    near(Math.hypot(x0 - 30, y0 - 40), 90, 1e-6);
    near(Math.hypot(x1 - 30, y1 - 40), 90, 1e-6);
  });
});