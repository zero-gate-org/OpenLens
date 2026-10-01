<script>
  /**
   * Frame preview surface.
   *
   * NOT a stage layer. It is not registered with `editor.setStageLayer`, and
   * that is the whole point of this file existing in the panel rather than in
   * `Stage.svelte`.
   *
   * Why: **a frame grows the picture.** `StickersLayer` and `CurvedTextLayer`
   * draw *over* the image box, which is exactly the media box `Stage.svelte`
   * scales and fits. A border is drawn *outside* it, and reading
   * `Stage.svelte` says that does not work:
   *
   * - `.stage` carries `overflow: hidden`, so anything past the stage bounds is
   *   cut. At fit scale the fit is computed from `mediaBox`, which is the
   *   *image*, so a wide border runs off the edge of the picture before the
   *   picture is off the edge of the stage, and any zoom cuts it further.
   * - `.viewport` and `.media` do **not** clip, so the border would not be lost
   *   to an `overflow: hidden` of its own. It would be lost to the stage's,
   *   which is worse: it cuts silently and only sometimes.
   * - `.viewport` is what paints the checkerboard for transparent pictures. A
   *   border drawn outside it would sit on the stage's own background, so a
   *   transparent mat would be unreadable rather than obviously transparent.
   * - `fitScale` and `panLimit` are both computed from `mediaBox`. Neither
   *   knows the frame exists, so Fit, the zoom percentage and the pan clamp
   *   would all describe a smaller picture than the one on screen.
   *
   * So the frame is previewed here, in the panel, as the complete output
   * picture. That is honest at any size, it costs a 256 px render instead of a
   * full resolution re-encode on every slider tick, and Apply still puts the
   * real thing on the stage because the real thing is the committed image.
   *
   * The component owns only the canvas, the fit and the redraw. Every pixel is
   * painted by the `paint` callback the panel hands in, so the preview and the
   * committed canvas are the same drawing calls with a different scale, and
   * cannot drift apart.
   */
  import { untrack } from "svelte";

  import { context2d } from "../core/image.js";

  let {
    width,
    height,
    /** Signature of everything that affects the drawing. */
    sig = "",
    /** Longest side of the preview, in CSS pixels. */
    max = 256,
    paint,
    label = "Framed result",
    empty = "No frame yet",
  } = $props();

  let canvas = $state(null);

  /**
   * Preview scale.
   *
   * Grows a small output to fill the panel, the way the stage does, because a
   * frame tool is judged on proportions rather than on crispness and a 64 px
   * thumbnail at 1:1 tells nobody anything about its border. Never shrinks
   * past the panel: `max` is the box, not a hint.
   */
  const scale = $derived.by(() => {
    const longest = Math.max(width || 0, height || 0);
    if (longest <= 0) return 0;
    return max / longest;
  });

  const ready = $derived(!!width && !!height && !!paint && scale > 0);

  $effect(() => {
    const w = Math.max(1, Math.round((width || 1) * scale));
    const h = Math.max(1, Math.round((height || 1) * scale));
    void sig;
    if (!canvas || !ready) return;

    // Assigning width or height clears the canvas and resets the context, so
    // this happens before every paint rather than only when the size changes.
    canvas.width = w;
    canvas.height = h;

    // `paint` is a closure the panel rebuilds on every render; the signature is
    // what says when to redraw, so reading it must not be a dependency.
    untrack(() => paint(context2d(canvas), scale));
  });
</script>

<div class="frame checkerboard" class:ready>
  {#if ready}
    <!--
      The label lives on a wrapper rather than on the canvas: a canvas cannot
      take an img role, and a canvas with only fallback text is read out as
      "canvas" by half the readers there are. The surface carries the name, the
      pixels inside are then decorative.
    -->
    <div
      class="surface"
      role="img"
      aria-label="{label}, {Math.round(width)} by {Math.round(height)} pixels"
    >
      <canvas
        bind:this={canvas}
        aria-hidden="true"
        style:width="{Math.round((width || 1) * scale)}px"
        style:height="{Math.round((height || 1) * scale)}px"
      ></canvas>
    </div>
  {:else}
    <p class="idle">{empty}</p>
  {/if}
</div>

<style>
  /* A frame has to be seen whole, so the surface is a fixed, quiet box rather
     than a control. The checkerboard is the app's own transparency surface, so
     a transparent mat reads as transparent here exactly as it does on the
     stage. */
  .frame {
    display: grid;
    place-items: center;
    min-height: 72px;
    padding: var(--s-2);
    border: 1px solid var(--line-1);
    border-radius: var(--r-md);
    background-color: #1b2226;
  }

  .surface {
    display: block;
    line-height: 0;
  }

  canvas {
    display: block;
    /* The backing store is already the preview's size, so the element must not
       be scaled again by layout. `max-width` is the belt to that braces: it
       only ever bites if the panel is narrower than `max`. */
    max-width: 100%;
    height: auto;
  }

  .idle {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--text-3);
  }
</style>