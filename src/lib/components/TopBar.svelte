<script>
  /**
   * Single-row app bar. Everything here is either identity, the current
   * file's facts, or one of the four global actions. It never wraps: below
   * the widths where things get tight, whole groups drop out in priority
   * order rather than stacking into a second line.
   */
  import Button from "./controls/Button.svelte";
  import { editor } from "../state/editor.svelte.js";
  import { formatBytes } from "../core/format.js";
  import { downloadBlob } from "../core/image.js";

  import ArrowUUpLeftIcon from "phosphor-svelte/lib/ArrowUUpLeft";
  import ArrowUUpRightIcon from "phosphor-svelte/lib/ArrowUUpRight";
  import ArrowCounterClockwiseIcon from "phosphor-svelte/lib/ArrowCounterClockwise";
  import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimple";
  import KeyboardIcon from "phosphor-svelte/lib/Keyboard";

  let { onshowshortcuts = () => {} } = $props();

  const meta = $derived.by(() => {
    const image = editor.current;
    if (!image) return null;
    return {
      name: image.name,
      dimensions: `${image.width} × ${image.height}`,
      format: image.format.toUpperCase(),
      size: formatBytes(image.blob.size),
      edits: editor.edited ? 1 : 0,
    };
  });
</script>

<header class="bar">
  <div class="identity">
    <span class="mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a14 14 0 0 0 0 18 14 14 0 0 0 0-18Z" />
        <path d="M3.5 9h17M3.5 15h17" opacity="0.55" />
      </svg>
    </span>
    <span class="wordmark">OpenLens</span>
  </div>

  <div class="facts" aria-live="polite">
    {#if meta}
      <span class="filename" title={meta.name}>{meta.name}</span>
      <dl class="chips">
        <div class="chip"><dt>Dim</dt><dd class="numeric">{meta.dimensions}</dd></div>
        <div class="chip"><dt>Type</dt><dd>{meta.format}</dd></div>
        <div class="chip"><dt>Size</dt><dd class="numeric">{meta.size}</dd></div>
      </dl>
    {:else}
      <span class="filename empty">No image loaded</span>
    {/if}
  </div>

  <div class="actions">
    <Button
      variant="quiet"
      size="sm"
      data-action="undo"
      title="Undo (Ctrl+Z)"
      disabled={!editor.canUndo}
      onclick={() => editor.undo()}
    >
      {#snippet icon()}<ArrowUUpLeftIcon size={15} weight="bold" />{/snippet}
      <span class="visually-hidden">Undo</span>
    </Button>

    <Button
      variant="quiet"
      size="sm"
      data-action="redo"
      title="Redo (Ctrl+Shift+Z)"
      disabled={!editor.canRedo}
      onclick={() => editor.redo()}
    >
      {#snippet icon()}<ArrowUUpRightIcon size={15} weight="bold" />{/snippet}
      <span class="visually-hidden">Redo</span>
    </Button>

    <Button
      variant="quiet"
      size="sm"
      data-action="reset"
      title="Back to the original (Ctrl+R)"
      disabled={!editor.canReset}
      onclick={() => editor.reset()}
    >
      {#snippet icon()}<ArrowCounterClockwiseIcon size={15} weight="bold" />{/snippet}
      <span class="visually-hidden">Reset to original</span>
    </Button>

    <span class="sep" role="presentation"></span>

    <Button
      variant="secondary"
      size="sm"
      data-action="shortcuts"
      title="Keyboard shortcuts (?)"
      onclick={onshowshortcuts}
    >
      {#snippet icon()}<KeyboardIcon size={15} />{/snippet}
      <span class="visually-hidden">Keyboard shortcuts</span>
    </Button>

    <Button
      variant="primary"
      size="sm"
      data-action="download"
      title="Download (Ctrl+S)"
      disabled={!editor.canDownload}
      onclick={() => editor.current && downloadBlob(editor.current.blob, editor.current.name)}
    >
      {#snippet icon()}<DownloadSimpleIcon size={15} weight="bold" />{/snippet}
      Download
    </Button>
  </div>
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--s-5);
    height: var(--topbar-h);
    padding: 0 var(--s-4) 0 var(--s-5);
    background: linear-gradient(180deg, var(--surface-2), var(--surface-1) 60%);
    border-bottom: 1px solid var(--line-1);
    /* The bar is the window's lid, so it catches light and casts onto the
       panes below it. */
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 1px 0 rgba(2, 6, 8, 0.5),
      0 4px 12px -6px rgba(2, 6, 8, 0.6);
    z-index: var(--z-rail);
  }

  .identity {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    flex: none;
  }

  .mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm);
    background: linear-gradient(180deg, var(--surface-2), var(--surface-1));
    border: 1px solid var(--line-2);
    box-shadow: var(--sink-1);
    color: var(--accent);
  }

  .wordmark {
    font-size: var(--t-md);
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .facts {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    flex: 1 1 auto;
    min-width: 0;
  }

  .filename {
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 240px;
  }

  .filename.empty {
    color: var(--text-3);
    font-weight: 500;
  }

  .chips {
    display: flex;
    gap: var(--s-1);
    margin: 0;
    padding: 0;
    flex: none;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    height: 22px;
    padding: 0 var(--s-2);
    background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
    border: 1px solid var(--line-2);
    border-radius: var(--r-sm);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  .chip dt {
    font-size: var(--t-micro);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-3);
  }

  .chip dd {
    margin: 0;
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--text-2);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    flex: none;
  }

  .sep {
    width: 1px;
    height: 20px;
    margin-inline: var(--s-2);
    background: var(--line-1);
  }

  /* Drop priority: chips, then wordmark, then secondary actions. */
  @media (max-width: 1080px) {
    .chip:nth-child(3) {
      display: none;
    }
  }

  @media (max-width: 900px) {
    .chips {
      display: none;
    }
  }

  @media (max-width: 680px) {
    .wordmark {
      display: none;
    }

    .filename {
      max-width: 120px;
    }
  }
</style>
