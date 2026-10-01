/**
 * The sticker catalogue and the maths behind placing one.
 *
 * Free of runes, of the DOM and of canvas: everything here takes numbers and
 * returns numbers, which is what lets `tests/stickerkit.test.js` check the
 * placement rules without a browser.
 *
 * Two ideas worth reading twice.
 *
 * 1. The frame of reference. A mark is authored in its own `viewBox`, whatever
 *    size the legacy file happened to use. `placementMatrix` maps that viewBox
 *    onto a rectangle on the picture, so the stage layer and the commit canvas
 *    can each apply one matrix and neither has to know how a sticker is drawn.
 *    The preview and the committed pixels cannot drift apart, because neither
 *    of them decides where the mark goes.
 *
 * 2. The catalogue is data, not markup. Every entry is an object with a
 *    `viewBox` and a `body` of inline SVG authored right here. There are no
 *    files on disk and nothing is fetched. `stickerDataUrl` assembles the two
 *    into the string the commit canvas rasterises from.
 *
 * Every length is in image pixels, so nothing here knows what the stage
 * happens to be zoomed to.
 */

const DEG = Math.PI / 180;

/** Where the film strip's sprocket holes sit, in viewBox units. */
const PERFORATIONS = [10, 25, 40, 55, 70, 85];

/** One row of sprocket holes, spelled out rather than fetched. */
const perforationRow = (y) =>
  PERFORATIONS.map((x) => `<rect x="${x}" y="${y}" width="8" height="8" rx="1" fill="#616161"/>`).join("");

/**
 * The built-in marks.
 *
 * Ported from the legacy `svg-stickers.js`, which held 25 entries. Two things
 * did not come across. The legacy sticker tool also shipped an emoji picker
 * and an upload box that stored user files in `sessionStorage` and read them
 * back as data URLs; neither is a graphic mark and the upload path is a way to
 * hand this tool an SVG that references the network, which is exactly what
 * taints a canvas. Both are gone rather than reimplemented, and this catalogue
 * is the only source of marks.
 *
 * `body` is authored here and is trusted markup: no `<image>`, no external
 * URL, no `<foreignObject>`, no web font. `stickerDataUrl` relies on that, and
 * the comment there says so.
 *
 * @type {ReadonlyArray<{key: string, name: string, viewBox: string, body: string}>}
 */
