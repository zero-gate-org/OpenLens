const markup = `<div class="sidebar-panel" data-panel="blur">
                  <label class="sidebar-field">
                    <span class="sidebar-label">Model</span>
                    <select id="blur-model" class="sidebar-select">
                      <option value="small">Small (fast)</option>
                      <option value="medium" selected>Medium</option>
                      <option value="large">Large (best)</option>
                    </select>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Blur Intensity</span>
                    <div class="sidebar-range-row">
                      <input id="blur-intensity" class="sidebar-range" type="range" min="2" max="50" step="1" value="15" />
                      <output id="blur-intensity-val" class="sidebar-range-value" for="blur-intensity">15px</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Adjust slider to preview blur effect in real-time</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Edge Feather</span>
                    <div class="sidebar-range-row">
                      <input id="blur-feather" class="sidebar-range" type="range" min="0" max="20" step="1" value="5" />
                      <output id="blur-feather-val" class="sidebar-range-value" for="blur-feather">5px</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Smooths transition between sharp and blurred areas</small>
                  </label>
                  <button id="apply-blur" class="btn btn-accent btn-full" type="button">Apply Blur</button>
                </div>`;

export default markup;
