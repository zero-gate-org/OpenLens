<script>
  /**
   * Text behind an object.
   *
   * The words go on the background and the subject goes back on top of them,
   * which is one composite in a fixed order and is the whole of the tool:
   * `core/behind.js` spells the order out and owns the arithmetic.
   *
   * The subject is a segmentation mask rather than a second upload. That is a
   * better answer than the legacy tool's cut-out PNG in three ways at once: the
   * operator does not have to find and prepare a file, the subject cannot be out
   * of step with the picture, and the mask is already in the pipeline the blur,
   * the colour splash and the shadow tools use, so the model runs once and is
   * cached against the image. That store is read directly rather than cached a
   * second time; see `state/textbehind.svelte.js`.
   *
   * The edge is the thing that decides whether this looks right. The subject is
   * composited through a feathered plane rather than through the mask, so the
   * join is a ramp as wide as the operator asked for instead of a step.
   *
   * The tool both filters and authors, so it does both things the contract
   * describes: it parks a composited preview bitmap on the stage through
   * `setPreview`, and it mounts a layer for the placement chrome. The layer does
   * not draw the words, because the preview already has them; see
   * `TextBehindLayer.svelte`.
   *
   * Nothing here is ever committed implicitly. Apply does that.
   */
  import { onMount, untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { shadowCacheKey, shadowInjection } from "../state/shadowinject.svelte.js";
  import {
    ALIGNMENTS,
    FONT_FAMILIES,
    MAX_TEXT_SIZE,
    MIN_TEXT_SIZE,
    OPACITY_RANGE,
    textBehind,
  } from "../state/textbehind.svelte.js";
  import { debounce } from "../core/pixels.js";
  import { context2d, createCanvas, encodeLike } from "../core/image.js";
  import { FEATHER_RANGE, PLATES, PLATE_BLUR_RANGE, TEXT_SHADOW } from "../core/behind.js";
  import { measureAdvances } from "../core/textarc.js";
  import TextBehindLayer from "./TextBehindLayer.svelte";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import ColorField from "../components/controls/ColorField.svelte";
  import NumberField from "../components/controls/NumberField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const st = textBehind;

  const MODELS = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ];

  let model = $state("medium");
  /** A preview failure is this panel's own, not a committed operation's. */
  let previewError = $state(null);

  const source = $derived(editor.current);

  /**
   * Identity of everything in the cache: the image on the stage and the model
   * that read it. Same string the shared segmentation store builds for itself,
   * so the effect that invalidates the mask and the key the store checks agree
   * by construction.
   */
  const cacheKey = $derived(shadowCacheKey(source, model));

  /** The edges the words run past, as one readable phrase. */
  const overflowEdges = $derived(st.overflow.edges.join(" and "));

  /** How much of the frame the subject holds, once the model has run. */
  const subjectShare = $derived(shadowInjection.subjectShare);

  // -------------------------------------------------------------------
  // Stage layer
  // -------------------------------------------------------------------

  onMount(() => {
    editor.setStageLayer(TextBehindLayer);
    return () => {
      editor.clearStageLayer();
      st.clearFrames();
      // The composited preview is this tool's own, and it is redundant the
      // moment the panel is gone. Dropping it here means nothing is stranded on
      // the stage under the next tool's controls.
      editor.clearPreview();
    };
  });

  // -------------------------------------------------------------------
  // Measurement
  // -------------------------------------------------------------------

  let scratch = null;

  /**
   * Measure the run at the store's current font, plus the font's own ascent and
   * descent.
   *
   * Every character is measured on its own, never once for the string and
   * reused: "iii" and "WWW" are the same length and nowhere near the same
   * width, so a single measurement reused across the run is a different letter
   * spacing for every string.
   */
  function measureRun() {
    if (!scratch) scratch = context2d(createCanvas(1, 1));
    scratch.font = st.font;

    const run = measureAdvances(st.text, (char) => scratch.measureText(char).width, st.letterSpacing);
    const metrics = scratch.measureText("Hxpg");

    // Two browsers, two different answers: some report the font's own bounding
    // box, some report nothing at all. The 80/20 fallback is only ever used to
    // centre a block, never to decide how wide a letter is.
    const size = Math.max(0, st.size);
    const ascent = Number.isFinite(metrics.fontBoundingBoxAscent) ? metrics.fontBoundingBoxAscent : size * 0.8;
    const descent = Number.isFinite(metrics.fontBoundingBoxDescent) ? metrics.fontBoundingBoxDescent : size * 0.2;

    return { glyphs: run.glyphs, ascent, descent };
  }

  // Re-measure whenever the font shorthand, the words or the tracking change.
  // `measureRun` reads all three, so they are the effect's dependencies without
  // being named twice: the shorthand carries the family, the size, the weight
  // and the slant, so a change to any one of them re-measures.
  $effect(() => {
    st.setRun(measureRun());
  });

  // Seed on activation, and whenever a genuinely new image arrives. Keyed on
  // `editor.epoch`, which moves only on open and discard, so this cannot fire
  // for an image this tool produced itself.
  $effect(() => {
    const active = editor.tool === "textbehind";
    void editor.epoch;
    if (!active) return;
    committedUrl = null;
    untrack(() => {
      const image = editor.current;
      if (!image) return;
      st.sync(image.width, image.height);
      // The size is seeded from the frame, and the run has not been measured at
      // that size yet, so measure it here rather than leaving the block a guess
      // wide for a frame.
      st.setRun(measureRun());
    });
  });

  // -------------------------------------------------------------------
  // The ink sheet
  // -------------------------------------------------------------------

  let inkCanvas = null;
  let inkCtx = null;

  /**
   * Rasterise the words into a sheet the size of the text block.
   *
   * The sheet is a sub rectangle of the frame rather than the whole frame, and
   * `st.inkBox` decides how big. That is the difference between a few hundred
   * kilobytes and a full frame copy of a twelve megapixel photograph, on every
   * slider move.
   */
  function buildInk() {
    const box = st.inkBox;
    if (!st.hasText || box.w < 1 || box.h < 1) return null;

    if (!inkCanvas) {
      inkCanvas = createCanvas(box.w, box.h);
      inkCtx = context2d(inkCanvas);
    } else if (inkCanvas.width !== box.w || inkCanvas.height !== box.h) {
      inkCanvas.width = box.w;
      inkCanvas.height = box.h;
    }

    paintInk(inkCtx);
    const frame = inkCtx.getImageData(0, 0, box.w, box.h);
    return { x: box.x, y: box.y, w: box.w, h: box.h, data: frame.data };
  }

  /**
   * Draw the words into the sheet, in image coordinates.
   *
   * The matrix moves the text's own frame onto the picture and the sheet's own
   * origin is subtracted from the translation, so the sheet is a window onto the
   * placement rather than a second placement. Both halves come off the store, so
   * the stage layer and this canvas cannot disagree about where the words are.
   */
  function paintInk(ctx) {
    const box = st.inkBox;
    const m = st.matrix;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e - box.x, m.f - box.y);

    ctx.font = st.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    if (st.shadow) {
      // The shadow is a whole pass of its own, before any face is drawn. Filled
      // per glyph with the shadow left on, a letter's shadow would land on the
      // next letter's face and darken it, which on tight lettering is a visible
      // smudge between every pair. Drawn this way it is under every face, which
      // is what the legacy panel asked for.
      ctx.shadowColor = TEXT_SHADOW.color;
      ctx.shadowBlur = TEXT_SHADOW.blur;
      ctx.shadowOffsetX = TEXT_SHADOW.offsetX;
      ctx.shadowOffsetY = TEXT_SHADOW.offsetY;
      ctx.fillStyle = "#000000";
      for (const glyph of st.block.glyphs) ctx.fillText(glyph.char, glyph.x, glyph.y);
      ctx.shadowColor = "transparent";
    }

    ctx.fillStyle = st.color;
    for (const glyph of st.block.glyphs) ctx.fillText(glyph.char, glyph.x, glyph.y);
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
    // Read the pipeline's staleness now, before the first await, so work that
    // outlives this run can tell that it is computing for an image nobody is
    // looking at any more.
    const isStale = shadowInjection.staleness();
    editor.previewBusy = true;

    try {
      const prepared = await shadowInjection.prepare(image, model, null);
      if (run !== previewRun || !prepared || isStale()) return;

      // Every degenerate case lands here rather than in the arithmetic: an empty
      // mask, a mask that found nothing, a mask that called everything the
      // subject, and a text that would not show. In each of those the composite
      // is not a picture anyone asked for, so there is nothing to show and the
      // panel says which of them it is.
      if (st.blocked) {
        previewError = null;
        editor.clearPreview();
        return;
      }

      // The ink sheet and the frame key are both read here, in one tick, so the
      // words and the cache entry that describes them cannot disagree.
      const pixels = await st.frame(buildInk(), isStale, null);
      if (!pixels || isStale()) return;

      const blob = await encodePixels(pixels, image);
      // Bail if the operator moved on while we were working.
      if (run !== previewRun || editor.current !== image) return;

      previewError = null;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      previewError =
        error?.message || "The composition could not be previewed. Try a different model.";
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
    void st.text;
    void st.family;
    void st.size;
    void st.bold;
    void st.italic;
    void st.letterSpacing;
    void st.align;
    void st.color;
    void st.shadow;
    void st.opacity;
    void st.plate;
    void st.plateBlur;
    void st.plateColor;
    void st.feather;
    void st.x;
    void st.y;
    void st.rotationDeg;
    void model;
    recompute();
  });

  // Segmentation is expensive, so it is kept only while it belongs to the image
  // on the stage. The cleanup is the single invalidation point: it runs when the
  // image changes, when the model changes, and when the tool is switched away.
  // There is no activate or deactivate step to forget.
  $effect(() => {
    void cacheKey;
    return () => {
      recompute.cancel();
      st.clearFrames();
      shadowInjection.clear();
    };
  });

  // -------------------------------------------------------------------
  // Apply
  // -------------------------------------------------------------------

  /**
   * Apply is blocked while a preview is still moving.
   *
   * A preview render and a commit render share the same cache slots. Starting a
   * commit while a preview is mid-flight leaves one of the two awaiting a
   * promise the other abandoned, and the operation never settles. Beyond the
   * crash, "apply" during a moving preview is not a request anyone can mean.
   */
  const locked = $derived(
    editor.busy || editor.previewBusy || !source || st.blocked,
  );

  async function apply() {
    if (locked) return;

    // Drop anything the run-up to this click queued, so no render is in flight
    // and the two cannot fight over the same cache slots.
    recompute.cancel();

    const image = source;

    await editor.run("Text Behind", async (report) => {
      const isStale = shadowInjection.staleness();

      report("Preparing", 0.05);
      const prepared = await shadowInjection.prepare(image, model, report);
      if (!prepared) {
        throw new Error("The image changed while the mask was being built. Try again.");
      }
      // One reason, named by the store, for all four degenerate cases. The button
      // is disabled for them, so this is the belt to that braces: a click that
      // arrives between the two reads still refuses rather than compositing a
      // rectangle.
      if (st.blockedReason) throw new Error(st.blockedReason);

      const pixels = await st.frame(buildInk(), isStale, report);
      if (!pixels) {
        throw new Error("The composition was cut short because the image changed. Try again.");
      }

      report("Encoding", 0.92);
      const blob = await encodePixels(pixels, image);
      await editor.commit(blob, "Text Behind", image.name);
      // The committed frame is the result now, so the preview is redundant and
      // a queued recompute must not rebuild the image we just wrote.
      committedUrl = editor.current?.url ?? null;
      recompute.cancel();
      editor.clearPreview();
    });
  }
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Words</span>

    <div class="field">
      <label class="name" for="tb-text">Text</label>
      <textarea
        id="tb-text"
        rows="2"
        spellcheck="false"
        value={st.text}
        placeholder="Text Behind"
        disabled={editor.busy}
        oninput={(event) => (st.text = event.currentTarget.value)}
      ></textarea>
    </div>

    <SelectField
      id="tb-font"
      label="Font"
      value={st.family}
      options={FONT_FAMILIES}
      disabled={editor.busy}
      onvalue={(next) => (st.family = next)}
    />

    <SliderField
      id="tb-size"
      label="Text size"
      value={st.size}
      min={MIN_TEXT_SIZE}
      max={MAX_TEXT_SIZE}
      step={1}
      display="{st.size} px"
      disabled={editor.busy}
      onvalue={(next) => (st.size = next)}
    />

    <div class="tool-row">
      <CheckField id="tb-bold" label="Bold" bind:checked={st.bold} disabled={editor.busy} />
      <CheckField id="tb-italic" label="Italic" bind:checked={st.italic} disabled={editor.busy} />
    </div>

    <SliderField
      id="tb-tracking"
      label="Letter spacing"
      value={st.letterSpacing}
      min={-40}
      max={st.trackingMax}
      step={1}
      display="{st.letterSpacing} px"
      disabled={editor.busy}
      onvalue={(next) => (st.letterSpacing = next)}
    />

    <Segmented
      name="tb-align"
      label="Align on the anchor"
      columns={3}
      options={ALIGNMENTS}
      value={st.align}
      disabled={editor.busy}
      onvalue={(next) => (st.align = next)}
    />

    <ColorField
      id="tb-color"
      label="Text colour"
      value={st.color}
      disabled={editor.busy}
      onvalue={(next) => (st.color = next)}
    />

    <CheckField
      id="tb-shadow"
      label="Text shadow"
      bind:checked={st.shadow}
      disabled={editor.busy}
      hint="A soft dark shadow under the letters. A photograph has no colour to promise contrast against, so this is what keeps the words readable."
    />

    <SliderField
      id="tb-opacity"
      label="Opacity"
      value={st.opacity}
      min={OPACITY_RANGE.min}
      max={OPACITY_RANGE.max}
      step={OPACITY_RANGE.step}
      display="{st.opacity}%"
      disabled={editor.busy}
      onvalue={(next) => (st.opacity = next)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Placement</span>

    <div class="tool-row">
      <NumberField
        id="tb-x"
        label="Across"
        value={st.x}
        min={-st.axisMax}
        max={st.axisMax}
        step={1}
        suffix="px"
        disabled={editor.busy}
        onvalue={(next) => (st.x = next)}
      />
      <NumberField
        id="tb-y"
        label="Down"
        value={st.y}
        min={-st.axisMax}
        max={st.axisMax}
        step={1}
        suffix="px"
        disabled={editor.busy}
        onvalue={(next) => (st.y = next)}
      />
    </div>

    <SliderField
      id="tb-rotation"
      label="Rotation"
      value={st.rotationDeg}
      min={-180}
      max={180}
      step={1}
      display="{st.rotationDeg}°"
      disabled={editor.busy}
      onvalue={(next) => (st.rotationDeg = next)}
    />

    <Button variant="secondary" size="sm" full disabled={editor.busy} onclick={() => st.centre()}>
      Centre in the frame
    </Button>

    <div class="tool-result">
      <span>{st.block.lineCount} {st.block.lineCount === 1 ? "line" : "lines"}</span>
      <strong>{Math.round(st.box.w)} x {Math.round(st.box.h)} px</strong>
    </div>

    <p class="tool-note">
      The handle on the image moves the words. Across and Down are the same values as fields.
    </p>

    {#if st.overflow.any}
      <p class="tool-note warn">The text runs past the {overflowEdges} of the frame.</p>
    {/if}
  </section>

  <section class="tool-section">
    <span class="micro-label">Background</span>

    <SelectField
      id="tb-model"
      label="Model"
      value={model}
      onvalue={(next) => (model = next)}
      options={MODELS}
      disabled={locked}
      hint="Small is quickest. Large gives the cleanest edges on hair and fur."
    />

    <Segmented
      name="tb-plate"
      label="Behind the words"
      columns={3}
      options={PLATES}
      value={st.plate}
      disabled={editor.busy}
      onvalue={(next) => (st.plate = next)}
    />

    {#if st.plate === "blur"}
      <SliderField
        id="tb-plate-blur"
        label="Background blur"
        min={PLATE_BLUR_RANGE.min}
        max={PLATE_BLUR_RANGE.max}
        step={PLATE_BLUR_RANGE.step}
        value={st.plateBlur}
        display="{st.plateBlur}px"
        disabled={editor.busy}
        onvalue={(next) => (st.plateBlur = next)}
      />
    {:else if st.plate === "solid"}
      <ColorField
        id="tb-plate-color"
        label="Background colour"
        value={st.plateColor}
        disabled={editor.busy}
        onvalue={(next) => (st.plateColor = next)}
      />
    {:else}
      <p class="tool-note">
        Original leaves the picture alone, so the words show only where the subject is not.
      </p>
    {/if}
  </section>

  <section class="tool-section">
    <span class="micro-label">Edge</span>

    <SliderField
      id="tb-feather"
      label="Edge feather"
      min={FEATHER_RANGE.min}
      max={FEATHER_RANGE.max}
      step={FEATHER_RANGE.step}
      value={st.feather}
      display="{st.feather}px"
      disabled={editor.busy || !source}
      onvalue={(next) => (st.feather = next)}
    />

    <p class="tool-note">
      The subject is drawn back over the words through a soft edge this wide. At 0px the mask is
      used as it comes, which leaves a hard line around the subject.
    </p>

    {#if subjectShare !== null && !st.blocked}
      <div class="tool-result">
        <span>Subject</span>
        <strong>{Math.round(subjectShare * 100)}% of the frame</strong>
      </div>
    {/if}
  </section>

  {#if st.blockedReason}
    <p class="tool-note warn">{st.blockedReason}</p>
  {:else if previewError}
    <p class="tool-note">{previewError}</p>
  {:else if !source}
    <p class="tool-note">Open an image to put words behind its subject.</p>
  {:else}
    <p class="tool-note">
      The first run downloads the model and caches it in this browser. The image itself is never
      uploaded.
    </p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">
      The stage shows the finished composite. Apply writes it into the image.
    </p>

    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={locked}
      onclick={apply}
    >
      Apply text behind
    </Button>

    <Button variant="quiet" size="sm" full disabled={editor.busy} onclick={() => st.reset()}>
      Reset
    </Button>
  </div>
</div>

<style>
  /* The words are the one control with no shared field to reach for: there is no
     TextField in the control set, and a text tool without editable text is not
     one. Styled from the same tokens as the selects so it does not read as a
     different kind of control. */
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }

  .name {
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-2);
  }

  textarea {
    width: 100%;
    min-height: calc(var(--control-h) * 2);
    padding: var(--s-2) var(--s-3);
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-radius: var(--r-md);
    font-size: var(--t-md);
    line-height: 1.4;
    color: var(--text-1);
    resize: vertical;
    transition:
      border-color var(--dur-1) var(--ease),
      background var(--dur-1) var(--ease);
  }

  textarea:hover:not(:disabled) {
    border-color: var(--line-3);
  }

  textarea:focus-visible {
    outline: none;
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }

  textarea:disabled {
    color: var(--text-3);
    cursor: not-allowed;
  }

  /* The warning is for a composition that cannot be drawn at all, or for words
     that would be lost off the edge. Both lose pixels without the operator
     meaning to. */
  .tool-note.warn {
    color: var(--warning);
  }
</style>