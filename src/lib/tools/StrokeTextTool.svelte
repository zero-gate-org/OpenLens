<script>
  /**
   * Stroke text.
   *
   * Outlined and filled display lettering: a stroke width, a stroke colour, a
   * fill on or off, a fill colour, and the order the two go down in. That order
   * is the point of the tool, so it is a control here and a value in
   * `core/stroketext.js` rather than a constant, and the commit canvas walks
   * the same op list the stage layer reads.
   *
   * This tool authors rather than filters, so it mounts a stage layer instead of
   * parking a preview bitmap: the words are drawn over the picture in image
   * coordinates by `StrokeTextLayer.svelte`, and the two halves share the
   * `strokeText` store. Apply then paints the same placement onto a full
   * resolution canvas and commits it.
   *
   * Everything here either sets a decision the operator made or measures the
   * run on a canvas. The measurement has to live in this component because it is
   * the only one with a 2D context, and it is redone whenever the font, the
   * size or the tracking changes, because a width taken with the wrong font is
   * the width of some other mark.
   */
  import { onMount, untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import {
    ALIGNMENTS,
    FONT_FAMILIES,
    LINE_JOINS,
    MAX_STROKE_WIDTH,
    MAX_TEXT_SIZE,
    MIN_TEXT_SIZE,
    PAINT_ORDERS,
    strokeText,
  } from "../state/stroketext.svelte.js";
  import { MITER_LIMIT, clamp } from "../core/stroketext.js";
  import { measureAdvances } from "../core/textarc.js";
  import { context2d, createCanvas, loadImage } from "../core/image.js";
  import { canvasToImageBlob } from "../core/pixels.js";
  import StrokeTextLayer from "./StrokeTextLayer.svelte";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import ColorField from "../components/controls/ColorField.svelte";
  import NumberField from "../components/controls/NumberField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const st = strokeText;

  /** The edges the words run past, as one readable phrase. */
  const overflowEdges = $derived(st.overflow.edges.join(" and "));

  // -------------------------------------------------------------------
  // Stage layer
  // -------------------------------------------------------------------

  onMount(() => {
    editor.setStageLayer(StrokeTextLayer);
    return () => {
      editor.clearStageLayer();
      // The words are drawn by the layer, not by `setPreview`, so there is no
      // preview of this tool's own to drop. Clearing it anyway means a preview
      // left on the stage by any other route cannot outlive this panel.
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
   * spacing for every string. The metrics come from the same call, so the
   * baselines the layout places land on the font that will actually be drawn.
   */
  function measureRun() {
    if (!scratch) scratch = context2d(createCanvas(1, 1));
    scratch.font = st.font;

    const run = measureAdvances(st.text, (char) => scratch.measureText(char).width, st.letterSpacing);
    const metrics = scratch.measureText("Hxpg");

    // Two browsers, two different answers: some report the font's own bounding
    // box, some report nothing at all. The 80/20 fallback is a plain
    // approximation, and it is only ever used to centre a block, never to
    // decide how wide a letter is.
    const size = Math.max(0, st.size);
    const ascent = Number.isFinite(metrics.fontBoundingBoxAscent) ? metrics.fontBoundingBoxAscent : size * 0.8;
    const descent = Number.isFinite(metrics.fontBoundingBoxDescent) ? metrics.fontBoundingBoxDescent : size * 0.2;

    return { glyphs: run.glyphs, ascent, descent };
  }

  // Re-measure whenever the font shorthand, the words or the tracking change.
  // `measureRun` reads all three, so they are the effect's dependencies without
  // being named twice: the shorthand carries the family, the size, the weight
  // and the slant, so a change to any one of them re-measures. Tracking never
  // changes an advance, only the gap between two of them, and it is in here so
  // the measured run and the layout that reads it can never be describing
  // different gaps.
  $effect(() => {
    st.setRun(measureRun());
  });

  // Seed on activation, and whenever a genuinely new image arrives. Keyed on
  // `editor.epoch`, which moves only on open and discard, so this cannot fire
  // for an image this tool produced itself.
  $effect(() => {
    const active = editor.tool === "stroketext";
    void editor.epoch;
    if (!active) return;
    untrack(() => {
      const image = editor.current;
      if (!image) return;
      st.sync(image.width, image.height);
      // The size is seeded from the frame, and the run has not been measured
      // at that size yet, so measure it here rather than leaving the block a
      // guess wide for a frame.
      st.setRun(measureRun());
    });
  });

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  const source = $derived(editor.current);
  const locked = $derived(editor.busy || !source);

  /**
   * Paint the block at image resolution. Mirrors the layer, op for op.
   *
   * `ops` decides the order, so this function has no opinion about it. The
   * matrix places the text's own frame, which the block was laid out in, onto
   * the picture: the same six numbers the layer hands to its `matrix(...)`, and
   * the same `paintWidth` it hands to `stroke-width`.
   */
  function paint(ctx) {
    const ops = st.ops;
    if (!ops.length || !st.block.glyphs.length) return;

    ctx.save();
    const m = st.matrix;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.font = st.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = st.lineJoin;
    ctx.miterLimit = MITER_LIMIT;
    ctx.globalAlpha = clamp(st.opacity, 0, 100) / 100;

    for (const glyph of st.block.glyphs) {
      for (const op of ops) {
        if (op === "stroke") {
          // A width of 0 never reaches here: `ops` carries no stroke op, so a
          // zero width cannot turn into a hairline outline.
          ctx.strokeStyle = st.strokeColor;
          ctx.lineWidth = st.paintWidth;
          ctx.strokeText(glyph.char, glyph.x, glyph.y);
        } else {
          ctx.fillStyle = st.fillColor;
          ctx.fillText(glyph.char, glyph.x, glyph.y);
        }
      }
    }

    ctx.restore();
  }

  async function apply() {
    if (!source || locked || st.blocked) return;
    const image = source;

    const done = await editor.run("Stroke Text", async (report) => {
      report("Decoding", 0.2);
      const decoded = await loadImage(image.blob);

      report("Stroking the text", 0.6);
      const canvas = createCanvas(image.width, image.height);
      const ctx = context2d(canvas);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(decoded, 0, 0, image.width, image.height);
      paint(ctx);

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(canvas, image);
      await editor.commit(blob, "Stroke Text", image.name);
    });

    // The words are in the pixels now, so the layer stops drawing them.
    if (done) st.bake();
  }
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Words</span>

    <div class="field">
      <label class="name" for="st-text">Text</label>
      <textarea
        id="st-text"
        rows="2"
        spellcheck="false"
        value={st.text}
        placeholder="Stroke Text"
        disabled={editor.busy}
        oninput={(event) => (st.text = event.currentTarget.value)}
      ></textarea>
    </div>

    <SelectField
      id="st-font"
      label="Font"
      value={st.family}
      options={FONT_FAMILIES}
      disabled={editor.busy}
      onvalue={(next) => (st.family = next)}
    />

    <SliderField
      id="st-size"
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
      <CheckField id="st-bold" label="Bold" bind:checked={st.bold} disabled={editor.busy} />
      <CheckField id="st-italic" label="Italic" bind:checked={st.italic} disabled={editor.busy} />
    </div>

    <SliderField
      id="st-tracking"
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
      name="st-align"
      label="Align on the anchor"
      columns={3}
      options={ALIGNMENTS}
      value={st.align}
      disabled={editor.busy}
      onvalue={(next) => (st.align = next)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Stroke</span>

    <CheckField id="st-stroke" label="Outline" bind:checked={st.stroke} disabled={editor.busy} />

    {#if st.stroke}
      <ColorField
        id="st-stroke-color"
        label="Outline colour"
        value={st.strokeColor}
        disabled={editor.busy}
        onvalue={(next) => (st.strokeColor = next)}
      />

      <SliderField
        id="st-stroke-width"
        label="Outline width"
        value={st.strokeWidth}
        min={0}
        max={MAX_STROKE_WIDTH}
        step={1}
        display="{st.strokeWidth} px"
        disabled={editor.busy}
        onvalue={(next) => (st.strokeWidth = next)}
      />

      <Segmented
        name="st-paint-order"
        label="Paint order"
        columns={2}
        options={PAINT_ORDERS}
        value={st.paintOrder}
        disabled={editor.busy}
        onvalue={(next) => (st.paintOrder = next)}
      />

      <p class="tool-note">
        The width is centred on the outline. Stroke behind leaves a clean ring
        outside the letter. Fill behind puts half of it inside the fill. A width
        of 0 px draws no outline at all.
      </p>
    {/if}
  </section>

  {#if st.stroke}
    <section class="tool-section">
      <span class="micro-label">Corners</span>

      <Segmented
        name="st-line-join"
        label="Line join"
        columns={3}
        options={LINE_JOINS}
        value={st.lineJoin}
        disabled={editor.busy}
        onvalue={(next) => (st.lineJoin = next)}
      />
    </section>
  {/if}

  <section class="tool-section">
    <span class="micro-label">Fill</span>

    <CheckField id="st-fill" label="Fill" bind:checked={st.fill} disabled={editor.busy} />

    {#if st.fill}
      <ColorField
        id="st-fill-color"
        label="Fill colour"
        value={st.fillColor}
        disabled={editor.busy}
        onvalue={(next) => (st.fillColor = next)}
      />
    {/if}

    <SliderField
      id="st-opacity"
      label="Opacity"
      value={st.opacity}
      min={0}
      max={100}
      step={1}
      display="{st.opacity}%"
      disabled={editor.busy}
      onvalue={(next) => (st.opacity = next)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Block</span>

    <SliderField
      id="st-wrap"
      label="Wrap width"
      value={st.maxWidth}
      min={0}
      max={st.maxWidthMax}
      step={10}
      display={st.maxWidth === 0 ? "No wrap" : "{st.maxWidth} px"}
      disabled={editor.busy}
      onvalue={(next) => (st.maxWidth = next)}
    />

    <SliderField
      id="st-line-height"
      label="Line height"
      value={st.lineHeight}
      min={0.8}
      max={2.5}
      step={0.05}
      display="{st.lineHeight.toFixed(2)}x"
      disabled={editor.busy}
      onvalue={(next) => (st.lineHeight = next)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Placement</span>

    <div class="tool-row">
      <NumberField
        id="st-x"
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
        id="st-y"
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
      id="st-rotation"
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
      <strong>{Math.round(st.block.width)} x {Math.round(st.block.height)} px</strong>
    </div>

    <p class="tool-note">
      Three handles on the image move, scale and turn the words. Across and Down,
      Text size and Rotation are the same values as controls.
    </p>

    {#if st.overflow.any}
      <p class="tool-note warn">
        The text runs past the {overflowEdges} of the frame. Apply crops it at
        that edge. Centre in the frame to bring it back.
      </p>
    {/if}
  </section>

  {#if st.blockedBy}
    <p class="tool-note">{st.blockedBy}</p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">
      The stage shows the words. Apply draws them into the image and clears the
      text.
    </p>

    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={locked || st.blocked}
      onclick={apply}
    >
      Apply stroke text
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

  /* The one warning in the panel, and it is the one thing that can lose pixels
     without the operator meaning to. */
  .tool-note.warn {
    color: var(--warning);
  }
</style>
