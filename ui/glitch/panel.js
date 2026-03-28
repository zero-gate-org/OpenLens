const markup = `<div class="sidebar-panel" data-panel="glitch">
                  <div class="sidebar-section-label">Techniques</div>
                  <div class="glitch-technique-list">
                    <label class="glitch-technique-row">
                      <input id="glitch-slice-enabled" type="checkbox" checked />
                      <span class="glitch-technique-label">Slice Offset</span>
                    </label>
                    <label class="glitch-technique-row">
                      <input id="glitch-channel-enabled" type="checkbox" checked />
                      <span class="glitch-technique-label">Channel Shift</span>
                    </label>
                    <label class="glitch-technique-row">
                      <input id="glitch-scanline-enabled" type="checkbox" />
                      <span class="glitch-technique-label">Scanline Corruption</span>
                    </label>
                    <label class="glitch-technique-row">
                      <input id="glitch-datamosh-enabled" type="checkbox" />
                      <span class="glitch-technique-label">Block Datamosh</span>
                    </label>
                    <label class="glitch-technique-row">
                      <input id="glitch-rgbsplit-enabled" type="checkbox" />
                      <span class="glitch-technique-label">RGB Band Split</span>
                    </label>
                  </div>

                  <div class="sidebar-section-label">Intensity</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Intensity</span>
                    <div class="sidebar-range-row">
                      <input id="glitch-intensity" class="sidebar-range" type="range" min="0" max="100" step="1" value="50" />
                      <output id="glitch-intensity-val" class="sidebar-range-value" for="glitch-intensity">50</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label glitch-slice-only">Slice Settings</div>
                  <label class="sidebar-field glitch-slice-only">
                    <span class="sidebar-label">Slice Count</span>
                    <div class="sidebar-range-row">
                      <input id="glitch-slice-count" class="sidebar-range" type="range" min="2" max="30" step="1" value="10" />
                      <output id="glitch-slice-count-val" class="sidebar-range-value" for="glitch-slice-count">10</output>
                    </div>
                  </label>
                  <label class="sidebar-field glitch-slice-only">
                    <span class="sidebar-label">Max Slice Offset</span>
                    <div class="sidebar-range-row">
                      <input id="glitch-max-slice-offset" class="sidebar-range" type="range" min="10" max="200" step="1" value="80" />
                      <output id="glitch-max-slice-offset-val" class="sidebar-range-value" for="glitch-max-slice-offset">80px</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label glitch-datamosh-only">Datamosh Settings</div>
                  <label class="sidebar-field glitch-datamosh-only">
                    <span class="sidebar-label">Block Size</span>
                    <div class="sidebar-range-row">
                      <input id="glitch-block-size" class="sidebar-range" type="range" min="8" max="64" step="4" value="16" />
                      <output id="glitch-block-size-val" class="sidebar-range-value" for="glitch-block-size">16px</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Seed</div>
                  <div class="glitch-seed-row">
                    <input id="glitch-seed" class="glitch-seed-input" type="number" min="0" max="2147483647" value="42" />
                    <button id="glitch-seed-randomize" class="glitch-seed-btn" type="button">🎲</button>
                  </div>

                  <button id="glitch-regenerate" class="btn btn-ghost btn-full" type="button" style="margin-top:4px;">Regenerate</button>

                  <div class="sidebar-section-label">Animation</div>
                  <label class="sidebar-check">
                    <input id="glitch-animate" type="checkbox" />
                    <span>Animate</span>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Animation Speed</span>
                    <div class="sidebar-range-row">
                      <input id="glitch-anim-speed" class="sidebar-range" type="range" min="0" max="100" step="1" value="50" />
                      <output id="glitch-anim-speed-val" class="sidebar-range-value" for="glitch-anim-speed">50</output>
                    </div>
                  </label>
                  <div class="glitch-anim-warning">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Animation is for preview only &mdash; Apply captures current frame.
                  </div>

                  <div class="sidebar-section-label">Presets</div>
                  <div id="glitch-presets" class="glitch-presets"></div>

                  <div class="sidebar-row" style="margin-top:4px;">
                    <button id="glitch-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="glitch-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