export const CATALOGUE = Object.freeze([
  {
    key: "star4",
    name: "4-Point Star",
    viewBox: "0 0 100 100",
    body: `<polygon points="50,5 61,39 95,39 68,60 79,95 50,73 21,95 32,60 5,39 39,39" fill="#FFD700" stroke="#E6B800" stroke-width="2"/>`,
  },
  {
    key: "star5",
    name: "5-Point Star",
    viewBox: "0 0 100 100",
    body: `<polygon points="50,3 63,35 98,38 72,60 80,95 50,75 20,95 28,60 2,38 37,35" fill="#FF6B35" stroke="#CC5529" stroke-width="2"/>`,
  },
  {
    key: "starburst",
    name: "Star Burst",
    viewBox: "0 0 100 100",
    body: `<polygon points="50,0 56,40 100,30 62,50 100,70 56,60 50,100 44,60 0,70 38,50 0,30 44,40" fill="#FFEB3B" stroke="#F9A825" stroke-width="1.5"/>`,
  },
  {
    key: "heart-solid",
    name: "Solid Heart",
    viewBox: "0 0 100 100",
    body: `<path d="M50,88 C20,60 5,40 5,28 C5,12 20,3 35,3 C42,3 48,7 50,12 C52,7 58,3 65,3 C80,3 95,12 95,28 C95,40 80,60 50,88Z" fill="#E53935" stroke="#C62828" stroke-width="2"/>`,
  },
  {
    key: "heart-outline",
    name: "Outlined Heart",
    viewBox: "0 0 100 100",
    body: `<path d="M50,88 C20,60 5,40 5,28 C5,12 20,3 35,3 C42,3 48,7 50,12 C52,7 58,3 65,3 C80,3 95,12 95,28 C95,40 80,60 50,88Z" fill="none" stroke="#E53935" stroke-width="4"/>`,
  },
  {
    key: "heart-broken",
    name: "Broken Heart",
    viewBox: "0 0 100 100",
    body: `<path d="M50,88 C20,60 5,40 5,28 C5,12 20,3 35,3 C42,3 48,7 50,12" fill="none" stroke="#E53935" stroke-width="4" stroke-linecap="round"/><path d="M50,12 C52,7 58,3 65,3 C80,3 95,12 95,28 C95,40 80,60 50,88" fill="none" stroke="#E53935" stroke-width="4" stroke-linecap="round"/><path d="M50,25 L58,50 L45,55 L55,80" fill="none" stroke="#E53935" stroke-width="3" stroke-linecap="round"/>`,
  },
  {
    key: "arrow-right",
    name: "Arrow Right",
    viewBox: "0 0 100 60",
    body: `<path d="M5,30 L80,30 M65,15 L80,30 L65,45" fill="none" stroke="#2196F3" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    key: "arrow-left",
    name: "Arrow Left",
    viewBox: "0 0 100 60",
    body: `<path d="M95,30 L20,30 M35,15 L20,30 L35,45" fill="none" stroke="#2196F3" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    key: "arrow-curve",
    name: "Curved Arrow",
    viewBox: "0 0 100 100",
    body: `<path d="M15,75 C15,25 85,25 85,75" fill="none" stroke="#4CAF50" stroke-width="5" stroke-linecap="round"/><path d="M75,65 L85,75 L75,85" fill="none" stroke="#4CAF50" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    key: "speech",
    name: "Speech Bubble",
    viewBox: "0 0 100 80",
    body: `<path d="M10,5 H90 C95,5 95,10 95,15 V50 C95,55 90,55 85,55 H35 L20,70 L25,55 H10 C5,55 5,50 5,45 V10 C5,5 10,5 10,5Z" fill="#FFFFFF" stroke="#333333" stroke-width="2"/>`,
  },
  {
    key: "spiky-bubble",
    name: "Spiky Bubble",
    viewBox: "0 0 100 85",
    body: `<path d="M50,5 L58,20 L75,10 L68,28 L90,25 L72,38 L95,45 L72,50 L88,65 L68,55 L65,75 L50,58 L35,75 L32,55 L12,65 L28,50 L5,45 L28,38 L10,25 L32,28 L25,10 L42,20Z" fill="#FFF176" stroke="#F9A825" stroke-width="2"/>`,
  },
  {
    key: "thought",
    name: "Thought Bubble",
    viewBox: "0 0 100 85",
    body: `<ellipse cx="50" cy="35" rx="42" ry="28" fill="#FFFFFF" stroke="#333333" stroke-width="2"/><circle cx="28" cy="70" r="8" fill="#FFFFFF" stroke="#333333" stroke-width="2"/><circle cx="15" cy="80" r="5" fill="#FFFFFF" stroke="#333333" stroke-width="2"/>`,
  },
  {
    key: "badge-circle",
    name: "Circle Badge",
    viewBox: "0 0 100 100",
    body: `<circle cx="50" cy="50" r="45" fill="#1565C0" stroke="#0D47A1" stroke-width="3"/><circle cx="50" cy="50" r="38" fill="none" stroke="#42A5F5" stroke-width="2"/>`,
  },
  {
    key: "badge-hex",
    name: "Hexagon Badge",
    viewBox: "0 0 100 100",
    body: `<polygon points="50,3 93,25 93,75 50,97 7,75 7,25" fill="#7B1FA2" stroke="#4A148C" stroke-width="3"/><polygon points="50,15 83,32 83,68 50,85 17,68 17,32" fill="none" stroke="#CE93D8" stroke-width="2"/>`,
  },
  {
    key: "badge-shield",
    name: "Shield Badge",
    viewBox: "0 0 100 100",
    body: `<path d="M50,5 L90,20 V55 C90,75 70,90 50,97 C30,90 10,75 10,55 V20Z" fill="#2E7D32" stroke="#1B5E20" stroke-width="3"/><path d="M50,17 L80,29 V53 C80,68 65,80 50,86 C35,80 20,68 20,53 V29Z" fill="none" stroke="#66BB6A" stroke-width="2"/>`,
  },
  {
    key: "ribbon",
    name: "Ribbon",
    viewBox: "0 0 100 100",
    body: `<path d="M15,10 H85 V70 L50,55 L15,70Z" fill="#E91E63" stroke="#AD1457" stroke-width="2"/><path d="M35,10 V45 M50,10 V50 M65,10 V45" fill="none" stroke="#F48FB1" stroke-width="2"/>`,
  },
  {
    key: "crown",
    name: "Crown",
    viewBox: "0 0 100 70",
    body: `<path d="M5,55 L15,15 L35,40 L50,5 L65,40 L85,15 L95,55Z" fill="#FFD54F" stroke="#F9A825" stroke-width="2" stroke-linejoin="round"/><rect x="5" y="55" width="90" height="12" rx="2" fill="#FFA000" stroke="#E65100" stroke-width="1.5"/><circle cx="15" cy="15" r="4" fill="#FF7043"/><circle cx="50" cy="5" r="4" fill="#E53935"/><circle cx="85" cy="15" r="4" fill="#FF7043"/>`,
  },
  {
    key: "lightning",
    name: "Lightning",
    viewBox: "0 0 60 100",
    body: `<polygon points="35,0 10,50 28,50 15,100 55,40 35,40 50,0" fill="#FFEB3B" stroke="#F9A825" stroke-width="2" stroke-linejoin="round"/>`,
  },
  {
    key: "check",
    name: "Checkmark",
    viewBox: "0 0 100 100",
    body: `<circle cx="50" cy="50" r="45" fill="#4CAF50" stroke="#2E7D32" stroke-width="3"/><path d="M28,52 L42,66 L72,32" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    key: "cross",
    name: "X Mark",
    viewBox: "0 0 100 100",
    body: `<circle cx="50" cy="50" r="45" fill="#E53935" stroke="#B71C1C" stroke-width="3"/><path d="M32,32 L68,68 M68,32 L32,68" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round"/>`,
  },
  {
    key: "sparkles",
    name: "Sparkles",
    viewBox: "0 0 100 100",
    body: `<path d="M50,10 L54,40 L80,20 L56,42 L90,50 L56,58 L80,80 L54,60 L50,90 L46,60 L20,80 L44,58 L10,50 L44,42 L20,20 L46,40Z" fill="#FFD700" stroke="#F9A825" stroke-width="1.5"/>`,
  },
  {
    key: "magnifier",
    name: "Magnifying Glass",
    viewBox: "0 0 100 100",
    body: `<circle cx="42" cy="42" r="30" fill="none" stroke="#546E7A" stroke-width="6"/><line x1="63" y1="63" x2="90" y2="90" stroke="#546E7A" stroke-width="8" stroke-linecap="round"/><circle cx="42" cy="42" r="20" fill="rgba(144,202,249,0.3)"/>`,
  },
  {
    key: "question",
    name: "Question Mark",
    viewBox: "0 0 100 100",
    body: `<circle cx="50" cy="50" r="45" fill="#FF9800" stroke="#E65100" stroke-width="3"/><path d="M38,35 C38,22 62,22 62,38 C62,48 50,50 50,60" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/><circle cx="50" cy="75" r="5" fill="#FFFFFF"/>`,
  },
  {
    key: "polaroid",
    name: "Polaroid Frame",
    viewBox: "0 0 100 110",
    body: `<rect x="3" y="3" width="94" height="104" rx="2" fill="#FFFFFF" stroke="#BDBDBD" stroke-width="2"/><rect x="10" y="10" width="80" height="65" fill="#E0E0E0"/><rect x="10" y="10" width="80" height="65" fill="none" stroke="#BDBDBD" stroke-width="1"/>`,
  },
  {
    key: "film-strip",
    name: "Film Strip",
    viewBox: "0 0 100 100",
    body: `<rect x="5" y="5" width="90" height="90" rx="3" fill="#212121" stroke="#424242" stroke-width="2"/><rect x="5" y="5" width="90" height="12" fill="#212121"/><rect x="5" y="83" width="90" height="12" fill="#212121"/>${perforationRow(7)}${perforationRow(85)}<rect x="12" y="22" width="76" height="56" fill="#424242"/>`,
  },
]);

