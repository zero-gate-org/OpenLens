<script>
  /**
   * A live filter demo, not a picture of one.
   *
   * This is the only interactive element on the page and it is the reason to
   * believe the rest of it. Drag the handle and the same photograph is revealed
   * twice: the original on the left, and on the right the output of a real pass
   * from `core/`, run in a real worker, in the tab you are reading this in.
   *
   * The work happens at 720px on the long edge regardless of what the frame
   * measures on screen. That is a deliberate ceiling: the pass has to finish
   * inside the time it takes somebody to decide they have seen enough, and
   * Kuwahara's cost is quadratic in its radius over every pixel, so the only
   * lever that matters is how many pixels it is given. Above roughly 800px the
   * difference is invisible at this size and the wait is not.
   *
   * A photograph at 200KB is the price of the largest contentful paint. It is
   * preloaded in `index.html`, sized so it is never upscaled on a desktop
   * viewport, and the frame reserves its exact aspect ratio, so it costs bytes
   * once and never costs layout shift.
   */
  import { onMount } from "svelte";

  import { EFFECTS, HERO_EFFECTS, paint } from "../lib/render.js";
  import { HERO, loadPhoto, drawCover } from "../lib/photos.js";

  /** Long edge of the frame the pass is computed at. */
  const WORK = 720;

  let canvas = $state(null);
  let photo = $state(null);
  let error = $state("");
  let ready = $state(false);
  let busy = $state(false);
  let progress = $state(0);
  let split = $state(58);

  /**
   * Which pass is currently wanted, and which is being rendered.
   *
   * These are deliberately the same variable, and `ticket` is a separate
   * counter rather than a second source of truth. `wanted` is what the chips
   * set; `ticket` is what retires a superseded pass. Keeping the filter and the
   * displayed frame as two independent pieces of state would mean a visitor who
   * switched quickly could be left looking at the previous pass labelled with
   * the new one's name.
   */
  let wanted = $state(HERO_EFFECTS[0]);
  let ticket = 0;

  /**
   * Recompute the right half.
   *
   * `photo` is decoded once and kept: the six passes on this page all read the
   * same decoded bitmap, and decoding is the expensive half of this operation.
   */
  async function render() {
    if (!canvas || !photo) return;

    const mine = ++ticket;
    busy = true;
    progress = 0;

    try {
      await paint(canvas, photo, wanted, {
        onprogress: (ratio) => {
          // A pass that finished after the visitor moved on is dropped rather
          // than painted, which is also why the ticket is checked again below.
          if (mine === ticket) progress = ratio;
        },
      });

      if (mine !== ticket) return;
      ready = true;
    } catch (problem) {
      if (mine !== ticket) return;
      // A demo that cannot run is a reason to say so, not a reason to show an
      // empty frame and let the visitor conclude the tool is broken.
      error = problem?.message || "That pass could not run in this browser.";
      ready = false;
    } finally {
      if (mine === ticket) busy = false;
    }
  }

  function pick(next) {
    if (next === wanted) return;
    // The old result is dropped immediately, so switching filters never leaves
    // the previous pass on screen pretending to be the new one.
    ready = false;
    wanted = next;
  }

  onMount(() => {
    let cancelled = false;

    loadPhoto(HERO).then((image) => {
      if (cancelled) return;
      photo = image;

      // The visible frame is whatever the layout gives us; the computed frame
      // is fixed. The canvas is sized by the pass and then scaled to fit, so
      // the browser's smoothing handles the difference rather than the pass
      // running over pixels nobody will see.
      const scale = WORK / Math.max(image.naturalWidth, image.naturalHeight);
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);

      render();
    });

    return () => {
      cancelled = true;
      // Abandon any pass still in flight, so a closed or navigated-away page
      // does not keep a worker and its frame buffer alive.
      ticket += 1;
    };
  });

  // Re-run when the visitor picks another pass. Reading `wanted` here is what
  // subscribes this effect to it.
  $effect(() => {
    void wanted;
    if (photo) render();
  });
</script>

