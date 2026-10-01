<script>
  /**
   * Sticky failure notice.
   *
   * Errors live here rather than as a toast: a failed background removal
   * needs an explanation the operator can read and act on, and a message
   * that vanishes on a timer is worse than useless.
   */
  import { editor } from "../state/editor.svelte.js";
  import WarningIcon from "phosphor-svelte/lib/Warning";
  import XIcon from "phosphor-svelte/lib/X";
</script>

{#if editor.error}
  <div class="banner" role="alert">
    <span class="mark">
      <WarningIcon size={16} weight="fill" />
    </span>
    <p class="text">{editor.error}</p>
    <button
      type="button"
      class="close"
      aria-label="Dismiss"
      onclick={() => editor.dismissError()}
    >
      <XIcon size={14} weight="bold" />
    </button>
  </div>
{/if}

<style>
  .banner {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: start;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-3) var(--s-3) var(--s-4);
    background: var(--danger-dim);
    border: 1px solid color-mix(in srgb, var(--danger) 38%, transparent);
    border-radius: var(--r-md);
  }

  .mark {
    color: var(--danger);
    margin-top: 1px;
  }

  .text {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.45;
    color: #ffdcd9;
    /* Long model-download errors must wrap, not clip. */
    overflow-wrap: anywhere;
  }

  .close {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-sm);
    color: #ffdcd9;
    opacity: 0.7;
    transition: opacity var(--dur-1) var(--ease);
  }

  .close:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.08);
  }
</style>
