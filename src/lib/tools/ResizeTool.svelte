<script>
  /**
   * Resize tool.
   *
   * Everything here is derived from the image currently loaded, and reseeded
   * whenever a different image arrives so the fields can never propose a size
   * for a picture that is no longer on the stage.
   */
  import { editor } from "../state/editor.svelte.js";
  import { context2d, createCanvas, encodeLike, loadImage } from "../core/image.js";

  import Button from "../components/controls/Button.svelte";
  import NumberRow from "../components/controls/NumberRow.svelte";

  const SCALES = [0.25, 0.5, 0.75, 1, 2];

  let width = $state(0);
  let height = $state(0);
  /**
   * The ratio the lock holds. Deliberately NOT recomputed from width/height on
   * every edit: typing "100" passes through "1" first, and deriving the ratio
   * from that intermediate value would quietly collapse the image to 1:1. The
   * ratio changes only when a new image arrives or the operator re-locks.
   */
  let lockedRatio = $state(1);
  let linked = $state(true);
  let seededFor = $state(null);

  const source = $derived(editor.current);
  const dirty = $derived(!!source && seededFor !== source.url);

  // Reseed whenever the image behind the stage changes.
  $effect(() => {
    const image = editor.current;
    if (!image) {
      seededFor = null;
      return;
    }
    if (seededFor === image.url) return;
    seededFor = image.url;
    width = image.width;
    height = image.height;
    lockedRatio = image.width / image.height;
    linked = true;
  });

  const scalePercent = $derived(
    source && source.width ? Math.round((width / source.width) * 100) : 100,
  );

  /** Enormous upscaling is a common accident; name it before it happens. */
  const upscaling = $derived(scalePercent > 300);

  const MAX = 16000;

  function setSize(w, h) {
    width = Math.min(MAX, Math.max(1, w));
    height = Math.min(MAX, Math.max(1, h));
  }

  /** Re-locking adopts the ratio on screen now, not a stale one. */
  function setLinked(next) {
    linked = next;
    if (next) lockedRatio = width / height;
  }

  function applyScale(factor) {
    if (!source) return;
    const w = Math.max(1, Math.round(source.width * factor));
    const h = Math.max(1, Math.round(source.height * factor));
    setSize(w, h);
    lockedRatio = w / h;
  }

  async function apply() {
    if (!source) return;
    const targetW = Math.max(1, Math.round(width));
    const targetH = Math.max(1, Math.round(height));

    await editor.run("Resize", async (report) => {
      report("Decoding", 0.2);
      const decoded = await loadImage(source.blob);

      report("Rescaling", 0.5);
      const canvas = createCanvas(targetW, targetH);
      const ctx = context2d(canvas);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(decoded, 0, 0, targetW, targetH);

      report("Encoding", 0.8);
      const blob = await encodeLike(canvas, source);
      await editor.commit(blob, "Resize", source.name);
    });
  }
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Scale</span>
    <div class="tool-chips">
      {#each SCALES as factor (factor)}
        <button
          type="button"
          class="tool-chip"
          class:on={scalePercent === Math.round(factor * 100)}
          disabled={editor.busy || !source}
          onclick={() => applyScale(factor)}
        >
          {Math.round(factor * 100)}%
        </button>
      {/each}
    </div>
  </section>

  <section class="tool-section">
    <NumberRow
      idPrefix="resize"
      {width}
      {height}
      ratio={lockedRatio}
      {linked}
      onlink={setLinked}
      max={MAX}
      disabled={editor.busy}
      onsize={setSize}
    />

    {#if upscaling}
      <p class="tool-note">
        Upscaling past 300% adds no detail and will grow the exported file.
      </p>
    {/if}
  </section>

  {#if source}
    <div class="tool-result">
      <span>From {source.width} × {source.height}</span>
      <strong>{width} × {height}</strong>
    </div>
  {/if}

  <div class="tool-actions">
    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={!source || editor.busy || dirty || width < 1 || height < 1}
      onclick={apply}
    >
      Resize
    </Button>
  </div>
</div>
