<script>
  /** Checkbox with the label on the left, so the row reads as one sentence. */
  let { id, label, checked = $bindable(false), disabled = false, hint = "" } = $props();
</script>

<div class="row" class:disabled>
  <label class="check" for={id}>
    <input {id} type="checkbox" {disabled} bind:checked />
    <span class="box" aria-hidden="true">
      <svg viewBox="0 0 12 12" width="10" height="10">
        <path d="M2.5 6.2 4.8 8.5 9.5 3.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
    <span class="name">{label}</span>
  </label>

  {#if hint}<p class="hint">{hint}</p>{/if}
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .row.disabled {
    opacity: 0.5;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 24px;
    cursor: pointer;
  }

  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }

  .box {
    display: grid;
    place-items: center;
    flex: none;
    width: 16px;
    height: 16px;
    border: 1px solid var(--line-3);
    border-radius: var(--r-xs);
    background: var(--surface-2);
    color: transparent;
    transition:
      background var(--dur-1) var(--ease),
      border-color var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease);
  }

  .check:hover .box {
    border-color: var(--accent-line);
  }

  .check:has(input:checked) .box {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }

  .check:has(input:focus-visible) .box {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .name {
    font-size: var(--t-sm);
    color: var(--text-2);
    user-select: none;
  }

  .check:has(input:checked) .name {
    color: var(--text-1);
  }

  .hint {
    margin: 0;
    padding-left: 24px;
    font-size: var(--t-xs);
    line-height: 1.35;
    color: var(--text-3);
  }
</style>
