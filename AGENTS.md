# OpenLens Agent Guide

This file is for coding agents working on OpenLens.

Use it as the source of truth for where code should go, how routes work, and how to add tools/features without regressions.

## 1) Project Constraints (Do Not Break)

- Keep strict static stack: HTML + CSS + vanilla JS.
- No frameworks, no bundlers, no server runtime assumptions.
- Must remain compatible with GitHub Pages and local static HTTP servers.
- Do not introduce HTML fragment fetch loaders for core UI (previously caused regressions).
- Preserve editor in-memory state on tool switches (no forced re-upload).

## 2) Route Strategy

OpenLens uses two static pages:

- `index.html`
  - Landing route only.
  - Tool cards navigate to `editor.html?tool=<toolId>`.

- `editor.html`
  - Editor route shell only.
  - Includes topbar, dropzone/canvas area, tool switcher, and `.sidebar-panels` mount point.
  - Loads `editor-app.js`.

Editor startup:

1. `editor-app.js` mounts panel markup into `.sidebar-panels`.
2. `editor-app.js` then imports `app.js`.
3. `app.js` initializes handlers/listeners.
4. `modules/ui-controller.js` syncs tool selection with `?tool=...`.

Back navigation:

- Editor back button returns to `index.html`.

## 3) Folder Ownership (What Goes Where)

### Root files

- `index.html`: landing UI only.
- `editor.html`: editor shell only.
- `editor-app.js`: panel mount bootstrap for editor.
- `app.js`: app initialization and tool listener wiring.
- `styles.css`: global styling.

### `modules/core/`

- `state.js`: shared runtime state.
- `dom.js`: DOM references.
- `utils.js`: common helpers.
- `messages.js`: status text/messages.

### `modules/tools/`

- All tool logic and processing code.
- Includes heavy logic modules and optional worker files.
- Examples: crop/resize/rotate/etc plus `curvedtext.js`, `stroketext.js`, `stickers.js`, `svg-stickers.js`.

### `modules/editor-panels/`

- `index.js`: registry mapping `toolId -> panel markup module`.
- `mount.js`: injects panel markup into `.sidebar-panels`.

### `ui/<tool>/`

- `panel.js`: panel markup for tool sidebar UI.
- `<tool>.css`: tool-specific styles.
- Keep UI presentation here, not processing logic.

### `backups/`

- Snapshot folder before major refactors.
- Naming pattern: `backups/YYYY-MM-DD-<short-topic>/`.

## 4) Adding A New Tool (Required Checklist)

When creating a new tool `newtool`, do all of the following:

1. Add tool logic file:
   - `modules/tools/newtool.js`
   - Optional worker: `modules/tools/newtool-worker.js`

2. Add panel UI files:
   - `ui/newtool/panel.js`
   - `ui/newtool/newtool.css` (if needed)

3. Register panel module:
   - Update `modules/editor-panels/index.js`
   - Add import + `PANEL_MARKUP_BY_TOOL` entry + `PANEL_ORDER` entry.

4. Add tool switch option:
   - Update `<select id="tool-switcher">` in `editor.html`.

5. Wire app init:
   - Import and call `initNewToolListeners(...)` in `app.js`.

6. Wire activation/deactivation:
   - Update `modules/ui-controller.js` in `activateTool(...)` flow.

7. Add DOM refs (if needed):
   - Add element refs in `modules/core/dom.js`.

8. Add styles:
   - Ensure the CSS is linked in `index.html` and `editor.html` if globally required.

## 5) Feature Work (Non-Tool)

- Routing changes: `modules/ui-controller.js`, `editor.html`, `index.html`.
- File/history changes: `modules/file-handler.js`.
- Shared state changes: `modules/core/state.js`.
- Visual-only changes: `styles.css` or `ui/<tool>/*.css`.

## 6) Regression-Safe Rules

Before major edits:
- Do not revert unrelated user changes.

After edits, verify at minimum:

1. Landing tool card opens editor with correct active tool.
2. Tool switcher changes active panel/tool without clearing current image.
3. Undo/reset/download still function.
4. Editor URL query param updates and back/forward behavior is sane.
5. Works under local HTTP server and GitHub Pages-style hosting.

If using `file://`:

- Handle limitations gracefully with user-visible notice.
- Do not degrade hosted behavior.

## 7) Things To Avoid

- Do not move tool logic into `ui/`.
- Do not put tool panel markup into `modules/tools/`.
- Do not mix landing content into `editor.html`.
- Do not add runtime dependencies that require a build step.
- Do not rely on absolute paths that break on GitHub Pages.

## 8) Quick Dev Run

```bash
python3 -m http.server 4173
```

Open:

- `http://127.0.0.1:4173/index.html`
- `http://127.0.0.1:4173/editor.html?tool=crop`

## 9) Documentation Maintenance

When architecture/routing changes, update both:

- `README.md`
- `agents.md`

Keep these two documents aligned so contributors and coding agents follow the same structure.