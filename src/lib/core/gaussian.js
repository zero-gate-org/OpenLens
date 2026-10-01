/**
 * Separable Gaussian blur, and the mask maths that decides where it applies.
 *
 * Everything here is pure pixel arithmetic over a plain
 * `{ width, height, data }` object, which is the shape `ImageData` has. No
 * canvas is created and no `ImageData` is constructed, so the whole module
 * runs in plain Node and can be unit tested without a browser. Turning a
 * result back into real pixels is the caller's job.
 *
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} Pixels
 * @typedef {{isCancelled?: () => boolean, onProgress?: (ratio: number) => void}} PassOptions
 */

/**
 * Pixel-tap operations one blocking chunk may do before the main thread is
 * handed back. Small enough that a chunk fits inside a frame, so dragging a
 * slider never turns into a frozen tab.
 */
const TAPS_PER_CHUNK = 200_000;

let nextTask = null;

/** A real task with no timer clamp, for handing the main thread back. */
function channelTask() {
  const channel = new MessageChannel();
  /** @type {(() => void) | null} */
  let resume = null;
  channel.port1.onmessage = () => {
    const fn = resume;
    resume = null;
    fn?.();
  };
  return () =>
    new Promise((resolve) => {
      resume = () => resolve();
      channel.port2.postMessage(0);
    });
}

/**
 * Hand the main thread back for one real task.
 *
 * A `MessageChannel` round trip is the cheapest task a browser offers, and
 * unlike `setTimeout` it is not clamped to 4ms once timers start nesting. This
 * chain is hundreds of tasks deep on a large image, so that clamp would add
 * seconds of dead time. Built on first use, so an arithmetic-only caller (a
 * unit test, say) never creates a port it has no use for, and outside a browser
 * a plain timer is both enough and safe: an open port would keep a Node process
 * alive forever.
 */
function idle() {
  if (nextTask) return nextTask();

  nextTask =
    typeof window !== "undefined" && typeof MessageChannel === "function"
      ? channelTask()
      : () => new Promise((resolve) => setTimeout(resolve, 0));

  return nextTask();
}

/**
 * Output rows to process per chunk. Zero means run straight through: work that
 * already fits in a frame is not worth suspending for.
 */
function rowsPerChunk(tapsPerPixel, width) {
  if (tapsPerPixel * width <= TAPS_PER_CHUNK) return 0;
  return Math.max(1, Math.floor(TAPS_PER_CHUNK / (tapsPerPixel * width)));
}

const clamp = (value, limit) => (value < 0 ? 0 : value >= limit ? limit - 1 : value);

/**
 * A normalised Gaussian kernel `2r+1` taps wide.
 *
 * Sigma is radius/3, the usual "three sigma is the whole kernel" rule: a tap
 * three radii out sits at about one percent of the peak. The weights are
 * normalised so a blur conserves brightness, which is what makes a flat area
 * survive a pass untouched.
 *
 * @param {number} radius in pixels
 * @returns {Float32Array}
 */
export function createGaussianKernel(radius) {
  const r = Math.max(0, Math.round(radius));
  // A zero radius is the identity, and a one-tap kernel is the only honest way
  // to say so: exp(0 / 0) is NaN, not 1.
  if (r === 0) return Float32Array.of(1);

  const size = r * 2 + 1;
  const kernel = new Float32Array(size);
  const sigma = r / 3;
  const denominator = 2 * sigma * sigma;
  const center = (size - 1) / 2;

  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - center;
    kernel[i] = Math.exp(-(x * x) / denominator);
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  return kernel;
}

/**
 * Blur `pixels` with a separable Gaussian.
 *
 * Horizontal then vertical, which is the whole point of separability: a 2D
 * kernel of side k costs k² taps per pixel, a pair of 1D kernels costs 2k.
 * Both passes clamp at the edge, so the border replicates rather than turning
 * transparent.
 *
 * The loop hands the main thread back between row bands, and gives up entirely
 * if `isCancelled` reports that the caller has moved on. Small images never
 * yield, so a cheap call costs nothing to schedule.
 *
 * @param {Pixels} pixels
 * @param {number} radius in pixels
 * @param {PassOptions} [options]
 * @returns {Promise<Pixels | null>} null when cancelled
 */
export async function gaussianBlur(pixels, radius, options = {}) {
  const { width, height, data } = pixels;
  const { isCancelled = () => false, onProgress = null } = options;

  const kernel = createGaussianKernel(radius);
  const taps = kernel.length;
  if (taps === 1) {
    // A copy, never the same buffer: the caller still needs the sharp frame
    // for the foreground side of the composite.
    return { width, height, data: new Uint8ClampedArray(data) };
  }

  const half = (taps - 1) / 2;
  const scratch = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);
  // At least one cancellation check per pass, and one hand-back per band when
  // there is enough work to be worth suspending for.
  const band = rowsPerChunk(taps, width) || height;

  for (let pass = 0; pass < 2; pass++) {
    const from = pass === 0 ? data : scratch;
    const to = pass === 0 ? scratch : out;
    // One tap moves one pixel along the blurred axis: 4 bytes across, a whole
    // row down. Everything else is shared between the two passes so they cannot
    // drift apart, and the four totals are plain locals because this loop is
    // the hottest thing in the tool.
    const step = pass === 0 ? 4 : width * 4;
    const span = pass === 0 ? width : height;

    for (let y = 0; y < height; y++) {
      const lineBase = y * width * 4;

      for (let x = 0; x < width; x++) {
        const along = pass === 0 ? x : y;
        const base = pass === 0 ? lineBase : x * 4;

        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = 0; k < taps; k++) {
          const i = base + clamp(along + k - half, span) * step;
          const weight = kernel[k];
          r += from[i] * weight;
          g += from[i + 1] * weight;
          b += from[i + 2] * weight;
          a += from[i + 3] * weight;
        }

        const j = base + along * step;
        to[j] = r;
        to[j + 1] = g;
        to[j + 2] = b;
        to[j + 3] = a;
      }

      if (band && (y + 1) % band === 0) {
        onProgress?.((pass + (y + 1) / height) / 2);
        if (isCancelled()) return null;
        await idle();
      }
    }
    onProgress?.((pass + 1) / 2);
  }

  return { width, height, data: out };
}

