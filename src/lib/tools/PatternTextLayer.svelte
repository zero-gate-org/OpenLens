<script>
  /**
   * Pattern text layer.
   *
   * Lives inside the stage's scaled media box, so every number here is in
   * *image* pixels and the words stay glued to the picture through zoom and
   * pan, exactly like the crop handles.
   *
   * The letters are SVG rather than a canvas: this is a vector composition, not
   * a bitmap, and a backing store the size of a 6000px photo is a waste of
   * memory for something the committed canvas will re-draw anyway. The frame
   * outline is chrome, so it uses `non-scaling-stroke` and stays 1.5 screen px
   * at every zoom. The handle is HTML sized in screen px by dividing by `--s`,
   * the live scale.
   *
   * The clipping is the substance, and it is the SVG's own job here. The
   * glyphs are real `<text>` elements and the fill is `url(#pt-tile)`, so the
   * font supplies the outlines and SVG clips the tile to them. There is no
   * traced path and no approximation: a pattern fill is not a block of ink
   * with holes cut in it, and drawing the letters as shapes would be a second
   * set of glyphs to keep in step with the real ones.
   *
   * The tile is one `<pattern>` in user space, holding the shapes
   * `core/patternfill.js` returns, and it is turned by the same six numbers the
   * commit canvas hands to `CanvasPattern.setTransform`. The tile box is a whole
   * number of image pixels, so the pattern and the canvas tile are the same
   * size and land in phase.
   *
   * The layer is `aria-hidden`: it is a pointer affordance over a picture. The
   * one gesture here, moving the words, has a control of the same name in the
   * panel, which is the keyboard path.
   */
  import { patternText } from "../state/patterntext.svelte.js";
  import { matrixString } from "../core/stroketext.js";
  import { patternTransform, tileShapes } from "../core/patternfill.js";

  const pt = patternText;

  let layer = $state(null);

  /** Trimming the numbers keeps the markup and the matrix strings short. */
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const width = $derived(pt.imageWidth);
  const height = $derived(pt.imageHeight);
  const ready = $derived(width > 0 && height > 0 && pt.hasText);

  const matrix = $derived(matrixString(pt.matrix));

  /** The tile's own turn, as the `matrix(...)` SVG reads it. */
  const tileMatrix = $derived.by(() => {
    const t = patternTransform(pt.def);
    return `matrix(${[t.a, t.b, t.c, t.d, t.e, t.f].map(round2).join(" ")})`;
  });

  const shapes = $derived(tileShapes(pt.def.kind, pt.def.cell));
  const ink = $derived(pt.def.color);

  /** An SVG length attribute takes a string, not a number. */
  const cell = $derived(String(pt.def.cell));

  const moveHandle = $derived({ x: round2(pt.x), y: round2(pt.y) });

  const readout = $derived.by(() => {
    if (!pt.hasText) return "No text";
    if (pt.overflow.any) return `Past the ${pt.overflow.edges[0]} edge`;
    return `${Math.round(pt.block.width)} x ${Math.round(pt.block.height)} px`;
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
    pt.beginDrag(toImagePoint(event));
  }

  function onMove(event) {
    if (!pt.drag) return;
    event.preventDefault();
    pt.moveDrag(toImagePoint(event));
  }

  function onUp(event) {
    if (!pt.drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    pt.endDrag();
  }
</script>

{#if ready}
  <div class="layer" bind:this={layer} aria-hidden="true">
    <svg class="ink" viewBox="0 0 {width} {height}">
      <defs>
        <!--
          One tile, in user space, so its origin is the same place as the
          canvas pattern's origin on the commit canvas. The cell is a whole
          number of image pixels, which is what keeps the two in phase.
        -->
        <pattern
          id="pt-tile"
          width={cell}
          height={cell}
          patternUnits="userSpaceOnUse"
          patternTransform={tileMatrix}
        >
          {#each shapes as shape, index (index)}
            {#if shape.kind === "circle"}
              <circle cx={round2(shape.cx)} cy={round2(shape.cy)} r={round2(shape.r)} fill={ink} />
            {:else}
              <rect
                x={round2(shape.x)}
                y={round2(shape.y)}
                width={round2(shape.w)}
                height={round2(shape.h)}
                fill={ink}
              />
            {/if}
          {/each}
        </pattern>
      </defs>

      <g transform={matrix}>
        <rect
          class="frame"
          x={pt.block.box.x}
          y={pt.block.box.y}
          width={pt.block.box.w}
          height={pt.block.box.h}
        />

        {#each pt.block.glyphs as glyph, index (index)}
          <!-- Real text, clipped by the font's own outline. See the header. -->
          <text
            class="glyph"
            x={round2(glyph.x)}
            y={round2(glyph.y)}
            text-anchor="start"
            font-family={pt.family}
            font-size={pt.size}
            fill="url(#pt-tile)"
          >{glyph.char}</text>
        {/each}
      </g>
    </svg>

    <button
      type="button"
      class="handle move"
      class:active={!!pt.drag}
      tabindex="-1"
      aria-label="Move the text"
      style:left="{moveHandle.x}px"
      style:top="{moveHandle.y}px"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
    ></button>

    <div
      class="badge"
      class:over={pt.overflow.any}
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
    /* Only the handle takes the pointer, so the stage still pans and drops
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

  /* Artwork: scales with the image, and inherits the placement from the
     group that carries it. */
  .glyph {
    white-space: pre;
  }

  /* --- Handle ---------------------------------------------------- */
  .handle {
    position: absolute;
    width: calc(15px / var(--s));
    height: calc(15px / var(--s));
    translate: -50% -50%;
    padding: 0;
    background: transparent;
    pointer-events: auto;
    touch-action: none;
    cursor: grab;
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

  .handle.active::after,
  .handle:hover::after {
    background: var(--accent);
  }

  .handle:focus {
    outline: none;
  }

  .handle.move:active {
    cursor: grabbing;
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