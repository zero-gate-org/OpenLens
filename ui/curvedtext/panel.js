const markup = `<div class="sidebar-panel" data-panel="curvedtext">
                  <div class="sidebar-section-label">Text Items</div>
                  <div id="ct-item-list" class="ct-item-list">
                    <div class="ct-item-empty">No text items</div>
                  </div>
                  <button id="ct-add-item" class="btn btn-ghost btn-full" type="button" style="margin-top:4px;">+ Add Text</button>

                  <div class="sidebar-section-label">Text Content</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Text</span>
                    <textarea id="ct-text" class="sidebar-textarea" rows="2" placeholder="Type your curved text...">Curved Text</textarea>
                  </label>

                  <div class="sidebar-section-label">Path Type</div>
                  <div class="ct-path-type-group">
                    <button class="ct-path-type-btn active" type="button" data-mode="arc">Arc</button>
                    <button class="ct-path-type-btn" type="button" data-mode="bezier">Bezier</button>
                    <button class="ct-path-type-btn" type="button" data-mode="wave">Wave</button>
                  </div>

                  <div class="sidebar-section-label">Typography</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Font Family</span>
                    <select id="ct-font-family" class="sidebar-select">
                      <option value="Arial">Arial</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Impact">Impact</option>
                      <option value="Courier New">Courier New</option>
                      <option value="Trebuchet MS">Trebuchet MS</option>
                      <option value="Palatino">Palatino</option>
                      <option value="Comic Sans MS">Comic Sans MS</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Brush Script MT">Brush Script MT</option>
                    </select>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Google Font</span>
                    <input id="ct-google-font" class="sidebar-input" type="text" placeholder="Type font name + Enter" />
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Font Size</span>
                    <div class="sidebar-range-row">
                      <input id="ct-font-size" class="sidebar-range" type="range" min="10" max="200" step="1" value="48" />
                      <output id="ct-font-size-val" class="sidebar-range-value" for="ct-font-size">48px</output>
                    </div>
                  </label>
                  <div class="sidebar-row">
                    <label class="sidebar-check">
                      <input id="ct-font-bold" type="checkbox" />
                      <span>Bold</span>
                    </label>
                    <label class="sidebar-check">
                      <input id="ct-font-italic" type="checkbox" />
                      <span>Italic</span>
                    </label>
                  </div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Letter Spacing</span>
                    <div class="sidebar-range-row">
                      <input id="ct-letter-spacing" class="sidebar-range" type="range" min="-10" max="30" step="1" value="0" />
                      <output id="ct-letter-spacing-val" class="sidebar-range-value" for="ct-letter-spacing">0px</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Color</span>
                    <div class="sidebar-color-row">
                      <input id="ct-color" type="color" class="sidebar-color" value="#ffffff" />
                    </div>
                  </label>

                  <div class="sidebar-section-label">Alignment</div>
                  <div class="ct-align-group">
                    <button class="ct-align-btn" type="button" data-align="start">Start</button>
                    <button class="ct-align-btn active" type="button" data-align="center">Center</button>
                    <button class="ct-align-btn" type="button" data-align="end">End</button>
                  </div>

                  <div class="ct-arc-only show">
                    <div class="sidebar-section-label">Arc Side</div>
                    <div class="ct-side-group">
                      <button class="ct-side-btn active" type="button" data-side="above">Above</button>
                      <button class="ct-side-btn" type="button" data-side="below">Below</button>
                    </div>
                  </div>

                  <div class="ct-arc-only show">
                    <div class="sidebar-section-label">Arc Controls</div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Radius</span>
                      <div class="sidebar-range-row">
                        <input id="ct-arc-radius" class="sidebar-range" type="range" min="50" max="800" step="1" value="200" />
                        <output id="ct-arc-radius-val" class="sidebar-range-value" for="ct-arc-radius">200px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Start Angle</span>
                      <div class="sidebar-range-row">
                        <input id="ct-arc-angle" class="sidebar-range" type="range" min="0" max="360" step="1" value="0" />
                        <output id="ct-arc-angle-val" class="sidebar-range-value" for="ct-arc-angle">0deg</output>
                      </div>
                    </label>
                  </div>

                  <div class="ct-wave-only">
                    <div class="sidebar-section-label">Wave Controls</div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Amplitude</span>
                      <div class="sidebar-range-row">
                        <input id="ct-wave-amplitude" class="sidebar-range" type="range" min="0" max="150" step="1" value="30" />
                        <output id="ct-wave-amplitude-val" class="sidebar-range-value" for="ct-wave-amplitude">30px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Frequency</span>
                      <div class="sidebar-range-row">
                        <input id="ct-wave-frequency" class="sidebar-range" type="range" min="0.001" max="0.05" step="0.001" value="0.015" />
                        <output id="ct-wave-frequency-val" class="sidebar-range-value" for="ct-wave-frequency">0.015</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Phase</span>
                      <div class="sidebar-range-row">
                        <input id="ct-wave-phase" class="sidebar-range" type="range" min="0" max="360" step="1" value="0" />
                        <output id="ct-wave-phase-val" class="sidebar-range-value" for="ct-wave-phase">0deg</output>
                      </div>
                    </label>
                  </div>

                  <div class="sidebar-section-label">Stroke / Outline</div>
                  <div class="ct-subsection">
                    <label class="sidebar-check">
                      <input id="ct-stroke-enable" type="checkbox" />
                      <span>Enable Stroke</span>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Stroke Color</span>
                      <div class="sidebar-color-row">
                        <input id="ct-stroke-color" type="color" class="sidebar-color" value="#000000" />
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Stroke Width</span>
                      <div class="sidebar-range-row">
                        <input id="ct-stroke-width" class="sidebar-range" type="range" min="1" max="20" step="1" value="2" />
                        <output id="ct-stroke-width-val" class="sidebar-range-value" for="ct-stroke-width">2px</output>
                      </div>
                    </label>
                  </div>

                  <div class="sidebar-section-label">Shadow</div>
                  <div class="ct-subsection">
                    <label class="sidebar-check">
                      <input id="ct-shadow-enable" type="checkbox" />
                      <span>Enable Shadow</span>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Shadow Color</span>
                      <div class="sidebar-color-row">
                        <input id="ct-shadow-color" type="color" class="sidebar-color" value="#000000" />
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Blur</span>
                      <div class="sidebar-range-row">
                        <input id="ct-shadow-blur" class="sidebar-range" type="range" min="0" max="30" step="1" value="8" />
                        <output id="ct-shadow-blur-val" class="sidebar-range-value" for="ct-shadow-blur">8px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Offset X</span>
                      <div class="sidebar-range-row">
                        <input id="ct-shadow-ox" class="sidebar-range" type="range" min="-20" max="20" step="1" value="3" />
                        <output id="ct-shadow-ox-val" class="sidebar-range-value" for="ct-shadow-ox">3px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Offset Y</span>
                      <div class="sidebar-range-row">
                        <input id="ct-shadow-oy" class="sidebar-range" type="range" min="-20" max="20" step="1" value="3" />
                        <output id="ct-shadow-oy-val" class="sidebar-range-value" for="ct-shadow-oy">3px</output>
                      </div>
                    </label>
                  </div>

                  <div class="sidebar-section-label">Presets</div>
                  <div class="ct-presets">
                    <button class="ct-preset-btn" type="button" data-preset="badge-top">Badge Top</button>
                    <button class="ct-preset-btn" type="button" data-preset="badge-bottom">Badge Bottom</button>
                    <button class="ct-preset-btn" type="button" data-preset="wavy-graffiti">Wavy Graffiti</button>
                    <button class="ct-preset-btn" type="button" data-preset="swoosh">Swoosh</button>
                    <button class="ct-preset-btn" type="button" data-preset="circle-stamp">Circle Stamp</button>
                  </div>

                  <div class="sidebar-row" style="margin-top:8px;">
                    <button id="ct-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="ct-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
