<script>
  /**
   * Photo Frame: a matting border around the picture, with an optional caption.
   *
   * This tool authors rather than filters, so it does not park a preview bitmap
   * on the stage. A frame *grows* the picture, so it cannot be drawn over the
   * picture's box either: the border is outside the media box `Stage.svelte`
   * scales and fits, and reading that component shows why (the stage clips at
   * its own bounds, the checkerboard lives on `.viewport`, and `fitScale` and
   * `panLimit` both describe the image without the frame). The full reasoning is
   * in the header of `PhotoFrameLayer.svelte`, which is the panel's own preview
   * surface.
   *
   * What this file owns is therefore: the decisions (in
   * `state/photoframe.svelte.js`), one decode, and one painting routine that
   * both the preview and the commit call, the preview scaled down and the commit
   * at 1:1. Everything about *where* the frame is lives in `core/framegeom.js`,
   * which is pure and unit tested.
   *
   * The legacy tool carried a frame type per decoration (neon, filmstrip,
   * magazine, decorative, instax) plus a rotation control. Those are not here:
   * a rotation was drawn on the preview and never exported, and the decorations
   * either painted noise over the photograph or stamped decoration over the mat.
   * What is left is the part that defines a frame, and every number that decides
   * it is a visible control.
   */
  import { onMount, untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { ALIGNS, FONT_FAMILIES, PRESETS, photoFrame } from "../state/photoframe.svelte.js";
  import { context2d, createCanvas, loadImage } from "../core/image.js";
  import { canvasToImageBlob } from "../core/pixels.js";
  import { captionLines, hexToRgba, maxCorner } from "../core/framegeom.js";
  import PhotoFrameLayer from "./PhotoFrameLayer.svelte";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import ColorField from "../components/controls/ColorField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const pf = photoFrame;

  const source = $derived(editor.current);
  const geometry = $derived(pf.geometry);
  const locked = $derived(editor.busy || !source);
  const blocked = $derived(pf.blockedBy !== null);

  /** JPEG has no alpha, so a transparent mat would land on black. */
  const flattenWarn = $derived(
    pf.transparentBg && source?.format === "jpeg"
      ? "This picture is a JPEG, which cannot hold transparency, so the area behind the frame exports as black. Convert it to PNG or WebP first if that matters."
      : null,
  );

  const radiusMax = $derived(Math.max(64, Math.round(maxCorner(geometry.width, geometry.height) / 4)));
  const shadowMax = $derived(Math.max(8, Math.round(pf.borderMax / 2)));

  // -------------------------------------------------------------------
  // Seeding and teardown
  // -------------------------------------------------------------------

  onMount(() => {
    // Today's date, once. Reading the clock on every render would let the
    // caption change under the operator at midnight, and the preview would stop
    // matching the export.
    pf.today = new Date().toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    // Measuring a caption needs a 2D context, and this is the only component
    // with one. The scratch context is one pixel: it is only ever asked how wide
    // a run is.
    const scratch = context2d(createCanvas(1, 1));
    pf.setMeasure((text, size) => {
      // The font is set before every measurement, at the size being asked for,
      // because a width taken with the wrong font or the wrong size is the
      // width of some other mark.
      scratch.font = pf.fontFor(size, pf.isDateSize(size));
      return scratch.measureText(text).width;
    });

    return () => {
      // No layer of this tool's own to release, but the same two calls every
      // authoring tool makes: whatever is on the stage when this panel goes
      // belongs to somebody else, or to nobody, and neither should outlive it.
      editor.clearStageLayer();
      editor.clearPreview();
      pf.setMeasure(null);
    };
  });

  // Seed on activation, and whenever a genuinely new image arrives. Keyed on
  // `editor.epoch`, which moves only on open and discard, so this cannot fire
  // for an image this tool produced itself.
  $effect(() => {
    const active = editor.tool === "photoframe";
    void editor.epoch;
    if (!active) return;
    untrack(() => {
      const image = editor.current;
      if (image) pf.sync(image.width, image.height);
    });
  });

  // -------------------------------------------------------------------
  // The picture on stage
  // -------------------------------------------------------------------

  let decoded = $state(null);
  /**
   * The blob `decoded` came from, so the commit can reuse it and the preview
   * knows it has something to draw.
   */
  let decodedBlob = $state(null);
  /** Bumped when a decode lands, so the preview repaints. */
  let decodeTick = $state(0);
  let decodePromise = null;
  let decodeBlob = null;

  $effect(() => {
    const image = editor.current;
    if (!image) {
      decoded = null;
      decodedBlob = null;
      return;
    }

    // One decode per blob, so dragging a slider never re-reads the file.
    if (decodeBlob !== image.blob) {
      decodeBlob = image.blob;
      decodedBlob = null;
      decodePromise = loadImage(image.blob).catch(() => null);
    }

    let live = true;
    decodePromise.then((element) => {
      if (!live) return;
      decoded = element;
      decodedBlob = image.blob;
      decodeTick += 1;
    });
    return () => {
      live = false;
    };
  });

  // -------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------

  /** Rounded rectangle as a path. A zero radius is a plain rectangle. */
  function matPath(ctx, width, height, radius) {
    ctx.beginPath();
    if (radius <= 0) {
      ctx.rect(0, 0, width, height);
      return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(r, 0);
    ctx.lineTo(width - r, 0);
    ctx.arcTo(width, 0, width, r, r);
    ctx.lineTo(width, height - r);
    ctx.arcTo(width, height, width - r, height, r);
    ctx.lineTo(r, height);
    ctx.arcTo(0, height, 0, height - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
    ctx.closePath();
  }

  /**
   * Draw the frame and the caption at output coordinates.
   *
   * The context is already scaled by `scale`, so every number here is in output
   * pixels whether this is the panel's preview or the full resolution export.
   * That is what makes the preview trustworthy: it is the same drawing at a
   * smaller size, not a second description of it.
   */
  function paintFrame(ctx, scale, image, frame) {
    const { width, height, opening, radius } = frame;

    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // 1. The mat, and the shadow it casts.
    //
    // A transparent mat has no body, so there is nothing for a shadow to fall
    // from and it is simply not drawn. The shadow is drawn *inside* the output
    // box rather than growing it, because the output size is the picture plus
    // the borders and nothing else; the panel says so.
    if (!pf.transparentBg) {
      ctx.save();
      if (pf.shadowDrawn) {
        ctx.shadowColor = hexToRgba(pf.shadowColor, pf.shadowOpacity / 100);
        ctx.shadowBlur = pf.shadowBlur;
        ctx.shadowOffsetX = pf.shadowX;
        ctx.shadowOffsetY = pf.shadowY;
      }
      ctx.fillStyle = pf.bgColor;
      matPath(ctx, width, height, radius);
      ctx.fill();
      ctx.restore();
    }

    // 2. The picture, clipped to the mat silhouette so the corners round off
    //    with the frame rather than overhanging it.
    ctx.save();
    matPath(ctx, width, height, radius);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, opening.x, opening.y, opening.w, opening.h);
    ctx.restore();

    // 3. The caption, in the bottom band.
    paintCaption(ctx);

    ctx.restore();
  }

  function paintCaption(ctx) {
    const band = pf.band;
    const layout = pf.caption;
    if (!band || (!layout.primary && !layout.secondary)) return;

    ctx.save();
    // Belt and braces for the one promise that matters: nothing is ever written
    // over the picture. Even a line too wide for its band is cut at the band
    // edge, and the panel says so rather than letting it happen quietly.
    ctx.beginPath();
    ctx.rect(band.x, band.y, band.w, band.h);
    ctx.clip();
    ctx.textBaseline = "middle";

    for (const line of captionLines(layout)) {
      const isDate = line === layout.secondary;
      ctx.font = pf.fontFor(line.size, isDate);
      ctx.fillStyle = isDate ? hexToRgba(pf.captionColor, 0.72) : pf.captionColor;
      ctx.textAlign = line.align;
      ctx.fillText(line.text, line.x, line.y);
    }

    ctx.restore();
  }

  function paintPreview(ctx, scale) {
    if (!decoded || !decodedBlob) return;
    paintFrame(ctx, scale, decoded, geometry);
  }

  /**
   * Everything that affects the drawing, as one string.
   *
   * The preview effect depends on this rather than on a list of `void` reads, so
   * a control cannot be added and then forgotten.
   */
  const sig = $derived(
    [
      decodedBlob ? 1 : 0,
      decodeTick,
      pf.imageWidth,
      geometry.width,
      geometry.height,
      geometry.radius,
      geometry.borders.top,
      geometry.borders.right,
      geometry.borders.bottom,
      geometry.borders.left,
      pf.bgColor,
      pf.transparentBg,
      pf.shadowDrawn,
      pf.shadowColor,
      pf.shadowBlur,
      pf.shadowX,
      pf.shadowY,
      pf.shadowOpacity,
      pf.captionText,
      pf.captionDate,
      pf.captionFamily,
      pf.captionSize,
      pf.captionColor,
      pf.captionAlign,
      pf.captionBold,
      pf.captionItalic,
      pf.captionPosition,
      pf.today,
    ].join("|"),
  );

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  async function apply() {
    if (!source || locked || blocked || !decodedBlob) return;
    const image = source;
    const frame = pf.geometry;

    const done = await editor.run("Photo Frame", async (report) => {
      report("Building the frame", 0.35);
      // Reuse the decode when it is the same blob. Otherwise a fresh one is
      // decoded here, because a stale element would paste the previous picture
      // into a brand new frame.
      const picture = decoded && decodedBlob === image.blob ? decoded : await loadImage(image.blob);
      if (!picture) throw new Error("That picture could not be decoded.");

      const canvas = createCanvas(frame.width, frame.height);
      paintFrame(context2d(canvas), 1, picture, frame);

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(canvas, image);
      await editor.commit(blob, "Photo Frame", image.name);
    });

    if (!done) return;

    // The frame is in the pixels now, so the settings go back to the starting
    // look for the new, larger picture. Leaving them would frame the frame on
    // the very next repaint.
    pf.sync(frame.width, frame.height, true);
  }
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Preview</span>

    <PhotoFrameLayer
      width={geometry.width}
      height={geometry.height}
      {sig}
      paint={paintPreview}
      label="Framed result"
      empty="No frame yet"
    />

    <div class="tool-result">
      <span>From {geometry.picture.width} × {geometry.picture.height}</span>
      <strong>{geometry.width} × {geometry.height}</strong>
    </div>

    {#each pf.notes as note (note.text)}
      <p class="tool-note warn">{note.text}</p>
    {/each}

    {#if flattenWarn}
      <p class="tool-note warn">{flattenWarn}</p>
    {/if}
  </section>

  <section class="tool-section">
    <span class="micro-label">Presets</span>
    <div class="tool-chips">
      {#each PRESETS as preset, index (preset.name)}
        <button
          type="button"
          class="tool-chip"
          class:on={pf.presetIndex === index}
          aria-pressed={pf.presetIndex === index}
          disabled={editor.busy}
          onclick={() => pf.usePreset(preset)}
        >
          {preset.name}
        </button>
      {/each}
    </div>
  </section>

  <section class="tool-section">
    <span class="micro-label">Border</span>

    <CheckField
      id="pf-uniform"
      label="Same width on every side"
      bind:checked={pf.uniform}
      disabled={editor.busy}
    />

    {#if pf.uniform}
      <SliderField
        id="pf-border-uniform"
        label="Border width"
        value={pf.uniformSize}
        min={0}
        max={pf.borderMax}
        step={1}
        display="{pf.uniformSize} px"
        disabled={editor.busy}
        onvalue={(next) => (pf.uniformSize = next)}
      />
    {:else}
      <div class="tool-row">
        <SliderField
          id="pf-border-top"
          label="Top"
          value={pf.edges.top}
          min={0}
          max={pf.borderMax}
          step={1}
          display="{pf.edges.top} px"
          disabled={editor.busy}
          onvalue={(next) => (pf.edges = { ...pf.edges, top: next })}
        />
        <SliderField
          id="pf-border-bottom"
          label="Bottom"
          value={pf.edges.bottom}
          min={0}
          max={pf.borderMax}
          step={1}
          display="{pf.edges.bottom} px"
          disabled={editor.busy}
          onvalue={(next) => (pf.edges = { ...pf.edges, bottom: next })}
        />
      </div>

      <div class="tool-row">
        <SliderField
          id="pf-border-left"
          label="Left"
          value={pf.edges.left}
          min={0}
          max={pf.borderMax}
          step={1}
          display="{pf.edges.left} px"
          disabled={editor.busy}
          onvalue={(next) => (pf.edges = { ...pf.edges, left: next })}
        />
        <SliderField
          id="pf-border-right"
          label="Right"
          value={pf.edges.right}
          min={0}
          max={pf.borderMax}
          step={1}
          display="{pf.edges.right} px"
          disabled={editor.busy}
          onvalue={(next) => (pf.edges = { ...pf.edges, right: next })}
        />
      </div>
    {/if}

    <p class="tool-note">
      The border is added around the picture, so the output is larger than the
      input. A caption sits in the bottom band.
    </p>
  </section>

  <section class="tool-section">
    <span class="micro-label">Mat</span>

    <ColorField
      id="pf-bg"
      label="Frame colour"
      value={pf.bgColor}
      disabled={editor.busy}
      onvalue={(next) => (pf.bgColor = next)}
    />

    <CheckField
      id="pf-transparent"
      label="Transparent behind the frame"
      bind:checked={pf.transparentBg}
      disabled={editor.busy}
    />

    <SliderField
      id="pf-radius"
      label="Corner radius"
      value={pf.cornerRadius}
      min={0}
      max={radiusMax}
      step={1}
      display="{pf.cornerRadius} px"
      disabled={editor.busy}
      onvalue={(next) => (pf.cornerRadius = next)}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Shadow</span>

    {#if pf.transparentBg}
      <p class="tool-note">
        A transparent mat has no body to cast a shadow from, so the shadow is off.
      </p>
    {:else}
      <CheckField
        id="pf-shadow"
        label="Drop shadow"
        bind:checked={pf.shadowEnabled}
        disabled={editor.busy}
      />

      {#if pf.shadowEnabled}
        <ColorField
          id="pf-shadow-colour"
          label="Shadow colour"
          value={pf.shadowColor}
          disabled={editor.busy}
          onvalue={(next) => (pf.shadowColor = next)}
        />

        <div class="tool-row">
          <SliderField
            id="pf-shadow-blur"
            label="Blur"
            value={pf.shadowBlur}
            min={0}
            max={shadowMax}
            step={1}
            display="{pf.shadowBlur} px"
            disabled={editor.busy}
            onvalue={(next) => (pf.shadowBlur = next)}
          />
          <SliderField
            id="pf-shadow-opacity"
            label="Opacity"
            value={pf.shadowOpacity}
            min={0}
            max={100}
            step={1}
            display="{pf.shadowOpacity} %"
            disabled={editor.busy}
            onvalue={(next) => (pf.shadowOpacity = next)}
          />
        </div>

        <div class="tool-row">
          <SliderField
            id="pf-shadow-x"
            label="Across"
            value={pf.shadowX}
            min={-shadowMax}
            max={shadowMax}
            step={1}
            display="{pf.shadowX} px"
            disabled={editor.busy}
            onvalue={(next) => (pf.shadowX = next)}
          />
          <SliderField
            id="pf-shadow-y"
            label="Down"
            value={pf.shadowY}
            min={-shadowMax}
            max={shadowMax}
            step={1}
            display="{pf.shadowY} px"
            disabled={editor.busy}
            onvalue={(next) => (pf.shadowY = next)}
          />
        </div>

        <p class="tool-note">
          The shadow falls inside the framed picture's own box, so a large offset
          is cut off at the edges.
        </p>
      {/if}
    {/if}
  </section>

  <section class="tool-section">
    <span class="micro-label">Caption</span>

    <div class="field">
      <label class="name" for="pf-caption-text">Caption</label>
      <input
        id="pf-caption-text"
        type="text"
        maxlength="120"
        value={pf.captionText}
        placeholder="Summer 2026"
        disabled={editor.busy}
        oninput={(event) => (pf.captionText = event.currentTarget.value)}
      />
    </div>

    <CheckField
      id="pf-caption-date"
      label="Add today's date"
      bind:checked={pf.captionDate}
      disabled={editor.busy}
    />

    <SelectField
      id="pf-caption-font"
      label="Font"
      value={pf.captionFamily}
      options={FONT_FAMILIES}
      disabled={editor.busy}
      onvalue={(next) => (pf.captionFamily = next)}
    />

    <SliderField
      id="pf-caption-size"
      label="Type size"
      value={pf.captionSize}
      min={8}
      max={160}
      step={1}
      display="{pf.captionSize} px"
      disabled={editor.busy}
      onvalue={(next) => (pf.captionSize = next)}
    />

    <ColorField
      id="pf-caption-colour"
      label="Type colour"
      value={pf.captionColor}
      disabled={editor.busy}
      onvalue={(next) => (pf.captionColor = next)}
    />

    <Segmented
      name="pf-caption-align"
      label="Alignment"
      columns={3}
      options={ALIGNS}
      value={pf.captionAlign}
      disabled={editor.busy}
      onvalue={(next) => (pf.captionAlign = next)}
    />

    <div class="tool-row">
      <CheckField id="pf-caption-bold" label="Bold" bind:checked={pf.captionBold} disabled={editor.busy} />
      <CheckField id="pf-caption-italic" label="Italic" bind:checked={pf.captionItalic} disabled={editor.busy} />
    </div>

    <SliderField
      id="pf-caption-position"
      label="Vertical position"
      value={pf.captionPosition}
      min={0}
      max={100}
      step={1}
      display="{pf.captionPosition} %"
      disabled={editor.busy}
      onvalue={(next) => (pf.captionPosition = next)}
    />

    {#if pf.hasCaption}
      <div class="tool-result">
        <span>{pf.caption.secondary ? "Caption and date" : "Caption"}</span>
        <strong>{Math.round(pf.caption.primary?.size ?? pf.caption.secondary.size)} px</strong>
      </div>
    {/if}
  </section>

  {#if blocked}
    <p class="tool-note warn">{pf.blockedBy}</p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">
      The preview is the whole output. Apply makes it the image, larger than it is now.
    </p>

    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={locked || blocked || !decodedBlob}
      onclick={apply}
    >
      Apply frame
    </Button>

    <Button variant="quiet" size="sm" full disabled={editor.busy} onclick={() => pf.reset()}>
      Reset
    </Button>
  </div>
</div>

<style>
  /* The caption is the one control with no shared field to reach for: there is
     no TextField in the control set, and a caption tool without editable text
     is not one. Styled from the same tokens as the selects so it does not read as
     a different kind of control. */
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

  /* The one warning in the panel. Every note here is a thing that was clamped
     or left out, which is exactly what must never happen quietly. */
  .tool-note.warn {
    color: var(--warning);
  }
</style>