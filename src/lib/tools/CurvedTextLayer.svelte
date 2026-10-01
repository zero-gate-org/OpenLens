<script>
  /**
   * Curved text layer.
   *
   * Lives inside the stage's scaled media box, so every number here is in
   * *image* pixels and the words stay glued to the picture through zoom and
   * pan, exactly like the crop handles.
   *
   * The letters are SVG rather than a canvas: this is a vector composition, not
   * a bitmap, and a backing store the size of a 6000px photo is a waste of
   * memory for something the committed canvas will re-draw anyway. Text and
   * guide strokes that belong to the artwork scale with the image; the guides
   * are chrome, so they use `non-scaling-stroke` and stay 1.5 screen px at
   * every zoom. The handles are HTML sized in screen px by dividing by `--s`,
   * the live scale.
   *
   * The layer is `aria-hidden`: it is a pointer affordance over a picture. Every
   * gesture here, moving the arc centre and sliding the run along the arc, has
   * a control of the same name in the panel, which is the keyboard path.
   */
  import { curvedText } from "../state/curvedtext.svelte.js";
  import { arcPath } from "../core/textarc.js";

  const ct = curvedText;

  let layer = $state(null);

  const width = $derived(ct.imageWidth);
  const height = $derived(ct.imageHeight);
  const ready = $derived(width > 0 && height > 0);
  const placement = $derived(ct.placement);

  /** Trimming the numbers keeps the path and transform strings short. */
  const px = (n) => Math.round(n * 100) / 100;
  const deg = (rad) => px((rad * 180) / Math.PI);

  /** The declared arc: the thing the run is fitted against. */
  const guide = $derived(
    arcPath({
      cx: ct.cx,
      cy: ct.cy,
      radius: ct.radius,
      start: ct.arcStartRad,
      sweep: ct.sweep * (Math.PI / 180),
      direction: ct.direction,
    }),
  );

  /** The arc the run really occupies, which is rarely the same arc. */
  const span = $derived(
    arcPath({
      cx: ct.cx,
      cy: ct.cy,
      radius: ct.radius,
      start: placement.start,
      sweep: placement.sweep,
      direction: ct.direction,
    }),
  );

  const handle = $derived(ct.handle);
  const sweeping = $derived(!ct.hasText ? "No text" : ct.placement.straight ? "Straight" : `${Math.round(ct.textSweepDeg)}° of ${ct.sweep}°`);

  // -------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------

  /** Convert a pointer event into image coordinates. */
  function toImagePoint(event) {
    if (!layer) return { x: 0, y: 0 };
    const rect = layer.getBoundingClientRect();
    const k = rect.width > 0 ? width / rect.width : 1;
    return { x: (event.clientX - rect.left) * k, y: (event.clientY - rect.top) * k };
  }

  function onDown(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    ct.beginDrag(event.currentTarget.dataset.handle, toImagePoint(event));
  }

  function onMove(event) {
    if (!ct.drag) return;
    event.preventDefault();
    ct.moveDrag(toImagePoint(event));
  }

  function onUp(event) {
    if (!ct.drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    ct.endDrag();
  }
</script>

{#if ready}
  <div class="layer" bind:this={layer} aria-hidden="true">
    <svg class="ink" viewBox="0 0 {width} {height}">
      {#if guide}
        <path class="guide" d={guide} />
      {/if}
      {#if span}
        <path class="span" d={span} />
      {/if}

      {#each placement.glyphs as glyph, index (index)}
        <text
          class="glyph"
          x="0"
          y="0"
          text-anchor="middle"
          font-family={ct.family}
          font-size={ct.size}
          font-weight={ct.bold ? 700 : 400}
          font-style={ct.italic ? "italic" : "normal"}
          fill={ct.color}
          stroke={ct.outline ? ct.outlineColor : "none"}
          stroke-width={ct.outline ? ct.outlineWidth : 0}
          stroke-linejoin="round"
          transform="translate({px(glyph.x)} {px(glyph.y)}) rotate({deg(glyph.angle)})"
        >{glyph.char}</text>
      {/each}
    </svg>

    <!-- Handles. The run handle first, so it paints above the centre nub. -->
    <button
      type="button"
      class="handle run"
      class:active={ct.drag?.kind === "run"}
      tabindex="-1"
      aria-label="Move the text along the arc"
      data-handle="run"
      style:left="{px(handle.x)}px"
      style:top="{px(handle.y)}px"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
    ></button>

    <button
      type="button"
      class="handle centre"
      class:active={ct.drag?.kind === "centre"}
      tabindex="-1"
      aria-label="Move the arc centre"
      data-handle="centre"
      style:left="{px(ct.cx)}px"
      style:top="{px(ct.cy)}px"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
    ></button>

    <div class="badge" class:under={handle.y < 48} style:left="{px(handle.x)}px" style:top="{px(handle.y)}px">
      {sweeping}
    </div>
  </div>
{/if}

<style>
  .layer {
    position: absolute;
    inset: 0;
    z-index: var(--z-overlay);
    /* Only the handles take the pointer, so the stage still pans and drops
       through everything the operator has not explicitly grabbed. */
    pointer-events: none;
  }

  .ink {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  /* Chrome, not artwork: constant width whatever the zoom. */
  .guide,
  .span {
    fill: none;
    vector-effect: non-scaling-stroke;
  }

  .guide {
    stroke: rgba(255, 255, 255, 0.5);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
  }

  .span {
    stroke: var(--accent);
    stroke-width: 1.5;
    opacity: 0.9;
  }

  /* Artwork: scales with the image, and stroked before filled so the layer
     matches the committed canvas exactly, where the fill covers the inner half
     of the outline. */
  .glyph {
    paint-order: stroke fill;
    white-space: pre;
  }

  /* --- Handles --------------------------------------------------- */
  .handle {
    position: absolute;
    width: calc(15px / var(--s));
    height: calc(15px / var(--s));
    translate: -50% -50%;
    padding: 0;
    background: transparent;
    pointer-events: auto;
    touch-action: none;
  }

  .handle::after {
    content: "";
    position: absolute;
    inset: calc(3px / var(--s));
    border-radius: 50%;
    background: #ffffff;
    box-shadow:
      0 0 0 calc(1.5px / var(--s)) rgba(5, 9, 11, 0.7),
      0 calc(1px / var(--s)) calc(2px / var(--s)) rgba(5, 9, 11, 0.4);
    transition: background var(--dur-1) var(--ease);
  }

  .handle.run::after {
    background: var(--accent);
  }

  .handle.active::after,
  .handle:hover::after {
    background: var(--accent);
  }

  .handle:focus {
    outline: none;
  }

  .handle.run {
    cursor: grab;
  }

  .handle.run:active {
    cursor: grabbing;
  }

  .handle.centre {
    cursor: move;
  }

  /* --- Sweep readout --------------------------------------------- */
  .badge {
    position: absolute;
    translate: calc(12px / var(--s)) calc(-100% - 9px / var(--s));
    padding: calc(3px / var(--s)) calc(7px / var(--s));
    border-radius: calc(5px / var(--s));
    background: rgba(8, 12, 14, 0.88);
    border: calc(1px / var(--s)) solid rgba(255, 255, 255, 0.14);
    color: var(--text-1);
    font-size: calc(11px / var(--s));
    font-variant-numeric: tabular-nums;
    line-height: 1.3;
    white-space: nowrap;
  }

  .badge.under {
    translate: calc(12px / var(--s)) calc(9px / var(--s));
  }
</style>