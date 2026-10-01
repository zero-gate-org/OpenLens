<script>
  /**
   * Site header: a floating tab.
   *
   * A detached island rather than a full-width bar. It sits below the top edge
   * with the page's gutter on both sides, so the hero is visible above and beside
   * it rather than starting underneath. It is fixed rather than sticky, which
   * means it takes no vertical space in the flow, so the hero's top padding is
   * what keeps the headline clear of it.
   *
   * One line at every desktop width, which is the whole design brief for a nav
   * bar. The links drop out in priority order as the width comes down rather
   * than wrapping into a second row, and the primary action never drops.
   *
   * The corner radius is `--r-md`, the same 8px as every button on the page.
   * A floating tab in a pill shape would be a second radius system, and a pill
   * around a rectangle of content reads as a floating control rather than as
   * navigation.
   *
   * The mark is the real app icon, not a redrawn glyph. It is the one asset the
   * brand actually has, and a hand-approximated lens would drift from it the
   * first time the icon changed.
   */
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRight";
  import ListIcon from "phosphor-svelte/lib/List";
  import XIcon from "phosphor-svelte/lib/X";

  import { MARK } from "../lib/photos.js";

  /*
   * "FAQ" rather than "Questions".
   *
   * A nav item is a place, and "Questions" is a subject. Nobody has ever
   * scrolled down a page hoping to find some questions; people look for the
   * label their own browser has taught them. It is also two words shorter,
   * which is one of the four links the tab has to hold on one line.
   */
  const LINKS = [
    { href: "#tools", label: "Tools" },
    { href: "#filters", label: "Filters" },
    { href: "#text", label: "Text" },
    { href: "#faq", label: "FAQ" },
  ];

  let open = $state(false);
  let scrolled = $state(false);

  // A scroll listener here is deliberate and is the one place the page uses
  // one. It only toggles a boolean that swaps a border and a shadow on a 56px
  // tab, it reads no layout, and it writes no style: the tab's paint is one
  // composited layer change. A passive listener that sets state and an observer
  // differ only in cost at this scale, and here the tab is already in view from
  // the first paint, so an observer would have nothing to observe that is not
  // already known.
  $effect(() => {
    const onScroll = () => {
      scrolled = window.scrollY > 8;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  });

  // A menu left open after a jump to a section would sit over the section the
  // visitor just asked for.
  function follow() {
    open = false;
  }

  // Escape closes it, as it would for any disclosure.
  function onKeydown(event) {
    if (event.key === "Escape" && open) open = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<header class="bar" class:bar--pinned={scrolled}>
  <div class="inner">
    <a class="identity" href="./index.html" aria-label="OpenLens home">
      <picture>
        <source srcset={MARK.webp} type="image/webp" />
        <img src={MARK.png} alt="" width="28" height="28" />
      </picture>
      <span class="wordmark">OpenLens</span>
    </a>

    <nav class="links" aria-label="Sections">
      {#each LINKS as link (link.href)}
        <a href={link.href}>{link.label}</a>
      {/each}
    </nav>

    <div class="tail">
      <a class="btn btn--primary btn--sm" href="./editor.html">
        Open the editor
        <ArrowRightIcon size={15} weight="bold" />
      </a>

      <button
        class="toggle"
        type="button"
        aria-expanded={open}
        aria-controls="site-menu"
        onclick={() => (open = !open)}
      >
        {#if open}
          <XIcon size={20} />
        {:else}
          <ListIcon size={20} />
        {/if}
        <span class="visually-hidden">{open ? "Close menu" : "Open menu"}</span>
      </button>
    </div>
  </div>

  {#if open}
    <nav class="sheet" id="site-menu" aria-label="Sections">
      {#each LINKS as link (link.href)}
        <a href={link.href} onclick={follow}>{link.label}</a>
      {/each}
    </nav>
  {/if}
</header>

<style>
  .bar {
    position: fixed;
    top: var(--s-4);
    inset-inline: var(--gutter);
    z-index: var(--z-nav);
    /* The page's gutter on both sides, capped at the content width and centred,
       so the tab lines up with the hero's own edges instead of floating in the
       middle of a wide screen. */
    max-width: calc(var(--wrap) - var(--gutter) * 2);
    margin-inline: auto;

    border-radius: var(--r-md);
    border: 1px solid var(--line-2);
    background: color-mix(in srgb, var(--surface-1) 72%, transparent);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    /* The same depth language as the rest of the page: light on the top edge,
       shade beneath. */
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.07),
      0 1px 2px rgba(2, 6, 8, 0.4),
      0 12px 32px -16px rgba(2, 6, 8, 0.7);

    transition:
      background var(--dur-2) var(--ease),
      border-color var(--dur-2) var(--ease),
      box-shadow var(--dur-2) var(--ease);
  }

  /* At the top of the page there is nothing behind the tab, so it stays quiet.
     Once content scrolls under it, the fill and the shadow earn their place. */
  .bar--pinned {
    background: color-mix(in srgb, var(--surface-1) 88%, transparent);
    border-color: var(--line-3);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 1px 2px rgba(2, 6, 8, 0.45),
      0 16px 40px -18px rgba(2, 6, 8, 0.8);
  }

  /* A solid fill for anyone who has asked the OS for less transparency. The
     blur is unsupported in too few places to rely on alone, so the readable
     state is the opaque one. */
  @media (prefers-reduced-transparency: reduce) {
    .bar,
    .bar--pinned {
      background: var(--surface-1);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }

  .inner {
    display: flex;
    align-items: center;
    gap: var(--s-6);
    height: 56px;
    padding-inline: var(--s-3);
  }

  .identity {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    flex: none;
    text-decoration: none;
    color: var(--text-1);
    border-radius: var(--r-sm);
  }

  .identity img {
    /* The icon is a full-bleed square with a coloured field, so it wants the
       same radius as the button beside it. */
    border-radius: var(--r-sm);
    width: 28px;
    height: 28px;
  }

  .wordmark {
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .links {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-inline: auto;
  }

  .links a {
    padding: var(--s-2) var(--s-4);
    border-radius: var(--r-sm);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-2);
    text-decoration: none;
    transition:
      color var(--dur-1) var(--ease),
      background var(--dur-1) var(--ease);
  }

  .links a:hover {
    color: var(--text-1);
    background: var(--surface-3);
  }

  .tail {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex: none;
  }

  .btn--sm {
    height: 36px;
    padding-inline: var(--s-4);
    font-size: 0.8125rem;
  }

  .toggle {
    display: none;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--r-sm);
    color: var(--text-1);
  }

  .toggle:hover {
    background: var(--surface-3);
  }

  /*
   * The menu drops out of the bottom of the tab and is navigation only.
   *
   * It used to carry its own copy of "Open the editor" as well, which put the
   * page's single primary action on screen twice within 300px of a phone
   * viewport: once in the tab and again as the sheet's last row. The tab's
   * button stays visible above the panel, so the sheet lists the four sections
   * and nothing else.
   *
   * Opaque, not translucent: it sits over the hero photograph, and a blurred
   * panel would let the image read through the labels.
   */
  .sheet {
    display: grid;
    margin: var(--s-2) var(--s-2) var(--s-2);
    padding: var(--s-2);
    border-radius: var(--r-sm);
    background: var(--surface-0);
    border: 1px solid var(--line-2);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 18px 40px -18px rgba(2, 6, 8, 0.9);
  }

  .sheet a {
    padding: var(--s-4) var(--s-3);
    border-radius: var(--r-xs);
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-1);
    text-decoration: none;
  }

  .sheet a:hover {
    background: var(--surface-2);
  }

  /* Below this the four links and the button cannot share a line at a
     comfortable measure, so the links move into the sheet rather than
     compressing into abbreviations. */
  @media (max-width: 860px) {
    .links {
      display: none;
    }

    .inner {
      justify-content: space-between;
    }

    .tail {
      margin-inline-start: auto;
    }

    .toggle {
      display: grid;
    }
  }

  /* The wordmark goes before the button does: the button is the reason the tab
     exists, and the name is already in the title and the mark beside it. */
  @media (max-width: 460px) {
    .wordmark {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
    }

    .links a,
    .toggle {
      transition: none;
    }
  }
</style>