/**
 * A normalised tent, the 1D profile a disc average approximates and the one
 * thing about that average which is actually separable.
 */
function createFeatherKernel(radius) {
  const r = Math.max(1, Math.round(radius));
  const size = r * 2 + 1;
  const kernel = new Float32Array(size);

  let sum = 0;
  for (let i = 0; i < size; i++) {
    kernel[i] = 1 - Math.abs(i - r) / r;
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  return kernel;
}

/**
 * Foreground coverage, softened over `radius` pixels.
 *
 * A segmentation mask is a hard alpha cut-out, and a hard cut-out leaves a
 * visible line where the sharp subject meets the blurred background. This
 * averages the mask alpha over a neighbourhood, weighted towards the centre,
 * so the line becomes a gradient the width of the feather.
 *
 * The neighbourhood is a tent smoothed across and then down, which is the
 * separable twin of the legacy disc average: it leaves a ramp of the same width
 * across an edge, and it is linear in the radius rather than quadratic. A disc
 * of radius 20 is about 1,200 taps per pixel, which on a three megapixel image
 * is a quarter of a minute of main thread, and the whole point of a feather is
 * that it answers a slider.
 *
 * @param {Pixels} mask
 * @param {number} radius in pixels; 0 keeps the mask exactly as it is
 * @param {PassOptions} [options]
 * @returns {Promise<Uint8ClampedArray | null>} one alpha byte per pixel, or null when cancelled
 */
export async function featherMask(mask, radius, options = {}) {
  const { width, height, data } = mask;
  const { isCancelled = () => false, onProgress = null } = options;

  // The mask alpha on its own, so the pass is a byte read and a multiply
  // rather than a strided read through four channels.
  const alpha = new Uint8ClampedArray(width * height);
  for (let p = 0; p < alpha.length; p++) alpha[p] = data[p * 4 + 3];
  if (radius <= 0) return alpha;

  const kernel = createFeatherKernel(radius);
  const taps = kernel.length;
  const half = (taps - 1) / 2;
  const scratch = new Uint8ClampedArray(alpha.length);
  const out = new Uint8ClampedArray(alpha.length);
  const band = rowsPerChunk(taps, width) || height;

  for (let pass = 0; pass < 2; pass++) {
    const from = pass === 0 ? alpha : scratch;
    const to = pass === 0 ? scratch : out;
    const step = pass === 0 ? 1 : width;
    const span = pass === 0 ? width : height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const along = pass === 0 ? x : y;
        const base = pass === 0 ? y * width : x;

        let acc = 0;
        for (let k = 0; k < taps; k++) {
          acc += from[base + clamp(along + k - half, span) * step] * kernel[k];
        }

        to[base + along * step] = acc;
      }

      if (band && (y + 1) % band === 0) {
        onProgress?.((pass + (y + 1) / height) / 2);
        if (isCancelled()) return null;
        await idle();
      }
    }
    onProgress?.((pass + 1) / 2);
  }

  return out;
}

/**
 * Sharp where the mask says the subject is, blurred everywhere else.
 *
 * `coverage` is a featherMask result, so it is the same thing at radius 0.
 * Alpha comes from the original rather than the blurred frame: the blur is a
 * treatment for the background, and borrowing the blurred alpha would soften
 * the subject's own edges too.
 *
 * @param {Pixels} original
 * @param {Pixels} blurred
 * @param {Uint8ClampedArray} coverage one 0-255 value per pixel
 * @returns {Pixels}
 */
export function compositeWithMask(original, blurred, coverage) {
  const { width, height, data } = original;
  const out = new Uint8ClampedArray(data.length);

  for (let p = 0, i = 0; i < data.length; p += 1, i += 4) {
    const mix = coverage[p] / 255;

    if (mix >= 1) {
      out[i] = data[i];
      out[i + 1] = data[i + 1];
      out[i + 2] = data[i + 2];
      out[i + 3] = data[i + 3];
      continue;
    }

    const rest = 1 - mix;
    out[i] = data[i] * mix + blurred.data[i] * rest;
    out[i + 1] = data[i + 1] * mix + blurred.data[i + 1] * rest;
    out[i + 2] = data[i + 2] * mix + blurred.data[i + 2] * rest;
    out[i + 3] = data[i + 3];
  }

  return { width, height, data: out };
}
