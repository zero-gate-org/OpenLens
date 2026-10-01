/**
 * Glitch art: digital corruption, as a set of independent passes.
 *
 * Five passes, each switched on or off on its own, all of them scaled by one
 * master intensity and all of them driven by a single seeded generator. The
 * seed is the whole contract: the same seed and the same settings corrupt a
 * frame in the same way every time, so a preview recomputed on every slider
 * move does not flicker, and changing the seed or a setting is the only way to
 * get a different corruption.
 *
 * Everything here is pure arithmetic over a plain `{ width, height, data }`
 * object, which is the shape `ImageData` has. No canvas is created, no
 * `ImageData` is constructed and no `ImageData` global is touched, so the whole
 * module runs in plain Node and can be unit tested without a browser, and the
 * same code runs unchanged inside a Web Worker. Turning a result back into real
 * pixels is the caller's job.
 *
 * The legacy tool drew its horizontal slices with `drawImage` on a canvas and
 * ran the other four passes by hand over `ImageData`, and it only went to a
 * worker on an image over two megapixels. Here the slices are a byte copy like
 * the rest, which is what puts every pass in one place that can be tested and
 * puts the whole tool on one code path.
 *
 * Two deliberate differences from the legacy, both of them about being a
 * predictable operation rather than a faithful copy:
 *
 * - Intensity 0 is the identity for the whole tool. In the legacy, block
 *   displacement still moved blocks and scanline replacement still brightened
 *   rows at 0, because those two passes did not scale their effect down to
 *   nothing. A slider that reaches 0 and still changes the picture is a slider
 *   lying about where its end is.
 * - No pass invents an alpha value. The legacy carried alpha over with a
 *   datamosh block and with a scanline row, which punches holes in a cut-out
 *   PNG. Alpha is the shape of the picture rather than part of its tone, so it
 *   is left where it is. Slicing is the one exception, and it is not one: a
 *   slice is the row moved rather than the row recoloured, so alpha travels
 *   with it and the frame ends up with the same alphas, reordered.
 *
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 *
 * @typedef {object} GlitchOptions
 * @property {number}  [seed]           integer, selects the corruption
 * @property {number}  [intensity]      0..1, 0 leaves the frame untouched
 * @property {boolean} [slicing]        bands of rows shifted sideways
 * @property {boolean} [channel]        bands with red and blue pulled apart
 * @property {boolean} [scanline]       whole rows replaced from elsewhere
 * @property {boolean} [datamosh]       blocks copied over from elsewhere
 * @property {boolean} [rgbSplit]       wide bands with red and blue pulled apart
 * @property {number}  [sliceCount]     how many bands to shift
 * @property {number}  [maxSliceOffset] the largest shift, in pixels
 * @property {number}  [blockSize]      the side of a datamosh block, in pixels
 */

/**
 * The settings a panel starts on, in the same units a panel uses.
 *
 * Intensity is 0..1 here, which is what the arithmetic wants. A slider is 0
 * to 100, and a tool scales its own slider, so the conversion lives at the
 * panel rather than being guessed at in a hundred call sites.
 */
export const GLITCH_DEFAULTS = {
  seed: 42,
  intensity: 0.5,
  slicing: true,
  channel: true,
  scanline: false,
  datamosh: false,
  rgbSplit: false,
  sliceCount: 10,
  maxSliceOffset: 80,
  blockSize: 16,
};

/** The pass switches, in the order they are offered and in the order they run. */
export const PASSES = Object.freeze([
  { key: "slicing", label: "Slicing", hint: "Bands of rows pushed sideways." },
  { key: "channel", label: "Channel shift", hint: "Bands of rows with red and blue pulled apart." },
  { key: "scanline", label: "Scanlines", hint: "Rows replaced by a row from somewhere else, brighter." },
  { key: "datamosh", label: "Block datamosh", hint: "Blocks copied over from elsewhere and tinted a little." },
  { key: "rgbSplit", label: "RGB split", hint: "Wide bands with a much wider red and blue split." },
]);

/** The slider ranges, exported so a panel and the arithmetic cannot drift. */
export const SLICE_COUNT = Object.freeze({ min: 2, max: 30, step: 1 });
export const SLICE_OFFSET = Object.freeze({ min: 10, max: 200, step: 1 });
export const BLOCK_SIZE = Object.freeze({ min: 8, max: 64, step: 4 });

/** A seed that a panel can hand straight to the field. */
export const MAX_SEED = 2147483647;

/**
 * The generator every seeded pass reads from.
 *
 * mulberry32, the same one the legacy tool used, so a seed that is meaningful
 * to somebody who has used the old editor still means something here. It is a
 * bijection on 32 bits, which is what makes the sequence reproducible on any
 * machine rather than on the one that drew it.
 *
 * @param {number} seed
 * @returns {() => number} a function returning 0..1
 */
