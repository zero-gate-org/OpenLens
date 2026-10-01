<script>
  /**
   * Tool switcher.
   *
   * The old editor hid 25 tools in a native `<select>`, which meant every
   * switch cost a two-step open-then-scan gesture and there was nowhere to
   * show what a tool does. A rail gives one-click switching, room for
   * grouping as the tool count grows, and a hover card for the hint.
   *
   * Rendered as a vertical tablist so arrow keys move between tools for free.
   */
  import { editor } from "../state/editor.svelte.js";
  import { TOOLS, TOOL_GROUPS, stepTool, toolById } from "../registry.js";

  let tabs = $state(null);

  /** Tool whose card is showing, and the vertical centre to show it at. */
  let hovered = $state(null);
  let hoveredTop = $state(0);

  const groups = $derived(
    TOOL_GROUPS.map((group) => ({
      ...group,
      tools: TOOLS.filter((tool) => tool.group === group.id),
    })).filter((group) => group.tools.length > 0),
  );

  const active = $derived(toolById(editor.tool));

  function onKeydown(event) {
    const map = {
      ArrowDown: 1,
      ArrowRight: 1,
      ArrowUp: -1,
      ArrowLeft: -1,
    };
    if (event.key in map) {
      event.preventDefault();
      editor.setTool(stepTool(editor.tool, map[event.key]));
      focusActive();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      editor.setTool(event.key === "Home" ? TOOLS[0].id : TOOLS[TOOLS.length - 1].id);
      focusActive();
    }
  }

  function showCard(event, tool) {
    const button = event.currentTarget;
    const box = button.getBoundingClientRect();
    const host = tabs?.getBoundingClientRect();
    if (!host) return;
    hovered = tool;
    hoveredTop = box.top - host.top + box.height / 2;
  }

  function hideCard() {
    hovered = null;
  }

  function focusActive() {
    // Wait a tick so the newly selected tab exists in the DOM.
    queueMicrotask(() => {
      tabs?.querySelector('[aria-selected="true"]')?.focus();
    });
  }
</script>

