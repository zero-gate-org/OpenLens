<script>
  /**
   * Sketch: a pencil and pen line drawing.
   *
   * The arithmetic is in `core/sketch.js` and it runs in a worker. That is not
   * an optimisation: a pass is a nine tap convolution over every pixel, plus a
   * dilation pass at a line weight above one, plus a stroke across every edge
   * in hatching, so on a twelve megapixel image it is long enough to be felt
   * as a stall if it happens while a slider is being dragged. The worker keeps
   * the panel responsive and the preview honest, and it is created on the
   * first pass and terminated when the tool is left, because the panel is
   * mounted fresh every time the tool is selected and an orphaned worker would
   * outlive it.
   *
   * The preview runs at half size on a large image, which is what the legacy
   * tool did and for the same reason: a full resolution pass is the only pass
   * this tool has, and one per control change is affordable, one per pixel per
   * second is not. Apply always runs at the full size of the source.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { context2d, createCanvas } from "../core/image.js";
  import { canvasToImageBlob, debounce, sourceCanvas } from "../core/pixels.js";

  import Button from "../components/controls/Button.svelte";
  import ColorField from "../components/controls/ColorField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  /**
   * Above this many pixels the preview runs at half size.
   *
   * Two megapixels is where a full pass stops feeling immediate and starts
   * feeling like a stall, and it is the same figure the legacy tool cut over
   * at.
   */
  const PREVIEW_PIXEL_CEILING = 2 * 1024 * 1024;
  const PREVIEW_SCALE = 0.5;

  const MODES = [
    { value: "sobel", label: "Sobel" },
    { value: "laplacian", label: "Laplacian" },
    { value: "pencil", label: "Pencil" },
    { value: "colored-pencil", label: "Colour" },
    { value: "hatching", label: "Hatching" },
  ];

  const DEFAULTS = {
    mode: "sobel",
    threshold: 80,
    lineWeight: 1,
    blend: 30,
    paper: "#ffffff",
    ink: "#1a1a1a",
    hatchLength: 8,
    hatchDensity: 60,
  };

  /**
   * Starting looks.
   *
   * Each one is a complete description of a drawing, carrying every setting
   * rather than the ones that happen to differ, so a preset can be compared
   * with the controls and matched exactly.
   */
  const PRESETS = [
    { name: "Graphite", ...DEFAULTS, threshold: 60 },
    { name: "Fine pen", ...DEFAULTS, mode: "laplacian", threshold: 90, blend: 0 },
    {
      name: "Charcoal",
      ...DEFAULTS,
      threshold: 40,
      lineWeight: 3,
      blend: 20,
      paper: "#f5f0e8",
      ink: "#2c2c2c",
    },
    { name: "Blueprint", ...DEFAULTS, threshold: 70, blend: 0, paper: "#003366", ink: "#a8d8ff" },
    {
      name: "Coloured pencil",
      ...DEFAULTS,
      mode: "colored-pencil",
      threshold: 50,
      blend: 40,
    },
    {
      name: "Cross hatch",
      ...DEFAULTS,
      mode: "hatching",
      threshold: 30,
      blend: 0,
      hatchLength: 10,
    },
  ];

  let mode = $state(DEFAULTS.mode);
  let threshold = $state(DEFAULTS.threshold);
  let lineWeight = $state(DEFAULTS.lineWeight);
  let blend = $state(DEFAULTS.blend);
  let paper = $state(DEFAULTS.paper);
  let ink = $state(DEFAULTS.ink);
  let hatchLength = $state(DEFAULTS.hatchLength);
  let hatchDensity = $state(DEFAULTS.hatchDensity);
  let previewError = $state(null);

  const source = $derived(editor.current);

  /** The two modes that put some of the original tone back under the ink. */
  const toned = $derived(mode === "pencil" || mode === "colored-pencil");
  const hatched = $derived(mode === "hatching");

  /**
   * Every control, as one string.
   *
   * The preview effect depends on this rather than on a list of `void` reads,
   * so a control cannot be added and then forgotten. The image is deliberately
   * not in it: see the control effect for why.
   */
  const controlKey = $derived(
    [mode, threshold, lineWeight, blend, paper, ink, hatchLength, hatchDensity].join("|"),
  );

  /**
   * The control state in the shape the renderer wants.
   *
   * `$state` widens a string to `string`, and the renderer's parameter type is
   * a narrow union, so the literals are asserted here once instead of at both
   * call sites.
   *
   * @returns {import("../core/sketch.js").SketchOptions}
   */
  function params() {
    return {
      mode: /** @type {"sobel" | "laplacian" | "pencil" | "colored-pencil" | "hatching"} */ (mode),
      threshold,
      lineWeight,
      blend,
      paper,
      ink,
      hatchLength,
      hatchDensity,
    };
  }

  // -------------------------------------------------------------------
  // Source pixels
  // -------------------------------------------------------------------

  /** Decoded preview pixels, reused across every control change. */
  let cache = { url: null, pixels: null, generation: 0 };
  let previewRun = 0;

  /**
   * Decode the source for the preview, at preview size.
   *
   * @param {import("../core/image.js").ImageRecord} image
   * @param {number} generation
   * @returns {Promise<ImageData | null>}
   */
  async function previewPixels(image, generation) {
    if (cache.url === image.url && cache.pixels) return cache.pixels;
    const large = image.width * image.height > PREVIEW_PIXEL_CEILING;
    const scale = large ? PREVIEW_SCALE : 1;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const { ctx } = await sourceCanvas(image.blob, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    if (generation !== cache.generation) return null;
    cache = { url: image.url, pixels, generation };
    return pixels;
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
   * answer to a different one, which is the failure mode a slider gets into
   * when it queues passes faster than a large image can answer them.
   *
   * @returns {Worker}
   */
  function sketchWorker() {
    if (worker) return worker;

    const created = new Worker(new URL("../workers/sketch-worker.js", import.meta.url), {
      type: "module",
    });

    created.onmessage = (event) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      entry.resolve(
        event.data.error
          ? null
          : {
              width: event.data.width,
              height: event.data.height,
              data: new Uint8ClampedArray(event.data.buffer),
            },
      );
    };

    // A worker that has thrown is not going to answer, and one that failed to
    // load never will. Either way the waiting passes are released and the next
    // one starts from a fresh worker.
    created.onerror = (event) => {
      console.error(event);
      worker = null;
      created.terminate();
      failPending(event.message || "The sketch pass could not run.");
    };

    worker = created;
    return created;
  }

  /**
   * Release every waiting pass with nothing.
   *
   * A promise nobody answers keeps its whole closure alive, so a terminated
   * worker has to settle what it was holding. `null` is the answer for "there
   * is no longer a result", and both callers already treat it as a reason to
   * stop rather than as a failure.
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
   * The source frame is copied rather than transferred, because the cache has to
   * survive for the next control change and a transfer list takes the buffer
   * with it. The result comes back transferred, so the worker hands over the
   * only copy it made instead of keeping one it will never read.
   *
   * @param {{width: number, height: number, data: Uint8ClampedArray}} pixels
   * @returns {Promise<import("../core/sketch.js").Pixels | null>}
   */
  function runSketch(pixels) {
    const id = ++nextJob;
    return new Promise((resolve, reject) => {
      // The view is copied at its own offset and length rather than by handing
      // over the whole buffer, so a frame whose array happens to be a window
      // onto a larger one is not sent with padding the worker would read as
      // pixels.
      const { byteOffset, byteLength } = pixels.data;
      const buffer = pixels.data.buffer.slice(byteOffset, byteOffset + byteLength);
      pending.set(id, { id, resolve, reject });
      sketchWorker().postMessage(
        { id, width: pixels.width, height: pixels.height, buffer, options: params() },
        [buffer],
      );
    });
  }

  // -------------------------------------------------------------------
  // Live preview
  // -------------------------------------------------------------------

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
    const generation = cache.generation;
    const isStale = () => run !== previewRun || generation !== cache.generation;

    editor.previewBusy = true;
    previewError = null;

    try {
      const pixels = await previewPixels(image, generation);
      if (!pixels || isStale()) return;

      const out = await runSketch(pixels);
      if (!out || isStale()) return;

      const blob = await canvasToImageBlob(toCanvas(out), image);
      if (isStale()) return;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      if (!isStale()) previewError = "The sketch pass could not run. Try Apply again.";
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
      cache = { url: null, pixels: null, generation: cache.generation + 1 };
      // The panel is mounted fresh on every selection, so a worker left running
      // here would outlive the component that made it.
      stopWorker();
    };
  });

  // Seed on activation, and whenever a genuinely new image arrives.
  // `editor.epoch` moves only on open and discard, never on a commit, so this
  // cannot fire for output this tool produced itself.
  $effect(() => {
    const active = editor.tool === "sketch";
    void editor.epoch;
    if (!active) return;
    committedUrl = null;
    untrack(() => {
      if (editor.current) recompute.flush();
    });
  });

  // -------------------------------------------------------------------
  // Presets
  // -------------------------------------------------------------------

  function matches(preset) {
    return (
      preset.mode === mode &&
      preset.threshold === threshold &&
      preset.lineWeight === lineWeight &&
      preset.blend === blend &&
      preset.paper === paper &&
      preset.ink === ink &&
      preset.hatchLength === hatchLength &&
      preset.hatchDensity === hatchDensity
    );
  }

  const activePreset = $derived(PRESETS.findIndex(matches));

  function usePreset(preset) {
    mode = preset.mode;
    threshold = preset.threshold;
    lineWeight = preset.lineWeight;
    blend = preset.blend;
    paper = preset.paper;
    ink = preset.ink;
    hatchLength = preset.hatchLength;
    hatchDensity = preset.hatchDensity;
  }

  function reset() {
    mode = DEFAULTS.mode;
    threshold = DEFAULTS.threshold;
    lineWeight = DEFAULTS.lineWeight;
    blend = DEFAULTS.blend;
    paper = DEFAULTS.paper;
    ink = DEFAULTS.ink;
    hatchLength = DEFAULTS.hatchLength;
    hatchDensity = DEFAULTS.hatchDensity;
  }

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  /**
   * Apply is blocked while a preview is still moving.
   *
   * A preview render and a commit render share the source buffer and the worker,
   * so starting a commit while a preview is in flight has one of the two
   * waiting on a pass the other threw away. Beyond the corruption, asking to
   * apply during a moving preview is not a request anyone can mean.
   */
  const locked = $derived(editor.busy || editor.previewBusy || !source);

  async function apply() {
    if (!source || locked) return;
    // Drop anything the run-up to this click queued, so no pass is in flight.
    recompute.cancel();

    const image = source;

    await editor.run("Sketch", async (report) => {
      report("Decoding", 0.15);
      const pixels = await fullPixels(image);

      report("Drawing", 0.45);
      const out = await runSketch(pixels);
      if (!out) throw new Error("The sketch pass was interrupted. Try again.");

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(toCanvas(out), image);
      await editor.commit(blob, "Sketch", image.name);

      // The committed frame is the result now, so the preview is redundant
      // and a queued recompute must not rebuild the image we just wrote.
      committedUrl = editor.current?.url ?? null;
      recompute.cancel();
      editor.clearPreview();
    });
  }
