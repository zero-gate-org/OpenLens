<script>
  /**
   * Pattern text.
   *
   * Words with a repeating pattern inside them: stripes, checks, dots or a
   * grid, at a size and a turn of the operator's choosing.
   *
   * This tool authors rather than filters, so it mounts a stage layer instead of
   * parking a preview bitmap: the words are drawn over the picture in image
   * coordinates by `PatternTextLayer.svelte`, and the two halves share the
   * `patternText` store. Apply then paints the same placement onto a full
   * resolution canvas and commits it.
   *
   * The clipping is the substance and both renderers take it from the font.
   *
   * `StrokeTextLayer` lays text out from measured advances and paints a solid
   * fill, which needs no outline at all. A pattern fill needs one: the pattern
   * has to stop at the letter. So neither half traces a glyph outline and
   * neither approximates one. The stage layer draws the words as real `<text>`
   * and gives them `fill="url(#pt-tile)"`, so the SVG clips the tile to the
   * outlines the font supplies. The commit canvas below draws the same words
   * with `ctx.fillText` and a `createPattern` fill style, so the canvas clips
   * to the same outlines. Same font, same per-glyph advances from
   * `core/stroketext.js`, same tile geometry from `core/patternfill.js`, same
   * six matrix numbers: the only thing that differs between the two is the
   * drawing surface.
   *
   * Everything here either sets a decision the operator made or measures the
   * run on a canvas. The measurement has to live in this component because it
   * is the only one with a 2D context, and it is redone whenever the font, the
   * size or the tracking changes, because a width taken with the wrong font is
   * the width of some other mark.
   */
  import { onMount, untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import {
    ALIGNMENTS,
    FONT_FAMILIES,
    MAX_PATTERN_SCALE,
    MAX_TEXT_SIZE,
    MIN_PATTERN_SCALE,
    MIN_TEXT_SIZE,
    PATTERN_KINDS,
    VISIBLE_CELL,
    patternText,
  } from "../state/patterntext.svelte.js";
  import { clamp } from "../core/stroketext.js";
  import { measureAdvances } from "../core/textarc.js";
  import { normalizePatternAngle, patternTransform, tileShapes } from "../core/patternfill.js";
  import { context2d, createCanvas, loadImage } from "../core/image.js";
  import { canvasToImageBlob } from "../core/pixels.js";
  import PatternTextLayer from "./PatternTextLayer.svelte";

  import Button from "../components/controls/Button.svelte";
  import ColorField from "../components/controls/ColorField.svelte";
  import NumberField from "../components/controls/NumberField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const pt = patternText;

  /** The edges the words run past, as one readable phrase. */
  const overflowEdges = $derived(pt.overflow.edges.join(" and "));

  /** The tile's turn as the panel shows it, wrapped so a full turn reads 0. */
  const turn = $derived(Math.round(normalizePatternAngle(pt.rotationDeg)));

  // -------------------------------------------------------------------
  // Stage layer
  // -------------------------------------------------------------------

  onMount(() => {
    editor.setStageLayer(PatternTextLayer);
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
    scratch.font = pt.font;

    const run = measureAdvances(pt.text, (char) => scratch.measureText(char).width, pt.letterSpacing);
    const metrics = scratch.measureText("Hxpg");

    // Two browsers, two different answers: some report the font's own bounding
    // box, some report nothing at all. The 80/20 fallback is a plain
    // approximation, and it is only ever used to centre a block, never to
    // decide how wide a letter is.
    const size = Math.max(0, pt.size);
    const ascent = Number.isFinite(metrics.fontBoundingBoxAscent) ? metrics.fontBoundingBoxAscent : size * 0.8;
    const descent = Number.isFinite(metrics.fontBoundingBoxDescent) ? metrics.fontBoundingBoxDescent : size * 0.2;

    return { glyphs: run.glyphs, ascent, descent };
  }

  // Re-measure whenever the font shorthand, the words or the tracking change.
  // `measureRun` reads all three, so they are the effect's dependencies without
  // being named twice: the shorthand carries the family and the size, so a
  // change to either re-measures. Tracking never changes an advance, only the
  // gap between two of them, and it is in here so the measured run and the
  // layout that reads it can never be describing different gaps.
  $effect(() => {
    pt.setRun(measureRun());
  });

  // Seed on activation, and whenever a genuinely new image arrives. Keyed on
  // `editor.epoch`, which moves only on open and discard, so this cannot fire
  // for an image this tool produced itself.
  $effect(() => {
    const active = editor.tool === "patterntext";
    void editor.epoch;
    if (!active) return;
    untrack(() => {
      const image = editor.current;
      if (!image) return;
      pt.sync(image.width, image.height);
      // The size is seeded from the frame, and the run has not been measured
      // at that size yet, so measure it here rather than leaving the block a
      // guess wide for a frame.
      pt.setRun(measureRun());
    });
  });

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  const source = $derived(editor.current);
  const locked = $derived(editor.busy || !source);

  /**
   * Paint the block at image resolution. Mirrors the layer, shape for shape.
   *
   * The tile is drawn into a canvas the size of one cell, with the shapes from
   * `core/patternfill.js` that the layer put inside its `<pattern>`. Same list,
   * same order, same cell, so the two tiles are the same drawing.
   *
   * The tile's turn goes on the pattern rather than on the context, because the
   * words themselves are not turned: `CanvasPattern.setTransform` turns the tile
   * inside the fill exactly as SVG's `patternTransform` does, and both sides get
   * their six numbers from the same `patternTransform` helper.
   */
  function paint(ctx) {
    if (!pt.hasText) return;

    const def = pt.def;
    const tile = createCanvas(def.cell, def.cell);
    const tileCtx = context2d(tile);
    tileCtx.fillStyle = def.color;

    for (const shape of tileShapes(def.kind, def.cell)) {
      if (shape.kind === "circle") {
        tileCtx.beginPath();
        tileCtx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
        tileCtx.fill();
      } else {
        tileCtx.fillRect(shape.x, shape.y, shape.w, shape.h);
      }
    }

    const pattern = ctx.createPattern(tile, "repeat");
    if (!pattern) {
      // No pattern support, or a tile the browser refused. The words still
      // want to be there, so they go down in flat ink rather than vanishing.
      ctx.save();
      const m = pt.matrix;
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.font = pt.font;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = def.color;
      for (const glyph of pt.block.glyphs) ctx.fillText(glyph.char, glyph.x, glyph.y);
      ctx.restore();
      return;
    }

    const turn = patternTransform(def);
    pattern.setTransform(new DOMMatrix([turn.a, turn.b, turn.c, turn.d, turn.e, turn.f]));

    ctx.save();
    const m = pt.matrix;
    // A translation and nothing else, so the tile's origin is the same point
    // here as it is inside the layer's transformed group.
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.font = pt.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = pattern;

    for (const glyph of pt.block.glyphs) {
      ctx.fillText(glyph.char, glyph.x, glyph.y);
    }

    ctx.restore();
  }

  async function apply() {
    if (!source || locked || pt.blocked) return;
    const image = source;

    const done = await editor.run("Pattern Text", async (report) => {
      report("Decoding", 0.2);
      const decoded = await loadImage(image.blob);

      report("Filling the text", 0.6);
      const canvas = createCanvas(image.width, image.height);
      const ctx = context2d(canvas);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(decoded, 0, 0, image.width, image.height);
      paint(ctx);

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(canvas, image);
      await editor.commit(blob, "Pattern Text", image.name);
    });

    // The words are in the pixels now, so the layer stops drawing them.
    if (done) pt.bake();
  }

  /**
   * The scale slider runs in hundredths, so its step is a round 0.01 of the
   * base cell rather than 0.005, and the value is clamped here rather than
   * trusted, because a scale of zero is a scale the tool will not draw.
   */
  function onScale(next) {
    pt.scale = clamp(Number((next / 100).toFixed(2)), MIN_PATTERN_SCALE, MAX_PATTERN_SCALE);
  }
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Words</span>

    <div class="field">
      <label class="name" for="pt-text">Text</label>
      <textarea
        id="pt-text"
        rows="2"
        spellcheck="false"
        value={pt.text}
        placeholder="Pattern Text"
        disabled={editor.busy}
        oninput={(event) => (pt.text = event.currentTarget.value)}
      ></textarea>
    </div>

    <SelectField
      id="pt-font"
      label="Font"
      value={pt.family}
      options={FONT_FAMILIES}
      disabled={editor.busy}
      onvalue={(next) => (pt.family = next)}
    />

    <SliderField
      id="pt-size"
      label="Text size"
      value={pt.size}
      min={MIN_TEXT_SIZE}
      max={MAX_TEXT_SIZE}
      step={1}
      display="{pt.size} px"
      disabled={editor.busy}
      onvalue={(next) => (pt.size = next)}
    />

    <SliderField
      id="pt-tracking"
      label="Letter spacing"
      value={pt.letterSpacing}
      min={-40}
      max={pt.trackingMax}
      step={1}
      display="{pt.letterSpacing} px"
      disabled={editor.busy}
      onvalue={(next) => (pt.letterSpacing = next)}
    />

    <Segmented
      name="pt-align"
      label="Align on the anchor"
      columns={3}
      options={ALIGNMENTS}
      value={pt.align}
      disabled={editor.busy}
      onvalue={(next) => (pt.align = next)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Pattern</span>

    <SelectField
      id="pt-pattern"
      label="Fill"
      value={pt.pattern}
      options={PATTERN_KINDS}
      disabled={editor.busy}
      onvalue={(next) => (pt.pattern = next)}
    />

    <ColorField
      id="pt-ink"
      label="Ink colour"
      value={pt.color}
      disabled={editor.busy}
      onvalue={(next) => (pt.color = next)}
    />

    <SliderField
      id="pt-scale"
      label="Pattern scale"
      value={Math.round(pt.scale * 100)}
      min={Math.round(MIN_PATTERN_SCALE * 100)}
      max={Math.round(MAX_PATTERN_SCALE * 100)}
      step={1}
      display="{pt.scale.toFixed(2)}x"
      disabled={editor.busy}
      onvalue={onScale}
    />

    <!--
      The slider's top stop is a full turn, which is the same picture as no turn
      at all, so the readout shows the normalised angle. 360 therefore reads
      0°, which is what the tile actually does.
    -->
    <SliderField
      id="pt-rotation"
      label="Pattern rotation"
      value={turn}
      min={0}
      max={360}
      step={1}
      display="{turn}°"
      disabled={editor.busy}
      onvalue={(next) => (pt.rotationDeg = next)}
    />

    <div class="tool-result">
      <span>Pattern cell</span>
      <strong>{pt.cellPx} px</strong>
    </div>

    <p class="tool-note">
      One ink colour. The gaps between the marks are left alone, so the picture
      shows through them.
    </p>

    {#if pt.tooFine}
      <p class="tool-note warn">
        A {pt.cellPx} px cell is finer than {VISIBLE_CELL} px, so the marks blur
        together and the fill reads as a flat tone. Raise the scale to see the
        pattern again.
      </p>
    {/if}
  </section>

  <section class="tool-section">
    <span class="micro-label">Placement</span>

    <div class="tool-row">
      <NumberField
        id="pt-x"
        label="Across"
        value={pt.x}
        min={-pt.axisMax}
        max={pt.axisMax}
        step={1}
        suffix="px"
        disabled={editor.busy}
        onvalue={(next) => (pt.x = next)}
      />
      <NumberField
        id="pt-y"
        label="Down"
        value={pt.y}
        min={-pt.axisMax}
        max={pt.axisMax}
        step={1}
        suffix="px"
        disabled={editor.busy}
        onvalue={(next) => (pt.y = next)}
      />
    </div>

    <Button variant="secondary" size="sm" full disabled={editor.busy} onclick={() => pt.centre()}>
      Centre in the frame
    </Button>

    <div class="tool-result">
      <span>{pt.block.lineCount} {pt.block.lineCount === 1 ? "line" : "lines"}</span>
      <strong>{Math.round(pt.block.width)} x {Math.round(pt.block.height)} px</strong>
    </div>

    <p class="tool-note">
      The dot on the image moves the words. Across and Down, Text size and
      Letter spacing are the same values as controls.
    </p>

    {#if pt.overflow.any}
      <p class="tool-note warn">
        The text runs past the {overflowEdges} of the frame. Apply crops it at
        that edge. Centre in the frame to bring it back.
      </p>
    {/if}
  </section>

  {#if pt.blockedBy}
    <p class="tool-note">{pt.blockedBy}</p>
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
      disabled={locked || pt.blocked}
      onclick={apply}
    >
      Apply pattern text
    </Button>

    <Button variant="quiet" size="sm" full disabled={editor.busy} onclick={() => pt.reset()}>
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

  /* The two warnings in the panel, and they are the two things that can lose
     the look of the fill without the operator meaning to. */
  .tool-note.warn {
    color: var(--warning);
  }
</style>