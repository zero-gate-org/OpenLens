<script>
  /**
   * Blocking progress layer for work that takes more than a frame.
   *
   * Determinate when a tool reports a ratio (background removal streams
   * model-download progress), indeterminate shimmer otherwise, so the bar
   * never lies about how far along something is.
   */
  import { editor } from "../state/editor.svelte.js";

  const ratio = $derived(editor.progress?.ratio ?? null);
  const message = $derived(editor.progress?.message ?? editor.notice?.message ?? "Working");
  const percent = $derived(ratio === null ? null : Math.round(ratio * 100));
</script>

{#if editor.busy}
  <div class="scrim" role="status" aria-live="assertive">
    <div class="card">
      <div class="head">
        <span class="label">{message}</span>
        {#if percent !== null}<span class="pct numeric">{percent}%</span>{/if}
      </div>

      <div class="track" class:indeterminate={percent === null}>
        <div
          class="fill"
          style:width={percent === null ? undefined : "{percent}%"}
        ></div>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: absolute;
    inset: 0;
    z-index: var(--z-stage-ui);
    display: grid;
    place-items: center;
    background: rgba(7, 11, 13, 0.62);
    backdrop-filter: blur(3px);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    width: min(320px, calc(100% - 48px));
    padding: var(--s-5);
    background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
    border: 1px solid var(--line-3);
    border-radius: var(--r-lg);
    box-shadow: var(--raise-3);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-4);
  }

  .label {
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--text-1);
  }

  .pct {
    font-size: var(--t-xs);
    font-weight: 650;
    color: var(--accent);
  }

  .track {
    height: 5px;
    border-radius: var(--r-pill);
    background: var(--surface-1);
    box-shadow: inset 0 1px 2px rgba(2, 6, 8, 0.7);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: var(--r-pill);
    background: var(--accent);
    transition: width var(--dur-2) var(--ease);
  }

  .indeterminate .fill {
    width: 34%;
    animation: sweep 1.15s var(--ease) infinite;
  }

  @keyframes sweep {
    from {
      transform: translateX(-110%);
    }
    to {
      transform: translateX(360%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .indeterminate .fill {
      /* Motion off: show a steady partial bar rather than looping. */
      width: 100%;
      opacity: 0.5;
      animation: none;
    }
  }
</style>
