const markup = `<div class="sidebar-panel" data-panel="shadowinjection">
                  <label class="sidebar-field">
                    <span class="sidebar-label">Model</span>
                    <select id="shadow-model" class="sidebar-select">
                      <option value="small">Small (fast)</option>
                      <option value="medium" selected>Medium</option>
                      <option value="large">Large (best)</option>
                    </select>
                  </label>
                  <div class="sidebar-section-label">Shadow Position</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Offset X</span>
                    <div class="sidebar-range-row">
                      <input id="shadow-offset-x" class="sidebar-range" type="range" min="-50" max="50" step="1" value="10" />
                      <output id="shadow-offset-x-val" class="sidebar-range-value" for="shadow-offset-x">10px</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Horizontal shadow offset</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Offset Y</span>
                    <div class="sidebar-range-row">
                      <input id="shadow-offset-y" class="sidebar-range" type="range" min="-50" max="50" step="1" value="10" />
                      <output id="shadow-offset-y-val" class="sidebar-range-value" for="shadow-offset-y">10px</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Vertical shadow offset</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Blur</span>
                    <div class="sidebar-range-row">
                      <input id="shadow-blur" class="sidebar-range" type="range" min="1" max="50" step="1" value="15" />
                      <output id="shadow-blur-val" class="sidebar-range-value" for="shadow-blur">15px</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Shadow softness</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Opacity</span>
                    <div class="sidebar-range-row">
                      <input id="shadow-opacity" class="sidebar-range" type="range" min="10" max="100" step="1" value="60" />
                      <output id="shadow-opacity-val" class="sidebar-range-value" for="shadow-opacity">60%</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Shadow darkness / visibility</small>
                  </label>
                  <button id="apply-shadow" class="btn btn-accent btn-full" type="button">Apply Shadow</button>
                </div>`;

export default markup;