/** Names and keys, for a `SelectField`. Empty when the catalogue is empty. */
export const CATALOGUE_OPTIONS = CATALOGUE.map((def) => ({ value: def.key, label: def.name }));

/** The first key in the catalogue, or null when there is none. */
export const FIRST_KEY = CATALOGUE.length > 0 ? CATALOGUE[0].key : null;

/** Bounds on a mark's width, in image pixels. */
export const MIN_STICKER_SIZE = 8;
export const MAX_STICKER_SIZE = 4000;

/** Bounds on the pixel size a mark is rasterised at for the commit. */
export const RASTER_MIN = 64;
export const RASTER_MAX = 1024;
const RASTER_SUPERSAMPLE = 2;

/** Where the default placement walks before it starts again. */
const PLACEMENT_COLUMNS = 4;
const PLACEMENT_ROWS = 3;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const round = (n) => Math.round(n * 100) / 100;

/**
 * Look a mark up by key.
 *
 * Returns null for anything unknown, including a catalogue that is empty. The
 * caller decides what an unknown key means; every call site here treats it as
 * "skip this item" rather than as an error, so a missing entry can never throw
 * mid-commit and lose the whole run.
 */
export function stickerByKey(key) {
  if (!key) return null;
  return CATALOGUE.find((def) => def.key === key) ?? null;
}