</script>

<div class="tool">
  <section class="tool-section">
    <Segmented
      name="sketch-mode"
      label="Algorithm"
      options={MODES}
      value={mode}
      columns={3}
      disabled={editor.busy}
      onvalue={(next) => (mode = next)}
    />

    <p class="tool-note">
      Sobel and Laplacian draw ink on paper. Pencil and Colour leave some of
      the original under it, Hatching fills tone with strokes.
    </p>
  </section>

  <section class="tool-section">
    <SliderField
      id="sketch-threshold"
      label="Edge sensitivity"
      value={threshold}
      min={0}
      max={255}
      step={1}
      display={String(threshold)}
      disabled={editor.busy}
      onvalue={(next) => (threshold = next)}
    />

    <SliderField
      id="sketch-line-weight"
      label="Line weight"
      value={lineWeight}
      min={1}
      max={5}
      step={1}
      display="{lineWeight} px"
      disabled={editor.busy}
      onvalue={(next) => (lineWeight = next)}
    />

    <p class="tool-note">
      A lower sensitivity keeps more edges. Line weight widens every edge it
      keeps.
    </p>
  </section>

  <section class="tool-section">
    <div class="tool-row">
      <ColorField
        id="sketch-paper"
        label="Paper"
        value={paper}
        disabled={editor.busy}
        onvalue={(next) => (paper = next)}
      />

      <ColorField
        id="sketch-ink"
        label="Ink"
        value={ink}
        disabled={editor.busy}
        onvalue={(next) => (ink = next)}
      />
    </div>

    <p class="tool-note">Paper is what the lines sit on, ink is the line.</p>
  </section>

  {#if toned}
    <section class="tool-section">
      <SliderField
        id="sketch-blend"
        label="Tone"
        value={blend}
        min={0}
        max={100}
        step={1}
        display="{blend} %"
        disabled={editor.busy}
        onvalue={(next) => (blend = next)}
      />

      <p class="tool-note">How much of the original tone shows under the ink.</p>
    </section>
  {/if}

  {#if hatched}
    <section class="tool-section">
      <span class="micro-label">Hatching</span>

      <SliderField
        id="sketch-hatch-length"
        label="Stroke length"
        value={hatchLength}
        min={4}
        max={20}
        step={1}
        display="{hatchLength} px"
        disabled={editor.busy}
        onvalue={(next) => (hatchLength = next)}
      />

      <SliderField
        id="sketch-hatch-density"
        label="Density"
        value={hatchDensity}
        min={0}
        max={100}
        step={1}
        display="{hatchDensity} %"
        disabled={editor.busy}
        onvalue={(next) => (hatchDensity = next)}
      />

      <p class="tool-note">
        Density 0 leaves bare paper. At 100 every edge the sensitivity kept
        carries a stroke, and where strokes cross they darken.
      </p>
    </section>
  {/if}

  <section class="tool-section">
    <span class="micro-label">Presets</span>
    <div class="tool-chips">
      {#each PRESETS as preset, index (preset.name)}
        <button
          type="button"
          class="tool-chip"
          class:on={activePreset === index}
          aria-pressed={activePreset === index}
          disabled={editor.busy}
          onclick={() => usePreset(preset)}
        >
          {preset.name}
        </button>
      {/each}
    </div>
  </section>

  {#if previewError}
    <p class="tool-note warn">{previewError}</p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">The stage previews the drawing. Apply keeps it.</p>

    <Button variant="primary" size="lg" full data-tool="apply" disabled={locked} onclick={apply}>
      Apply sketch
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
