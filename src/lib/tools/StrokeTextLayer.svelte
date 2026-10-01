<script>
  /**
   * Stroke text layer.
   *
   * Lives inside the stage's scaled media box, so every number here is in
   * *image* pixels and the words stay glued to the picture through zoom and
   * pan, exactly like the crop handles.
   *
   * The letters are SVG rather than a canvas: this is a vector composition, not
   * a bitmap, and a backing store the size of a 6000px photo is a waste of
   * memory for something the committed canvas will re-draw anyway. Text and the
   * selection box belong to the artwork, so they scale with the image; the box
   * outline is chrome, so it uses `non-scaling-stroke` and stays 1.5 screen px
   * at every zoom. The handles are HTML sized in screen px by dividing by
   * `--s`, the live scale.
   *
   * The `paint-order` below is the layer's half of the paint order decision,
   * and it is read off the same `ops` list the commit canvas walks, so the
   * preview and the committed pixels agree about which of stroke and fill goes
   * down first. `stroke-width` is the full width, centred on the outline, which
   * is also what `strokeText` and `lineWidth` mean, so the two renderers match
   * without a fudge factor.
   *
   * The layer is `aria-hidden`: it is a pointer affordance over a picture. Every
   * gesture here, moving the block, scaling it and turning it, has a control of
   * the same name in the panel, which is the keyboard path.
   */
  import { strokeText } from "../state/stroketext.svelte.js";
  import { MITER_LIMIT, boxCorner, matrixString } from "../core/stroketext.js";

  const st = strokeText;

  let layer = $state(null);

  /** Trimming the numbers keeps the markup and the matrix strings short. */
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const width = $derived(st.imageWidth);
  const height = $derived(st.imageHeight);
  const ready = $derived(width > 0 && height > 0 && st.hasText);
  const matrix = $derived(matrixString(st.matrix));
  const box = $derived(st.box);

  /**
   * The CSS `paint-order` for the words, read straight off `ops`.
   *
   * `["stroke", "fill"]` spells `stroke fill` and `["fill", "stroke"]` spells
   * `fill stroke`, which is the whole of what the operator picked. Reading the
   * op list rather than the `paintOrder` value again is deliberate: the commit
   * canvas walks the same list, so the preview and the committed pixels cannot
   * disagree about which of the two goes down first. A run with no stroke gives
   * a single value, which is valid and draws no outline.
   */
  const paintOrder = $derived(st.ops.join(" "));

  /** An SVG length attribute takes a string, not a number. */
  const miter = String(MITER_LIMIT);

  /** Where the three handles sit, all read off the placement matrix. */
  const moveHandle = $derived({ x: round2(st.x), y: round2(st.y) });
  const scaleHandle = $derived(boxCorner(st.block.box, st.matrix, "se"));
  const rotateHandle = $derived(boxCorner(st.block.box, st.matrix, "n"));

  const readout = $derived.by(() => {
    if (!st.hasText) return "No text";
    if (st.overflow.any) return `Past the ${st.overflow.edges[0]} edge`;
    return `${Math.round(st.block.width)} x ${Math.round(st.block.height)} px`;
  });

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
    st.beginDrag(event.currentTarget.dataset.handle, toImagePoint(event));
  }

  function onMove(event) {
    if (!st.drag) return;
    event.preventDefault();
    st.moveDrag(toImagePoint(event));
  }

  function onUp(event) {
    if (!st.drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    st.endDrag();
  }
</script>

{#if ready}
  <div class="layer" bind:this={layer} aria-hidden="true">
    <svg class="ink" viewBox="0 0 {width} {height}">
      <g transform={matrix} style:paint-order={paintOrder}>
        <rect
          class="frame"
          x={st.block.box.x}
          y={st.block.box.y}
          width={st.block.box.w}
          height={st.block.box.h}
        />

        {#each st.block.glyphs as glyph, index (index)}
          <text
            class="glyph"
            x={round2(glyph.x)}
            y={round2(glyph.y)}
            text-anchor="start"
            font-family={st.family}
            font-size={st.size}
            font-weight={st.bold ? 700 : 400}
            font-style={st.italic ? "italic" : "normal"}
            fill={st.fill ? st.fillColor : "none"}
            stroke={st.hasStroke ? st.strokeColor : "none"}
            stroke-width={st.paintWidth}
            stroke-linejoin={st.lineJoin}
            stroke-miterlimit={miter}
            opacity={st.opacity / 100}
          >{glyph.char}</text>
        {/each}
      </g>
    </svg>

    <!-- The rotate handle first, so it paints under the block's own nub. -->
    <button
      type="button"
      class="handle rotate"
      class:active={st.drag?.kind === "rotate"}
      tabindex="-1"
      aria-label="Turn the text"
      data-handle="rotate"
      style:left="{round2(rotateHandle.x)}px"
      style:top="{round2(rotateHandle.y)}px"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
    ></button>

    <button
      type="button"
      class="handle scale"
      class:active={st.drag?.kind === "scale"}
      tabindex="-1"
      aria-label="Scale the text"
      data-handle="scale"
      style:left="{round2(scaleHandle.x)}px"
      style:top="{round2(scaleHandle.y)}px"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
    ></button>

    <button
      type="button"
      class="handle move"
      class:active={st.drag?.kind === "move"}
      tabindex="-1"
      aria-label="Move the text"
      data-handle="move"
      style:left="{moveHandle.x}px"
      style:top="{moveHandle.y}px"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
    ></button>

    <div
      class="badge"
      class:over={st.overflow.any}
      class:under={moveHandle.y < 48}
      style:left="{moveHandle.x}px"
      style:top="{moveHandle.y}px"
    >
      {readout}
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
    /* The words may run off the frame, and the panel says so, so the layer
       shows them rather than hiding the overflow at the frame edge. */
    overflow: visible;
  }

  /* Chrome, not artwork: constant width whatever the zoom. */
  .frame {
    fill: none;
    stroke: rgba(255, 255, 255, 0.55);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
    vector-effect: non-scaling-stroke;
  }

  /* Artwork: scales with the image. The paint order is not declared here but
     read off the same `ops` list the commit canvas walks, so the layer is the
     committed picture rather than an impression of it. `paint-order` inherits
     into the glyphs from the group that sets it. */
  .glyph {
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

  .handle.scale::after {
    background: var(--accent);
  }

  .handle.rotate::after {
    background: var(--warning);
  }

  .handle.active::after,
  .handle:hover::after {
    background: var(--accent);
  }

  .handle:focus {
    outline: none;
  }

  .handle.move {
    cursor: grab;
  }

  .handle.move:active {
    cursor: grabbing;
  }

  .handle.scale {
    cursor: nwse-resize;
  }

  .handle.rotate {
    cursor: alias;
  }

  /* --- Readout --------------------------------------------------- */
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

  .badge.over {
    border-color: color-mix(in srgb, var(--danger) 55%, transparent);
    color: var(--danger);
  }

  .badge.under {
    translate: calc(12px / var(--s)) calc(9px / var(--s));
  }
</style>
