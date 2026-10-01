<script>
  /**
   * Chromatic aberration: every colour channel sampled at a slightly different
   * place, which is what a cheap lens does to a picture.
   *
   * The arithmetic is in `core/aberration.js` and it runs in a worker. A pass is
   * two channel reads and a mix per pixel, which is cheap per pixel and there
   * are a great many pixels, so on a twelve megapixel image dragging an offset
   * would otherwise queue passes faster than the main thread can answer them.
   * The worker is created on the first pass and terminated when the tool is
   * left, because the panel is mounted fresh every time the tool is selected
   * and an orphaned worker would outlive it.
   *
   * The preview runs at half size on a large image, which is what the other
   * filter tools do and for the same reason: one pass per control change is
   * affordable, one per pixel per second is not. The setting is left on the
   * panel rather than hard wired, because half size is a trade the operator may
   * want to refuse on a picture where the offsets are a pixel wide and the half
   * size frame rounds them away. Apply always runs at the full size of the
   * source, so the setting changes what the preview costs and never what Apply
   * writes.
   *
   * Both modes leave one channel in place: axial holds green, radial holds
   * red. That is what keeps the structure of the picture readable while only
   * the colour fringes move, and it is why the offsets are described as a red
   * shift and a blue shift rather than as three equal displacements.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { context2d, createCanvas } from "../core/image.js";
  import { canvasToImageBlob, debounce, sourceCanvas } from "../core/pixels.js";
  import {
    ABERRATION_DEFAULTS,
    ABERRATION_MODES,
    OFFSET_RANGE,
    STRENGTH_RANGE,
  } from "../core/aberration.js";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  /**
   * Above this many pixels the preview can be run at half size.
   *
   * Two megapixels is where a full pass stops feeling immediate and starts
   * feeling like a stall, and it is the figure the rest of the app cuts over at.
   */
  const PREVIEW_PIXEL_CEILING = 2 * 1024 * 1024;
  const PREVIEW_SCALE = 0.5;

  /**
   * What a panel starts on, in the units the panel uses.
   *
   * The mode and the four offsets come straight from the core so there is one
   * answer to what the default shift is. Intensity is the one that has to be
   * converted, because a slider runs 0 to 100 and the arithmetic runs 0 to 1.
   */
  const DEFAULTS = {
    mode: ABERRATION_DEFAULTS.mode,
    strength: ABERRATION_DEFAULTS.strength,
    offsetRX: ABERRATION_DEFAULTS.offsetRX,
    offsetRY: ABERRATION_DEFAULTS.offsetRY,
    offsetBX: ABERRATION_DEFAULTS.offsetBX,
    offsetBY: ABERRATION_DEFAULTS.offsetBY,
    intensity: ABERRATION_DEFAULTS.intensity * 100,
    halfPreview: true,
  };

  /**
   * Starting looks, the legacy set, unchanged.
   *
   * Each one carries every setting rather than only the ones that differ, so a
   * preset can be read against the panel above it and matched exactly. The
   * settings a preset does not use are set to neutral rather than left alone, so
   * loading one can never leave a half chosen shift behind it.
   */
  const PRESETS = [
    { name: "Subtle Lens", mode: "radial", strength: 15, offsetRX: 0, offsetRY: 0, offsetBX: 0, offsetBY: 0, intensity: 100 },
    { name: "Glitch Light", mode: "axial", strength: 0, offsetRX: -3, offsetRY: 0, offsetBX: 3, offsetBY: 0, intensity: 100 },
    { name: "Heavy Glitch", mode: "axial", strength: 0, offsetRX: -10, offsetRY: 2, offsetBX: 10, offsetBY: -2, intensity: 100 },
    { name: "Vintage VHS", mode: "axial", strength: 0, offsetRX: -6, offsetRY: 0, offsetBX: 6, offsetBY: 1, intensity: 80 },
  ];

  let mode = $state(DEFAULTS.mode);
  let strength = $state(DEFAULTS.strength);
  let offsetRX = $state(DEFAULTS.offsetRX);
  let offsetRY = $state(DEFAULTS.offsetRY);
  let offsetBX = $state(DEFAULTS.offsetBX);
  let offsetBY = $state(DEFAULTS.offsetBY);
  let intensity = $state(DEFAULTS.intensity);
  let halfPreview = $state(DEFAULTS.halfPreview);
  let previewError = $state(null);

  const source = $derived(editor.current);

  /** Whether the picture on the stage is big enough for half size to matter. */
  const large = $derived(!!source && source.width * source.height > PREVIEW_PIXEL_CEILING);

  /**
   * Every control, as one string.
   *
   * The preview effect depends on this rather than on a list of `void` reads,
   * so a control cannot be added and then forgotten. The image is deliberately
   * not in it, and neither is the size it is being previewed at: `large` is
   * derived from `editor.current`, so putting the scale in here would make this
   * effect depend on the image after all. The raw toggle is in here instead,
   * which is local state and carries the same information.
   */
  const controlKey = $derived(
    [
      mode,
      strength,
      offsetRX,
      offsetRY,
      offsetBX,
      offsetBY,
      intensity,
      halfPreview ? 1 : 0,
    ].join("|"),
  );

  /** A preset is on exactly while the panel holds that preset's settings. */
  const activePreset = $derived(
    PRESETS.find(
      (preset) =>
        preset.mode === mode &&
        preset.strength === strength &&
        preset.offsetRX === offsetRX &&
        preset.offsetRY === offsetRY &&
        preset.offsetBX === offsetBX &&
        preset.offsetBY === offsetBY &&
        preset.intensity === intensity,
    )?.name ?? null,
  );

  /**
   * The control state in the shape the renderer wants.
   *
   * Read once at the top of a pass so a frame is always a consistent read of
   * one set of values rather than of whatever the controls held by the time the
   * last await returned.
   *
   * @returns {import("../core/aberration.js").AberrationOptions}
   */
  function params() {
    return {
      // `$state` widens the mode to a string and the renderer's parameter type
      // is a narrow union, so the literal is asserted once, here.
      mode: /** @type {import("../core/aberration.js").AberrationMode} */ (mode),
      strength,
      offsetRX,
      offsetRY,
      offsetBX,
      offsetBY,
      intensity: intensity / 100,
    };
  }

  // -------------------------------------------------------------------
  // Source pixels
  // -------------------------------------------------------------------

  /** Decoded preview pixels, reused across every control change. */
  let cache = { url: null, scale: 0, pixels: null, generation: 0 };

  /**
   * Decode the source for the preview, at the size the preview wants.
   *
   * The cache is keyed on the size as well as on the image, so turning the
   * half size setting off decodes the full frame rather than handing the
   * already halved one back.
   *
   * @param {import("../core/image.js").ImageRecord} image
   * @param {number} scale 1, or half
   * @param {number} generation
   * @returns {Promise<import("../core/aberration.js").Pixels | null>}
   */
  async function previewPixels(image, scale, generation) {
    if (cache.url === image.url && cache.scale === scale && cache.pixels) return cache.pixels;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const { ctx } = await sourceCanvas(image.blob, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    if (generation !== cache.generation) return null;
    cache = { url: image.url, scale, pixels, generation };
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
   * answer to a different one, which is the failure mode an offset drag gets
   * into when it queues passes faster than a large image can answer them.
   *
   * @returns {Worker}
   */
  function aberrationWorker() {
    if (worker) return worker;

    const created = new Worker(new URL("../workers/chromatic-aberration-worker.js", import.meta.url), {
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
      failPending(event.message || "The aberration pass could not run.");
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
   * to survive for the next control change and a transfer list takes the
   * buffer with it. The result comes back transferred, so the worker hands
   * over the only copy it made instead of keeping one it will never read.
   *
   * @param {import("../core/aberration.js").Pixels} pixels
   * @param {import("../core/aberration.js").AberrationOptions} options
   * @returns {Promise<import("../core/aberration.js").Pixels | null>}
   */
  function runAberration(pixels, options) {
    const id = ++nextJob;
    return new Promise((resolve, reject) => {
      // The view is copied at its own offset and length rather than by handing
      // over the whole buffer, so a frame whose array happens to be a window
      // onto a larger one is not sent with padding the worker would read as
      // pixels.
      const { byteOffset, byteLength } = pixels.data;
      const buffer = pixels.data.buffer.slice(byteOffset, byteOffset + byteLength);
      pending.set(id, { id, resolve, reject });
      aberrationWorker().postMessage({ id, width: pixels.width, height: pixels.height, buffer, options }, [
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

  /**
   * Apply is blocked while a preview is still moving.
   *
   * A preview render and a commit render share the source buffer and the
   * worker, so starting a commit while a preview is in flight has one of the
   * two waiting on a pass the other threw away. Beyond that, asking to apply
   * during a moving preview is not a request anyone can mean.
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

    // One consistent read of the controls, taken before the first await. The
    // half size decision is made here rather than in a derived value, because
    // a derived value would drag `editor.current` into the control effect.
    const scale =
      image.width * image.height > PREVIEW_PIXEL_CEILING && halfPreview ? PREVIEW_SCALE : 1;
    const options = params();
    editor.previewBusy = true;
    previewError = null;

    try {
      const pixels = await previewPixels(image, scale, generation);
      if (!pixels || isStale()) return;

      const out = await runAberration(pixels, options);
      if (!out || isStale()) return;

      const blob = await canvasToImageBlob(toCanvas(out), image);
      if (isStale()) return;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      if (!isStale()) previewError = "The aberration pass could not run. Try Apply again.";
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
      cache = { url: null, scale: 0, pixels: null, generation: cache.generation + 1 };
      // The panel is mounted fresh on every selection, so a worker left running
      // here would outlive the component that made it.
      stopWorker();
    };
  });

  // Seed on activation, and whenever a genuinely new image arrives.
  // `editor.epoch` moves only on open and discard, never on a commit, so this
  // cannot fire for output this tool produced itself.
  $effect(() => {
    const active = editor.tool === "chromaticaberration";
    void editor.epoch;
    if (!active) return;
    committedUrl = null;
    untrack(() => {
      if (editor.current) recompute.flush();
    });
  });

  // -------------------------------------------------------------------
  // Presets and reset
  // -------------------------------------------------------------------

  function usePreset(preset) {
    mode = /** @type {import("../core/aberration.js").AberrationMode} */ (preset.mode);
    strength = preset.strength;
    offsetRX = preset.offsetRX;
    offsetRY = preset.offsetRY;
    offsetBX = preset.offsetBX;
    offsetBY = preset.offsetBY;
    intensity = preset.intensity;
  }

  function reset() {
    mode = DEFAULTS.mode;
    strength = DEFAULTS.strength;
    offsetRX = DEFAULTS.offsetRX;
    offsetRY = DEFAULTS.offsetRY;
    offsetBX = DEFAULTS.offsetBX;
    offsetBY = DEFAULTS.offsetBY;
    intensity = DEFAULTS.intensity;
    halfPreview = DEFAULTS.halfPreview;
  }

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  async function apply() {
    // Drop anything the run-up to this click queued, so no pass is in flight.
    recompute.cancel();

    if (!source || locked) return;

    const image = source;
    const options = params();

    await editor.run("Chromatic aberration", async (report) => {
      report("Decoding", 0.15);
      const pixels = await fullPixels(image);

      report("Shifting channels", 0.45);
      const out = await runAberration(pixels, options);
      if (!out) throw new Error("The aberration pass was interrupted. Try again.");

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(toCanvas(out), image);
      await editor.commit(blob, "Chromatic aberration", image.name);

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
      name="chromaticaberration-mode"
      label="Style"
      options={ABERRATION_MODES}
      value={mode}
      disabled={editor.busy}
      onvalue={(next) => (mode = /** @type {import("../core/aberration.js").AberrationMode} */ (next))}
    />

    <p class="tool-note">
      {#if mode === "axial"}
        Axial moves the red and blue channels against each other and leaves green where it is.
      {:else}
        Radial scales green and blue out from the centre and leaves red where it is.
      {/if}
    </p>
  </section>

  {#if mode === "axial"}
    <section class="tool-section">
      <span class="micro-label">Channel offsets</span>

      <SliderField
        id="chromaticaberration-rx"
        label="Red shift X"
        value={offsetRX}
        min={OFFSET_RANGE.min}
        max={OFFSET_RANGE.max}
        step={OFFSET_RANGE.step}
        display="{offsetRX} px"
        disabled={editor.busy}
        onvalue={(next) => (offsetRX = next)}
      />

      <SliderField
        id="chromaticaberration-ry"
        label="Red shift Y"
        value={offsetRY}
        min={OFFSET_RANGE.min}
        max={OFFSET_RANGE.max}
        step={OFFSET_RANGE.step}
        display="{offsetRY} px"
        disabled={editor.busy}
        onvalue={(next) => (offsetRY = next)}
      />

      <SliderField
        id="chromaticaberration-bx"
        label="Blue shift X"
        value={offsetBX}
        min={OFFSET_RANGE.min}
        max={OFFSET_RANGE.max}
        step={OFFSET_RANGE.step}
        display="{offsetBX} px"
        disabled={editor.busy}
        onvalue={(next) => (offsetBX = next)}
      />

      <SliderField
        id="chromaticaberration-by"
        label="Blue shift Y"
        value={offsetBY}
        min={OFFSET_RANGE.min}
        max={OFFSET_RANGE.max}
        step={OFFSET_RANGE.step}
        display="{offsetBY} px"
        disabled={editor.busy}
        onvalue={(next) => (offsetBY = next)}
      />

      <p class="tool-note">
        Negative moves a channel left and up. A sample that lands outside the frame takes the edge
        pixel instead, so the fringing reaches the border rather than stopping short of it.
      </p>
    </section>
  {:else}
    <section class="tool-section">
      <span class="micro-label">Radial</span>

      <SliderField
        id="chromaticaberration-strength"
        label="Aberration strength"
        value={strength}
        min={STRENGTH_RANGE.min}
        max={STRENGTH_RANGE.max}
        step={STRENGTH_RANGE.step}
        display={String(strength)}
        disabled={editor.busy}
        onvalue={(next) => (strength = next)}
      />

      <p class="tool-note">
        The offset grows with the distance from the middle, so the corners fringe and the centre
        does not. At 0 nothing moves.
      </p>
    </section>
  {/if}

  <section class="tool-section">
    <SliderField
      id="chromaticaberration-intensity"
      label="Intensity"
      value={intensity}
      min={0}
      max={100}
      step={1}
      display="{intensity} %"
      disabled={editor.busy}
      onvalue={(next) => (intensity = next)}
    />

    <div class="tool-result">
      <span>Preview size</span>
      <strong>{large && halfPreview ? "Half size" : "Full size"}</strong>
    </div>

    {#if large}
      <CheckField
        id="chromaticaberration-half"
        label="Preview at half size"
        bind:checked={halfPreview}
        disabled={editor.busy}
        hint="Only offered above two megapixels. Apply always runs at the full size of the image."
      />
    {/if}

    <p class="tool-note">At 0 % nothing changes, in either style.</p>
  </section>

  <section class="tool-section">
    <span class="micro-label">Presets</span>

    <div class="tool-chips">
      {#each PRESETS as preset (preset.name)}
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
  </section>

  {#if previewError}
    <p class="tool-note warn">{previewError}</p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">The stage previews the shift. Apply keeps it.</p>

    <Button variant="primary" size="lg" full data-tool="apply" disabled={locked} onclick={apply}>
      Apply aberration
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