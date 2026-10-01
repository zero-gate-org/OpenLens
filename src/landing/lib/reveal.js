/**
 * Scroll reveal, as a Svelte action.
 *
 * An IntersectionObserver rather than a scroll listener: a scroll handler runs
 * on every frame of every scroll, and this page also has a canvas pipeline
 * competing for the same main thread. An observer runs on the compositor's
 * schedule and costs nothing while nothing is moving.
 *
 * The hidden state lives in CSS behind a `.js` class, so this action only ever
 * has to take things *out* of hiding. If it never runs, the page is simply
 * visible.
 *
 * @param {HTMLElement} node
 * @param {{ delay?: number, margin?: string }} [options]
 */
export function reveal(node, options = {}) {
  if (
    typeof IntersectionObserver === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    node.dataset.shown = "";
    return {};
  }

  const delay = options.delay ?? 0;
  if (delay > 0) node.style.setProperty("--reveal-delay", `${delay}ms`);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        node.dataset.shown = "";
        // One shot. A section that has arrived does not leave again, so the
        // observer is released rather than kept alive for the rest of the page.
        observer.disconnect();
      }
    },
    {
      // Fire a little before the target's top edge reaches the bottom of the
      // viewport, so the movement is underway by the time it is properly in
      // view rather than starting late.
      rootMargin: options.margin ?? "0px 0px -10% 0px",
      threshold: 0.06,
    },
  );

  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
    },
  };
}

/**
 * Run `fn` the first time `node` comes near the viewport, then stop watching.
 *
 * Used for the effect tiles: a frame should not be computed until somebody is
 * close enough to see it, and once it has been computed there is no reason to
 * keep the observer alive.
 *
 * @param {HTMLElement} node
 * @param {() => void} fn
 * @param {{ margin?: string }} [options]
 */
export function onceVisible(node, fn, options = {}) {
  if (typeof IntersectionObserver === "undefined") {
    fn();
    return {};
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        fn();
      }
    },
    { rootMargin: options.margin ?? "320px 0px", threshold: 0 },
  );

  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
    },
  };
}

/**
 * Drive a 0 to 1 progress value on `--open` from the element's own position in
 * the viewport.
 *
 * Used for the card fan, so the arrangement assembles as the section scrolls in
 * rather than sitting there waiting to be pointed at.
 *
 * Two things make this cheap, which is why it is a rAF loop and not a scroll
 * listener:
 *
 *   1. An IntersectionObserver gates it. The loop only runs while the element is
 *      anywhere near the viewport, so an idle page costs nothing.
 *   2. It writes one custom property and never touches component state, so the
 *      Svelte tree is not re-rendered sixty times a second. The value is read by
 *      CSS transforms on the compositor.
 *
 * The frame is read with `getBoundingClientRect` inside the same callback that
 * writes, so there is no layout thrash from interleaved reads and writes.
 *
 * @param {HTMLElement} node
 * @param {{ property?: string, start?: number, end?: number }} [options]
 *   `start` and `end` are where the element's top edge should sit, as a fraction
 *   of the viewport height, for progress to be 0 and 1. `start: 1` is just below
 *   the fold, `end: 0.45` is halfway up the screen.
 */
export function scrollProgress(node, options = {}) {
  const property = options.property ?? "--open";
  // The viewport positions that map to progress 0 and 1. `from` is where the
  // element's top edge sits when it has not started moving and `to` is where it
  // has finished.
  const from = options.start ?? 1;
  const to = options.end ?? 0.45;

  // No observer, no loop. The element is simply shown at its settled value,
  // which is the same thing the animation ends at anyway.
  if (typeof IntersectionObserver === "undefined" || typeof requestAnimationFrame !== "function") {
    node.style.setProperty(property, "1");
    return {};
  }

  // Reduced motion: the fan appears already fanned. The arrangement is the
  // information; the travel is the decoration.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    node.style.setProperty(property, "1");
    return {};
  }

  let frame = 0;
  let running = false;

  function tick() {
    // The element's own top edge, as a fraction of the viewport. This is the
    // only measurement, and it is read once per frame immediately before the
    // one write, so nothing else can interleave and force a second layout.
    const top = node.getBoundingClientRect().top / window.innerHeight;
    const span = from - to;
    const progress = span > 0 ? (from - top) / span : 1;
    node.style.setProperty(property, Math.max(0, Math.min(1, progress)).toFixed(4));

    if (running) frame = requestAnimationFrame(tick);
  }

  const begin = () => {
    if (running) return;
    running = true;
    frame = requestAnimationFrame(tick);
  };

  const end = () => {
    running = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const observer = new IntersectionObserver(
    (entries) => {
      // Stop as soon as the element is below the fold or well past it, so the
      // loop is not running for a section that is nowhere near being read.
      const onScreen = entries.some(
        (entry) =>
          entry.isIntersecting ||
          (entry.boundingClientRect.top < window.innerHeight && entry.boundingClientRect.bottom > 0),
      );
      if (onScreen) begin();
      else end();
    },
    { rootMargin: "20% 0px 20% 0px" },
  );

  observer.observe(node);
  begin();

  return {
    destroy() {
      end();
      observer.disconnect();
    },
  };
}

/**
 * `await` the next animation frame, or the next timer if there is no rAF.
 *
 * The tile loop yields between frames so a burst of six canvas passes cannot
 * monopolise the main thread while somebody is scrolling towards them.
 *
 * @returns {Promise<void>}
 */
export function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}
