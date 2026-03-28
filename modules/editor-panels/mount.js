import { buildPanelsMarkup } from "./index.js";

export function mountEditorPanels() {
  const host = document.querySelector(".sidebar-panels");
  if (!host) return;
  if (host.dataset.panelsMounted === "1") return;

  host.innerHTML = buildPanelsMarkup();
  host.dataset.panelsMounted = "1";
}