export function makeRng(seed) {
  let state = (Number.isFinite(Number(seed)) ? Number(seed) : GLITCH_DEFAULTS.seed) | 0;
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One channel of one pixel, with the coordinates held inside the frame.
 *
 * A band that shifts a channel past the edge reads from the other side rather
 * than from nothing, which is the legacy behaviour and the reason a split never
 * leaves a black stripe down the frame.
 *
 * @param {Uint8ClampedArray} data
 * @param {number} x  may be outside 0..width-1
 * @param {number} y  may be outside 0..height-1
 * @param {number} width
 * @param {number} height
 * @param {number} channel 0, 1 or 2
 * @returns {number} 0..255
 */
export function readClamped(data, x, y, width, height, channel) {
  const cx = x < 0 ? 0 : x > width - 1 ? width - 1 : x;
  const cy = y < 0 ? 0 : y > height - 1 ? height - 1 : y;
  return data[(cy * width + cx) * 4 + channel];
}

/**
 * A scaled channel, as a byte.
 *
 * @param {number} value 0..255
 * @param {number} gain  a multiplier, may be below or above 1
 * @returns {number} 0..255
 */
function scaleChannel(value, gain) {
  const n = Math.round(value * gain);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

/**
 * Where the slicing pass will cut, given a generator.
 *
 * Returned as a plan rather than only written, so a panel or a test can see the
 * bands before any pixel is touched, and so the guarantee that a band stays
 * inside the frame is a property of one function: every band starts at a row
 * that exists and is cut back to the last row that does.
 *
 * @param {number} height
 * @param {number} count   how many bands to draw
 * @param {number} maxOffset  the largest shift, in pixels
 * @param {() => number} rng
 * @returns {{y: number, height: number, offset: number}[]}
 */
export function planSlices(height, count, maxOffset, rng) {
  const bands = [];
  const rows = Math.max(0, height);
  const total = Math.max(0, Math.round(count));
  const span = Math.round(maxOffset);

  for (let i = 0; i < total; i++) {
    const y = Math.min(rows - 1, Math.max(0, Math.floor(rng() * rows)));
    // Three rows is the thinnest band worth seeing, fifty the thickest, and a
    // band is cut back to the frame so it can never run off the bottom.
    const wanted = Math.max(3, Math.min(50, Math.floor(rng() * 48) + 3));
    const bandHeight = Math.max(0, Math.min(wanted, rows - y));
    const offset = Math.round((rng() * 2 - 1) * span);

    // A band that does not move is not a band, and the generator draw that
    // chose it has still been spent, so the following bands are unchanged.
    if (bandHeight === 0 || offset === 0) continue;
    bands.push({ y, height: bandHeight, offset });
  }

  return bands;
}

/**
 * Slicing: bands of rows pushed sideways and wrapped round the edge.
 *
 * The read and the write are both inside the row: the shift is folded into
 * 0..width-1 first, so a band shifted further than the frame is wide wraps
 * rather than reading past the end of the buffer.
 *
 * @param {Uint8ClampedArray} src
 * @param {Uint8ClampedArray} dst
 * @param {number} width
 * @param {number} height
 * @param {() => number} rng
 * @param {number} amount 0..1
 * @param {number} sliceCount
 * @param {number} maxSliceOffset
 */
function slicingPass(src, dst, width, height, rng, amount, sliceCount, maxSliceOffset) {
  const span = Math.round(maxSliceOffset * amount);
  if (!(span > 0)) return;

  for (const band of planSlices(height, sliceCount, span, rng)) {
    const shift = ((band.offset % width) + width) % width;
    const end = band.y + band.height;

    for (let y = band.y; y < end; y++) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        const from = ((x - shift) % width + width) % width;
        const i = row + x * 4;
        const j = row + from * 4;
        // Alpha moves with the band: a slice is the row moved, not the row
        // recoloured, so a cut-out PNG keeps its shape.
        dst[i] = src[j];
        dst[i + 1] = src[j + 1];
        dst[i + 2] = src[j + 2];
        dst[i + 3] = src[j + 3];
      }
    }
  }
}

/**
 * The row band one of the two channel passes works on.
 *
 * A band starts at a row that exists and ends at the last row that does, which
 * is the only reason a band can never write outside the frame. Shared by the
 * narrow channel pass and the wide RGB one, so the two cannot disagree about
 * where a band ends.
 *
 * @param {number} height
 * @param {() => number} rng
 * @param {number} minHeight
 * @param {number} maxHeight
 * @returns {{from: number, to: number}}
 */
