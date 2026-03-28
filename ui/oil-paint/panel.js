const markup = `<div class="sidebar-panel" data-panel="oilpaint">
                  <div class="sidebar-section-label">Algorithm</div>
                  <div class="op-mode-group">
                    <label class="op-mode-btn active" data-mode="standard">
                      <input class="op-mode-radio" type="radio" name="op-mode" value="standard" checked />
                      Standard (Fast)
                    </label>
                    <label class="op-mode-btn" data-mode="generalized">
                      <input class="op-mode-radio" type="radio" name="op-mode" value="generalized" />
                      Smooth (Generalized)
                    </label>
                  </div>

                  <div class="op-preview-note">Preview at reduced resolution — Apply uses full image.</div>

                  <div class="sidebar-section-label">Brush Settings</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Brush Radius</span>
                    <div class="sidebar-range-row">
                      <input id="op-radius" class="sidebar-range" type="range" min="2" max="15" step="1" value="4" />
                      <output id="op-radius-val" class="sidebar-range-value" for="op-radius">4px</output>
                    </div>
                    <small style="color:#888;font-size:11px;margin-top:4px;display:block;">Affects visible brush stroke size</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Passes</span>
                    <div class="sidebar-range-row">
                      <input id="op-passes" class="sidebar-range" type="range" min="1" max="4" step="1" value="1" />
                      <output id="op-passes-val" class="sidebar-range-value" for="op-passes">1</output>
                    </div>
                  </label>
                  <div class="op-pass-warning">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y1="16"/></svg>
                    High abstraction — 3+ passes may significantly abstract the image.
                  </div>
                  <label class="sidebar-field op-sectors-field" style="display:none;">
                    <span class="sidebar-label">Sector Count</span>
                    <div class="sidebar-range-row">
                      <input id="op-sectors" class="sidebar-range" type="range" min="4" max="16" step="1" value="8" />
                      <output id="op-sectors-val" class="sidebar-range-value" for="op-sectors">8</output>
                    </div>
                    <small style="color:#888;font-size:11px;margin-top:4px;display:block;">More sectors = smoother strokes</small>
                  </label>

                  <div class="sidebar-section-label">Enhancements</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Color Boost</span>
                    <div class="sidebar-range-row">
                      <input id="op-sat-boost" class="sidebar-range" type="range" min="0" max="100" step="1" value="0" />
                      <output id="op-sat-boost-val" class="sidebar-range-value" for="op-sat-boost">0%</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Edge Sharpening</span>
                    <div class="sidebar-range-row">
                      <input id="op-edge-sharpen" class="sidebar-range" type="range" min="0" max="100" step="1" value="0" />
                      <output id="op-edge-sharpen-val" class="sidebar-range-value" for="op-edge-sharpen">0%</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Presets</div>
                  <div id="op-presets" class="op-presets"></div>

                  <div class="op-actions-row">
                    <button id="op-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="op-cancel" class="btn btn-ghost btn-full op-cancel-btn" type="button">Cancel</button>
                    <button id="op-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