/**
 * The viewBox as numbers.
 *
 * A malformed viewBox is a bug in this file rather than in the operator's
 * input, so the fallback is a unit square: a mark drawn into it still renders,
 * it is just the wrong shape.
 */
export function viewBoxSize(def) {
  const parts = String(def?.viewBox ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) {
    return { w: 1, h: 1 };
  }
  return { w: parts[2], h: parts[3] };
}

/** A mark's height for a given width, keeping its own proportions. */
export function stickerAspect(def) {
  const { w, h } = viewBoxSize(def);
  return h / w;
}

/**
 * A width the tool will actually draw.
 *
 * The floor is positive and that is the whole point of the function. A width of
 * zero is not a smaller sticker, it is a sticker that cannot be seen, cannot
 * be grabbed and cannot be told apart from one that was never placed, so it
 * would read as "my sticker vanished". A non-finite width, which is what an
 * empty number field produces, lands on the floor for the same reason.
 */
export function clampSize(size, min = MIN_STICKER_SIZE, max = MAX_STICKER_SIZE) {
  const floor = Math.max(1, num(min, MIN_STICKER_SIZE));
  const n = Number(size);
  if (!Number.isFinite(n)) return floor;
  return Math.min(Math.max(n, floor), Math.max(floor, num(max, MAX_STICKER_SIZE)));
}

/** An opacity as a whole percentage, 0 to 100. */
export function clampOpacity(opacity) {
  const n = Number(opacity);
  if (!Number.isFinite(n)) return 100;
  return Math.round(clamp(n, 0, 100));
}

