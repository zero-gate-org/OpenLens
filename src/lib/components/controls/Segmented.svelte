<script>
  /**
   * Radio group rendered as a segmented control.
   *
   * Fully controlled: the parent holds the selection. Uses real
   * `<input type="radio">` under the hood, so arrow-key traversal, form
   * association and screen-reader semantics all come for free instead of being
   * re-implemented on divs.
   */
  let {
    name,
    label = "",
    options = [],
    value,
    onvalue = () => {},
    disabled = false,
    columns = 0,
  } = $props();

  function pick(next) {
    if (disabled || next === value) return;
    onvalue(next);
  }
</script>

<fieldset class="group" class:has-label={!!label} {disabled}>
  {#if label}<legend class="micro-label">{label}</legend>{/if}

  <div class="track" style:grid-template-columns={columns ? `repeat(${columns}, 1fr)` : undefined}>
    {#each options as option (option.value)}
      <label class="opt" class:on={option.value === value} data-option={option.value}>
        <input
          type="radio"
          {name}
          value={option.value}
          checked={option.value === value}
          onchange={() => pick(option.value)}
        />
        <span class="text">{option.label}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    margin-bottom: var(--s-2);
  }

  .track {
    display: flex;
    gap: 2px;
    padding: 2px;
    /* The track is a well; each option is a key sitting in it. */
    background: linear-gradient(180deg, var(--surface-1), var(--surface-2));
    border: 1px solid var(--line-2);
    border-radius: var(--r-md);
    box-shadow: var(--sink-1);
  }

  .opt {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    display: grid;
    place-items: center;
    height: 26px;
    border-radius: 6px;
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--text-2);
    cursor: pointer;
    user-select: none;
    transition:
      background var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease);
  }

  .opt:hover:not(.on) {
    color: var(--text-1);
    background: var(--surface-3);
    box-shadow: var(--raise-1);
  }

  /* The selected key is pressed down into the track. */
  .opt.on {
    background: linear-gradient(180deg, var(--surface-4), var(--surface-3));
    color: var(--text-1);
    box-shadow:
      inset 0 1px 3px rgba(2, 6, 8, 0.55),
      inset 0 -1px 0 rgba(255, 255, 255, 0.06),
      0 1px 0 rgba(255, 255, 255, 0.05);
  }

  .opt:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-inline: 2px;
  }

  .group:disabled {
    opacity: 0.45;
  }
</style>
