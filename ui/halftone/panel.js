const markup = `<div class="sidebar-panel" data-panel="halftone">
                  <div class="sidebar-section-label">Mode</div>
                  <div class="halftone-mode-group">
                    <label class="halftone-mode-btn active">
                      <input class="halftone-mode-radio" type="radio" name="halftone-mode" value="grayscale" checked />
                      Grayscale
                    </label>
                    <label class="halftone-mode-btn">
                      <input class="halftone-mode-radio" type="radio" name="halftone-mode" value="cmyk" />
                      CMYK
                    </label>
                  </div>

                  <div class="sidebar-section-label">Settings</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Grid Size</span>
                    <div class="sidebar-range-row">
                      <input id="halftone-grid-size" class="sidebar-range" type="range" min="4" max="30" step="1" value="10" />
                      <output id="halftone-grid-size-val" class="sidebar-range-value" for="halftone-grid-size">10px</output>
                    </div>
                  </label>
                  <label class="sidebar-field halftone-grayscale-only">
                    <span class="sidebar-label">Dot Color</span>
                    <div class="sidebar-color-row">
                      <input id="halftone-dot-color" type="color" class="sidebar-color" value="#000000" />
                    </div>
                  </label>
                  <label class="sidebar-field halftone-grayscale-only">
                    <span class="sidebar-label">Background Color</span>
                    <div class="sidebar-color-row">
                      <input id="halftone-bg-color" type="color" class="sidebar-color" value="#ffffff" />
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Dot Shape</span>
                    <select id="halftone-shape" class="sidebar-select">
                      <option value="circle">Circle</option>
                      <option value="square">Square</option>
                      <option value="diamond">Diamond</option>
                    </select>
                  </label>
                  <label class="sidebar-field halftone-grayscale-only">
                    <span class="sidebar-label">Grid Angle</span>
                    <div class="sidebar-range-row">
                      <input id="halftone-angle" class="sidebar-range" type="range" min="0" max="90" step="1" value="0" />
                      <output id="halftone-angle-val" class="sidebar-range-value" for="halftone-angle">0&deg;</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Presets</div>
                  <div id="halftone-presets" class="halftone-presets"></div>

                  <div class="sidebar-row" style="margin-top:4px;">
                    <button id="halftone-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="halftone-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
