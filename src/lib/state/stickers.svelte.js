/**
 * Stickers placement state.
 *
 * The panel and the stage layer are two separate component instances of one
 * tool, and they have to agree on the same marks, the same selection and the
 * same order. That agreement cannot live in either of them, so it lives here: a
 * module level store, mounted and unmounted with the tool.
 *
 * Every value in this file is a decision the operator made, in image pixels,
 * degrees or percent. The arithmetic is in `core/stickerkit.js`, which is pure
 * and unit tested, so this file holds decisions and nothing else. There is no
 * canvas in here: the only thing that needs one is the commit, and the commit
 * lives in the panel.
 */

import {
  CATALOGUE,
  MAX_STICKER_SIZE,
  MIN_STICKER_SIZE,
  NUDGE_STEP,
  NUDGE_STEP_FAST,
  clampOpacity,
  clampRotation,
  clampSize,
  createItem,
  frameStatus,
  insertItem,
  itemDefinition,
  moveItemId,
  normalizeDegrees,
  paintOrder,
  removeItem,
  reorderItem,
  stickerByKey,
} from "../core/stickerkit.js";

class StickersStore {
  // --- What is on the picture -----------------------------------------
  /**
   * The placed marks, back to front: index 0 is painted first, the last index
   * is painted last and therefore sits on top. The panel lists them the other
   * way round, so the top of the list is the front.
   * @type {any[]}
   */
  items = $state([]);

  /** The one mark the placement controls describe, or null. */
  selectedId = $state(null);

  /** The catalogue entry the picker is offering to place next. */
  addKey = $state(null);

  // --- The image on stage ---------------------------------------------
  imageWidth = $state(0);
  imageHeight = $state(0);

  /**
   * Transient drag bookkeeping. Deliberately not `$state`: it is read only
   * during a pointermove and never rendered, so it should invalidate nothing.
   */
  drag = null;

  // --- Derived ---------------------------------------------------------

  /** The frame, as one object, so `frameStatus` has somewhere to read. */
  frame = $derived({ width: this.imageWidth, height: this.imageHeight });

  /** The chosen mark, or null. `addKey` follows the catalogue on reset. */
  addDefinition = $derived(stickerByKey(this.addKey));

  /** Items back to front with the hidden ones dropped, which is what is drawn. */
  drawing = $derived(paintOrder(this.items));

  /** The items the panel lists, front to back. */
  listed = $derived(this.items.slice().reverse());

  /** The selected item, or null. */
  selected = $derived(this.items.find((item) => item.id === this.selectedId) ?? null);

  /** The selected item's mark, or null. */
  selectedDefinition = $derived(itemDefinition(this.selected));

  /** The selected item's position in the list, front first. Zero based. */
  selectedPosition = $derived(
    this.selected ? this.listed.findIndex((item) => item.id === this.selected.id) + 1 : 0,
  );

  count = $derived(this.items.length);
  hiddenCount = $derived(this.items.filter((item) => item.visible === false).length);

  /** How many items sit at the front, so forward and back are one button each. */
  canRaise = $derived(this.selected ? this.listed.findIndex((item) => item.id === this.selected.id) > 0 : false);
  canLower = $derived(
    this.selected ? this.listed.findIndex((item) => item.id === this.selected.id) < this.items.length - 1 : false,
  );

  /**
   * Items that have left the frame, and how many only run over an edge.
   *
   * Reported rather than enforced. A mark pushed off the picture is a real
   * placement, and silently refusing to draw it would look like the tool lost
   * it, so it stays in the list and the panel says where it went.
   */
  offFrame = $derived(
    this.items
      .map((item) => ({ item, status: frameStatus(item, itemDefinition(item), this.frame) }))
      .filter((entry) => entry.status.outside || entry.status.left || entry.status.right || entry.status.top || entry.status.bottom),
  );

  lostCount = $derived(this.offFrame.filter((entry) => entry.status.outside).length);

  /**
   * Whether there is anything to put in the picture, and if not, why.
   *
   * A reason is a value rather than a note in the markup, so the button and the
   * sentence under it cannot disagree about whether Apply is live.
   */
  blockedBy = $derived(
    this.items.length === 0
      ? "Apply needs a sticker on the picture. Place one from the list above."
      : this.drawing.length === 0
        ? "Every sticker is hidden, so Apply has nothing to draw."
        : !stickerByKey(this.addKey) && this.addKey !== null
          ? "That sticker is not in the catalogue, so it cannot be placed."
          : null,
  );

  /** True when the composition is incomplete enough to refuse to draw it. */
  blocked = $derived(this.blockedBy !== null);

  // ---------------------------------------------------------------
  // Seeding
  // ---------------------------------------------------------------