<nav class="rail" aria-label="Tools">
  <div
    class="tabs"
    role="tablist"
    aria-orientation="vertical"
    tabindex="-1"
    onkeydown={onKeydown}
    bind:this={tabs}
  >
    {#each groups as group, gi (group.id)}
      {#if gi > 0}<span class="divider" role="presentation"></span>{/if}

      {#each group.tools as tool (tool.id)}
        {@const selected = tool.id === editor.tool}
        <button
          type="button"
          role="tab"
          id="tool-tab-{tool.id}"
          class="rail-btn"
          class:on={selected}
          aria-selected={selected}
          aria-controls="tool-panel"
          tabindex={selected ? 0 : -1}
          onclick={() => editor.setTool(tool.id)}
          onpointerenter={(event) => showCard(event, tool)}
          onpointerleave={hideCard}
          onfocus={(event) => showCard(event, tool)}
          onblur={hideCard}
        >
          <span class="glyph" aria-hidden="true">
            <tool.icon size={18} weight={selected ? "fill" : "regular"} />
          </span>
          <span class="visually-hidden">{tool.label}</span>
        </button>
      {/each}
    {/each}
  </div>

  <!--
    One card for the whole rail, not one per button.

    It has to live outside `.tabs`. That element scrolls vertically, and CSS
    forces a scrolling box to clip the other axis too, so `overflow-x: hidden`
    silently ate a card positioned to the right of the rail. This was why the
    tool name never appeared on hover. Rendering a single card as a sibling
    keeps it outside the clip and is one node instead of twenty-five.
  -->
  {#if hovered}
    <div class="card" role="tooltip" style:top="{hoveredTop}px">
      <span class="card-title">
        {hovered.label}
        <kbd>{hovered.shortcut}</kbd>
      </span>
      <span class="card-hint">{hovered.hint}</span>
    </div>
  {/if}

  <p class="sr-label" aria-live="polite">
    {active.label} selected
  </p>
</nav>

<style>
  .rail {
    position: relative;
    width: var(--rail-w);
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--surface-1);
    border-right: 1px solid var(--line-1);
    /* The rail is a well the toolbar buttons sit down inside. */
    box-shadow: inset -1px 0 2px rgba(2, 6, 8, 0.4);
    z-index: var(--z-rail);
  }

  .tabs {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-4) 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .divider {
    width: 26px;
    height: 1px;
    margin: var(--s-3) 0;
    background: var(--line-1);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04);
    flex: none;
  }

  /* A toolbar button. Flat at rest so the rail stays quiet, lifted on hover,
     and pressed into the rail when its tool is the active one. */
  .rail-btn {
    position: relative;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: var(--r-md);
    border: 1px solid transparent;
    color: var(--text-2);
    box-shadow: none;
    transition:
      background var(--dur-1) var(--ease),
      border-color var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease),
      box-shadow var(--dur-1) var(--ease),
      transform var(--dur-1) var(--ease);
  }

  .rail-btn:hover {
    background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
    border-color: var(--line-2);
    color: var(--text-1);
    box-shadow: var(--raise-2);
  }

  .rail-btn:active {
    transform: translateY(1px);
    box-shadow: var(--press);
  }

  /* Selected: the key is pushed down and the icon lights up. */
  .rail-btn.on {
    background: linear-gradient(180deg, var(--surface-1), var(--surface-2));
    border-color: var(--accent-line);
    color: var(--accent);
    box-shadow:
      inset 0 2px 4px rgba(2, 6, 8, 0.6),
      inset 0 -1px 0 rgba(255, 255, 255, 0.05),
      0 0 0 1px var(--accent-dim);
  }

  .rail-btn.on:hover {
    background: linear-gradient(180deg, var(--surface-1), var(--surface-2));
  }

  /* Active marker on the rail edge: readable at a glance, no extra chrome. */
  .rail-btn.on::before {
    content: "";
    position: absolute;
    left: -16px;
    top: 50%;
    translate: 0 -50%;
    width: 2px;
    height: 18px;
    border-radius: var(--r-pill);
    background: var(--accent);
  }

  .rail-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .glyph {
    display: grid;
    place-items: center;
  }

  /* --- Hover card ------------------------------------------- */
  /* Rendered on hover or focus, and lives outside the scroll container, so it
     animates in from nothing rather than fading. */
  .card {
    position: absolute;
    left: calc(100% + var(--s-3));
    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: max-content;
    max-width: 250px;
    padding: var(--s-3) var(--s-4);
    translate: 0 -50%;
    background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
    border: 1px solid var(--line-3);
    border-radius: var(--r-md);
    box-shadow: var(--raise-3);
    text-align: left;
    pointer-events: none;
    animation: card-in var(--dur-2) var(--ease);
  }

  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateX(-6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card {
      animation: none;
    }
  }

  .card-title {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-sm);
    font-weight: 650;
    color: var(--text-1);
  }

  .card-hint {
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--text-2);
    text-transform: none;
    letter-spacing: normal;
  }

  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    background: linear-gradient(180deg, var(--surface-2), var(--surface-1));
    border: 1px solid var(--line-2);
    border-radius: var(--r-xs);
    box-shadow: inset 0 1px 2px rgba(2, 6, 8, 0.5);
    font-family: var(--font-ui);
    font-size: var(--t-micro);
    font-weight: 600;
    color: var(--text-2);
  }

  .sr-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  /* --- Narrow: rail runs across the top of the stage ------------- */
  @media (max-width: 860px) {
    .rail {
      order: 1;
      width: 100%;
      height: 52px;
      flex: none;
      flex-direction: row;
      align-items: center;
      border-right: 0;
      border-bottom: 1px solid var(--line-1);
    }

    .tabs {
      flex-direction: row;
      padding: 0 var(--s-4);
      gap: var(--s-2);
      overflow-x: auto;
      overflow-y: hidden;
    }

    .divider {
      width: 1px;
      height: 22px;
      margin: 0 var(--s-2);
    }

    /* Active marker moves from the rail edge to under the icon. */
    .rail-btn.on::before {
      left: 50%;
      top: auto;
      bottom: -14px;
      translate: -50% 0;
      width: 18px;
      height: 2px;
    }

    /* Narrow: the rail runs along the top, so the card drops below it. */
    .card {
      left: 50%;
      translate: -50% 0;
    }

    @keyframes card-in {
      from {
        opacity: 0;
        transform: translateY(-6px);
      }
    }
  }
</style>
