# OpenLens

Static browser-based image editor built with plain HTML, CSS, and JavaScript.

## Features

- Crop with interactive selection
- Resize with aspect-ratio lock
- Rotate by 90 degrees or a custom angle
- Convert between PNG, JPEG, and WebP
- Compress JPEG and WebP with a quality slider
- Remove backgrounds locally in the browser with IMG.LY
- Download processed files without uploading images to a server

## Deployment

This project is GitHub Pages friendly. It only needs these files:

- `index.html`
- `styles.css`
- `app.js`

## Notes

- `CropperJS` and `Pica` are loaded from CDN for browser-side editing.
- Background removal uses `@imgly/background-removal` via CDN and downloads its model files into the browser cache on first use.
- Images stay on the user's machine unless they explicitly choose to upload them somewhere else.
