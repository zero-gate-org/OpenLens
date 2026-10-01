<script>
  /**
   * Labelled colour input with the hex spelled out.
   *
   * Controlled, like every other field here: the parent owns the value and
   * the component reports changes, so a preset that sets two colours at once
   * and a colour the operator typed can never disagree.
   *
   * The value is a `#rrggbb` string and the readout shows it, because a
   * swatch on its own cannot be read, repeated or typed back in. The native
   * picker stays underneath the swatch rather than being replaced: a free
   * colour is part of the promise of the tools that use this, and no fixed
   * palette can cover a photograph.
   */
  import { normalizeHex } from "../../core/duotonemath.js";

  let {
    id,
    label,
    value,
    onvalue = () => {},
    disabled = false,
  } = $props();

  // Defensive rather than decorative: an empty or abbreviated value would
  // otherwise make the native input fall back to black and report that back
  // as though the operator had chosen it.
  const shown = $derived(normalizeHex(value));

  function onInput(event) {
    onvalue(normalizeHex(event.currentTarget.value));
  }
</script>

<div class="field" class:disabled>
  <label class="name" for={id}>{label}</label>

  <div class="wrap">
    <span class="swatch" style:background={shown}>
      <input
        {id}
        type="color"
        {value}
        {disabled}
        oninput={onInput}
      />
    </span>

    <output class="hex numeric" for={id}>{shown}</output>
  </div>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }

  .field.disabled {
    opacity: 0.5;
  }

  .name {
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-2);
  }

  .wrap {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }

  /* The swatch is the visible face of the native input, which is laid over
     it and made invisible, so a click anywhere on the colour opens the
     system picker. */
  .swatch {
    position: relative;
    flex: none;
    width: var(--control-h);
    height: var(--control-h);
    border: 1px solid var(--line-2);
    border-radius: var(--r-md);
    /* The last two inset shadows are a hairline of light and dark, so a
       white or a black swatch still reads as a control on a dark panel. */
    box-shadow:
      inset 0 0 0 1px rgba(198, 216, 222, 0.14),
      inset 0 0 0 2px rgba(0, 0, 0, 0.45);
    transition: border-color var(--dur-1) var(--ease);
  }

  .swatch:hover {
    border-color: var(--line-3);
  }

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  /* Chrome and Safari paint their own frame, which would sit on top of the
     swatch colour. Removing it leaves the wrapper's own borders. */
  input::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  input::-webkit-color-swatch {
    border: 0;
    opacity: 0;
  }

  input::-moz-color-swatch {
    border: 0;
    opacity: 0;
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--r-md);
  }

  input:disabled {
    cursor: not-allowed;
  }

  .hex {
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--text-1);
  }
</style>
