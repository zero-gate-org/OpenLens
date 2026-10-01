<script>
  /**
   * Shadow injection: drop a cast shadow behind the subject.
   *
   * A segmentation model decides which pixels are the subject, the same way the
   * blur and the colour splash do, and that mask is the expensive half by far.
   * It is cached against the image and the model, so dragging the offset costs
   * a composite and never a second run of the model.
   *
   * The rest is arithmetic, in `core/shadow.js`: the mask is moved by the
   * offset, softened, and darkened into the part of the frame the subject does
   * not cover. The shadow is always behind the subject and always clipped to
   * the frame, so an offset that walks off the edge loses that much of itself,
   * which the panel reports rather than hiding.
   *
   * Nothing here is ever committed implicitly. Apply does that.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { debounce } from "../core/pixels.js";
  import { context2d, createCanvas, encodeLike } from "../core/image.js";
  import { shadowCacheKey, shadowInjection } from "../state/shadowinject.svelte.js";
  import {
    BLUR_RANGE,
    DEPTH_RANGE,
    DIRECTIONS,
    NO_SUBJECT_MESSAGE,
    OFFSET_RANGE,
    OPACITY_RANGE,
    SHADOW_DEFAULTS,
    clampOffset,
    effectiveOffset,
    fitOffset,
    shadowOutsideShare,
  } from "../core/shadow.js";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const MODELS = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ];

  let model = $state("medium");
  let offsetX = $state(SHADOW_DEFAULTS.offsetX);
  let offsetY = $state(SHADOW_DEFAULTS.offsetY);
  let blur = $state(SHADOW_DEFAULTS.blur);
  let opacity = $state(SHADOW_DEFAULTS.opacity);
  let depth = $state(SHADOW_DEFAULTS.depth);
  let keepInFrame = $state(SHADOW_DEFAULTS.keepInFrame);
  /** Which direction preset is showing as chosen, if any. */
  let direction = $state("");
  /** A preview failure is this panel's own, not a committed operation's. */
  let previewError = $state(null);

  const source = $derived(editor.current);

  /**
   * Identity of everything in the cache: the image on the stage and the model
   * that read it. Same string the store builds for itself, so the effect that
   * invalidates the cache and the key the store checks agree by construction.
   */
  const cacheKey = $derived(shadowCacheKey(source, model));

  /** The settings as one object, so a frame is a consistent read of them. */
  const settings = $derived({ offsetX, offsetY, blur, opacity, depth, keepInFrame });

  /** The offset actually drawn, after the keep-in-frame setting has had its say. */
  const drawn = $derived(
    effectiveOffset(settings, shadowInjection.bounds, source?.width ?? 0, source?.height ?? 0),
  );

  /** How much of the shadow the current offset loses off the edge, 0..1. */
  const lostShare = $derived(
    shadowOutsideShare(settings, shadowInjection.bounds, source?.width ?? 0, source?.height ?? 0),
  );

  /**
   * What the clamp had to hold back, or null when nothing had to move.
   *
   * Only meaningful while the setting is on: with it off the offset is drawn
   * as asked for and nothing was held back.
   */
  const heldBack = $derived.by(() => {
    const bounds = shadowInjection.bounds;
    if (!keepInFrame || !bounds || !source) return null;
    const fitted = fitOffset(offsetX, offsetY, bounds, source.width, source.height);
    return fitted.x === offsetX && fitted.y === offsetY ? null : fitted;
  });

  const offsetLabel = $derived.by(() => {
    const parts = [];
    if (drawn.x !== 0) parts.push(`${Math.abs(drawn.x)}px ${drawn.x < 0 ? "left" : "right"}`);
    if (drawn.y !== 0) parts.push(`${Math.abs(drawn.y)}px ${drawn.y < 0 ? "up" : "down"}`);
    return parts.length ? parts.join(", ") : "behind the subject";
  });

  /**
   * Point the shadow a way, keeping whatever distance the sliders already hold.
   *
   * The distance carries over rather than being a number of its own, so a
   * direction never quietly changes how far the shadow sits. It is clamped to
   * the same limit as the sliders, so a preset cannot put a value on a slider
   * that the range does not cover.
   */
  function pickDirection(value) {
    const preset = DIRECTIONS.find((d) => d.value === value);
    if (!preset) return;

    const distance = clampOffset(
      Math.round(Math.hypot(offsetX, offsetY)) ||
        Math.round(Math.hypot(SHADOW_DEFAULTS.offsetX, SHADOW_DEFAULTS.offsetY)),
    );
    offsetX = preset.dx * distance;
    offsetY = preset.dy * distance;
    direction = preset.value;
  }

  /** Plain pixels out to an encoded blob, in the source image's own format. */
  async function encodePixels(pixels, image) {
    const canvas = createCanvas(pixels.width, pixels.height);
    const ctx = context2d(canvas);
    // The pixel maths works on {width, height, data} so it can be tested
    // without a browser; the canvas is the one place a real ImageData exists.
    const frame = ctx.createImageData(pixels.width, pixels.height);
    frame.data.set(pixels.data);
    ctx.putImageData(frame, 0, 0);
    return encodeLike(canvas, image);
  }

  // ---------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------

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
    const now = { offsetX, offsetY, blur, opacity, depth, keepInFrame };
    const isStale = shadowInjection.staleness();
    editor.previewBusy = true;

    try {
      const prepared = await shadowInjection.prepare(image, model, null);
      if (!prepared || isStale()) return;

      // With nothing in the mask the shadow would be a full frame darkening,
      // so there is nothing to show and the panel says why.
      if (shadowInjection.noSubject) {
        previewError = null;
        editor.clearPreview();
        return;
      }

      const pixels = await shadowInjection.frame(now, isStale, null);
      if (!pixels || isStale()) return;

      const blob = await encodePixels(pixels, image);
      // Bail if the operator moved on while we were working.
      if (run !== previewRun || editor.current !== image) return;

      previewError = null;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      previewError =
        error?.message || "The shadow preview could not be built. Try a different model.";
    } finally {
      if (run === previewRun) editor.previewBusy = false;
    }
  });

  // Recompute when the controls change.
  $effect(() => {
    // The image is read only to be in scope, and deliberately untracked.
    // Depending on it would mean every commit re-runs a full-image pass to
    // reproduce the pixels this tool just wrote, leaving a redundant "Preview"
    // badge sitting on top of the committed image.
    untrack(() => editor.current);
    // Moving a control is the one thing that re-arms the preview after Apply.
    committedUrl = null;
    void offsetX;
    void offsetY;
    void blur;
    void opacity;
    void depth;
    void keepInFrame;
    void model;
    recompute();
  });

  // Segmentation is expensive, so it is kept only while it belongs to the
  // image on the stage. The cleanup is the single invalidation point: it runs
  // when the image changes, when the model changes, and when the tool is
  // switched away. There is no activate or deactivate step to forget.
  $effect(() => {
    void cacheKey;
    return () => {
      recompute.cancel();
      shadowInjection.clear();
    };
  });

  // Seed on activation, and whenever a genuinely new image arrives.
  // `editor.epoch` moves only on open and discard, never on a commit, so this
  // cannot fire for output this tool produced itself.
  $effect(() => {
    const active = editor.tool === "shadowinjection";
    void editor.epoch;
    if (!active) return;
    committedUrl = null;
    untrack(() => {
      if (editor.current) recompute.flush();
    });
  });

  // ---------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------

  /**
   * Apply is blocked while a preview is still moving.
   *
   * A preview render and a commit render share the same cache slots. Starting a
   * commit while a preview is mid-flight leaves one of the two awaiting a
   * promise the other abandoned, and the operation never settles. Beyond the
   * crash, "apply" during a moving preview is not a request anyone can mean.
   */
  const locked = $derived(editor.busy || editor.previewBusy || !source);

  async function apply() {
    if (locked) return;

    // Drop anything the run-up to this click queued, so no render is in flight
    // and the two cannot fight over the same cache slots.
    recompute.cancel();

    const image = source;

    await editor.run("Shadow", async (report) => {
      const now = { offsetX, offsetY, blur, opacity, depth, keepInFrame };
      const isStale = shadowInjection.staleness();

      report("Preparing", 0.05);
      const prepared = await shadowInjection.prepare(image, model, report);
      if (!prepared) {
        throw new Error("The image changed while the mask was being built. Try again.");
      }
      if (shadowInjection.noSubject) {
        throw new Error(NO_SUBJECT_MESSAGE);
      }

      const pixels = await shadowInjection.frame(now, isStale, report);
      if (!pixels) {
        throw new Error("The shadow was cut short because the image changed. Try again.");
      }

      report("Encoding", 0.92);
      const blob = await encodePixels(pixels, image);
      await editor.commit(blob, "Shadow", image.name);
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
    <SelectField
      id="shadow-model"
      label="Model"
      value={model}
      onvalue={(next) => (model = next)}
      options={MODELS}
      disabled={locked}
      hint="Small is quickest. Large gives the cleanest edges on hair and fur."
    />
  </section>

  <section class="tool-section">
    <Segmented
      name="shadow-direction"
      label="Direction"
      options={DIRECTIONS}
      value={direction}
      onvalue={pickDirection}
      disabled={locked}
    />

    <p class="tool-note">
      A direction points the shadow and keeps the distance the offset sliders already hold. A zero
      offset under a blur spreads around the subject instead of behind it.
    </p>
  </section>

  <section class="tool-section">
    <SliderField
      id="shadow-offset-x"
      label="Offset X"
      min={OFFSET_RANGE.min}
      max={OFFSET_RANGE.max}
      step={OFFSET_RANGE.step}
      value={offsetX}
      display="{offsetX}px"
      disabled={editor.busy || !source}
      onvalue={(v) => {
        offsetX = v;
        direction = "";
      }}
    />

    <SliderField
      id="shadow-offset-y"
      label="Offset Y"
      min={OFFSET_RANGE.min}
      max={OFFSET_RANGE.max}
      step={OFFSET_RANGE.step}
      value={offsetY}
      display="{offsetY}px"
      disabled={editor.busy || !source}
      onvalue={(v) => {
        offsetY = v;
        direction = "";
      }}
    />

    {#if heldBack}
      <p class="tool-note">
        Held at {heldBack.x}px, {heldBack.y}px instead, so the whole shadow stays inside the
        frame.
      </p>
    {:else if lostShare > 0}
      <p class="tool-note">
        {Math.round(lostShare * 100)}% of the shadow falls outside the frame. Turn on keep the
        shadow in frame to hold it back.
      </p>
    {/if}
  </section>

  <section class="tool-section">
    <SliderField
      id="shadow-blur"
      label="Blur"
      min={BLUR_RANGE.min}
      max={BLUR_RANGE.max}
      step={BLUR_RANGE.step}
      value={blur}
      display="{blur}px"
      disabled={editor.busy || !source}
      onvalue={(v) => (blur = v)}
    />

    <SliderField
      id="shadow-opacity"
      label="Opacity"
      min={OPACITY_RANGE.min}
      max={OPACITY_RANGE.max}
      step={OPACITY_RANGE.step}
      value={opacity}
      display="{opacity}%"
      disabled={editor.busy || !source}
      onvalue={(v) => (opacity = v)}
    />

    <SliderField
      id="shadow-depth"
      label="Shadow depth"
      min={DEPTH_RANGE.min}
      max={DEPTH_RANGE.max}
      step={DEPTH_RANGE.step}
      value={depth}
      display="{depth}%"
      disabled={editor.busy || !source}
      onvalue={(v) => (depth = v)}
    />

    <p class="tool-note">
      Blur softens the edge. Opacity is how much of the shadow lands, depth is how far it darkens
      what is behind it. Either at zero leaves the picture alone.
    </p>
  </section>

  <section class="tool-section">
    <CheckField
      id="shadow-keep-in-frame"
      label="Keep the shadow in frame"
      bind:checked={keepInFrame}
      disabled={locked}
      hint="Pulls the offset back so the whole shadowed subject stays inside the frame. A subject that already fills the frame cannot move and still fit, so the offset goes to zero."
    />
  </section>

  {#if source && !shadowInjection.noSubject}
    <div class="tool-result">
      <span>Shadow</span>
      <strong>{offsetLabel}, {blur}px blur</strong>
    </div>
  {/if}

  <section class="tool-section">
    {#if shadowInjection.noSubject}
      <p class="tool-note">{NO_SUBJECT_MESSAGE}</p>
    {:else if previewError}
      <p class="tool-note">{previewError}</p>
    {:else if !source}
      <p class="tool-note">Open an image to place a shadow behind its subject.</p>
    {:else}
      <p class="tool-note">
        The first run downloads the model and caches it in this browser. The image itself is never
        uploaded.
      </p>
    {/if}
  </section>

  <div class="tool-actions">
    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={locked}
      onclick={apply}
    >
      Apply shadow
    </Button>
  </div>
</div>