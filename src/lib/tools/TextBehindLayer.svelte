<script>
  /**
   * Text behind an object, on the stage.
   *
   * Lives inside the stage's scaled media box, so every number here is in
   * *image* pixels and it stays glued to the picture through zoom and pan,
   * exactly like the crop handles.
   *
   * What it draws is chrome, not artwork, and that is deliberate. The words
   * themselves are already on the stage: this tool parks a composited preview
   * bitmap there, which is the plate with the words drawn over it and the
   * subject composited back on top. Drawing the words again from here would
   * put a second copy of them *over* the subject, which is precisely what the
   * tool exists to avoid. So the layer draws the two boxes the operator needs
   * to aim: where the words are, and what the segmentation model decided the
   * subject is.
   *
   * The handles are HTML sized in screen px by dividing by `--s`, the live
   * scale, so they stay the same size at every zoom. Both boxes are chrome, so
   * they use `non-scaling-stroke` and stay 1.5 screen px whatever the zoom.
   *
   * The layer is `aria-hidden`: it is a pointer affordance over a picture. The
   * one gesture here, moving the words, has the Across and Down fields in the
   * panel, which is the keyboard path, so nothing here is pointer only.
   */
  import { textBehind } from "../state/textbehind.svelte.js";
  import { shadowInjection } from "../state/shadowinject.svelte.js";

  const st = textBehind;

  let layer = $state(null);

  /** Trimming the numbers keeps the markup short. */
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const width = $derived(st.imageWidth);
  const height = $derived(st.imageHeight);
  const ready = $derived(width > 0 && height > 0 && st.hasText);
  const box = $derived(st.box);
  const handle = $derived({ x: round2(st.x), y: round2(st.y) });

  /**
   * The mask's own verdict on the subject, or null until the model has run and
   * found one. Full frame coverage still draws: the operator asked where the
   * model thinks the subject is, and that is the answer.
   */
  const subject = $derived(
    shadowInjection.ready && !shadowInjection.noSubject ? shadowInjection.bounds : null,
  );

  const readout = $derived.by(() => {
    if (!st.hasText) return "No text";
    if (st.overflow.any) return `Past the ${st.overflow.edges[0]} edge`;
    return `${Math.round(box.w)} x ${Math.round(box.h)} px`;
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
    st.beginDrag(toImagePoint(event));
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
      <!--
        The subject first, so the words' own box paints over it. The two are
        told apart by colour rather than by weight: the subject is what the tool
        found, the words are what the operator chose.
      -->
      {#if subject}
        <rect
          class="subject"
          x={subject.x}
          y={subject.y}
          width={subject.w}
          height={subject.h}
        />
      {/if}

      <rect class="words" x={round2(box.x)} y={round2(box.y)} width={round2(box.w)} height={round2(box.h)} />
    </svg>

    <button
      type="button"
      class="handle move"
      class:active={!!st.drag}
      tabindex="-1"
      aria-label="Move the words"
      style:left="{handle.x}px"
      style:top="{handle.y}px"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
    ></button>

    <div class="badge" class:over={st.overflow.any} style:left="{handle.x}px" style:top="{handle.y}px">
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
    /* The words may run off the frame, and the panel says so, so the boxes show
       where they are rather than hiding the overflow at the frame edge. */
    overflow: visible;
  }

  /* Chrome, not artwork: constant width whatever the zoom. */
  .subject {
    fill: none;
    stroke: rgba(171, 255, 203, 0.55);
    stroke-width: 1.5;
    stroke-dasharray: 2 5;
    vector-effect: non-scaling-stroke;
  }

  .words {
    fill: none;
    stroke: rgba(255, 255, 255, 0.55);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
    vector-effect: non-scaling-stroke;
  }

  /* --- Handle ------------------------------------------------------- */

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

  /* --- Readout ------------------------------------------------------- */

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
</style>