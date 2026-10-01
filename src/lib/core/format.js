/** Format inference, filename handling and byte formatting. */

/** Formats this app can re-encode to. Anything else is re-encoded to PNG. */
export const MIME_BY_FORMAT = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const ENCODABLE_FORMATS = ["png", "jpeg", "webp"];

export const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/bmp",
  "image/tiff",
];

const MIME_TO_FORMAT = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/pjpeg": "jpeg",
  "image/webp": "webp",
  "image/png": "png",
  "image/apng": "png",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "image/tiff": "tiff",
};

const EXT_TO_FORMAT = {
  jpg: "jpeg",
  jpeg: "jpeg",
  jfif: "jpeg",
  webp: "webp",
  png: "png",
  apng: "png",
  avif: "avif",
  gif: "gif",
  bmp: "bmp",
  tif: "tiff",
  tiff: "tiff",
};

const KNOWN_EXTENSIONS = new Set(Object.keys(EXT_TO_FORMAT));

/**
 * The format an image actually is, not the format we would prefer to write.
 *
 * This matters: a file opened as AVIF must keep its own name and survive a
 * download untouched, rather than being labelled `.png` while still holding
 * AVIF bytes. The first *edit* is where it becomes a format we can encode.
 *
 * @returns {string}
 */
export function inferFormat(mime, name = "") {
  const byMime = MIME_TO_FORMAT[String(mime || "").toLowerCase()];
  if (byMime) return byMime;

  const ext = name.includes(".") ? name.split(".").pop() : "";
  return EXT_TO_FORMAT[ext.toLowerCase()] ?? "png";
}

/** Format used when this app has to write the pixels itself. */
export function outputFormatFor(format) {
  return MIME_BY_FORMAT[format] ? format : "png";
}

export function renameExtension(name, format) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  const ext = format === "jpeg" ? "jpg" : format;
  return `${base}.${ext}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** True when a filename or MIME type looks like an image we can open. */
export function looksLikeImage(file) {
  if (!file) return false;
  if (String(file.type || "").startsWith("image/")) return true;
  // Some browsers report an empty type for less common formats.
  const ext = file.name?.includes(".") ? file.name.split(".").pop() : "";
  return KNOWN_EXTENSIONS.has(String(ext || "").toLowerCase());
}