/**
 * An angle inside one turn.
 *
 * 360 normalises to 0 rather than to 360, so the value is always in [0, 360)
 * and two angles that point the same way are the same number. Negative angles
 * come from the rotate handle, which measures from the top of the mark, and
 * they wrap rather than clamp: 370 is 10 degrees, not 180.
 */
export function normalizeDegrees(degrees) {
  const n = Number(degrees);
  if (!Number.isFinite(n)) return 0;
  const wrapped = n % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** An angle in whole degrees, normalised. */
export function clampRotation(degrees) {
  return Math.round(normalizeDegrees(degrees));
}

/**
 * The mark's rectangle on the picture, in image pixels.
 *
 * The width is the one number the operator sets; the height follows from the
 * mark's own proportions, so a sticker can never be squashed by accident.
 * `clampSize` runs here rather than at the control, so a hand-edited item
 * cannot reach a renderer as zero.
 */
export function itemBox(item, def) {
  const w = clampSize(item?.size);
  return { w, h: w * stickerAspect(def) };
}

/**
 * Where a mark sits on the picture, as a 2D affine matrix.
 *
 * The matrix maps the mark's own viewBox onto the image: it translates to the
 * centre, turns by the rotation, scales by the size and mirrors if asked, and
 * then shifts by half the viewBox so the mark lands centred rather than
 * hanging off the top-left corner.
 *
 * The stage layer hands these six numbers to SVG as `matrix(a b c d e f)` and
 * the commit canvas hands the same six to `ctx.transform`. Neither renderer
 * repeats the arithmetic, so what is on the stage is what lands in the file.
 */
export function placementMatrix(item, def) {
  const { w: vw, h: vh } = viewBoxSize(def);
  const { w, h } = itemBox(item, def);

  const rad = clampRotation(item?.rotation) * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = (item?.flipX ? -1 : 1) * (w / vw);
  const sy = (item?.flipY ? -1 : 1) * (h / vh);

  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const e = num(item?.x) + a * (-vw / 2) + c * (-vh / 2);
  const f = num(item?.y) + b * (-vw / 2) + d * (-vh / 2);

  return { a, b, c, d, e, f };
}

/** The same matrix as an SVG `transform` value. */
export function matrixString(m) {
  return `matrix(${round(m.a)} ${round(m.b)} ${round(m.c)} ${round(m.d)} ${round(m.e)} ${round(m.f)})`;
}

/**
 * The inverse of a placement matrix, or null when it has none.
 *
 * Used to turn a pointer position into the mark's own coordinates for hit
 * testing. A singular matrix can only come from a zero size, and `clampSize`
 * keeps that from happening, so the null is a guard rather than a normal path:
 * callers skip the item rather than dividing by it.
 */
export function invertMatrix(m) {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Move a point through a matrix. */
export function transformPoint(m, point) {
  return {
    x: m.a * point.x + m.c * point.y + m.e,
    y: m.b * point.x + m.d * point.y + m.f,
  };
}

/** Whether a point, in image coordinates, lands on a mark. */
export function containsPoint(item, def, point) {
  const inverse = invertMatrix(placementMatrix(item, def));
  if (!inverse || !point) return false;
  const local = transformPoint(inverse, { x: num(point.x), y: num(point.y) });
  const { w: vw, h: vh } = viewBoxSize(def);
  return local.x >= 0 && local.x <= vw && local.y >= 0 && local.y <= vh;
}

/**
 * The mark's upright bounding box on the picture.
 *
 * A turned mark does not occupy the rectangle it was drawn in, so this grows
 * the box by the rotated corners. That is what lets the panel say a mark has
 * left the frame instead of guessing from its centre.
 */
export function boundsOf(item, def) {
  const { w, h } = itemBox(item, def);
  const rad = clampRotation(item?.rotation) * DEG;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const bw = w * cos + h * sin;
  const bh = w * sin + h * cos;
  return { x: num(item?.x) - bw / 2, y: num(item?.y) - bh / 2, w: bw, h: bh };
}

/**
 * How a mark sits against the frame: which edges it runs past, and whether it
 * has left the frame altogether.
 *
 * `outside` is the one that matters. A mark entirely off the picture draws
 * nothing, and the operator would see a sticker they placed simply not appear
 * in the export with no way to tell why. The panel reports every mark with
 * `outside` set rather than dropping it from the commit.
 */
export function frameStatus(item, def, frame) {
  const box = boundsOf(item, def);
  const width = Math.max(0, num(frame?.width));
  const height = Math.max(0, num(frame?.height));

  if (!width || !height) {
    return { left: false, right: false, top: false, bottom: false, outside: false };
  }

  const left = box.x < 0;
  const top = box.y < 0;
  const right = box.x + box.w > width;
  const bottom = box.y + box.h > height;
  const touches = box.x + box.w > 0 && box.x < width && box.y + box.h > 0 && box.y < height;

  return { left, right, top, bottom, outside: !touches };
}

/**
 * Where the next mark goes.
 *
 * The legacy tool dropped every new sticker on the exact centre of the picture,
 * so the second one landed on top of the first and there was no way to tell
 * them apart. This walks a grid of slots instead, which spreads the first few
 * across the frame, and after the grid is full it walks the same slots again
 * with a nudge that shrinks to half a cell. The nudge is a fraction of a cell
 * rather than a fixed offset, so it never grows large enough to push a mark
 * out of the frame, and no two placements share a point.
 */
export function placementPoint(index, frame) {
  const i = Math.max(0, Math.trunc(num(index)));
  const width = Math.max(0, num(frame?.width));
  const height = Math.max(0, num(frame?.height));
  if (!width || !height) return { x: 0, y: 0 };

  const slots = PLACEMENT_COLUMNS * PLACEMENT_ROWS;
  const lap = Math.floor(i / slots);
  const slot = i % slots;
  const column = slot % PLACEMENT_COLUMNS;
  const row = Math.floor(slot / PLACEMENT_COLUMNS);

  const cellW = width / PLACEMENT_COLUMNS;
  const cellH = height / PLACEMENT_ROWS;
  // Half a cell at most, approached but never reached, so every lap is a
  // distinct point and every one of them is still inside the frame.
  const nudgeX = (lap / (lap + 1)) * (cellW / 2);
  const nudgeY = (lap / (lap + 1)) * (cellH / 2);

  return {
    x: clamp(column * cellW + cellW / 2 + nudgeX, 0, width),
    y: clamp(row * cellH + cellH / 2 + nudgeY, 0, height),
  };
}

/** A key no item in the list is using. */
export function nextItemId(items) {
  const used = new Set(
    (Array.isArray(items) ? items : []).map((item) => item?.id).filter((id) => typeof id === "string"),
  );
  let n = 1;
  while (used.has(`sk-${n}`)) n += 1;
  return `sk-${n}`;
}

/**
 * A fresh item for a mark, seated at the next placement slot.
 *
 * `def` is looked up rather than passed in, so an item can only ever be built
 * from something the catalogue actually holds. A missing mark returns null and
 * the caller reports it, which is how an empty picker fails without taking the
 * panel down with it.
 */
export function createItem(key, index, frame) {
  const def = stickerByKey(key);
  if (!def) return null;

  const frameWidth = Math.max(1, num(frame?.width, 1));
  const frameHeight = Math.max(1, num(frame?.height, 1));
  const at = placementPoint(index, { width: frameWidth, height: frameHeight });

  return {
    key: def.key,
    x: Math.round(at.x),
    y: Math.round(at.y),
    // A tenth of the frame's shorter side reads as "a sticker" rather than as
    // either a speck or a poster.
    size: Math.round(clampSize(Math.min(frameWidth, frameHeight) * 0.1)),
    rotation: 0,
    flipX: false,
    flipY: false,
    opacity: 100,
    visible: true,
  };
}

/** Put an item into a list. `at` defaults to the top, which is the front. */
export function insertItem(items, item, at) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (!item) return list;
  const index = Number.isFinite(at) ? Math.max(0, Math.min(list.length, Math.trunc(at))) : list.length;
  list.splice(index, 0, { ...item, id: nextItemId(items) });
  return list;
}

/** Take one item out. Everything else keeps its place. */
export function removeItem(items, id) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((item) => item?.id !== id);
}

