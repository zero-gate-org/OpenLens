<script>
  /**
   * The tool orbit.
   *
   * Fourteen tool icons on three concentric rings around the OpenLens mark.
   *
   * Fourteen, not twenty-five. The filters and the text tools each have a section
   * of their own further down the page, and the hero runs four of the filters
   * live, so putting those eleven icons here as well would show the reader the
   * same tool three times. What is left is the fourteen that appear nowhere
   * else, and this section is where they belong.
   *
   * Rings are mirrored about the vertical axis so the icons read as two ordered
   * flanks either side of the mark rather than as a dial. Ring four is a pair on
   * the horizontal axis at the widest radius; the two tools that came off it sit
   * at the top and bottom of the innermost ring. See `RINGS`.
   *
   * Nothing here rotates. A slowly turning diagram always looks like it is
   * showing off, and it would fight the page's own scroll motion.
   *
   * The icons are also drawn from the first paint rather than on arrival. They
   * were on a scroll-driven reveal, which read well on the way down and left a
   * circle of invisible nodes behind whenever the section was reached any other
   * way, or when anything took a full-page screenshot from the top. A diagram you
   * cannot see until you happen to find it is not showing what it has.
   */
  import { TOOL_META, TOOL_GROUP_META } from "../../lib/tools.js";
  import { reveal } from "../lib/reveal.js";
  import { MARK } from "../lib/photos.js";

  /** Shown in the hero, the filter gallery or the text specimens. */
  const SHOWN_ELSEWHERE = new Set([
    // Live in the hero's before/after.
    "gradientmap",
    "halftone",
    "oilpaint",
    "glitch",
    // In the filter gallery.
    "sketch",
    "lomo",
    // In the text specimens.
    "curvedtext",
    "stroketext",
    "textbehind",
    "stickers",
    "patterntext",
  ]);

  const TOOLS = TOOL_META.filter((tool) => !SHOWN_ELSEWHERE.has(tool.id));

  /**
 * The rings, inside out, written as clock positions.
 *
 *   ring 1   three, six, nine, twelve   the four cardinal points
 *   ring 2   two, four, eight, ten      the next hour marks out
 *   ring 3   half past two and four     the half-hour marks, and their mirrors
 *   ring 4   three and nine             a wide pair, level with the mark
 *
 * Four, four, four, two. That is fourteen, which is what is left once the eleven
 * tools that appear in the hero, the filter gallery or the text specimens are
 * taken out.
 *
 * Rings one to three are each mirrored about the vertical axis, so the icons
 * read as two ordered flanks either side of the mark. Ring four is a pair on the
 * horizontal axis at the widest radius, which is where the two tools from its
 * original four positions went; the other two of those moved inward to the top
 * and the bottom of the first ring.
 *
 * Radii are fractions of the stage's measured width, written out as lengths by
 * the component rather than left as percentages. A percentage inside a transform
 * resolves against the element's own box, so `translate(30%)` on a 54px node is
 * 16px and every icon ends up in the middle. The outer ring needs about 0.478 to
 * leave room for a node's half-width inside the stage.
 */
