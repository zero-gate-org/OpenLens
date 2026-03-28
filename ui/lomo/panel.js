const markup = `<div class="sidebar-panel" data-panel="lomo">
                  <div class="sidebar-section-label">Style Presets</div>
                  <div id="lomo-presets" class="lomo-presets"></div>

                  <div class="sidebar-section-label">Adjustments</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Saturation</span>
                    <div class="sidebar-range-row">
                      <input id="lomo-saturation" class="sidebar-range" type="range" min="50" max="300" step="1" value="160" />
                      <output id="lomo-saturation-val" class="sidebar-range-value" for="lomo-saturation">1.6x</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Vignette</span>
                    <div class="sidebar-range-row">
                      <input id="lomo-vignette" class="sidebar-range" type="range" min="0" max="100" step="1" value="70" />
                      <output id="lomo-vignette-val" class="sidebar-range-value" for="lomo-vignette">70%</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Vignette Shape</span>
                    <div class="lomo-shape-group">
                      <button class="lomo-shape-btn active" type="button" data-shape="round">Round</button>
                      <button class="lomo-shape-btn" type="button" data-shape="oval">Oval</button>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Warmth</span>
                    <div class="sidebar-range-row">
                      <input id="lomo-warmth" class="sidebar-range" type="range" min="-50" max="50" step="1" value="15" />
                      <output id="lomo-warmth-val" class="sidebar-range-value" for="lomo-warmth">15</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Intensity</span>
                    <div class="sidebar-range-row">
                      <input id="lomo-intensity" class="sidebar-range" type="range" min="0" max="100" step="1" value="100" />
                      <output id="lomo-intensity-val" class="sidebar-range-value" for="lomo-intensity">100%</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Curve Editor (Advanced)</div>
                  <div class="lomo-curve-wrap">
                    <div class="lomo-curve-header">
                      <div class="lomo-channel-group">
                        <button class="lomo-channel-btn active" type="button" data-channel="R">R</button>
                        <button class="lomo-channel-btn" type="button" data-channel="G">G</button>
                        <button class="lomo-channel-btn" type="button" data-channel="B">B</button>
                      </div>
                      <span id="lomo-curve-channel-label" class="lomo-curve-channel-label">R</span>
                    </div>
                    <canvas id="lomo-curve-canvas" class="lomo-curve-canvas" width="260" height="180"></canvas>
                    <div class="lomo-curve-hint">Click to add &bull; Drag to move &bull; Right-click to delete</div>
                  </div>

                  <div class="sidebar-row" style="margin-top:4px;">
                    <button id="lomo-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="lomo-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
