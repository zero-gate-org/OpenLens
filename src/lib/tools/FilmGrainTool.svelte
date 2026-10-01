<script>
  /**
   * Film Grain: seeded noise, weighted by tone.
   *
   * The arithmetic is in `core/grain.js` and it runs in a worker. That is not an
   * optimisation: a noise pass is a per-pixel read, a hash and a blend over
   * every pixel in the frame, so on a twelve megapixel image it is long enough
   * to be felt as a stall if it happens while a slider is being dragged. The
   * worker keeps the panel responsive and the preview honest, and it is created
   * on the first pass and terminated when the tool is left, because the panel is
   * mounted fresh every time the tool is selected and an orphaned worker would
   * outlive it.
   *
   * The noise is a pure function of the seed and the cell coordinates, never of
   * a clock or of `Math.random`, so the same settings always give the same
   * grain. That is what lets the preview update on every drag: the picture
   * cannot flicker between two versions of itself. Randomising the seed is the
   * only way to get a different pattern, which is why the field and its button
   * are always visible rather than behind a checkbox.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { context2d, createCanvas } from "../core/image.js";
  import { canvasToImageBlob, debounce, sourceCanvas } from "../core/pixels.js";

  import Button from "../components/controls/Button.svelte";
  import NumberField from "../components/controls/NumberField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const NOISE_TYPES = [
    { value: "uniform", label: "Mono" },
    { value: "luminance", label: "Luma" },
    { value: "color", label: "Colour" },
  ];

  const SHAPES = [
    { value: "square", label: "Square" },
    { value: "random", label: "Random" },
  ];

  const PLACEMENTS = [
    { value: "everywhere", label: "Everywhere" },
    { value: "highlights", label: "Highlights" },
    { value: "shadows", label: "Shadows" },
  ];

  const BLEND_MODES = [
    { value: "soft-light", label: "Soft light" },
    { value: "overlay", label: "Overlay" },
    { value: "add", label: "Linear" },
  ];

  /**
   * Starting looks.
   *
   * Each one carries its own seed, so a preset is a complete description of a
   * grain pattern rather than the current pattern with some sliders moved.
   */
  const PRESETS = [
    { name: "Subtle Digital", noiseType: "uniform", strength: 15, grainSize: 1, shape: "square", placement: "everywhere", blendMode: "soft-light", blend: 100, seed: 42 },
    { name: "35mm Film", noiseType: "luminance", strength: 35, grainSize: 2, shape: "square", placement: "everywhere", blendMode: "soft-light", blend: 100, seed: 42 },
    { name: "Pushed ISO 3200", noiseType: "luminance", strength: 70, grainSize: 3, shape: "random", placement: "everywhere", blendMode: "add", blend: 100, seed: 42 },
    { name: "Kodachrome", noiseType: "color", strength: 25, grainSize: 2, shape: "square", placement: "everywhere", blendMode: "soft-light", blend: 100, seed: 42 },
    { name: "Old Photo", noiseType: "uniform", strength: 55, grainSize: 4, shape: "random", placement: "everywhere", blendMode: "soft-light", blend: 100, seed: 42 },
  ];

  const DEFAULTS = {
    noiseType: "uniform",
    strength: 25,
    grainSize: 1,
    shape: "square",
    placement: "everywhere",
    blendMode: "soft-light",
    blend: 100,
    seed: 42,
  };

  let noiseType = $state(DEFAULTS.noiseType);
  let strength = $state(DEFAULTS.strength);
  let grainSize = $state(DEFAULTS.grainSize);
  let shape = $state(DEFAULTS.shape);
  let placement = $state(DEFAULTS.placement);
  let blendMode = $state(DEFAULTS.blendMode);
  let blend = $state(DEFAULTS.blend);
  let seed = $state(DEFAULTS.seed);
  let previewError = $state(null);

  const source = $derived(editor.current);

  /**
   * Every control, as one string.
   *
   * The preview effect depends on this rather than on a list of `void` reads,
   * so a control cannot be added and then forgotten. The image is deliberately
   * not in it: see the control effect for why.
   */
  const controlKey = $derived(
    [noiseType, strength, grainSize, shape, placement, blendMode, blend, seed].join("|"),
  );

  /**
   * The control state in the shape the renderer wants.
   *
   * `$state` widens a string to `string`, and the renderer's parameter type is
   * a narrow union, so the literals are asserted here once instead of at both
   * call sites.
   *
   * @returns {import("../core/grain.js").GrainOptions}
   */
  function params() {
    return {
      noiseType: /** @type {"uniform" | "luminance" | "color"} */ (noiseType),
      strength,
      grainSize,
      shape: /** @type {"square" | "random"} */ (shape),
      placement: /** @type {"everywhere" | "highlights" | "shadows"} */ (placement),
      blendMode: /** @type {"add" | "overlay" | "soft-light"} */ (blendMode),
      blend,
      seed,
    };
  }

  // -------------------------------------------------------------------
  // Source pixels
  // -------------------------------------------------------------------

  /** Decoded source pixels, reused across every control change. */
  let cache = { url: null, pixels: null, generation: 0 };
  let previewRun = 0;

  async function sourcePixels(image, generation) {
    if (cache.url === image.url && cache.pixels) return cache.pixels;
    const { ctx } = await sourceCanvas(image.blob, image.width, image.height);
    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    if (generation !== cache.generation) return null;
    cache = { url: image.url, pixels, generation };
    return pixels;
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
  function grainWorker() {
    if (worker) return worker;

    const created = new Worker(new URL("../workers/film-grain-worker.js", import.meta.url), {
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
      failPending(event.message || "The grain pass could not run.");
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
   * @returns {Promise<import("../core/grain.js").Pixels | null>}
   */
  function runGrain(pixels) {
    const id = ++nextJob;
    return new Promise((resolve, reject) => {
      // The view is copied at its own offset and length rather than by handing
      // over the whole buffer, so a frame whose array happens to be a window
      // onto a larger one is not sent with padding the worker would read as
      // pixels.
      const { byteOffset, byteLength } = pixels.data;
      const buffer = pixels.data.buffer.slice(byteOffset, byteOffset + byteLength);
      pending.set(id, { id, resolve, reject });
      grainWorker().postMessage(
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
      const pixels = await sourcePixels(image, generation);
      if (!pixels || isStale()) return;

      const out = await runGrain(pixels);
      if (!out || isStale()) return;

      const blob = await canvasToImageBlob(toCanvas(out), image);
      if (isStale()) return;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      if (!isStale()) previewError = "The grain pass could not run. Try Apply again.";
    } finally {
      // Only the newest run owns the flag: a superseded one that cleared it
      // would re-enable Apply while its replacement is still writing.
      if (run === previewRun) editor.previewBusy = false;
    }
  });

  // Control changes recompute.
  $effect(() => {
    // The image is read only to be in scope, and deliberately untracked.
    // Depending on it would mean every commit re-runs a full-image pass to
    // reproduce the pixels this tool just wrote, leaving a redundant "Preview"
    // badge sitting on top of the committed image.
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
    const active = editor.tool === "filmgrain";
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
      preset.noiseType === noiseType &&
      preset.strength === strength &&
      preset.grainSize === grainSize &&
      preset.shape === shape &&
      preset.placement === placement &&
      preset.blendMode === blendMode &&
      preset.blend === blend &&
      preset.seed === seed
    );
  }

  const activePreset = $derived(PRESETS.findIndex(matches));

  function usePreset(preset) {
    noiseType = preset.noiseType;
    strength = preset.strength;
    grainSize = preset.grainSize;
    shape = preset.shape;
    placement = preset.placement;
    blendMode = preset.blendMode;
    blend = preset.blend;
    seed = preset.seed;
  }

  function randomiseSeed() {
    seed = Math.floor(Math.random() * 2147483647);
  }

  function reset() {
    noiseType = DEFAULTS.noiseType;
    strength = DEFAULTS.strength;
    grainSize = DEFAULTS.grainSize;
    shape = DEFAULTS.shape;
    placement = DEFAULTS.placement;
    blendMode = DEFAULTS.blendMode;
    blend = DEFAULTS.blend;
    seed = DEFAULTS.seed;
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

    await editor.run("Film Grain", async (report) => {
      report("Decoding", 0.15);
      const generation = cache.generation;
      const pixels = await sourcePixels(image, generation);
      if (!pixels) throw new Error("The image could not be prepared.");

      report("Adding grain", 0.45);
      const out = await runGrain(pixels);
      if (!out) throw new Error("The grain pass was interrupted. Try again.");

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(toCanvas(out), image);
      await editor.commit(blob, "Film Grain", image.name);

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
      name="filmgrain-noise"
      label="Grain"
      options={NOISE_TYPES}
      value={noiseType}
      disabled={editor.busy}
      onvalue={(next) => (noiseType = next)}
    />

    <p class="tool-note">
      Mono moves all three channels together, Luma moves brightness, Colour
      offsets each channel on its own.
    </p>
  </section>

  <section class="tool-section">
    <SliderField
      id="filmgrain-strength"
      label="Strength"
      value={strength}
      min={0}
      max={100}
      step={1}
      display="{strength} %"
      disabled={editor.busy}
      onvalue={(next) => (strength = next)}
    />

    <SliderField
      id="filmgrain-size"
      label="Grain size"
      value={grainSize}
      min={1}
      max={8}
      step={1}
      display="{grainSize} px"
      disabled={editor.busy}
      onvalue={(next) => (grainSize = next)}
    />

    <p class="tool-note">Size 1 is fine digital grain, 8 is coarse.</p>
  </section>

  <section class="tool-section">
    <Segmented
      name="filmgrain-shape"
      label="Shape"
      options={SHAPES}
      value={shape}
      disabled={editor.busy}
      onvalue={(next) => (shape = next)}
    />

    <Segmented
      name="filmgrain-placement"
      label="Placement"
      options={PLACEMENTS}
      value={placement}
      disabled={editor.busy}
      onvalue={(next) => (placement = next)}
    />

    <p class="tool-note">
      Square grain is one tone per block. Random puts a separate speck in each
      one.
    </p>
  </section>

  <section class="tool-section">
    <Segmented
      name="filmgrain-blend"
      label="Blend"
      options={BLEND_MODES}
      value={blendMode}
      disabled={editor.busy}
      onvalue={(next) => (blendMode = next)}
    />

    <SliderField
      id="filmgrain-blend"
      label="Intensity"
      value={blend}
      min={0}
      max={100}
      step={1}
      display="{blend} %"
      disabled={editor.busy}
      onvalue={(next) => (blend = next)}
    />

    <p class="tool-note">
      Soft light and Overlay leave a clipped white or black exactly as it is.
      Linear sums, so it will move them.
    </p>
  </section>

  <section class="tool-section">
    <NumberField
      id="filmgrain-seed"
      label="Seed"
      value={seed}
      min={0}
      max={2147483647}
      step={1}
      disabled={editor.busy}
      onvalue={(next) => (seed = Math.round(next))}
    />

    <Button variant="secondary" full disabled={editor.busy} onclick={randomiseSeed}>
      Randomise the seed
    </Button>

    <p class="tool-note">
      The same seed and settings always give the same grain, so the preview
      does not change under you.
    </p>
  </section>

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
    <p class="tool-note">The stage previews the grain. Apply keeps it.</p>

    <Button variant="primary" size="lg" full data-tool="apply" disabled={locked} onclick={apply}>
      Apply grain
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