function bandRows(height, rng, minHeight, maxHeight) {
  const from = Math.min(height - 1, Math.max(0, Math.floor(rng() * height)));
  const wanted = Math.max(minHeight, Math.min(maxHeight, Math.floor(rng() * maxHeight) + minHeight));
  return { from, to: Math.min(height, from + wanted) };
}

/**
 * Channel shift: bands of rows with red and blue pulled apart.
 *
 * Red is read from the right of the pixel and blue from the left, so the two
 * pull away from each other and the band splits into a red fringe and a cyan
 * one. Green is left where it is, which is what keeps the picture readable
 * under the split.
 *
 * @param {Uint8ClampedArray} src
 * @param {Uint8ClampedArray} dst
 * @param {number} width
 * @param {number} height
 * @param {() => number} rng
 * @param {number} amount 0..1
 */
function channelPass(src, dst, width, height, rng, amount) {
  const bands = Math.max(1, Math.floor(rng() * 4) + 1);
  const shiftR = Math.round((rng() * 12 + 3) * amount);
  const shiftB = Math.round((rng() * 12 + 3) * amount);

  for (let b = 0; b < bands; b++) {
    const { from, to } = bandRows(height, rng, 10, 80);

    for (let y = from; y < to; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        dst[i] = readClamped(src, x + shiftR, y, width, height, 0);
        dst[i + 1] = src[i + 1];
        dst[i + 2] = readClamped(src, x - shiftB, y, width, height, 2);
        dst[i + 3] = src[i + 3];
      }
    }
  }
}

/**
 * RGB band split: the same idea as the channel pass, much further apart.
 *
 * @param {Uint8ClampedArray} src
 * @param {Uint8ClampedArray} dst
 * @param {number} width
 * @param {number} height
 * @param {() => number} rng
 * @param {number} amount 0..1
 */
function rgbSplitPass(src, dst, width, height, rng, amount) {
  const bands = Math.floor(rng() * 6) + 3;

  for (let b = 0; b < bands; b++) {
    const { from, to } = bandRows(height, rng, 5, 40);
    const shiftR = Math.round((20 + rng() * 20) * amount);
    const shiftB = Math.round((20 + rng() * 20) * amount);

    for (let y = from; y < to; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        dst[i] = readClamped(src, x + shiftR, y, width, height, 0);
        dst[i + 1] = src[i + 1];
        dst[i + 2] = readClamped(src, x - shiftB, y, width, height, 2);
        dst[i + 3] = src[i + 3];
      }
    }
  }
}

/**
 * Scanlines: whole rows replaced by a row from elsewhere, and brightened.
 *
 * The replacement is a row, so a scanline tears the picture horizontally the
 * way a dropped video field does. The brightness is above one, so the torn row
 * is always lighter than the row it landed on rather than an arbitrary
 * darkening.
 *
 * @param {Uint8ClampedArray} src
 * @param {Uint8ClampedArray} dst
 * @param {number} width
 * @param {number} height
 * @param {() => number} rng
 * @param {number} amount 0..1
 */
function scanlinePass(src, dst, width, height, rng, amount) {
  const rows = Math.max(1, Math.floor(height * 0.05));

  for (let i = 0; i < rows; i++) {
    const y = Math.min(height - 1, Math.max(0, Math.floor(rng() * height)));
    const from = Math.min(height - 1, Math.max(0, Math.floor(rng() * height)));
    const gain = 1.2 + rng() * 0.8 * amount;

    for (let x = 0; x < width; x++) {
      const i2 = (y * width + x) * 4;
      const j = (from * width + x) * 4;
      dst[i2] = scaleChannel(src[j], gain);
      dst[i2 + 1] = scaleChannel(src[j + 1], gain);
      dst[i2 + 2] = scaleChannel(src[j + 2], gain);
      // Alpha is the destination row's, so replacing a row does not change
      // the shape of the picture.
      dst[i2 + 3] = src[i2 + 3];
    }
  }
}

/**
 * Block datamosh: blocks copied over from elsewhere in the frame, tinted.
 *
 * The tint is what separates this from a plain block move, and it is why the
 * corruption reads as compression damage rather than as a cut and paste. The
 * block grid is the whole frame divided by the block size, so the blocks are
 * the same size as the source block and nothing is stretched.
 *
 * @param {Uint8ClampedArray} src
 * @param {Uint8ClampedArray} dst
 * @param {number} width
 * @param {number} height
 * @param {() => number} rng
 * @param {number} amount 0..1
 * @param {number} blockSize
 */
