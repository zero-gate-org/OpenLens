<script>
  /**
   * Stage furniture: the hold-to-compare control, image replacement, the zoom
   * cluster and the transient notice line. Floats above the picture, never
   * takes layout space, and never steals a click the operator meant for the
   * image.
   */
  import { editor } from "../state/editor.svelte.js";
  import { view } from "../state/view.svelte.js";

  import Button from "./controls/Button.svelte";
  import EyeIcon from "phosphor-svelte/lib/Eye";
  import TrayArrowUpIcon from "phosphor-svelte/lib/TrayArrowUp";
  import MagnifyingGlassMinusIcon from "phosphor-svelte/lib/MagnifyingGlassMinus";
  import MagnifyingGlassPlusIcon from "phosphor-svelte/lib/MagnifyingGlassPlus";
  import ArrowsOutSimpleIcon from "phosphor-svelte/lib/ArrowsOutSimple";
  import FrameCornersIcon from "phosphor-svelte/lib/FrameCorners";

  let { zoomPercent = 100 } = $props();

  let fileInput = $state(null);

  const canCompare = $derived(editor.edited && !editor.busy);

  // The view store clamps to this range, so the buttons grey out at the ends
  // instead of silently doing nothing.
  const atMinZoom = $derived(view.zoom !== null && view.zoom <= 0.1);
  const atMaxZoom = $derived(view.zoom !== null && view.zoom >= 8);

  function pickFile() {
    fileInput?.click();
  }

  function onFile(event) {
    const file = event.currentTarget.files?.[0];
    if (file) editor.open(file);
    event.currentTarget.value = "";
  }

  function holdCompare(down) {
    if (!canCompare) return;
    view.comparing = down;
  }
</script>

<div class="hud">
  {#if editor.notice}
    {#key editor.notice.id}
      <p class="notice {editor.notice.tone}" role="status">
        {editor.notice.message}
      </p>
    {/key}
  {/if}

  <div class="bar">
    <div class="group">
      <button
        type="button"
        class="chip-btn"
        disabled={!canCompare}
        title="Hold to see the original"
        onpointerdown={() => holdCompare(true)}
        onpointerup={() => holdCompare(false)}
        onpointercancel={() => holdCompare(false)}
        onpointerleave={() => holdCompare(false)}
        onkeydown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            holdCompare(true);
          }
        }}
        onkeyup={(event) => {
          if (event.key === " " || event.key === "Enter") holdCompare(false);
        }}
        onblur={() => holdCompare(false)}
      >
        <EyeIcon size={15} />
        <span>Compare</span>
      </button>

      <button
        type="button"
        class="chip-btn"
        disabled={editor.busy}
        title="Open a different image"
        onclick={pickFile}
      >
        <TrayArrowUpIcon size={15} />
        <span>Replace</span>
      </button>
    </div>

    <div class="group">
      <Button
        variant="quiet"
        size="sm"
        title="Zoom out"
        disabled={atMinZoom}
        onclick={() => view.zoomBy(1 / 1.25)}
      >
        {#snippet icon()}<MagnifyingGlassMinusIcon size={15} weight="bold" />{/snippet}
        <span class="visually-hidden">Zoom out</span>
      </Button>

      <span class="zoom numeric" aria-live="off">{zoomPercent}%</span>

      <Button
        variant="quiet"
        size="sm"
        title="Zoom in"
        disabled={atMaxZoom}
        onclick={() => view.zoomBy(1.25)}
      >
        {#snippet icon()}<MagnifyingGlassPlusIcon size={15} weight="bold" />{/snippet}
        <span class="visually-hidden">Zoom in</span>
      </Button>

      <span class="sep" role="presentation"></span>

      <Button
        variant="quiet"
        size="sm"
        title="Fit to the window"
        onclick={() => view.fit()}
      >
        {#snippet icon()}<FrameCornersIcon size={15} weight="bold" />{/snippet}
        <span class="visually-hidden">Fit to window</span>
      </Button>

      <Button
        variant="quiet"
        size="sm"
        title="Actual pixels"
        onclick={() => view.setZoom(1 / (view.fitScale || 1))}
      >
        {#snippet icon()}<ArrowsOutSimpleIcon size={15} weight="bold" />{/snippet}
        <span class="visually-hidden">Actual pixels</span>
      </Button>
    </div>
  </div>
</div>

<input
  class="visually-hidden"
  type="file"
  accept="image/*"
  bind:this={fileInput}
  onchange={onFile}
/>

<style>
  .hud {
    position: absolute;
    inset: auto 0 0 0;
    z-index: var(--z-stage-ui);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-4);
    /* Only the bar itself should swallow clicks, not the whole strip. */
    pointer-events: none;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    width: 100%;
    max-width: 620px;
    padding: var(--s-2);
    background: linear-gradient(180deg, rgba(28, 35, 40, 0.9), rgba(16, 21, 24, 0.92));
    border: 1px solid var(--line-2);
    border-radius: var(--r-lg);
    /* Floats above the stage, so it casts a real shadow onto it. */
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.09),
      0 6px 20px -6px rgba(2, 6, 8, 0.8);
    backdrop-filter: blur(14px) saturate(140%);
    pointer-events: auto;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .sep {
    width: 1px;
    height: 18px;
    margin-inline: var(--s-2);
    background: var(--line-1);
  }

  .chip-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    height: 28px;
    padding: 0 var(--s-3);
    border-radius: var(--r-md);
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--text-2);
    transition:
      background var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease);
  }

  .chip-btn:hover:not(:disabled) {
    background: var(--surface-3);
    color: var(--text-1);
    box-shadow: var(--raise-1);
  }

  .chip-btn:active:not(:disabled) {
    transform: translateY(1px);
    box-shadow: var(--press);
  }

  .chip-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Held compare gets an obvious active state, since the eye is on the image. */
  .chip-btn:active:not(:disabled) {
    background: var(--accent-dim);
    color: var(--accent);
  }

  .zoom {
    min-width: 46px;
    text-align: center;
    font-size: var(--t-xs);
    font-weight: 650;
    color: var(--text-2);
  }

  .notice {
    padding: var(--s-2) var(--s-4);
    background: var(--surface-3);
    border: 1px solid var(--line-2);
    border-radius: var(--r-pill);
    font-size: var(--t-sm);
    font-weight: 550;
    color: var(--text-1);
    box-shadow: var(--shadow-2);
    animation: rise var(--dur-2) var(--ease);
    pointer-events: auto;
  }

  .notice.error {
    background: color-mix(in srgb, var(--danger) 18%, var(--surface-2));
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
    color: #ffd9d6;
  }

  .notice.working {
    color: var(--text-2);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .notice {
      animation: none;
    }
  }

  /* The labels are the first thing to go when the stage gets narrow. */
  @media (max-width: 620px) {
    .chip-btn span {
      display: none;
    }

    .chip-btn {
      width: 28px;
      padding: 0;
      justify-content: center;
    }
  }
</style>
