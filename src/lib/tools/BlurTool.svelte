<script>
  /**
   * Depth-aware blur.
   *
   * A segmentation model decides which pixels are the subject and which are
   * background. The background is blurred, the subject is not, and the feather
   * control softens the join so the result is not a visible cut-out line.
   *
   * Segmentation is the expensive half by far, so the decoded pixels and the
   * mask survive slider moves: moving a slider re-blurs and re-composites, it
   * never re-segments. The blurred frames are cached per radius on top of that,
   * so dragging the radius back and forth costs a composite, not a full
   * convolution. Nothing here is ever committed implicitly; Apply does that.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { debounce, readPixels, sourceCanvas } from "../core/pixels.js";
  import { compositeWithMask, featherMask, gaussianBlur } from "../core/gaussian.js";
  import { context2d, createCanvas, encodeLike } from "../core/image.js";

  import Button from "../components/controls/Button.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const MODELS = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ];

  const RADIUS = { min: 2, max: 50, step: 1, value: 15 };
  const FEATHER = { min: 0, max: 20, step: 1, value: 5 };

  /**
   * How many blurred frames and feathered masks to keep. Enough to drag a
   * slider back and forth without recomputing, few enough that a session of
   * fiddling cannot grow without limit.
   */
  const BLUR_KEPT = 3;
  const COVERAGE_KEPT = 2;

  let model = $state("medium");
  let radius = $state(RADIUS.value);
  let feather = $state(FEATHER.value);
  /** A preview failure is the panel's own, not a committed operation's. */
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
  const blurCache = {
    key: null,
    epoch: 0,
    original: null,
    mask: null,
    /** @type {Map<number, Promise<import("../core/gaussian.js").Pixels | null>>} */
    blurred: new Map(),
    /** @type {Map<number, Promise<Uint8ClampedArray | null>>} */
    coverage: new Map(),
    /** @type {Promise<unknown> | null} */
    pending: null,
  };

  /** Drop everything. Work in flight sees the new epoch and gives up. */
  function clearCache() {
    blurCache.epoch += 1;
    blurCache.key = null;
    blurCache.original = null;
    blurCache.mask = null;
    blurCache.blurred.clear();
    blurCache.coverage.clear();
    blurCache.pending = null;
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
    const epoch = blurCache.epoch;
    return () => blurCache.epoch !== epoch;
  }

  /**
   * A blurred frame for `r`, computed at most once.
   *
   * The promise is what gets cached, not the result, so two previews that land
   * together share the work instead of racing for the same pixels.
   */
  function blurredFrame(r, isStale) {
    const cached = blurCache.blurred.get(r);
    if (cached) {
      // Re-insert: the bound should drop the entry nobody looked at twice.
      blurCache.blurred.delete(r);
      blurCache.blurred.set(r, cached);
      return cached;
    }

    const work = gaussianBlur(blurCache.original, r, { isCancelled: isStale }).then(
      (pixels) => {
        // A cancelled blur is not a result, and must not sit in the cache.
        if (!pixels) blurCache.blurred.delete(r);
        return pixels;
      },
      (error) => {
        blurCache.blurred.delete(r);
        throw error;
      },
    );
    blurCache.blurred.set(r, work);
    trim(blurCache.blurred, BLUR_KEPT);
    return work;
  }

  /** Feathered coverage for `f`, computed at most once, same bargain. */
  function coverageFrame(f, isStale) {
    const cached = blurCache.coverage.get(f);
    if (cached) {
      blurCache.coverage.delete(f);
      blurCache.coverage.set(f, cached);
      return cached;
    }

    const work = featherMask(blurCache.mask, f, { isCancelled: isStale }).then(
      (plane) => {
        if (!plane) blurCache.coverage.delete(f);
        return plane;
      },
      (error) => {
        blurCache.coverage.delete(f);
        throw error;
      },
    );
    blurCache.coverage.set(f, work);
    trim(blurCache.coverage, COVERAGE_KEPT);
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
    if (blurCache.key === key && blurCache.original && blurCache.mask) return blurCache;

    if (blurCache.pending) {
      await blurCache.pending;
      if (blurCache.key === key && blurCache.mask) return blurCache;
    }

    const work = segment(image, report);
    blurCache.pending = work;
    try {
      return await work;
    } finally {
      if (blurCache.pending === work) blurCache.pending = null;
    }
  }

  /** The one-off cost: run the model, then decode what it said. */
  async function segment(image, report) {
    const key = cacheKey;
    const epoch = blurCache.epoch;

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
        report?.(describeProgress(phase), total > 0 ? 0.1 + 0.75 * (current / total) : null),
    });

    report?.("Reading the mask", 0.88);
    const maskFrame = await sourceCanvas(maskBlob, image.width, image.height);
    const mask = readPixels(maskFrame.ctx, image.width, image.height);

    // The image or the model moved while the model was thinking.
    if (blurCache.epoch !== epoch) return null;

    blurCache.key = key;
    blurCache.original = original;
    blurCache.mask = mask;
    return blurCache;
  }

  /**
   * Cached mask plus the two slider values to a finished frame.
   * Returns null if the image moved on while the pixels were being built.
   */
  async function compose({ r, f, isStale, report }) {
    report?.(0.45, "Blurring the background");
    const blurred = await blurredFrame(r, isStale);
    if (!blurred) return null;

    report?.(0.7, "Softening the edge");
    const coverage = await coverageFrame(f, isStale);
    if (!coverage) return null;

    report?.(0.85, "Compositing");
    return compositeWithMask(blurCache.original, blurred, coverage);
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
    // Read the sliders now, before the first await, so a frame is always a
    // consistent read of one set of values.
    const r = radius;
    const f = feather;
    const isStale = staleness();
    editor.previewBusy = true;

    try {
      const prepared = await prepare(image, null);
      if (!prepared || isStale()) return;

      const frame = await compose({ r, f, isStale, report: null });
      if (!frame || isStale()) return;

      const blob = await encodePixels(frame, image);
      // Bail if the operator moved on while we were working.
      if (run !== previewRun || editor.current !== image) return;

      previewError = null;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      previewError =
        error?.message || "The blur preview could not be built. Try a different model.";
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
    void radius;
    void feather;
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
    const active = editor.tool === "blur";
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

  async function apply() {
    if (!source || editor.busy || editor.previewBusy) return;

    // Drop anything the run-up to this click queued, so no render is in flight
    // and the two cannot fight over the same cache slots.
    recompute.cancel();

    await editor.run("Blur", async (report) => {
      const r = radius;
      const f = feather;
      const isStale = staleness();

      report("Preparing", 0.05);
      const prepared = await prepare(source, report);
      if (!prepared) {
        throw new Error("The image changed while the mask was being built. Try again.");
      }

      const frame = await compose({
        r,
        f,
        isStale,
        report: (ratio, message) => report(message, 0.45 + ratio * 0.4),
      });
      if (!frame) {
        throw new Error("The blur was cut short because the image changed. Try again.");
      }

      report("Encoding", 0.92);
      const blob = await encodePixels(frame, source);
      await editor.commit(blob, "Blur", source.name);
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
    return "Finding the subject";
  }
</script>

<div class="tool">
  <section class="tool-section">
    <SelectField
      id="blur-model"
      label="Model"
      value={model}
      onvalue={(next) => (model = next)}
      options={MODELS}
      disabled={editor.busy || editor.previewBusy || !source}
      hint="Small is quickest. Large gives the cleanest edges on hair and fur."
    />
  </section>

  <section class="tool-section">
    <SliderField
      id="blur-radius"
      label="Blur radius"
      min={RADIUS.min}
      max={RADIUS.max}
      step={RADIUS.step}
      value={radius}
      display="{radius}px"
      disabled={editor.busy || !source}
      onvalue={(v) => (radius = v)}
    />

    <SliderField
      id="blur-feather"
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
      The subject stays sharp. The feather widens the soft join around it.
    </p>
  </section>

  {#if source}
    <div class="tool-result">
      <span>Background</span>
      <strong>{radius}px blur, {feather}px feather</strong>
    </div>
  {/if}

  <section class="tool-section">
    {#if previewError}
      <p class="tool-note">{previewError}</p>
    {:else}
      <p class="tool-note">
        The first run downloads the model and caches it in this browser. The image
        itself is never uploaded.
      </p>
    {/if}
  </section>

  <div class="tool-actions">
    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={editor.busy || !source}
      onclick={apply}
    >
      Apply blur
    </Button>
  </div>
</div>
