// Shared application state
export const state = {
  cropper: null,
  original: null,
  current: null,
  history: [],
  busy: false,
  fabricCanvas: null,
  fabricObjects: { background: null, text: null, foreground: null },
  fabricInitialized: false,
  textoverlayPreviewMode: false,
  textoverlayLayers: [],
  draggedLayerIndex: null,
  tvoForegroundReady: false,
};

export const MIME_BY_FORMAT = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