const RINGS = [
  { radius: 0.185, angles: [0, 90, 180, 270] },
  { radius: 0.295, angles: [30, 150, 210, 330] },
  { radius: 0.395, angles: [15, 165, 195, 345] },
  { radius: 0.478, angles: [0, 180] },
];

  let width = $state(1160);

  /**
   * The ring radii in pixels, from the stage's measured width.
   *
   * Measured rather than derived in CSS, because a percentage inside a transform
   * resolves against the element's own box. `min(100%, 1160px)` as a transform
   * length resolves against the 54px node, so every radius came out about ten
   * pixels and all the icons piled up in the middle. The only way to get a radius
   * that means a distance from the centre is to measure the stage and write the
   * distance out.
   *
   * Each is then capped at half the stage less the node's own half-width. The
   * fractions alone put the outermost icons a few pixels past the edge on a
   * narrower screen, and an icon sliced by its own container is the one clipping
   * this layout cannot afford.
   */
  const NODE_HALF = 27;

  /** @type {number[]} */
  const radii = $derived(RINGS.map((ring) => Math.min(width * ring.radius, width / 2 - NODE_HALF)));

  /** @type {string[]} */
  const radiusVars = $derived(radii.map((r) => `${Math.round(r)}px`));

  /**
   * How tall the diagram actually is.
   *
   * The stage was a square, so it reserved half a diameter of height for the top
   * and bottom of the outer rings, which hold nothing there: the outermost pair
   * is at three and nine o'clock and the next ring out is at half past two and
   * four. On a 1160px stage that was about 670px of empty space above and below
   * the mark, which pushed the diagram half a screen down the page for nothing.
   *
   * So the height is the vertical reach of the outermost icon, plus the node's
   * own half-width. The result is a wide band with the inner ring closing into a
   * full circle around the mark and the outer rings running off the top and bottom
   * of the box, which reads as a crop of a larger orbit rather than as a circle
   * that failed to render.
   */
  const height = $derived(
    Math.round(
      2 *
        (Math.max(
          ...RINGS.flatMap((ring, i) =>
            ring.angles.map((angle) => Math.abs(Math.sin((angle * Math.PI) / 180)) * radii[i]),
          ),
        ) +
          NODE_HALF),
    ),
  );

  const PLACED = (() => {
    let index = 0;
    const seats = [];

    RINGS.forEach((ring, ringIndex) => {
      for (const angle of ring.angles) {
        const tool = TOOLS[index];
        if (!tool) break;
        seats.push({
          tool,
          ring: ringIndex + 1,
          group: TOOL_GROUP_META.find((g) => g.id === tool.group)?.label ?? "",
          angle,
        });
        index += 1;
      }
    });

    return seats;
  })();
</script>

