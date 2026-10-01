<script>
  /**
   * Crop tool.
   *
   * The interaction itself lives on the stage (`CropOverlay.svelte`); this
   * panel is the numeric and ratio side of the same selection, kept in sync
   * through the shared `crop` store.
   */
  import { editor } from "../state/editor.svelte.js";
  import { crop, ASPECT_PRESETS } from "../state/crop.svelte.js";
  import { context2d, createCanvas, encodeLike, loadImage } from "../core/image.js";

  import Button from "../components/controls/Button.svelte";
  import NumberRow from "../components/controls/NumberRow.svelte";
  import Segmented from "../components/controls/Segmented.svelte";

  const ratioOptions = ASPECT_PRESETS.map((p) => ({ value: p.id, label: p.label }));

  const activeAspect = $derived(
    ASPECT_PRESETS.find((p) => p.value === crop.aspect)?.id ?? "free",
  );

  const source = $derived(editor.current);
  const output = $derived.by(() => {
    if (!source || !crop.box) return null;
    const scale = crop.rounded.w / source.width;
    return {
      w: crop.rounded.w,
      h: crop.rounded.h,
      // Share of the original kept, so the panel can say what survives.
      kept: Math.round((crop.rounded.w * crop.rounded.h) / (source.width * source.height) * 100),
      scale: Math.round(scale * 100),
    };
  });

  function onSize(w, h) {
    crop.setSize(w, h);
  }

  async function apply() {
    if (!source || !crop.isValid) return;

    await editor.run("Crop", async (report) => {
      report("Cropping", 0.25);
      const decoded = await loadImage(source.blob);
      const box = crop.box;

      const canvas = createCanvas(box.w, box.h);
      const ctx = context2d(canvas);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Source rect and destination rect are both 1:1, so the result is
      // exactly the selection with no resampling at all.
      ctx.drawImage(decoded, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

      report("Encoding", 0.75);
      const blob = await encodeLike(canvas, source);
      await editor.commit(blob, "Crop", source.name);
    });
  }

  function resetSelection() {
    crop.box = null;
    crop.sync(source.width, source.height);
  }
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Crop to</span>
    <NumberRow
      idPrefix="crop"
      width={output?.w ?? 0}
      height={output?.h ?? 0}
      ratio={crop.rounded.h > 0 ? crop.rounded.w / crop.rounded.h : 0}
      onsize={onSize}
      disabled={editor.busy}
    />
  </section>

  <section class="tool-section">
    <Segmented
      name="crop-aspect"
      label="Ratio"
      columns={3}
      options={ratioOptions}
      value={activeAspect}
      disabled={editor.busy}
      onvalue={(id) => crop.setAspectById(id)}
    />
  </section>

  {#if output}
    <div class="tool-result">
      <span>Keeps {output.kept}% of the frame</span>
      <strong>{output.w} × {output.h}</strong>
    </div>
  {/if}

  <div class="tool-actions">
    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={!crop.isValid || editor.busy}
      onclick={apply}
    >
      Apply crop
    </Button>

    <Button variant="quiet" size="sm" full disabled={editor.busy} onclick={resetSelection}>
      Reset selection
    </Button>
  </div>
</div>
