<script>
  /**
   * Curved text.
   *
   * This tool authors rather than filters, so it mounts a stage layer instead of
   * parking a preview bitmap: the words are drawn over the picture in image
   * coordinates by `CurvedTextLayer.svelte`, and the two halves share the
   * `curvedText` store. Apply then paints the same placement onto a full
   * resolution canvas and commits it.
   *
   * Everything here either sets a decision the operator made or measures the
   * run on a canvas. The measurement has to live in this component because it
   * is the only one with a 2D context, and it is redone whenever the font, the
   * size or the tracking changes, because a width taken with the wrong font is
   * the width of some other mark.
   */
  import { onMount, untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { ANCHORS, FONT_FAMILIES, SIDES, curvedText } from "../state/curvedtext.svelte.js";
  import { context2d, createCanvas, loadImage } from "../core/image.js";
  import { canvasToImageBlob } from "../core/pixels.js";
  import { measureAdvances } from "../core/textarc.js";
  import CurvedTextLayer from "./CurvedTextLayer.svelte";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import ColorField from "../components/controls/ColorField.svelte";
  import NumberField from "../components/controls/NumberField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const ct = curvedText;

  // -------------------------------------------------------------------
  // Stage layer
  // -------------------------------------------------------------------

  onMount(() => {
    editor.setStageLayer(CurvedTextLayer);
    return () => {
      editor.clearStageLayer();
      // The bend is drawn by the layer, not by `setPreview`, so there is no
      // preview of this tool's own to drop. Clearing it anyway means a preview
      // left on the stage by any other route cannot outlive this panel.
      editor.clearPreview();
    };
  });

  // -------------------------------------------------------------------
  // Measurement
  // -------------------------------------------------------------------

  let scratch = null;

  /** One glyph advance at the store's current font. */
  function advanceOf(char) {
    if (!scratch) scratch = context2d(createCanvas(1, 1));
    scratch.font = ct.font;
    return scratch.measureText(char).width;
  }

  // The font shorthand reads the family, the size and the weight, so reading it
  // tracks every one of them: a change to any of them re-measures.
  $effect(() => {
    const font = ct.font;
    const text = ct.text;
    const tracking = ct.letterSpacing;
    void font;
    ct.setRun(measureAdvances(text, advanceOf, tracking));
  });

  // Seed on activation, and whenever a genuinely new image arrives. Keyed on
  // `editor.epoch`, which moves only on open and discard, so this cannot fire
  // for an image this tool produced itself.
  $effect(() => {
    const active = editor.tool === "curvedtext";
    void editor.epoch;
    if (!active) return;
    untrack(() => {
      const image = editor.current;
      if (!image) return;
      ct.sync(image.width, image.height);
      // The radius is fitted from a measurement, and the run has not been
      // measured at this image's text size yet, so measure it here rather than
      // leaving the arc at a guess.
      ct.setRun(measureAdvances(ct.text, advanceOf, ct.letterSpacing));
      ct.fitPending();
    });
  });

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  const source = $derived(editor.current);
  const locked = $derived(editor.busy || !source);
  const nothingToDraw = $derived(!ct.hasText);
  const textNeeds = $derived(Math.round(ct.textSweepDeg));

  /** Paint the run at image resolution. Mirrors the layer, glyph for glyph. */
  function paint(ctx) {
    const { glyphs } = ct.placement;
    if (!glyphs.length) return;

    ctx.save();
    ctx.font = ct.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    for (const glyph of glyphs) {
      ctx.save();
      ctx.translate(glyph.x, glyph.y);
      ctx.rotate(glyph.angle);

      if (ct.outline && ct.outlineWidth > 0) {
        ctx.strokeStyle = ct.outlineColor;
        ctx.lineWidth = ct.outlineWidth;
        ctx.lineJoin = "round";
        ctx.strokeText(glyph.char, 0, 0);
      }

      ctx.fillStyle = ct.color;
      ctx.fillText(glyph.char, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  async function apply() {
    if (!source || locked || nothingToDraw) return;
    const image = source;

    const done = await editor.run("Curved Text", async (report) => {
      report("Decoding", 0.2);
      const decoded = await loadImage(image.blob);

      report("Bending the text", 0.6);
      const canvas = createCanvas(image.width, image.height);
      const ctx = context2d(canvas);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(decoded, 0, 0, image.width, image.height);
      paint(ctx);

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(canvas, image);
      await editor.commit(blob, "Curved Text", image.name);
    });

    // The words are in the pixels now, so the layer stops drawing them.
    if (done) ct.bake();
  }
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Text</span>

    <div class="field">
      <label class="name" for="ct-text">Words</label>
      <input
        id="ct-text"
        type="text"
        maxlength="200"
        value={ct.text}
        placeholder="Curved Text"
        disabled={editor.busy}
        oninput={(event) => (ct.text = event.currentTarget.value)}
      />
    </div>

    <SelectField
      id="ct-font"
      label="Font"
      value={ct.family}
      options={FONT_FAMILIES}
      disabled={editor.busy}
      onvalue={(next) => (ct.family = next)}
    />

    <SliderField
      id="ct-size"
      label="Text size"
      value={ct.size}
      min={8}
      max={400}
      step={1}
      display="{ct.size} px"
      disabled={editor.busy}
      onvalue={(next) => (ct.size = next)}
    />

    <div class="tool-row">
      <CheckField id="ct-bold" label="Bold" bind:checked={ct.bold} disabled={editor.busy} />
      <CheckField id="ct-italic" label="Italic" bind:checked={ct.italic} disabled={editor.busy} />
    </div>

    <SliderField
      id="ct-tracking"
      label="Letter spacing"
      value={ct.letterSpacing}
      min={-10}
      max={60}
      step={1}
      display="{ct.letterSpacing} px"
      disabled={editor.busy}
      onvalue={(next) => (ct.letterSpacing = next)}
    />

    <ColorField
      id="ct-color"
      label="Colour"
      value={ct.color}
      disabled={editor.busy}
      onvalue={(next) => (ct.color = next)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Arc</span>

    <Segmented
      name="ct-side"
      label="Side of the circle"
      columns={2}
      options={SIDES}
      value={ct.side}
      disabled={editor.busy}
      onvalue={(next) => ct.setSide(next)}
    />

    <SliderField
      id="ct-radius"
      label="Radius"
      value={ct.radius}
      min={0}
      max={ct.maxRadius}
      step={1}
      display="{ct.radius} px"
      disabled={editor.busy}
      onvalue={(next) => (ct.radius = next)}
    />

    <SliderField
      id="ct-sweep"
      label="Arc sweep"
      value={ct.sweep}
      min={0}
      max={360}
      step={1}
      display="{ct.sweep}°"
      disabled={editor.busy}
      onvalue={(next) => (ct.sweep = next)}
    />

    <Segmented
      name="ct-anchor"
      label="Anchor on the arc"
      columns={3}
      options={ANCHORS}
      value={ct.anchor}
      disabled={editor.busy}
      onvalue={(next) => (ct.anchor = next)}
    />

    <SliderField
      id="ct-start"
      label="Start angle"
      value={ct.arcStartDeg}
      min={-180}
      max={180}
      step={1}
      display="{ct.arcStartDeg}°"
      disabled={editor.busy}
      onvalue={(next) => (ct.arcStartDeg = next)}
    />

    <SliderField
      id="ct-along"
      label="Along the arc"
      value={ct.alongDeg}
      min={-180}
      max={180}
      step={1}
      display="{ct.alongDeg}°"
      disabled={editor.busy}
      onvalue={(next) => ct.setAlong(next)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Fit</span>

    <div class="tool-result">
      <span>{ct.placement.straight ? "Straight line" : `Text uses ${textNeeds}° of ${ct.sweep}°`}</span>
      <strong>{ct.placement.straight ? "Flat" : ct.fits ? "Fits" : "Too long"}</strong>
    </div>

    <Button
      variant="secondary"
      size="sm"
      full
      disabled={editor.busy || !ct.hasText}
      onclick={() => ct.fitRadius()}
    >
      Fit the radius to the sweep
    </Button>

    {#if ct.sweep === 0}
      <p class="tool-note">At 0° the arc has no length, so the words are drawn straight.</p>
    {:else if ct.radius === 0}
      <p class="tool-note">Radius 0 draws the words as a straight line through the arc centre.</p>
    {:else if ct.hasText && !ct.fits}
      <p class="tool-note">
        The words need {textNeeds}° and the arc is {ct.sweep}°. Raise the radius, lower the
        sweep, or fit the radius. Nothing is cut off.
      </p>
    {/if}
  </section>

  <section class="tool-section">
    <span class="micro-label">Outline</span>

    <CheckField id="ct-outline" label="Outline" bind:checked={ct.outline} disabled={editor.busy} />

    {#if ct.outline}
      <ColorField
        id="ct-outline-color"
        label="Outline colour"
        value={ct.outlineColor}
        disabled={editor.busy}
        onvalue={(next) => (ct.outlineColor = next)}
      />

      <SliderField
        id="ct-outline-width"
        label="Outline width"
        value={ct.outlineWidth}
        min={1}
        max={24}
        step={1}
        display="{ct.outlineWidth} px"
        disabled={editor.busy}
        onvalue={(next) => (ct.outlineWidth = next)}
      />
    {/if}
  </section>

  <section class="tool-section">
    <span class="micro-label">Arc centre</span>

    <div class="tool-row">
      <NumberField
        id="ct-centre-x"
        label="Across"
        value={ct.cx}
        min={0}
        max={Math.max(1, ct.imageWidth)}
        step={1}
        suffix="px"
        disabled={editor.busy}
        onvalue={(next) => (ct.cx = next)}
      />
      <NumberField
        id="ct-centre-y"
        label="Down"
        value={ct.cy}
        min={0}
        max={Math.max(1, ct.imageHeight)}
        step={1}
        suffix="px"
        disabled={editor.busy}
        onvalue={(next) => (ct.cy = next)}
      />
    </div>

    <p class="tool-note">
      Two handles on the image do the same two things. Each is also a control here.
    </p>
  </section>

  {#if nothingToDraw}
    <p class="tool-note">Apply needs some words to bend.</p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">
      The stage shows the bend. Apply draws it into the image and clears the words.
    </p>

    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={locked || nothingToDraw}
      onclick={apply}
    >
      Apply curved text
    </Button>

    <Button variant="quiet" size="sm" full disabled={editor.busy} onclick={() => ct.reset()}>
      Reset
    </Button>
  </div>
</div>

<style>
  /* The words are the one control with no shared field to reach for: there is no
     TextField in the control set, and a curved text tool without editable text
     is not one. Styled from the same tokens as the selects so it does not read
     as a different kind of control. */
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

  input[type="text"] {
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--s-3);
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-radius: var(--r-md);
    font-size: var(--t-md);
    color: var(--text-1);
    transition:
      border-color var(--dur-1) var(--ease),
      background var(--dur-1) var(--ease);
  }

  input[type="text"]:hover:not(:disabled) {
    border-color: var(--line-3);
  }

  input[type="text"]:focus-visible {
    outline: none;
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }

  input[type="text"]:disabled {
    color: var(--text-3);
    cursor: not-allowed;
  }
</style>