<script>
  /**
   * Color splash: the subject keeps its colour, the background loses it.
   *
   * A segmentation model decides which pixels are the subject, the same way
   * the blur tool does, and that mask is the expensive half by far. It is
   * cached against the image and the model, so moving the feather or picking
   * another colour family costs a composite and never a second run of the
   * model.
   *
   * The colour pass is the other half. Everything is first pulled toward its
   * own luma, which is a desaturation that cannot change how bright the pixel
   * is, and each pixel is then pulled back by how much of it should stay
   * coloured: the mask says whether it is on the subject, the chosen family
   * says whether its hue is one of the ones the splash keeps.
   *
   * Nothing here is ever committed implicitly. Apply does that.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { featherMask } from "../core/gaussian.js";
  import { debounce, readPixels, sourceCanvas } from "../core/pixels.js";
  import { context2d, createCanvas, encodeLike } from "../core/image.js";
  import {
    DEFAULT_COLOUR_ID,
    SPLASH_COLOURS,
    splashKey,
    splashPixel,
  } from "../core/colorsplash.js";

  import Button from "../components/controls/Button.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const MODELS = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ];

  /** The legacy panel's range, unchanged: 0 is a hard edge, 20 a wide ramp. */
  const FEATHER = { min: 0, max: 20, step: 1, value: 5 };

  /**
   * Rows per band in the colour pass.
   *
   * This pass is a per-pixel map with no neighbourhood, so it is the one stage
   * cheap enough not to need the yield at all: one pixel in, one pixel out is
   * a fraction of what the feather above it costs. The bands are kept anyway,
   * because a hue conversion per pixel over a large image is still long
   * enough for the tab to feel stuck without one.
   */
  const ROW_BAND = 64;
  /** Milliseconds of work before the thread goes back to the browser. */
  const SLICE_MS = 12;

  /** Feathered masks and finished frames to keep, so a slider can be flicked. */
  const COVERAGE_KEPT = 2;
  const FRAMES_KEPT = 2;

  let model = $state("medium");
  let feather = $state(FEATHER.value);
  let colourId = $state(DEFAULT_COLOUR_ID);
  /** A preview failure is this panel's own, not a committed operation's. */
  let previewError = $state(null);

  /** Cached across runs; a failed import must not poison the retry. */
  let modulePromise = null;

  async function loadSegmenter() {
    if (!modulePromise) {
      modulePromise = import("@imgly/background-removal").catch((error) => {
        modulePromise = null;
        console.error(error);
        throw new Error(
          "Could not load the segmentation model. It downloads on first use, so this step needs a network connection. Try again once you are online.",
        );
      });
    }
    return modulePromise;
  }

  const source = $derived(editor.current);
  const family = $derived(
    SPLASH_COLOURS.find((c) => c.id === colourId) ?? SPLASH_COLOURS[0],
  );

  /**
   * Identity of everything in the cache: the image on the stage and the model
   * that read it. The store re-mints a record and its URL on every commit, so
   * a URL plus a model name can never collide across images.
   */
  const cacheKey = $derived(source ? `${source.url}:${model}` : null);

  /**
   * Expensive intermediates, kept as a plain object rather than component
   * state because nothing renders from it: writing pixels is not something
   * Svelte needs to know about.
   *
   * `epoch` is bumped by every invalidation, which is how work already in
   * flight learns that it is computing for an image nobody is looking at.
   */
  const splashCache = {
    key: null,
    epoch: 0,
    original: null,
    mask: null,
    /** @type {Map<number, Promise<Uint8ClampedArray | null>>} */
    coverage: new Map(),
    /** @type {Map<string, Promise<import("../core/gaussian.js").Pixels | null>>} */
    frames: new Map(),
    /** @type {Promise<unknown> | null} */
    pending: null,
  };

  /** Drop everything. Work in flight sees the new epoch and gives up. */
  function clearCache() {
    splashCache.epoch += 1;
    splashCache.key = null;
    splashCache.original = null;
    splashCache.mask = null;
    splashCache.coverage.clear();
    splashCache.frames.clear();
    splashCache.pending = null;
  }

  /** Keep only the newest `limit` entries of an insertion-ordered Map. */
  function trim(map, limit) {
    for (const key of map.keys()) {
      if (map.size <= limit) break;
      map.delete(key);
    }
  }

  /**
   * A predicate that goes true the moment the image, the model or the tool
   * changes underneath work in flight.
   */
  function staleness() {
    const epoch = splashCache.epoch;
    return () => splashCache.epoch !== epoch;
  }

  /**
   * Hand the thread back, but only once enough time has gone by.
   *
   * Yielding on a fixed timer per band would add a few hundred milliseconds of
   * pure waiting on a large image, so bands are timed instead: work runs on
   * until a slice of real time has passed, then yields exactly once.
   */
  function makeYielder() {
    let mark = performance.now();
    return async () => {
      if (performance.now() - mark < SLICE_MS) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
      mark = performance.now();
    };
  }

  /** A feathered mask for `f`, computed at most once, promises not results. */
  function coverageFrame(f, isStale) {
    const cached = splashCache.coverage.get(f);
    if (cached) {
      // Re-insert: the bound should drop the entry nobody looked at twice.
      splashCache.coverage.delete(f);
      splashCache.coverage.set(f, cached);
      return cached;
    }

    const work = featherMask(splashCache.mask, f, { isCancelled: isStale }).then(
      (plane) => {
        // A cancelled feather is not a result, and must not sit in the cache.
        if (!plane) splashCache.coverage.delete(f);
        return plane;
      },
      (error) => {
        splashCache.coverage.delete(f);
        throw error;
      },
    );
    splashCache.coverage.set(f, work);
    trim(splashCache.coverage, COVERAGE_KEPT);
    return work;
  }

  /** A finished splash frame, computed at most once, same bargain. */
  function splashFrame(f, which, isStale, report) {
    const key = splashKey(which, f);
    const cached = splashCache.frames.get(key);
    if (cached) {
      splashCache.frames.delete(key);
      splashCache.frames.set(key, cached);
      return cached;
    }

    const work = (async () => {
      report?.("Softening the edge", 0.65);
      const coverage = await coverageFrame(f, isStale);
      // A zero feather resolves without ever reading the cancellation flag,
      // so the stale check has to be made here too, before the pixels the
      // coverage belongs to are read out of the cache.
      if (!coverage || isStale()) return null;
      const original = splashCache.original;
      if (!original) return null;
      report?.("Applying the colour", 0.7);
      return paint(original, coverage, which, isStale, report);
    })().then(
      (pixels) => {
        if (!pixels) splashCache.frames.delete(key);
        return pixels;
      },
      (error) => {
        splashCache.frames.delete(key);
        throw error;
      },
    );
    splashCache.frames.set(key, work);
    trim(splashCache.frames, FRAMES_KEPT);
    return work;
  }

  /**
   * Decode the image and find the subject, unless that is already done.
   *
   * `report` is optional because the live preview has no progress bar to feed
   * and the committed run does.
   */
  async function prepare(image, report) {
    const key = cacheKey;
    if (splashCache.key === key && splashCache.original && splashCache.mask) {
      return splashCache;
    }

    if (splashCache.pending) {
      await splashCache.pending;
      if (splashCache.key === key && splashCache.mask) return splashCache;
    }

    const work = segment(image, report);
    splashCache.pending = work;
    try {
      return await work;
    } finally {
      if (splashCache.pending === work) splashCache.pending = null;
    }
  }

  /** The one-off cost: run the model, then decode what it said. */
  async function segment(image, report) {
    const key = cacheKey;
    const epoch = splashCache.epoch;

    report?.("Finding the subject", 0.04);
    const { removeBackground } = await loadSegmenter();

    report?.("Reading the image", 0.1);
    const frame = await sourceCanvas(image.blob, image.width, image.height);
    const original = readPixels(frame.ctx, image.width, image.height);

    const maskBlob = await removeBackground(image.blob, {
      model,
      // "foreground" rather than a cut-out: the mask is a soft alpha sheet we
      // blend with, not a picture in its own right.
      output: { format: "image/png", type: "foreground" },
      progress: (phase, current, total) =>
        report?.(describeProgress(phase), total > 0 ? 0.1 + 0.6 * (current / total) : null),
    });

    report?.("Reading the mask", 0.75);
    const maskFrame = await sourceCanvas(maskBlob, image.width, image.height);
    const mask = readPixels(maskFrame.ctx, image.width, image.height);

    // The image or the model moved while the model was thinking.
    if (splashCache.epoch !== epoch) return null;

    splashCache.key = key;
    splashCache.original = original;
    splashCache.mask = mask;
    return splashCache;
  }

  /**
   * The colour pass: one pixel in, one pixel out, using the feathered mask for
   * coverage and the chosen family for chroma.
   *
   * The mask alpha is read on its own rather than striding through four
   * channels, and the HSL scratch slots are reused by every pixel, so the only
   * allocation here is the output buffer.
   */
  async function paint(original, coverage, which, isStale, report) {
    const { width, height, data } = original;
    const out = new Uint8ClampedArray(data.length);
    const hsl = [0, 0, 0];
    const rgb = [0, 0, 0];
    const yieldIfDue = makeYielder();

    for (let y0 = 0; y0 < height; y0 += ROW_BAND) {
      const end = Math.min(height, y0 + ROW_BAND);

      for (let y = y0; y < end; y += 1) {
        const row = y * width;

        for (let x = 0; x < width; x += 1) {
          const p = row + x;
          const i = p * 4;

          splashPixel(data[i], data[i + 1], data[i + 2], coverage[p] / 255, which, hsl, rgb);

          // A clamped array does the clamping and the rounding for us.
          out[i] = rgb[0] * 255;
          out[i + 1] = rgb[1] * 255;
          out[i + 2] = rgb[2] * 255;
          // Alpha is carried over untouched: the splash changes colour, not
          // which pixels are there.
          out[i + 3] = data[i + 3];
        }
      }

      if (isStale()) return null;
      report?.("Applying the colour", 0.7 + 0.2 * (end / height));
      await yieldIfDue();
    }

    return { width, height, data: out };
  }

  /** Plain pixels out to an encoded blob, in the source image's own format. */
  async function encodePixels(pixels, image) {
    const canvas = createCanvas(pixels.width, pixels.height);
    const ctx = context2d(canvas);
    // The pixel maths works on {width, height, data} so it can be tested
    // without a browser; the canvas is the one place a real ImageData exists.
    const frame = ctx.createImageData(pixels.width, pixels.height);
    frame.data.set(pixels.data);
    ctx.putImageData(frame, 0, 0);
    return encodeLike(canvas, image);
  }

  // ---------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------

  /** Guards against a slow preview landing after a newer one replaced it. */
  let previewRun = 0;

  /**
   * The URL of the image this tool last committed, or null.
   *
   * A preview computed from it is indistinguishable from the committed image,
   * so it is suppressed until a control changes. This also covers a queued
   * recompute: a debounce that fires just after Apply would otherwise rebuild
   * the image we already wrote and park a "Preview" badge on top of it.
   */
  let committedUrl = $state(null);

  const recompute = debounce(async () => {
    const image = editor.current;
    if (!image || (committedUrl && image.url === committedUrl)) {
      editor.clearPreview();
      return;
    }

    const run = ++previewRun;
    // Read the controls now, before the first await, so a frame is always a
    // consistent read of one set of values.
    const f = feather;
    const which = family;
    const isStale = staleness();
    editor.previewBusy = true;

    try {
      const prepared = await prepare(image, null);
      if (!prepared || isStale()) return;

      const pixels = await splashFrame(f, which, isStale, null);
      if (!pixels || isStale()) return;

      const blob = await encodePixels(pixels, image);
      // Bail if the operator moved on while we were working.
      if (run !== previewRun || editor.current !== image) return;

      previewError = null;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      previewError =
        error?.message || "The colour splash preview could not be built. Try a different model.";
    } finally {
      if (run === previewRun) editor.previewBusy = false;
    }
  });

  // Recompute when the controls change.
  $effect(() => {
    // The image is read only to be in scope, and deliberately untracked.
    // Depending on it would mean every commit re-runs a full-image pass to
    // reproduce the pixels this tool just wrote, leaving a redundant
    // "Preview" badge sitting on top of the committed image.
    untrack(() => editor.current);
    // Moving a control is the one thing that re-arms the preview after Apply.
    committedUrl = null;
    void feather;
    void colourId;
    void model;
    recompute();
  });

  // Segmentation is expensive, so it is kept only while it belongs to the
  // image on the stage. The cleanup is the single invalidation point: it runs
  // when the image changes, when the model changes, and when the tool is
  // switched away. There is no activate or deactivate step to forget.
  $effect(() => {
    void cacheKey;
    return () => {
      recompute.cancel();
      clearCache();
    };
  });

  // Seed on activation, and whenever a genuinely new image arrives.
  // `editor.epoch` moves only on open and discard, never on a commit, so this
  // cannot fire for output this tool produced itself.
  $effect(() => {
    const active = editor.tool === "colorsplash";
    void editor.epoch;
    if (!active) return;
    committedUrl = null;
    untrack(() => {
      if (editor.current) recompute.flush();
    });
  });

  // ---------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------

  /**
   * Apply is blocked while a preview is still moving.
   *
   * A preview render and a commit render share the same cache slots. Starting
   * a commit while a preview is mid-flight leaves one of the two awaiting a
   * promise the other abandoned, and the operation never settles. Beyond the
   * crash, "apply" during a moving preview is not a request anyone can mean.
   */
  const locked = $derived(editor.busy || editor.previewBusy || !source);

  async function apply() {
    if (locked) return;

    // Drop anything the run-up to this click queued, so no render is in flight
    // and the two cannot fight over the same cache slots.
    recompute.cancel();

    const image = source;

    await editor.run("Color splash", async (report) => {
      const f = feather;
      const which = family;
      const isStale = staleness();

      report("Preparing", 0.05);
      const prepared = await prepare(image, report);
      if (!prepared) {
        throw new Error("The image changed while the mask was being built. Try again.");
      }

      const pixels = await splashFrame(f, which, isStale, report);
      if (!pixels) {
        throw new Error("The colour splash was cut short because the image changed. Try again.");
      }

      report("Encoding", 0.92);
      const blob = await encodePixels(pixels, image);
      await editor.commit(blob, "Color splash", image.name);
      // The committed frame is the result now, so the preview is redundant
      // and a queued recompute must not rebuild the image we just wrote.
      committedUrl = editor.current?.url ?? null;
      recompute.cancel();
      editor.clearPreview();
    });
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
</script>

<div class="tool">
  <section class="tool-section">
    <SelectField
      id="colorsplash-model"
      label="Model"
      value={model}
      onvalue={(next) => (model = next)}
      options={MODELS}
      disabled={locked}
      hint="Small is quickest. Large gives the cleanest edges on hair and fur."
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Colour family</span>

    <div class="tool-chips">
      {#each SPLASH_COLOURS as preset (preset.id)}
        <button
          type="button"
          class="tool-chip chip"
          class:on={preset.id === colourId}
          aria-pressed={preset.id === colourId}
          aria-label={preset.hue === null
            ? "Keep every colour on the subject"
            : `Keep only ${preset.label}`}
          disabled={editor.busy || !source}
          onclick={() => (colourId = preset.id)}
        >
          <span class="swatch" style:background={preset.hex} aria-hidden="true"></span>
          {preset.label}
        </button>
      {/each}
    </div>

    <p class="tool-note">
      {#if family.hue === null}
        Selected: {family.label}. Every colour on the subject is kept, the background loses all
        of its own.
      {:else}
        Selected: {family.label}. Only {family.label.toLowerCase()} stays in colour, every other
        hue goes grey.
      {/if}
    </p>
  </section>

  <section class="tool-section">
    <SliderField
      id="colorsplash-feather"
      label="Edge feather"
      min={FEATHER.min}
      max={FEATHER.max}
      step={FEATHER.step}
      value={feather}
      display="{feather}px"
      disabled={editor.busy || !source}
      onvalue={(v) => (feather = v)}
    />

    <p class="tool-note">
      Softens the join where the coloured subject meets the grey background. 0 is a hard edge.
    </p>
  </section>

  {#if source}
    <div class="tool-result">
      <span>Keeps</span>
      <strong>{family.label}, {feather}px feather</strong>
    </div>
  {/if}

  <section class="tool-section">
    {#if previewError}
      <p class="tool-note">{previewError}</p>
    {:else}
      <p class="tool-note">
        The first run downloads the model and caches it in this browser. The image itself is
        never uploaded.
      </p>
    {/if}
  </section>

  <div class="tool-actions">
    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={locked}
      onclick={apply}
    >
      Apply color splash
    </Button>
  </div>
</div>

<style>
  /* `.tool-chip` is an inline-grid, which would stack the swatch above the
     name. These chips need a swatch beside their label, so the row becomes a
     flex line instead. */
  .chip {
    display: inline-flex;
    align-items: center;
  }

  /* The swatch is decoration: the family name is on the chip as text, so the
     selection never depends on telling two colours apart. */
  .swatch {
    width: 11px;
    height: 11px;
    margin-right: var(--s-2);
    border: 1px solid rgba(0, 0, 0, 0.35);
    border-radius: 3px;
  }
</style>
