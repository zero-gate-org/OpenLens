<script>
  /**
   * Three privacy facts, as a band.
   *
   * Not a testimonial and not a claim strip. Each cell says one thing that is
   * structurally true of the architecture, which is the only kind of privacy
   * claim worth making and the only one that survives somebody opening devtools.
   */
  import DeviceMobileIcon from "phosphor-svelte/lib/DeviceMobile";
  import UserCircleIcon from "phosphor-svelte/lib/UserCircle";
  import CloudSlashIcon from "phosphor-svelte/lib/CloudSlash";

  const FACTS = [
    {
      icon: CloudSlashIcon,
      title: "No upload",
      body: "Your photo never leaves your device. Open your browser's network panel and watch the request list stay empty while you work.",
    },
    {
      icon: UserCircleIcon,
      title: "No account",
      body: "Nothing to sign up for. No email, no password, no profile, nothing that can leak or be sold.",
    },
    {
      icon: DeviceMobileIcon,
      title: "No install",
      body: "It is a web page you open in a tab. No app store, no extension, nothing to install and nothing to keep updated.",
    },
  ];
</script>

<section class="band" aria-label="How OpenLens handles your files">
  <div class="wrap">
    <ul class="grid">
      {#each FACTS as fact (fact.title)}
        {@const Icon = fact.icon}
        <li class="cell">
          <Icon size={22} weight="light" class="glyph" />
          <h2 class="title">{fact.title}</h2>
          <p class="body">{fact.body}</p>
        </li>
      {/each}
    </ul>
  </div>
</section>

<style>
  .band {
    padding-block: var(--sp-section) var(--sp-tight);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--line-1);
  }

  .cell {
    display: grid;
    gap: var(--s-3);
    align-content: start;
    padding: var(--s-7) var(--s-7) var(--s-7) 0;
  }

  /* One divider between cells rather than a card around each one. Three boxes
     with three borders is a pricing table; three columns separated by two
     hairlines is a statement. */
  .cell + .cell {
    padding-left: var(--s-7);
    border-left: 1px solid var(--line-1);
  }

  /* `:global` because the class lands on an icon component's root <svg>,
     which the compiler cannot see from here. */
  :global(.glyph) {
    color: var(--accent);
  }

  .title {
    margin: 0;
    font-size: 1.0625rem;
    font-weight: 600;
    letter-spacing: -0.018em;
    color: var(--text-1);
  }

  .body {
    margin: 0;
    font-size: var(--t-sm);
    line-height: 1.6;
    color: var(--text-2);
    max-width: 34ch;
  }

  @media (max-width: 860px) {
    .grid {
      grid-template-columns: 1fr;
    }

    .cell {
      padding: var(--s-6) 0;
    }

    .cell + .cell {
      padding-left: 0;
      border-left: 0;
      border-top: 1px solid var(--line-1);
    }
  }
</style>
