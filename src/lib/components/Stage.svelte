<script>
  /**
   * The image stage.
   *
   * Layout model: an untransformed "media" box sized in natural pixels, then
   * scaled and panned as one layer. Every overlay therefore lives in image
   * coordinates and stays glued to the picture through zoom, pan and rotate.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { view } from "../state/view.svelte.js";
  import { rotate } from "../state/rotate.svelte.js";
  import { crop } from "../state/crop.svelte.js";
  import { bboxFor, cssTransform, normalizeAngle } from "../core/transform.js";
  import CropOverlay from "./CropOverlay.svelte";
  import StageHud from "./StageHud.svelte";
  import ProgressOverlay from "./ProgressOverlay.svelte";

  const PAD = 40;

  let stage = $state(null);
  let media = $state(null);
  let avail = $state({ w: 0, h: 0 });

  const image = $derived(editor.current);
  const showingOriginal = $derived(view.comparing && !!editor.original);
  const hasPreview = $derived(!!editor.preview && !showingOriginal);
  /**
   * What the stage shows, in priority order: the untouched original while
   * compare is held, then the active tool's live preview, then the committed
   * image.
   */
  const display = $derived(showingOriginal ? editor.original : (editor.preview ?? image));

  const cropping = $derived(editor.tool === "crop" && !!image && !hasPreview);
  const StageLayer = $derived(editor.stageLayer);
  const previewing = $derived(
    editor.tool === "rotate" && !rotate.isClean && !!image,
  );

  /** Display box: the rotated bounding rectangle while a rotate is pending. */
  const mediaBox = $derived.by(() => {
    if (!display) return { w: 1, h: 1 };
    if (!previewing) return { w: display.width, h: display.height };
    return bboxFor(display.width, display.height, rotate.angle);
  });

  const fitScale = $derived.by(() => {
    if (!avail.w || !avail.h) return 1;
    // Fit fills the stage in both directions, as every image editor does:
    // a thumbnail should be shown large enough to work on, not as a stamp in
    // the middle of a void. Zoom is uncapped for the same reason, and the
    // percentage readout plus the dedicated 1:1 button are what make the two
    // cases distinguishable.
    return avail.w / mediaBox.w < avail.h / mediaBox.h
      ? avail.w / mediaBox.w
      : avail.h / mediaBox.h;
  });

  const scale = $derived(fitScale * (view.zoom ?? 1));
  const zoomPercent = $derived(Math.round(scale * 100));

  let isDropTarget = $state(false);
  let panning = $state(null);

  // --- Measurement ------------------------------------------------
  $effect(() => {
    if (!stage) return;
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      avail = {
        w: Math.max(0, rect.width - PAD * 2),
        h: Math.max(0, rect.height - PAD * 2),
      };
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  });

  $effect(() => {
    view.setFit(fitScale);
  });

  // A brand new image always re-fits; edits on the current one keep the view.
  $effect(() => {
    editor.epoch;
    view.fit();
  });

  // Keep the crop selection tied to the image on screen.
  //
  // `untrack` is load-bearing here. `crop.sync` reads crop state internally
  // (to decide whether to re-seed) and then writes it. Inside an effect those
  // reads become dependencies of the effect, so the effect would depend on
  // `crop.box` and also write `crop.box` on every pass: an infinite loop that
  // Svelte correctly refuses to run. The reads are part of the transition, not
  // a reason to re-run it, so they must not be tracked.
  $effect(() => {
    const current = image;
    const active = cropping;

    if (!current) {
      crop.box = null;
      return;
    }
    if (!active) return;

    untrack(() => crop.sync(current.width, current.height));
  });

  // Leaving the crop tool releases any half-finished drag.
  $effect(() => {
    if (!cropping) crop.endDrag();
  });

  // --- Pointer: pan, drop, wheel ----------------------------------
  function onMediaDown(event) {
    if (event.button !== 0) return;
    if (cropping) return; // the crop layer owns its own gestures
    if (!view.canPan) return;

    panning = { x: event.clientX, y: event.clientY, pan: { ...view.pan } };
    media?.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!panning) return;
    view.pan = {
      x: panning.pan.x + (event.clientX - panning.x),
      y: panning.pan.y + (event.clientY - panning.y),
    };
    view.clampPan(panLimit());
  }

  function onPointerUp(event) {
    if (!panning) return;
    media?.releasePointerCapture?.(event.pointerId);
    panning = null;
  }

  /** How far the picture may travel before its edge reaches the frame. */
  function panLimit() {
    const shownW = mediaBox.w * scale;
    const shownH = mediaBox.h * scale;
    return {
      w: Math.max(0, (shownW - avail.w) / 2) + 24,
      h: Math.max(0, (shownH - avail.h) / 2) + 24,
    };
  }

  function onWheel(event) {
    if (!image) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const base = view.zoom ?? 1;
      view.setZoom(base * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
      return;
    }
    // Plain wheel only pans, and only when there is overflow to pan into.
    if (view.canPan) {
      event.preventDefault();
      view.panBy(-event.deltaX, -event.deltaY);
      view.clampPan(panLimit());
    }
  }

  function onDragOver(event) {
    if (!image) return;
    event.preventDefault();
    isDropTarget = true;
  }

  function onDragLeave(event) {
    if (event.relatedTarget && stage?.contains(event.relatedTarget)) return;
    isDropTarget = false;
  }

  function onDrop(event) {
    event.preventDefault();
    isDropTarget = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) editor.open(file);
  }
