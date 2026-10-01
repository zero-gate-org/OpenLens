<script>
  /**
   * Background removal.
   *
   * The segmentation model runs in a worker in this tab, so the pixels never
   * leave the machine. The cost is a one-time model download, which is why
   * the panel leads with that trade rather than hiding it behind the button.
   */
  import { editor } from "../state/editor.svelte.js";
  import { renameExtension } from "../core/format.js";

  import Button from "../components/controls/Button.svelte";
  import SelectField from "../components/controls/SelectField.svelte";

  const MODELS = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ];

  let model = $state("medium");

  /** Cached across runs; a failed import must not poison the retry. */
  let modulePromise = null;

  async function loadSegmenter() {
    if (!modulePromise) {
      modulePromise = import("@imgly/background-removal").catch((error) => {
        modulePromise = null;
        console.error(error);
        throw new Error(
          "Could not load the background-removal model. It downloads on first use, so this step needs a network connection. Try again once you are online.",
        );
      });
    }
    return modulePromise;
  }

  const source = $derived(editor.current);

  const outputName = $derived(
    source ? renameExtension(source.name, "png") : "image.png",
  );

  async function run() {
    if (!source) return;

    await editor.run("Background removal", async (report) => {
      report("Fetching the model", 0.02);
      const { removeBackground } = await loadSegmenter();

      const blob = await removeBackground(source.blob, {
        model,
        output: { format: "image/png" },
        progress: (key, current, total) => {
          const ratio = total > 0 ? current / total : null;
          report(describeProgress(key), ratio);
        },
      });

      // Alpha needs a lossless container, so the file becomes a PNG.
      await editor.commit(blob, "Background removal", outputName);
    });
  }

  /** Turn the library's terse progress keys into something readable. */
  function describeProgress(key) {
    const k = String(key ?? "").toLowerCase();
    if (k.includes("download") && k.includes("model")) return "Downloading the model";
    if (k.includes("download")) return "Downloading model files";
    if (k.includes("load")) return "Loading the model";
    if (k.includes("infer") || k.includes("compute")) return "Finding the background";
    if (k.includes("fetch")) return "Fetching the model";
    return "Removing the background";
  }
</script>

<div class="tool">
  <section class="tool-section">
    <SelectField
      id="bg-model"
      label="Model"
      value={model}
      onvalue={(next) => (model = next)}
      options={MODELS}
      disabled={editor.busy || !source}
      hint="Small is quickest. Large gives the cleanest edges on hair and fur."
    />
  </section>

  <p class="tool-note">
    The first run downloads the model and caches it in this browser. Later runs
    work offline, and the image itself is never uploaded.
  </p>

  {#if source}
    <div class="tool-result">
      <span>Exports as</span>
      <strong>{outputName}</strong>
    </div>
  {/if}

  <div class="tool-actions">
    <Button
      variant="primary"
      size="lg"
      full
      disabled={editor.busy || !source}
      onclick={run}
    >
      Remove background
    </Button>
  </div>
</div>
