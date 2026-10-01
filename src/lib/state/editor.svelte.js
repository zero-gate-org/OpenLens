/**
 * The single source of truth for the editor.
 *
 * One rule that shapes this file: image records own their object URL, and
 * this store is the only thing that revokes them. Snapshots taken for
 * history re-mint a URL, so a record can never be aliased into two
 * lifetimes by accident.
 */

import { imageFromBlob, revokeImage, snapshotOf } from "../core/image.js";
import { looksLikeImage } from "../core/format.js";

const HISTORY_LIMIT = 40;
const NOTICE_MS = 2200;

let noticeTimer = null;
let noticeSeq = 0;

class EditorStore {
  /** @type {import('../core/image.js').ImageRecord | null} */
  current = $state(null);
  /** @type {import('../core/image.js').ImageRecord | null} */
  original = $state(null);
  past = $state([]);
  future = $state([]);
  tool = $state("crop");

  busy = $state(false);
  /** Transient message shown near the stage. */
  notice = $state(null);
  /** Sticky, dismissible failure for the current operation. */
  error = $state(null);
  /** Live progress while `busy`. `null` means indeterminate. */
  progress = $state(null);
  /** Bumped when a whole new image arrives, so the stage can re-fit. */
  epoch = $state(0);

  /**
   * Live preview from the active tool, or null.
   *
   * This is what makes a slider feel like a slider: a tool computes a
   * candidate image and hands it to the stage, which shows it in place of the
   * committed one until Apply or until the tool is switched away. The
   * committed image is never touched, so a preview can never leak into the
   * export or into the undo stack.
   *
   * @type {{url: string, width: number, height: number} | null}
   */
  preview = $state(null);
  /** True while a tool is recomputing its preview. */
  previewBusy = $state(false);

  /**
   * A component the active tool has mounted *inside the image box* on the
   * stage, above the picture.
   *
   * Previewing a filtered bitmap is not enough for tools that author: text on
   * a curve, stickers, a frame, a photo behind a subject. Those need to draw
   * over the picture at image coordinates, exactly where `CropOverlay` lives,
   * so they get the same coordinate space and the same constant-screen-size
   * treatment. A tool mounts its layer on mount and releases it on unmount;
   * `setTool` releases it too, so a layer can never outlive the tool that owns
   * it.
   *
   * @type {any}
   */
  stageLayer = $state(null);

  hasImage = $derived(!!this.current);

  // Blob identity is a more reliable "has this changed?" test than a
  // boolean flag, and it self-heals when undo walks all the way back.
  edited = $derived(
    !!this.current && !!this.original && this.current.blob !== this.original.blob,
  );

  canUndo = $derived(this.past.length > 0 && !this.busy);
  canRedo = $derived(this.future.length > 0 && !this.busy);
  canReset = $derived(this.edited && !this.busy);
  canDownload = $derived(!!this.current && !this.busy);

  // ---------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------

  async open(file) {
    if (!file) return;

    if (!looksLikeImage(file)) {
      this.fail("That file is not an image OpenLens can read.");
      return;
    }

    this.busy = true;
    this.error = null;
    this.notice = null;
    this.progress = null;
    this.setNotice("Reading the file…", "working");

    try {
      const record = await imageFromBlob(file, file.name || "image");

      this.dropAll();
      this.clearPreview();
      this.original = record;
      // Separate record (and URL) so revoking the working copy can never
      // pull the rug out from under the pristine original.
      this.current = { ...record, url: URL.createObjectURL(record.blob) };
      this.epoch += 1;
      this.setNotice("Ready.", "done");
    } catch (err) {
      this.fail(err?.message || "That image could not be opened.");
    } finally {
      this.busy = false;
      this.progress = null;
    }
  }

  // ---------------------------------------------------------------
  // History
  // ---------------------------------------------------------------

  /**
   * Commit a finished edit. This is the only way an image changes, so undo
   * can never miss a step.
   */
  async commit(blob, label, name) {
    if (!this.current) return;

    const next = await imageFromBlob(blob, name || this.current.name);

    this.pushPast(snapshotOf(this.current));
    this.clearFuture();

    revokeImage(this.current);
    this.current = next;

    this.setNotice(`${label} applied.`, "done");
    return next;
  }

