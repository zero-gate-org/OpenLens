<script>
  /**
   * One photograph, six passes.
   *
   * The tiles are not styled approximations of these filters. Each one is the
   * editor's own pass run on this page against one decoded photograph, in the
   * editor's own workers, at the moment you scrolled it into view.
   *
   * Which is why they take a moment. Six per-pixel passes over a megapixel is
   * real work, so it is done lazily, one tile at a time, yielding between them
   * so the page stays scrollable while it happens, and showing a loading state
   * in the shape of the tile that is coming.
   */
  import { onMount } from "svelte";

  import { EFFECTS, paint } from "../lib/render.js";
  import { SHOWCASE, loadPhoto } from "../lib/photos.js";
  import { onceVisible, reveal, nextFrame } from "../lib/reveal.js";

  /**
   * Render size, in device pixels.
   *
   * Landscape, 3:2, and that is a decision about the rail rather than about the
   * photographs. Portrait cards at this column width come out over 700px tall,
   * so a rail capped inside a viewport can show exactly one of them and no sign
   * of another, which reads as a single picture rather than as something you can
   * move through. Landscape cards fit two, which is the minimum for a vertical
   * carousel to read as one.
   *
   * It suits the comparison being made too: six horizontal frames stacked is a
   * contact sheet, and that is what this is.
   */
  const FRAME = { width: 900, height: 600 };

  /**
   * Crop bias, so the subject survives being cut wide.
   *
   * The red bus sits left of centre and low in the frame, so the crop keeps more
   * of the left and sits below centre.
   */
  const FOCUS = [0.34, 0.56];

  /**
   * Six passes over six columns' worth of frames.
   *
   * Every tile is the same shape now: they are a rail of equal cards, so there
   * is no span arithmetic to get wrong and no grid to leave a hole in.
   *
   * Each note says what the photo ends up looking like, in the words somebody
   * who has never opened a photo editor would use. No "ramp", no "register",
   * no "channel": those describe the pass, not the result, and the result is
   * what a visitor is deciding about.
   */
  const TILES = [
    { effect: "gradientmap", note: "Push the photo onto two colours of your choosing." },
    { effect: "halftone", note: "Break it into a screen of printing dots." },
    { effect: "oilpaint", note: "Smear it into flat painted patches." },
    { effect: "sketch", note: "Reduce it to outlines on paper." },
    { effect: "lomo", note: "Warm it up and darken the corners." },
    { effect: "glitch", note: "Slice it sideways and shift the colour out of line." },
  ];

  /**
   * Status per tile: "idle", "running", "done" or "failed".
   *
   * Kept separate from the canvas references on purpose. `{@const entry =
   * status[tile.effect]}` binds to a snapshot, so writing `entry.canvas` would
   * write into a temporary and the reference would be gone by the time the
   * pass ran. That was a real bug: every tile stayed "idle" forever because the
   * queue found no canvas to draw into, and it showed up as six photographs
   * that simply never changed.
   *
   * @type {Record<string, { state: string, detail: string }>}
   */
  let status = $state(
    Object.fromEntries(TILES.map((tile) => [tile.effect, { state: "idle", detail: "" }])),
  );

  /**
   * The canvases, by effect.
   *
   * A plain Map, not reactive state. Nothing renders from it and nothing needs
   * to; it exists so the queue can find a drawing surface, and keeping it out of
   * `$state` means a DOM node is never wrapped in a proxy.
   *
   * Populated by an action rather than `bind:this`, because `bind:this` needs a
   * writable expression and `canvases.get(effect)` is a call, not a reference.
   *
   * @type {Map<string, HTMLCanvasElement>}
   */
  const canvases = new Map();

  /**
   * Register a tile's canvas under its effect id.
   *
   * `use:` calls an action as `(node, parameter)`, so this is one function
   * taking both rather than a curried one, which is what the checker wants here.
   *
   * @param {HTMLCanvasElement} node
   * @param {string} effect
   */
  function register(node, effect) {
    canvases.set(effect, node);
    return {
      destroy() {
        canvases.delete(effect);
      },
    };
  }

  const tiles = TILES.map((tile) => ({
    ...tile,
    label: EFFECTS[tile.effect].label,
    shortcut: EFFECTS[tile.effect].shortcut,
    tool: EFFECTS[tile.effect].tool,
  }));

  function setStatus(effect, next) {
    status[effect] = { ...status[effect], ...next };
    status = { ...status };
  }

  async function compute(index) {
    const tile = tiles[index];
    const canvas = canvases.get(tile.effect);
    const entry = status[tile.effect];
    if (!canvas || entry.state === "done" || entry.state === "running") return;

    setStatus(tile.effect, { state: "running" });

    try {
      if (!photo) {
        photo = await loadPhoto(SHOWCASE);
      }

      await paint(canvas, photo, tile.effect, { crop: { focusX: FOCUS[0], focusY: FOCUS[1] } });

      if (!torn_down) setStatus(tile.effect, { state: "done" });
    } catch (problem) {
      if (torn_down) return;
      setStatus(tile.effect, {
        state: "failed",
        detail: problem?.message || "This pass could not run.",
      });
    }
  }

  let photo = null;
  let torn_down = false;

  onMount(() => {
    return () => {
      torn_down = true;
    };
  });

  /**
   * Compute one tile per frame, in document order.
   *
   * Six passes in one task would be six long tasks back to back, which is
   * exactly the jank the editor's workers exist to avoid. Yielding between
   * them costs about sixteen milliseconds in total and keeps the scroll smooth.
   */
  async function queue() {
    for (let index = 0; index < tiles.length; index += 1) {
      if (torn_down) return;
      await compute(index);
      await nextFrame();
    }
  }
