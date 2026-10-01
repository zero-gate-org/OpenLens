/**
 * Text on a circular arc.
 *
 * Deliberately free of runes, of the DOM and of canvas: everything here takes
 * numbers and returns numbers. Glyph advances arrive from the caller, measured
 * on a real canvas, because this module has no font and cannot invent one, and
 * an estimate puts the words visibly in the wrong place on the curve.
 *
 * Every angle is in radians unless the name says `Deg`. Every length is in
 * image pixels, so nothing here knows what the stage happens to be zoomed to.
 */

const DEG = Math.PI / 180;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Wrap an angle in degrees into (-180, 180]. */
export function normalizeAngle(deg) {
  const wrapped = (((Number(deg) || 0) % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * Per-glyph advances, and the width of the whole run.
 *
 * `measure` is a single character measurement, normally
 * `ctx.measureText(c).width` with the font already set on the context.
 * Iterating the string yields code points, so a character outside the basic
 * plane counts once instead of as two broken halves.
 *
 * Tracking is added between glyphs only: n glyphs carry n-1 gaps, so charging a
 * gap to every glyph leaves a phantom space after the last character and runs
 * the whole run long.
 */
export function measureAdvances(text, measure, letterSpacing = 0) {
  const str = String(text ?? "");
  const track = Number(letterSpacing) || 0;
  const glyphs = [];
  let ink = 0;

  for (const char of str) {
    const raw = measure ? Number(measure(char)) : NaN;
    const width = Number.isFinite(raw) && raw > 0 ? raw : 0;
    glyphs.push({ char, width });
    ink += width;
  }

  const gaps = glyphs.length > 1 ? track * (glyphs.length - 1) : 0;
  return { glyphs, total: ink + gaps, gaps };
}

/**
 * The angle a run of `width` occupies on a circle of `radius`.
 *
 * Zero whenever there is nothing to place or nowhere to place it, which is
 * what makes a radius of zero safe: the caller lays the run out as a straight
 * line instead of dividing by it.
 */
export function totalSweep(width, radius) {
  const w = Number(width) || 0;
  const r = Number(radius) || 0;
  if (w <= 0 || r <= 0) return 0;
  return w / r;
}

/** The same, in degrees, for readouts and controls. */
export function sweepDegrees(width, radius) {
  return totalSweep(width, radius) / DEG;
}

/**
 * The radius at which a run of `width` exactly fills `sweepDeg` of arc.
 *
 * Two degenerate answers, both deliberate and both tellable apart: 0 for an
 * empty run, because there is nothing to fit, and Infinity for a sweep of 0,
 * because an arc with no length cannot hold text at any radius. Callers clamp,
 * so Infinity becomes the largest radius on offer and the panel can then say
 * out loud that the words do not fit rather than quietly clipping them.
 */
export function fitRadius(width, sweepDeg) {
  const w = Number(width) || 0;
  const sweep = (Number(sweepDeg) || 0) * DEG;
  if (w <= 0) return 0;
  if (sweep <= 0) return Infinity;
  return w / sweep;
}

/**
 * The angle the first glyph sits at, given what it is anchored to.
 *
 * "start" hangs the run off the arc's start angle, "middle" straddles it and
 * "end" finishes on it. The direction is part of the answer: a run that walks
 * the circle the other way has to start earlier to finish in the same place.
 */
export function startAngle(anchor, textSweep, arcStart, direction = 1) {
  const base = Number(arcStart) || 0;
  const sweep = Number(textSweep) || 0;
  const dir = direction >= 0 ? 1 : -1;
  if (anchor === "middle") return base - (dir * sweep) / 2;
  if (anchor === "end") return base - dir * sweep;
  return base;
}

/** A point on the circle. A zero radius collapses it onto the centre. */
export function pointOnArc(cx, cy, radius, angle) {
  const r = Number(radius) || 0;
  const a = Number(angle) || 0;
  return {
    x: (Number(cx) || 0) + r * Math.cos(a),
    y: (Number(cy) || 0) + r * Math.sin(a),
  };
}

/**
 * Lay a measured run out on the arc.
 *
 * The run is always placed in full, however much arc it needs. A string too
 * long for the arc the operator asked for wraps past the end of the guide
 * rather than losing characters off the end of it, so the stage shows the
 * overflow and the panel can report it.
 *
 * A radius of zero or below is a straight line: the run is centred on the arc
 * centre, unrotated, and no division by the radius happens anywhere.
 *
 * `start` is the leading edge of the run and `head` is that point in image
 * coordinates. A handle sits on `head`, so dragging it and reading
 * `alongForPoint` back agree by construction rather than by coincidence.
 *
 * @returns {{glyphs: {char: string, x: number, y: number, angle: number}[],
 *            sweep: number, start: number, head: {x: number, y: number},
 *            width: number, straight: boolean}}
 */
export function arcLayout(options = {}) {
  const cx = Number(options.cx) || 0;
  const cy = Number(options.cy) || 0;
  const radius = Number(options.radius) || 0;
  // `>= 0` on an undefined direction would read as false, so an omitted
  // direction has to become 1 here rather than silently flipping the run.
  const dir = (options.direction ?? 1) >= 0 ? 1 : -1;
  const anchor = options.anchor ?? "middle";
  const track = Number(options.letterSpacing) || 0;
  const arcStart = (Number(options.arcStartDeg) || 0) * DEG;
  const along = (Number(options.alongDeg) || 0) * DEG;
  const source = options.glyphs ?? [];
  const width = Math.max(0, Number(options.total) || 0);

  // Nothing to place: no glyphs, or no width to place them at. A run of spaces
  // does have advances and is laid out like any other run, because the advances
  // are real even though the ink is not.
  const flatHead = { x: cx - width / 2, y: cy };

  if (!source.length || width <= 0) {
    return {
      glyphs: [],
      sweep: 0,
      start: arcStart + along,
      head: radius > 0 ? pointOnArc(cx, cy, radius, arcStart + along) : flatHead,
      width: 0,
      straight: radius <= 0,
    };
  }

  if (radius <= 0) {
    const placed = [];
    let at = 0;
    for (const glyph of source) {
      placed.push({ char: glyph.char, x: cx - width / 2 + at + glyph.width / 2, y: cy, angle: 0 });
      at += glyph.width + track;
    }
    return {
      glyphs: placed,
      sweep: 0,
      start: arcStart + along,
      head: flatHead,
      width,
      straight: true,
    };
  }

  const sweep = totalSweep(width, radius);
  const start = startAngle(anchor, sweep, arcStart, dir) + along;

  const placed = [];
  let at = 0;
  for (const glyph of source) {
    // Each glyph sits on the point of the arc halfway along its own advance,
    // which is where its centre is. Placing it at its leading edge instead
    // would make the line read as shifted by half a character.
    const angle = start + (dir * (at + glyph.width / 2)) / radius;
    placed.push({
      char: glyph.char,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      // Baseline tangent to the circle, with the glyph upright either way:
      // facing out of the centre for an outside arc, into it for an inside
      // one, which is the same half turn the walk direction already encodes.
      angle: angle + (dir * Math.PI) / 2,
    });
    at += glyph.width + track;
  }

  return {
    glyphs: placed,
    sweep,
    start,
    head: pointOnArc(cx, cy, radius, start),
    width,
    straight: false,
  };
}

/**
 * The "along the arc" value that puts the leading edge of the run at a point.
 *
 * Used by the drag on the stage, where the pointer says where the words
 * should begin rather than which angle they should have. The anchor is undone
 * first, so grabbing the handle and moving it lands the handle under the
 * pointer rather than offset by however much the anchor had already shifted
 * the run. Round trips against `arcLayout().head`.
 */
export function alongForPoint({
  cx = 0,
  cy = 0,
  arcStartDeg = 0,
  anchor = "middle",
  textSweep = 0,
  direction = 1,
  x = 0,
  y = 0,
} = {}) {
  const arcStart = (Number(arcStartDeg) || 0) * DEG;
  const dir = (direction ?? 1) >= 0 ? 1 : -1;
  const where = Math.atan2((Number(y) || 0) - (Number(cy) || 0), (Number(x) || 0) - (Number(cx) || 0));
  const offset = startAngle(anchor, textSweep, arcStart, dir) - arcStart;
  return normalizeAngle((where - arcStart - offset) / DEG);
}

/**
 * An arc segment as an SVG path.
 *
 * A sweep of zero has no path: it is a point on the circumference, and an arc
 * command with coincident endpoints draws nothing at all.
 */
export function arcPath({ cx = 0, cy = 0, radius = 0, start = 0, sweep = 0, direction = 1 } = {}) {
  const r = Number(radius) || 0;
  const span = Number(sweep) || 0;
  if (r <= 0 || span === 0) return "";

  const dir = direction >= 0 ? 1 : 0;
  const from = Number(start) || 0;
  const to = from + (dir === 1 ? span : -span);
  const p0 = pointOnArc(cx, cy, r, from);
  const p1 = pointOnArc(cx, cy, r, to);
  const large = Math.abs(span) > Math.PI ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} ${dir} ${p1.x} ${p1.y}`;
}
