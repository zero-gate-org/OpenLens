<script>
  /**
   * Stickers layer.
   *
   * Lives inside the stage's scaled media box, so every number here is in
   * *image* pixels and the marks stay glued to the picture through zoom and
   * pan, exactly like the crop handles.
   *
   * The marks are SVG rather than a canvas: a catalogue of vector marks is a
   * vector composition, not a bitmap, and a backing store the size of a 6000px
   * photo is a waste of memory for something the committed canvas re-draws
   * anyway. Each mark is one `<g>` carrying the `matrix(...)` from
   * `core/stickerkit.js`, which is the same six numbers the commit canvas hands
   * to `ctx.transform`, so the preview and the committed pixels cannot drift
   * apart.
   *
   * Marks belong to the artwork, so they scale with the image. The selection
   * outline is chrome, so it uses `non-scaling-stroke` and stays 1.5 screen px
   * at every zoom. The handles are HTML sized in screen px by dividing by
   * `--s`, the live scale.
   *
   * The layer is `aria-hidden`: it is a pointer affordance over a picture. Every
   * gesture here, moving a mark, scaling it, turning it, picking it out of the
   * stack and deleting it, has a control of the same name in the panel, which
   * is the keyboard path.
   */
  import { stickers } from "../state/stickers.svelte.js";
  import {
    clampRotation,
    frameStatus,
    itemBox,
    itemDefinition,
    matrixString,
    placementMatrix,
    viewBoxSize,
  } from "../core/stickerkit.js";

  const sk = stickers;

  /**
   * How far above a mark's centre the rotate handle sits, as a fraction of the
   * mark's own height. Half the height puts it a clear half-height above the top
   * edge, so it never lands on the mark it belongs to.
   */
  const ROTATE_GAP_RATIO = 0.75;

  let layer = $state(null);

  const width = $derived(sk.imageWidth);
  const height = $derived(sk.imageHeight);
  const ready = $derived(width > 0 && height > 0 && sk.items.length > 0);

  /** Trimming the numbers keeps the markup and the matrix strings short. */
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  /**
   * The marks to draw, with their matrices resolved.
   *
   * A key the catalogue no longer holds is dropped here rather than guarded at
   * every draw call: one place decides what is renderable, so a stale item
   * cannot reach an SVG `transform` as `undefined`. The store keeps such an
   * item in the list and the panel says it cannot be drawn.
   */
  const drawn = $derived(
    sk.drawing
      .map((item) => {
        const def = itemDefinition(item);
        if (!def) return null;
        return { id: item.id, def, matrix: matrixString(placementMatrix(item, def)) };
      })
      .filter(Boolean),
  );

  /** The selection's outline and its three handles, or null. */
  const selection = $derived.by(() => {
    const item = sk.selected;
    const def = itemDefinition(item);
    // A hidden mark is not drawn, so it must not be drawn around either: the
    // outline and handles would sit on the picture marking a spot that is empty.
    if (!item || !def || item.visible === false) return null;

    const matrix = placementMatrix(item, def);
    const { w: vw, h: vh } = viewBoxSize(def);
    // The four corners of the mark in its own frame, mapped onto the picture.
    // This is the honest outline: a mark that is turned or mirrored is not a
    // rectangle on the image, and a box drawn as one would be a lie.
    const at = (u, v) => ({
      x: matrix.a * u + matrix.c * v + matrix.e,
      y: matrix.b * u + matrix.d * v + matrix.f,
    });

    const corners = [at(0, 0), at(vw, 0), at(vw, vh), at(0, vh)];
    const centre = at(vw / 2, vh / 2);
    const status = frameStatus(item, def, sk.frame);
    const box = itemBox(item, def);

    // The rotate handle rides above the mark along its own up axis, at a
    // fraction of the mark's own height.
    //
    // A fixed screen distance would need the stage's `--s`, which is a custom
    // property read out of the DOM and therefore not reactive: the handle would
    // be measured once and then sit in the wrong place after a zoom. Measuring
    // against the mark instead is reactive for free and keeps the handle in the
    // same proportion to the sticker at every size.
    const rad = (clampRotation(item.rotation) * Math.PI) / 180;
    const gap = box.h * ROTATE_GAP_RATIO;
    const rotateHandle = {
      x: centre.x + Math.sin(rad) * gap,
      y: centre.y - Math.cos(rad) * gap,
    };

    return {
      id: item.id,
      name: def.name,
      corners: corners.map((p) => `${round2(p.x)},${round2(p.y)}`).join(" "),
      centre: { x: round2(centre.x), y: round2(centre.y) },
      scaleHandle: corners[2],
      rotateHandle: { x: round2(rotateHandle.x), y: round2(rotateHandle.y) },
      offFrame: status,
      size: Math.round(box.w),
    };
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
    sk.beginDrag(event.currentTarget.dataset.handle, toImagePoint(event));
  }

  function onMove(event) {
    if (!sk.drag) return;
    event.preventDefault();
    sk.moveDrag(toImagePoint(event));
  }

  function onUp(event) {
    if (!sk.drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    sk.endDrag();
  }

  /**
   * Pick a mark out of the stack under the pointer.
   *
   * SVG hands a click to the topmost shape that was hit, and the marks are
   * emitted in paint order, so the one that receives it is the front one. No
   * explicit hit test is needed, and there is no second geometry to keep in
   * step with what the commit draws.
   */
  function onPick(event) {
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    if (id) sk.select(id);
  }
</script>

{#if ready}
  <div class="layer" bind:this={layer} aria-hidden="true">
    <svg class="ink" viewBox="0 0 {width} {height}">
      {#each drawn as mark (mark.id)}
        <!--
          A mark is a pick target, and the layer is aria-hidden with the panel
          list as its keyboard equivalent, so there is no role to give it. The
          same suppression CropOverlay uses for its own pointer surfaces.
        -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <g
          class="mark"
          transform={mark.matrix}
          data-id={mark.id}
          onpointerdown={onPick}
        >
          <!--
            The mark's own geometry, drawn as SVG. Nothing here is fetched:
            the markup is the `body` string from the catalogue in
            `core/stickerkit.js`, so there is no `<image>`, no external URL and
            nothing that could reach the network.
          -->
          {@html mark.def.body}
        </g>
      {/each}

      {#if selection}
        <polygon class="outline" points={selection.corners} />
      {/if}
    </svg>

    {#if selection}
      <div
        class="badge"
        class:over={selection.offFrame.outside}
        class:under={selection.centre.y < 48}
        style:left="{selection.centre.x}px"
        style:top="{selection.centre.y}px"
      >
        {selection.name} at {selection.size} px
      </div>

      <button
        type="button"
        class="handle rotate"
        class:active={sk.drag?.kind === "rotate"}
        tabindex="-1"
        aria-label="Turn the sticker"
        data-handle="rotate"
        style:left="{round2(selection.rotateHandle.x)}px"
        style:top="{round2(selection.rotateHandle.y)}px"
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
      ></button>

      <button
        type="button"
        class="handle scale"
        class:active={sk.drag?.kind === "scale"}
        tabindex="-1"
        aria-label="Scale the sticker"
        data-handle="scale"
        style:left="{round2(selection.scaleHandle.x)}px"
        style:top="{round2(selection.scaleHandle.y)}px"
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
      ></button>

      <button
        type="button"
        class="handle move"
        class:active={sk.drag?.kind === "move"}
        tabindex="-1"
        aria-label="Move the sticker"
        data-handle="move"
        style:left="{round2(selection.centre.x)}px"
        style:top="{round2(selection.centre.y)}px"
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
      ></button>
    {/if}
  </div>
{/if}

<style>
  .layer {
    position: absolute;
    inset: 0;
    z-index: var(--z-overlay);
    /* Only the marks and the handles take the pointer, so the stage still pans
       and drops through everything the operator has not explicitly grabbed. */
    pointer-events: none;
  }

  .ink {
    display: block;
    width: 100%;
    height: 100%;
    /* A mark may run off the frame, and the panel says so, so the layer shows
       it rather than hiding the overflow at the frame edge. */
    overflow: visible;
  }

  .mark {
    pointer-events: auto;
    cursor: pointer;
  }

  /* Chrome, not artwork: constant width whatever the zoom. */
  .outline {
    fill: none;
    stroke: rgba(255, 255, 255, 0.55);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
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