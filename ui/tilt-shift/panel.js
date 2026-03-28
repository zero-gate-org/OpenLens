const markup = `<div class="sidebar-panel" data-panel="tiltshift">
                  <div class="sidebar-section-label">Blur & Focus</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Blur Intensity</span>
                    <div class="sidebar-range-row">
                      <input id="ts-blur-intensity" class="sidebar-range" type="range" min="2" max="50" step="1" value="15" />
                      <output id="ts-blur-intensity-val" class="sidebar-range-value" for="ts-blur-intensity">15px</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Strength of blur in out-of-focus areas</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Focus Position</span>
                    <div class="sidebar-range-row">
                      <input id="ts-focus-position" class="sidebar-range" type="range" min="0" max="100" step="1" value="50" />
                      <output id="ts-focus-position-val" class="sidebar-range-value" for="ts-focus-position">50%</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Vertical position of the sharp focus band</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Transition Width</span>
                    <div class="sidebar-range-row">
                      <input id="ts-transition-width" class="sidebar-range" type="range" min="5" max="50" step="1" value="20" />
                      <output id="ts-transition-width-val" class="sidebar-range-value" for="ts-transition-width">20%</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Width of the gradient from sharp to blurred</small>
                  </label>

                  <div class="sidebar-section-label">Color & Tone</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Vibrance</span>
                    <div class="sidebar-range-row">
                      <input id="ts-vibrance" class="sidebar-range" type="range" min="50" max="300" step="1" value="140" />
                      <output id="ts-vibrance-val" class="sidebar-range-value" for="ts-vibrance">140%</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Boosts muted colors more than vivid ones (Photoshop Vibrance)</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Saturation</span>
                    <div class="sidebar-range-row">
                      <input id="ts-saturation" class="sidebar-range" type="range" min="50" max="300" step="1" value="190" />
                      <output id="ts-saturation-val" class="sidebar-range-value" for="ts-saturation">190%</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Uniform color intensity boost</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Brightness</span>
                    <div class="sidebar-range-row">
                      <input id="ts-brightness" class="sidebar-range" type="range" min="50" max="200" step="1" value="105" />
                      <output id="ts-brightness-val" class="sidebar-range-value" for="ts-brightness">105%</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Lifts overall exposure (miniatures are typically bright)</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Contrast</span>
                    <div class="sidebar-range-row">
                      <input id="ts-contrast" class="sidebar-range" type="range" min="50" max="250" step="1" value="140" />
                      <output id="ts-contrast-val" class="sidebar-range-value" for="ts-contrast">140%</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Enhances the painted/plastic appearance</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Vignette</span>
                    <div class="sidebar-range-row">
                      <input id="ts-vignette" class="sidebar-range" type="range" min="0" max="100" step="1" value="25" />
                      <output id="ts-vignette-val" class="sidebar-range-value" for="ts-vignette">25%</output>
                    </div>
                    <small style="color: #888; font-size: 11px; margin-top: 4px; display: block;">Darkens edges to draw focus to center</small>
                  </label>
                  <button id="apply-tilt-shift" class="btn btn-accent btn-full" type="button">Apply Tilt-Shift</button>
                </div>`;

export default markup;
