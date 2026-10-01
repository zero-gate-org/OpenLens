/**
 * Pure crop geometry.
 *
 * Deliberately free of runes and of any DOM: everything here takes numbers
 * and returns numbers, which is what makes the interaction testable and what
 * keeps `crop.svelte.js` down to state.
 *
 * All coordinates are in image pixels.
 */

export const MIN_SIZE = 8; // smaller than this is not a usable crop

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Shrink and slide a box so it sits entirely inside the image. */
export function clampToBounds(box, width, height) {
  const w = Math.min(box.w, width);
  const h = Math.min(box.h, height);
  return {
    x: clamp(box.x, 0, Math.max(0, width - w)),
    y: clamp(box.y, 0, Math.max(0, height - h)),
    w,
    h,
  };
}

/** Drag the whole selection. `start` is where the grab began. */
export function moveBox(origin, start, point, width, height) {
  return clampToBounds(
    {
      ...origin,
      x: origin.x + (point.x - start.x),
      y: origin.y + (point.y - start.y),
    },
    width,
    height,
  );
}

/**
 * Resize from one handle.
 *
 * Corner handles track the pointer on both axes, anchored to the opposite
 * corner. Edge handles move only the grabbed edge; when a ratio is locked the
 * perpendicular axis follows, centred on its original midpoint. That is the
 * least surprising reading of "drag the right edge" under a 1:1 lock, where
 * pinning the other axis would make the handle immovable.
 *
 * @param {string} kind one of nw n ne e se s sw w
 * @param {number} aspect width/height, or 0 for free
 */
export function resizeBox(kind, origin, point, width, height, aspect = 0) {
  const { x, y, w, h } = origin;
  const right = x + w;
  const bottom = y + h;
  const west = kind.includes("w");
  const north = kind.includes("n");
  // A corner names two edges, an edge names one. Testing `west || north`
  // would classify every edge handle as a corner.
  const isCorner = kind.length === 2;
  const horizontalOnly = !isCorner && (kind === "e" || kind === "w");
  const verticalOnly = !isCorner && (kind === "n" || kind === "s");

  // Everything is measured from the edge that does *not* move, and is limited
  // by the room between that edge and the far side of the image. Clamping
  // against the whole image width instead would let a box grow past the edge.
  if (horizontalOnly) {
    const anchorX = west ? right : x;
    const room = west ? anchorX : width - anchorX;

    let nextW = clamp(Math.abs(point.x - anchorX), MIN_SIZE, room);
    let nextH = h;
    if (aspect > 0) {
      nextH = nextW / aspect;
      if (nextH > height) {
        nextH = height;
        nextW = nextH * aspect;
      }
    }

    const nextY = clamp(y + (h - nextH) / 2, 0, height - nextH);
    return { x: west ? anchorX - nextW : anchorX, y: nextY, w: nextW, h: nextH };
  }

  if (verticalOnly) {
    const anchorY = north ? bottom : y;
    const room = north ? anchorY : height - anchorY;

    let nextH = clamp(Math.abs(point.y - anchorY), MIN_SIZE, room);
    let nextW = w;
    if (aspect > 0) {
      nextW = nextH * aspect;
      if (nextW > width) {
        nextW = width;
        nextH = nextW / aspect;
      }
    }

    const nextX = clamp(x + (w - nextW) / 2, 0, width - nextW);
    return { x: nextX, y: north ? anchorY - nextH : anchorY, w: nextW, h: nextH };
  }

  const anchorX = west ? right : x;
  const anchorY = north ? bottom : y;
  const roomW = west ? anchorX : width - anchorX;
  const roomH = north ? anchorY : height - anchorY;

  let nextW = clamp(Math.abs(point.x - anchorX), MIN_SIZE, roomW);
  let nextH = clamp(Math.abs(point.y - anchorY), MIN_SIZE, roomH);

  if (aspect > 0) {
    // Whichever driven pair fits in the available room wins, so dragging a
    // corner near an edge never produces a box outside the picture.
    if (nextW / aspect <= roomH) {
      nextH = nextW / aspect;
    } else {
      nextH = roomH;
      nextW = nextH * aspect;
    }
    if (nextW > roomW) {
      nextW = roomW;
      nextH = nextW / aspect;
    }
  }

  return {
    x: west ? anchorX - nextW : anchorX,
    y: north ? anchorY - nextH : anchorY,
    w: nextW,
    h: nextH,
  };
}

/** Re-fit a box around its centre to a locked ratio, staying inside bounds. */
export function fitToAspect(box, aspect, width, height) {
  if (aspect <= 0) return box;

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let w = box.w;
  let h = w / aspect;

  if (h > height) {
    h = height;
    w = h * aspect;
  }
  if (w > width) {
    w = width;
    h = w / aspect;
  }

  return clampToBounds({ x: cx - w / 2, y: cy - h / 2, w, h }, width, height);
}

/** The initial selection: centred, inset a little from every edge. */
export function seedBox(width, height, inset = 0.05) {
  const w = Math.max(MIN_SIZE, width * (1 - inset * 2));
  const h = Math.max(MIN_SIZE, height * (1 - inset * 2));
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}
