<script>
  /**
   * Text and stickers, fanned.
   *
   * Five cards in a fan, the centre one front and flat, the rest turned away
   * from it and stacked behind. Each carries one of the things the editor's
   * text tools do that a word processor does not: bend the baseline, outline the
   * glyph, fill the glyph with a repeating mark, set words behind the subject,
   * and place marks you can move and turn.
   *
   * The treatments are CSS and SVG rather than canvas on purpose. On this page
   * they are pictures of the treatments, and rendering them as live text means
   * they stay sharp at any zoom, weigh nothing, and can be read by a screen
   * reader. The editor's own text tools draw to canvas because they composite
   * over arbitrary pixels at image resolution; a specimen does not have that
   * problem.
   *
   * The stickers are the editor's real catalogue, imported from
   * `core/stickerkit.js`, rather than marks drawn for this page. The catalogue
   * is the product's, so the specimen cannot drift from what ships.
   *
   * The fan assembles as the section scrolls into view, not on hover. Hover was
   * tried and it is the wrong trigger twice over: a visitor on a touch screen
   * never gets it, and a visitor who scrolls past never sees the arrangement
   * finish. `scrollProgress` writes one custom property, `--open`, and every
   * card's turn, lift, scale and fade is a function of it.
   */
  import { CATALOGUE } from "../../lib/core/stickerkit.js";
  import { SPECIMENS } from "../lib/photos.js";
  import { reveal, scrollProgress } from "../lib/reveal.js";

  const sticker = (key) => CATALOGUE.find((item) => item.key === key);

  /**
   * Five specimens, left to right.
   *
   * `turn` is the card's own rotation away from the front one, in degrees: a
   * negative to the left of the fan, a positive to the right. `lift` drops a
   * card as it goes behind, which is what makes the stack read as depth rather
   * than as a flat row of tilted rectangles. `dim` is how far back it sits.
   *
   * The angles are uneven on purpose. A symmetric set reads as a mirror, and
   * cards dealt by hand are never symmetric.
   *
   * The front card is the text-behind specimen: a lone figure against open
   * water, with the words set large and pale around them. It is the clearest
   * demonstration of a tool that has no equivalent in a word processor, so it is
   * the one worth giving the middle.
   */
  const SPECS = [
    {
      id: "curved",
      tool: "curvedtext",
      name: "Curved text",
      shortcut: "t",
      photo: SPECIMENS.curved,
      alt: "A road cut into a mountainside under a wide sky.",
      note: "Bend a line of words round any arc you choose.",
      turn: -19,
      lift: 34,
      dim: 0.82,
    },
    {
      id: "stroke",
      tool: "stroketext",
      name: "Stroke text",
      shortcut: "k",
      photo: SPECIMENS.stroke,
      alt: "A weathered stone doorway with a carved wooden door.",
      note: "Give the letters an outline, or fill them in solid.",
      turn: -9,
      lift: 12,
      dim: 0.9,
    },
    {
      id: "behind",
      tool: "textbehind",
      name: "Text behind",
      shortcut: "d",
      photo: SPECIMENS.behind,
      alt: "A lone walker on a rocky ledge above still water.",
      note: "Put the words behind your subject, cut out around them.",
      turn: 0,
      lift: 0,
      dim: 1,
      front: true,
    },
    {
      id: "stickers",
      tool: "stickers",
      name: "Stickers",
      shortcut: "e",
      photo: SPECIMENS.stickers,
      alt: "A person in a pale head covering looking out over flat water.",
      note: "Drop in stars, crowns and sparkles, then move and turn them.",
      turn: 8,
      lift: 14,
      dim: 0.9,
    },
    {
      id: "pattern",
      tool: "patterntext",
      name: "Pattern text",
      shortcut: "r",
      photo: SPECIMENS.pattern,
      alt: "A lit suspension bridge over dark water at night.",
      note: "Fill the words with stripes, dots or any repeating mark.",
      turn: 20,
      lift: 36,
      dim: 0.8,
    },
  ];

  const CENTER = SPECS.findIndex((spec) => spec.front);
</script>

