const markup = `<div class="sidebar-panel" data-panel="photoframe">
                  <div class="sidebar-section-label">Border Widths</div>
                  <label class="sidebar-check">
                    <input type="checkbox" id="pf-uniform-border" checked />
                    <span>Uniform borders</span>
                  </label>
                  <div id="pf-uniform-controls">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Border Size</span>
                      <div class="sidebar-range-row">
                        <input id="pf-border-size" class="sidebar-range" type="range" min="0" max="800" step="1" value="30" />
                        <output id="pf-border-size-val" class="sidebar-range-value" for="pf-border-size">30px</output>
                      </div>
                    </label>
                  </div>
                  <div id="pf-custom-controls" style="display:none">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Top</span>
                      <div class="sidebar-range-row">
                        <input id="pf-border-top" class="sidebar-range" type="range" min="0" max="800" step="1" value="30" />
                        <output id="pf-border-top-val" class="sidebar-range-value" for="pf-border-top">30px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Right</span>
                      <div class="sidebar-range-row">
                        <input id="pf-border-right" class="sidebar-range" type="range" min="0" max="800" step="1" value="30" />
                        <output id="pf-border-right-val" class="sidebar-range-value" for="pf-border-right">30px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Bottom</span>
                      <div class="sidebar-range-row">
                        <input id="pf-border-bottom" class="sidebar-range" type="range" min="0" max="800" step="1" value="100" />
                        <output id="pf-border-bottom-val" class="sidebar-range-value" for="pf-border-bottom">100px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Left</span>
                      <div class="sidebar-range-row">
                        <input id="pf-border-left" class="sidebar-range" type="range" min="0" max="800" step="1" value="30" />
                        <output id="pf-border-left-val" class="sidebar-range-value" for="pf-border-left">30px</output>
                      </div>
                    </label>
                  </div>

                  <div class="sidebar-section-label">Frame Style</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Background Color</span>
                    <div class="sidebar-color-row">
                      <input id="pf-bg-color" type="color" class="sidebar-color" value="#ffffff" />
                    </div>
                  </label>
                  <label class="sidebar-check">
                    <input type="checkbox" id="pf-transparent-bg" />
                    <span>Transparent background</span>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Corner Radius</span>
                    <div class="sidebar-range-row">
                      <input id="pf-corner-radius" class="sidebar-range" type="range" min="0" max="40" step="1" value="12" />
                      <output id="pf-corner-radius-val" class="sidebar-range-value" for="pf-corner-radius">12px</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Drop Shadow</div>
                  <label class="sidebar-check">
                    <input type="checkbox" id="pf-shadow-enabled" checked />
                    <span>Enable shadow</span>
                  </label>
                  <div id="pf-shadow-controls">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Shadow Color</span>
                      <div class="sidebar-color-row">
                        <input id="pf-shadow-color" type="color" class="sidebar-color" value="#000000" />
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Blur</span>
                      <div class="sidebar-range-row">
                        <input id="pf-shadow-blur" class="sidebar-range" type="range" min="0" max="40" step="1" value="20" />
                        <output id="pf-shadow-blur-val" class="sidebar-range-value" for="pf-shadow-blur">20px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Offset X</span>
                      <div class="sidebar-range-row">
                        <input id="pf-shadow-x" class="sidebar-range" type="range" min="-30" max="30" step="1" value="5" />
                        <output id="pf-shadow-x-val" class="sidebar-range-value" for="pf-shadow-x">5px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Offset Y</span>
                      <div class="sidebar-range-row">
                        <input id="pf-shadow-y" class="sidebar-range" type="range" min="-30" max="30" step="1" value="8" />
                        <output id="pf-shadow-y-val" class="sidebar-range-value" for="pf-shadow-y">8px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Opacity</span>
                      <div class="sidebar-range-row">
                        <input id="pf-shadow-opacity" class="sidebar-range" type="range" min="0" max="100" step="1" value="35" />
                        <output id="pf-shadow-opacity-val" class="sidebar-range-value" for="pf-shadow-opacity">35%</output>
                      </div>
                    </label>
                  </div>

                  <div class="sidebar-section-label">Rotation</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Tilt Angle</span>
                    <div class="sidebar-range-row">
                      <input id="pf-rotation" class="sidebar-range" type="range" min="-15" max="15" step="0.5" value="0" />
                      <output id="pf-rotation-val" class="sidebar-range-value" for="pf-rotation">0°</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Caption</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Caption Text</span>
                    <input id="pf-caption-text" class="sidebar-input" type="text" placeholder="Summer 2026" />
                  </label>
                  <label class="sidebar-check">
                    <input type="checkbox" id="pf-caption-date" />
                    <span>Show date</span>
                  </label>
                  <div id="pf-date-custom-wrap" style="display:none">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Custom Date</span>
                      <input id="pf-caption-date-text" class="sidebar-input" type="text" placeholder="Auto: today's date" />
                    </label>
                  </div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Font Family</span>
                    <select id="pf-caption-font" class="sidebar-select">
                      <option value="&quot;Brush Script MT&quot;, cursive">Brush Script</option>
                      <option value="&quot;Courier New&quot;, monospace">Courier New</option>
                      <option value="&quot;Dancing Script&quot;, cursive">Dancing Script</option>
                      <option value="Georgia, serif">Georgia</option>
                      <option value="&quot;Playfair Display&quot;, serif">Playfair Display</option>
                      <option value="Inter, sans-serif">Inter</option>
                    </select>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Font Size</span>
                    <div class="sidebar-range-row">
                      <input id="pf-caption-size" class="sidebar-range" type="range" min="8" max="48" step="1" value="22" />
                      <output id="pf-caption-size-val" class="sidebar-range-value" for="pf-caption-size">22px</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Font Color</span>
                    <div class="sidebar-color-row">
                      <input id="pf-caption-color" type="color" class="sidebar-color" value="#333333" />
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Text Align</span>
                    <select id="pf-caption-align" class="sidebar-select">
                      <option value="center">Center</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                  <div class="sidebar-row">
                    <label class="sidebar-check">
                      <input type="checkbox" id="pf-caption-bold" />
                      <span>Bold</span>
                    </label>
                    <label class="sidebar-check">
                      <input type="checkbox" id="pf-caption-italic" />
                      <span>Italic</span>
                    </label>
                  </div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Vertical Position</span>
                    <div class="sidebar-range-row">
                      <input id="pf-caption-y" class="sidebar-range" type="range" min="0" max="100" step="1" value="50" />
                      <output id="pf-caption-y-val" class="sidebar-range-value" for="pf-caption-y">50%</output>
                    </div>
                  </label>

                  <div id="pf-neon-section" style="display:none">
                    <div class="sidebar-section-label">Neon Options</div>
                    <div id="pf-neon-colors" class="pf-neon-swatches">
                      <button type="button" class="pf-neon-swatch is-active" data-color="#00ffff" style="background:#00ffff" title="Cyan"></button>
                      <button type="button" class="pf-neon-swatch" data-color="#ff00ff" style="background:#ff00ff" title="Magenta"></button>
                      <button type="button" class="pf-neon-swatch" data-color="#00ff88" style="background:#00ff88" title="Green"></button>
                      <button type="button" class="pf-neon-swatch" data-color="#ff6b00" style="background:#ff6b00" title="Orange"></button>
                      <button type="button" class="pf-neon-swatch" data-color="#ff0080" style="background:#ff0080" title="Pink"></button>
                    </div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Glow Layers</span>
                      <div class="sidebar-range-row">
                        <input id="pf-neon-glow" class="sidebar-range" type="range" min="1" max="5" step="1" value="3" />
                        <output id="pf-neon-glow-val" class="sidebar-range-value" for="pf-neon-glow">3</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Neon Border Width</span>
                      <div class="sidebar-range-row">
                        <input id="pf-neon-width" class="sidebar-range" type="range" min="1" max="10" step="1" value="3" />
                        <output id="pf-neon-width-val" class="sidebar-range-value" for="pf-neon-width">3px</output>
                      </div>
                    </label>
                  </div>

                  <div class="sidebar-section-label">Presets</div>
                  <div id="pf-presets" class="pf-presets">
                    <button type="button" class="pf-preset-btn" data-preset="classic-polaroid">Classic Polaroid</button>
                    <button type="button" class="pf-preset-btn" data-preset="night-neon">Night Neon</button>
                    <button type="button" class="pf-preset-btn" data-preset="vintage-memory">Vintage Memory</button>
                    <button type="button" class="pf-preset-btn" data-preset="film-reel">Film Reel</button>
                    <button type="button" class="pf-preset-btn" data-preset="clean-passport">Clean Passport</button>
                  </div>

                  <div class="sidebar-row" style="margin-top:4px;">
                    <button id="pf-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="pf-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