/** Move an item to a position in the list, clamped to the ends. */
export function reorderItem(items, id, to) {
  const list = Array.isArray(items) ? items : [];
  const from = list.findIndex((item) => item?.id === id);
  if (from < 0) return list.slice();

  const target = Number.isFinite(to)
    ? Math.max(0, Math.min(list.length - 1, Math.trunc(to)))
    : list.length - 1;
  if (target === from) return list.slice();

  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** Move an item a number of places up or down the list. */
export function moveItemId(items, id, delta) {
  const list = Array.isArray(items) ? items : [];
  const from = list.findIndex((item) => item?.id === id);
  if (from < 0) return list.slice();
  return reorderItem(list, id, from + Math.trunc(num(delta)));
}

/** The items to draw, back to front: list order, hidden ones dropped. */
export function paintOrder(items) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((item) => item && item.visible !== false && stickerByKey(item.key));
}

/** The mark definition an item refers to, or null if it is not one we hold. */
export function itemDefinition(item) {
  return stickerByKey(item?.key);
}

/** How far a nudge moves a mark, in image pixels. */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_FAST = 10;

/**
 * The pixel size a mark should be rasterised at for the commit.
 *
 * The rotated box's diagonal times two, so a turned mark has detail to spare,
 * capped so one mark cannot ask for an enormous backing store. The cap is
 * deliberate and it is a memory bound: 1024 squared is about 4 MB decoded, and
 * the panel caches a handful of those at a time. Past the cap a very large
 * sticker is soft rather than the app being killed, which is the right way
 * round.
 */