<section class="section" id="text">
  <div class="wrap">
    <header class="head">
      <h2 class="h2" use:reveal>Text that goes into the photo, not on top of it</h2>
      <p class="body" use:reveal={{ delay: 70 }}>
        Curve a headline round an arc, outline it, fill the letters with a pattern, tuck it behind your
        subject, or drop in stickers you can drag and turn. It all exports as part of the image, so it
        scales and crops with the photograph instead of riding on top of it like a caption box.
      </p>
    </header>

    <!--
      A list, not a grid of `<figure>`s. It is one object, so it is one `ul`
      with the fan as its layout, and the cards inside it are links.
    -->
    <ul class="fan" use:scrollProgress>
      {#each SPECS as spec, index (spec.id)}
        <li class="seat" class:seat--front={index === CENTER} style:--turn="{spec.turn}deg" style:--lift="{spec.lift}px" style:--dim={spec.dim}>
          <a
            class="card"
            href="./editor.html?tool={spec.tool}"
            aria-label="{spec.name}. {spec.note}"
          >
            <img src={spec.photo} alt={spec.alt} loading="lazy" decoding="async" />

            <span class="layer" aria-hidden="true">
              {#if spec.id === "curved"}
                <svg class="arc" viewBox="0 0 260 110" role="presentation">
                  <defs>
                    <path id="fan-arc" d="M 12 100 Q 130 8 248 100" fill="none" />
                  </defs>
                  <text>
                    <textPath href="#fan-arc" startOffset="50%" text-anchor="middle">OPENLENS</textPath>
                  </text>
                </svg>
              {:else if spec.id === "stroke"}
                <span class="outlined">LOCAL<br />FIRST</span>
              {:else if spec.id === "behind"}
                <span class="behind">NEVER<br />UPLOADED</span>
              {:else if spec.id === "pattern"}
                <span class="patterned">NO&nbsp;UPLOAD</span>
              {:else}
                <span class="marks">
                  {#each [sticker("star5"), sticker("sparkles"), sticker("crown")] as mark (mark.key)}
                    <svg viewBox={mark.viewBox} role="presentation">
                      <!-- The catalogue's own markup, trusted and authored in
                           core/stickerkit.js. See the note there: no external
                           URL, no web font, no image reference. -->
                      {@html mark.body}
                    </svg>
                  {/each}
                </span>
              {/if}
            </span>

            <!--
              Inside the card, so it clips with it.

              As a sibling of the card the caption painted over the neighbouring
              card's photograph and got cut in half by the front card standing in
              front of it, which read as a broken word rather than as a card
              behind another card. Inside, it is bounded by the same rounded box
              as the photograph and can never escape it.

              It carries its own solid band rather than relying on the card's
              gradient, because at a rotation the gradient underneath is not the
              thing the caption is actually sitting on.

              Decorative and hidden from the tree, because the link now carries
              its own name and the note that goes with it. The photograph's alt
              text describes the picture, which is a different job and does not
              need to be announced twice.
            -->
            <span class="caption" aria-hidden="true">
              <span class="caption-name">{spec.name}</span>
              <span class="caption-key mono">{spec.shortcut}</span>
            </span>
          </a>
        </li>
      {/each}
    </ul>

    <!--
      The index under the fan.

      The five cards each name a tool and show what it does, which leaves a
      visitor who has never heard of curved text or a pattern fill with five
      titles and no way to tell them apart. The note for each was written here
      all along and never rendered: it was in the data and not on the page.

      So it goes under the fan as a plain list, the same shape as the filter
      gallery's index, which gives the two sections one pattern for "here is the
      list, there is the work". The card captions stay one line, because at
      3:5 and a card width of 148px a two-line note is a band across the top of
      the photograph and the geometry above is built around that band's height.
    -->
    <ul class="index">
      {#each SPECS as spec (spec.id)}
        <li>
          <a href="./editor.html?tool={spec.tool}">
            <span class="index-name">{spec.name}</span>
            <span class="index-note">{spec.note}</span>
          </a>
        </li>
      {/each}
    </ul>
  </div>
</section>

<style>
  .head {
    display: grid;
    gap: var(--s-5);
    max-width: 640px;
    margin-bottom: clamp(2.5rem, 1.5rem + 3vw, 4rem);
  }

  /*
   * The fan.
   *
   * The cards are laid out in one flex row and each is turned with a transform
   * rather than a rotation on an axis, so the rotation is a composited layer and
   * the photograph inside is not resampled per frame.
   *
   * `--open` is written by `scrollProgress` and runs 0 to 1 as the section comes
   * up the screen. Every card's travel, turn and fade is a function of it, so
   * the arrangement assembles as you scroll rather than sitting finished and
   * waiting. Hover does nothing: a layout that only moves when pointed at is a
   * layout some visitors never see move at all.
   */
  .fan {
    /* The settled value, so the fan is correct before the action runs and on
       any browser where the progress loop does not start. */
    --open: 1;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    /* Room for the outer cards to swing past the container's edge without being
       clipped, and for the shadow they cast. The horizontal padding is the widest
       swing in the arrangement, so it is the one that has to fit. */
    padding: var(--s-7) clamp(1rem, 5vw, 4.5rem) clamp(3.5rem, 2rem + 4vw, 6rem);
    margin: 0;
    list-style: none;
    perspective: 1600px;
    perspective-origin: 50% 40%;
  }

  /*
   * One seat.
   *
   * Everything is multiplied by `--open`: at 0 the card is square to the viewer,
   * at its resting height and fully lit; at 1 it has turned away, dropped back
   * and dimmed to the values its markup declares. The front card has a turn and
   * a lift of zero, so it simply scales up as the fan opens.
   *
   * No transition here on purpose. A transition would fight the progress value
   * every frame, lagging behind the scroll by its own duration. The value is
   * already being written per frame, so the motion is frame-accurate and needs
   * no easing of its own.
   */
  .seat {
    --card-w: clamp(148px, 15.5vw, 224px);
    flex: 0 0 var(--card-w);
    /* Negative margins pull the cards into an overlap. Each seat takes one, so
       the overlap is the same between every pair. */
    margin-inline-start: calc(var(--card-w) * -0.3);
    transform: translate3d(0, calc(var(--lift) * var(--open)), 0)
      rotate(calc(var(--turn) * var(--open)))
      scale(calc(0.9 + 0.1 * var(--open)));
    /* Rotating about a point below the card, the way a hand fans cards out on a
       table rather than spinning them about their own centres. */
    transform-origin: 50% 150%;
  }

  .seat:first-child {
    margin-inline-start: 0;
  }

  /* The front card sits above everything and stays upright: its own turn and
     lift are zero, so it simply scales up as the fan opens. */
  .seat--front {
    z-index: 3;
  }

  .card {
    position: relative;
    display: block;
    overflow: hidden;
    /* Taller than it is wide, the way a photograph is held up. A 4:5 card in a
       five-card fan reads as a wide deck; 3:5 reads as photographs. */
    aspect-ratio: 3 / 5;
    border-radius: var(--r-md);
    /* The button radius, like the nav tab and every other surface. A fan of
       pills reads as a carousel of chips, not as photographs. */
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    /* Cards behind the front one are held back a little, and hold back further
       while the fan is still closed. Enough to separate them from the front one,
       not so much that the photographs go grey. */
    opacity: calc(var(--dim) * calc(0.55 + 0.45 * var(--open)));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 18px 40px -22px rgba(2, 6, 8, 0.9);
    isolation: isolate;
  }

  /* A card under the pointer gets a slightly stronger edge. Deliberately no
     transform on hover: the movement here belongs to the scroll, and a card
     that lurches when pointed at competes with it. */
  .seat:hover .card {
    border-color: var(--line-3);
  }

  .seat--front .card {
    opacity: 1;
    border-color: var(--line-3);
  }

  /* The scrim. Only the band the caption sits in, so the photograph is not
     darkened all over. */
  /* The card's own gradient only has to serve the type now, so it is kept out
     of the caption's way: it starts below the band rather than behind it. */
  .card::after {
    content: "";
    position: absolute;
    inset: 44px 0 0 0;
    background: linear-gradient(
      170deg,
      transparent 44%,
      rgba(4, 10, 12, 0.48) 78%,
      rgba(4, 10, 12, 0.8) 100%
    );
    pointer-events: none;
    z-index: 1;
  }

  .card img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /*
   * The treatment, set in the lower half of the card so it clears the caption
   * band across the top.
   *
   * `align-content: center` inside a box inset from the top by the caption's
   * height. Flush to an edge the type reads as clipped rather than placed.
   */
  .layer {
    position: absolute;
    inset: 44px 0 10% 0;
    z-index: 2;
    display: grid;
    align-content: center;
    justify-items: center;
    padding-inline: var(--s-4);
  }

  /* --- Curved: a real SVG arc, the shape the tool's radius and sweep
         describe. ------------------------------------------------------- */
  .arc {
    width: 100%;
    height: auto;
    overflow: visible;
  }

  .arc text {
    font-family: var(--font-ui);
    font-size: 30px;
    font-weight: 700;
    letter-spacing: 0.06em;
    fill: #ffffff;
    stroke: rgba(4, 10, 12, 0.6);
    stroke-width: 5;
    paint-order: stroke fill;
  }

  /* --- Stroke: outlined glyphs, which is what the tool's paint order does. */
  .outlined {
    font-size: clamp(1.1rem, 0.6rem + 1.9vw, 1.7rem);
    font-weight: 800;
    line-height: 0.92;
    letter-spacing: -0.02em;
    text-align: center;
    color: transparent;
    -webkit-text-stroke: 1.5px #ffffff;
    paint-order: stroke fill;
  }

  /* --- Pattern: the glyphs are the window, the fill is a repeating mark. */
  .patterned {
    font-size: clamp(0.9rem, 0.55rem + 1.3vw, 1.25rem);
    font-weight: 800;
    letter-spacing: -0.01em;
    text-align: center;
    color: transparent;
    background-image: repeating-linear-gradient(
      -45deg,
      #ffffff 0 3px,
      rgba(255, 255, 255, 0.32) 3px 6px
    );
    -webkit-background-clip: text;
    background-clip: text;
  }

  /* --- Text behind: the words are set large and pale, so they read as being
         under the picture rather than on it. That is the effect the tool
         produces by masking around the subject, approximated here by contrast.
         Honest about being a specimen. */
  .behind {
    font-size: clamp(1.1rem, 0.7rem + 1.7vw, 1.7rem);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.02em;
    text-align: center;
    color: rgba(255, 255, 255, 0.3);
    text-shadow: 0 1px 0 rgba(4, 10, 12, 0.45);
  }

  /* --- Stickers: the editor's own marks, scaled and turned. */
  .marks {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }

  .marks svg {
    width: 30px;
    height: 30px;
    filter: drop-shadow(0 3px 6px rgba(4, 10, 12, 0.7));
  }

  .marks svg:nth-child(1) {
    width: 25px;
    height: 25px;
    transform: rotate(-14deg);
  }

  .marks svg:nth-child(3) {
    width: 34px;
    height: 34px;
    transform: rotate(9deg);
  }

  /*
 * Inside the card, so it is bounded by the card's own rounded box and clipped
 * with it. As a sibling it painted over the neighbouring photograph and got cut
 * in half by the card in front of it.
 *
 * Across the TOP rather than the bottom, and that is geometry rather than taste.
 * The front card is the tallest thing in the fan: the outer cards are dropped
 * and turned away from it, so it is the card that reaches highest and it stands
 * in front of everything. A caption along the bottom edge therefore lands
 * underneath the front card's lower corner and loses its first letters. Up top,
 * the front card's neighbours are clear of it, because the front card is the
 * only one up there.
 *
 * It carries its own solid band rather than relying on the card's gradient,
 * because at a rotation the gradient underneath is not what it is sitting on.
 */
  .caption {
    position: absolute;
    inset: 0 0 auto 0;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-3);
    background: rgba(6, 12, 14, 0.8);
    /* Square the top corners to match the card. */
    border-radius: var(--r-md) var(--r-md) 0 0;
    pointer-events: none;
  }

  .caption-name {
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: -0.008em;
    color: var(--text-1);
  }

  .caption-key {
    display: grid;
    place-items: center;
    min-width: 17px;
    height: 17px;
    padding-inline: 3px;
    border-radius: var(--r-xs);
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(6, 12, 14, 0.7);
    font-size: 0.625rem;
    color: var(--text-2);
  }

  /*
   * The index.
   *
   * Five columns on top of a wide fan, two rows at tablet, one on a phone. It
   * is text under a picture, so it is a grid of reading blocks rather than a
   * numbered list: no numbers, because the cards above are already in a
   * deliberate left-to-right order and numbering them would imply the order
   * means something.
   */
  .index {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--s-5);
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--line-1);
    padding-top: var(--sp-tight);
  }

  .index a {
    display: grid;
    gap: 2px;
    text-decoration: none;
    border-radius: var(--r-xs);
  }

  .index-name {
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.014em;
    color: var(--text-1);
    transition: color var(--dur-1) var(--ease);
  }

  .index-note {
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--text-3);
  }

  .index a:hover .index-name {
    color: var(--accent);
  }

  @media (max-width: 900px) {
    .index {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 520px) {
    .index {
      grid-template-columns: 1fr;
      gap: var(--s-4);
    }
  }

  /*
   * Narrower than the fan can hold five cards, so it collapses.
   *
   * Below this the cards are too small for the type on them to be legible and
   * the overlap hides most of every card, so the fan becomes a plain grid of
   * five at a readable size and the fan's job is left to the top of the range.
   * The captions stay on the cards: each one is inside its own card's clipped
   * box, so it survives the change of arrangement without a second rule.
   */
  @media (max-width: 720px) {
    .fan {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
      gap: var(--s-4);
      padding: 0;
      perspective: none;
    }

    /* Flat and untinted: there is no depth left to describe. */
    .seat,
    .seat--front {
      margin-inline-start: 0;
      transform: none;
      z-index: auto;
    }

    .card {
      opacity: 1;
    }
  }

  /*
   * Reduced motion.
   *
   * Nothing to switch off here. `scrollProgress` never starts its loop under
   * reduced motion and writes `--open: 1` instead, so the fan is simply already
   * arranged: the composition is information and it stays, the travel is the
   * decoration and it never begins. What is left is pinning the value so a
   * browser that does run the action cannot reintroduce the movement.
   */
  @media (prefers-reduced-motion: reduce) {
    .fan {
      --open: 1 !important;
    }
  }
</style>
