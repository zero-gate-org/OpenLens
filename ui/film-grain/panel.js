const markup = `<div class="sidebar-panel" data-panel="filmgrain">
                  <div class="sidebar-section-label">Noise Type</div>
                  <div class="fg-noise-group">
                    <button class="fg-noise-btn active" type="button" data-noise-type="uniform">Uniform</button>
                    <button class="fg-noise-btn" type="button" data-noise-type="luminance">Luminance</button>
                    <button class="fg-noise-btn" type="button" data-noise-type="color">Color</button>
                  </div>

                  <div class="sidebar-section-label">Grain Settings</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Grain Strength</span>
                    <div class="sidebar-range-row">
                      <input id="fg-strength" class="sidebar-range" type="range" min="0" max="100" step="1" value="25" />
                      <output id="fg-strength-val" class="sidebar-range-value" for="fg-strength">25</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Grain Size</span>
                    <div class="sidebar-range-row">
                      <input id="fg-grain-size" class="sidebar-range" type="range" min="1" max="8" step="1" value="1" />
                      <output id="fg-grain-size-val" class="sidebar-range-value" for="fg-grain-size">1px</output>
                    </div>
                    <small style="color:#888;font-size:11px;margin-top:4px;display:block;">1 = fine digital, 4-8 = chunky vintage</small>
                  </label>

                  <div class="sidebar-section-label">Grain Shape</div>
                  <div class="fg-shape-group">
                    <button class="fg-shape-btn active" type="button" data-shape="square">Square</button>
                    <button class="fg-shape-btn" type="button" data-shape="random">Random</button>
                  </div>

                  <div class="sidebar-section-label">Region Mask</div>
                  <label class="sidebar-check">
                    <input id="fg-highlights-only" type="checkbox" />
                    <span>Highlights Only</span>
                  </label>
                  <label class="sidebar-check">
                    <input id="fg-shadows-only" type="checkbox" />
                    <span>Shadows Only</span>
                  </label>

                  <div class="sidebar-section-label">Fixed Grain</div>
                  <label class="sidebar-check">
                    <input id="fg-fixed-grain" type="checkbox" />
                    <span>Fixed Grain (seeded)</span>
                  </label>
                  <div class="fg-seed-row" style="display:none;">
                    <input id="fg-seed" class="fg-seed-input" type="number" min="0" max="2147483647" value="42" />
                    <button id="fg-seed-randomize" class="fg-seed-btn" type="button">&#x1F3B2;</button>
                  </div>

                  <div class="sidebar-section-label">Blend</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Intensity</span>
                    <div class="sidebar-range-row">
                      <input id="fg-blend" class="sidebar-range" type="range" min="0" max="100" step="1" value="100" />
                      <output id="fg-blend-val" class="sidebar-range-value" for="fg-blend">100%</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Presets</div>
                  <div id="fg-presets" class="fg-presets"></div>

                  <div class="sidebar-row" style="margin-top:4px;">
                    <button id="fg-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="fg-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
