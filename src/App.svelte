<script>
  /**
   * App shell: topbar, tool rail, stage, tool panel.
   *
   * Global keyboard handling lives here rather than in the tools so a
   * shortcut means the same thing whichever panel is open, and the tools stay
   * free of key handling.
   */
  import { onMount } from "svelte";

  import TopBar from "./lib/components/TopBar.svelte";
  import ToolRail from "./lib/components/ToolRail.svelte";
  import ToolPanel from "./lib/components/ToolPanel.svelte";
  import Stage from "./lib/components/Stage.svelte";
  import DropZone from "./lib/components/DropZone.svelte";
  import ShortcutSheet from "./lib/components/ShortcutSheet.svelte";

  import { editor } from "./lib/state/editor.svelte.js";
  import { view } from "./lib/state/view.svelte.js";
  import { crop } from "./lib/state/crop.svelte.js";
  import { downloadBlob } from "./lib/core/image.js";
  import { initRouting, syncToolToLocation } from "./lib/routing.svelte.js";
  import { stepTool, toolByShortcut } from "./lib/registry.js";

  let shortcutsOpen = $state(false);
  let fileInput = $state(null);

  const save = () => {
    if (editor.current) downloadBlob(editor.current.blob, editor.current.name);
  };

  /**
   * Arrow keys nudge the crop selection by 1px, 10px with Shift.
   * Handled globally rather than on a focusable overlay so it works the
   * moment the crop tool is active, without tabbing to the image first.
   */
  function nudgeCrop(event) {
    if (editor.tool !== "crop" || !crop.box) return false;

    const step = event.shiftKey ? 10 : 1;
    const deltas = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[event.key];
    if (!delta) return false;

    event.preventDefault();
    const [dx, dy] = delta;
    const b = crop.box;
    crop.box = {
      w: b.w,
      h: b.h,
      x: Math.min(crop.imageWidth - b.w, Math.max(0, b.x + dx)),
      y: Math.min(crop.imageHeight - b.h, Math.max(0, b.y + dy)),
    };
    return true;
  }

  /**
   * What has keyboard focus, as far as shortcuts are concerned.
   *
   * "Is it an input?" is the wrong question. A focused slider or radio swallows
   * every shortcut under that test, which is exactly the state a person is in
   * after clicking a control: `?` stops opening the sheet, Ctrl+Z stops
   * working, and the crop nudge arrows never arrive. Only genuine text entry,
   * and selects (whose arrow keys navigate options), get a pass.
   */
  const TEXT_ENTRY_TYPES = new Set([
    "text",
    "search",
    "url",
    "tel",
    "email",
    "password",
    "number",
    "date",
    "datetime-local",
    "month",
    "time",
    "week",
  ]);

  function focusKind(target) {
    if (!(target instanceof HTMLElement)) return "none";
    if (target.isContentEditable) return "text";
    if (target.tagName === "TEXTAREA") return "text";
    if (target.tagName === "SELECT") return "select";
    if (target.tagName !== "INPUT") return "none";
    const type = (target.getAttribute("type") ?? "text").toLowerCase();
    return TEXT_ENTRY_TYPES.has(type) ? "text" : "control";
  }

  onMount(() => {
    const disposeRouting = initRouting();

    function onKeydown(event) {
      const target = event.target;
      const focus = focusKind(target);

      const mod = event.ctrlKey || event.metaKey;

      if (!mod && event.key === "?" && focus !== "text" && focus !== "select") {
        event.preventDefault();
        shortcutsOpen = !shortcutsOpen;
        return;
      }

      if (!mod && event.key === "Escape" && focus !== "text") {
        if (shortcutsOpen) {
          shortcutsOpen = false;
        } else {
          editor.dismissError();
        }
        return;
      }

      if (mod) {
        const key = event.key.toLowerCase();
        const handled = () => event.preventDefault();

        switch (key) {
          case "z":
            handled();
            event.shiftKey ? editor.redo() : editor.undo();
            return;
          case "y":
            handled();
            editor.redo();
            return;
          case "s":
            handled();
            save();
            return;
          case "d":
            handled();
            if (!editor.busy) fileInput?.click();
            return;
          case "r":
            if (event.shiftKey) return; // leave browser reload alone
            handled();
            editor.reset();
            return;
          case "0":
            handled();
            view.fit();
            return;
          case "1":
            handled();
            view.setZoom(1 / (view.fitScale || 1));
            return;
          case "=":
          case "+":
            handled();
            view.zoomBy(1.25);
            return;
          case "-":
            handled();
            view.zoomBy(1 / 1.25);
            return;
        }
        return;
      }

      if (focus === "text" || focus === "select" || editor.busy) return;

      if (nudgeCrop(event)) return;

      const tool = toolByShortcut(event.key);
      if (tool) {
        event.preventDefault();
        editor.setTool(tool.id);
        return;
      }

      if (event.key === "[") {
        event.preventDefault();
        editor.setTool(stepTool(editor.tool, -1));
      } else if (event.key === "]") {
        event.preventDefault();
        editor.setTool(stepTool(editor.tool, 1));
      }
    }

    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("keydown", onKeydown);
      disposeRouting();
    };
  });

  // Reflect the active tool in the address bar for shareable deep links.
  $effect(() => {
    syncToolToLocation(editor.tool);
  });
</script>

<div class="shell">
  <TopBar onshowshortcuts={() => (shortcutsOpen = true)} />

  <div class="body">
    <ToolRail />

    <main class="stage-slot" aria-label="Canvas">
      {#if editor.hasImage}
        <Stage />
      {:else}
        <DropZone />
      {/if}
    </main>

    <ToolPanel />
  </div>

  <ShortcutSheet bind:open={shortcutsOpen} />
</div>

<input
  class="visually-hidden"
  type="file"
  accept="image/*"
  bind:this={fileInput}
  onchange={(event) => {
    const file = event.currentTarget.files?.[0];
    if (file) editor.open(file);
    event.currentTarget.value = "";
  }}
/>

<style>
  .shell {
    display: grid;
    grid-template-rows: var(--topbar-h) 1fr;
    /* dvh, not vh: mobile browser chrome would otherwise clip the panel. */
    height: 100dvh;
    background: var(--surface-0);
  }

  .body {
    display: flex;
    min-height: 0;
  }

  .stage-slot {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  /* Narrow: the rail runs across the top and the panel becomes a bottom
     sheet, so the picture keeps the full width of the screen. */
  @media (max-width: 860px) {
    .body {
      flex-direction: column;
    }

    .stage-slot {
      order: 2;
    }
  }
</style>