<figure class="demo">
  <!--
    `--split` lives on the frame, not on the canvas. The canvas needs it for the
    clip, but the seam and its handle need it too, and they are siblings: a
    custom property set on the canvas does not reach them, which is how the seam
    ended up parked at the left edge while the picture split correctly.
  -->
  <div class="frame" class:frame--busy={busy} style:--split="{split}%">
    <!--
      The photograph is the largest contentful paint, so it is a real <img>
      rather than something drawn into the canvas: the browser can prioritise it,
      and it paints before a single line of the pass has run.
    -->
    <img class="plate" src={HERO} alt="" width="900" height="1125" fetchpriority="high" decoding="async" />

    <!--
      The processed half, revealed by clip rather than by a second copy of the
      photograph: one decode, two reads.
    -->
    <canvas
      class="plate effect"
      class:effect--ready={ready}
      bind:this={canvas}
      aria-hidden="true"
    ></canvas>

    <div class="seam" aria-hidden="true">
      <span class="grip">
        <span class="grip-bar"></span>
        <span class="grip-bar"></span>
      </span>
    </div>

    <!--
      The handle is a real range input stretched over the whole frame, so it is
      the only control on the hero and it needs no pointer handlers of its own:
      a native range already tracks the pointer across its whole box and drags
      with pointer capture. That also means the interaction is keyboard
      operable and announced, which a div with a drag handler would not be.
    -->
    <input
      class="range"
      type="range"
      min="0"
      max="100"
      step="1"
      bind:value={split}
      aria-label="Reveal the processed side of the photograph"
      aria-valuetext="{split}% original, {100 - split}% {EFFECTS[wanted].label.toLowerCase()}"
    />

    <span class="tag tag--before" aria-hidden="true">Original</span>
    <span class="tag tag--after" aria-hidden="true">{EFFECTS[wanted].label}</span>

    {#if busy && !error}
      <div class="working" aria-hidden="true">
        <span class="working-bar" style:--done="{progress * 100}%"></span>
      </div>
    {/if}

    {#if error}
      <p class="fault">{error}</p>
    {/if}
  </div>

  <figcaption class="controls">
    <!--
      The demo is the page's only interactive element, so it needs an
      instruction. The two corner tags label the two sides of the wipe; nothing
      said the frame can be dragged. Without this a visitor sees a photograph
      with a seam down it and no reason to touch it.
    -->
    <p class="hint" aria-hidden="true">Drag to compare</p>

    <div class="picker" role="group" aria-label="Choose a filter">
      {#each HERO_EFFECTS as id (id)}
        {@const item = EFFECTS[id]}
        <button
          type="button"
          class="chip"
          class:chip--on={wanted === id}
          aria-pressed={wanted === id}
          onclick={() => pick(id)}
        >
          <span class="chip-key mono" aria-hidden="true">{item.shortcut}</span>
          {item.label}
        </button>
      {/each}
    </div>

    <p class="note">
      This is your own browser doing the work. Drag the handle to see the difference, then open the
      editor and run the same filter on a photo of yours.
    </p>
  </figcaption>
</figure>

<style>
  .demo {
    margin: 0;
  }

  .frame {
    position: relative;
    overflow: hidden;
    border-radius: var(--r-lg);
    border: 1px solid var(--line-2);
    /* The frame's own lip, so the photograph sits inside an object rather than
       floating on the page. */
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 24px 64px -28px rgba(4, 10, 12, 0.9);
    background: var(--surface-1);
    aspect-ratio: 4 / 5;
    cursor: ew-resize;
    /* A drag must not start a text selection or a scroll gesture. */
    touch-action: pan-y;
    user-select: none;
  }

  .plate {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* Until the pass lands there is nothing to show, so the effect layer stays
     out of the way rather than flashing a second copy of the original. The clip
     reveals the processed side from the seam rightwards. */
  .effect {
    opacity: 0;
    clip-path: inset(0 0 0 var(--split, 50%));
    transition: opacity var(--dur-3) var(--ease);
  }

  .effect--ready {
    opacity: 1;
  }

  .seam {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--split, 50%);
    width: 2px;
    margin-left: -1px;
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .seam::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      transparent,
      rgba(255, 255, 255, 0.35) 12%,
      rgba(255, 255, 255, 0.35) 88%,
      transparent
    );
  }

  .grip {
    position: relative;
    display: grid;
    gap: 3px;
    place-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--r-pill);
    background: var(--accent);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.4),
      0 4px 14px -4px rgba(4, 10, 12, 0.8);
    transition: transform var(--dur-2) var(--ease-out);
  }

  .frame:hover .grip,
  .frame--busy .grip {
    transform: scale(1.08);
  }

  .grip-bar {
    width: 12px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent-ink);
    opacity: 0.75;
  }

  /* Full-bleed and invisible, but a real control. */
  .range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: ew-resize;
  }

  .range:focus-visible {
    opacity: 1;
    /* The outline would sit on the frame's edge, so the focused state is drawn
       on the seam instead, where the eye already is. */
    outline: none;
  }

  .frame:has(.range:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  /* Two labels, one per side, and they move with the seam so the visitor can
     always tell which half is which. */
  .tag {
    position: absolute;
    top: var(--s-4);
    padding: 5px var(--s-3);
    border-radius: var(--r-sm);
    background: rgba(6, 12, 14, 0.72);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-1);
    pointer-events: none;
  }

  .tag--before {
    left: var(--s-4);
  }

  .tag--after {
    right: var(--s-4);
  }

  .working {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: rgba(6, 12, 14, 0.6);
    pointer-events: none;
  }

  .working-bar {
    display: block;
    height: 100%;
    /* Set inline by Svelte on the element itself, so it resolves here. */
    width: var(--done, 0%);
    background: var(--accent);
    transition: width var(--dur-2) linear;
  }

  .fault {
    position: absolute;
    inset: auto var(--s-5) var(--s-6);
    padding: var(--s-4);
    border-radius: var(--r-md);
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    font-size: var(--t-sm);
    line-height: 1.45;
    color: var(--text-1);
  }

  .controls {
    display: grid;
    gap: var(--s-4);
    margin-top: var(--s-5);
  }

  /*
   * The instruction, in the page's own small-caps register rather than as a
   * sentence, so it reads as a caption on the frame instead of as a paragraph
   * competing with the filter list under it. It is hidden from the tree: the
   * range input over the frame already announces itself and already says what
   * the two sides are, so this would be the same fact a third time.
   */
  .hint {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .picker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    height: 34px;
    padding-inline: var(--s-3) var(--s-4);
    border-radius: var(--r-sm);
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    box-shadow: var(--raise-1);
    font-size: var(--t-sm);
    font-weight: 500;
    color: var(--text-2);
    transition:
      color var(--dur-1) var(--ease),
      border-color var(--dur-1) var(--ease),
      background var(--dur-1) var(--ease),
      transform var(--dur-1) var(--ease);
  }

  .chip:hover {
    color: var(--text-1);
    border-color: var(--line-3);
  }

  .chip:active {
    transform: translateY(1px);
  }

  .chip--on {
    background: var(--accent-dim);
    border-color: var(--accent-line);
    color: var(--accent);
  }

  /* The shortcut key, which is also the key that opens the tool. */
  .chip-key {
    display: grid;
    place-items: center;
    min-width: 17px;
    height: 17px;
    padding-inline: 3px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.07);
    font-size: 0.625rem;
    color: var(--text-3);
  }

  .chip--on .chip-key {
    background: var(--accent-line);
    color: var(--accent);
  }

  .note {
    margin: 0;
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--text-3);
    max-width: 44ch;
  }

  @media (max-width: 640px) {
    .tag {
      font-size: 0.5625rem;
      padding: 4px var(--s-2);
    }

    .note {
      font-size: var(--t-xs);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .grip,
    .effect,
    .working-bar {
      transition: none;
    }

    .frame:hover .grip,
    .frame--busy .grip {
      transform: none;
    }
  }
</style>