<section class="section section--orbit" id="tools">
  <div class="wrap">
    <!--
      The heading, above the diagram rather than inside it.

      It was in the middle at first, on the theory that a diagram should hold its
      own title. With fourteen icons on three rings there is no room for a
      heading and a paragraph in the middle that is not sitting on top of
      something, so the text went back to the top of the section where it reads
      normally and the centre of the diagram holds only the mark.
    -->
    <!--
      Every heading and paragraph on this page answers "what can I do with my
      photo", not "how is this page arranged". Referring a visitor to which
      section another tool lives in is a fact about the layout, and the layout
      is not what they came for.
    -->
    <header class="head">
      <h2 class="h2" use:reveal>Frame it, cut it out, finish it</h2>
      <p class="body" use:reveal={{ delay: 70 }}>
        Straighten a shot, knock the background out, blur what you would rather not show, then frame it
        and sign it. Every icon here opens the editor with that tool already loaded, so you can try it
        on a photo of your own in one click.
      </p>
    </header>

    <div
      class="stage"
      bind:clientWidth={width}
      style:--r1={radiusVars[0]}
      style:--r2={radiusVars[1]}
      style:--r3={radiusVars[2]}
      style:--r4={radiusVars[3]}
      style:height="{height}px"
    >
      <!--
        The rings, behind everything. They carry no information: they are the
        guide the fourteen nodes are positioned against, and they are drawn
        first so they sit behind. Their border is a fraction of the page's own
        hairline, because a diagram that depends on them should not also shout
        about them.
      -->
      <div class="rings" aria-hidden="true">
        {#each RINGS as ring, index (ring.radius)}
          <div class="ring" data-ring={index + 1}></div>
        {/each}
      </div>

      <!--
        The centre: the mark and nothing else.

        The heading and the paragraph are above the diagram. What is left here is
        the product's own icon, which is the one thing in the middle of fourteen
        tools that belongs in the middle.
      -->
      <div class="hub">
        <picture>
          <source srcset={MARK.webp} type="image/webp" />
          <img src={MARK.png} alt="" width="64" height="64" />
        </picture>
      </div>

      <ul class="orbit">
        {#each PLACED as seat (seat.tool.id)}
          {@const Icon = seat.tool.icon}
          <li class="node" data-ring={seat.ring} style:--angle="{seat.angle}deg">
            <a
              href="./editor.html?tool={seat.tool.id}"
              aria-label="{seat.tool.label}, {seat.group}. Keyboard shortcut {seat.tool.shortcut}."
            >
              <Icon size={24} weight="light" />

              <!--
                The name only. The group and the shortcut are both already said
                elsewhere: the group is which ring and side a tool sits on, and
                the shortcut is in the link's accessible name for anyone who
                needs it spoken. Putting all three in a tooltip made a three-line
                label over a 54px icon, which covered the icons behind it.
              -->
              <span class="label" aria-hidden="true">{seat.tool.label}</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</section>

<style>
  /*
   * The stage.
   *
   * A square that fills the content width, capped so it does not become a
   * postage stamp in the middle of a very wide screen. `--r1`, `--r2` and
   * `--r3` are the three ring radii as lengths, written by the component from
   * the measured width and read by both the circles and the nodes: one source
   * for both is the only reason they agree.
   */
  .stage {
    /* Each node and each ring picks its radius from the ring it is on. */
    --r: var(--r1);
    position: relative;
    /* The full content width, so the diagram is the section rather than a
       diagram in the middle of one. */
    width: min(100%, 1160px);
    /* Height comes from the component: it is the vertical reach of the highest
       icon, not half a diameter. A square here reserved empty space above and
       below for parts of the outer rings that carry nothing. */
    margin-inline: auto;
  }

  /*
   * The rings, masked to the band the icons actually occupy.
   *
   * The circles are real circles, so the outer two are wider than the box that
   * holds them and were drawn hundreds of pixels above and below it, into the
   * sections above and below this one. That is what made the neighbouring
   * sections look like they were falling into this one.
   *
   * `no-repeat` is what stops the fade tiling back in past the ends of the box;
   * without it the gradient repeats and the circles come straight back. With it,
   * the outer rings enter from the left and right and run off the top and bottom
   * as they fade, which reads as a crop of a larger orbit rather than as a circle
   * that failed to finish.
   *
   * Only the rings are masked. The nodes are not, because an icon fading out at
   * the edge of the diagram is an icon you cannot click.
   */
  .rings {
    mask-image: linear-gradient(180deg, transparent 0%, #000 24%, #000 76%, transparent 100%);
    mask-repeat: no-repeat;
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 24%, #000 76%, transparent 100%);
    -webkit-mask-repeat: no-repeat;
  }

  .rings,
  .ring {
    position: absolute;
    inset: 0;
    margin: auto;
    pointer-events: none;
  }

  .ring {
    width: calc(var(--r) * 2);
    height: calc(var(--r) * 2);
    /* Two thirds of the page's own hairline. The ring is scaffolding: it
       positions the nodes and the nodes are the content. At full strength the
       three circles competed with fourteen icons and the icons lost, and taken
       further down they stopped reading as circles at all. */
    border: 1px solid color-mix(in srgb, var(--line-1) 65%, transparent);
    border-radius: 50%;
  }

  .ring[data-ring="2"],
  .node[data-ring="2"] {
    --r: var(--r2);
  }

  .ring[data-ring="3"],
  .node[data-ring="3"] {
    --r: var(--r3);
  }

  .ring[data-ring="4"],
  .node[data-ring="4"] {
    --r: var(--r4);
  }

  /*
 * Extra room top and bottom, over the page's own section rhythm.
 *
 * The diagram is a wide, shallow band now, so it sits closer to the section
 * either side than a full-height section does, and the heading needs air above
 * it before the circles fade out.
 */
.section--orbit {
  padding-block: calc(var(--sp-section) + var(--s-6));
}

.head {
    display: grid;
    gap: var(--s-5);
    max-width: 640px;
    /* Clearance above the heading as well as below it. The page's own section
       rhythm sets the distance to the neighbouring sections, and this adds the
       gap between the copy and the diagram it introduces. */
    margin: 0 auto clamp(1.5rem, 4vw, 3.5rem);
    text-align: center;
  }

  .hub {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    align-content: center;
    justify-items: center;
    /* Just the mark. The hub is small enough that the inner ring's icons sit
       clear either side of it rather than crowding it; see `RINGS`. */
    width: calc(var(--r1) * 0.75);
    height: calc(var(--r1) * 0.75);
    margin: auto;
  }

  .hub img {
    border-radius: var(--r-md);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.16),
      0 18px 40px -24px rgba(4, 10, 12, 0.9);
  }

  .orbit {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /*
 * One node.
 *
 * Rotate into place, translate out along the rotated axis, rotate back so the
 * icon is upright. One composited transform, and no transition on it: the whole
 * diagram is static, and a transition here would only delay the first paint.
 */
  .node {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 3;
    transform: translate(-50%, -50%) rotate(var(--angle)) translate(var(--r)) rotate(calc(-1 * var(--angle)));
  }

  .node a {
    display: grid;
    place-items: center;
    width: 54px;
    height: 54px;
    border-radius: var(--r-md);
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.07),
      0 12px 28px -16px rgba(2, 6, 8, 0.9);
    color: var(--text-2);
    text-decoration: none;
    transition:
      background var(--dur-1) var(--ease),
      border-color var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease),
      transform var(--dur-2) var(--ease-out);
  }

  .node a:hover,
  .node a:focus-visible {
    background: var(--accent-dim);
    border-color: var(--accent-line);
    color: var(--accent);
    transform: scale(1.12);
  }

  .node a:active {
    transform: scale(0.96);
  }

  /*
   * The label.
   *
   * Fourteen unlabelled icons are a puzzle, so the name is one hover, one
   * keyboard focus or one tap away. It sits below the node, centred on it, so a
   * node on the right of the orbit pushes its label left and one on the left
   * pushes it right rather than both running off the stage.
   */
  /*
   * The name.
   *
   * Fourteen unlabelled icons are a puzzle, so the name is one hover, one
   * keyboard focus or one tap away. One line of it: the group and the shortcut
   * are both said elsewhere, and a three-line label over a 54px icon covers the
   * icons behind it.
   */
  .label {
    position: absolute;
    top: 100%;
    left: 50%;
    z-index: 5;
    width: max-content;
    max-width: 160px;
    margin-top: var(--s-2);
    padding: 5px var(--s-3);
    border-radius: var(--r-sm);
    border: 1px solid var(--line-2);
    background: var(--surface-0);
    box-shadow: 0 14px 34px -16px rgba(2, 6, 8, 0.95);
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: -0.008em;
    line-height: 1.4;
    color: var(--text-1);
    text-align: center;
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, -4px);
    transition:
      opacity var(--dur-1) var(--ease),
      transform var(--dur-2) var(--ease-out);
  }

  .node a:hover .label,
  .node a:focus-visible .label {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  /*
   * Below this the orbit is not a diagram any more.
   *
   * At phone widths the rings would be about 80px across with 54px nodes on
   * them, which is not a picture of anything. So it becomes a grid of icon and
   * name, one tile each: the same fourteen tools in the form that survives a
   * small screen.
   */
  @media (max-width: 860px) {
    .stage {
      width: 100%;
      /* The measured height is for the orbit. In the grid the height is whatever
         the rows need, so the component's value is dropped. */
      height: auto !important;
      display: grid;
      grid-template-columns: 1fr;
    }

    .rings,
    .hub {
      display: none;
    }

    .orbit {
      position: static;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: var(--s-2);
    }

    .node {
      position: static;
      opacity: 1;
      transform: none;
    }

    .node a {
      /* The name beside the icon rather than under it, so the tile is one row
         and fourteen of them are seven rows rather than fourteen. */
      grid-auto-flow: column;
      justify-content: start;
      justify-items: start;
      gap: var(--s-3);
      width: 100%;
      height: 48px;
      padding-inline: var(--s-3);
    }

    .label {
      position: static;
      width: auto;
      max-width: none;
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      box-shadow: none;
      opacity: 1;
      transform: none;
      text-align: left;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    /* Nothing here moves. The diagram is static and the hover states are the
       only thing left that animates. */
    .node a,
    .label {
      transition: none;
    }
  }
</style>