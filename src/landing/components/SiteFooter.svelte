<script>
  /**
   * The closing band and the footer.
   *
   * One call to action on the whole page, and it says the same three words as
   * the one in the hero and the one in the header. A visitor who reads the hero
   * and scrolls to the end should find the same button, not a second offer
   * worded differently.
   *
   * The brand mark is out of its rounded tile here and sitting as a large
   * square, because this is the one place on the page that is only about the
   * product rather than about what it does.
   */
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRight";
  import GithubLogoIcon from "phosphor-svelte/lib/GithubLogo";

  import { MARK } from "../lib/photos.js";
  import { reveal } from "../lib/reveal.js";
  // The metadata half of the registry, not the registry itself, which would
  // pull all twenty-five tool components into a page that only lists names.
  import { TOOL_META, TOOL_GROUP_META } from "../../lib/tools.js";

  const GROUPS = TOOL_GROUP_META.map((group) => ({
    ...group,
    tools: TOOL_META.filter((tool) => tool.group === group.id),
  })).filter((group) => group.tools.length > 0);

  const YEAR = new Date().getFullYear();
</script>

<section class="close">
  <div class="wrap inner">
    <div class="words">
      <h2 class="h2" use:reveal>Open it and drop a photo in</h2>
      <p class="body" use:reveal={{ delay: 70 }}>
        Twenty-five tools, free, with nothing to sign up for and nothing to uninstall afterwards. The
        file you make is saved straight to your own device.
      </p>
      <a class="btn btn--primary" href="./editor.html" use:reveal={{ delay: 130 }}>
        Open the editor
        <ArrowRightIcon size={16} weight="bold" />
      </a>
    </div>

    <div class="badge" use:reveal={{ delay: 180 }}>
      <picture>
        <source srcset={MARK.webp} type="image/webp" />
        <img src={MARK.png} alt="The OpenLens icon" width="176" height="176" loading="lazy" />
      </picture>
    </div>
  </div>
</section>

