<script>
  /**
   * Rotate tool.
   *
   * The angle lives in a store rather than in this component because the
   * stage reads it to draw the live preview. Nothing is committed until
   * Apply, so a fine angle costs one click instead of a click plus an undo.
   */
  import { editor } from "../state/editor.svelte.js";
  import { rotate } from "../state/rotate.svelte.js";
  import { angleLabel, renderTransform } from "../core/transform.js";
  import { encodeLike, loadImage } from "../core/image.js";

  import Button from "../components/controls/Button.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const source = $derived(editor.current);

  const flips = [
    { axis: "x", label: "Flip horizontal" },
    { axis: "y", label: "Flip vertical" },
  ];

  async function apply() {
    if (!source || rotate.isClean) return;

    await editor.run("Rotate", async (report) => {
      report("Decoding", 0.2);
      const decoded = await loadImage(source.blob);

      report("Rotating", 0.55);
      const canvas = renderTransform(decoded, {
        angle: rotate.angle,
        flipX: rotate.flipX,
        flipY: rotate.flipY,
      });

      report("Encoding", 0.8);
      const blob = await encodeLike(canvas, source);
      await editor.commit(blob, "Rotate", source.name);
      rotate.reset();
    });
  }
</script>

<div class="tool">
  <section class="tool-section">
    <span class="micro-label">Quick turn</span>
    <div class="tool-row">
      <Button
        variant="secondary"
        full
        data-turn="left"
        disabled={editor.busy || !source}
        onclick={() => rotate.turn(-1)}
      >
        Left 90
      </Button>
      <Button
        variant="secondary"
        full
        data-turn="right"
        disabled={editor.busy || !source}
        onclick={() => rotate.turn(1)}
      >
        Right 90
      </Button>
    </div>
  </section>

  <section class="tool-section">
    <SliderField
      id="rotate-angle"
      label="Angle"
      min={-180}
      max={180}
      step={0.5}
      value={rotate.angle}
      display={angleLabel(rotate.angle)}
      disabled={editor.busy || !source}
      onvalue={(v) => rotate.setAngle(Number(v))}
    />
  </section>

  <section class="tool-section">
    <span class="micro-label">Mirror</span>
    <div class="tool-row">
      {#each flips as flip (flip.axis)}
        <Button
          variant="secondary"
          full
          disabled={editor.busy || !source}
          pressed={flip.axis === "x" ? rotate.flipX : rotate.flipY}
          onclick={() => rotate.toggleFlip(flip.axis)}
        >
          {flip.axis === "x" ? "Horizontal" : "Vertical"}
        </Button>
      {/each}
    </div>
  </section>

  {#if !rotate.isClean}
    <p class="tool-note">
      The stage is showing the result. Apply to keep it, or reset to look again.
    </p>
  {/if}

  <div class="tool-actions">
    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={rotate.isClean || editor.busy || !source}
      onclick={apply}
    >
      Apply rotation
    </Button>

    <Button
      variant="quiet"
      size="sm"
      full
      disabled={rotate.isClean || editor.busy}
      onclick={() => rotate.reset()}
    >
      Reset
    </Button>
  </div>
</div>
