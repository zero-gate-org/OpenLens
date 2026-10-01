<script>
  /**
   * Gradient map: the tonal range of an image, put onto a colour ramp.
   *
   * The arithmetic is in `core/ramp.js` and it runs in a worker. A pass is a
   * brightness per pixel, a lookup on a 256 entry table and one of four
   * blends, which is cheap per pixel and there are a great many pixels, so on
   * a twelve megapixel image dragging a stop along its ramp would otherwise
   * queue passes faster than the main thread can answer them. The worker is
   * created on the first pass and terminated when the tool is left, because
   * the panel is mounted fresh every time the tool is selected and an
   * orphaned worker would outlive it.
   *
   * The preview runs at half size on a large image, which is what the legacy
   * tool did and for the same reason: a full resolution pass is the only pass
   * this tool has, and one per control change is affordable, one per pixel per
   * second is not. Apply always runs at the full size of the source.
   *
   * The ramp is held in model space and shown in display space, and the two
   * differ by the reverse toggle. Mirroring is a pure function of the model
   * rather than an edit to it, so the toggle is a checkbox that can be turned
   * off again, and so a drag in a reversed ramp writes back through the same
   * mirror rather than through a second, contradictory copy of the truth.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { context2d, createCanvas } from "../core/image.js";
  import { canvasToImageBlob, debounce, sourceCanvas } from "../core/pixels.js";
  import { hexToRgb } from "../core/duotonemath.js";
  import {
    BLEND_MODES,
    DEFAULT_STOPS,
    MIN_STOPS,
    addStopAt,
    moveStop,
    removeStop,
    reverseStops,
    sortStops,
  } from "../core/ramp.js";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import ColorField from "../components/controls/ColorField.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
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

  /** How far one arrow press moves a focused stop, with and without Shift. */
  const NUDGE = 0.01;
  const NUDGE_FAST = 0.05;

  const DEFAULTS = {
    intensity: 100,
    blend: "replace",
    reversed: false,
  };

  /**
   * Starting looks.
   *
   * Each one is a complete ramp rather than the stops that happen to differ,
   * so a preset can be compared with the strip and matched exactly. The eight
   * are the legacy set, unchanged.
   */
  const PRESETS = [
    {
      name: "Sunset",
      stops: [
        { pos: 0, hex: "#0d0221" },
        { pos: 0.5, hex: "#ff6b35" },
        { pos: 1, hex: "#ffeb3b" },
      ],
    },
    {
      name: "Ocean",
      stops: [
        { pos: 0, hex: "#000428" },
        { pos: 0.6, hex: "#004e92" },
        { pos: 1, hex: "#a8edea" },
      ],
    },
    {
      name: "Forest",
      stops: [
        { pos: 0, hex: "#0a0a0a" },
        { pos: 0.4, hex: "#1b4332" },
        { pos: 1, hex: "#95d5b2" },
      ],
    },
    {
      name: "Infrared",
      stops: [
        { pos: 0, hex: "#000000" },
        { pos: 0.33, hex: "#ff0000" },
        { pos: 0.66, hex: "#ffff00" },
        { pos: 1, hex: "#ffffff" },
      ],
    },
    {
      name: "Gold",
      stops: [
        { pos: 0, hex: "#2c2c2c" },
        { pos: 0.3, hex: "#8b6914" },
        { pos: 0.6, hex: "#ffd700" },
        { pos: 1, hex: "#fffde7" },
      ],
    },
    {
      name: "Duotone",
      stops: [
        { pos: 0, hex: "#1e003c" },
        { pos: 1, hex: "#f5e642" },
      ],
    },
    {
      name: "Noir",
      stops: [
        { pos: 0, hex: "#000000" },
        { pos: 1, hex: "#ffffff" },
      ],
    },
    {
      name: "Sepia",
      stops: [
        { pos: 0, hex: "#1c0a00" },
        { pos: 0.5, hex: "#6b3a1f" },
        { pos: 1, hex: "#f0d9a0" },
      ],
    },
  ];

  let intensity = $state(DEFAULTS.intensity);
  let blend = $state(DEFAULTS.blend);
  let reversed = $state(DEFAULTS.reversed);
  let previewError = $state(null);

  /** Stops carry an id so selection survives a re-sort from a drag. */
  let nextId = 0;
  function withIds(list) {
    return list.map((stop) => ({ ...stop, id: `gm-${++nextId}` }));
  }

  /** Built once, before either piece of state exists, so both can seed from it. */
  const initialStops = withIds(DEFAULT_STOPS);

  let stops = $state(initialStops);
  /** Id of the stop the colour field and the position slider are editing. */
  let selectedId = $state(initialStops[0].id);
  /** The strip being dragged, or null. Never read for rendering decisions. */
  let draggingId = $state(null);

  const source = $derived(editor.current);

  /** The ramp in model space: always ascending, whatever the UI did. */
  const model = $derived(sortStops(stops));

  /** The ramp as the strip draws it, mirrored when reverse is on. */
  const shown = $derived(reversed ? reverseStops(model) : model);

  /** The stop the secondary controls are pointed at, or null. */
  const selected = $derived(shown.find((stop) => stop.id === selectedId) ?? null);

  /** Where the selected stop sits on the strip, 0..100 for the slider. */
  const selectedPercent = $derived(selected ? Math.round(selected.pos * 100) : 0);

  /** Same position to within a rounding step, for comparing ramps. */
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  /**
   * A preset is on exactly while its stops are the stops on the strip.
   *
   * Derived rather than stored, which is what keeps the two from disagreeing:
   * dragging a stop deselects the preset with no bookkeeping to forget, and
   * loading a preset selects it with no flag to set.
   */
  const activePreset = $derived(
    PRESETS.find(
      (preset) =>
        preset.stops.length === shown.length &&
        preset.stops.every((stop, i) => stop.hex === shown[i].hex && near(stop.pos, shown[i].pos)),
    )?.name ?? null,
  );

  /**
   * Every control, as one string.
   *
   * The preview effect depends on this rather than on a list of `void` reads,
   * so a control cannot be added and then forgotten. The image is deliberately
   * not in it: see the control effect for why.
   */
  const controlKey = $derived([
    reversed ? "rev" : "fwd",
    shown.map((stop) => `${stop.pos.toFixed(4)}${stop.hex}`).join(","),
    intensity,
    blend,
  ].join("|"));

  /**
   * The control state in the shape the renderer wants.
   *
   * Read once at the top of a pass so a frame is always a consistent read of
   * one set of values rather than of whatever the controls held by the time
   * the last await returned.
   *
   * @returns {import("../core/ramp.js").RampOptions}
   */
  function params() {
    return {
      // Plain `{pos, hex}` pairs: the id is panel bookkeeping and has no
      // business crossing into a worker message.
      stops: shown.map(({ pos, hex }) => ({ pos, hex })),
      intensity: intensity / 100,
      blend: /** @type {import("../core/ramp.js").BlendMode} */ (blend),
    };
  }

  // -------------------------------------------------------------------
  // Stop editing
  // -------------------------------------------------------------------

  /**
   * The model position of a stop the strip shows at `pos`.
   *
   * The mirror is the same function in both directions, which is what makes
   * the reverse toggle a view rather than an edit: a drag in a reversed ramp
   * is written back through it and lands where the handle was dropped.
   *
   * @param {number} pos 0..1, as displayed
   * @returns {number} 0..1, in the model
   */
  function toModelPos(pos) {
    return reversed ? 1 - pos : pos;
  }

  /**
   * The index a displayed stop occupies in the model list.
   *
   * The mirror reverses the order as well as the positions, so the index is
   * counted from the other end too.
   *
   * @param {number} index as displayed
   * @returns {number}
   */
  function toModelIndex(index) {
    return reversed ? model.length - 1 - index : index;
  }

  /** Put one stop at a displayed position, keeping the model ascending. */
  function placeStop(id, pos) {
    const index = shown.findIndex((stop) => stop.id === id);
    if (index < 0) return;
    stops = moveStop(stops, toModelIndex(index), toModelPos(pos));
  }

  function selectStop(id) {
    selectedId = id;
  }

  /**
   * Add a stop at a position, coloured to match the ramp.
   *
   * The new stop is selected afterwards, because a stop that appears with the
   * colour already on the ramp is invisible until it is edited, and an
   * invisible control that cannot be found is the worst kind.
   *
   * @param {number} pos 0..1, as displayed
   */
  function addAt(pos) {
    const at = Math.max(0, Math.min(1, pos));
    const target = toModelPos(at);
    const id = `gm-${++nextId}`;
    // The id is minted here and handed to the core, so the stop that comes
    // back can be found by id rather than guessed at by position.
    const next = addStopAt(stops, target, id);
    stops = next;
    selectedId = next.some((stop) => stop.id === id) ? id : selectedId;
  }

  /**
   * Drop the selected stop, unless doing so would leave fewer than two.
   *
   * The minimum is enforced by the core rather than by this button's disabled
   * state, because the keyboard can ask for the same thing and the button
   * being greyed is not a rule.
   */
  function removeSelected() {
    if (!selected || model.length <= MIN_STOPS) return;
    const index = toModelIndex(shown.indexOf(selected));
    const id = selected.id;
    const next = removeStop(stops, index);
    if (next.length === model.length) return;
    stops = next;

    // Selection has to land somewhere real: the neighbour that took the place,
    // or the last stop if this was the last one.
    const remaining = sortStops(next);
    if (!remaining.some((stop) => stop.id === id)) {
      selectedId = remaining[Math.min(Math.max(0, index), remaining.length - 1)].id;
    }
  }

  function setSelectedColour(hex) {
    if (!selected) return;
    const id = selected.id;
    stops = stops.map((stop) => (stop.id === id ? { ...stop, hex } : stop));
  }

  function nudgeSelected(pos) {
    if (!selected) return;
    placeStop(selected.id, pos);
  }

  // -------------------------------------------------------------------
  // The ramp strip
  // -------------------------------------------------------------------

  let trackEl = $state(null);

  /** Where the pointer is along the track, 0..1. */
  function posFromPointer(event) {
    const rect = trackEl?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  }

  function onStopDown(event, id) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    draggingId = id;
    selectStop(id);
    placeStop(id, posFromPointer(event));
  }

  function onStopMove(event) {
    if (!draggingId) return;
    event.preventDefault();
    placeStop(draggingId, posFromPointer(event));
  }

  function onStopUp(event) {
    if (!draggingId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    draggingId = null;
  }

  /** Clicking the bare track, away from any handle, adds a stop there. */
  function onTrackDown(event) {
    if (draggingId) return;
    addAt(posFromPointer(event));
  }

  /**
   * Left and right move the focused stop, which is how a ramp is reordered
   * from the keyboard: move one past its neighbour and the two swap.
   */
  function onStopKey(event, id) {
    const stop = shown.find((entry) => entry.id === id);
    if (!stop) return;

    const step = event.shiftKey ? NUDGE_FAST : NUDGE;
    let next = stop.pos;
    if (event.key === "ArrowLeft") next = stop.pos - step;
    else if (event.key === "ArrowRight") next = stop.pos + step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      selectedId = id;
      removeSelected();
      return;
    } else return;

    event.preventDefault();
    selectStop(id);
    placeStop(id, Math.max(0, Math.min(1, next)));
  }

  /**
   * A colour, named.
   *
   * A stop carries its hex in the readout below the strip, but the handle
   * itself has no room for text, so it needs a name a screen reader can say.
   *
   * @param {string} hex
   * @returns {string}
   */
  function colourName(hex) {
    const { r, g, b } = hexToRgb(hex);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const spread = max - min;
    const light = (max + min) / 2;

    if (spread < 16) {
      if (light < 32) return "black";
      if (light > 224) return "white";
      return "grey";
    }

    let hue;
    if (max === r) hue = ((g - b) / spread) % 6;
    else if (max === g) hue = (b - r) / spread + 2;
    else hue = (r - g) / spread + 4;

    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;

    if (hue < 15 || hue >= 345) return "red";
    if (hue < 45) return "orange";
    if (hue < 70) return "yellow";
    if (hue < 160) return "green";
    if (hue < 200) return "teal";
    if (hue < 255) return "blue";
    if (hue < 290) return "purple";
    return "pink";
  }

  /** A CSS gradient for the strip, and for a preset chip's swatch. */
  function rampCss(list) {
    const parts = list.map((stop) => `${stop.hex} ${(stop.pos * 100).toFixed(2)}%`);
    return `linear-gradient(90deg, ${parts.join(", ")})`;
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
   * @returns {Promise<import("../core/ramp.js").Pixels | null>}
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
   * answer to a different one, which is the failure mode a stop drag gets into
   * when it queues passes faster than a large image can answer them.
   *
   * @returns {Worker}
   */
  function rampWorker() {
    if (worker) return worker;

    const created = new Worker(new URL("../workers/gradient-map-worker.js", import.meta.url), {
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
      failPending(event.message || "The gradient map pass could not run.");
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
   * @param {{width: number, height: number, data: Uint8ClampedArray}} pixels
   * @param {import("../core/ramp.js").RampOptions} options
   * @returns {Promise<import("../core/ramp.js").Pixels | null>}
   */
  function runRamp(pixels, options) {
    const id = ++nextJob;
    return new Promise((resolve, reject) => {
      // The view is copied at its own offset and length rather than by handing
      // over the whole buffer, so a frame whose array happens to be a window
      // onto a larger one is not sent with padding the worker would read as
      // pixels.
      const { byteOffset, byteLength } = pixels.data;
      const buffer = pixels.data.buffer.slice(byteOffset, byteOffset + byteLength);
      pending.set(id, { id, resolve, reject });
      rampWorker().postMessage({ id, width: pixels.width, height: pixels.height, buffer, options }, [
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

      const out = await runRamp(pixels, options);
      if (!out || isStale()) return;

      const blob = await canvasToImageBlob(toCanvas(out), image);
      if (isStale()) return;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      if (!isStale()) previewError = "The gradient map pass could not run. Try Apply again.";
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
    const active = editor.tool === "gradientmap";
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
    stops = withIds(preset.stops);
    selectedId = stops[0].id;
  }

  function reset() {
    stops = withIds(DEFAULT_STOPS);
    selectedId = stops[0].id;
    intensity = DEFAULTS.intensity;
    blend = DEFAULTS.blend;
    reversed = DEFAULTS.reversed;
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
  const locked = $derived(editor.busy || editor.previewBusy || !source);

  async function apply() {
    // Drop anything the run-up to this click queued, so no pass is in flight.
    recompute.cancel();

    if (!source || locked) return;

    const image = source;
    const options = params();

    await editor.run("Gradient map", async (report) => {
      report("Decoding", 0.15);
      const pixels = await fullPixels(image);

      report("Mapping tones", 0.45);
      const out = await runRamp(pixels, options);
      if (!out) throw new Error("The gradient map pass was interrupted. Try again.");

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(toCanvas(out), image);
      await editor.commit(blob, "Gradient map", image.name);

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
    <span class="micro-label">Ramp</span>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="strip"
      bind:this={trackEl}
      style:background={rampCss(shown)}
      onpointerdown={onTrackDown}
    >
      {#each shown as stop, index (stop.id)}
        <button
          type="button"
          class="stop"
          class:selected={stop.id === selectedId}
          class:dragging={stop.id === draggingId}
          style:left="{(stop.pos * 100).toFixed(3)}%"
          style:--stop-colour={stop.hex}
          aria-label="Stop {index + 1}, {colourName(stop.hex)}"
          title="Stop {index + 1}, {colourName(stop.hex)}, at {Math.round(stop.pos * 100)} %"
          disabled={editor.busy}
          onpointerdown={(event) => onStopDown(event, stop.id)}
          onpointermove={onStopMove}
          onpointerup={onStopUp}
          onpointercancel={onStopUp}
          onkeydown={(event) => onStopKey(event, stop.id)}
        >
          <span class="dot" aria-hidden="true"></span>
        </button>
      {/each}
    </div>

    <div class="scale" aria-hidden="true"><span>Shadows</span><span>Highlights</span></div>

    <p class="tool-note">
      Click the ramp to add a stop, drag one to move it, or focus one and use the arrow keys. Two
      stops is the fewest a ramp can have.
    </p>
  </section>

  <section class="tool-section">
    <ColorField
      id="gradientmap-colour"
      label="Stop colour"
      value={selected?.hex ?? "#000000"}
      disabled={editor.busy || !selected}
      onvalue={setSelectedColour}
    />

    <SliderField
      id="gradientmap-position"
      label="Stop position"
      value={selectedPercent}
      min={0}
      max={100}
      step={1}
      display="{selectedPercent} %"
      disabled={editor.busy || !selected}
      onvalue={(next) => nudgeSelected(next / 100)}
    />

    <div class="tool-row">
      <Button
        variant="secondary"
        size="md"
        full
        disabled={editor.busy}
        onclick={() => addAt(0.5)}
        title="Add a stop in the middle of the ramp"
      >
        Add stop
      </Button>

      <Button
        variant="secondary"
        size="md"
        full
        disabled={editor.busy || !selected || model.length <= MIN_STOPS}
        onclick={removeSelected}
        title={model.length <= MIN_STOPS
          ? "Two stops is the fewest a ramp can have"
          : "Remove the selected stop"}
      >
        Remove stop
      </Button>
    </div>

    <div class="tool-result">
      <span>Selected</span>
      <strong>
        {selected
          ? `Stop ${shown.indexOf(selected) + 1}, ${colourName(selected.hex)} at ${selectedPercent} %`
          : "No stop selected"}
      </strong>
    </div>
  </section>

  <section class="tool-section">
    <SliderField
      id="gradientmap-intensity"
      label="Intensity"
      value={intensity}
      min={0}
      max={100}
      step={1}
      display="{intensity} %"
      disabled={editor.busy}
      onvalue={(next) => (intensity = next)}
    />

    <SelectField
      id="gradientmap-blend"
      label="Blend"
      value={blend}
      options={BLEND_MODES}
      disabled={editor.busy}
      onvalue={(next) => (blend = next)}
      hint="Replace puts the ramp colour down. Luminosity moves the tone only, Colour takes the ramp's hue over the original lightness, Multiply darkens with the ramp."
    />

    <CheckField
      id="gradientmap-reverse"
      label="Reverse the ramp"
      bind:checked={reversed}
      disabled={editor.busy}
      hint="Swaps which end of the ramp the shadows land on."
    />

    <p class="tool-note">At 0 % nothing changes. At 100 % every pixel is a tone.</p>
  </section>

  <section class="tool-section">
    <span class="micro-label">Presets</span>

    <div class="tool-chips">
      {#each PRESETS as preset (preset.name)}
        <button
          type="button"
          class="tool-chip chip"
          class:on={activePreset === preset.name}
          aria-pressed={activePreset === preset.name}
          disabled={editor.busy}
          onclick={() => usePreset(preset)}
        >
          <span class="swatch" style:background={rampCss(preset.stops)} aria-hidden="true"></span>
          {preset.name}
        </button>
      {/each}
    </div>
  </section>

  {#if previewError}
    <p class="tool-note warn">{previewError}</p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">The stage previews the ramp. Apply keeps it.</p>

    <Button variant="primary" size="lg" full data-tool="apply" disabled={locked} onclick={apply}>
      Apply gradient map
    </Button>

    <Button variant="quiet" size="sm" full disabled={editor.busy} onclick={reset}>
      Reset
    </Button>
  </div>
</div>

<style>
  /* The strip is a plain box with handles laid over it in CSS pixels. No
     canvas: the ramp is a handful of stops, and a canvas would make the
     handles' positions depend on a device pixel ratio rather than on the
     track the operator can see. */
  .strip {
    position: relative;
    height: 32px;
    border: 1px solid var(--line-2);
    border-radius: var(--r-md);
    /* A hairline of dark and a hairline of light, so a white or a black stop
       still reads as sitting on the strip rather than in a hole in it. */
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, 0.45),
      inset 0 0 0 2px rgba(198, 216, 222, 0.14);
    touch-action: none;
    cursor: copy;
  }

  .scale {
    display: flex;
    justify-content: space-between;
    font-size: var(--t-micro);
    color: var(--text-3);
  }

  /* A handle is a ring around a dot of the stop's own colour, so which stop
     is which is visible without reading anything. */
  .stop {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    display: grid;
    place-items: center;
    width: 18px;
    height: 22px;
    padding: 0;
    border: 0;
    background: none;
    cursor: grab;
    touch-action: none;
  }

  .stop:disabled {
    cursor: not-allowed;
  }

  .stop.dragging {
    cursor: grabbing;
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--stop-colour);
    box-shadow:
      0 0 0 2px var(--surface-1),
      0 0 0 3px rgba(198, 216, 222, 0.4);
    transition: box-shadow var(--dur-1) var(--ease);
  }

  .stop:hover .dot,
  .stop.selected .dot {
    box-shadow:
      0 0 0 2px var(--surface-1),
      0 0 0 3px var(--accent);
  }

  .stop:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-radius: var(--r-xs);
  }

  /* `.tool-chip` is an inline-grid, which would stack the swatch above the
     name. These chips need the swatch beside the label. */
  .chip {
    display: inline-flex;
    align-items: center;
  }

  .swatch {
    width: 26px;
    height: 10px;
    margin-right: var(--s-2);
    border: 1px solid rgba(0, 0, 0, 0.45);
    border-radius: 3px;
  }

  .warn {
    color: var(--warning);
  }
</style>