  undo() {
    if (!this.canUndo) return;

    const previous = this.past.pop();
    this.future.push(snapshotOf(this.current));
    revokeImage(this.current);
    this.current = previous;
    this.setNotice("Stepped back.", "done");
  }

  redo() {
    if (!this.canRedo) return;

    const next = this.future.pop();
    this.past.push(snapshotOf(this.current));
    revokeImage(this.current);
    this.current = next;
    this.setNotice("Stepped forward.", "done");
  }

  /** Return to the untouched upload. Undoable, unlike a hard reload. */
  reset() {
    if (!this.canReset || !this.original) return;
    this.pushPast(snapshotOf(this.current));
    this.clearFuture();
    revokeImage(this.current);
    this.current = { ...this.original, url: URL.createObjectURL(this.original.blob) };
    this.setNotice("Back to the original.", "done");
  }

  /** Throw the image away and show the empty state. */
  discard() {
    if (this.busy) return;
    this.dropAll();
    this.epoch += 1;
    this.setNotice(null);
  }

  // ---------------------------------------------------------------
  // Operation wrapper
  // ---------------------------------------------------------------

  /**
   * Run a tool operation with busy state, progress reporting and error
   * capture handled in one place, so no tool can forget any of the three.
   */
  async run(label, fn) {
    if (this.busy) return false;

    this.busy = true;
    this.error = null;
    this.progress = null;
    this.setNotice(`${label}…`, "working");

    try {
      await fn((message, ratio) => this.report(message, ratio));
      this.setNotice(`${label} done.`, "done");
      return true;
    } catch (err) {
      this.fail(err?.message || `${label} failed.`);
      return false;
    } finally {
      this.busy = false;
      this.progress = null;
    }
  }

  report(message, ratio) {
    this.progress = {
      message: message ?? null,
      ratio: Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : null,
    };
  }

  fail(message) {
    this.error = message;
    this.setNotice(message, "error");
  }

  dismissError() {
    this.error = null;
  }

  setNotice(message, tone = "done") {
    if (noticeTimer) clearTimeout(noticeTimer);
    if (message === null) {
      this.notice = null;
      return;
    }
    this.notice = { message, tone, id: ++noticeSeq };
    if (tone !== "working") {
      noticeTimer = setTimeout(() => {
        if (this.notice?.message === message) this.notice = null;
      }, NOTICE_MS);
    }
  }

  // ---------------------------------------------------------------
  // Live previews (owned by the active tool, revoked here)
  // ---------------------------------------------------------------

  /**
   * Show `blob` on the stage in place of the committed image.
   * Revokes whatever preview was there, so callers do not have to.
   */
  async setPreview(blob) {
    const record = await imageFromBlob(blob, this.current?.name);
    const previous = this.preview;
    this.preview = record;
    if (previous?.url) URL.revokeObjectURL(previous.url);
    return record;
  }

  /** Mount a component into the stage's image box. */
  setStageLayer(component) {
    this.stageLayer = component;
  }

  clearStageLayer() {
    this.stageLayer = null;
  }

  clearPreview() {
    if (this.preview?.url) URL.revokeObjectURL(this.preview.url);
    this.preview = null;
    this.previewBusy = false;
  }

  setTool(tool) {
    if (this.tool === tool) return;
    // A preview and an authoring layer both belong to the tool that made them.
    // Leaving either on the stage would show the previous tool's work under
    // the next tool's controls.
    this.clearPreview();
    this.clearStageLayer();
    this.tool = tool;
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  pushPast(snapshot) {
    this.past.push(snapshot);
    while (this.past.length > HISTORY_LIMIT) revokeImage(this.past.shift());
  }

  clearFuture() {
    this.future.forEach(revokeImage);
    this.future = [];
  }

  dropAll() {
    this.clearPreview();
    this.past.forEach(revokeImage);
    this.future.forEach(revokeImage);
    this.past = [];
    this.future = [];
    revokeImage(this.current);
    revokeImage(this.original);
    this.current = null;
    this.original = null;
  }
}

export const editor = new EditorStore();
