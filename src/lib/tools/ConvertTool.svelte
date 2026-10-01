<script>
  /**
   * Convert tool: re-encode the current image as PNG, JPEG or WebP.
   *
   * This tool changes the encoding, never the pixels, so there is no preview
   * to show: the stage already shows what the result will contain. The panel
   * is therefore about consequences, and every one of them is spelled out:
   * which format it is now, which format it becomes, and the filename the
   * download will use.
   *
   * Quality is encoded into the canvas, so it only means anything for a lossy
   * format. For PNG the slider is disabled and says why, rather than sitting
   * there accepting a value that is thrown away.
   */
  import { editor } from "../state/editor.svelte.js";
  import { MIME_BY_FORMAT, renameExtension } from "../core/format.js";
  import { canvasToBlob, context2d, createCanvas, loadImage } from "../core/image.js";

  import Button from "../components/controls/Button.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const FORMATS = [
    { value: "png", label: "PNG", lossy: false },
    { value: "jpeg", label: "JPEG", lossy: true },
    { value: "webp", label: "WebP", lossy: true },
  ];

  /** Readable names for formats the panel can name but cannot write. */
  const FORMAT_LABELS = {
    png: "PNG",
    jpeg: "JPEG",
    webp: "WebP",
    avif: "AVIF",
    gif: "GIF",
    bmp: "BMP",
    tiff: "TIFF",
  };

  const options = FORMATS.map(({ value, label }) => ({ value, label }));

  let format = $state("png");
  let quality = $state(92);

  const source = $derived(editor.current);

  const isLossy = $derived(FORMATS.find((f) => f.value === format)?.lossy ?? true);
  const targetLabel = $derived(FORMAT_LABELS[format] ?? format.toUpperCase());
  const sourceLabel = $derived(FORMAT_LABELS[source?.format] ?? (source?.format || "").toUpperCase());
  const outputName = $derived(source ? renameExtension(source.name, format) : "");

  async function run() {
    if (!source) return;

    // Read the controls once: a run must not follow a change made mid-encode.
    const targetFormat = format;
    const targetMime = MIME_BY_FORMAT[targetFormat];
    const nextName = renameExtension(source.name, targetFormat);
    // PNG is lossless, so the encoder is given no quality at all.
    const encodeQuality = targetFormat === "png" ? undefined : quality / 100;

    await editor.run("Convert", async (report) => {
      report("Decoding", 0.2);
      const decoded = await loadImage(source.blob);

      report("Encoding", 0.6);
      const canvas = createCanvas(decoded.naturalWidth, decoded.naturalHeight);
      const ctx = context2d(canvas);

      // JPEG cannot hold an alpha channel. Without this the transparent
      // regions encode as black instead of the white the legacy tool used.
      if (targetFormat === "jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(decoded, 0, 0);

      const blob = await canvasToBlob(canvas, targetMime, encodeQuality);
      // A browser without an encoder for the target silently hands back a PNG,
      // which would then be saved under the wrong extension. Say so instead.
      if (blob.type !== targetMime) {
        throw new Error(`This browser cannot write ${targetLabel}. Use PNG or JPEG instead.`);
      }

      await editor.commit(blob, "Convert", nextName);
    });
  }
</script>

<div class="tool">
  <section class="tool-section">
    <Segmented
      name="convert-format"
      label="Format"
      columns={3}
      {options}
      value={format}
      disabled={editor.busy || !source}
      onvalue={(next) => (format = next)}
    />

    {#if format === "jpeg"}
      <p class="tool-note">
        JPEG has no transparency, so transparent areas are filled white.
      </p>
    {/if}
  </section>

  <section class="tool-section">
    <SliderField
      id="convert-quality"
      label="Quality"
      min={30}
      max={100}
      step={1}
      value={quality}
      display="{quality}%"
      disabled={editor.busy || !source || !isLossy}
      onvalue={(v) => (quality = v)}
    />

    {#if !isLossy}
      <p class="tool-note">
        PNG is lossless, so quality has no effect and the slider is off.
      </p>
    {/if}
  </section>

  {#if source}
    <div class="tool-result">
      <span>Converts</span>
      <strong>{sourceLabel} to {targetLabel}</strong>
    </div>

    <div class="tool-result">
      <span>Saves as</span>
      <strong>{outputName}</strong>
    </div>
  {/if}

  <div class="tool-actions">
    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={editor.busy || !source}
      onclick={run}
    >
      Convert
    </Button>
  </div>
</div>
