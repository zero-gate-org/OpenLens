<script>
  /**
   * Stickers.
   *
   * Places small graphic marks on the picture: pick one from the catalogue,
   * then move it, scale it, turn it, mirror it, reorder it, hide it or throw it
   * away. The list of placed marks is the tool, not an afterthought; the stage
   * handles are a convenience over it.
   *
   * This tool authors rather than filters, so it mounts a stage layer instead of
   * parking a preview bitmap: the marks are drawn over the picture in image
   * coordinates by `StickersLayer.svelte`, and the two halves share the
   * `stickers` store. Apply then rasterises the same catalogue entries onto a
   * full resolution canvas, using the same placement matrices, and commits it.
   *
   * The one thing that needs a canvas is the commit, so it is the one thing
   * that lives in this component. Everything else is a decision in the store
   * and arithmetic in `core/stickerkit.js`.
   */
  import { onMount, untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { stickers } from "../state/stickers.svelte.js";
  import {
    CATALOGUE,
    CATALOGUE_OPTIONS,
    MAX_STICKER_SIZE,
    MIN_STICKER_SIZE,
    itemDefinition,
    placementMatrix,
    rasterSizeFor,
    stickerDataUrl,
    viewBoxSize,
  } from "../core/stickerkit.js";
  import { context2d, createCanvas, loadImage } from "../core/image.js";
  import { canvasToImageBlob } from "../core/pixels.js";
  import StickersLayer from "./StickersLayer.svelte";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import NumberField from "../components/controls/NumberField.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const sk = stickers;

  const source = $derived(editor.current);
  const locked = $derived(editor.busy || !source);

  /** Whether there is anything in the catalogue to offer at all. */
  const hasCatalogue = $derived(CATALOGUE.length > 0);

  /** Readable name for a placed mark, falling back to the key rather than blank. */
  const nameOf = (item) => itemDefinition(item)?.name ?? item.key;

  /** Marks that run past an edge, phrased as one line. */
  const offFrameNote = $derived.by(() => {
    const entries = sk.offFrame;
    if (!entries.length) return null;
    const lost = entries.filter((entry) => entry.status.outside);
    const clipped = entries.length - lost.length;

    if (lost.length && clipped) {
      return `${lost.length} ${lost.length === 1 ? "sticker is" : "stickers are"} off the frame and will not appear. ${clipped} ${clipped === 1 ? "runs" : "run"} past an edge and will be cropped.`;
    }
    if (lost.length) {
      return `${lost.length} ${lost.length === 1 ? "sticker is" : "stickers are"} off the frame and will not appear in the export.`;
    }
    return `${clipped} ${clipped === 1 ? "sticker runs" : "stickers run"} past an edge. Apply crops ${clipped === 1 ? "it" : "them"} there.`;
  });

  /** Hidden marks, said plainly rather than silently dropped. */
  const hiddenNote = $derived(
    sk.hiddenCount === 0
      ? null
      : `${sk.hiddenCount} ${sk.hiddenCount === 1 ? "sticker is" : "stickers are"} hidden and will not be drawn.`,
  );

  // -------------------------------------------------------------------
  // Stage layer
  // -------------------------------------------------------------------

  onMount(() => {
    editor.setStageLayer(StickersLayer);
    return () => {
      editor.clearStageLayer();
      // The marks are drawn by the layer, not by `setPreview`, so there is no
      // preview of this tool's own to drop. Clearing it anyway means a preview
      // left on the stage by any other route cannot outlive this panel.
      editor.clearPreview();
    };
  });

  // Seed on activation, and whenever a genuinely new image arrives. Keyed on
  // `editor.epoch`, which moves only on open and discard, so this cannot fire
  // for an image this tool produced itself.
  $effect(() => {
    const active = editor.tool === "stickers";
    void editor.epoch;
    if (!active) return;
    untrack(() => {
      const image = editor.current;
      if (!image) {
        sk.sync(0, 0);
        return;
      }
      sk.sync(image.width, image.height);
    });
  });

  // -------------------------------------------------------------------
  // Rasterising a catalogue entry
  // -------------------------------------------------------------------

  /**
   * Decoded marks, keyed by `key@size`.
   *
   * A mark is a vector, so it is rasterised once per distinct size asked for and
   * then reused for every item that wants it. Two items of the same mark at the
   * same size share one image rather than each decoding their own.
   *
   * The cache is a small fixed number of entries. Rasterising costs about four
   * megabytes per 1024px mark, and a picture can hold far more marks than that,
   * so the oldest entry is dropped rather than growing without bound.
   */
  const CACHE_LIMIT = 6;
  const bitmaps = new Map();

  function loadBitmap(def, size) {
    const key = `${def.key}@${size}`;
    const cached = bitmaps.get(key);
    if (cached) {
      // Refresh the recency so a mark in use is not the one evicted.
      bitmaps.delete(key);
      bitmaps.set(key, cached);
      return cached.promise;
    }

    const url = stickerDataUrl(def);
    if (!url) return Promise.resolve(null);

    const promise = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });

    bitmaps.set(key, { promise, image: null });
    promise.then((image) => {
      const entry = bitmaps.get(key);
      if (entry) entry.image = image;
    });

    while (bitmaps.size > CACHE_LIMIT) {
      const oldest = bitmaps.keys().next().value;
      bitmaps.delete(oldest);
    }

    return promise;
  }

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  /**
   * Paint every visible mark onto the image at full resolution.
   *
   * Each mark is drawn through the same `placementMatrix` the stage layer used
   * for its SVG `transform`, so what was on the stage is what lands here. The
   * mark is rasterised at the size it will occupy (see `rasterSizeFor`), drawn
   * into its own viewBox-sized box and then transformed onto the picture.
   *
   * The canvas cannot be tainted, and the reason is in `stickerDataUrl`: the SVG
   * is assembled from inline path data in `core/stickerkit.js` with no external
   * reference of any kind, so decoding it pulls nothing from the network and the
   * canvas stays exportable. Nothing here may add an `<image>` with an external
   * href, which is the one change that would break `toBlob` on every Apply.
   *
   * A mark whose entry has gone, or whose bitmap will not decode, is skipped and
   * reported. Dropping one mark is recoverable; throwing would lose the whole
   * run and the operator's other stickers with it.
   */
  async function paint(ctx, report) {
    const drawing = sk.drawing;
    let skipped = 0;

    for (let i = 0; i < drawing.length; i += 1) {
      const item = drawing[i];
      const def = itemDefinition(item);
      if (!def) {
        skipped += 1;
        continue;
      }

      const size = rasterSizeFor(item, def);
      const image = await loadBitmap(def, size);
      if (!image) {
        skipped += 1;
        continue;
      }

      const { w: vw, h: vh } = viewBoxSize(def);
      const m = placementMatrix(item, def);

      ctx.save();
      ctx.globalAlpha = item.opacity / 100;
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      // The destination is the mark's own viewBox, because the matrix is what
      // maps viewBox units onto the picture. The bitmap carries the detail for
      // the size the mark occupies, and the browser scales it on the way down.
      ctx.drawImage(image, 0, 0, vw, vh);
      ctx.restore();

      if (drawing.length > 1) {
        report("Drawing stickers", 0.5 + 0.4 * ((i + 1) / drawing.length));
        // Hand the thread back between marks so a long list cannot hold the
        // main thread through the whole rasterisation.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    return skipped;
  }

  async function apply() {
    if (!source || locked || sk.blocked) return;
    const image = source;
    let skipped = 0;

    const done = await editor.run("Stickers", async (report) => {
      report("Decoding", 0.15);
      const decoded = await loadImage(image.blob);

      report("Drawing stickers", 0.5);
      const canvas = createCanvas(image.width, image.height);
      const ctx = context2d(canvas);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(decoded, 0, 0, image.width, image.height);
      skipped = await paint(ctx, report);

      report("Encoding", 0.92);
      const blob = await canvasToImageBlob(canvas, image);
      await editor.commit(blob, "Stickers", image.name);
    });

    if (!done) return;

    // The marks are in the pixels now, so the layer stops drawing them.
    sk.bake();

    // Said after the run, because `run` writes its own notice on the way out.
    // A dropped mark is the one thing here that can silently lose pixels, so it
    // is never silent.
    if (skipped > 0) {
      editor.setNotice(
        `Stickers applied. ${skipped} ${skipped === 1 ? "sticker" : "stickers"} could not be drawn and ${skipped === 1 ? "is" : "are"} not in the export.`,
        "error",
      );
    }
  }

  // -------------------------------------------------------------------
  // Placing
  // -------------------------------------------------------------------

  function place() {
    const added = sk.add(sk.addKey);
    if (!added) {
      editor.fail("That sticker could not be placed.");
    }
  }

  /** Put the selection back where it started, or nowhere if there is none. */
  function reset() {
    sk.clearAll();
  }
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Sticker</span>

    {#if hasCatalogue}
      <SelectField
        id="sk-add"
        label="Sticker"
        value={sk.addKey ?? CATALOGUE_OPTIONS[0].value}
        options={CATALOGUE_OPTIONS}
        disabled={editor.busy}
        onvalue={(next) => (sk.addKey = next)}
      />

      <Button variant="secondary" size="md" full disabled={editor.busy} onclick={place}>
        Place sticker
      </Button>

      <p class="tool-note">
        {CATALOGUE.length} marks, drawn from shapes built into the app. Select one
        on the picture to move, scale or turn it.
      </p>
    {:else}
      <p class="tool-note">
        The sticker catalogue is empty, so there is nothing to place. Reload the
        app to restore it.
      </p>
    {/if}
  </section>

  {#if sk.selected && sk.selectedDefinition}
    <section class="tool-section">
      <span class="micro-label">Selected sticker</span>

      <div class="tool-row">
        <NumberField
          id="sk-x"
          label="Across"
          value={sk.selected.x}
          min={-sk.axisMax}
          max={sk.axisMax}
          step={1}
          suffix="px"
          disabled={editor.busy}
          onvalue={(next) => sk.setPosition("x", next)}
        />
        <NumberField
          id="sk-y"
          label="Down"
          value={sk.selected.y}
          min={-sk.axisMax}
          max={sk.axisMax}
          step={1}
          suffix="px"
          disabled={editor.busy}
          onvalue={(next) => sk.setPosition("y", next)}
        />
      </div>

      <SliderField
        id="sk-size"
        label="Size"
        value={sk.selected.size}
        min={MIN_STICKER_SIZE}
        max={Math.min(MAX_STICKER_SIZE, sk.sizeMax)}
        step={1}
        display="{sk.selected.size} px"
        disabled={editor.busy}
        onvalue={(next) => sk.setSize(next)}
      />

      <SliderField
        id="sk-rotation"
        label="Rotation"
        value={sk.selected.rotation}
        min={0}
        max={359}
        step={1}
        display="{sk.selected.rotation}°"
        disabled={editor.busy}
        onvalue={(next) => sk.setRotation(next)}
      />

      <SliderField
        id="sk-opacity"
        label="Opacity"
        value={sk.selected.opacity}
        min={0}
        max={100}
        step={1}
        display="{sk.selected.opacity}%"
        disabled={editor.busy}
        onvalue={(next) => sk.setOpacity(next)}
      />

      <div class="tool-row">
        <CheckField
          id="sk-flipx"
          label="Mirror across"
          bind:checked={sk.selected.flipX}
          disabled={editor.busy}
        />
        <CheckField
          id="sk-flipy"
          label="Mirror down"
          bind:checked={sk.selected.flipY}
          disabled={editor.busy}
        />
      </div>

      <!--
        Nudge. Present as buttons rather than only as arrow keys so the gesture
        is reachable without a pointer and without finding the picture, which is
        what "keyboard reachable" has to mean for a placement tool.
      -->
      <div class="tool-row">
        <Button variant="ghost" size="sm" full disabled={editor.busy} onclick={() => sk.nudge(-1, 0)}>
          Nudge left
        </Button>
        <Button variant="ghost" size="sm" full disabled={editor.busy} onclick={() => sk.nudge(1, 0)}>
          Nudge right
        </Button>
      </div>

      <div class="tool-row">
        <Button variant="ghost" size="sm" full disabled={editor.busy} onclick={() => sk.nudge(0, -1)}>
          Nudge up
        </Button>
        <Button variant="ghost" size="sm" full disabled={editor.busy} onclick={() => sk.nudge(0, 1)}>
          Nudge down
        </Button>
      </div>

      <div class="tool-row">
        <Button variant="ghost" size="sm" full disabled={editor.busy} onclick={() => sk.centre()}>
          Centre in frame
        </Button>
        <Button variant="ghost" size="sm" full disabled={editor.busy} onclick={() => sk.straighten()}>
          Straighten
        </Button>
      </div>

      <div class="tool-row">
        <Button variant="ghost" size="sm" full disabled={editor.busy} onclick={() => sk.duplicate(sk.selectedId)}>
          Duplicate
        </Button>
        <Button
          variant="danger"
          size="sm"
          full
          disabled={editor.busy}
          onclick={() => sk.remove(sk.selectedId)}
        >
          Delete sticker
        </Button>
      </div>

      <div class="tool-row">
        <Button variant="ghost" size="sm" full disabled={editor.busy || !sk.canRaise} onclick={() => sk.raise(sk.selectedId)}>
          Bring forward
        </Button>
        <Button variant="ghost" size="sm" full disabled={editor.busy || !sk.canLower} onclick={() => sk.lower(sk.selectedId)}>
          Send back
        </Button>
      </div>

      <p class="tool-note">
        Across and Down, Size, Rotation and Opacity are the same values the handles
        on the picture set. Arrow keys nudge by 1 px, or 10 px with Shift. Escape
        clears the selection, and the bracket keys step through the list.
      </p>
    </section>
  {/if}

  <section class="tool-section">
    <span class="micro-label">On the picture</span>

    {#if sk.count === 0}
      <p class="tool-note">No stickers placed. Choose one above and press Place sticker.</p>
    {:else}
      <p class="tool-result">
        <span>{sk.count} {sk.count === 1 ? "sticker" : "stickers"}</span>
        <strong>{sk.count - sk.hiddenCount} shown</strong>
      </p>

      <ul class="list">
        {#each sk.listed as item, index (item.id)}
          <li>
            <button
              type="button"
              class="row"
              class:on={item.id === sk.selectedId}
              disabled={editor.busy}
              aria-pressed={item.id === sk.selectedId}
              onclick={() => sk.select(item.id)}
            >
              <span class="pos numeric">{sk.count - index}</span>
              <span class="name">{nameOf(item)}</span>
              {#if item.visible === false}<span class="tag">Hidden</span>{/if}
            </button>

            <div class="row-actions">
              <Button
                variant="quiet"
                size="sm"
                title={item.visible === false ? "Show this sticker" : "Hide this sticker"}
                aria-label={item.visible === false
                  ? `Show ${nameOf(item)}`
                  : `Hide ${nameOf(item)}`}
                disabled={editor.busy}
                onclick={() => sk.toggleVisible(item.id)}
              >
                {item.visible === false ? "Show" : "Hide"}
              </Button>

              <Button
                variant="quiet"
                size="sm"
                aria-label={`Remove ${nameOf(item)}`}
                disabled={editor.busy}
                onclick={() => sk.remove(item.id)}
              >
                Remove
              </Button>
            </div>
          </li>
        {/each}
      </ul>

      <p class="tool-note">
        The list runs front to back, so Bring forward and Send back move the
        selection through it.
      </p>
    {/if}
  </section>

  {#if hiddenNote}
    <p class="tool-note warn">{hiddenNote}</p>
  {/if}

  {#if offFrameNote}
    <p class="tool-note warn">{offFrameNote}</p>
  {/if}

  {#if sk.blockedBy}
    <p class="tool-note">{sk.blockedBy}</p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">
      The picture shows the stickers. Apply draws them into the image and clears
      the list.
    </p>

    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={locked || sk.blocked}
      onclick={apply}
    >
      Apply stickers
    </Button>

    <Button
      variant="quiet"
      size="sm"
      full
      disabled={editor.busy || sk.count === 0}
      onclick={reset}
    >
      Clear all stickers
    </Button>
  </div>
</div>

<!--
  Keyboard shortcuts for the picture itself: the layer is a pointer affordance
  and is aria-hidden, so these live on the panel and are only live while the
  stickers tool is the one on stage. The panel controls are the primary path;
  this is the arrow-key equivalent of dragging.
-->
<svelte:window
  onkeydown={(event) => {
    if (editor.tool !== "stickers" || editor.busy) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const target = event.target;
    // Never steal a key from a field the operator is typing into. The arrow
    // keys belong to a text field and to a number field's own caret.
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    }

    const nudges = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const nudge = nudges[event.key];

    if (nudge) {
      if (!sk.selected) return;
      event.preventDefault();
      sk.nudge(nudge[0], nudge[1], event.shiftKey);
      return;
    }

    // Escape clears the selection whether or not there is one, which is what a
    // person pressing it is asking for.
    if (event.key === "Escape") {
      sk.deselect();
      return;
    }

    // Stepping through the list, so selection does not need the picture either.
    if (event.key === "[" || event.key === "]") {
      if (!sk.count) return;
      event.preventDefault();
      sk.selectOffset(event.key === "]" ? 1 : -1);
    }
  }}
/>

<style>
  /* The placed-sticker list. It is a list of rows rather than a control from
     the shared set, because each row is a selection among many with its own
     per-row actions, and there is no control in `controls/` that models that. */
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--s-2);
    align-items: center;
  }

  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    padding: var(--s-2) var(--s-3);
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-radius: var(--r-md);
    color: var(--text-2);
    font-size: var(--t-xs);
    text-align: left;
    cursor: pointer;
    transition:
      background var(--dur-1) var(--ease),
      border-color var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease);
  }

  .row:hover:not(:disabled) {
    background: var(--surface-3);
    border-color: var(--line-3);
    color: var(--text-1);
  }

  .row.on {
    background: var(--accent-dim);
    border-color: var(--accent-line);
    color: var(--text-1);
  }

  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .row:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .pos {
    min-width: 18px;
    font-size: var(--t-micro);
    color: var(--text-3);
    text-align: right;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .tag {
    flex: none;
    font-size: var(--t-micro);
    color: var(--text-3);
  }

  .row-actions {
    display: flex;
    gap: var(--s-1);
  }

  /* The one warning in the panel, and it is the one thing that can lose pixels
     without the operator meaning to. */
  .tool-note.warn {
    color: var(--warning);
  }
</style>