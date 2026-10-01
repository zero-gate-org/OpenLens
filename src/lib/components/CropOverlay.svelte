<script>
  /**
   * Crop interaction layer.
   *
   * Lives inside the stage's scaled media box, so every number here is in
   * *image* pixels. Screen-constant chrome (hairlines, handle size, the
   * measurement badge) is produced by dividing by `--s`, the live scale, so
   * the overlay looks identical at 10% and at 800%.
   *
   * The layer is `aria-hidden`: it is a pointer affordance over a picture,
   * and the same selection is fully operable from the tool panel and from the
   * global arrow-key handler in App.svelte.
   */
  import { crop } from "../state/crop.svelte.js";

  let layer = $state(null);

  const box = $derived(crop.box);

  /** Convert a pointer event into image coordinates. */
  function toImagePoint(event) {
    if (!layer) return { x: 0, y: 0 };
    const rect = layer.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onDown(event) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    crop.beginDrag(target.dataset.handle, toImagePoint(event));
  }

  function onMove(event) {
    if (!crop.drag) return;
    event.preventDefault();
    crop.moveDrag(toImagePoint(event));
  }

  function onUp(event) {
    if (!crop.drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    crop.endDrag();
  }

  /** Grab anywhere inside the selection to move it. */
  function onBodyDown(event) {
    if (!box) return;
    const p = toImagePoint(event);
    if (p.x < box.x || p.x > box.x + box.w || p.y < box.y || p.y > box.y + box.h) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    crop.beginDrag("move", p);
  }

  const thirds = $derived.by(() => {
    if (!box || !crop.interacting) return [];
    return [1 / 3, 2 / 3].flatMap((t) => [
      { axis: "x", at: box.x + box.w * t },
      { axis: "y", at: box.y + box.h * t },
    ]);
  });
</script>

{#if box}
  <div class="layer" bind:this={layer} aria-hidden="true">
    <!-- Scrim: four panels around the selection, so the crop reads as a cut. -->
    <div class="scrim">
      <i style:left="0" style:top="0" style:width="100%" style:height="{box.y}px"></i>
      <i
        style:left="0"
        style:top="{box.y + box.h}px"
        style:width="100%"
        style:height="{Math.max(0, crop.imageHeight - box.y - box.h)}px"
      ></i>
      <i style:left="0" style:top="{box.y}px" style:width="{box.x}px" style:height="{box.h}px"></i>
      <i
        style:left="{box.x + box.w}px"
        style:top="{box.y}px"
        style:width="{Math.max(0, crop.imageWidth - box.x - box.w)}px"
        style:height="{box.h}px"
      ></i>
    </div>

    <!-- Selection body: the move surface and the grab outline. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="body"
      class:dragging={crop.handle === "move"}
      style:left="{box.x}px"
      style:top="{box.y}px"
      style:width="{box.w}px"
      style:height="{box.h}px"
      onpointerdown={onBodyDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
    >
      {#each thirds as line (line.axis + line.at)}
        <span
          class="guide {line.axis}"
          style:left={line.axis === "x" ? "{line.at - box.x}px" : undefined}
          style:top={line.axis === "y" ? "{line.at - box.y}px" : undefined}
        ></span>
      {/each}
    </div>

    <!-- Handles. Corners first so they paint above the edge handles. -->
    {#each ["nw", "ne", "se", "sw", "n", "e", "s", "w"] as handle (handle)}
      {@const pos = handlePosition(handle, box)}
      {#if pos}
        <button
          type="button"
          class="handle {handle}"
          class:active={crop.handle === handle}
          tabindex="-1"
          aria-label="Resize from the {handle}"
          data-handle={handle}
          style:left="{pos.x}px"
          style:top="{pos.y}px"
          onpointerdown={onDown}
          onpointermove={onMove}
          onpointerup={onUp}
          onpointercancel={onUp}
        ></button>
      {/if}
    {/each}

    <!-- Output size badge, parked under the selection unless it would clip. -->
    <div
      class="badge"
      class:above={box.y + box.h > crop.imageHeight - 34}
      style:left="{box.x + box.w / 2}px"
      style:top="{box.y + box.h}px"
    >
      <span class="numeric">{crop.rounded.w} × {crop.rounded.h}</span>
      <span class="ratio">{crop.aspectLabel}</span>
    </div>
  </div>
{/if}

<script module>
  function handlePosition(handle, box) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const map = {
      nw: { x: box.x, y: box.y },
      ne: { x: box.x + box.w, y: box.y },
      se: { x: box.x + box.w, y: box.y + box.h },
      sw: { x: box.x, y: box.y + box.h },
      n: { x: cx, y: box.y },
      s: { x: cx, y: box.y + box.h },
      w: { x: box.x, y: cy },
      e: { x: box.x + box.w, y: cy },
    };
    return map[handle];
  }
</script>

<style>
  .layer {
    position: absolute;
    inset: 0;
    z-index: var(--z-overlay);
  }

  /* --- Scrim ----------------------------------------------- */
  .scrim i {
    position: absolute;
    display: block;
    background: rgba(5, 9, 11, 0.58);
    pointer-events: none;
  }

  /* --- Selection body -------------------------------------- */
  .body {
    position: absolute;
    cursor: move;
    outline: calc(1.5px / var(--s)) solid rgba(255, 255, 255, 0.92);
    outline-offset: calc(-1.5px / var(--s));
    box-shadow:
      0 0 0 calc(1px / var(--s)) rgba(5, 9, 11, 0.5),
      inset 0 0 0 calc(1px / var(--s)) rgba(5, 9, 11, 0.35);
    touch-action: none;
  }

  .body.dragging {
    cursor: grabbing;
  }

  .guide {
    position: absolute;
    background: rgba(255, 255, 255, 0.42);
    pointer-events: none;
  }

  .guide.x {
    top: 0;
    bottom: 0;
    width: calc(1px / var(--s));
  }

  .guide.y {
    left: 0;
    right: 0;
    height: calc(1px / var(--s));
  }

  /* --- Handles --------------------------------------------- */
  .handle {
    position: absolute;
    width: calc(14px / var(--s));
    height: calc(14px / var(--s));
    translate: -50% -50%;
    padding: 0;
    background: transparent;
    touch-action: none;
    /* The visible nub is inset inside a larger transparent hit area, so the
       grab target stays roughly 14 screen px at any zoom. */
  }

  .handle::after {
    content: "";
    position: absolute;
    inset: calc(3px / var(--s));
    background: #ffffff;
    border-radius: calc(1.5px / var(--s));
    box-shadow:
      0 0 0 calc(1.5px / var(--s)) rgba(5, 9, 11, 0.7),
      0 calc(1px / var(--s)) calc(2px / var(--s)) rgba(5, 9, 11, 0.4);
    transition: background var(--dur-1) var(--ease);
  }

  .handle:hover::after,
  .handle.active::after {
    background: var(--accent);
  }

  .handle:focus {
    outline: none;
  }

  .handle.nw,
  .handle.se {
    cursor: nwse-resize;
  }

  .handle.ne,
  .handle.sw {
    cursor: nesw-resize;
  }

  .handle.n,
  .handle.s {
    cursor: ns-resize;
  }

  .handle.e,
  .handle.w {
    cursor: ew-resize;
  }

  /* --- Output badge ---------------------------------------- */
  .badge {
    position: absolute;
    translate: -50% calc(9px / var(--s));
    display: flex;
    align-items: center;
    gap: calc(6px / var(--s));
    padding: calc(3px / var(--s)) calc(7px / var(--s));
    border-radius: calc(5px / var(--s));
    background: rgba(8, 12, 14, 0.88);
    border: calc(1px / var(--s)) solid rgba(255, 255, 255, 0.14);
    color: var(--text-1);
    font-size: calc(11px / var(--s));
    line-height: 1.3;
    white-space: nowrap;
    pointer-events: none;
  }

  .badge.above {
    translate: -50% calc(-100% - 9px / var(--s));
  }

  .badge .ratio {
    color: var(--accent);
    font-weight: 600;
  }
</style>
