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

This project is fully static and GitHub Pages friendly. It requires only the core files:

- `index.html`
- `styles.css`
- `app.js`

## Notes

- **Dependencies**: `CropperJS`, `Pica`, and `Fabric.js` are loaded via CDN for powerful editing capabilities.
- **AI Integration**: Background removal uses `@imgly/background-removal` via CDN, downloading model files to the browser cache on first use.
- **Layer Compositing**: Text Behind Object uses Fabric.js for draggable layers, font controls, and real-time preview.
- **Data Privacy**: All processing happens client-side. Your images are never uploaded to any server.

## License

This project is licensed under the **AGPLv3**. See the [LICENSE](LICENSE) file for details.
