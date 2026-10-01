<script module>
  /**
   * The shared cache.
   *
   * Two things survive between renders and neither depends on the intensity:
   * the decoded source pixels, and the mapped result for the two colours.
   * Only moving a tone costs a pass, and moving back to a combination already
   * seen costs nothing at all, so Apply after a preview is instant.
   *
   * It is module level rather than component state because nothing renders
   * from it: writing pixels is not something Svelte needs to know about, and
   * it lets a tool switch and switch back avoid decoding the image again.
   *
   * `generation` is bumped by every invalidation, and a render compares the
   * generation it started with, so a slow preview cannot overwrite a newer
   * one or the committed image.
   */
  const cache = {
    generation: 0,
    /** Decoded source pixels, keyed on the source blob. */
    source: null,
    sourceKey: null,
    /** Source after the tone pass, keyed on the two colours and the intensity. */
    mapped: null,
    mappedKey: null,
  };

  /** Drop the source pixels and everything built from them. */
  function invalidateDerived() {
    cache.mapped = null;
    cache.mappedKey = null;
  }

  /** Called from the effect cleanup: on a new image, and on unmount. */
  function resetCache() {
    cache.generation += 1;
    cache.source = null;
    cache.sourceKey = null;
    invalidateDerived();
  }
</script>

<script>
  /**
   * Duotone.
   *
   * Every pixel is reduced to one number, its brightness, and that number is
   * looked up on a line running from the shadow colour to the highlight
   * colour. Intensity is the mix between that result and the original, so the
   * tool previews continuously instead of committing a guess.
   *
   * The pass itself is a lookup and three multiplies per pixel, which is far
   * cheaper than the decode before it, so the decoded frame is what gets
   * cached. The loop yields between row bands anyway, because a twelve
   * megapixel image is twelve million pixels and the main thread is shared
   * with the panel the operator is dragging a slider in.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { duotoneKey, duotonePixel, hexToRgb, normalizeHex } from "../core/duotonemath.js";
  import { context2d, createCanvas, encodeLike } from "../core/image.js";
  import { canvasToImageBlob, debounce, readPixels, sourceCanvas } from "../core/pixels.js";

  import Button from "../components/controls/Button.svelte";
  import ColorField from "../components/controls/ColorField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  /** Rows per band. Enough to amortise the yield, small enough to stay cheap. */
  const ROW_BAND = 48;
  /** Milliseconds of work before the thread is handed back to the browser. */
  const SLICE_MS = 12;

  const DEFAULTS = {
    shadow: "#1a0533",
    highlight: "#f7e733",
    intensity: 100,
  };

  /**
   * The legacy presets, unchanged. Six is enough to cover the moods a duotone
   * is usually reaching for, and every one of them is a starting point rather
   * than a look: the two colour fields are always editable underneath.
   */
  const PRESETS = [
    { name: "Spotify", shadow: "#1e003c", highlight: "#f5e642" },
    { name: "Noir", shadow: "#000000", highlight: "#ffffff" },
    { name: "Sunset", shadow: "#0d0221", highlight: "#ff6b35" },
    { name: "Ocean", shadow: "#0a0a2a", highlight: "#00f0ff" },
    { name: "Forest", shadow: "#0a1f0a", highlight: "#a8ff3e" },
    { name: "Rose Gold", shadow: "#1a0010", highlight: "#ffb6c1" },
  ];

  let shadow = $state(DEFAULTS.shadow);
  let highlight = $state(DEFAULTS.highlight);
  let intensity = $state(DEFAULTS.intensity);

  const source = $derived(editor.current);

  /** The two colours and the amount, in the shape the maths takes. */
  const settings = $derived({
    shadow: hexToRgb(shadow),
    highlight: hexToRgb(highlight),
    intensity: intensity / 100,
  });

  /**
   * The preset that still matches both fields, or null.
   *
   * Derived rather than stored, which is what keeps the two from disagreeing:
   * a preset is selected exactly while it describes what is on screen, so
   * editing a colour deselects it with no bookkeeping to forget, and setting
   * two colours from a preset selects it with no flag to set.
   */
  const activePreset = $derived(
    PRESETS.find((preset) => preset.shadow === shadow && preset.highlight === highlight) ?? null,
  );

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  /** True once a render has been overtaken by a newer one, or the tool left. */
  function superseded(generation, image) {
    return generation !== cache.generation || editor.current !== image;
  }

  /**
   * Hand the thread back, but only once enough time has gone by.
   *
   * Yielding on a fixed timer per band would add hundreds of milliseconds of
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

  /** Decode the source once per image. Null if the render was overtaken. */
  async function decodeSource(image, generation) {
    if (cache.source && cache.sourceKey === image.blob) return cache.source;

    const { ctx, canvas } = await sourceCanvas(image.blob, image.width, image.height);
    if (superseded(generation, image)) return null;

    const pixels = readPixels(ctx, canvas.width, canvas.height);
    cache.source = { width: canvas.width, height: canvas.height, data: pixels.data };
    cache.sourceKey = image.blob;
    // Anything mapped from the previous source describes a different image.
    invalidateDerived();
    return cache.source;
  }

  /** The tone pass over every pixel, reused while the settings hold. */
  async function mapPixels(px, image, generation, config, report) {
    const key = duotoneKey(config);
    if (cache.mapped && cache.mappedKey === key) return cache.mapped;

    report?.("Mapping tones", 0.5);

    const { width, height, data } = px;
    const out = new Uint8ClampedArray(data.length);
    // Two scratch arrays for the whole pass. The ramp and the result are the
    // same three numbers for every pixel, so allocating per pixel would be
    // the most expensive thing in the tool.
    const ramp = [0, 0, 0];
    const rgb = [0, 0, 0];
    const yieldIfDue = makeYielder();

    for (let y0 = 0; y0 < height; y0 += ROW_BAND) {
      const end = Math.min(height, y0 + ROW_BAND);

      for (let y = y0; y < end; y += 1) {
        const row = y * width;

        for (let x = 0; x < width; x += 1) {
          const i = (row + x) * 4;
          duotonePixel(data[i], data[i + 1], data[i + 2], config, ramp, rgb);

          out[i] = rgb[0];
          out[i + 1] = rgb[1];
          out[i + 2] = rgb[2];
          // Alpha is the shape of the picture, not part of its tone, so a
          // cut-out PNG keeps the transparency it arrived with.
          out[i + 3] = data[i + 3];
        }
      }

      if (superseded(generation, image)) return null;
      await yieldIfDue();
    }

    cache.mapped = { width, height, data: out };
    cache.mappedKey = key;
    return cache.mapped;
  }

  /**
   * The whole pipeline, reusing whatever the last render already built.
   * Returns finished pixels, or null if it was overtaken on the way.
   */
  async function renderPixels(image, generation, config, report) {
    const decoded = await decodeSource(image, generation);
    if (!decoded) return null;
    return mapPixels(decoded, image, generation, config, report);
  }

  /** Copy finished pixels onto a canvas so they can be encoded. */
  function toCanvas(pixels) {
    const canvas = createCanvas(pixels.width, pixels.height);
    context2d(canvas).putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
    return canvas;
  }

  // ---------------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------------

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
    const config = settings;
    const generation = cache.generation;
    editor.previewBusy = true;

    try {
      const pixels = await renderPixels(image, generation, config);
      if (!pixels) return;

      const blob = await canvasToImageBlob(toCanvas(pixels), image);
      // Bail if the operator moved on while we were working.
      if (run !== previewRun || editor.current !== image || generation !== cache.generation) return;

      await editor.setPreview(blob);
    } finally {
      // Only the newest run owns the flag: a superseded one that cleared it
      // would re-enable Apply while its replacement is still writing.
      if (run === previewRun) editor.previewBusy = false;
    }
  });

  $effect(() => {
    // The image is read only to be in scope, and deliberately untracked.
    // Depending on it would mean every commit re-runs a full-image pass to
    // reproduce the pixels this tool just wrote, leaving a redundant
    // "Preview" badge sitting on top of the committed image.
    untrack(() => editor.current);
    // Moving a control is the one thing that re-arms the preview after Apply.
    committedUrl = null;
    void shadow;
    void highlight;
    void intensity;
    recompute();
  });

  // A different image, or a different tool, means every cached buffer
  // describes something that is no longer on the stage. Cancelling the
  // pending render matters as much as dropping the cache: a preview that
  // fires after this tool has been left would land on the stage under
  // somebody else's controls.
  $effect(() => {
    if (!editor.current) return;
    return () => {
      recompute.cancel();
      resetCache();
    };
  });

  // Seed on activation, and whenever a genuinely new image arrives.
  // `editor.epoch` moves only on open and discard, never on a commit, so this
  // cannot fire for output this tool produced itself.
  $effect(() => {
    const active = editor.tool === "duotone";
    void editor.epoch;
    if (!active) return;
    committedUrl = null;
    untrack(() => {
      if (editor.current) recompute.flush();
    });
  });

  // ---------------------------------------------------------------------
  // Commit
  // ---------------------------------------------------------------------

  async function apply() {
    if (!source || locked) return;
    // Drop anything the run-up to this click queued, so no render is in flight
    // and the two cannot fight over the same cache slots.
    recompute.cancel();

    const image = source;
    const config = settings;

    await editor.run("Duotone", async (report) => {
      report("Decoding", 0.2);
      const pixels = await renderPixels(image, cache.generation, config, report);
      if (!pixels) throw new Error("That render was cancelled before it finished.");

      report("Encoding", 0.9);
      const blob = await encodeLike(toCanvas(pixels), image);
      await editor.commit(blob, "Duotone", image.name);
      // The committed frame is the result now. Leaving the preview on the
      // stage would show the previous image under identical-looking pixels,
      // and dropping the queued recompute stops one from landing on top.
      committedUrl = editor.current?.url ?? null;
      recompute.cancel();
      editor.clearPreview();
    });
  }

  function setShadow(next) {
    shadow = normalizeHex(next);
  }

  function setHighlight(next) {
    highlight = normalizeHex(next);
  }

  function usePreset(preset) {
    shadow = preset.shadow;
    highlight = preset.highlight;
  }

  function reset() {
    shadow = DEFAULTS.shadow;
    highlight = DEFAULTS.highlight;
    intensity = DEFAULTS.intensity;
  }

  /**
   * Apply is blocked while a preview is still moving.
   *
   * A preview render and a commit render share the same cache slots. Starting
   * a commit while a preview is mid-flight leaves one of the two awaiting a
   * promise the other abandoned, and the operation never settles. Beyond the
   * crash, "apply" during a moving preview is not a request anyone can mean.
   */
  const locked = $derived(editor.busy || editor.previewBusy || !source);
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Tones</span>

    <ColorField
      id="duotone-shadow"
      label="Shadows"
      value={shadow}
      disabled={locked}
      onvalue={setShadow}
    />

    <ColorField
      id="duotone-highlight"
      label="Highlights"
      value={highlight}
      disabled={locked}
      onvalue={setHighlight}
    />
  </section>

  <section class="tool-section">
    <SliderField
      id="duotone-intensity"
      label="Intensity"
      min={0}
      max={100}
      step={1}
      value={intensity}
      display="{intensity} %"
      disabled={locked}
      onvalue={(v) => (intensity = v)}
    />

    <p class="tool-note">At 0 % nothing changes. At 100 % every pixel is a tone.</p>
  </section>

  <section class="tool-section">
    <span class="micro-label">Presets</span>

    <div class="tool-chips">
      {#each PRESETS as preset (preset.name)}
        <button
          type="button"
          class="tool-chip"
          class:on={activePreset?.name === preset.name}
          disabled={locked}
          aria-pressed={activePreset?.name === preset.name}
          onclick={() => usePreset(preset)}
        >
          <span class="inner">
            <i class="half" style:background={preset.shadow}></i>
            <i class="half" style:background={preset.highlight}></i>
            <span class="name">{preset.name}</span>
          </span>
        </button>
      {/each}
    </div>
  </section>

  <div class="tool-actions">
    <p class="tool-note">The stage previews these tones. Apply to keep the result.</p>

    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={locked}
      onclick={apply}
    >
      Apply duotone
    </Button>

    <Button variant="quiet" size="sm" full disabled={locked} onclick={reset}>
      Reset settings
    </Button>
  </div>
</div>

<style>
  /* A chip holds one row: the two halves of the ramp, then its name. The
     single wrapper matters, because `.tool-chip` lays its children out as a
     grid and a bare text node would become a second row of its own. */
  .inner {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  .half {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    /* A hairline of light and dark, so a black or a white half still reads
       as a swatch on the chip. */
    box-shadow:
      inset 0 0 0 1px rgba(198, 216, 222, 0.35),
      0 0 0 1px rgba(0, 0, 0, 0.4);
  }
</style>
