/**
 * Shadow injection: the mask cache, and what the panel needs to know about it.
 *
 * A segmentation model decides which pixels are the subject, and that is the
 * expensive half by far: the decoded source pixels and the mask are kept here,
 * keyed on the image on the stage and the model that read it, so dragging the
 * offset costs a composite and never a second run of the model.
 *
 * This is a module-level store rather than component state for two reasons.
 * The panel is mounted and unmounted as the tool is switched, and a cache that
 * lived in the panel would be thrown away every time. The model import lives
 * here for the same reason: the promise outlives the panel, so switching away
 * and back does not re-import the library either.
 *
 * Invalidating is a single method. The panel calls it from one `$effect`
 * cleanup, which fires when the image changes, when the model changes and when
 * the tool is switched away, so there is no activate and deactivate bookkeeping
 * to get out of step with the controls.
 */

import { readPixels, sourceCanvas } from "../core/pixels.js";
import {
  buildShadow,
  hasSubject,
  shadowKey,
  subjectBounds,
  subjectMass,
} from "../core/shadow.js";

/**
 * @typedef {import("../core/shadow.js").Pixels} Pixels
 * @typedef {import("../core/shadow.js").ShadowOptions} ShadowOptions
 */

/** Finished frames to keep, so a slider can be dragged back and forth. */
const FRAMES_KEPT = 3;

/**
 * Identity of everything the cache holds: the image on the stage and the model
 * that read it.
 *
 * The editor store re-mints a record and its URL on every commit, so a URL plus
 * a model name can never collide across two images.
 *
 * @param {{url: string} | null} image
 * @param {string} model
 * @returns {string | null}
 */
export function shadowCacheKey(image, model) {
  return image ? `${image.url}:${model}` : null;
}

/** Turn the library's terse progress keys into something readable. */
function describeProgress(key) {
  const k = String(key ?? "").toLowerCase();
  if (k.includes("download") && k.includes("model")) return "Downloading the model";
  if (k.includes("download")) return "Downloading model files";
  if (k.includes("load")) return "Loading the model";
  if (k.includes("fetch")) return "Fetching the model";
  if (k.includes("infer") || k.includes("compute")) return "Finding the subject";
  return "Separating the subject";
}

class ShadowInjectionStore {
  /** The key the cached pixels and mask belong to, or null when empty. */
  key = $state(null);

  /**
   * Bumped by every invalidation. This is how work already in flight learns
   * that it is computing for an image nobody is looking at any more.
   */
  epoch = 0;

  /**
   * The decoded source pixels and the foreground mask.
   *
   * Deliberately not `$state`: writing a few megabytes of pixels is not
   * something Svelte needs to know about, and tracking it would invalidate the
   * panel on every frame of a segmentation.
   *
   * @type {Pixels | null}
   */
  original = null;
  /** @type {Pixels | null} */
  mask = null;

  /**
   * Finished frames by shadow settings.
   * @type {Map<string, Promise<Pixels | null>>}
   */
  frames = new Map();
  /** @type {Promise<unknown> | null} */
  pending = null;

  /** Measured share of the frame the subject covers, 0..1, or null. */
  subjectShare = $state(null);
  /** The subject's bounding box, or null. Read by the panel for the clamp. */
  bounds = $state(null);
  /** True once the model has run and there was nothing in the mask. */
  noSubject = $state(false);

  /**
   * Cached across mounts; a failed import must not poison the retry.
   *
   * Typed as `any` because the module is only reachable through a dynamic
   * import, so its shape is a runtime fact rather than something the checker
   * can read.
   *
   * @type {Promise<any> | null}
   */
  #modulePromise = null;

  /** True when the pixels and the mask are both here. */
  get ready() {
    return !!this.original && !!this.mask;
  }

  /** Drop everything. Work in flight sees the new epoch and gives up. */
  clear() {
    this.epoch += 1;
    this.key = null;
    this.original = null;
    this.mask = null;
    this.frames.clear();
    this.pending = null;
    this.subjectShare = null;
    this.bounds = null;
    this.noSubject = false;
  }

  /**
   * A predicate that goes true the moment the image, the model or the tool
   * changes underneath work in flight.
   * @returns {() => boolean}
   */
  staleness() {
    const epoch = this.epoch;
    return () => this.epoch !== epoch;
  }

