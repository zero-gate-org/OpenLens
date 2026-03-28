const markup = `<div class="sidebar-panel" data-panel="resize">
                  <label class="sidebar-field">
                    <span class="sidebar-label">Width</span>
                    <input id="resize-width" class="sidebar-input" type="number" min="1" step="1" placeholder="W" />
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Height</span>
                    <input id="resize-height" class="sidebar-input" type="number" min="1" step="1" placeholder="H" />
                  </label>
                  <label class="sidebar-check">
                    <input id="lock-ratio" type="checkbox" checked />
                    <span>Lock aspect ratio</span>
                  </label>
                  <button id="apply-resize" class="btn btn-accent btn-full" type="button">Resize</button>
                </div>`;

export default markup;
