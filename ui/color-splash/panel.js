const markup = `<div class="sidebar-panel" data-panel="colorsplash">
                  <label class="sidebar-field">
                    <span class="sidebar-label">Model</span>
                    <select id="splash-model" class="sidebar-select">
                      <option value="small">Small (fast)</option>
                      <option value="medium" selected>Medium</option>
                      <option value="large">Large (best)</option>
                    </select>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Edge Feather</span>
                    <div class="sidebar-range-row">
                      <input id="splash-feather" class="sidebar-range" type="range" min="0" max="20" step="1" value="5" />
                      <output id="splash-feather-val" class="sidebar-range-value" for="splash-feather">5px</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Smooths transition between color and grayscale</small>
                  </label>
                  <button id="apply-splash" class="btn btn-accent btn-full" type="button">Apply Color Splash</button>
                </div>`;

export default markup;