</script>

<section
  class="stage checkerboard"
  class:empty={!image}
  class:working={editor.previewBusy && hasPreview}
  class:dropping={isDropTarget}
  bind:this={stage}
  aria-label="Image preview"
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  onwheel={onWheel}
>
  {#if display}
    <!--
      Two nested boxes, and the split matters:

      .viewport  layout size = fitted display size, centred by transform.
                 Nothing here is ever larger than it should appear.
      .media     natural size, scaled down from the top-left corner.

      The earlier version put the natural size on the centred element and
      scaled it with a transform. A transform does not change layout, so a
      4000px image claimed 4000px of layout inside a 1000px stage, the
      browser's "safe" centring pushed it to the start edge, and the scaled
      result landed off screen with only the top-left corner visible.
    -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="viewport"
      style:width="{mediaBox.w * scale}px"
      style:height="{mediaBox.h * scale}px"
      style:transform="translate(-50%, -50%) translate({view.pan.x}px, {view.pan.y}px)"
      bind:this={media}
      onpointerdown={onMediaDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
    >
      <div
        class="media"
        style:--s={scale}
        style:width="{mediaBox.w}px"
        style:height="{mediaBox.h}px"
        style:transform="scale({scale})"
      >
        <img
          class="picture"
          class:previewing
          src={display.url}
          alt={image ? `Editing ${image.name}` : ""}
          draggable="false"
          style:transform={previewing
            ? cssTransform({ angle: rotate.angle, flipX: rotate.flipX, flipY: rotate.flipY })
            : "none"}
          style:width={previewing ? "{display.width}px" : "100%"}
          style:height={previewing ? "{display.height}px" : "100%"}
        />

        {#if cropping && !showingOriginal}
          <CropOverlay />
        {/if}

        <!--
          Authoring layers (text, stickers, frames) draw over the picture in
          image coordinates, so they scale with it exactly like CropOverlay.
        -->
        {#if StageLayer}
          <StageLayer />
        {/if}
      </div>
    </div>
  {/if}

  {#if isDropTarget}
    <p class="dropcue">Drop to replace the image</p>
  {/if}

  <ProgressOverlay />

  <StageHud {zoomPercent} />

  <p class="preview-flag" aria-live="polite" class:on={hasPreview}>
    Preview
  </p>

  <p class="compare-flag" aria-live="polite" class:on={showingOriginal}>
    {showingOriginal ? "Original" : ""}
  </p>
</section>

<style>
  .stage {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    /* The stage is recessed into the window, so the picture looks seated in
       a well rather than laid on top of the page. */
    box-shadow:
      inset 0 2px 6px rgba(2, 6, 8, 0.45),
      inset 0 0 0 1px rgba(2, 6, 8, 0.35);
    /* Belt and braces against a stray wheel event scrolling the page. */
    overscroll-behavior: contain;
    transition: box-shadow var(--dur-2) var(--ease);
  }

  .stage.empty {
    background-image: none;
    background-color: var(--surface-0);
  }

  .stage.dropping {
    box-shadow:
      inset 0 0 0 2px var(--accent),
      inset 0 2px 6px rgba(2, 6, 8, 0.45);
  }

  /* The viewport is positioned, not laid out, so centring is exact and a
     zoomed image overflows symmetrically instead of being pushed to an edge
     by the browser's overflow-safe alignment. */
  .viewport {
    position: absolute;
    left: 50%;
    top: 50%;
    /* Checkerboard so a transparent PNG reads as transparent. */
    background-color: #1b2226;
    background-image:
      linear-gradient(45deg, #232c31 25%, transparent 25%),
      linear-gradient(-45deg, #232c31 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #232c31 75%),
      linear-gradient(-45deg, transparent 75%, #232c31 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
    /* Seated in the well: a tight contact shadow plus a thin light rim on the
       top edge, so it has a physical edge. */
    box-shadow:
      0 2px 10px -2px rgba(2, 6, 8, 0.7),
      0 0 0 1px rgba(2, 6, 8, 0.55),
      inset 0 1px 0 rgba(255, 255, 255, 0.07);
    touch-action: none;
  }

  /* Natural size, scaled from the top-left so image coordinates and screen
     coordinates stay in a known relationship. */
  .media {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: top left;
  }

  .picture {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: fill;
    user-select: none;
    -webkit-user-drag: none;
  }

  /* While a rotation is pending the picture is laid out at natural size
     inside the rotated bounding box and turned with CSS, so the preview is
     the committed geometry and not an approximation of it. */
  .picture.previewing {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    transform-origin: center center;
  }

  .dropcue {
    position: absolute;
    z-index: var(--z-stage-ui);
    padding: var(--s-3) var(--s-5);
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: var(--r-pill);
    font-size: var(--t-sm);
    font-weight: 650;
    box-shadow: var(--shadow-3);
  }

  /* The stage dims slightly while a tool recomputes, so the operator can see
     that the picture is about to change without losing the picture. */
  .stage.working::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: calc(var(--z-canvas) + 1);
    background: rgba(7, 11, 13, 0.28);
    pointer-events: none;
    animation: wash 900ms ease-in-out infinite alternate;
  }

  @keyframes wash {
    from {
      opacity: 0.35;
    }
    to {
      opacity: 0.8;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .stage.working::after {
      animation: none;
      opacity: 0.5;
    }
  }

  .preview-flag {
    position: absolute;
    top: var(--s-4);
    left: 50%;
    translate: -50% 0;
    z-index: var(--z-stage-ui);
    height: 24px;
    padding: 0 var(--s-4);
    display: grid;
    place-items: center;
    background: var(--accent-dim);
    border: 1px solid var(--accent-line);
    border-radius: var(--r-pill);
    font-size: var(--t-micro);
    font-weight: 650;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-1) var(--ease);
  }

  .preview-flag.on {
    opacity: 1;
  }

  .compare-flag {
    position: absolute;
    top: var(--s-4);
    left: 50%;
    translate: -50% 0;
    z-index: var(--z-stage-ui);
    height: 24px;
    padding: 0 var(--s-4);
    display: grid;
    place-items: center;
    background: var(--surface-3);
    border: 1px solid var(--line-3);
    border-radius: var(--r-pill);
    font-size: var(--t-xs);
    font-weight: 650;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-1);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-1) var(--ease);
  }

  .compare-flag.on {
    opacity: 1;
  }
</style>
