/**
 * Deep-link compatibility.
 *
 * The editor used to live at the site root, and its `?tool=` deep links are in
 * bookmarks, in the previous landing page's tool cards, and in other people's
 * posts. The landing page took the root, so anything that arrives at `/`
 * carrying a `tool` parameter is an old editor link and belongs in the editor.
 *
 * Only a `tool` parameter counts. A bare `/` is the landing page, which is what
 * somebody typing the address wants, and the editor ignores an unknown tool
 * anyway, so forwarding the parameter and letting `routing.svelte.js` decide is
 * both simpler and more forgiving than duplicating the tool list here.
 *
 * Note there is no import of `registry.js`: it pulls in all twenty-five tool
 * components, and a visitor who lands here should not download a single one.
 */

/**
 * Where a request for the site root belongs, or null if it is the landing page.
 *
 * @returns {string | null}
 */
export function editorTarget() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("tool")) return null;
  return `./editor.html${window.location.search}`;
}