  /**
   * Re-seed for the image on stage.
   *
   * Called once per mount, so leaving the tool and coming back starts from the
   * same place rather than from marks left over an image that may have been
   * committed or undone in the meantime. A different frame drops the marks:
   * their coordinates were in the old image's pixels and mean nothing now.
   */
  sync(width, height, force = false) {
    if (!width || !height) {
      this.imageWidth = 0;
      this.imageHeight = 0;
      this.clearAll();
      return;
    }

    if (!force && width === this.imageWidth && height === this.imageHeight) return;

    const changedFrame = width !== this.imageWidth || height !== this.imageHeight;
    this.imageWidth = width;
    this.imageHeight = height;

    if (!changedFrame && !force) return;

    this.clearAll();
    // The picker's choice is re-checked against the catalogue rather than kept
    // on trust, so a stale key cannot leave the select showing nothing while
    // Place sticker quietly refuses.
    if (!stickerByKey(this.addKey)) this.addKey = firstCatalogueKey();
  }

  /** Back to nothing placed. The image is untouched. */
  clearAll() {
    this.items = [];
    this.selectedId = null;
    this.drag = null;
  }

  // ---------------------------------------------------------------
  // Placing
  // ---------------------------------------------------------------

  /**
   * Put a copy of the chosen mark on the picture.
   *
   * Returns null when there is nothing to place, which is what an empty
   * catalogue looks like. The caller reports it and nothing is written, so a
   * catalogue with no entries leaves the picker and the rest of the panel
   * working rather than throwing on the way to an empty list.
   */
  add(key = this.addKey) {
    const def = stickerByKey(key);
    if (!def) return null;

    const item = createItem(def.key, this.items.length, this.frame);
    if (!item) return null;

    // A duplicate goes on top of the list, which is the front of the picture.
    this.items = insertItem(this.items, item, this.items.length);
    this.selectedId = this.items[this.items.length - 1].id;
    this.addKey = def.key;
    return this.selected;
  }

  /**
   * A second copy of a mark, nudged clear of the original.
   *
   * The copy takes the original's settings, because duplicating a sticker is
   * normally a second of the same thing rather than a fresh one. It goes on
   * top and takes the selection.
   */
  duplicate(id) {
    const source = this.items.find((item) => item.id === id);
    if (!source) return null;

    const step = Math.max(4, Math.round(clampSize(source.size) * 0.12));
    this.items = insertItem(
      this.items,
      { ...source, x: source.x + step, y: source.y + step },
      this.items.length,
    );
    this.selectedId = this.items[this.items.length - 1].id;
    return this.selected;
  }

  // ---------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------

  select(id) {
    this.selectedId = this.items.some((item) => item.id === id) ? id : null;
  }

  deselect() {
    this.selectedId = null;
  }

  /**
   * Step the selection through the list, front first.
   *
   * Bounds at both ends rather than wrapping: pressing "next" at the front of the
   * list should do nothing, not jump to the back and lose the operator's place.
   */
  selectOffset(delta) {
    if (!this.listed.length) return;
    const step = Math.trunc(Number(delta) || 0);
    if (!step) return;

    const current = this.listed.findIndex((item) => item.id === this.selectedId);
    const from = current < 0 ? (step > 0 ? -1 : 0) : current;
    const next = from + step;
    if (next < 0 || next >= this.listed.length) return;
    this.selectedId = this.listed[next].id;
  }

  // ---------------------------------------------------------------
  // List
  // ---------------------------------------------------------------

  remove(id) {
    this.items = removeItem(this.items, id);
    if (this.selectedId === id) this.selectedId = null;
  }

  toggleVisible(id) {
    this.items = this.items.map((item) =>
      item.id === id ? { ...item, visible: item.visible === false } : item,
    );
  }

  /** Bring a mark one place towards the front. */
  raise(id) {
    // The list runs back to front, so the front is the end of the array.
    this.items = reorderItem(this.items, id, this.items.length - 1);
  }

  /** Send a mark one place towards the back. */
  lower(id) {
    this.items = moveItemId(this.items, id, -1);
  }

  // ---------------------------------------------------------------
  // Editing the selection
  // ---------------------------------------------------------------

  /** Move the selected mark, in image pixels. */
  moveBy(dx, dy) {
    const item = this.selected;
    if (!item) return;
    item.x = Math.round(item.x + (Number(dx) || 0));
    item.y = Math.round(item.y + (Number(dy) || 0));
  }

  /**
   * Nudge the selected mark by one step, or ten with the fast modifier.
   *
   * This is the keyboard equivalent of dragging the move handle, and it is a
   * method rather than markup so a key handler and a button do the same thing.
   */
  nudge(dx, dy, fast = false) {
    const step = fast ? NUDGE_STEP_FAST : NUDGE_STEP;
    this.moveBy(Math.sign(dx) * step, Math.sign(dy) * step);
  }

  setPosition(axis, value) {
    const item = this.selected;
    if (!item) return;
    item[axis] = Math.round(Number(value) || 0);
  }

