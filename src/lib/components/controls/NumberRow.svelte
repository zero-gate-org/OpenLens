<script>
  /**
   * Width + height with an aspect lock.
   *
   * Fully controlled: the parent holds the numbers and the source ratio, so
   * the same control serves the crop tool (output pixels) and the resize tool
   * (target pixels) without duplicating the constraint maths.
   *
   * Omit `onlink` to render the lock as a static readout instead of a toggle,
   * which is what the crop tool wants since its ratio is driven by the ratio
   * control below the fields.
   */
  import NumberField from "./NumberField.svelte";
  import LinkIcon from "phosphor-svelte/lib/LinkSimple";
  import UnlinkIcon from "phosphor-svelte/lib/LinkSimpleBreak";

  let {
    idPrefix,
    width,
    height,
    ratio,
    linked = false,
    onlink = undefined,
    min = 1,
    max = 20000,
    disabled = false,
    widthMessage = "",
    heightMessage = "",
    onsize = () => {},
  } = $props();

  const clamp = (n) => Math.min(max, Math.max(min, Math.round(Number(n) || min)));

  function setWidth(next) {
    const w = clamp(next);
    onsize(w, linked && ratio > 0 ? clamp(w / ratio) : clamp(height));
  }

  function setHeight(next) {
    const h = clamp(next);
    onsize(linked && ratio > 0 ? clamp(h * ratio) : clamp(width), h);
  }

  function toggleLink() {
    onlink?.(!linked);
  }
</script>

<div class="pair">
  <div class="linkbar">
    {#if onlink}
      <button
        type="button"
        class="link"
        class:on={linked}
        {disabled}
        aria-pressed={linked}
        title={linked ? "Aspect ratio locked" : "Aspect ratio free"}
        onclick={toggleLink}
      >
        {#if linked}
          <LinkIcon size={13} weight="bold" />
        {:else}
          <UnlinkIcon size={13} weight="bold" />
        {/if}
        <span>{linked ? ratioLabel(ratio) : "Free"}</span>
      </button>
    {:else}
      <span class="link static" class:on={ratio > 0}>
        <LinkIcon size={13} weight="bold" />
        <span>{ratioLabel(ratio)}</span>
      </span>
    {/if}
  </div>

  <div class="fields">
    <NumberField
      id="{idPrefix}-width"
      label="Width"
      suffix="px"
      value={width}
      {min}
      {max}
      {disabled}
      message={widthMessage}
      onvalue={setWidth}
    />
    <NumberField
      id="{idPrefix}-height"
      label="Height"
      suffix="px"
      value={height}
      {min}
      {max}
      {disabled}
      message={heightMessage}
      onvalue={setHeight}
    />
  </div>
</div>

<script module>
  /**
   * "16:9"-style label for a ratio.
   *
   * Searches small integer pairs rather than reducing a scaled fraction:
   * 100/75 scaled by 1000 reduces to 1333:750, which tells the operator
   * nothing. A bounded search finds the 4:3 a person would actually say.
   */
  function ratioLabel(ratio) {
    if (!ratio || ratio <= 0 || !Number.isFinite(ratio)) return "Free";

    const flip = ratio < 1;
    const target = flip ? 1 / ratio : ratio;
    const LIMIT = 32;

    for (let q = 1; q <= LIMIT; q += 1) {
      const p = Math.round(target * q);
      if (p < 1 || p > LIMIT) continue;
      if (Math.abs(p / q - target) / target < 0.005) {
        return flip ? `${q}:${p}` : `${p}:${q}`;
      }
    }
    return target.toFixed(2);
  }
</script>

<style>
  .pair {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .linkbar {
    display: flex;
    justify-content: flex-end;
  }

  .link {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    height: 22px;
    padding: 0 var(--s-2);
    border-radius: var(--r-sm);
    font-size: var(--t-micro);
    font-weight: 650;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-3);
    transition:
      background var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease);
  }

  /* Small toolbar key, so it lifts on hover like the others. */
  .link:not(.static):hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text-2);
    box-shadow: var(--raise-1);
  }

  .link:not(.static):active:not(:disabled) {
    transform: translateY(1px);
    box-shadow: var(--press);
  }

  .link.on {
    color: var(--accent);
  }

  .link:not(.static).on {
    background: var(--accent-dim);
  }

  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-3);
  }
</style>
