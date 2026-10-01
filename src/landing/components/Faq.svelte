<script>
  /**
   * The honest section.
   *
   * Three things people ask before they trust a browser editor with a photo
   * they care about, and three that come up once they have used it. Answered
   * plainly, with no hedging and nothing that is not true of the code.
   *
   * A disclosure rather than an accordion script: `<details>` is keyboard
   * operable, works without JavaScript, is announced correctly by screen
   * readers, and costs nothing. The one thing it needs is a marker that is not
   * the browser's default triangle, which is styled below.
   */
  import { reveal } from "../lib/reveal.js";

  /*
   * The questions people actually ask, phrased the way they ask them.
   *
   * Each answer is short enough to be read with the next one still closed, and
   * every one of them is a fact about the code rather than a reassurance. The
   * two that cost the product something, losing your work on close and losing
   * your history between visits, are answered first among their own kind
   * rather than buried: a reader who finds the bad news and keeps going is
   * worth more than one who does not find it.
   */
  const QUESTIONS = [
    {
      q: "Does my photo get uploaded anywhere?",
      a: "No. There is no code that sends it. Cropping, filtering and export all run in the tab, and the export is written straight to your downloads folder. The background remover downloads its segmentation model on first use and runs it locally, which is why it works offline afterwards.",
    },
    {
      q: "What happens if I close the tab?",
      a: "Your work goes with it. There is no autosave and no copy on a server, because a copy on a server is the one thing this tool will not do. Export before you close, the same as with any editor you have not given an account to.",
    },
    {
      q: "Does it work offline?",
      a: "After the first visit, yes. The page and the passes are all in the browser's cache, so the whole editor works with the network off. Only the background remover has anything to fetch, and only once.",
    },
    {
      q: "Which formats can it open and save?",
      a: "Anything your browser can decode, which in practice means JPEG, PNG, WebP, AVIF and GIF. It exports to PNG, JPEG or WebP. JPEG has no transparency, so a cut-out saved as JPEG lands on white.",
    },
    {
      q: "Can I undo something I did not mean to?",
      a: "Yes. Every edit you apply is a step you can walk back. Moving a slider only previews, so the photo you opened is untouched until you press the button.",
    },
    {
      q: "Why is there no sign-in?",
      a: "An account would mean a server, and a server would mean somewhere for your photos to be. What you give up is history between visits, which is the trade every local-first tool makes.",
    },
  ];
</script>

<section class="section faq" id="faq">
  <div class="wrap split">
    <header class="head">
      <h2 class="h2" use:reveal>Questions worth asking first</h2>
      <p class="body" use:reveal={{ delay: 70 }}>
        The short answers, with nothing rounded off. If one is still unclear, the source is in the
        footer and it is readable.
      </p>
    </header>

    <div class="list" use:reveal={{ delay: 100 }}>
      {#each QUESTIONS as item (item.q)}
        <details class="entry">
          <summary>
            <span class="q">{item.q}</span>
            <span class="sign" aria-hidden="true"></span>
          </summary>
          <p class="a">{item.a}</p>
        </details>
      {/each}
    </div>
  </div>
</section>

<style>
  /*
   * The questions and the closing band are one surface.
   *
   * There was a hairline between them and both had their own background, which
   * put two borders and two tints within a few hundred pixels of each other and
   * made a page that is otherwise continuous read as three stacked panels.
   *
   * So the hairline is gone and the tint is ramped instead. The two sections
   * meet at exactly the same alpha, `--seam-tint`, which is why the value is a
   * custom property rather than two literals that happen to look alike: the
   * questions ramp up to it, the band below starts at it. Write the two alphas
   * out by hand and they drift the first time either is edited.
   */
  .faq {
    border-top: 1px solid var(--line-1);
    background: linear-gradient(180deg, transparent 0%, rgba(110, 231, 168, var(--seam-tint)) 100%);
  }

  .split {
    display: grid;
    grid-template-columns: 4fr 7fr;
    gap: clamp(2.5rem, 1rem + 4vw, 5rem);
    align-items: start;
  }

  .head {
    display: grid;
    gap: var(--s-5);
    justify-items: start;
    /* Sticky so the heading stays put while a long list of answers is read,
       and released below the width where the two columns stack. */
    position: sticky;
    top: 96px;
  }

  .list {
    display: grid;
  }

  .entry {
    border-bottom: 1px solid var(--line-1);
  }

  .entry:first-child {
    border-top: 1px solid var(--line-1);
  }

  summary {
    display: flex;
    align-items: flex-start;
    gap: var(--s-5);
    padding: var(--s-6) 0;
    cursor: pointer;
    list-style: none;
    border-radius: var(--r-xs);
  }

  /* The default disclosure triangle, replaced with a plus that becomes a
     minus. `summary` is not a button, so it gets no UA focus ring; the shared
     `:focus-visible` treatment in base.css supplies one. */
  summary::-webkit-details-marker {
    display: none;
  }

  .q {
    flex: 1;
    font-size: 1.0625rem;
    font-weight: 500;
    letter-spacing: -0.016em;
    line-height: 1.35;
    color: var(--text-1);
    transition: color var(--dur-1) var(--ease);
  }

  summary:hover .q {
    color: var(--accent);
  }

  .sign {
    position: relative;
    flex: none;
    width: 14px;
    height: 14px;
    margin-top: 4px;
  }

  .sign::before,
  .sign::after {
    content: "";
    position: absolute;
    inset: 50% 0 auto 0;
    height: 1.5px;
    border-radius: 1px;
    background: var(--text-3);
    transition: transform var(--dur-2) var(--ease-out);
  }

  .sign::after {
    transform: rotate(90deg);
  }

  .entry[open] .sign::after {
    transform: rotate(0deg);
  }

  .a {
    margin: 0;
    /* Collapses the gap between the last line of the question and the answer
       when the entry is closed, which `details` does not do for you. */
    padding: 0 0 var(--s-6);
    padding-right: var(--s-7);
    font-size: var(--t-sm);
    line-height: 1.65;
    color: var(--text-2);
    max-width: 62ch;
  }

  @media (max-width: 900px) {
    .split {
      grid-template-columns: 1fr;
    }

    .head {
      position: static;
    }
  }
</style>
