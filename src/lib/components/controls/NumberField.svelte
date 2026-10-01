<script>
  /**
   * Controlled number input with draft/commit semantics.
   *
   * Deliberately not two-way bound: the parent owns the value, because values
   * here are frequently *derived* (a locked aspect ratio means typing a width
   * rewrites the height). A controlled component makes that explicit instead
   * of racing a `$bindable` write.
   *
   * The important subtlety is that a number field has three states, not two:
   * what the operator is currently typing, what the parent considers true, and
   * what the field shows on commit. Clamping on every keystroke corrupts
   * typing (entering "200" into a field with a minimum of 8 becomes "80",
   * because the "2" gets rewritten mid-word). So the field keeps a draft while
   * focused, reports every valid keystroke upward so live values update, and
   * snaps to the canonical number on commit.
   */
  let {
    id,
    label,
    value,
    onvalue = () => {},
    min = 1,
    max = 100000,
    step = 1,
    suffix = "",
    disabled = false,
    message = "",
    tone = "hint",
  } = $props();

  /** Text being typed. `null` means "show the parent's value". */
  let draft = $state(null);
  let focused = $state(false);
  let scrubbing = $state(null);

  const shown = $derived(draft ?? value);

  // A value arriving from outside (a new image, a ratio change) wins, unless
  // the operator is in the middle of typing into this very field.
  $effect(() => {
    void value;
    if (!focused && !scrubbing) draft = null;
  });

  const parse = (raw) => {
    if (String(raw).trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const clamp = (n) => Math.min(max, Math.max(min, n));

  function onInput(event) {
    draft = event.currentTarget.value;
    const n = parse(draft);
    // Report the number as typed. The parent clamps; the field keeps showing
    // the draft until commit so the caret does not jump mid-entry.
    if (n !== null) onvalue(clamp(n));
  }

  /** Snap the field to the canonical value. Fires on change, blur and Enter. */
  function onCommit(event) {
    focused = false;
    draft = null;
    const n = parse(event.currentTarget.value);
    onvalue(n === null ? min : clamp(n), { commit: true });
  }

  function onKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
      event.currentTarget.blur();
    }
  }

  function onScrubDown(event) {
    if (disabled || event.button !== 0) return;
    focused = false;
    draft = null;
    scrubbing = { startX: event.clientX, startValue: Number(value) || 0, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onScrubMove(event) {
    if (!scrubbing) return;
    const dx = event.clientX - scrubbing.startX;
    if (!scrubbing.moved && Math.abs(dx) < 3) return;
    scrubbing.moved = true;
    // Shift slows the scrub to single units.
    const unit = step * (event.shiftKey ? 1 : 4);
    const next = clamp(scrubbing.startValue + Math.round(dx / 3) * unit);
    onvalue(next);
  }

  function onScrubUp(event) {
    if (!scrubbing) return;
    const moved = scrubbing.moved;
    scrubbing = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (moved) onvalue(Number(value), { commit: true });
  }
</script>

<div class="field" class:alert={tone === "error"}>
  <label
    class="head"
    for={id}
    onpointerdown={onScrubDown}
    onpointermove={onScrubMove}
    onpointerup={onScrubUp}
    onpointercancel={onScrubUp}
  >
    <span class="name">{label}</span>
    {#if suffix}<span class="suffix">{suffix}</span>{/if}
  </label>

  <div class="control" class:scrubbing>
    <input
      {id}
      type="number"
      inputmode="numeric"
      {min}
      {max}
      {step}
      {disabled}
      value={shown}
      oninput={onInput}
      onchange={onCommit}
      onblur={onCommit}
      onfocus={() => (focused = true)}
      onkeydown={onKeydown}
    />
  </div>

  {#if message}<p class="message">{message}</p>{/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-2);
    padding-block: 2px;
    cursor: ew-resize;
    touch-action: none;
  }

  .name {
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-2);
  }

  .suffix {
    font-size: var(--t-micro);
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .control {
    display: flex;
    align-items: center;
    height: var(--control-h);
    padding: 0 var(--s-3);
    /* Recessed: you are looking into a well, so shade sits on the top edge
       and the lit edge is at the bottom. */
    background: linear-gradient(180deg, var(--surface-1), var(--surface-2));
    border: 1px solid var(--line-2);
    border-radius: var(--r-md);
    box-shadow: var(--sink-1);
    transition:
      border-color var(--dur-1) var(--ease),
      background var(--dur-1) var(--ease),
      box-shadow var(--dur-1) var(--ease);
  }

  .control:hover {
    border-color: var(--line-3);
  }

  /* Focus lifts the well out rather than just recolouring it. */
  .control:focus-within {
    border-color: var(--accent-line);
    background: linear-gradient(180deg, var(--surface-0), var(--surface-1));
    box-shadow: var(--press), 0 0 0 3px var(--accent-dim);
  }

  .alert .control {
    border-color: color-mix(in srgb, var(--danger) 55%, transparent);
  }

  .control.scrubbing {
    border-color: var(--accent);
    box-shadow: var(--press), 0 0 0 3px var(--accent-dim);
  }

  input {
    width: 100%;
    min-width: 0;
    border: 0;
    background: none;
    font-size: var(--t-md);
    font-variant-numeric: tabular-nums;
    color: var(--text-1);
    /* Spinners are hidden on purpose: the drag handle and the keyboard are the
       intended ways to change a value, and spinners are fiddly at 30px tall. */
    appearance: textfield;
    -moz-appearance: textfield;
  }

  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input:disabled {
    color: var(--text-3);
  }

  .message {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.35;
    color: var(--text-3);
  }

  .alert .message {
    color: var(--danger);
  }
</style>