export function rasterSizeFor(item, def) {
  const box = boundsOf(item, def);
  const diagonal = Math.hypot(box.w, box.h) * RASTER_SUPERSAMPLE;
  return Math.round(clamp(diagonal, RASTER_MIN, RASTER_MAX));
}

/**
 * A mark as a standalone SVG document.
 *
 * Safe to rasterise onto a canvas, and here is why.
 *
 * A canvas is only tainted when the browser has to pull a resource the page
 * origin does not cover, and the usual way that happens is an SVG that
 * references something: an `<image href>`, a `@import`, an external stylesheet,
 * a web font, a `<foreignObject>` holding a remote frame. Every one of those
 * is absent here, because the only markup is the `body` strings in
 * `CATALOGUE`, which are literal shape elements with literal paint values. The
 * document has no way to reach the network, so drawing it into a canvas leaves
 * that canvas exportable and `toBlob` keeps working.
 *
 * Nothing that puts an external reference into this string is added later. If
 * a mark ever needs one, it cannot come from the catalogue and it cannot come
 * from the operator: this tool takes no uploads.
 */
export function stickerSvgMarkup(def, pixels) {
  if (!def) return "";
  const size = viewBoxSize(def);
  const width = Math.round(clamp(pixels || size.w, 1, 8192));
  // A square box for a non-square viewBox, so the raster is never cropped.
  const height = Math.round((width * size.h) / size.w);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${def.viewBox}" width="${width}" height="${height}">${def.body}</svg>`;
}

/**
 * The same document as a data URL, for `new Image().src`.
 *
 * `pixels` is the raster width. The commit asks for the size the mark will
 * occupy, so a mark drawn at 900 px on the picture is decoded with the detail to
 * show there rather than at its 100-unit viewBox size and stretched.
 */
export function stickerDataUrl(def, pixels) {
  const markup = stickerSvgMarkup(def, pixels);
  return markup ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}` : "";
}