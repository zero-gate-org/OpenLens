<script>
  /**
   * Oil paint: the Kuwahara filter, which flattens a photograph into patches.
   *
   * The arithmetic is in `core/kuwahara.js` and it runs in a worker. This is
   * the most expensive pass in the app: a commit is O(radius² · sectors) per
   * pixel per pass in the generalized mode, over every pixel of a frame that
   * can be twelve megapixels. There is no cheaper version of the same picture
   * to fall back on, because the radius is a length in pixels, so a smaller
   * radius is a different image rather than a faster one. The worker is
   * created on the first pass and terminated when the tool is left, because the
   * panel is mounted fresh every time the tool is selected and an orphaned
   * worker would outlive it.
   *
   * The legacy tool gave this filter a cancel button, and it needed one. What
   * that button was really saying is that the preview cannot be the same
   * computation as the commit, so here that is stated up front rather than
   * discovered: the preview runs at a reduced size and at one pass, and Apply
   * runs the full size of the image and every pass. A 4000 px wide source
   * previews at 400 px, which is a tenth of the width and so a hundredth of the
   * pixels; standard mode is O(1) per pixel, so that is about a hundredth of one
   * commit pass, and one pass instead of N makes it a hundredth of N. In
   * generalized mode the preview radius is scaled with the frame, so the disc
   * keeps its size relative to the picture and the per pixel cost falls with
   * the area as well, which is a ten thousandth of a pass at the same ratio.
   *
   * The preview radius is scaled rather than kept, and that is the one place
   * this tool could have lied. A radius of 4 on a frame a tenth the size is a
   * stroke a tenth the width, so keeping the number would have shown a
   * noticeably finer texture than Apply produces. Scaling it costs nothing,
   * because the whole point of the downscale is that the preview is
   * smaller.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { context2d, createCanvas } from "../core/image.js";
  import { canvasToImageBlob, debounce, sourceCanvas } from "../core/pixels.js";
  import {
    MAX_PASSES,
    MAX_RADIUS,
    MAX_SECTORS,
    MIN_PASSES,
    MIN_RADIUS,
    MIN_SECTORS,
    KUWAHARA_MODES,
    OIL_PAINT_DEFAULTS,
    OIL_PAINT_PRESETS,
  } from "../core/kuwahara.js";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  /**
   * The widest the preview frame is, in pixels.
   *
   * The legacy figure. A frame this size is around a hundredth of the pixels of
   * a large photograph, which is what makes a pass on it answer a slider, and
   * it is still wide enough that the patches can be read as patches.
   */
  const PREVIEW_MAX_WIDTH = 400;

  /**
   * The most passes the preview will run.
   *
   * Every pass after the first runs the filter over its own output, so the
   * second pass costs as much as the first and looks like a different filter
   * rather than more of the same one. One pass is the honest version to show
   * while a control is being moved.
   */
  const PREVIEW_PASSES = 1;

  const DEFAULTS = OIL_PAINT_DEFAULTS;

  let mode = $state(DEFAULTS.mode);
  let radius = $state(DEFAULTS.radius);
  let passes = $state(DEFAULTS.passes);
  let sectors = $state(DEFAULTS.sectors);
  let saturation = $state(DEFAULTS.saturation);
  let sharpen = $state(DEFAULTS.sharpen);
  let livePreview = $state(true);
  let previewError = $state(null);

  const source = $derived(editor.current);
  const generalized = $derived(mode === "generalized");

  /**
   * Every control, as one string.
   *
   * The preview effect depends on this rather than on a list of `void` reads,
   * so a control cannot be added and then forgotten. The image is deliberately
   * not in it: see the control effect for why.
   */
  const controlKey = $derived(
    [mode, radius, passes, sectors, saturation, sharpen, livePreview].join("|"),
  );

  /**
   * The control state, exactly as the worker wants it.
   *
   * Read once at the top of a pass so a frame is a consistent read of one set of
   * values rather than of whatever the controls held by the time the last await
   * returned. The panel holds strings, and the arithmetic wants a narrow union.
   *
   * @returns {import("../core/kuwahara.js").KuwaharaOptions}
   */
  function params() {
    return {
      mode: /** @type {"standard" | "generalized"} */ (mode),
      radius,
      passes,
      sectors,
      saturation,
      sharpen,
    };
  }

  /** The same settings, made cheap enough to answer a slider. */
  function previewParams(scale) {
    return {
      ...params(),
      radius: Math.max(MIN_RADIUS, Math.min(radius, Math.round(radius * scale))),
      passes: Math.min(passes, PREVIEW_PASSES),
    };
  }

  // -------------------------------------------------------------------
  // Presets
  // -------------------------------------------------------------------

  /**
   * A preset is loaded exactly while it is the whole of the current state.
   *
   * Derived rather than stored, which is what keeps the two from disagreeing:
   * moving a control deselects the preset with no bookkeeping to forget, and
   * loading one selects it with no flag to set.
   */
  const activePreset = $derived(
    OIL_PAINT_PRESETS.find(
      (preset) =>
        preset.mode === mode &&
        preset.radius === radius &&
        preset.passes === passes &&
        preset.sectors === sectors &&
        preset.saturation === saturation &&
        preset.sharpen === sharpen,
    )?.name ?? null,
  );

  function usePreset(preset) {
    mode = preset.mode;
    radius = preset.radius;
    passes = preset.passes;
    sectors = preset.sectors;
    saturation = preset.saturation;
    sharpen = preset.sharpen;
  }

  function reset() {
    mode = DEFAULTS.mode;
    radius = DEFAULTS.radius;
    passes = DEFAULTS.passes;
    sectors = DEFAULTS.sectors;
    saturation = DEFAULTS.saturation;
    sharpen = DEFAULTS.sharpen;
    livePreview = true;
  }

  // -------------------------------------------------------------------
  // Source pixels
  // -------------------------------------------------------------------

  /** Decoded preview pixels, reused across every control change. */
  let cache = { url: null, pixels: null, scale: 1, generation: 0 };

  /**
   * Decode the source for the preview, at preview size.
   *
   * @param {import("../core/image.js").ImageRecord} image
   * @param {number} generation
   * @returns {Promise<{pixels: import("../core/kuwahara.js").Pixels, scale: number} | null>}
   */
  async function previewPixels(image, generation) {
    if (cache.url === image.url && cache.pixels) {
      return { pixels: cache.pixels, scale: cache.scale };
    }

    const scale = Math.min(1, PREVIEW_MAX_WIDTH / Math.max(1, image.width));
    // The window is kept to the preview: a radius wider than the frame would
    // sample the same pixel many times over and the result would be a single
    // flat colour rather than a preview of anything.
    const width = Math.max(radius * 2 + 1, Math.round(image.width * scale));
    const height = Math.max(radius * 2 + 1, Math.round(image.height * scale));
    const { ctx } = await sourceCanvas(image.blob, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    if (generation !== cache.generation) return null;
    cache = { url: image.url, pixels, scale, generation };
    return { pixels, scale };
  }

  /** Decode the source at its own size, for a commit. */
  async function fullPixels(image) {
    const { ctx } = await sourceCanvas(image.blob, image.width, image.height);
    return ctx.getImageData(0, 0, image.width, image.height);
  }

  function toCanvas(pixels) {
    const canvas = createCanvas(pixels.width, pixels.height);
    const ctx = context2d(canvas);
    const image = ctx.createImageData(pixels.width, pixels.height);
    image.data.set(pixels.data);
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  // -------------------------------------------------------------------
  // The worker
  // -------------------------------------------------------------------

  /** @type {Worker | null} */
  let worker = null;
  /** Passes that have been sent and not yet answered, by id. */
  const pending = new Map();
  let nextJob = 0;

  /**
   * The worker, built on the first pass that needs it.
   *
   * Lazy because a tool the operator opened and closed without touching a
   * control should not have started one at all. Every reply carries the id of
   * the request that asked for it, so a pass can never be read back as the
   * answer to a different one, which is the failure mode a slider drag gets
   * into when it queues passes faster than a large image can answer them.
   *
   * @returns {Worker}
   */
  function oilPaintWorker() {
    if (worker) return worker;

    const created = new Worker(new URL("../workers/oil-paint-worker.js", import.meta.url), {
      type: "module",
    });

    created.onmessage = (event) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;

      // A progress report for a pass that is no longer the one being waited on
      // would move a bar that now belongs to a different pass.
      if (typeof event.data.progress === "number") {
        entry.onProgress?.(event.data.progress);
        return;
      }

      pending.delete(event.data.id);
      if (event.data.error) {
        entry.reject(new Error(event.data.error));
        return;
      }
      entry.resolve({
        width: event.data.width,
        height: event.data.height,
        data: new Uint8ClampedArray(event.data.buffer),
      });
    };

    // A worker that has thrown is not going to answer, and one that failed to
    // load never will. Either way the waiting passes are released and the next
    // one starts from a fresh worker.
    created.onerror = (event) => {
      console.error(event);
      worker = null;
      created.terminate();
      failPending(event.message || "The oil paint pass could not run.");
    };

    worker = created;
    return created;
  }

  /**
   * Release every waiting pass.
   *
   * A promise nobody answers keeps its whole closure alive, so a terminated
   * worker has to settle what it was holding. A message makes them reject, which
   * is what a worker error is. No message makes them resolve with nothing, which
   * is what leaving the tool is: both callers already treat a missing result as
   * a reason to stop rather than as a failure.
   *
   * @param {string | null} [message] set to reject instead, on a worker error
   */
  function failPending(message = null) {
    for (const entry of [...pending.values()]) {
      pending.delete(entry.id);
      if (message) entry.reject(new Error(message));
      else entry.resolve(null);
    }
  }

  function stopWorker() {
    if (worker) worker.terminate();
    worker = null;
    failPending();
  }

  /**
   * One pass, on the worker thread.
   *
   * The source frame is copied rather than transferred, because the cache has
   * to survive for the next control change and a transfer list takes the buffer
   * with it. The result comes back transferred, so the worker hands over the only
   * copy it made instead of keeping one it will never read.
   *
   * @param {import("../core/kuwahara.js").Pixels} pixels
   * @param {import("../core/kuwahara.js").KuwaharaOptions} options
   * @param {(ratio: number) => void} [onProgress]
   * @returns {Promise<import("../core/kuwahara.js").Pixels | null>}
   */
  function runOilPaint(pixels, options, onProgress) {
    const id = ++nextJob;
    return new Promise((resolve, reject) => {
      // The view is copied at its own offset and length rather than by handing
      // over the whole buffer, so a frame whose array happens to be a window
      // onto a larger one is not sent with padding the worker would read as
      // pixels.
      const { byteOffset, byteLength } = pixels.data;
      const buffer = pixels.data.buffer.slice(byteOffset, byteOffset + byteLength);
      pending.set(id, { id, resolve, reject, onProgress });
      oilPaintWorker().postMessage({ id, width: pixels.width, height: pixels.height, buffer, options }, [
        buffer,
      ]);
    });
  }

  // -------------------------------------------------------------------
  // Live preview
  // -------------------------------------------------------------------

  /** Guards against a slow preview landing after a newer one replaced it. */
  let previewRun = 0;

  /**
   * The URL of the image this tool last committed, or null.
   *
   * A preview computed from it is indistinguishable from the committed image, so
   * it is suppressed until a control changes. This also covers a queued
   * recompute: a debounce that fires just after Apply would otherwise rebuild
   * the image we already wrote and park a "Preview" badge on top of it.
   */
  let committedUrl = $state(null);

  /**
   * Apply is blocked while a preview is still moving.
   *
   * A preview pass and a commit pass share the worker, and a commit pass at the
   * size of the image can run for a while, so starting one while a preview is in
   * flight means the operator is told their brush is applied when what landed
   * was the frame from before they moved it.
   */
  const locked = $derived(editor.busy || editor.previewBusy || !source);

  const recompute = debounce(async () => {
    const image = editor.current;
    if (!image || (committedUrl && image.url === committedUrl)) {
      editor.clearPreview();
      return;
    }

    const run = ++previewRun;
    const generation = cache.generation;
    const isStale = () => run !== previewRun || generation !== cache.generation;

    editor.previewBusy = true;
    previewError = null;

    try {
      const source = await previewPixels(image, generation);
      if (!source || isStale()) return;

      const out = await runOilPaint(source.pixels, previewParams(source.scale));
      if (!out || isStale()) return;

      const blob = await canvasToImageBlob(toCanvas(out), image);
      if (isStale()) return;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      if (!isStale()) previewError = "The oil paint preview could not be built. Try Apply again.";
    } finally {
      // Only the newest run owns the flag: a superseded one that cleared it
      // would re-enable Apply while its replacement is still writing.
      if (run === previewRun) editor.previewBusy = false;
    }
  });

  // Control changes recompute.
  $effect(() => {
    // The image is read only to be in scope, and deliberately untracked.
    // Depending on it would mean every commit re-runs a full pass to reproduce
    // the pixels this tool just wrote, leaving a redundant "Preview" badge
    // sitting on top of the committed image.
    untrack(() => editor.current);
    // Moving a control is the one thing that re-arms the preview after Apply.
    committedUrl = null;
    void controlKey;
    if (!livePreview) {
      // Live preview off means the stage shows what is committed, so a preview
      // left over from before the switch cannot be mistaken for the result of
      // the settings now in the panel.
      recompute.cancel();
      editor.clearPreview();
      return;
    }
    recompute();
  });

  // A different image, or a different tool, means every cached buffer describes
  // something that is no longer on the stage, and any pass in flight is a pass
  // over the wrong frame. Cancelling the pending render matters as much as
  // dropping the cache: a preview that fires after this tool has been left
  // would land on the stage under somebody else's controls.
  $effect(() => {
    const key = `${editor.current?.url ?? ""}|${editor.tool}`;
    void key;
    return () => {
      recompute.cancel();
      cache = { url: null, pixels: null, scale: 1, generation: cache.generation + 1 };
      // The panel is mounted fresh on every selection, so a worker left running
      // here would outlive the component that made it.
      stopWorker();
    };
  });

  // Seed on activation, and whenever a genuinely new image arrives.
  // `editor.epoch` moves only on open and discard, never on a commit, so this
  // cannot fire for output this tool produced itself.
  $effect(() => {
    const active = editor.tool === "oilpaint";
    void editor.epoch;
    if (!active) return;
    committedUrl = null;
    untrack(() => {
      if (editor.current && livePreview) recompute.flush();
    });
  });

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  async function apply() {
    // Drop anything the run-up to this click queued, so no pass is in flight.
    recompute.cancel();

    if (!source || locked) return;

    const image = source;
    const options = params();

    await editor.run("Oil paint", async (report) => {
      report("Decoding", 0.1);
      const pixels = await fullPixels(image);

      report("Painting", 0.3);
      const out = await runOilPaint(pixels, options, (ratio) => report("Painting", 0.3 + ratio * 0.55));
      if (!out) throw new Error("The oil paint pass was interrupted. Try again.");

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(toCanvas(out), image);
      await editor.commit(blob, "Oil paint", image.name);

      // The committed frame is the result now, so the preview is redundant and a
      // queued recompute must not rebuild the image we just wrote.
      committedUrl = editor.current?.url ?? null;
      recompute.cancel();
      editor.clearPreview();
    });
  }
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Presets</span>

    <div class="tool-chips">
      {#each OIL_PAINT_PRESETS as preset (preset.name)}
        <button
          type="button"
          class="tool-chip"
          class:on={activePreset === preset.name}
          aria-pressed={activePreset === preset.name}
          disabled={editor.busy}
          onclick={() => usePreset(preset)}
        >
          {preset.name}
        </button>
      {/each}
    </div>

    <p class="tool-note">Each preset is a complete set of brush settings.</p>
  </section>

  <section class="tool-section">
    <Segmented
      name="oilpaint-mode"
      label="Algorithm"
      columns={2}
      options={KUWAHARA_MODES}
      value={mode}
      disabled={editor.busy}
      onvalue={(next) => (mode = next)}
    />

    <p class="tool-note">
      Standard takes the flattest of four quadrants. Generalized splits a disc
      into {sectors} sectors, which smooths more and costs that many times as
      much per pixel.
    </p>
  </section>

  <section class="tool-section">
    <span class="micro-label">Brush</span>

    <SliderField
      id="oilpaint-radius"
      label="Brush radius"
      value={radius}
      min={MIN_RADIUS}
      max={MAX_RADIUS}
      step={1}
      display="{radius} px"
      disabled={editor.busy}
      onvalue={(next) => (radius = next)}
    />

    <SliderField
      id="oilpaint-passes"
      label="Passes"
      value={passes}
      min={MIN_PASSES}
      max={MAX_PASSES}
      step={1}
      display={String(passes)}
      disabled={editor.busy}
      onvalue={(next) => (passes = next)}
    />

    {#if generalized}
      <SliderField
        id="oilpaint-sectors"
        label="Sectors"
        value={sectors}
        min={MIN_SECTORS}
        max={MAX_SECTORS}
        step={1}
        display={String(sectors)}
        disabled={editor.busy}
        onvalue={(next) => (sectors = next)}
      />
    {/if}

    <div class="tool-result">
      <span>Window</span>
      <strong>{2 * radius + 1} px across</strong>
    </div>

    <p class="tool-note">
      Each pass runs the filter over its own output, so three or more passes lose
      detail quickly and cost a whole frame apiece.
    </p>
  </section>

  <section class="tool-section">
    <span class="micro-label">Finish</span>

    <SliderField
      id="oilpaint-saturation"
      label="Saturation"
      value={saturation}
      min={0}
      max={100}
      step={1}
      display="{saturation} %"
      disabled={editor.busy}
      onvalue={(next) => (saturation = next)}
    />

    <SliderField
      id="oilpaint-sharpen"
      label="Edge sharpening"
      value={sharpen}
      min={0}
      max={100}
      step={1}
      display="{sharpen} %"
      disabled={editor.busy}
      onvalue={(next) => (sharpen = next)}
    />

    <p class="tool-note">
      Saturation pushes the colour of a patch away from grey. Sharpening puts
      back the edges between patches.
    </p>
  </section>

  <section class="tool-section">
    <CheckField
      id="oilpaint-live"
      label="Live preview"
      bind:checked={livePreview}
      disabled={editor.busy}
      hint="With this off the panel sets the brush without repainting, and only Apply runs the pass."
    />
  </section>

  {#if previewError}
    <p class="tool-note warn">{previewError}</p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">
      The stage previews one pass at a reduced size. Apply runs every pass at the
      size of the image.
    </p>

    <Button variant="primary" size="lg" full data-tool="apply" disabled={locked} onclick={apply}>
      Apply oil paint
    </Button>

    <Button variant="quiet" size="sm" full disabled={editor.busy} onclick={reset}>
      Reset
    </Button>
  </div>
</div>

<style>
  .warn {
    color: var(--warning);
  }
</style>
