<script module>
  /**
   * The shared cache.
   *
   * A slider drag recomputes the same three stages over and over: decode,
   * colour, blur. Decoding does not depend on any slider, and the blur
   * depends only on its radius, so both survive between renders and only the
   * composite is redone. Nothing else needs this object, which is why it is
   * module level rather than component state: it outlives a mount so
   * switching tools and back does not decode the image again.
   *
   * Every entry is a full copy of the pixels, so the maps are capped. Two
   * radii plus one composite keeps a twelve megapixel image to five buffers.
   */
  const cache = {
    /**
     * Bumped whenever the cached buffers stop describing what is on the
     * stage. A render compares the generation it started with and throws
     * itself away if it no longer matches, which is how a slow preview
     * cannot overwrite a newer one.
     */
    generation: 0,

    /** Decoded source pixels, keyed on the source blob. */
    source: null,
    sourceKey: null,

    /** Source after the colour pass, keyed on the five colour settings. */
    toned: null,
    tonedKey: null,

    /**
     * Blurred pixels, keyed on radius alone. Moving the focus band does not
     * change a single blurred pixel, so dragging position and transition
     * width never re-runs the blur.
     */
    blurred: new Map(),

    /**
     * Finished pixels, keyed on the radius plus the two band settings, so
     * returning to a combination already seen costs nothing.
     */
    composite: null,
    compositeKey: null,
  };

  /** Drop everything derived from the source pixels. */
  function invalidateDerived() {
    cache.toned = null;
    cache.tonedKey = null;
    cache.blurred.clear();
    cache.composite = null;
    cache.compositeKey = null;
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
   * Tilt-shift.
   *
   * A horizontal band of the frame stays sharp and everything above and below
   * it ramps into a Gaussian blur. That alone is only a defocus; it is the
   * colour pass (vibrance, saturation, brightness, contrast, vignette) that
   * makes the result read as a scale model rather than as a bad photo, so the
   * two live side by side rather than as separate tools.
   *
   * Every slider previews onto the stage. The blur is the shared separable
   * kernel, and the row loops below it yield so the page keeps painting.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { gaussianBlur } from "../core/gaussian.js";
  import { canvasToImageBlob, debounce, readPixels, sourceCanvas } from "../core/pixels.js";
  import { context2d, createCanvas, encodeLike } from "../core/image.js";
  import { bandGeometry, bandRamp, toneKey, tonePixel, vignetteFalloff } from "../core/tiltmath.js";

  import Button from "../components/controls/Button.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  /** Rows per band. Enough to amortise the yield, small enough to stay cheap. */
  const ROW_BAND = 48;
  /** Full image copies kept per blur radius. Memory, not speed, is the limit. */
  const MAX_BLUR_ENTRIES = 2;
  /** Milliseconds of work before the thread is handed back to the browser. */
  const SLICE_MS = 12;

  const DEFAULTS = {
    blurRadius: 15,
    focusPosition: 50,
    transitionWidth: 20,
    vibrance: 140,
    saturation: 190,
    brightness: 105,
    contrast: 140,
    vignette: 25,
  };

  let blurRadius = $state(DEFAULTS.blurRadius);
  let focusPosition = $state(DEFAULTS.focusPosition);
  let transitionWidth = $state(DEFAULTS.transitionWidth);
  let vibrance = $state(DEFAULTS.vibrance);
  let saturation = $state(DEFAULTS.saturation);
  let brightness = $state(DEFAULTS.brightness);
  let contrast = $state(DEFAULTS.contrast);
  let vignette = $state(DEFAULTS.vignette);

  const source = $derived(editor.current);

  /** The three settings that move the band. */
  const band = $derived({ blurRadius, focusPosition, transitionWidth });

  /** The five colour settings, as the fractions the maths uses. */
  const tone = $derived({
    vibrance: vibrance / 100,
    saturation: saturation / 100,
    brightness: brightness / 100,
    contrast: contrast / 100,
    vignette: vignette / 100,
  });

  /** What the band occupies in real pixels, for the readout. */
  const bandReadout = $derived.by(() => {
    if (!source) return null;
    const geometry = bandGeometry(source.height, focusPosition, transitionWidth);
    return {
      centre: Math.round(geometry.focus),
      height: Math.round(geometry.bottom - geometry.top),
    };
  });

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
   * Yielding on a fixed timer per band would add a few hundred milliseconds
   * of pure waiting on a large image, so bands are timed instead: work runs
   * on until a slice of real time has passed, then yields exactly once.
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
    invalidateDerived();
    return cache.source;
  }

  /** Colour pass over every pixel, reused while the colour settings hold. */
  async function tonePixels(px, image, generation, report) {
    const key = toneKey(tone);
    if (cache.toned && cache.tonedKey === key) return cache.toned;

    report?.("Colour pass", 0.35);

    const { width, height, data } = px;
    const out = new Uint8ClampedArray(data.length);
    const hsl = [0, 0, 0];
    const rgb = [0, 0, 0];

    const cx = width / 2;
    const cy = height / 2;
    const maxDistance = Math.sqrt(cx * cx + cy * cy);
    const yieldIfDue = makeYielder();

    for (let y0 = 0; y0 < height; y0 += ROW_BAND) {
      const end = Math.min(height, y0 + ROW_BAND);

      for (let y = y0; y < end; y += 1) {
        // The same for every pixel in a row, so it is computed once.
        const dy = y - cy;
        const row = y * width;

        for (let x = 0; x < width; x += 1) {
          const i = (row + x) * 4;
          const falloff = vignetteFalloff(x - cx, dy, maxDistance, tone.vignette);

          tonePixel(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, tone, falloff, hsl, rgb);

          // A clamped array does the clamping and the rounding for us.
          out[i] = rgb[0] * 255;
          out[i + 1] = rgb[1] * 255;
          out[i + 2] = rgb[2] * 255;
          out[i + 3] = data[i + 3];
        }
      }

      if (superseded(generation, image)) return null;
      await yieldIfDue();
    }

    // A new colour pass invalidates everything built on top of it.
    invalidateDerived();
    cache.toned = { width, height, data: out };
    cache.tonedKey = key;
    return cache.toned;
  }

  /** One blur pass, reused while the radius holds. Null if cancelled. */
  async function blurPixels(px, image, generation, report) {
    const radius = band.blurRadius;
    const existing = cache.blurred.get(radius);
    if (existing) return existing;

    // The shared kernel hands the thread back between row bands itself, and
    // takes the same cancellation check the loops below make.
    const blurred = await gaussianBlur(px, radius, {
      isCancelled: () => superseded(generation, image),
      onProgress: (ratio) => report?.("Blurring", 0.4 + ratio * 0.35),
    });
    if (!blurred || superseded(generation, image)) return null;

    // A Map iterates in insertion order, so this drops the oldest radius.
    while (cache.blurred.size >= MAX_BLUR_ENTRIES) {
      cache.blurred.delete(cache.blurred.keys().next().value);
    }
    cache.blurred.set(radius, blurred);
    return blurred;
  }

  /** Mix the sharp and blurred versions along the band ramp. */
  async function compositePixels(sharp, blurred, px, image, generation, report) {
    const key = `${toneKey(tone)}|${band.blurRadius}|${band.focusPosition}|${band.transitionWidth}`;
    if (cache.composite && cache.compositeKey === key) return cache.composite;

    report?.("Compositing", 0.8);

    const { width, height } = px;
    const ramp = bandRamp(height, band.focusPosition, band.transitionWidth);
    const out = new Uint8ClampedArray(sharp.data.length);
    const yieldIfDue = makeYielder();

    for (let y0 = 0; y0 < height; y0 += ROW_BAND) {
      const end = Math.min(height, y0 + ROW_BAND);

      for (let y = y0; y < end; y += 1) {
        const sharpWeight = ramp[y];
        const blurWeight = 1 - sharpWeight;
        const row = y * width;

        for (let x = 0; x < width; x += 1) {
          const i = (row + x) * 4;
          out[i] = sharp.data[i] * sharpWeight + blurred.data[i] * blurWeight;
          out[i + 1] = sharp.data[i + 1] * sharpWeight + blurred.data[i + 1] * blurWeight;
          out[i + 2] = sharp.data[i + 2] * sharpWeight + blurred.data[i + 2] * blurWeight;
          // Blurring alpha as well would fringe the blurred edges.
          out[i + 3] = sharp.data[i + 3];
        }
      }

      if (superseded(generation, image)) return null;
      await yieldIfDue();
    }

    cache.composite = { width, height, data: out };
    cache.compositeKey = key;
    return cache.composite;
  }

  /**
   * The whole pipeline, reusing whatever the last render already built.
   * Returns finished pixels, or null if it was overtaken on the way.
   */
  async function renderPixels(image, generation, report) {
    const decoded = await decodeSource(image, generation);
    if (!decoded) return null;

    const toned = await tonePixels(decoded, image, generation, report);
    if (!toned) return null;

    const blurred = await blurPixels(toned, image, generation, report);
    if (!blurred) return null;

    return compositePixels(toned, blurred, decoded, image, generation, report);
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

    const generation = cache.generation;
    editor.previewBusy = true;
    try {
      const pixels = await renderPixels(image, generation);
      if (!pixels) return;

      const blob = await canvasToImageBlob(toCanvas(pixels), image);
      // Bail if the operator moved on while we were working.
      if (editor.current !== image || generation !== cache.generation) return;
      await editor.setPreview(blob);
    } finally {
      editor.previewBusy = false;
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
    void blurRadius;
    void focusPosition;
    void transitionWidth;
    void vibrance;
    void saturation;
    void brightness;
    void contrast;
    void vignette;
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
    const active = editor.tool === "tiltshift";
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
    // Drop anything the run-up to this click queued, so no render is in flight.
    recompute.cancel();
    const image = source;

    await editor.run("Tilt-shift", async (report) => {
      report("Decoding", 0.15);
      const pixels = await renderPixels(image, cache.generation, report);
      if (!pixels) throw new Error("That render was cancelled before it finished.");

      report("Encoding", 0.9);
      const blob = await encodeLike(toCanvas(pixels), image);
      await editor.commit(blob, "Tilt-shift", image.name);
      // The committed frame is the result now. Leaving the preview on the
      // stage would show the previous image under identical-looking pixels,
      // and dropping the queued recompute stops one from landing on top.
      committedUrl = editor.current?.url ?? null;
      recompute.cancel();
      editor.clearPreview();
    });
  }

  function reset() {
    blurRadius = DEFAULTS.blurRadius;
    focusPosition = DEFAULTS.focusPosition;
    transitionWidth = DEFAULTS.transitionWidth;
    vibrance = DEFAULTS.vibrance;
    saturation = DEFAULTS.saturation;
    brightness = DEFAULTS.brightness;
    contrast = DEFAULTS.contrast;
    vignette = DEFAULTS.vignette;
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
    <span class="micro-label">Focus band</span>

    <SliderField
      id="tiltshift-blur"
      label="Blur strength"
      min={2}
      max={50}
      step={1}
      value={blurRadius}
      display="{blurRadius} px"
      disabled={locked}
      onvalue={(v) => (blurRadius = v)}
    />

    <SliderField
      id="tiltshift-focus"
      label="Focus position"
      min={0}
      max={100}
      step={1}
      value={focusPosition}
      display="{focusPosition} %"
      disabled={locked}
      onvalue={(v) => (focusPosition = v)}
    />

    <SliderField
      id="tiltshift-transition"
      label="Transition width"
      min={5}
      max={50}
      step={1}
      value={transitionWidth}
      display="{transitionWidth} %"
      disabled={locked}
      onvalue={(v) => (transitionWidth = v)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Colour and tone</span>

    <SliderField
      id="tiltshift-vibrance"
      label="Vibrance"
      min={50}
      max={300}
      step={1}
      value={vibrance}
      display="{vibrance} %"
      disabled={locked}
      onvalue={(v) => (vibrance = v)}
    />

    <SliderField
      id="tiltshift-saturation"
      label="Saturation"
      min={50}
      max={300}
      step={1}
      value={saturation}
      display="{saturation} %"
      disabled={locked}
      onvalue={(v) => (saturation = v)}
    />

    <SliderField
      id="tiltshift-brightness"
      label="Brightness"
      min={50}
      max={200}
      step={1}
      value={brightness}
      display="{brightness} %"
      disabled={locked}
      onvalue={(v) => (brightness = v)}
    />

    <SliderField
      id="tiltshift-contrast"
      label="Contrast"
      min={50}
      max={250}
      step={1}
      value={contrast}
      display="{contrast} %"
      disabled={locked}
      onvalue={(v) => (contrast = v)}
    />

    <SliderField
      id="tiltshift-vignette"
      label="Vignette"
      min={0}
      max={100}
      step={1}
      value={vignette}
      display="{vignette} %"
      disabled={locked}
      onvalue={(v) => (vignette = v)}
    />
  </section>

  {#if bandReadout}
    <div class="tool-result">
      <span>Sharp band</span>
      <strong>{bandReadout.height} px at y {bandReadout.centre}</strong>
    </div>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">The stage previews these settings. Apply to keep the result.</p>

    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={locked}
      onclick={apply}
    >
      Apply tilt-shift
    </Button>

    <Button variant="quiet" size="sm" full disabled={locked} onclick={reset}>
      Reset settings
    </Button>
  </div>
</div>
