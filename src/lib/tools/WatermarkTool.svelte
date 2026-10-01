<script>
  /**
   * Watermark: stamp text or an image over the picture, once or tiled.
   *
   * This is a composite, not a per-pixel filter, so a pass is cheap: the source
   * is drawn once and the mark is drawn on top of it, a few hundred drawImage
   * calls at most. There is no pixel loop here, so no row-band yielding and no
   * worker. The only awaits are the source decode and the encode, both of
   * which the browser does for us.
   *
   * Every number that decides where the mark lands lives in
   * `core/watermarklayout.js`, which takes numbers and has no DOM, so placement,
   * margins and tiling are unit tested without a canvas.
   */
  import { untrack } from "svelte";

  import { editor } from "../state/editor.svelte.js";
  import { context2d, createCanvas, loadImage } from "../core/image.js";
  import { canvasToImageBlob, debounce } from "../core/pixels.js";
  import {
    POSITIONS,
    autoSizes,
    containSize,
    fontStack,
    placeMark,
    scaleSize,
    textBox,
    tileOrigins,
    tilePitch,
  } from "../core/watermarklayout.js";

  import Button from "../components/controls/Button.svelte";
  import CheckField from "../components/controls/CheckField.svelte";
  import ColorField from "../components/controls/ColorField.svelte";
  import NumberField from "../components/controls/NumberField.svelte";
  import Segmented from "../components/controls/Segmented.svelte";
  import SelectField from "../components/controls/SelectField.svelte";
  import SliderField from "../components/controls/SliderField.svelte";

  const MODES = [
    { value: "text", label: "Text" },
    { value: "image", label: "Image" },
    { value: "tiled", label: "Tiled" },
  ];

  const TILE_SOURCES = [
    { value: "text", label: "Text" },
    { value: "image", label: "Image" },
  ];

  const ALIGNS = [
    { value: "left", label: "Left" },
    { value: "center", label: "Centre" },
    { value: "right", label: "Right" },
  ];

  const BLENDS = [
    { value: "source-over", label: "Normal" },
    { value: "multiply", label: "Multiply" },
    { value: "screen", label: "Screen" },
    { value: "overlay", label: "Overlay" },
    { value: "soft-light", label: "Soft light" },
  ];

  /**
   * Fonts the browser can actually draw.
   *
   * The app loads no web fonts, so the legacy list (Inter, Oswald, Playfair,
   * Dancing Script) rendered as the fallback on every machine and the control
   * lied about what it was setting. These are either generic or ship with the
   * platform, and each one is here because it looks different from the others.
   */
  const FONTS = [
    { value: "system-ui", label: "System" },
    { value: "Georgia", label: "Georgia" },
    { value: "Times New Roman", label: "Times New Roman" },
    { value: "Courier New", label: "Courier New" },
    { value: "Impact", label: "Impact" },
    { value: "Verdana", label: "Verdana" },
    { value: "Trebuchet MS", label: "Trebuchet MS" },
    { value: "Comic Sans MS", label: "Comic Sans MS" },
  ];

  const ANCHOR_TEXT = {
    "top-left": { label: "Top left", glyph: "↖" },
    "top-center": { label: "Top centre", glyph: "↑" },
    "top-right": { label: "Top right", glyph: "↗" },
    "middle-left": { label: "Middle left", glyph: "←" },
    center: { label: "Centre", glyph: "●" },
    "middle-right": { label: "Middle right", glyph: "→" },
    "bottom-left": { label: "Bottom left", glyph: "↙" },
    "bottom-center": { label: "Bottom centre", glyph: "↓" },
    "bottom-right": { label: "Bottom right", glyph: "↘" },
  };

  const ANCHORS = POSITIONS.map((id) => ({ id, ...ANCHOR_TEXT[id] }));

  /**
   * Starting looks. Sizes are not in here on purpose: a preset picks a
   * character, and the sizes follow the width of the image it lands on.
   */
  const PRESETS = [
    {
      name: "Corner",
      type: "text",
      text: "© Your Name",
      family: "system-ui",
      bold: false,
      italic: false,
      color: "#ffffff",
      opacity: 35,
      rotation: 0,
      position: "bottom-right",
      blend: "source-over",
      outline: false,
    },
    {
      name: "Stamp",
      type: "text",
      text: "SAMPLE",
      family: "Impact",
      bold: true,
      italic: false,
      color: "#ff3b30",
      opacity: 45,
      rotation: -20,
      position: "center",
      blend: "overlay",
      outline: true,
      outlineColor: "#ffffff",
    },
    {
      name: "Tiled",
      type: "tiled",
      tileSource: "text",
      text: "© Your Name",
      family: "system-ui",
      bold: false,
      italic: false,
      color: "#ffffff",
      opacity: 15,
      rotation: -30,
      blend: "source-over",
      outline: false,
    },
  ];

  const DEFAULTS = {
    type: "text",
    text: "© Your Name",
    family: "system-ui",
    fontSize: 48,
    bold: false,
    italic: false,
    align: "center",
    color: "#ffffff",
    outline: false,
    outlineColor: "#000000",
    outlineWidth: 2,
    logoScale: 15,
    tileSource: "text",
    tileSize: 200,
    tileGap: 20,
    opacity: 50,
    rotation: 0,
    blend: "source-over",
    position: "center",
    offsetX: 0,
    offsetY: 0,
    margin: 5,
  };

  let type = $state(DEFAULTS.type);
  let text = $state(DEFAULTS.text);
  let family = $state(DEFAULTS.family);
  let fontSize = $state(DEFAULTS.fontSize);
  let bold = $state(DEFAULTS.bold);
  let italic = $state(DEFAULTS.italic);
  let align = $state(DEFAULTS.align);
  let color = $state(DEFAULTS.color);
  let outline = $state(DEFAULTS.outline);
  let outlineColor = $state(DEFAULTS.outlineColor);
  let outlineWidth = $state(DEFAULTS.outlineWidth);
  let logoScale = $state(DEFAULTS.logoScale);
  let tileSource = $state(DEFAULTS.tileSource);
  let tileSize = $state(DEFAULTS.tileSize);
  let tileGap = $state(DEFAULTS.tileGap);
  let opacity = $state(DEFAULTS.opacity);
  let rotation = $state(DEFAULTS.rotation);
  let blend = $state(DEFAULTS.blend);
  let position = $state(DEFAULTS.position);
  let offsetX = $state(DEFAULTS.offsetX);
  let offsetY = $state(DEFAULTS.offsetY);
  let margin = $state(DEFAULTS.margin);

  /** The chosen logo, or null. The decoded element is never URL backed. */
  let logo = $state(null);
  let logoError = $state(null);
  let logoInput = $state(null);

  const source = $derived(editor.current);
  const sizes = $derived(source ? autoSizes(source.width) : null);

  const usesText = $derived(type === "text" || (type === "tiled" && tileSource === "text"));
  const usesImage = $derived(type === "image" || (type === "tiled" && tileSource === "image"));
  const missingLogo = $derived(usesImage && !logo);
  const emptyText = $derived(usesText && text.trim() === "");
  const nothingToDraw = $derived(missingLogo || emptyText);
  const offsetLimit = $derived(Math.max(64, source?.width ?? 0, source?.height ?? 0));

  /**
   * Every control, as one string.
   *
   * The preview effect depends on this rather than on a list of `void` reads,
   * so a control cannot be added and then forgotten. The image is deliberately
   * not in it: see the control effect for why.
   */
  const controlKey = $derived(
    [
      type, text, family, fontSize, bold, italic, align, color,
      outline, outlineColor, outlineWidth,
      logo?.name, logo?.width, logo?.height, logoScale,
      tileSource, tileSize, tileGap,
      opacity, rotation, blend, position, offsetX, offsetY, margin,
    ].join("|"),
  );

  // -------------------------------------------------------------------
  // Logo
  // -------------------------------------------------------------------

  async function onPickLogo(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    try {
      const image = await loadImage(file);
      // An SVG with only a viewBox reports no size, and would stamp nothing.
      if (!image.naturalWidth || !image.naturalHeight) {
        throw new Error("That file reports no size.");
      }
      logo = { name: file.name, width: image.naturalWidth, height: image.naturalHeight, image };
      logoError = null;
    } catch (error) {
      console.error(error);
      logo = null;
      logoError = "That file could not be read as an image.";
    }
  }

  function clearLogo() {
    logo = null;
    logoError = null;
  }

  // -------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------

  /**
   * A one pixel context used only to measure text.
   *
   * The font is set on it before every measurement, because a measurement
   * taken with the wrong font is the width of some other mark.
   */
  let scratch = null;

  function measureRun(cfg, value) {
    if (!scratch) scratch = context2d(createCanvas(1, 1));
    scratch.font = fontStack(cfg.family, cfg, cfg.fontSize);
    return scratch.measureText(value).width;
  }

  /** The mark at its natural size, before any placement. */
  function markSize(cfg) {
    if (cfg.drawsImage) {
      return scaleSize({ w: cfg.logoWidth, h: cfg.logoHeight }, cfg.logoScale);
    }
    return textBox(cfg.text, cfg.fontSize, (value) => measureRun(cfg, value));
  }

  /** Draw one mark, centred on the origin, with the current font and blend. */
  function drawMark(ctx, cfg, w, h) {
    if (cfg.drawsImage) {
      ctx.drawImage(cfg.logo, -w / 2, -h / 2, w, h);
      return;
    }

    // The box may have been scaled down to fit the frame, so the glyphs are
    // scaled with it rather than squeezed into it.
    const fit = cfg.mark.h > 0 ? h / cfg.mark.h : 1;
    ctx.font = fontStack(cfg.family, cfg, Math.max(1, Math.round(cfg.fontSize * fit)));
    ctx.textAlign = cfg.align;
    ctx.textBaseline = "middle";
    const x = cfg.align === "left" ? -w / 2 : cfg.align === "right" ? w / 2 : 0;

    if (cfg.outline) {
      ctx.strokeStyle = cfg.outlineColor;
      ctx.lineWidth = cfg.outlineWidth;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeText(cfg.text, x, 0);
    }

    ctx.fillStyle = cfg.color;
    ctx.fillText(cfg.text, x, 0);
  }

  function paintSingle(ctx, cfg) {
    const box = placeMark(
      { position: cfg.position, margin: cfg.margin, offsetX: cfg.offsetX, offsetY: cfg.offsetY },
      cfg.mark,
      cfg.frame,
    );

    ctx.save();
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    ctx.rotate((cfg.rotation * Math.PI) / 180);
    drawMark(ctx, cfg, box.w, box.h);
    ctx.restore();
  }

  function paintTiled(ctx, cfg) {
    const pitch = tilePitch(cfg.tileSize, cfg.tileGap);
    // A mark wider than its own cell would overlap the next one, so the cell
    // contains it the same way the frame contains a single mark.
    const cell = containSize(cfg.mark, { w: pitch, h: pitch });
    if (cell.w < 1 || cell.h < 1) return;

    for (const origin of tileOrigins(pitch, cfg.frame.width, cfg.frame.height)) {
      ctx.save();
      ctx.translate(origin.x + pitch / 2, origin.y + pitch / 2);
      ctx.rotate((cfg.rotation * Math.PI) / 180);
      drawMark(ctx, cfg, cell.w, cell.h);
      ctx.restore();
    }
  }

  function paint(ctx, cfg) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, cfg.opacity));
    ctx.globalCompositeOperation = cfg.blend;

    if (cfg.type === "tiled") paintTiled(ctx, cfg);
    else paintSingle(ctx, cfg);

    ctx.restore();
  }

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  /** The decoded source, reused across every control change. */
  let cache = { url: null, image: null, generation: 0 };
  let previewRun = 0;

  async function decodedSource(image, generation) {
    if (cache.url === image.url && cache.image) return cache.image;
    const decoded = await loadImage(image.blob);
    if (generation !== cache.generation) return null;
    cache = { url: image.url, image: decoded, generation };
    return decoded;
  }

  /**
   * The control state, read once so a frame is always one consistent set of
   * values, with the frame and the mark measured in.
   */
  function config(image) {
    const wantsImage = type === "image" || (type === "tiled" && tileSource === "image");
    const cfg = {
      type,
      frame: { width: image.width, height: image.height },
      text,
      family,
      fontSize,
      bold,
      italic,
      align,
      color,
      outline,
      outlineColor,
      outlineWidth,
      logo: logo?.image ?? null,
      logoWidth: logo?.width ?? 0,
      logoHeight: logo?.height ?? 0,
      logoScale,
      tileSource,
      tileSize,
      tileGap,
      opacity: opacity / 100,
      rotation,
      blend,
      position,
      offsetX,
      offsetY,
      margin,
      // A tiled mark falls back to the text when there is no logo, which is
      // what picking "repeat the text" asked for. A single mark does not:
      // choosing Image and then choosing no file has to draw nothing at all,
      // not quietly stamp the text that is still sitting in the field.
      drawsImage: wantsImage && !!logo,
    };
    cfg.mark = markSize(cfg);
    return cfg;
  }

  /** True when this configuration puts anything on the frame at all. */
  function willDraw(cfg) {
    if (cfg.drawsImage) return true;
    if (cfg.type === "image") return false;
    return cfg.text.trim() !== "";
  }

  async function renderCanvas(image, cfg, generation) {
    const decoded = await decodedSource(image, generation);
    if (!decoded || generation !== cache.generation) return null;

    const canvas = createCanvas(image.width, image.height);
    const ctx = context2d(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded, 0, 0, image.width, image.height);
    paint(ctx, cfg);
    return canvas;
  }

  // -------------------------------------------------------------------
  // Live preview
  // -------------------------------------------------------------------

  /**
   * The URL of the image this tool last committed, or null.
   *
   * A preview computed from it is indistinguishable from the committed image,
   * so it is suppressed until a control changes. This also covers a queued
   * recompute: a debounce that fires just after Apply would otherwise rebuild
   * the image we already wrote and park a "Preview" badge on top of it.
   */
  let committedUrl = $state(null);

  const recompute = debounce(async () => {
    const image = editor.current;
    if (!image || (committedUrl && image.url === committedUrl)) {
      editor.clearPreview();
      return;
    }

    const run = ++previewRun;
    const generation = cache.generation;
    const isStale = () => run !== previewRun || generation !== cache.generation;

    editor.previewBusy = true;
    try {
      const cfg = config(image);
      // Nothing to stamp. Re-encoding the source would be a full round trip
      // to produce an identical picture, and would badge the stage for it.
      if (!willDraw(cfg)) {
        editor.clearPreview();
        return;
      }

      const canvas = await renderCanvas(image, cfg, generation);
      if (!canvas || isStale()) return;

      const blob = await canvasToImageBlob(canvas, image);
      if (isStale()) return;
      await editor.setPreview(blob);
    } catch (error) {
      console.error(error);
      if (!isStale()) editor.clearPreview();
    } finally {
      // Only the newest run owns the flag: a superseded one that cleared it
      // would re-enable Apply while its replacement is still writing.
      if (run === previewRun) editor.previewBusy = false;
    }
  });

  // Control changes recompute.
  $effect(() => {
    // The image is read only to be in scope, and deliberately untracked.
    // Depending on it would mean every commit re-runs a full composite to
    // reproduce the pixels this tool just wrote, leaving a redundant "Preview"
    // badge sitting on top of the committed image.
    untrack(() => editor.current);
    // Moving a control is the one thing that re-arms the preview after Apply.
    committedUrl = null;
    void controlKey;
    recompute();
  });

  // A different image, or a different tool, means the cached decode describes
  // something that is no longer on the stage. Cancelling the pending render
  // matters as much: a preview that fires after this tool has been left would
  // land on the stage under somebody else's controls.
  $effect(() => {
    const key = `${editor.current?.url ?? ""}|${editor.tool}`;
    void key;
    return () => {
      recompute.cancel();
      cache = { url: null, image: null, generation: cache.generation + 1 };
    };
  });

  // Seed on activation, and whenever a genuinely new image arrives.
  // `editor.epoch` moves only on open and discard, never on a commit, so this
  // cannot fire for output this tool produced itself.
  $effect(() => {
    const active = editor.tool === "watermark";
    void editor.epoch;
    if (!active) return;
    committedUrl = null;
    untrack(() => {
      const image = editor.current;
      if (!image) return;
      const next = autoSizes(image.width);
      // Only sizes the operator has never touched follow the image. A value
      // they have set is theirs, however small or large it is.
      if (fontSize === DEFAULTS.fontSize) fontSize = next.fontSize;
      if (tileSize === DEFAULTS.tileSize) tileSize = next.tileSize;
      if (logoScale === DEFAULTS.logoScale) logoScale = next.imageScale;
      recompute.flush();
    });
  });

  // -------------------------------------------------------------------
  // Presets
  // -------------------------------------------------------------------

  function matches(preset) {
    const next = sizes ?? { fontSize: DEFAULTS.fontSize, tileSize: DEFAULTS.tileSize };
    if (preset.type !== type) return false;
    if (preset.text !== text || preset.family !== family) return false;
    if (preset.opacity !== opacity || preset.rotation !== rotation) return false;
    if (preset.blend !== blend) return false;
    if (preset.bold !== bold || preset.italic !== italic) return false;
    if (preset.outline !== outline) return false;
    if (preset.outline && preset.outlineColor !== outlineColor) return false;
    if (preset.type === "text" && preset.position !== position) return false;
    if (preset.type === "tiled" && preset.tileSource !== tileSource) return false;
    // Presets carry no size: they follow the image, so they match whatever
    // the image width has just made the right size.
    if (preset.type === "text" && fontSize !== next.fontSize) return false;
    if (preset.type === "tiled" && tileSize !== next.tileSize) return false;
    return true;
  }

  const activePreset = $derived(PRESETS.findIndex(matches));

  function usePreset(preset) {
    const next = sizes ?? { fontSize: DEFAULTS.fontSize, tileSize: DEFAULTS.tileSize };
    type = preset.type;
    text = preset.text;
    family = preset.family;
    bold = preset.bold;
    italic = preset.italic;
    color = preset.color;
    opacity = preset.opacity;
    rotation = preset.rotation;
    blend = preset.blend;
    outline = preset.outline;
    outlineColor = preset.outlineColor ?? DEFAULTS.outlineColor;
    fontSize = next.fontSize;

    if (preset.type === "text") {
      position = preset.position;
    } else {
      tileSource = preset.tileSource;
      tileSize = next.tileSize;
    }
  }

  function autoSize() {
    if (!sizes) return;
    fontSize = sizes.fontSize;
    tileSize = sizes.tileSize;
    logoScale = sizes.imageScale;
  }

  function reset() {
    type = DEFAULTS.type;
    text = DEFAULTS.text;
    family = DEFAULTS.family;
    fontSize = sizes?.fontSize ?? DEFAULTS.fontSize;
    bold = DEFAULTS.bold;
    italic = DEFAULTS.italic;
    align = DEFAULTS.align;
    color = DEFAULTS.color;
    outline = DEFAULTS.outline;
    outlineColor = DEFAULTS.outlineColor;
    outlineWidth = DEFAULTS.outlineWidth;
    logoScale = sizes?.imageScale ?? DEFAULTS.logoScale;
    tileSource = DEFAULTS.tileSource;
    tileSize = sizes?.tileSize ?? DEFAULTS.tileSize;
    tileGap = DEFAULTS.tileGap;
    opacity = DEFAULTS.opacity;
    rotation = DEFAULTS.rotation;
    blend = DEFAULTS.blend;
    position = DEFAULTS.position;
    offsetX = DEFAULTS.offsetX;
    offsetY = DEFAULTS.offsetY;
    margin = DEFAULTS.margin;
    logo = null;
    logoError = null;
  }

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------

  /**
   * Apply is blocked while a preview is still moving.
   *
   * A preview render and a commit render share the decode cache, so starting a
   * commit while a preview is mid-flight has one of the two awaiting a promise
   * the other abandoned. Beyond the corruption, "apply" during a moving preview
   * is not a request anyone can mean.
   */
  const locked = $derived(editor.busy || editor.previewBusy || !source);

  async function apply() {
    if (!source || locked) return;
    // Drop anything the run-up to this click queued, so no render is in flight.
    recompute.cancel();

    const image = source;

    await editor.run("Watermark", async (report) => {
      report("Decoding", 0.2);
      const cfg = config(image);
      if (!willDraw(cfg)) throw new Error("There is nothing to stamp yet.");

      report("Stamping the watermark", 0.55);
      const canvas = await renderCanvas(image, cfg, cache.generation);
      if (!canvas) throw new Error("That render was cancelled before it finished.");

      report("Encoding", 0.9);
      const blob = await canvasToImageBlob(canvas, image);
      await editor.commit(blob, "Watermark", image.name);

      // The committed frame is the result now, so the preview is redundant
      // and a queued recompute must not rebuild the image we just wrote.
      committedUrl = editor.current?.url ?? null;
      recompute.cancel();
      editor.clearPreview();
    });
  }