  /** Keep only the newest `limit` entries of an insertion-ordered Map. */
  trim(map, limit) {
    for (const key of map.keys()) {
      if (map.size <= limit) break;
      map.delete(key);
    }
  }

  /**
   * The model, imported on first use.
   *
   * The library is large and most sessions never reach this panel, so it is a
   * dynamic import rather than a top-level one. The promise is cached because a
   * second segmentation must not re-import anything, and it is cleared on
   * failure so that being offline once does not disable the tool for good.
   */
  async loadSegmenter() {
    if (!this.#modulePromise) {
      this.#modulePromise = import("@imgly/background-removal").catch((error) => {
        this.#modulePromise = null;
        console.error(error);
        throw new Error(
          "Could not load the segmentation model. It downloads on first use, so this step needs a network connection. Try again once you are online.",
        );
      });
    }
    return this.#modulePromise;
  }

  /**
   * Decode the image and find the subject, unless that is already done.
   *
   * `report` is optional because the live preview has no progress bar to feed
   * and the committed run does.
   *
   * @param {import("../core/image.js").ImageRecord} image
   * @param {string} model
   * @param {((message: string, ratio: number | null) => void) | null} [report]
   * @returns {Promise<ShadowInjectionStore | null>} null when the image moved on
   */
  async prepare(image, model, report) {
    const key = shadowCacheKey(image, model);
    if (this.key === key && this.ready) return this;

    // One segmentation at a time. A second caller waits for the first rather
    // than running the model twice over the same image.
    if (this.pending) {
      await this.pending;
      if (this.key === key && this.mask) return this;
    }

    const work = this.#segment(image, model, report);
    this.pending = work;
    try {
      return await work;
    } finally {
      if (this.pending === work) this.pending = null;
    }
  }

  /** The one-off cost: run the model, then decode what it said. */
  async #segment(image, model, report) {
    const key = shadowCacheKey(image, model);
    const epoch = this.epoch;

    report?.("Finding the subject", 0.04);
    const { removeBackground } = await this.loadSegmenter();

    report?.("Reading the image", 0.1);
    const frame = await sourceCanvas(image.blob, image.width, image.height);
    const original = readPixels(frame.ctx, image.width, image.height);

    const maskBlob = await removeBackground(image.blob, {
      model,
      // "foreground" rather than a cut-out: the mask is a soft alpha sheet we
      // shift and blur, not a picture in its own right.
      output: { format: "image/png", type: "foreground" },
      progress: (phase, current, total) =>
        report?.(describeProgress(phase), total > 0 ? 0.1 + 0.6 * (current / total) : null),
    });

    report?.("Reading the mask", 0.75);
    const maskFrame = await sourceCanvas(maskBlob, image.width, image.height);
    const mask = readPixels(maskFrame.ctx, image.width, image.height);

    // The image or the model moved while the model was thinking.
    if (this.epoch !== epoch) return null;

    this.key = key;
    this.original = original;
    this.mask = mask;
    this.subjectShare = subjectMass(mask);
    this.bounds = subjectBounds(mask);
    this.noSubject = !hasSubject(mask);
    return this;
  }

  /**
   * A finished frame for these settings, computed at most once.
   *
   * The promise is what gets cached, not the result, so a preview and a commit
   * that land together share the work instead of racing for the same pixels.
   *
   * @param {ShadowOptions} options
   * @param {() => boolean} isStale
   * @param {((message: string, ratio: number | null) => void) | null} [report]
   * @returns {Promise<Pixels | null>}
   */
  frame(options, isStale, report) {
    const key = shadowKey(options);
    const cached = this.frames.get(key);
    if (cached) {
      // Re-insert: the bound should drop the entry nobody looked at twice.
      this.frames.delete(key);
      this.frames.set(key, cached);
      return cached;
    }

    const work = (async () => {
      report?.("Shaping the shadow", 0.72);
      return buildShadow(this.original, this.mask, options, {
        isCancelled: isStale,
      });
    })().then(
      (pixels) => {
        // A cancelled frame is not a result, and must not sit in the cache.
        if (!pixels) this.frames.delete(key);
        return pixels;
      },
      (error) => {
        this.frames.delete(key);
        throw error;
      },
    );

    this.frames.set(key, work);
    this.trim(this.frames, FRAMES_KEPT);
    return work;
  }
}

export const shadowInjection = new ShadowInjectionStore();