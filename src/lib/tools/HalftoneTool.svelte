<script>
  /**
   * Halftone: a print-style dot screen.
   *
   * The sampling maths is all in `core/halftone.js`, which was written to run
   * in plain Node so it could be unit tested without a canvas. This file is
   * the panel, the caching, and the live preview.
   *
   * Two things about this tool that are easy to get wrong:
   *
   *  - In CMYK mode the four process inks are subtractive, so the paper colour
   *    is part of the colour and the dot/background pickers are meaningless.
   *    The core already forces white paper there; the panel hides the controls
   *    so it does not offer a setting that cannot take effect.
   *  - The screen angle is meaningless in CMYK too, because each ink sits on its
   *    own fixed angle. Same reasoning, same treatment.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { renderHalftone } from "../core/halftone.js";
  import { canvasToImageBlob, debounce, sourceCanvas } from "../core/pixels.js";

  import Button from "../components/controls/Button.svelte";
  import ColorField from "../components/controls/ColorField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const MODES = [
    { value: "grayscale", label: "Grayscale" },
    { value: "cmyk", label: "CMYK" },
  ];

  const SHAPES = [
    { value: "circle", label: "Circle" },
    { value: "square", label: "Square" },
    { value: "line", label: "Line" },
  ];

  const PRESETS = [
    { name: "Newspaper", mode: "grayscale", cell: 8, dot: "#000000", bg: "#ffffff", shape: "circle", angle: 0 },
    { name: "Comic Book", mode: "grayscale", cell: 6, dot: "#1a1a4e", bg: "#fffde7", shape: "circle", angle: 0 },
    { name: "CMYK Print", mode: "cmyk", cell: 10, dot: "#000000", bg: "#ffffff", shape: "circle", angle: 0 },
    { name: "Risograph", mode: "grayscale", cell: 12, dot: "#c0392b", bg: "#fdf6e3", shape: "circle", angle: 0 },
  ];

  const DEFAULTS = {
    mode: "grayscale",
    cell: 10,
    dot: "#000000",
    bg: "#ffffff",
    shape: "circle",
    angle: 0,
  };

  let mode = $state(DEFAULTS.mode);
  let cell = $state(DEFAULTS.cell);
  let dot = $state(DEFAULTS.dot);
  let bg = $state(DEFAULTS.bg);
  let shape = $state(DEFAULTS.shape);
  let angle = $state(DEFAULTS.angle);
  let previewError = $state(null);

  const source = $derived(editor.current);
  const cmyk = $derived(mode === "cmyk");

  /**
   * The URL of the image this tool last committed, or null.
   *
   * A preview computed from it is indistinguishable from the committed image,
   * so it is suppressed until a control changes. This also covers a queued
   * recompute: a debounce that fires just after Apply would otherwise rebuild
   * the image we already wrote and park a "Preview" badge on top of it.
   */
  let committedUrl = $state(null);

  /** Decoded source pixels, reused across every control change. */
  let cache = { url: null, pixels: null, generation: 0 };
  let previewRun = 0;

  /**
   * The control state in the shape the renderer wants.
   *
   * `$state` widens a string to `string`, and the renderer's parameter type is
   * a narrow union, so the literals are asserted here once instead of at both
   * call sites.
   *
   * @returns {{mode: "grayscale" | "cmyk", cellSize: number, dotColor: string,
   *   bgColor: string, shape: "circle" | "square" | "line", angle: number}}
   */
  function params() {
    return {
      mode: /** @type {"grayscale" | "cmyk"} */ (mode),
      cellSize: cell,
      dotColor: dot,
      bgColor: bg,
      shape: /** @type {"circle" | "square" | "line"} */ (shape),
      angle,
    };
  }

  const paramsKey = $derived(
    cmyk
      ? `cmyk|${cell}`
      : `${cell}|${dot}|${bg}|${shape}|${angle}`,
  );

  async function sourcePixels(image, generation) {
    if (cache.url === image.url && cache.pixels) return cache.pixels;
    const { ctx } = await sourceCanvas(image.blob, image.width, image.height);
    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    if (generation !== cache.generation) return null;
    cache = { url: image.url, pixels, generation };
    return pixels;
  }

  const recompute = debounce(async () => {
    const image = editor.current;
    if (!image || (committedUrl && image.url === committedUrl)) {
      editor.clearPreview();
      return;
    }

    const run = ++previewRun;
    const generation = cache.generation;
    const isStale = () => run !== previewRun || generation !== cache.generation;
    const key = paramsKey;

    editor.previewBusy = true;
    previewError = null;

    try {
      const pixels = await sourcePixels(image, generation);
      if (!pixels || isStale()) return;

      const out = await renderHalftone(pixels, params(), {
        isCancelled: isStale,
      });
      if (!out || isStale()) return;

      const blob = await canvasToImageBlob(toCanvas(out), image);
      if (isStale()) return;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      if (!isStale()) {
        previewError = "The halftone preview could not be built. Try a larger grid.";
      }
    } finally {
      if (run === previewRun) editor.previewBusy = false;
    }
  });

  function toCanvas(pixels) {
    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const ctx = canvas.getContext("2d");
    const out = ctx.createImageData(pixels.width, pixels.height);
    out.data.set(pixels.data);
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  // Control changes recompute.
  $effect(() => {
    // The image is read only to be in scope, and deliberately untracked.
    // Depending on it would mean every commit re-runs a full-image pass to
    // reproduce the pixels this tool just wrote, leaving a redundant
    // "Preview" badge sitting on top of the committed image.
    untrack(() => editor.current);
    void cell;
    void dot;
    void bg;
    void shape;
    void angle;
    void mode;
    // Moving a control is the one thing that re-arms the preview after Apply.
    committedUrl = null;
    recompute();
  });

  // A different image, or a different tool, means every cached buffer
  // describes something that is no longer on the stage.
  $effect(() => {
    const key = `${editor.current?.url ?? ""}|${editor.tool}`;
    return () => {
      recompute.cancel();
      cache = { url: null, pixels: null, generation: cache.generation + 1 };
    };
  });

  // Seed on activation, and whenever a genuinely new image arrives.
  // `editor.epoch` moves only on open and discard, never on a commit, so this
  // cannot fire for output this tool produced itself.
  $effect(() => {
    const active = editor.tool === "halftone";
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

  const activePreset = $derived(
    PRESETS.findIndex((preset) => matches(preset)) === -1 ? -1 : PRESETS.findIndex((preset) => matches(preset)),
  );

  function matches(preset) {
    if (preset.mode !== mode) return false;
    if (preset.cell !== cell || preset.shape !== shape) return false;
    // CMYK fixes paper and angle, so those parts of a preset cannot differ.
    if (cmyk) return true;
    return preset.dot === dot && preset.bg === bg && preset.angle === angle;
  }

  function applyPreset(preset) {
    mode = preset.mode;
    cell = preset.cell;
    dot = preset.dot;
    bg = preset.bg;
    shape = preset.shape;
    angle = preset.angle;
  }

  function reset() {
    mode = DEFAULTS.mode;
    cell = DEFAULTS.cell;
    dot = DEFAULTS.dot;
    bg = DEFAULTS.bg;
    shape = DEFAULTS.shape;
    angle = DEFAULTS.angle;
  }

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  const locked = $derived(editor.busy || editor.previewBusy || !source);

  async function apply() {
    if (!source || locked) return;
    // Drop anything the run-up to this click queued, so no render is in flight
    // and the two cannot fight over the same cache.
    recompute.cancel();

    const image = source;

    await editor.run("Halftone", async (report) => {
      report("Decoding", 0.15);
      const generation = cache.generation;
      const pixels = await sourcePixels(image, generation);
      if (!pixels) throw new Error("The image could not be prepared.");

      report("Printing the screen", 0.45);
      const out = await renderHalftone(pixels, params(), {
        onProgress: (ratio) => report("Printing the screen", 0.45 + ratio * 0.4),
      });
      if (!out) throw new Error("The halftone pass was interrupted. Try again.");

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(toCanvas(out), image);
      await editor.commit(blob, "Halftone", image.name);

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
      name="halftone-mode"
      options={MODES}
      value={mode}
      disabled={editor.busy}
      onvalue={(next) => (mode = next)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Screen</span>
    <SliderField
      id="halftone-cell"
      label="Grid size"
      value={cell}
      min={4}
      max={30}
      step={1}
      display="{cell} px"
      disabled={editor.busy}
      onvalue={(v) => (cell = Number(v))}
    />
  </section>

  {#if !cmyk}
    <section class="tool-section">
      <div class="tool-row">
        <ColorField id="halftone-dot" label="Ink" value={dot} disabled={editor.busy} onvalue={(v) => (dot = v)} />
        <ColorField id="halftone-bg" label="Paper" value={bg} disabled={editor.busy} onvalue={(v) => (bg = v)} />
      </div>
    </section>

    <section class="tool-section">
      <SliderField
        id="halftone-angle"
        label="Grid angle"
        value={angle}
        min={0}
        max={90}
        step={1}
        display="{angle}°"
        disabled={editor.busy}
        onvalue={(v) => (angle = Number(v))}
      />
    </section>
  {/if}

  <section class="tool-section">
    <span class="micro-label">Dot shape</span>
    <Segmented
      name="halftone-shape"
      columns={3}
      options={SHAPES}
      value={shape}
      disabled={editor.busy}
      onvalue={(next) => (shape = next)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Presets</span>
    <div class="tool-chips">
      {#each PRESETS as preset (preset.name)}
        <button
          type="button"
          class="tool-chip"
          class:on={activePreset === PRESETS.indexOf(preset)}
          disabled={editor.busy}
          onclick={() => applyPreset(preset)}
        >
          <span class="swatch" style:background={preset.bg} aria-hidden="true">
            <i style:background={preset.dot}></i>
          </span>
          {preset.name}
        </button>
      {/each}
    </div>
  </section>

  {#if cmyk}
    <p class="tool-note">
      CMYK prints with subtractive ink, so the paper colour and screen angle are
      fixed: each ink sits on its own angle.
    </p>
  {/if}

  {#if previewError}
    <p class="tool-note warn">{previewError}</p>
  {/if}

  <div class="tool-actions">
    <Button variant="primary" size="lg" full data-tool="apply" disabled={locked} onclick={apply}>
      Apply halftone
    </Button>

    <Button variant="quiet" size="sm" full disabled={editor.busy} onclick={reset}>
      Reset
    </Button>
  </div>
</div>

<style>
  /* The link and the paper swatch sit together so a preset reads as a colour
     pairing rather than as a word. */
  .swatch {
    display: inline-grid;
    place-items: center;
    width: 12px;
    height: 12px;
    margin-right: 2px;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35);
    vertical-align: -1px;
  }

  .swatch i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }

  .warn {
    color: var(--warning);
  }
</style>
