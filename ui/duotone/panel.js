const markup = `<div class="sidebar-panel" data-panel="duotone">
                  <label class="sidebar-field">
                    <span class="sidebar-label">Shadows / Dark Tones</span>
                    <div class="sidebar-color-row">
                      <input id="duotone-shadow-color" type="color" class="sidebar-color" value="#1a0533" />
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Highlights / Light Tones</span>
                    <div class="sidebar-color-row">
                      <input id="duotone-highlight-color" type="color" class="sidebar-color" value="#f7e733" />
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Intensity</span>
                    <div class="sidebar-range-row">
                      <input id="duotone-intensity" class="sidebar-range" type="range" min="0" max="100" step="1" value="100" />
                      <output id="duotone-intensity-val" class="sidebar-range-value" for="duotone-intensity">100%</output>
                    </div>
                  </label>
                  <div class="sidebar-section-label">Presets</div>
                  <div id="duotone-presets" class="duotone-presets"></div>
                  <div class="sidebar-row" style="margin-top:4px;">
                    <button id="duotone-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="duotone-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