function datamoshPass(src, dst, width, height, rng, amount, blockSize) {
  const block = Math.max(1, Math.round(blockSize));
  const cols = Math.floor(width / block);
  const rows = Math.floor(height / block);
  // A frame narrower than one block has no grid to move blocks on, and a
  // division by zero here would take the whole pass down with it.
  if (cols < 1 || rows < 1) return;

  const count = Math.max(1, Math.floor(cols * rows * (0.1 + rng() * 0.15)));

  for (let i = 0; i < count; i++) {
    const bx = Math.floor(rng() * cols);
    const by = Math.floor(rng() * rows);
    const sx = Math.floor(rng() * cols);
    const sy = Math.floor(rng() * rows);
    const tintR = 1 + (rng() - 0.5) * 0.4 * amount;
    const tintG = 1 + (rng() - 0.5) * 0.4 * amount;
    const tintB = 1 + (rng() - 0.5) * 0.4 * amount;

    for (let dy = 0; dy < block; dy++) {
      const dstY = by * block + dy;
      const srcY = sy * block + dy;
      if (dstY >= height || srcY >= height) continue;

      for (let dx = 0; dx < block; dx++) {
        const dstX = bx * block + dx;
        const srcX = sx * block + dx;
        if (dstX >= width || srcX >= width) continue;

        const i = (dstY * width + dstX) * 4;
        const j = (srcY * width + srcX) * 4;
        dst[i] = scaleChannel(src[j], tintR);
        dst[i + 1] = scaleChannel(src[j + 1], tintG);
        dst[i + 2] = scaleChannel(src[j + 2], tintB);
        // Alpha stays with the destination block, so a block that lands on a
        // transparent part of a cut-out does not punch a hole in it.
        dst[i + 3] = src[i + 3];
      }
    }
  }
}

/**
 * Corrupt a frame.
 *
 * The passes run in a fixed order and share one generator, and only the passes
 * that are switched on draw from it, so a given set of switches always
 * produces the same corruption and switching a pass off never shifts what a
 * later pass does.
 *
 * Two buffers are allocated and swapped, whatever the number of passes, so a
 * five pass corruption does not walk five times the memory of the frame. The
 * result is always a new buffer: a preview built from it must never alias the
 * clean frame the next control change starts from.
 *
 * @param {Pixels} pixels
 * @param {GlitchOptions} [options]
 * @returns {Pixels}
 */
export function applyGlitch(pixels, options = {}) {
  const {
    seed = GLITCH_DEFAULTS.seed,
    intensity = GLITCH_DEFAULTS.intensity,
    slicing = GLITCH_DEFAULTS.slicing,
    channel = GLITCH_DEFAULTS.channel,
    scanline = GLITCH_DEFAULTS.scanline,
    datamosh = GLITCH_DEFAULTS.datamosh,
    rgbSplit = GLITCH_DEFAULTS.rgbSplit,
    sliceCount = GLITCH_DEFAULTS.sliceCount,
    maxSliceOffset = GLITCH_DEFAULTS.maxSliceOffset,
    blockSize = GLITCH_DEFAULTS.blockSize,
  } = options;

  const { width, height, data } = pixels;
  const amount = Math.max(0, Math.min(1, intensity));

  // Intensity 0 is the identity, and short-circuiting keeps it exact: the same
  // bytes in and out, no rounding and no clamping. Two of the passes do not
  // scale to nothing on their own, so the gate is here rather than in each one.
  if (!(amount > 0)) return { width, height, data: new Uint8ClampedArray(data) };

  /** @type {Array<(src: Uint8ClampedArray, dst: Uint8ClampedArray, rng: () => number) => void>} */
  const passes = [];
  const count = Math.max(0, Math.round(sliceCount));
  const shift = Math.max(0, Math.round(maxSliceOffset));
  const block = Math.max(1, Math.round(blockSize));

  if (slicing) {
    passes.push((src, dst, rng) => slicingPass(src, dst, width, height, rng, amount, count, shift));
  }
  if (channel) {
    passes.push((src, dst, rng) => channelPass(src, dst, width, height, rng, amount));
  }
  if (scanline) {
    passes.push((src, dst, rng) => scanlinePass(src, dst, width, height, rng, amount));
  }
  if (datamosh) {
    passes.push((src, dst, rng) => datamoshPass(src, dst, width, height, rng, amount, block));
  }
  if (rgbSplit) {
    passes.push((src, dst, rng) => rgbSplitPass(src, dst, width, height, rng, amount));
  }

  if (passes.length === 0) return { width, height, data: new Uint8ClampedArray(data) };

  const rng = makeRng(seed);
  let current = new Uint8ClampedArray(data);
  let next = new Uint8ClampedArray(data);

  for (const pass of passes) {
    pass(current, next, rng);
    const swap = current;
    current = next;
    next = swap;
  }

  return { width, height, data: current };
}
