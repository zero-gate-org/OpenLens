<script>
  /**
   * Labelled range plus a live readout.
   *
   * The readout is part of the label row rather than floating beside the
   * track, so the value is anchored to the control it describes.
   */
  let {
    id,
    label,
    value,
    onvalue = () => {},
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    display = undefined,
    ticks = [],
  } = $props();

  const shown = $derived(display ?? String(Math.round(value * 100) / 100));
  const fill = $derived(max === min ? 0 : ((value - min) / (max - min)) * 100);
</script>

<div class="field" class:disabled>
  <div class="head">
    <label class="name" for={id}>{label}</label>
    <output class="value numeric" for={id}>{shown}</output>
  </div>

  <div class="wrap">
    <input
      {id}
      type="range"
      {min}
      {max}
      {step}
      {disabled}
      {value}
      style:--fill="{fill}%"
      oninput={(event) => onvalue(Number(event.currentTarget.value))}
    />
  </div>

  {#if ticks.length}
    <div class="ticks" aria-hidden="true">
      {#each ticks as tick (tick)}
        <span>{tick}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .field.disabled {
    opacity: 0.5;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
  }

  .name {
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-2);
  }

  .value {
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--text-1);
  }

  .wrap {
    display: flex;
    align-items: center;
    height: 18px;
  }

  input[type="range"] {
    appearance: none;
    width: 100%;
    height: 3px;
    border-radius: var(--r-pill);
    /* Track is drawn as a gradient so the filled portion needs no extra node. */
    background: linear-gradient(
      to right,
      var(--accent) 0 var(--fill),
      var(--surface-4) var(--fill) 100%
    );
    cursor: pointer;
  }

  input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--text-1);
    border: 1px solid rgba(0, 0, 0, 0.35);
    box-shadow: var(--shadow-1);
    transition: transform var(--dur-1) var(--ease);
  }

  input[type="range"]::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border: 1px solid rgba(0, 0, 0, 0.35);
    border-radius: 50%;
    background: var(--text-1);
    box-shadow: var(--shadow-1);
  }

  input[type="range"]:hover::-webkit-slider-thumb,
  input[type="range"]:active::-webkit-slider-thumb {
    transform: scale(1.15);
  }

  input[type="range"]:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: var(--r-pill);
  }

  .ticks {
    display: flex;
    justify-content: space-between;
    font-size: var(--t-micro);
    color: var(--text-3);
  }
</style>