</script>

<div class="tool">
  <section class="tool-section">
    <Segmented
      name="watermark-type"
      label="Mark"
      options={MODES}
      value={type}
      disabled={editor.busy}
      onvalue={(next) => (type = next)}
    />
  </section>

  {#if usesText}
    <section class="tool-section">
      <div class="field">
        <label class="name" for="watermark-text">Text</label>
        <input
          id="watermark-text"
          type="text"
          maxlength="200"
          value={text}
          placeholder="© Your Name"
          disabled={editor.busy}
          oninput={(event) => (text = event.currentTarget.value)}
        />
      </div>

      <SelectField
        id="watermark-font"
        label="Font"
        value={family}
        options={FONTS}
        disabled={editor.busy}
        onvalue={(next) => (family = next)}
      />

      <SliderField
        id="watermark-font-size"
        label="Text size"
        value={fontSize}
        min={8}
        max={200}
        step={1}
        display="{fontSize} px"
        disabled={editor.busy}
        onvalue={(next) => (fontSize = next)}
      />
    </section>

    <section class="tool-section">
      <span class="micro-label">Style</span>
      <div class="tool-row">
        <CheckField id="watermark-bold" label="Bold" bind:checked={bold} disabled={editor.busy} />
        <CheckField id="watermark-italic" label="Italic" bind:checked={italic} disabled={editor.busy} />
      </div>

      <Segmented
        name="watermark-align"
        label="Alignment"
        columns={3}
        options={ALIGNS}
        value={align}
        disabled={editor.busy}
        onvalue={(next) => (align = next)}
      />

      <ColorField
        id="watermark-color"
        label="Colour"
        value={color}
        disabled={editor.busy}
        onvalue={(next) => (color = next)}
      />
    </section>

    <section class="tool-section">
      <CheckField
        id="watermark-outline"
        label="Outline"
        bind:checked={outline}
        disabled={editor.busy}
      />

      {#if outline}
        <!-- The outline is drawn in the same colour space as the fill, so an
             outline darker than a dark fill disappears into it. Worth a line
             rather than a colour maths in the panel. -->
        <ColorField
          id="watermark-outline-color"
          label="Outline colour"
          value={outlineColor}
          disabled={editor.busy}
          onvalue={(next) => (outlineColor = next)}
        />

        <SliderField
          id="watermark-outline-width"
          label="Outline width"
          value={outlineWidth}
          min={1}
          max={20}
          step={1}
          display="{outlineWidth} px"
          disabled={editor.busy}
          onvalue={(next) => (outlineWidth = next)}
        />
      {/if}
    </section>
  {/if}

  {#if usesImage}
    <section class="tool-section">
      <span class="micro-label">Logo</span>

      <Button
        variant="secondary"
        full
        onclick={() => logoInput?.click()}
        disabled={editor.busy}
      >
        {logo ? "Choose a different logo" : "Choose a logo"}
      </Button>

      <p class="tool-note" class:error={!!logoError}>
        {logoError ?? (logo ? logo.name : "No logo chosen. PNG and WebP keep transparency.")}
      </p>

      {#if logo}
        <Button variant="quiet" size="sm" full onclick={clearLogo} disabled={editor.busy}>
          Clear the logo
        </Button>
      {/if}
    </section>

    <section class="tool-section">
      <SliderField
        id="watermark-logo-scale"
        label="Logo size"
        value={logoScale}
        min={5}
        max={200}
        step={1}
        display="{logoScale} % of its own size"
        disabled={editor.busy || !logo}
        onvalue={(next) => (logoScale = next)}
      />

      {#if logo}
        <div class="tool-result">
          <span>Logo</span>
          <strong>{logo.width} × {logo.height}</strong>
        </div>
      {/if}
    </section>
  {/if}

  {#if type === "tiled"}
    <section class="tool-section">
      <span class="micro-label">Tiling</span>

      <Segmented
        name="watermark-tile-source"
        label="Mark to repeat"
        options={TILE_SOURCES}
        value={tileSource}
        disabled={editor.busy}
        onvalue={(next) => (tileSource = next)}
      />

      <div class="tool-row">
        <NumberField
          id="watermark-tile-size"
          label="Tile size"
          value={tileSize}
          min={100}
          max={2000}
          step={10}
          suffix="px"
          disabled={editor.busy}
          onvalue={(next) => (tileSize = next)}
        />
        <NumberField
          id="watermark-tile-gap"
          label="Tile gap"
          value={tileGap}
          min={0}
          max={1000}
          step={5}
          suffix="px"
          disabled={editor.busy}
          onvalue={(next) => (tileGap = next)}
        />
      </div>
    </section>
  {/if}

  <section class="tool-section">
    <span class="micro-label">Appearance</span>

    <SliderField
      id="watermark-opacity"
      label="Opacity"
      value={opacity}
      min={0}
      max={100}
      step={1}
      display="{opacity} %"
      disabled={editor.busy}
      onvalue={(next) => (opacity = next)}
    />

    <SliderField
      id="watermark-rotation"
      label="Rotation"
      value={rotation}
      min={-180}
      max={180}
      step={1}
      display="{rotation}°"
      disabled={editor.busy}
      onvalue={(next) => (rotation = next)}
    />

    <SelectField
      id="watermark-blend"
      label="Blend"
      value={blend}
      options={BLENDS}
      disabled={editor.busy}
      onvalue={(next) => (blend = next)}
    />
  </section>

  {#if type === "tiled"}
    <!-- A tiled mark has no anchor, no nudge and no safe margin. Showing those
         three controls greyed out would be offering settings that cannot take
         effect, so the section says why they are gone instead. -->
    <section class="tool-section">
      <span class="micro-label">Coverage</span>
      <p class="tool-note">
        A tiled mark covers the whole frame. Anchor, nudge and safe margin apply
        to a single mark only.
      </p>
    </section>
  {:else}
    <section class="tool-section">
      <span class="micro-label">Position</span>

      <div class="tool-chips" role="group" aria-label="Anchor">
        {#each ANCHORS as anchor (anchor.id)}
          <button
            type="button"
            class="tool-chip"
            class:on={position === anchor.id}
            title={anchor.label}
            aria-label={anchor.label}
            aria-pressed={position === anchor.id}
            disabled={editor.busy}
            onclick={() => (position = anchor.id)}
          >
            <span aria-hidden="true">{anchor.glyph}</span>
          </button>
        {/each}
      </div>

      <div class="tool-row">
        <NumberField
          id="watermark-offset-x"
          label="Nudge across"
          value={offsetX}
          min={-offsetLimit}
          max={offsetLimit}
          step={1}
          suffix="px"
          disabled={editor.busy}
          onvalue={(next) => (offsetX = next)}
        />
        <NumberField
          id="watermark-offset-y"
          label="Nudge down"
          value={offsetY}
          min={-offsetLimit}
          max={offsetLimit}
          step={1}
          suffix="px"
          disabled={editor.busy}
          onvalue={(next) => (offsetY = next)}
        />
      </div>

      <SliderField
        id="watermark-margin"
        label="Safe margin"
        value={margin}
        min={0}
        max={20}
        step={1}
        display="{margin} %"
        disabled={editor.busy}
        onvalue={(next) => (margin = next)}
      />
    </section>
  {/if}

  <section class="tool-section">
    <span class="micro-label">Presets</span>
    <div class="tool-chips">
      {#each PRESETS as preset, index (preset.name)}
        <button
          type="button"
          class="tool-chip"
          class:on={activePreset === index}
          aria-pressed={activePreset === index}
          disabled={editor.busy}
          onclick={() => usePreset(preset)}
        >
          {preset.name}
        </button>
      {/each}
    </div>

    <Button variant="ghost" size="sm" full onclick={autoSize} disabled={editor.busy || !source}>
      Auto size from the image
    </Button>
  </section>

  {#if missingLogo}
    <p class="tool-note">Apply needs a logo. Choose a file, or switch the mark to Text.</p>
  {:else if emptyText}
    <p class="tool-note">Apply needs some text to stamp.</p>
  {/if}

  <div class="tool-actions">
    <p class="tool-note">The stage previews the mark. Apply keeps the result.</p>

    <Button
      variant="primary"
      size="lg"
      full
      data-tool="apply"
      disabled={locked || nothingToDraw}
      onclick={apply}
    >
      Apply watermark
    </Button>

    <Button variant="quiet" size="sm" full disabled={editor.busy} onclick={reset}>
      Reset
    </Button>
  </div>
</div>

<input
  bind:this={logoInput}
  class="visually-hidden"
  type="file"
  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
  aria-label="Choose a logo to stamp"
  onchange={onPickLogo}
/>

<style>
  /* The watermark text is the one control with no shared field to reach for:
     there is no TextField in the control set, and a watermark without editable
     text is not a watermark. Styled from the same tokens as the selects so it
     does not read as a different kind of control. */
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }

  .name {
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-2);
  }

  input[type="text"] {
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--s-3);
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-radius: var(--r-md);
    font-size: var(--t-md);
    color: var(--text-1);
    transition:
      border-color var(--dur-1) var(--ease),
      background var(--dur-1) var(--ease);
  }

  input[type="text"]:hover:not(:disabled) {
    border-color: var(--line-3);
  }

  input[type="text"]:focus-visible {
    outline: none;
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }

  input[type="text"]:disabled {
    color: var(--text-3);
    cursor: not-allowed;
  }

  .error {
    color: var(--danger);
  }
</style>
