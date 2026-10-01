/**
 * Photography for the landing page.
 *
 * Every picture on this page is a real photograph, and every one of them is
 * served from this origin rather than a placeholder service. That is not only
 * faster and more predictable: a page arguing that your files never need a
 * server should not phone a CDN to draw its own hero.
 *
 * The paths are relative on purpose. `vite.config.js` builds with
 * `base: "./"` so the whole site can be served from a subpath, and a relative
 * `src` resolves against the document in both cases.
 */

/** Hero: a rail yard with strong converging lines and a cool cast. */
export const HERO = "./landing/hero.jpg";

/**
 * The app icon, for the places that show the brand rather than a photograph.
 *
 * Exported as relative paths for the same reason the photographs are: the build
 * is `base: "./"`, so these resolve against the document from a root or a
 * subpath without a rebuild.
 */
export const MARK = {
  webp: "./mark.webp",
  png: "./mark.png",
};

/** The showcase: high-contrast red and white, so six passes all read. */
export const SHOWCASE = "./landing/showcase.jpg";

/** Type specimens. One photograph each, so four type treatments never read as
    four variations of the same picture. */
export const SPECIMENS = {
  curved: "./landing/architecture-desert.jpg",
  stroke: "./landing/man-portrait.jpg",
  pattern: "./landing/market-produce.jpg",
  stickers: "./landing/portrait.jpg",
  behind: "./landing/subject.jpg",
};

/**
 * Decode a photograph and hand back something `drawImage` will accept.
 *
 * `decode()` is what makes this fast rather than merely asynchronous: it
 * resolves when the bitmap is ready to paint, not when the bytes have landed,
 * so the first `getImageData` after this does not wait on a synchronous
 * decode. On a cache hit it is very nearly free.
 *
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
export function loadPhoto(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      // `decode()` rejects for a broken image, which `onload` alone would not
      // have caught, and it is the call that actually unblocks the canvas.
      if (typeof image.decode === "function") {
        image.decode().then(() => resolve(image), () => resolve(image));
      } else {
        resolve(image);
      }
    };
    image.onerror = () => reject(new Error("A photograph failed to load."));
    image.src = src;
  });
}

/**
 * Draw an image so it fills `width` x `height` with nothing stretched.
 *
 * `focusX` and `focusY` are the same idea as CSS `object-position`: 0.5 is
 * centred, 0 is the leading edge. They matter because the showcase tiles are
 * cropped to three different shapes and a centred crop of the red bus loses
 * the subject.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} image
 * @param {number} width
 * @param {number} height
 * @param {number} [focusX]
 * @param {number} [focusY]
 */
export function drawCover(ctx, image, width, height, focusX = 0.5, focusY = 0.5) {
  // `naturalWidth` is the intrinsic size and `width` the layout size, which is
  // the right order here: a photograph scaled by CSS must be cropped at its
  // own resolution or the cover maths is done in the wrong units.
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;

  const scale = Math.max(width / iw, height / ih);
  const dw = iw * scale;
  const dh = ih * scale;

  ctx.drawImage(image, (width - dw) * focusX, (height - dh) * focusY, dw, dh);
}

/** Alt text for a decorative photograph used behind live content. */
export const DECORATIVE = "";