  /**
   * Set the mark's width.
   *
   * Goes through `clampSize`, so a zero or an empty field lands on the floor
   * rather than on nothing. A mark at the floor is small and still grabbable;
   * a mark at zero is invisible and indistinguishable from a lost one.
   */
  setSize(size) {
    const item = this.selected;
    if (!item) return;
    item.size = Math.round(clampSize(size, MIN_STICKER_SIZE, MAX_STICKER_SIZE));
  }

  setRotation(degrees) {
    const item = this.selected;
    if (!item) return;
    item.rotation = clampRotation(degrees);
  }

  setOpacity(opacity) {
    const item = this.selected;
    if (!item) return;
    item.opacity = clampOpacity(opacity);
  }

  // Mirroring is bound straight onto the item with `bind:checked`, the same as
  // Stroke Text's bold and italic, so there is no setter for it here. It is a
  // boolean with no range to clamp.

  /** Put the selected mark back in the middle of the picture. */
  centre() {
    const item = this.selected;
    if (!item) return;
    item.x = Math.round(this.imageWidth / 2);
    item.y = Math.round(this.imageHeight / 2);
  }

  /** Turn the selected mark back to square with the frame. */
  straighten() {
    this.setRotation(0);
  }

  // ---------------------------------------------------------------
  // Pointer interaction. `point` is in image coordinates.
  // ---------------------------------------------------------------

  beginDrag(kind, point) {
    const item = this.selected;
    if (!item || !kind || !point) return;

    this.drag = {
      kind,
      point: { x: point.x, y: point.y },
      x: item.x,
      y: item.y,
      size: item.size,
      rotation: item.rotation,
      // The handles are measured along the mark's own axis, so a corner dragged
      // on a turned sticker still tracks the pointer.
      local: localPoint(item, point),
    };
  }

  moveDrag(point) {
    const drag = this.drag;
    const item = this.selected;
    if (!drag || !item || !point) return;

    if (drag.kind === "move") {
      item.x = Math.round(drag.x + (point.x - drag.point.x));
      item.y = Math.round(drag.y + (point.y - drag.point.y));
      return;
    }

    if (drag.kind === "rotate") {
      // The angle at the start of the drag is folded in, so a mark grabbed at
      // 200 degrees does not jump to 20 the moment the pointer moves.
      this.setRotation(drag.rotation + angleBetween({ x: drag.x, y: drag.y }, point, drag.rotation));
      return;
    }

    // Scale, measured from where the drag started rather than from the current
    // size, which the clamp is already changing underneath it.
    const here = localPoint({ ...item, x: drag.x, y: drag.y, size: drag.size }, point);
    const reach = Math.hypot(here.x, here.y);
    const start = Math.hypot(drag.local.x, drag.local.y);
    if (!start) return;
    this.setSize((drag.size * reach) / start);
  }

  endDrag() {
    this.drag = null;
  }

  /**
   * The marks are in the pixels now, so stop drawing them.
   *
   * The list is emptied as well as deselected: clearing only the selection
   * would leave every mark on the stage for a frame, drawn on top of the image
   * they were just committed into.
   */
  bake() {
    this.clearAll();
  }

  // --- Ranges for the controls -----------------------------------------

  /** How far a placement coordinate may usefully sit from a frame edge. */
  get axisMax() {
    return Math.max(1, this.imageWidth, this.imageHeight) * 2;
  }

  /** The widest a mark may usefully be on this frame. */
  get sizeMax() {
    return Math.max(MIN_STICKER_SIZE, Math.round(Math.max(this.imageWidth, this.imageHeight) * 1.5));
  }
}

/**
 * A point in a mark's own frame, with the origin at its centre and x along its
 * own width.
 *
 * Straight maths rather than a matrix round trip, because the drag handles
 * only need the direction from the centre, not a general transform.
 */
function localPoint(item, point) {
  const rad = clampRotation(item?.rotation) * (Math.PI / 180);
  const dx = point.x - (item?.x ?? 0);
  const dy = point.y - (item?.y ?? 0);
  return { x: dx * Math.cos(rad) + dy * Math.sin(rad), y: -dx * Math.sin(rad) + dy * Math.cos(rad) };
}

/**
 * How far the pointer has turned around a mark's centre since the drag began.
 *
 * The angle is measured from the top of the mark rather than from the right, so
 * the rotate handle sits above the sticker and pulling right turns it
 * clockwise, which is what a handle at the top should do. `from` is the
 * reading at the start of the drag, and the difference is what gets applied, so
 * nothing jumps.
 */
function angleBetween(centre, point, from = 0) {
  const here = (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI + 90;
  return here - normalizeDegrees(from);
}

/** The first key in the catalogue, or null when the catalogue is empty. */
function firstCatalogueKey() {
  return CATALOGUE.length > 0 ? CATALOGUE[0].key : null;
}

export const stickers = new StickersStore();