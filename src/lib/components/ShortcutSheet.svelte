<script>
  /**
   * Keyboard reference, on `?`.
   *
   * A modal so focus is contained, Escape closes, and focus returns to
   * whatever opened it.
   */
  import { TOOLS } from "../registry.js";

  let { open = $bindable(false) } = $props();

  let dialog = $state(null);
  let restoreTo = null;

  $effect(() => {
    if (!open) return;
    restoreTo = document.activeElement;
    queueMicrotask(() => dialog?.focus());
    return () => restoreTo?.focus?.();
  });

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      open = false;
    }
  }

  // Derived, not hardcoded: the tool count changes as tools land.
  const toolKeys = `${TOOLS[0].shortcut} to ${TOOLS[TOOLS.length - 1].shortcut}`;

  const general = [
    ["?", "This list"],
    [toolKeys, "Jump to a tool"],
    ["[ / ]", "Previous / next tool"],
    ["Ctrl Z", "Undo"],
    ["Ctrl Shift Z", "Redo"],
    ["Ctrl R", "Back to the original"],
    ["Ctrl S", "Download"],
    ["Ctrl 0", "Fit to window"],
    ["Ctrl 1", "Actual pixels"],
    ["Ctrl +/–", "Zoom in / out"],
    ["Ctrl D", "Open a different image"],
  ];

  const cropKeys = [
    ["Drag handles", "Resize the selection"],
    ["Drag inside", "Move the selection"],
    ["Arrows", "Nudge by 1 px"],
    ["Shift Arrows", "Nudge by 10 px"],
    ["Space (hold)", "Preview the crop"],
  ];
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="scrim" onclick={() => (open = false)} onkeydown={onKeydown}>
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabindex="-1"
      bind:this={dialog}
      onclick={(event) => event.stopPropagation()}
      onkeydown={onKeydown}
    >
      <header class="head">
        <h2>Keyboard shortcuts</h2>
        <button type="button" class="close" onclick={() => (open = false)}>Close</button>
      </header>

      <div class="cols">
        <section class="group">
          <h3>Anywhere</h3>
          <dl>
            {#each general as [keys, what] (what)}
              <div class="row">
                <dt>{keys}</dt>
                <dd>{what}</dd>
              </div>
            {/each}
          </dl>
        </section>

        <section class="group">
          <h3>On the stage</h3>
          <dl>
            {#each cropKeys as [keys, what] (what)}
              <div class="row">
                <dt>{keys}</dt>
                <dd>{what}</dd>
              </div>
            {/each}
          </dl>
        </section>

        <section class="group">
          <h3>Tools</h3>
          <dl>
            {#each TOOLS as tool (tool.id)}
              <div class="row">
                <dt>{tool.shortcut}</dt>
                <dd>{tool.label}</dd>
              </div>
            {/each}
          </dl>
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
    display: grid;
    place-items: center;
    padding: var(--s-6);
    background: rgba(6, 10, 12, 0.72);
    backdrop-filter: blur(6px);
  }

  .sheet {
    width: min(720px, 100%);
    max-height: min(640px, 100%);
    overflow-y: auto;
    padding: var(--s-6);
    background: var(--surface-1);
    border: 1px solid var(--line-2);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-3);
  }

  .sheet:focus {
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
    padding-bottom: var(--s-5);
    margin-bottom: var(--s-5);
    border-bottom: 1px solid var(--line-1);
  }

  h2 {
    font-size: var(--t-xl);
    font-weight: 700;
    letter-spacing: -0.025em;
  }

  .close {
    height: 28px;
    padding: 0 var(--s-3);
    border-radius: var(--r-md);
    border: 1px solid var(--line-2);
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--text-2);
  }

  .close:hover {
    background: var(--surface-2);
    color: var(--text-1);
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--s-7);
  }

  .group h3 {
    font-size: var(--t-micro);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-3);
    margin-bottom: var(--s-3);
  }

  dl {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0;
  }

  .row {
    display: grid;
    grid-template-columns: 96px 1fr;
    gap: var(--s-3);
    align-items: baseline;
  }

  dt {
    font-size: var(--t-xs);
    font-weight: 650;
    color: var(--text-1);
    font-variant-numeric: tabular-nums;
  }

  dd {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--text-2);
  }

  @media (max-width: 560px) {
    .row {
      grid-template-columns: 84px 1fr;
    }
  }
</style>