<footer class="foot">
  <div class="wrap top">
    <div class="id">
      <a class="brand" href="./index.html">
        <picture>
          <source srcset={MARK.webp} type="image/webp" />
          <img src={MARK.png} alt="" width="26" height="26" loading="lazy" />
        </picture>
        <span>OpenLens</span>
      </a>
      <p class="tag">An image editor that runs on your machine, not on ours.</p>
      <a class="source block" href="https://github.com/" rel="noreferrer noopener">
        <GithubLogoIcon size={15} weight="fill" />
        Source
      </a>
    </div>

    <nav class="cols" aria-label="Tools by group">
      {#each GROUPS as group (group.id)}
        <div class="col">
          <h2 class="col-name">{group.label}</h2>
          <ul>
            {#each group.tools as tool (tool.id)}
              <li><a href="./editor.html?tool={tool.id}">{tool.label}</a></li>
            {/each}
          </ul>
        </div>
      {/each}
    </nav>
  </div>

  <div class="wrap bottom">
    <p class="fine">
      {YEAR} OpenLens. Runs in your browser, works offline, uploads nothing.
    </p>
    <p class="fine">Free, no account, no trackers, no cookies, no analytics.</p>
    <p class="fine credit">Built by <span class="org">Zero Gate Org</span></p>
  </div>
</footer>

<style>
  /*
 * The closing band.
 *
 * No border at its top, and the same tint at its top edge as the questions have
 * at their bottom edge, so the two share one continuous surface. A hairline here
 * was what made them read as two panels rather than as one end of the page.
 *
 * The radial glow is anchored a quarter of the way down rather than at the top
 * edge. Anchored at the top it peaked exactly on the seam and put a bright
 * patch against the questions' flat tint, which read as a fifth panel. Down here
 * it is a light source inside the band, which is what it was always meant to be.
 */
  .close {
    padding-block: var(--sp-section);
    background:
      radial-gradient(110% 130% at 74% 26%, rgba(110, 231, 168, 0.12), transparent 62%),
      linear-gradient(
        180deg,
        rgba(110, 231, 168, var(--seam-tint)) 0%,
        rgba(110, 231, 168, 0.022) 52%,
        transparent 100%
      );
  }

  .inner {
    display: grid;
    grid-template-columns: 7fr 5fr;
    gap: clamp(2.5rem, 1rem + 4vw, 5rem);
    align-items: center;
  }

  .words {
    display: grid;
    gap: var(--s-5);
    justify-items: start;
  }

  .badge img {
    width: 176px;
    height: 176px;
    border-radius: var(--r-lg);
    /* The icon carries its own gradient and a soft shadow already; this is just
       enough lift to sit it on the page. */
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.16),
      0 30px 70px -30px rgba(4, 10, 12, 0.95);
    justify-self: end;
  }

  .foot {
    padding-block: var(--s-8) var(--s-7);
    border-top: 1px solid var(--line-1);
    background: var(--surface-1);
  }

  .top {
    display: grid;
    grid-template-columns: 3fr 9fr;
    gap: clamp(2rem, 1rem + 3vw, 4rem);
    padding-bottom: var(--sp-tight);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--s-3);
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text-1);
    text-decoration: none;
  }

  .brand img {
    border-radius: var(--r-sm);
  }

  .tag {
    margin: var(--s-4) 0 0;
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--text-3);
    max-width: 26ch;
  }

  /* Even columns, so the five group headings sit on one line and the shorter
     ones do not leave a ragged edge under the wordmark. */
  .cols {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--s-6) var(--s-5);
  }

  .col-name {
    margin: 0 0 var(--s-3);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .col ul {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .col a {
    font-size: var(--t-xs);
    color: var(--text-2);
    text-decoration: none;
    transition: color var(--dur-1) var(--ease);
  }

  .col a:hover {
    color: var(--accent);
  }

  /* The overflow link is dimmer than a tool name, so it reads as a count rather
     than as one more tool. */
  /* An "and 7 more" line was tried here and removed: it shortened the columns
     and left the ragged bottoms looking like a truncation rather than a list.
     What actually made the footer read as broken was `auto` columns, which put
     the five headings at uneven x positions and let the last one float. Fixed
     fractions line them up. */

  /*
   * Three facts on one line, separated by hairlines rather than by push-apart.
   *
   * `space-between` was the original and it read as two unrelated items at the
   * edges of the page with a big hole between them. These are one sentence
   * about the same product, so they sit together and the dividers do the
   * separating.
   */
  .bottom {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-3) var(--s-5);
    padding-top: var(--s-5);
    border-top: 1px solid var(--line-1);
  }

  .bottom .fine + .fine {
    padding-left: var(--s-5);
    border-left: 1px solid var(--line-2);
  }

  /* The attribution sits at the end of the row and reads as the last item
     rather than as a third claim about the product. */
  .credit {
    margin-inline-start: auto;
  }

  .org {
    font-weight: 500;
    color: var(--text-2);
  }

  .fine {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--text-3);
  }

  .source {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--text-2);
    text-decoration: none;
    transition: color var(--dur-1) var(--ease);
  }

  .source:hover {
    color: var(--accent);
  }

  /* Under the wordmark rather than across the bottom bar, so the bottom bar
     carries one line of fact instead of a fact and a link. */
  .source.block {
    margin-top: var(--s-5);
  }

  @media (max-width: 900px) {
    .inner,
    .top {
      grid-template-columns: 1fr;
    }

    .badge img {
      width: 128px;
      height: 128px;
      justify-self: start;
    }
  }

  @media (max-width: 640px) {
    .cols {
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: var(--s-6) var(--s-5);
    }

    /* Stacked, the dividers would sit at the start of each line where there is
       nothing to divide from, so they go and each line stands on its own. */
    .bottom {
      display: grid;
      gap: var(--s-2);
    }

    .bottom .fine + .fine {
      padding-left: 0;
      border-left: 0;
    }
  }
</style>
