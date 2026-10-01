<script>
  /** Labelled select for the short, named-option lists (model choice, etc.). */
  let {
    id,
    label,
    value,
    onvalue = () => {},
    options = [],
    disabled = false,
    hint = "",
  } = $props();
</script>

<div class="field">
  <label class="name" for={id}>{label}</label>

  <div class="wrap">
    <select
      {id}
      {disabled}
      {value}
      onchange={(event) => onvalue(event.currentTarget.value)}
    >
      {#each options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>

  {#if hint}<p class="hint">{hint}</p>{/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .name {
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-2);
  }

  .wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  select {
    appearance: none;
    width: 100%;
    height: var(--control-h);
    padding: 0 calc(var(--s-7) + var(--s-1)) 0 var(--s-3);
    background: linear-gradient(180deg, var(--surface-1), var(--surface-2));
    border: 1px solid var(--line-2);
    border-radius: var(--r-md);
    font-size: var(--t-md);
    color: var(--text-1);
    cursor: pointer;
    box-shadow: var(--sink-1);
    transition:
      border-color var(--dur-1) var(--ease),
      background var(--dur-1) var(--ease),
      box-shadow var(--dur-1) var(--ease);
  }

  select:hover:not(:disabled) {
    border-color: var(--line-3);
  }

  select:focus-visible {
    border-color: var(--accent-line);
    background: linear-gradient(180deg, var(--surface-0), var(--surface-1));
    box-shadow: var(--press), 0 0 0 3px var(--accent-dim);
    outline: none;
  }

  /* Chevron drawn as a border, so it inherits the text colour. */
  .wrap::after {
    content: "";
    position: absolute;
    right: var(--s-4);
    width: 7px;
    height: 7px;
    border-right: 1.5px solid var(--text-3);
    border-bottom: 1.5px solid var(--text-3);
    transform: translateY(-2px) rotate(45deg);
    pointer-events: none;
  }

  select option {
    background: var(--surface-2);
    color: var(--text-1);
  }

  .hint {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.35;
    color: var(--text-3);
  }
</style>
