const markup = `<div class="sidebar-panel" data-panel="chromaticaberration">
                  <div id="ca-large-badge" class="ca-large-badge">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Large image &mdash; preview may lag
                  </div>
                  <div id="ca-half-preview-wrap" class="ca-half-preview-wrap">
                    <label>
                      <input id="ca-half-preview" type="checkbox" />
                      Preview at 50% resolution
                    </label>
                  </div>

                  <div class="sidebar-section-label">Style</div>
                  <div class="ca-mode-group">
                    <label class="ca-mode-btn active">
                      <input class="ca-mode-radio" type="radio" name="ca-mode" value="axial" checked />
                      Axial (Offset)
                    </label>
                    <label class="ca-mode-btn">
                      <input class="ca-mode-radio" type="radio" name="ca-mode" value="radial" />
                      Radial (Lens)
                    </label>
                  </div>

                  <div class="sidebar-section-label ca-axial-only">Channel Offsets</div>
                  <label class="sidebar-field ca-axial-only">
                    <span class="sidebar-label">Red Shift X</span>
                    <div class="sidebar-range-row">
                      <input id="ca-offset-rx" class="sidebar-range" type="range" min="-20" max="20" step="1" value="-4" />
                      <output id="ca-offset-rx-val" class="sidebar-range-value" for="ca-offset-rx">-4px</output>
                    </div>
                  </label>
                  <label class="sidebar-field ca-axial-only">
                    <span class="sidebar-label">Red Shift Y</span>
                    <div class="sidebar-range-row">
                      <input id="ca-offset-ry" class="sidebar-range" type="range" min="-20" max="20" step="1" value="0" />
                      <output id="ca-offset-ry-val" class="sidebar-range-value" for="ca-offset-ry">0px</output>
                    </div>
                  </label>
                  <label class="sidebar-field ca-axial-only">
                    <span class="sidebar-label">Blue Shift X</span>
                    <div class="sidebar-range-row">
                      <input id="ca-offset-bx" class="sidebar-range" type="range" min="-20" max="20" step="1" value="4" />
                      <output id="ca-offset-bx-val" class="sidebar-range-value" for="ca-offset-bx">4px</output>
                    </div>
                  </label>
                  <label class="sidebar-field ca-axial-only">
                    <span class="sidebar-label">Blue Shift Y</span>
                    <div class="sidebar-range-row">
                      <input id="ca-offset-by" class="sidebar-range" type="range" min="-20" max="20" step="1" value="0" />
                      <output id="ca-offset-by-val" class="sidebar-range-value" for="ca-offset-by">0px</output>
                    </div>
                  </label>

                  <label class="sidebar-field ca-radial-only" style="display:none;">
                    <span class="sidebar-label">Aberration Strength</span>
                    <div class="sidebar-range-row">
                      <input id="ca-strength" class="sidebar-range" type="range" min="0" max="100" step="1" value="30" />
                      <output id="ca-strength-val" class="sidebar-range-value" for="ca-strength">30</output>
                    </div>
                  </label>

                  <label class="sidebar-field">
                    <span class="sidebar-label">Intensity</span>
                    <div class="sidebar-range-row">
                      <input id="ca-intensity" class="sidebar-range" type="range" min="0" max="100" step="1" value="100" />
                      <output id="ca-intensity-val" class="sidebar-range-value" for="ca-intensity">100%</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Presets</div>
                  <div id="ca-presets" class="ca-presets"></div>

                  <div class="sidebar-row" style="margin-top:4px;">
                    <button id="ca-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="ca-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