</script>

<section class="section filters" id="filters">
  <div class="wrap split">
    <!--
      The left column is the list and the heading; the right is the work.
      Stacked rather than split into a floating corner paragraph, so the two
      read as one panel rather than as a headline with a caption in the corner.
    -->
    <div class="intro">
      <h2 class="h2" use:reveal>Make one photo look six different ways</h2>
      <p class="body" use:reveal={{ delay: 70 }}>
        Halftone dots, an oil paint pass, a warm film curve, a pencil sketch, a colour remap and a
        deliberate glitch. These are real renders of the same photograph rather than pictures of the
        filters, so what you see is exactly what the editor exports.
      </p>

      <ol class="tools" use:reveal={{ delay: 120 }}>
        {#each tiles as tile, index (tile.effect)}
          <li>
            <a class="tool" href="./editor.html?tool={tile.tool}">
              <span class="tool-index mono">{String(index + 1).padStart(2, "0")}</span>
              <span class="tool-text">
                <span class="tool-name">{tile.label}</span>
                <span class="tool-note">{tile.note}</span>
              </span>
              <span class="tool-key mono" aria-label="Keyboard shortcut {tile.shortcut}">
                {tile.shortcut}
              </span>
            </a>
          </li>
        {/each}
      </ol>
    </div>

    <!--
      One scroll container holding six equal cards, moved by the pointer, the
      keyboard or a flick. `scroll-snap` so a flick lands on a card rather than
      between two, and `overscroll-behavior: contain` so a flick that reaches
      the end does not carry on and scroll the page out from under the reader,
      which is the one behaviour that makes an inner scroller feel broken.

      `tabindex` because a scrollable region has to be focusable for the keyboard
      to be able to scroll it at all.
    -->
    <section
      class="rail"
      use:onceVisible={() => queue()}
      aria-label="Filter previews, six images of the same photograph"
    >
      {#each tiles as tile (tile.effect)}
        {@const entry = status[tile.effect]}
        <figure class="card">
          <!--
            Each card is a link, which is also how the rail is keyboard
            operable: tabbing to a card scrolls it into view, so the container
            itself does not need to be focusable. A `tabindex` on a plain
            container would only be there so the arrow keys could scroll it,
            which is strictly worse than making the six things inside it real
            links that open the tool each one is showing.
          -->
          <a class="card-link" href="./editor.html?tool={tile.tool}">
            <div class="plate" style:aspect-ratio="{FRAME.width} / {FRAME.height}">
            <!--
              The unprocessed photograph sits underneath as the placeholder, so
              every card has real pixels in it from the first paint. When the
              pass lands it covers them exactly, at the same size and the same
              crop, so nothing lays out and nothing shifts.
            -->
            <img src={SHOWCASE} alt="" loading="lazy" decoding="async" aria-hidden="true" />

            <!--
              A canvas with no fallback content is invisible to assistive
              technology, which is the wrong outcome for the thing on this
              section that carries information. So the description is a real
              element the canvas sits on top of, and the canvas itself is hidden
              from the tree.
            -->
            <span
              class="described"
              role="img"
              aria-label="The photograph with the {tile.label.toLowerCase()} filter applied, computed in this browser."
            >
              <canvas
                class="pass"
                class:pass--ready={entry.state === "done"}
                width={FRAME.width}
                height={FRAME.height}
                use:register={tile.effect}
                aria-hidden="true"
              ></canvas>
            </span>

            {#if entry.state === "running"}
                <span class="computing">
                  <span class="spinner" aria-hidden="true"></span>
                  Computing
                </span>
              {:else if entry.state === "failed"}
                <span class="fault">{entry.detail}</span>
              {/if}
            </div>

            <span class="card-caption">
              <span class="card-name">{tile.label}</span>
              <span class="card-key mono" aria-hidden="true">{tile.shortcut}</span>
            </span>
          </a>
        </figure>
      {/each}
    </section>
  </div>
</section>

<style>
  .filters {
    background: var(--surface-1);
    border-block: 1px solid var(--line-1);
  }

  /*
   * The list, then the rail.
   *
   * Two columns at a desktop width: the index of tools on the left, the work on
   * the right. The ratio gives the rail the larger share, because the
   * photographs are the argument and the list is the index.
   */
  .split {
    display: grid;
    grid-template-columns: 5fr 6fr;
    gap: clamp(2rem, 1rem + 4vw, 5rem);
    align-items: start;
  }

  /*
   * On a phone the two stack, but not as two equal halves. The list first, all
   * six rows, then the rail. The rail keeps a full-width card rather than being
   * squeezed beside a column of text, because a rail whose cards are half-width
   * is just a grid and the vertical reading is lost.
   */
  @media (max-width: 900px) {
    .split {
      grid-template-columns: 1fr;
      gap: var(--sp-tight);
    }

    .intro {
      position: static;
    }

    .rail {
      max-height: min(72dvh, 640px);
    }
  }

  @media (max-width: 560px) {
    .tool {
      padding-block: var(--s-3);
    }

    .rail {
      /* No right padding here: the scrollbar gutter would push the cards in from
         the edge on a phone, where there is no scrollbar to make room for. */
      padding-right: 0;
      scrollbar-gutter: auto;
    }
  }

  .intro {
    display: grid;
    gap: var(--s-6);
    align-content: start;
    /* Sticky, so the list stays put while the rail is scrolled and the two stay
       in conversation. Released where the two stack. */
    position: sticky;
    top: 104px;
  }

  .intro .body {
    max-width: 46ch;
  }

  /*
   * The tool index.
   *
   * A numbered list rather than a grid of cards: six rows, each one line of
   * name over one line of what it does, and the key at the right. The numbers
   * tie each row to the card at the same height in the rail.
   */
  .tools {
    display: grid;
    gap: 1px;
    margin: var(--s-2) 0 0;
    padding: 0;
    list-style: none;
    counter-reset: none;
  }

  .tool {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-4) var(--s-3);
    margin-inline: calc(var(--s-3) * -1);
    border-radius: var(--r-sm);
    text-decoration: none;
    transition: background var(--dur-1) var(--ease);
  }

  .tool:hover {
    background: var(--surface-2);
  }

  .tool-index {
    flex: none;
    font-size: 0.625rem;
    color: var(--text-3);
  }

  .tool-text {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .tool-name {
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.014em;
    color: var(--text-1);
  }

  .tool-note {
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--text-3);
  }

  .tool-key {
    flex: none;
    min-width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: var(--r-xs);
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    font-size: 0.625rem;
    color: var(--text-3);
    transition:
      border-color var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease);
  }

  .tool:hover .tool-key {
    border-color: var(--accent-line);
    color: var(--accent);
  }

  /*
   * The rail.
   *
   * A single vertical scroller, one card per row, snapped. `contain` on
   * overscroll is the part that matters: without it a flick that reaches the end
   * of the rail keeps going and scrolls the page out from under the reader, and
   * an inner scroller that does that feels broken rather than finished.
   *
   * The rail's height is capped against the viewport so the sticky list beside
   * it has something to be sticky against, and so the section does not become a
   * 4000px column of photographs.
   */
  .rail {
    display: grid;
    gap: var(--s-5);
    margin: 0;
    padding: var(--s-2) var(--s-3) var(--s-5) 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scroll-snap-type: y mandatory;
    /* Sized so a whole card and a clear band of the next are on screen at once.
       4:5 portrait cards are tall, so "two cards plus a peek" is not reachable
       inside a viewport, and a rail that shows exactly one card reads as a
       single picture rather than as something with more behind it. */
    max-height: min(72dvh, 700px);
    scrollbar-gutter: stable;
  }

  /*
   * No focus ring on the rail itself: it is not focusable. Each card inside it
   * is a link and carries its own ring, which is both a better target and a
   * better place for the indicator to be.
   */

  .card {
    margin: 0;
    scroll-snap-align: start;
    scroll-snap-stop: always;
  }

  .card-link {
    display: grid;
    gap: var(--s-3);
    text-decoration: none;
    border-radius: var(--r-md);
    /* The card has no background of its own, so the hit area is set by the
       plate and the caption rather than by a filled box. */
  }

  .card-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }

  .card-link:hover .plate {
    border-color: var(--line-3);
  }

  .plate {
    position: relative;
    overflow: hidden;
    border-radius: var(--r-md);
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 20px 44px -26px rgba(2, 6, 8, 0.9);
    isolation: isolate;
  }

  .plate img,
  .described,
  .pass {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .plate img,
  .pass {
    object-fit: cover;
  }

  /* The placeholder photograph is held back so the arrival of the pass reads as
     something happening rather than as a flash of unrelated colour. */
  .plate img {
    filter: saturate(0.55) brightness(0.85);
    transition: opacity var(--dur-3) var(--ease);
  }

  .pass {
    opacity: 0;
    transition: opacity var(--dur-3) var(--ease);
  }

  .pass--ready {
    opacity: 1;
  }

  .card:has(.pass--ready) .plate img {
    opacity: 0;
  }

  .card-caption {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }

  .card-name {
    font-size: var(--t-sm);
    font-weight: 600;
    letter-spacing: -0.012em;
    color: var(--text-1);
  }

  .card-key {
    min-width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border-radius: var(--r-xs);
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    font-size: 0.625rem;
    color: var(--text-3);
  }

  .computing,
  .fault {
    position: absolute;
    left: var(--s-3);
    bottom: var(--s-3);
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding: 5px var(--s-3);
    border-radius: var(--r-sm);
    background: rgba(6, 12, 14, 0.78);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-2);
  }

  .fault {
    left: var(--s-3);
    right: var(--s-3);
    bottom: var(--s-3);
    text-transform: none;
    letter-spacing: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--text-1);
  }

  /* A skeleton shaped like the tile, not a spinner in the middle of nowhere.
     Rotation is the one thing here that must stop for reduced motion, and the
     rule below does that. */
  .spinner {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--line-3);
    border-top-color: var(--accent);
    animation: turn 700ms linear infinite;
  }

  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      border-top-color: var(--accent);
      background: var(--accent-dim);
    }

    .plate img,
    .pass {
      transition: none;
    }

    /* Mandatory snapping is motion the reader did not ask for and cannot stop
       once it has started. Proximity still lands them on a card, it just does
       not insist. */
    .rail {
      scroll-snap-type: y proximity;
    }
  }
</style>
