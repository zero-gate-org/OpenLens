<script>
  /**
   * Empty state. This is the first screen anyone sees, so it states the
   * product's actual promise (nothing is uploaded) rather than decorating.
   */
  import Button from "./controls/Button.svelte";
  import { editor } from "../state/editor.svelte.js";
  import { ACCEPTED_TYPES } from "../core/format.js";
  import TrayArrowUpIcon from "phosphor-svelte/lib/TrayArrowUp";

  let input = $state(null);
  let hovering = $state(false);

  const extensions = ACCEPTED_TYPES.map((type) => type.split("/")[1].toUpperCase());

  function pick() {
    if (!editor.busy) input?.click();
  }

  function onFile(event) {
    const file = event.currentTarget.files?.[0];
    if (file) editor.open(file);
    event.currentTarget.value = "";
  }

  function onDrop(event) {
    event.preventDefault();
    hovering = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) editor.open(file);
  }

  function onKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick();
    }
  }
</script>

<div
  class="empty checkerboard"
  class:over={hovering}
  role="button"
  tabindex="0"
  aria-label="Choose an image to edit"
  onclick={pick}
  onkeydown={onKeydown}
  ondragover={(event) => {
    event.preventDefault();
    hovering = true;
  }}
  ondragleave={() => (hovering = false)}
  ondrop={onDrop}
>
  <div class="inner">
    <span class="glyph" aria-hidden="true">
      <TrayArrowUpIcon size={26} weight="regular" />
    </span>

    <h1>Drop an image to start</h1>
    <p class="sub">Or choose a file. Edits happen in this tab and are never uploaded.</p>

    <Button variant="primary" size="lg" onclick={pick}>Choose image</Button>

    <p class="formats">
      <span class="micro-label">Accepts</span>
      <span class="list">{extensions.join(" · ")}</span>
    </p>
  </div>
</div>

<input
  class="visually-hidden"
  type="file"
  accept="image/*"
  bind:this={input}
  onchange={onFile}
/>

<style>
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--s-7);
    cursor: pointer;
    /* The checkerboard shows through at low opacity: the surface the image
       will land on is visible before there is an image. */
    background-image:
      linear-gradient(45deg, #232c31 25%, transparent 25%),
      linear-gradient(-45deg, #232c31 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #232c31 75%),
      linear-gradient(-45deg, transparent 75%, #232c31 75%);
    background-size: 20px 20px;
    background-position:
      0 0,
      0 10px,
      10px -10px,
      -10px 0;
    background-color: var(--surface-0);
    transition: box-shadow var(--dur-2) var(--ease);
  }

  /* The drop target is a shallow well with a dashed lip. */
  .empty::before {
    content: "";
    position: absolute;
    inset: var(--s-6);
    border: 1px dashed var(--line-3);
    border-radius: var(--r-lg);
    background: rgba(11, 15, 17, 0.82);
    box-shadow: var(--sink-1);
    pointer-events: none;
  }

  .empty.over,
  .empty:hover,
  .empty:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .empty.over::before,
  .empty:hover::before {
    border-color: var(--accent-line);
  }

  .inner {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-4);
    max-width: 400px;
    text-align: center;
  }

  /* A recessed plate the glyph is carved into. */
  .glyph {
    display: grid;
    place-items: center;
    width: 58px;
    height: 58px;
    border: 1px solid var(--line-2);
    border-radius: var(--r-lg);
    background: linear-gradient(180deg, var(--surface-1), var(--surface-2));
    box-shadow:
      var(--sink-1),
      inset 0 0 0 1px rgba(2, 6, 8, 0.3);
    color: var(--accent);
  }

  h1 {
    font-size: var(--t-2xl);
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.15;
  }

  .sub {
    max-width: 34ch;
    font-size: var(--t-md);
    line-height: 1.5;
    color: var(--text-2);
  }

  .formats {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin-top: var(--s-2);
  }

  .list {
    font-size: var(--t-xs);
    color: var(--text-3);
    letter-spacing: 0.02em;
  }
</style>
