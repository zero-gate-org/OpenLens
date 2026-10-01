# OpenLens (Svelte)

The landing page and the editor, on Svelte 5. Every edit runs in the browser;
nothing is uploaded.

```bash
npm install
npm run dev      # http://localhost:5173, landing page at / and editor at /editor.html
npm run check    # types, 0 errors 0 warnings
npm test         # unit tests
npm run build    # production bundle into dist/, then prerender the landing page
```

## Status

All 25 tools from the legacy static app are ported. See `src/lib/tools.js` for
the live list and grouping.

| Group | Tools |
|---|---|
| Transform | crop, resize, rotate |
| AI | bgremove, blur, color splash, shadow |
| Filters | tilt-shift, duotone, halftone, film grain, sketch, gradient map, glitch, lomo, oil paint, chromatic aberration |
| Text | curved text, stroke text, stickers, pattern text, text behind |
| Output | convert, watermark, photo frame |

## Architecture

```
index.html                   the landing page (prerendered, hydrates on load)
editor.html                  the editor
src/
  App.svelte                 editor shell, global keyboard handling, ?tool= routing
  main.js                    editor mount + global stylesheets
  landing/
    Landing.svelte           the landing page, nine sections
    main-landing.js          prerender-aware mount, ?tool= deep-link redirect
    landing.css              page tokens, type scale, rhythm, primitives
    lib/
      render.js              live effects: runs core/ passes in the core/ workers
      photos.js              the photographs, and cover-cropping
      reveal.js              IntersectionObserver as a Svelte action
      redirect.js            old editor deep links, forwarded to editor.html
    components/              SiteHeader, Hero, LiveDemo, FactsBand, ToolBoard,
                             FilterGallery, TextSpecimens, Faq, SiteFooter
  styles/
    tokens.css               the whole design system: colour, type, radius, motion
    base.css                 reset, focus, scrollbars, utilities
    tools.css                the tool-panel class contract
  lib/
    tools.js                 tool metadata and icons. No implementations.
    registry.js              tools.js joined to the tool components
    routing.svelte.js        ?tool= deep links
    state/
      editor.svelte.js       image, history, busy state, live previews, stage layers
      view.svelte.js         zoom, pan, compare
      crop.svelte.js         crop selection, in image coordinates
      rotate.svelte.js       pending rotation and flips
      *text*.svelte.js       per-tool shared state, where a tool has two components
    core/                    pure logic, no runes, unit tested in Node
    workers/                 seven Web Workers for the expensive pixel passes
    components/
      Stage.svelte           the image stage: fit, zoom, pan, drop, previews, layers
      CropOverlay.svelte     crop handles, the reference for a stage layer
      ToolRail.svelte        the tool switcher
      ToolPanel.svelte       mounts the active tool
      StageHud.svelte        compare, replace, zoom controls
      controls/              Button, NumberField, NumberRow, SliderField,
                             Segmented, SelectField, CheckField, ColorField
    tools/                   one component per tool
```

Four ideas do most of the work.

**One registry, split in two.** `tools.js` holds what a tool *is*: its id, its
label, its group, its icon, its shortcut. `registry.js` adds what a tool *does*:
the component that implements it. The landing page imports the first and never
the second, which is why the marketing page ships 46KB instead of the 465KB of
tool code, workers and segmentation loader that importing the whole registry
would have pulled in.

**Live previews are non-destructive.** A tool computes a candidate image and
hands it to the stage via `editor.setPreview(blob)`. The committed image is
never touched, so a preview cannot leak into the export or the undo stack.

**Tools that author mount a stage layer.** Text, stickers and frames draw over
the picture at image coordinates, inside the same box the crop overlay uses, so
they scale with the image exactly like everything else.

**The landing page runs the product.** The hero's before/after and the six tiles
in the filter gallery are not screenshots. They are the same passes in
`core/`, in the same workers in `lib/workers/`, run against the page's own
photographs as you scroll. It is the only honest way to demonstrate an editor
that claims to run locally.

## The two pages

`index.html` is the landing page and `editor.html` is the editor. They are
separate Vite entries, so the landing page never loads the editor's graph.

Two consequences worth knowing:

- **Deep links still work.** The editor used to live at the site root. Anything
  arriving at `/` with a `?tool=` parameter is an old link, and
  `landing/lib/redirect.js` forwards it to `editor.html` before Svelte mounts.
  Bookmarks and old tool cards keep working.
- **The landing page is prerendered.** `prerender-landing.mjs` renders the built
  page in headless Chrome, lifts the markup out of `#app`, and writes it back
  into `dist/index.html`. The served HTML therefore contains the whole page for
  a crawler or a visitor without scripting, and `main-landing.js` hydrates that
  markup rather than replacing it. It needs a Chrome binary, the same
  requirement `test:e2e` already has; without one it warns and leaves the page
  client-rendered rather than failing the build.

## Tests

```
npm test             830 unit tests over core/
npm run test:landing the landing page in headless Chrome: that the canvas
                    passes produced real pixels, that the deep links redirect,
                    that the wipe is keyboard operable, that nothing overflows
                    at 390px, and that no em-dash reached the page
```

Both suites need the browser only for the landing one; `npm test` is pure Node.

**Live previews are non-destructive.** A tool computes a candidate image and
hands it to the stage via `editor.setPreview(blob)`. The committed image is
never touched, so a preview cannot leak into the export or the undo stack.

**Tools that author mount a stage layer.** Text, stickers and frames draw over
the picture at image coordinates, inside the same box the crop overlay uses, so
they scale with the image exactly like everything else.

## Porting another tool

Read `PORTING.md`. It is the contract, and every tool in `src/lib/tools/`
follows it. The short version: copy `HalftoneTool.svelte`, put the maths in
`src/lib/core/`, add a registry entry, add a test.

## Notes for whoever works on this next

- **`tests/halftone.test.js` is unvalidated.** It came from an agent that was
  interrupted, and running it hangs and exhausts memory. Everything else was
  green. Run it last, or in isolation, until someone has read it.
- **The e2e suite covers the first ten tools only.** `tests/e2e.mjs` was
  written before the later ports and has no assertions for the filter, text or
  frame tools. It needs a browser to run, which is why it was not run here.
- **Legitimate dependencies:** `@imgly/background-removal` (the segmentation
  model, lazily imported) and `phosphor-svelte` (icons). No web fonts are
  loaded, which is why the text tools offer only generic and platform families.