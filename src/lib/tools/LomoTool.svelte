<script>
  /**
   * Lomo: film emulation by tone curve, saturation, warmth and vignette.
   *
   * The arithmetic is in `core/lomo.js` and it runs in a worker. A pass is
   * three table lookups, a saturation round trip, a warmth offset and a
   * vignette multiply over every pixel in the frame, which is cheap per pixel
   * and there are a great many pixels, so on a twelve megapixel image dragging
   * the warmth slider would otherwise queue passes faster than the main thread
   * can answer them. The worker is created on the first pass and terminated
   * when the tool is left, because the panel is mounted fresh every time the
   * tool is selected and an orphaned worker would outlive it.
   *
   * The preview runs at half size on a large image, which is what the gradient
   * map and the glitch tool do and for the same reason: one pass per control
   * change is affordable, one per pixel per second is not. Nothing is lost by
   * it here, because the curve is per pixel and the vignette is measured as a
   * fraction of the frame, so a half size preview is the same look as the full
   * size one. Apply always runs at the full size of the source.
   *
   * The curve editor is a drawing, not a widget. The three curves are rendered
   * as SVG paths and the picture is there to be read: it is the only way to
   * see two channels cross. What a point actually is, a level and a position,
   * is set with number fields, which are real inputs with the keyboard already
   * working. The legacy tool drew the same information onto a canvas and bound
   * a mouse to it, so a point could only be moved by dragging and a screen
   * reader could not describe the curve at all. Two points that would land on
   * the same level trade places instead of colliding, because a curve is only
   * defined when each point sits at its own position.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { context2d, createCanvas } from "../core/image.js";
  import { canvasToImageBlob, debounce, sourceCanvas } from "../core/pixels.js";
  import {
    CHANNELS,
    CURVE_STEPS,
    LOMO_DEFAULTS,
    LOOKS,
    MIN_CURVE_POINTS,
    VIGNETTE_SHAPES,
    buildCurveLut,
    curveInsertionPoint,
    curvePath,
  } from "../core/lomo.js";

  import Button from "../components/controls/Button.svelte";
  import NumberField from "../components/controls/NumberField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  /**
   * Above this many pixels the preview runs at half size.
   *
   * Two megapixels is where a full pass stops feeling immediate and starts
   * feeling like a stall, and it is the figure the rest of the app cuts over at.
   */
  const PREVIEW_PIXEL_CEILING = 2 * 1024 * 1024;
  const PREVIEW_SCALE = 0.5;

  const DEFAULTS = {
    saturation: LOMO_DEFAULTS.saturation,
    vignette: LOMO_DEFAULTS.vignette,
    warmth: LOMO_DEFAULTS.warmth,
    intensity: LOMO_DEFAULTS.intensity,
    shape: LOMO_DEFAULTS.shape,
    channel: LOMO_DEFAULTS.channel,
  };

  /** Points carry an id so a number field keeps its own state through a reset. */
  let nextId = 0;
  function withIds(list) {
    return list.map((point) => ({ ...point, id: `lomo-${++nextId}` }));
  }

  let saturation = $state(DEFAULTS.saturation);
  let vignette = $state(DEFAULTS.vignette);
  let warmth = $state(DEFAULTS.warmth);
  let intensity = $state(DEFAULTS.intensity);
  let shape = $state(DEFAULTS.shape);
  let channel = $state(DEFAULTS.channel);
  let curves = $state({
    R: withIds(LOMO_DEFAULTS.curves.R),
    G: withIds(LOMO_DEFAULTS.curves.G),
    B: withIds(LOMO_DEFAULTS.curves.B),
  });
  let previewError = $state(null);

  const source = $derived(editor.current);

  /**
   * The channel being edited, narrowed.
   *
   * `$state` widens a string to `string`, and the curve table is a record
   * keyed by the three channel names, so the literal is asserted here once
   * instead of at every lookup.
   */
  const activeChannel = $derived(/** @type {"R" | "G" | "B"} */ (channel));

  /** The points the number fields are editing. */
  const activePoints = $derived(curves[activeChannel]);

  /**
   * Every channel's curve as a table.
   *
   * Held in model space and never reordered by the panel, so a number field
   * cannot be moved out from under the hand that is typing into it. The table
   * sorts a copy of the list itself, which is why the order the points are
   * listed in is only for reading.
   */
  const luts = $derived({
    R: buildCurveLut(curves.R),
    G: buildCurveLut(curves.G),
    B: buildCurveLut(curves.B),
  });

  /** One path per channel, in a 0..256 view box with y running upwards. */
  const paths = $derived({
    R: curvePath(luts.R),
    G: curvePath(luts.G),
    B: curvePath(luts.B),
  });

  /**
   * Every control, as one string.
   *
   * The preview effect depends on this rather than on a list of `void` reads,
   * so a control cannot be added and then forgotten. The image is deliberately
   * not in it: see the control effect for why. The channel being inspected is
   * deliberately not in it either, because which curve is drawn brightly is a
   * view and not an edit.
   */
  const controlKey = $derived(
    [
      saturation,
      vignette,
      warmth,
      intensity,
      shape,
      CHANNELS.map((ch) => curves[ch.value].map((p) => `${p.x},${p.y}`).join(";")).join("/"),
    ].join("|"),
  );

  /**
   * The control state in the shape the renderer wants.
   *
   * Read once at the top of a pass so a frame is always a consistent read of
   * one set of values rather than of whatever the controls held by the time
   * the last await returned.
   *
   * @returns {import("../core/lomo.js").LomoOptions}
   */
  function params() {
    // Plain `{x, y}` pairs: the id is panel bookkeeping and has no business
    // crossing into a worker message.
    const bare = (/** @type {import("../core/lomo.js").CurvePoint[]} */ list) =>
      list.map(({ x, y }) => ({ x, y }));

    return {
      curves: { R: bare(curves.R), G: bare(curves.G), B: bare(curves.B) },
      saturation: saturation / 100,
      warmth,
      intensity: intensity / 100,
      vignette: vignette / 100,
      shape: /** @type {"round" | "oval"} */ (shape),
    };
  }

  // -------------------------------------------------------------------
  // The channel curves
  // -------------------------------------------------------------------

  /** Put a fresh list on one channel, leaving the other two alone. */
  function setPoints(next) {
    curves = { ...curves, [activeChannel]: next };
  }

  /**
   * Move one point along its axis.
   *
   * @param {string} id
   * @param {"x" | "y"} axis
   * @param {number} value
   */
  function movePoint(id, axis, value) {
    const list = curves[activeChannel];
    const i = list.findIndex((point) => point.id === id);
    if (i < 0) return;

    const level = Math.max(0, Math.min(CURVE_STEPS - 1, Math.round(Number(value) || 0)));
    if (list[i][axis] === level) return;
    if (axis === "y") {
      const next = list.map((point) => (point.id === id ? { ...point, y: level } : point));
      setPoints(next);
      return;
    }

    // Two points cannot sit at the same position, because a curve is only
    // defined when each of its points has one. Rather than dropping one of
    // them, which would make a point vanish under the hand that moved it, the
    // two trade places.
    const other = list.findIndex((point, k) => k !== i && point.x === level);
    const next = list.map((point) => ({ ...point }));
    if (other >= 0) next[other] = { ...next[other], x: next[i].x };
    next[i] = { ...next[i], x: level };
    setPoints(next);
  }

  /**
   * Add a point on the widest gap in the curve, at the level the curve already
   * passes through there.
   *
   * A point that appears at a level the curve does not already have silently
   * reshapes the tone, so the new one is invisible until it is moved, and a
   * control that cannot be seen is the worst kind.
   */
  function addPoint() {
    const spot = curveInsertionPoint(curves[activeChannel]);
    setPoints([...curves[activeChannel], { ...spot, id: `lomo-${++nextId}` }]);
  }

  /**
   * Drop a point, unless doing so would leave fewer than two.
   *
   * The minimum is enforced here rather than by the button's disabled state,
   * because the keyboard can ask for the same thing and a greyed button is not
   * a rule.
   *
   * @param {string} id
   */
  function removePoint(id) {
    const list = curves[activeChannel];
    if (list.length <= MIN_CURVE_POINTS) return;
    setPoints(list.filter((point) => point.id !== id));
  }

  /** The colour the selected channel is drawn in. */
  const activeColour = $derived(
    CHANNELS.find((entry) => entry.value === activeChannel)?.colour ?? "#ffffff",
  );

  /**
   * A look is loaded exactly while it is the whole of the current state.
   *
   * Derived rather than stored, which is what keeps the two from disagreeing:
   * moving a control deselects the look with no bookkeeping to forget, and
   * loading a look selects it with no flag to set.
   */
  const activeLook = $derived(
    LOOKS.find(
      (look) =>
        look.saturation * 100 === saturation &&
        Math.round(look.vignette * 100) === vignette &&
        look.warmth === warmth &&
        CHANNELS.every((ch) =>
          curves[ch.value].every(
            (point, index) =>
              point.x === look.curves[ch.value][index]?.x &&
              point.y === look.curves[ch.value][index]?.y,
          ),
        ) &&
        CHANNELS.every(
          (ch) => curves[ch.value].length === look.curves[ch.value].length,
        ),
    )?.name ?? null,
  );

  function useLook(look) {
    curves = {
      R: withIds(look.curves.R),
      G: withIds(look.curves.G),
      B: withIds(look.curves.B),
    };
    saturation = Math.round(look.saturation * 100);
    vignette = Math.round(look.vignette * 100);
    warmth = look.warmth;
  }

  function reset() {
    curves = {
      R: withIds(LOMO_DEFAULTS.curves.R),
      G: withIds(LOMO_DEFAULTS.curves.G),
      B: withIds(LOMO_DEFAULTS.curves.B),
    };
    saturation = DEFAULTS.saturation;
    vignette = DEFAULTS.vignette;
    warmth = DEFAULTS.warmth;
    intensity = DEFAULTS.intensity;
    shape = DEFAULTS.shape;
    channel = DEFAULTS.channel;
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
   * @returns {Promise<import("../core/lomo.js").Pixels | null>}
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
   * answer to a different one, which is the failure mode a slider drag gets
   * into when it queues passes faster than a large image can answer them.
   *
   * @returns {Worker}
   */
  function lomoWorker() {
    if (worker) return worker;

    const created = new Worker(new URL("../workers/lomo-worker.js", import.meta.url), {
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
      failPending(event.message || "The lomo pass could not run.");
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
   * buffer with it. The result comes back transferred, so the worker hands over
   * the only copy it made instead of keeping one it will never read.
   *
   * @param {import("../core/lomo.js").Pixels} pixels
   * @param {import("../core/lomo.js").LomoOptions} options
   * @returns {Promise<import("../core/lomo.js").Pixels | null>}
   */
  function runLomo(pixels, options) {
    const id = ++nextJob;
    return new Promise((resolve, reject) => {
      // The view is copied at its own offset and length rather than by handing
      // over the whole buffer, so a frame whose array happens to be a window
      // onto a larger one is not sent with padding the worker would read as
      // pixels.
      const { byteOffset, byteLength } = pixels.data;
      const buffer = pixels.data.buffer.slice(byteOffset, byteOffset + byteLength);
      pending.set(id, { id, resolve, reject });
      lomoWorker().postMessage({ id, width: pixels.width, height: pixels.height, buffer, options }, [
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
   * A preview pass and a commit pass share the source buffer and the worker,
   * so starting a commit while a preview is in flight has one of the two
   * waiting on a pass the other threw away. Beyond the corruption, asking to
   * apply during a moving preview is not a request anyone can mean.
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

    // One consistent read of the controls, taken before the first await.
    const options = params();
    editor.previewBusy = true;
    previewError = null;

    try {
      const pixels = await previewPixels(image, generation);
      if (!pixels || isStale()) return;

      const out = await runLomo(pixels, options);
      if (!out || isStale()) return;

      const blob = await canvasToImageBlob(toCanvas(out), image);
      if (isStale()) return;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      if (!isStale()) previewError = "The lomo pass could not run. Try Apply again.";
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
    const active = editor.tool === "lomo";
    void editor.epoch;
    if (!active) return;
    committedUrl = null;
    untrack(() => {
      if (editor.current) recompute.flush();
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

    await editor.run("Lomo", async (report) => {
      report("Decoding", 0.15);
      const pixels = await fullPixels(image);

      report("Applying the look", 0.45);
      const out = await runLomo(pixels, options);
      if (!out) throw new Error("The lomo pass was interrupted. Try again.");

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(toCanvas(out), image);
      await editor.commit(blob, "Lomo", image.name);

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
    <span class="micro-label">Looks</span>

    <div class="tool-chips">
      {#each LOOKS as look (look.name)}
        <button
          type="button"
          class="tool-chip"
          class:on={activeLook === look.name}
          aria-pressed={activeLook === look.name}
          disabled={editor.busy}
          onclick={() => useLook(look)}
        >
          {look.name}
        </button>
      {/each}
    </div>

    <p class="tool-note">
      Each look is one tone curve per channel, plus saturation, warmth and vignette.
    </p>
  </section>

  <section class="tool-section">
    <span class="micro-label">Curve</span>

    <Segmented
      name="lomo-channel"
      label="Channel"
      columns={3}
      options={CHANNELS.map((ch) => ({ value: ch.value, label: ch.label }))}
      value={activeChannel}
      disabled={editor.busy}
      onvalue={(next) => (channel = next)}
    />

    <div class="plot">
      <svg
        class="curve"
        viewBox="0 0 256 256"
        role="img"
        aria-label="The three tone curves. The channel being edited is drawn in colour, the other two are shown faintly."
      >
        <path class="grid" d="M0 64 H256 M0 128 H256 M0 192 H256 M64 0 V256 M128 0 V256 M192 0 V256" />
        <path class="reference" d="M0 256 L256 0" />

        {#each CHANNELS as ch (ch.value)}
          <path
            class="line"
            class:active={ch.value === activeChannel}
            d={paths[ch.value]}
            style:--curve-colour={ch.colour}
          />
        {/each}

        {#each activePoints as point (point.id)}
          <circle
            class="dot"
            cx={point.x}
            cy={256 - point.y}
            r="4"
            style:--curve-colour={activeColour}
          />
        {/each}
      </svg>

      <p class="plot-scale" aria-hidden="true">
        <span>Shadows</span><span>Highlights</span>
      </p>
    </div>

    <p class="tool-note">
      The drawing shows where the three curves cross. Set a point with the fields
      below.
    </p>
  </section>

  <section class="tool-section">
    {#each activePoints as point, index (point.id)}
      <div class="point">
        <span class="micro-label">Point {index + 1}</span>

        <div class="tool-row">
          <NumberField
            id="lomo-point-x-{point.id}"
            label="Position"
            value={point.x}
            min={0}
            max={CURVE_STEPS - 1}
            step={1}
            disabled={editor.busy}
            onvalue={(next) => movePoint(point.id, "x", next)}
          />

          <NumberField
            id="lomo-point-y-{point.id}"
            label="Level"
            value={point.y}
            min={0}
            max={CURVE_STEPS - 1}
            step={1}
            disabled={editor.busy}
            onvalue={(next) => movePoint(point.id, "y", next)}
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          full
          disabled={editor.busy || activePoints.length <= MIN_CURVE_POINTS}
          title={activePoints.length <= MIN_CURVE_POINTS
            ? "Two points is the fewest a curve can have"
            : `Remove point ${index + 1}`}
          onclick={() => removePoint(point.id)}
        >
          Remove point {index + 1}
        </Button>
      </div>
    {/each}

    <Button variant="secondary" full disabled={editor.busy} onclick={addPoint}>
      Add point
    </Button>

    <div class="tool-result">
      <span>{CHANNELS.find((ch) => ch.value === activeChannel)?.label} curve</span>
      <strong>{activePoints.length} points</strong>
    </div>
  </section>

  <section class="tool-section">
    <span class="micro-label">Look</span>

    <SliderField
      id="lomo-saturation"
      label="Saturation"
      value={saturation}
      min={50}
      max={300}
      step={1}
      display="{saturation} %"
      disabled={editor.busy}
      onvalue={(next) => (saturation = next)}
    />

    <SliderField
      id="lomo-warmth"
      label="Warmth"
      value={warmth}
      min={-50}
      max={50}
      step={1}
      display="{warmth > 0 ? "+" : ""}{warmth}"
      disabled={editor.busy}
      onvalue={(next) => (warmth = next)}
    />

    <SliderField
      id="lomo-vignette"
      label="Vignette"
      value={vignette}
      min={0}
      max={100}
      step={1}
      display="{vignette} %"
      disabled={editor.busy}
      onvalue={(next) => (vignette = next)}
    />

    <Segmented
      name="lomo-shape"
      label="Vignette shape"
      options={VIGNETTE_SHAPES}
      value={shape}
      disabled={editor.busy}
      onvalue={(next) => (shape = next)}
    />

    <SliderField
      id="lomo-intensity"
      label="Intensity"
      value={intensity}
      min={0}
      max={100}
      step={1}
      display="{intensity} %"
      disabled={editor.busy}
      onvalue={(next) => (intensity = next)}
    />

    <p class="tool-note">
      At 0 % only the vignette is left. Warmth is 0 at the middle of its slider.
    </p>
  </section>

  {#if previewError}
    <p class="tool-note warn">{previewError}</p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">The stage previews the look. Apply keeps it.</p>

    <Button variant="primary" size="lg" full data-tool="apply" disabled={locked} onclick={apply}>
      Apply lomo
    </Button>

    <Button variant="quiet" size="sm" full disabled={editor.busy} onclick={reset}>
      Reset
    </Button>
  </div>
</div>

<style>
  /* The curves are SVG paths rather than a canvas, so the picture scales with
     the panel and a point is a circle at a position rather than a dot painted
     at whatever the device pixel ratio happened to be. */
  .plot {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .curve {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    border: 1px solid var(--line-2);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }

  .grid {
    fill: none;
    stroke: rgba(198, 216, 222, 0.08);
    stroke-width: 1;
  }

  /* An untouched curve, for reading the point that means "no change". */
  .reference {
    fill: none;
    stroke: rgba(198, 216, 222, 0.22);
    stroke-width: 1;
    stroke-dasharray: 4 4;
  }

  .line {
    fill: none;
    stroke: var(--curve-colour);
    stroke-width: 1;
    stroke-linejoin: round;
    opacity: 0.32;
  }

  .line.active {
    stroke-width: 2;
    opacity: 1;
  }

  .dot {
    fill: var(--curve-colour);
    stroke: var(--surface-1);
    stroke-width: 1.5;
  }

  .plot-scale {
    display: flex;
    justify-content: space-between;
    margin: 0;
    font-size: var(--t-micro);
    color: var(--text-3);
  }

  .point {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--line-1);
  }

  .warn {
    color: var(--warning);
  }
</style>
