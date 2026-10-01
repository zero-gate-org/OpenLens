/**
 * Landing page entry point.
 *
 * Two things happen here. The first is a redirect for old editor deep links.
 * The second is starting Svelte, by hydrating the prerendered markup if the
 * build put it there and mounting into an empty point if it did not.
 *
 * The distinction matters. `prerender-landing.mjs` writes the rendered page into
 * `dist/index.html`, so the HTML a crawler or a visitor with scripting turned
 * off receives already contains the whole page. Hydrating attaches behaviour to
 * that markup and leaves it in place; mounting would throw it away and rebuild
 * it, which is correct for an application and wasteful for a document.
 */

import { hydrate, mount } from "svelte";

import "./landing.css";
import Landing from "./Landing.svelte";
import { editorTarget } from "./lib/redirect.js";

const app = document.getElementById("app");

// An old `?tool=` link to the site root lands here rather than in the editor.
// `replace` so the visitor's back button goes to wherever they came from instead
// of bouncing off the landing page again.
const target = editorTarget();

if (target) {
  window.location.replace(target);
} else if (app?.hasAttribute("data-prerendered")) {
  hydrate(Landing, { target: app });
} else {
  mount(Landing, { target: app });
}
