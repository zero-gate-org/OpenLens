const markup = `<div class="sidebar-panel" data-panel="gradientmap">
                  <div class="sidebar-section-label">Gradient Editor</div>
                  <div class="gm-gradient-editor">
                    <div class="gm-gradient-bar-wrap">
                      <canvas id="gm-gradient-bar" class="gm-gradient-bar" width="260" height="32"></canvas>
                      <div id="gm-stops-track" class="gm-stops-track"></div>
                    </div>
                    <div id="gm-stop-list" class="gm-stop-list"></div>
                  </div>

                  <label class="sidebar-field">
                    <span class="sidebar-label">Intensity</span>
                    <div class="sidebar-range-row">
                      <input id="gm-intensity" class="sidebar-range" type="range" min="0" max="100" step="1" value="100" />
                      <output id="gm-intensity-val" class="sidebar-range-value" for="gm-intensity">100%</output>
                    </div>
                  </label>

                  <label class="sidebar-field">
                    <span class="sidebar-label">Blend Mode</span>
                    <select id="gm-blend-mode" class="gm-blend-select">
                      <option value="replace">Replace</option>
                      <option value="luminosity">Luminosity</option>
                      <option value="color">Color</option>
                      <option value="multiply">Multiply</option>
                    </select>
                  </label>

                  <div style="display:flex;gap:6px;margin-bottom:4px;">
                    <button id="gm-reverse" class="gm-reverse-btn" type="button">Reverse</button>
                  </div>

                  <div class="sidebar-section-label">Presets</div>
                  <div id="gm-presets" class="gm-presets"></div>

                  <div class="sidebar-row" style="margin-top:4px;">
                    <button id="gm-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="gm-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
