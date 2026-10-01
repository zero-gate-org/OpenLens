/**
 * `?tool=` routing.
 *
 * The legacy static editor used this exact query param, so existing deep
 * links (and the old landing page's tool cards) keep working.
 */

import { editor } from "./state/editor.svelte.js";
import { DEFAULT_TOOL, isKnownTool } from "./registry.js";

export function readToolFromLocation() {
  const raw = new URLSearchParams(window.location.search).get("tool");
  return isKnownTool(raw) ? raw : DEFAULT_TOOL;
}

/** Read the URL on load and on every back/forward. */
export function initRouting() {
  const apply = () => editor.setTool(readToolFromLocation());
  window.addEventListener("popstate", apply);
  apply();
  return () => window.removeEventListener("popstate", apply);
}

/** Push-side. Call from a reactive context so it re-runs on tool change. */
export function syncToolToLocation(tool) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("tool") === tool) return;
  url.searchParams.set("tool", tool);
  window.history.replaceState(null, "", url);
}
