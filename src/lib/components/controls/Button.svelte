<script>
  /**
   * One button, four intents. The accent fill is the only saturated surface
   * in the app, so exactly one thing per panel should ever use `primary`.
   */
  let {
    variant = "secondary",
    size = "md",
    full = false,
    disabled = false,
    type = /** @type {"button" | "submit" | "reset"} */ ("button"),
    title = undefined,
    pressed = undefined,
    onclick = undefined,
    icon = undefined,
    children = undefined,
    // Anything else lands on the element: data-*, aria-*, form attrs. This is
    // what lets callers and tests hang stable hooks off a button without this
    // component having to know about each one.
    ...rest
  } = $props();

  /**
   * Icon-only sizing is driven by "there is an icon and no label", not by
   * "there is no label".
   *
   * The difference matters when a caller forgets to pass either. Asking for
   * "no children" treated a missing label as a request for a square button,
   * which renders an empty coloured pill: broken, but small enough to look
   * deliberate. Keying off `icon` instead means a label-less, icon-less button
   * renders at full width with its padding, so the mistake is obvious.
   */
  const square = $derived(!!icon && !children);

  // An effect rather than a bare `if`, so the props are read reactively
  // instead of being captured once at init.
  $effect(() => {
    if (import.meta.env?.DEV && !icon && !children) {
      console.warn(
        "<Button> was rendered with neither an icon snippet nor any children. " +
          "Pass text as the component content, or an `{#snippet icon()}`.",
      );
    }
  });
</script>

<button
  {type}
  {title}
  {disabled}
  {onclick}
  {...rest}
  class="btn {variant} {size}"
  class:full
  class:icon-only={square}
  aria-pressed={pressed}
>
  {#if icon}<span class="ico" aria-hidden="true">{@render icon()}</span>{/if}
  {#if children}<span class="label">{@render children()}</span>{/if}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    height: var(--control-h);
    padding: 0 var(--s-4);
    border-radius: var(--r-md);
    border: 1px solid transparent;
    font-size: var(--t-sm);
    font-weight: 550;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    transition:
      background var(--dur-1) var(--ease),
      border-color var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease),
      transform var(--dur-1) var(--ease);
  }

  /* Labels never wrap: a two-line button reads as a layout bug. */
  .label {
    white-space: nowrap;
  }

  .icon-only {
    padding: 0;
    width: var(--control-h);
  }

  .ico {
    display: grid;
    place-items: center;
    flex: none;
  }

  .btn:active:not(:disabled) {
    transform: translateY(1px);
  }

  .btn:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  .sm {
    height: 28px;
    padding: 0 var(--s-3);
    font-size: var(--t-xs);
  }

  .sm.icon-only {
    width: 28px;
    padding: 0;
  }

  .lg {
    height: 38px;
    padding: 0 var(--s-5);
    font-size: var(--t-md);
  }

  .full {
    width: 100%;
  }

  /* --- Intents ------------------------------------------------ */

  .primary {
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 650;
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-strong);
  }

  .secondary {
    background: var(--surface-2);
    border-color: var(--line-2);
    color: var(--text-1);
  }

  .secondary:hover:not(:disabled) {
    background: var(--surface-3);
    border-color: var(--line-3);
  }

  .ghost {
    background: transparent;
    border-color: var(--line-2);
    color: var(--text-2);
  }

  .ghost:hover:not(:disabled) {
    color: var(--text-1);
    border-color: var(--line-3);
    background: var(--surface-2);
  }

  .quiet {
    background: transparent;
    color: var(--text-2);
  }

  .quiet:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text-1);
  }

  .danger {
    background: transparent;
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    color: var(--danger);
  }

  .danger:hover:not(:disabled) {
    background: var(--danger-dim);
  }
</style>
