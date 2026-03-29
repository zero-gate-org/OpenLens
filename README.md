<p align="center">
  <img src="OpenLens.png" alt="OpenLens Logo" width="120" height="120">
</p>

<h1 align="center">OpenLens</h1>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3">
  </a>
  <img src="https://img.shields.io/badge/Status-Active-success.svg" alt="Status: Active">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/html5-%23E34F26.svg?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/css3-%231572B6.svg?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3">
  <img src="https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E" alt="JavaScript">
</p>

<p align="center">
  <strong>Static browser-based image editor built with plain HTML, CSS, and JavaScript.</strong>
</p>

---

##  Features

- **Crop & Resize**: Interactive selection with aspect-ratio lock.
- **Rotate**: Rotate by 90 degrees or fine-tune with a custom angle.
- **Convert**: Seamlessly switch between PNG, JPEG, and WebP formats.
- **Compress**: Optimize JPEG and WebP images with a quality slider.
- **Privacy-First BG Remove**: Remove backgrounds locally in the browser with IMG.LY's on-device AI.
- **Text Behind Object**: Layer text behind a foreground object for cinematic compositing (powered by Fabric.js).
- **No Uploads**: Images stay on your machine—zero latency, enhanced security.

##  Deployment

This project is fully static and GitHub Pages friendly. Current core runtime files are:

- `index.html` (landing route)
- `editor.html` (editor route)
- `editor-app.js` (editor bootstrap)
- `app.js` (app init)
- `styles.css`
- `modules/**`
- `ui/**`

## Notes

- **Dependencies**: `CropperJS`, `Pica`, and `Fabric.js` are loaded via CDN for powerful editing capabilities.
- **AI Integration**: Background removal uses `@imgly/background-removal` via CDN, downloading model files to the browser cache on first use.
- **Layer Compositing**: Text Behind Object uses Fabric.js for draggable layers, font controls, and real-time preview.
- **Data Privacy**: All processing happens client-side. Your images are never uploaded to any server.

---

## Contributor Guide: Routing, Structure, And Responsibilities

### Routing Strategy (No Confusion)

OpenLens uses two static HTML routes:

1. `index.html`
- Landing page only.
- Contains tool cards and project marketing sections.
- Tool cards navigate to editor route using query params:
  - Example: `editor.html?tool=glitch`

2. `editor.html`
- Editor shell only.
- Contains topbar, canvas/dropzone, and tool switcher.
- Sidebar panel markup is mounted by JS at startup.

Editor route behavior:

- Tool selection is encoded in `?tool=...`.
- Changing tools updates URL with `history.pushState`/`replaceState`.
- No full page reload on tool switch.
- In-memory image + history state remains intact.

Back navigation behavior:

- Editor back button navigates to `index.html`.

`file://` behavior:

- Gracefully handled with a visible note.
- Primary supported usage is static hosting (`GitHub Pages` or local HTTP server).

### Runtime Startup Flow

Editor startup sequence:

1. `editor.html` loads `editor-app.js`
2. `editor-app.js` mounts sidebar panels into `.sidebar-panels`
3. `editor-app.js` imports `app.js`
4. `app.js` initializes file handlers, tool listeners, routing, and UI sync

### Folder-Level Project Structure

```text
.
├─ index.html                  # Landing route
├─ editor.html                 # Editor route shell
├─ editor-app.js               # Mount panels, then load app.js
├─ app.js                      # Main app initialization
├─ styles.css                  # Shared/global CSS
├─ modules/
│  ├─ core/
│  │  ├─ state.js              # Shared runtime state
│  │  ├─ dom.js                # Central DOM refs
│  │  ├─ utils.js              # Helper utilities
│  │  └─ messages.js           # Status/help messages
│  ├─ tools/                   # Tool logic implementations
│  │  ├─ crop.js
│  │  ├─ resize.js
│  │  ├─ rotate.js
│  │  ├─ convert.js
│  │  ├─ ...
│  │  ├─ curvedtext.js         # Curved text effect logic
│  │  ├─ stroketext.js         # Stroke text effect logic
│  │  ├─ stickers.js           # Stickers logic
│  │  ├─ svg-stickers.js       # Sticker SVG dataset
│  │  ├─ tool-runtime.js       # Facade for tool runtime orchestration
│  │  └─ runtime/
│  │     ├─ activate-runtime.js # Tool activation/deactivation lifecycle
│  │     ├─ render-runtime.js   # Tool render-time lifecycle after image updates
│  │     └─ shared.js           # Shared runtime helpers
│  ├─ editor-panels/
│  │  ├─ index.js              # Registry: tool -> panel markup module
│  │  └─ mount.js              # Injects panel markup into editor shell
│  ├─ file-handler.js          # File load/commit/undo/reset/download
│  └─ ui-controller.js         # Route/view sync and runtime delegation
├─ ui/
│  ├─ <tool-folder>/panel.js   # Panel markup module for that tool
│  ├─ <tool-folder>/*.css      # Tool-specific styles
│  └─ ...
└─ backups/                    # Local snapshots before major refactors
```

### What `ui/*/panel.js` Does

Each tool folder in `ui/` has a `panel.js` file.

Purpose:

- Exports the sidebar UI markup for that tool.
- Used by `modules/editor-panels/index.js` for panel mounting.

It does not contain tool behavior logic.

Tool behavior lives in `modules/tools/*.js`.

### Separation Of Responsibilities

- `ui/*/panel.js`: Tool panel markup
- `ui/*/*.css`: Tool panel visual styling
- `modules/tools/*.js`: Effect logic and processing
- `modules/tools/runtime/*.js`: Tool lifecycle orchestration (activate/render/deactivate)
- `modules/tools/tool-runtime.js`: Stable facade imported by UI controller
- `modules/ui-controller.js`: Tool switch UI + route syncing + runtime delegation
- `modules/file-handler.js`: File operations + history changes

### Adding A New Tool (Contributor Checklist)

1. Add logic in `modules/tools/<tool>.js`
2. Add panel markup in `ui/<tool>/panel.js`
3. Add panel CSS in `ui/<tool>/<tool>.css` if needed
4. Register panel in `modules/editor-panels/index.js`
5. Add switch option in `editor.html`
6. Hook listener init in `app.js`
7. Hook tool lifecycle in `modules/tools/runtime/activate-runtime.js` and `modules/tools/runtime/render-runtime.js`
8. Update `modules/ui-controller.js` only if route or tool switch UX behavior changes

### Local Development

Run a static server:

```bash
python3 -m http.server 4173
```

Open:

- `http://127.0.0.1:4173/index.html`
- `http://127.0.0.1:4173/editor.html?tool=crop`

### Static Hosting Compatibility

- Designed for GitHub Pages and local HTTP static servers.
- No build step required.
- Keep relative paths and avoid server-side routing assumptions.

## License

This project is licensed under the **AGPLv3**. See the [LICENSE](LICENSE) file for details.
