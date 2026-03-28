const markup = `<div class="sidebar-panel" data-panel="rotate">
                  <div class="sidebar-row">
                    <button id="rotate-left" class="btn btn-ghost btn-full" type="button">−90°</button>
                    <button id="rotate-right" class="btn btn-ghost btn-full" type="button">+90°</button>
                  </div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Custom angle</span>
                    <input id="rotate-angle" class="sidebar-input" type="number" min="-360" max="360" step="1" value="0" />
                  </label>
                  <button id="apply-rotate" class="btn btn-accent btn-full" type="button">Apply Rotation</button>
                </div>`;

export default markup;
