<script>
  /**
   * Host for the active tool's controls.
   *
   * Renders a single instance at a time. Panels are stateful (a half-typed
   * dimension, a pending angle), so keeping only the active one mounted means
   * switching away and back cannot leave a stale value behind.
   */
  import { editor } from "../state/editor.svelte.js";
  import { toolById } from "../registry.js";
  import ErrorBanner from "./ErrorBanner.svelte";

  const tool = $derived(toolById(editor.tool));
  const Panel = $derived(tool.component);
</script>

<aside class="panel" aria-label="{tool.label} settings">
  <header class="head">
    <h2>{tool.label}</h2>
    <p class="hint">{tool.hint}</p>
  </header>

  <div
    class="body"
    role="tabpanel"
    id="tool-panel"
    aria-labelledby="tool-tab-{tool.id}"
    tabindex="-1"
  >
    <ErrorBanner />

    {#if editor.hasImage}
      <Panel />
    {:else}
      <p class="tool-note">Open an image to use this tool.</p>
    {/if}
  </div>
</aside>

<style>
  .panel {
    width: var(--panel-w);
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface-1);
    border-left: 1px solid var(--line-1);
    box-shadow: var(--pane-lip);
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--s-4) var(--s-5);
    border-bottom: 1px solid var(--line-1);
  }

  h2 {
    font-size: var(--t-lg);
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .hint {
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--text-3);
  }

  .body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: var(--s-5);
    gap: var(--s-4);
    overflow-y: auto;
  }

  .body:focus {
    outline: none;
  }

  /* --- Narrow: bottom sheet under the stage --------------------- */
  @media (max-width: 860px) {
    .panel {
      order: 3;
      width: 100%;
      max-height: 46dvh;
      border-left: 0;
      border-top: 1px solid var(--line-1);
    }

    .head {
      padding: var(--s-3) var(--s-5);
    }

    .body {
      padding: var(--s-4) var(--s-5) var(--s-6);
    }
  }
</style>
