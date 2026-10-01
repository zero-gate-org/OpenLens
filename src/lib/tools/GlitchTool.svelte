<script>
  /**
   * Glitch art: digital corruption.
   *
   * The arithmetic is in `core/glitch.js` and it runs in a worker. The passes
   * are band copies rather than a per-pixel map, so on their own they are not
   * expensive, but there are a great many of them and a five pass corruption
   * over a twelve megapixel image is long enough to be felt as a stall if it
   * runs while a slider is being dragged. Dragging the intensity queues passes
   * faster than a large image can answer them, which is the case this worker
   * exists for. It is created on the first pass and terminated when the tool is
   * left, because the panel is mounted fresh every time the tool is selected
   * and an orphaned worker would outlive it.
   *
   * Everything is driven by one seed. The same seed and the same settings
   * corrupt a frame the same way every time, so a preview recomputed on every
   * control move cannot flicker between two versions of itself, and randomising
   * the seed is the only way to ask for a different corruption.
   *
   * The preview runs at half size on a large image, which is what the gradient
   * map does and for the same reason: one pass per control change is
   * affordable, one per pixel per second is not. The two settings measured in
   * pixels, the slice offset and the block size, are scaled by the same factor
   * as the frame, so a half size preview looks like the full size result rather
   * than like the same settings on a smaller picture. Apply always runs at the
   * full size of the source.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { context2d, createCanvas } from "../core/image.js";
  import { canvasToImageBlob, debounce, sourceCanvas } from "../core/pixels.js";
  import {
    BLOCK_SIZE,
    GLITCH_DEFAULTS,
    MAX_SEED,
    SLICE_COUNT,
    SLICE_OFFSET,
  } from "../core/glitch.js";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import NumberField from "../components/controls/NumberField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  /**
   * Above this many pixels the preview runs at half size.
   *
   * Two megapixels is where a five pass corruption stops feeling immediate and
   * starts feeling like a stall, and it is the figure the rest of the app cuts
   * over at.
   */
  const PREVIEW_PIXEL_CEILING = 2 * 1024 * 1024;
  const PREVIEW_SCALE = 0.5;

  /** How long between two animation frames, slowest first. */
  const FRAME_MAX_MS = 500;
  const FRAME_MIN_MS = 100;

  /**
   * What a panel starts on, in the units a panel uses.
   *
   * The pass switches and the seed come straight from the core so there is one
   * answer to what the default corruption is. Intensity is the one that has to
   * be converted, because a slider runs 0 to 100 and the arithmetic runs 0 to 1.
   */
  const DEFAULTS = {
    ...GLITCH_DEFAULTS,
    intensity: GLITCH_DEFAULTS.intensity * 100,
  };

  /**
   * Starting looks.
   *
   * The legacy set, unchanged. Each one is a complete set of switches and
   * settings rather than the settings that happen to differ, so a preset can be
   * read against the panel above it and matched exactly.
   */
  const PRESETS = [
    {
      name: "Mild",
      slicing: true, channel: true, scanline: false, datamosh: false, rgbSplit: false,
      intensity: 30, sliceCount: 8, maxSliceOffset: 80, blockSize: 16,
    },
    {
      name: "VHS dropout",
      slicing: true, channel: false, scanline: true, datamosh: false, rgbSplit: false,
      intensity: 60, sliceCount: 15, maxSliceOffset: 100, blockSize: 16,
    },
    {
      name: "Data corrupt",
      slicing: true, channel: true, scanline: true, datamosh: true, rgbSplit: true,
      intensity: 80, sliceCount: 20, maxSliceOffset: 120, blockSize: 32,
    },
    {
      name: "Subtle tear",
      slicing: true, channel: false, scanline: false, datamosh: false, rgbSplit: false,
      intensity: 20, sliceCount: 5, maxSliceOffset: 30, blockSize: 16,
    },
  ];

  let slicing = $state(DEFAULTS.slicing);
  let channel = $state(DEFAULTS.channel);
  let scanline = $state(DEFAULTS.scanline);
  let datamosh = $state(DEFAULTS.datamosh);
  let rgbSplit = $state(DEFAULTS.rgbSplit);
  let intensity = $state(DEFAULTS.intensity);
  let sliceCount = $state(DEFAULTS.sliceCount);
  let maxSliceOffset = $state(DEFAULTS.maxSliceOffset);
  let blockSize = $state(DEFAULTS.blockSize);
  let seed = $state(DEFAULTS.seed);
  let animate = $state(false);
  let speed = $state(50);
  let previewError = $state(null);

  const source = $derived(editor.current);

  /**
   * Every control, as one string.
   *
   * The preview effect depends on this rather than on a list of `void` reads,
   * so a control cannot be added and then forgotten. The image is deliberately
   * not in it: see the control effect for why. The animation toggle and its
   * speed are deliberately not in it either, because neither changes a pixel:
   * the animation moves the seed, and the seed is already here.
   */
  const controlKey = $derived(
    [
      slicing ? 1 : 0,
      channel ? 1 : 0,
      scanline ? 1 : 0,
      datamosh ? 1 : 0,
      rgbSplit ? 1 : 0,
      intensity,
      sliceCount,
      maxSliceOffset,
      blockSize,
      seed,
    ].join("|"),
  );

  /** How many passes are switched on, which is a fact about the current state. */
  const passCount = $derived(
    [slicing, channel, scanline, datamosh, rgbSplit].filter(Boolean).length,
  );

  /**
   * The control state in the shape the renderer wants.
   *
   * Read once at the top of a pass so a frame is always a consistent read of
   * one set of values rather than of whatever the controls held by the time the
   * last await returned. `scale` is the ratio the frame is being rendered at,
   * so the two settings measured in pixels can be scaled with it and a half
   * size preview looks like the full size result.
   *
   * @param {number} [scale] 1 for a commit, less than 1 for a preview
   * @returns {import("../core/glitch.js").GlitchOptions}
   */
  function params(scale = 1) {
    return {
      seed,
      intensity: intensity / 100,
      slicing,
      channel,
      scanline,
      datamosh,
      rgbSplit,
      sliceCount,
      maxSliceOffset: Math.max(1, Math.round(maxSliceOffset * scale)),
      blockSize: Math.max(1, Math.round(blockSize * scale)),
    };
  }

  // -------------------------------------------------------------------
  // Source pixels
  // -------------------------------------------------------------------

  /** Decoded preview pixels, reused across every control change. */
  let cache = { url: null, pixels: null, generation: 0 };

  /**
   * Decode the source for the preview, at preview size.
   *
   * @param {import("../core/image.js").ImageRecord} image
   * @param {number} generation
   * @returns {Promise<import("../core/glitch.js").Pixels | null>}
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
   * answer to a different one, which is the failure mode an animation gets into
   * when it queues frames faster than a large image can answer them.
   *
   * @returns {Worker}
   */
  function glitchWorker() {
    if (worker) return worker;

    const created = new Worker(new URL("../workers/glitch-worker.js", import.meta.url), {
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
      failPending(event.message || "The glitch pass could not run.");
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
   * The source frame is copied rather than transferred, because the cache has
   * to survive for the next control change and a transfer list takes the buffer
   * with it. The result comes back transferred, so the worker hands over the
   * only copy it made instead of keeping one it will never read.
   *
   * @param {import("../core/glitch.js").Pixels} pixels
   * @param {import("../core/glitch.js").GlitchOptions} options
   * @returns {Promise<import("../core/glitch.js").Pixels | null>}
   */
  function runGlitch(pixels, options) {
    const id = ++nextJob;
    return new Promise((resolve, reject) => {
      // The view is copied at its own offset and length rather than by handing
      // over the whole buffer, so a frame whose array happens to be a window
      // onto a larger one is not sent with padding the worker would read as
      // pixels.
      const { byteOffset, byteLength } = pixels.data;
      const buffer = pixels.data.buffer.slice(byteOffset, byteOffset + byteLength);
      pending.set(id, { id, resolve, reject });
      glitchWorker().postMessage({ id, width: pixels.width, height: pixels.height, buffer, options }, [
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
   * A preview computed from it is indistinguishable from the committed image,
   * so it is suppressed until a control changes. This also covers a queued
   * recompute: a debounce that fires just after Apply would otherwise rebuild
   * the image we already wrote and park a "Preview" badge on top of it.
   */
  let committedUrl = $state(null);

  /** Whether a commit is allowed, and whether a frame may be written at all. */
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

    // One consistent read of the controls, taken before the first await.
    const large = image.width * image.height > PREVIEW_PIXEL_CEILING;
    const options = params(large ? PREVIEW_SCALE : 1);
    editor.previewBusy = true;
    previewError = null;

    try {
      const pixels = await previewPixels(image, generation);
      if (!pixels || isStale()) return;

      const out = await runGlitch(pixels, options);
      if (!out || isStale()) return;

      const blob = await canvasToImageBlob(toCanvas(out), image);
      if (isStale()) return;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      if (!isStale()) previewError = "The glitch pass could not run. Try Apply again.";
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
    const active = editor.tool === "glitch";
    void editor.epoch;
    if (!active) return;
    committedUrl = null;
    untrack(() => {
      if (editor.current) recompute.flush();
    });
  });

  // -------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------

  /** How long between two frames at the current speed. */
  const frameMs = $derived(
    FRAME_MAX_MS - (speed / 100) * (FRAME_MAX_MS - FRAME_MIN_MS),
  );

  /**
   * The same thing as a rate, which is how a speed control reads.
   *
   * Ten frames a second at the top of the slider, two at the bottom. It is the
   * interval worked out the other way round, not a separate setting.
   */
  const framesPerSecond = $derived(
    (Math.round((1000 / frameMs) * 10) / 10).toFixed(1),
  );

  /**
   * One frame of the animation, which is a new seed and nothing else.
   *
   * The frame is not rendered here. Writing the seed re-arms the control effect
   * above, which debounces, renders through the same worker, and respects the
   * same staleness checks as any other control change. That is the whole reason
   * the animation is one line: there is no second render loop that could fight
   * the debounce, fight the Apply lock, or outlive the tool.
   *
   * The gate is the same one Apply uses, so a frame is never written while a
   * commit is running or while the previous frame is still being rendered. A
   * dropped frame is invisible; a queue of them is not.
   */
  function tick() {
    if (editor.tool !== "glitch" || locked) return;
    seed = Math.floor(Math.random() * (MAX_SEED + 1));
  }

  /**
   * The animation loop, owned by one effect and torn down by its own cleanup.
   *
   * One interval, not a requestAnimationFrame loop and not a second debounce.
   * It is cleared when the toggle goes off, when the speed changes, while a
   * commit runs, and when the operator leaves the tool, because all four of
   * those re-run this effect and every re-run starts by clearing the interval
   * the previous one left behind. The shortest frame is longer than the
   * debounce, so a frame cannot queue a render behind the one it just asked
   * for.
   */
  $effect(() => {
    const on = animate;
    const interval = frameMs;
    // Read here rather than only in `tick`, so a commit stops the loop outright
    // instead of leaving a timer that wakes up to find itself locked.
    const allowed = editor.tool === "glitch" && !editor.busy;
    void on;
    void interval;
    void allowed;
    if (!on || !allowed) return;

    const id = setInterval(tick, interval);
    return () => clearInterval(id);
  });

  // -------------------------------------------------------------------
  // Presets, seed and reset
  // -------------------------------------------------------------------

  function matches(preset) {
    return (
      preset.slicing === slicing &&
      preset.channel === channel &&
      preset.scanline === scanline &&
      preset.datamosh === datamosh &&
      preset.rgbSplit === rgbSplit &&
      preset.intensity === intensity &&
      preset.sliceCount === sliceCount &&
      preset.maxSliceOffset === maxSliceOffset &&
      preset.blockSize === blockSize
    );
  }

  const activePreset = $derived(PRESETS.findIndex(matches));

  function usePreset(preset) {
    slicing = preset.slicing;
    channel = preset.channel;
    scanline = preset.scanline;
    datamosh = preset.datamosh;
    rgbSplit = preset.rgbSplit;
    intensity = preset.intensity;
    sliceCount = preset.sliceCount;
    maxSliceOffset = preset.maxSliceOffset;
    blockSize = preset.blockSize;
  }

  function randomiseSeed() {
    seed = Math.floor(Math.random() * (MAX_SEED + 1));
  }

  function reset() {
    slicing = DEFAULTS.slicing;
    channel = DEFAULTS.channel;
    scanline = DEFAULTS.scanline;
    datamosh = DEFAULTS.datamosh;
    rgbSplit = DEFAULTS.rgbSplit;
    intensity = DEFAULTS.intensity;
    sliceCount = DEFAULTS.sliceCount;
    maxSliceOffset = DEFAULTS.maxSliceOffset;
    blockSize = DEFAULTS.blockSize;
    seed = DEFAULTS.seed;
    animate = false;
    speed = 50;
  }

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  /**
   * Apply is blocked while a preview is still moving.
   *
   * A preview render and a commit render share the source buffer and the
   * worker, so starting a commit while a preview is in flight has one of the
   * two waiting on a pass the other threw away. Beyond the corruption, asking
   * to apply during a moving preview is not a request anyone can mean.
   */
  async function apply() {
    // Drop anything the run-up to this click queued, so no pass is in flight.
    recompute.cancel();

    if (!source || locked) return;

    const image = source;
    const options = params(1);

    await editor.run("Glitch", async (report) => {
      report("Decoding", 0.15);
      const pixels = await fullPixels(image);

      report("Corrupting", 0.45);
      const out = await runGlitch(pixels, options);
      if (!out) throw new Error("The glitch pass was interrupted. Try again.");

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(toCanvas(out), image);
      await editor.commit(blob, "Glitch", image.name);

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
    <span class="micro-label">Passes</span>

    <CheckField
      id="glitch-slicing"
      label="Slicing"
      bind:checked={slicing}
      disabled={editor.busy}
      hint="Bands of rows pushed sideways, wrapping at the edge."
    />

    <CheckField
      id="glitch-channel"
      label="Channel shift"
      bind:checked={channel}
      disabled={editor.busy}
      hint="Bands of rows with red and blue pulled apart."
    />

    <CheckField
      id="glitch-scanline"
      label="Scanlines"
      bind:checked={scanline}
      disabled={editor.busy}
      hint="Rows replaced by a row from elsewhere, brighter."
    />

    <CheckField
      id="glitch-datamosh"
      label="Block datamosh"
      bind:checked={datamosh}
      disabled={editor.busy}
      hint="Blocks copied over from elsewhere and tinted a little."
    />

    <CheckField
      id="glitch-rgb-split"
      label="RGB split"
      bind:checked={rgbSplit}
      disabled={editor.busy}
      hint="Wide bands, with a much wider red and blue split."
    />

    <div class="tool-result">
      <span>Passes on</span>
      <strong>{passCount} of 5</strong>
    </div>
  </section>

  <section class="tool-section">
    <SliderField
      id="glitch-intensity"
      label="Intensity"
      value={intensity}
      min={0}
      max={100}
      step={1}
      display="{intensity} %"
      disabled={editor.busy}
      onvalue={(next) => (intensity = next)}
    />

    <p class="tool-note">At 0 % nothing changes, whatever is switched on.</p>
  </section>

  {#if slicing}
    <section class="tool-section">
      <span class="micro-label">Slicing</span>

      <SliderField
        id="glitch-slice-count"
        label="Slices"
        value={sliceCount}
        min={SLICE_COUNT.min}
        max={SLICE_COUNT.max}
        step={SLICE_COUNT.step}
        display={String(sliceCount)}
        disabled={editor.busy}
        onvalue={(next) => (sliceCount = next)}
      />

      <SliderField
        id="glitch-slice-offset"
        label="Max offset"
        value={maxSliceOffset}
        min={SLICE_OFFSET.min}
        max={SLICE_OFFSET.max}
        step={SLICE_OFFSET.step}
        display="{maxSliceOffset} px"
        disabled={editor.busy}
        onvalue={(next) => (maxSliceOffset = next)}
      />

      <p class="tool-note">How many bands to move, and how far the furthest one goes.</p>
    </section>
  {/if}

  {#if datamosh}
    <section class="tool-section">
      <span class="micro-label">Block datamosh</span>

      <SliderField
        id="glitch-block-size"
        label="Block size"
        value={blockSize}
        min={BLOCK_SIZE.min}
        max={BLOCK_SIZE.max}
        step={BLOCK_SIZE.step}
        display="{blockSize} px"
        disabled={editor.busy}
        onvalue={(next) => (blockSize = next)}
      />

      <p class="tool-note">
        A block is copied over from somewhere else in the frame. A larger block
        reads as compression damage, a smaller one as broken tiles.
      </p>
    </section>
  {/if}

  <section class="tool-section">
    <span class="micro-label">Seed</span>

    <NumberField
      id="glitch-seed"
      label="Seed"
      value={seed}
      min={0}
      max={MAX_SEED}
      step={1}
      disabled={editor.busy}
      onvalue={(next) => (seed = Math.round(next))}
    />

    <Button variant="secondary" full disabled={editor.busy} onclick={randomiseSeed}>
      Randomise the seed
    </Button>

    <p class="tool-note">
      The same seed and settings always give the same corruption, so the preview
      does not change under you.
    </p>
  </section>

  <section class="tool-section">
    <span class="micro-label">Animation</span>

    <CheckField
      id="glitch-animate"
      label="Animate"
      bind:checked={animate}
      disabled={editor.busy}
      hint="Rolls a new seed onto the stage while the tool is open. Apply takes the frame you see."
    />

    <SliderField
      id="glitch-speed"
      label="Speed"
      value={speed}
      min={0}
      max={100}
      step={1}
      display="{framesPerSecond} /s"
      disabled={editor.busy || !animate}
      onvalue={(next) => (speed = next)}
    />
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
    <p class="tool-note">The stage previews the corruption. Apply keeps it.</p>

    <Button variant="primary" size="lg" full data-tool="apply" disabled={locked} onclick={apply}>
      Apply glitch
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
