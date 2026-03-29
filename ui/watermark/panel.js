const markup = `<div class="sidebar-panel" data-panel="watermark">
                  <div class="sidebar-section-label">Watermark Type</div>
                  <div class="wm-type-group">
                    <label class="wm-type-btn active">
                      <input class="wm-type-radio" type="radio" name="wm-type" value="text" checked />
                      Text
                    </label>
                    <label class="wm-type-btn">
                      <input class="wm-type-radio" type="radio" name="wm-type" value="image" />
                      Image
                    </label>
                    <label class="wm-type-btn">
                      <input class="wm-type-radio" type="radio" name="wm-type" value="tiled" />
                      Tiled
                    </label>
                  </div>

                  <!-- TEXT TAB -->
                  <div id="wm-text-tab" class="wm-tab-content">
                    <div class="sidebar-section-label">Text Settings</div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Text</span>
                      <input id="wm-text" class="sidebar-input" type="text" value="© Your Name 2026" />
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Font</span>
                      <select id="wm-font-family" class="sidebar-select">
                        <option value="Inter">Inter</option>
                        <option value="Arial">Arial</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Playfair Display">Playfair Display</option>
                        <option value="Montserrat">Montserrat</option>
                        <option value="Oswald">Oswald</option>
                        <option value="Dancing Script">Dancing Script</option>
                        <option value="Roboto Slab">Roboto Slab</option>
                        <option value="Courier New">Courier New</option>
                        <option value="Impact">Impact</option>
                      </select>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Font Size</span>
                      <div class="sidebar-range-row">
                        <input id="wm-font-size" class="sidebar-range" type="range" min="8" max="200" step="1" value="48" />
                        <output id="wm-font-size-val" class="sidebar-range-value" for="wm-font-size">48px</output>
                      </div>
                    </label>
                    <div class="sidebar-field">
                      <span class="sidebar-label">Style</span>
                      <div class="wm-style-row">
                        <label class="wm-style-toggle">
                          <input id="wm-bold" type="checkbox" />
                          <span class="wm-toggle-btn"><strong>B</strong></span>
                        </label>
                        <label class="wm-style-toggle">
                          <input id="wm-italic" type="checkbox" />
                          <span class="wm-toggle-btn"><em>I</em></span>
                        </label>
                        <label class="sidebar-field" style="flex:1;margin:0">
                          <select id="wm-align" class="sidebar-select">
                            <option value="left">Left</option>
                            <option value="center" selected>Center</option>
                            <option value="right">Right</option>
                          </select>
                        </label>
                      </div>
                    </div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Color</span>
                      <div class="sidebar-color-row">
                        <input id="wm-color" type="color" class="sidebar-color" value="#ffffff" />
                      </div>
                    </label>
                    <label class="sidebar-check">
                      <input id="wm-stroke-enabled" type="checkbox" />
                      <span>Stroke</span>
                    </label>
                    <div id="wm-stroke-controls" class="wm-stroke-controls" style="display:none">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Stroke Color</span>
                        <div class="sidebar-color-row">
                          <input id="wm-stroke-color" type="color" class="sidebar-color" value="#000000" />
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Stroke Width</span>
                        <div class="sidebar-range-row">
                          <input id="wm-stroke-width" class="sidebar-range" type="range" min="1" max="20" step="1" value="2" />
                          <output id="wm-stroke-width-val" class="sidebar-range-value" for="wm-stroke-width">2px</output>
                        </div>
                      </label>
                    </div>
                  </div>

                  <!-- IMAGE TAB -->
                  <div id="wm-image-tab" class="wm-tab-content" style="display:none">
                    <div class="sidebar-section-label">Image / Logo</div>
                    <div class="wm-upload-area">
                      <input id="wm-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden />
                      <button id="wm-upload-btn" class="btn btn-ghost btn-full" type="button">Upload Logo (PNG / SVG)</button>
                      <span id="wm-image-name" class="wm-image-name">No image selected</span>
                    </div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Scale</span>
                      <div class="sidebar-range-row">
                        <input id="wm-image-scale" class="sidebar-range" type="range" min="5" max="200" step="1" value="15" />
                        <output id="wm-image-scale-val" class="sidebar-range-value" for="wm-image-scale">15%</output>
                      </div>
                    </label>
                  </div>

                  <!-- TILED TAB -->
                  <div id="wm-tiled-tab" class="wm-tab-content" style="display:none">
                    <div class="sidebar-section-label">Tiled Settings</div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Tile Source</span>
                      <select id="wm-tile-source" class="sidebar-select">
                        <option value="text">Use text settings</option>
                        <option value="image">Use image settings</option>
                      </select>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Tile Size</span>
                      <div class="sidebar-range-row">
                        <input id="wm-tile-size" class="sidebar-range" type="range" min="100" max="500" step="10" value="200" />
                        <output id="wm-tile-size-val" class="sidebar-range-value" for="wm-tile-size">200px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Tile Gap</span>
                      <div class="sidebar-range-row">
                        <input id="wm-tile-gap" class="sidebar-range" type="range" min="0" max="200" step="5" value="20" />
                        <output id="wm-tile-gap-val" class="sidebar-range-value" for="wm-tile-gap">20px</output>
                      </div>
                    </label>
                  </div>

                  <!-- SHARED CONTROLS -->
                  <div class="sidebar-section-label">Appearance</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Opacity</span>
                    <div class="sidebar-range-row">
                      <input id="wm-opacity" class="sidebar-range" type="range" min="0" max="100" step="1" value="50" />
                      <output id="wm-opacity-val" class="sidebar-range-value" for="wm-opacity">50%</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Rotation</span>
                    <div class="sidebar-range-row">
                      <input id="wm-rotation" class="sidebar-range" type="range" min="-180" max="180" step="1" value="0" />
                      <output id="wm-rotation-val" class="sidebar-range-value" for="wm-rotation">0°</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Blend Mode</span>
                    <select id="wm-blend-mode" class="sidebar-select">
                      <option value="source-over">Normal</option>
                      <option value="multiply">Multiply</option>
                      <option value="screen">Screen</option>
                      <option value="overlay">Overlay</option>
                      <option value="soft-light">Soft Light</option>
                    </select>
                  </label>

                  <div class="sidebar-section-label">Position</div>
                  <div id="wm-position-grid" class="wm-position-grid">
                    <button type="button" class="wm-pos-btn" data-pos="top-left" title="Top Left">↖</button>
                    <button type="button" class="wm-pos-btn" data-pos="top-center" title="Top Center">↑</button>
                    <button type="button" class="wm-pos-btn" data-pos="top-right" title="Top Right">↗</button>
                    <button type="button" class="wm-pos-btn" data-pos="middle-left" title="Middle Left">←</button>
                    <button type="button" class="wm-pos-btn active" data-pos="center" title="Center">●</button>
                    <button type="button" class="wm-pos-btn" data-pos="middle-right" title="Middle Right">→</button>
                    <button type="button" class="wm-pos-btn" data-pos="bottom-left" title="Bottom Left">↙</button>
                    <button type="button" class="wm-pos-btn" data-pos="bottom-center" title="Bottom Center">↓</button>
                    <button type="button" class="wm-pos-btn" data-pos="bottom-right" title="Bottom Right">↘</button>
                  </div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Fine-Tune X</span>
                    <input id="wm-pos-x" class="sidebar-input" type="number" value="0" step="1" />
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Fine-Tune Y</span>
                    <input id="wm-pos-y" class="sidebar-input" type="number" value="0" step="1" />
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Safe Margin</span>
                    <div class="sidebar-range-row">
                      <input id="wm-margin" class="sidebar-range" type="range" min="0" max="20" step="1" value="5" />
                      <output id="wm-margin-val" class="sidebar-range-value" for="wm-margin">5%</output>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Saved Watermarks</div>
                  <div class="wm-preset-row">
                    <input id="wm-preset-name" class="sidebar-input" type="text" placeholder="Preset name" style="flex:1;min-width:0" />
                    <button id="wm-save-preset" class="btn btn-ghost" type="button" style="white-space:nowrap">Save</button>
                  </div>
                  <select id="wm-saved-presets" class="sidebar-select">
                    <option value="">Load a preset…</option>
                  </select>

                  <div class="sidebar-section-label">Quick Presets</div>
                  <div id="wm-presets" class="wm-presets"></div>

                  <button id="wm-auto-size" class="btn btn-ghost btn-full" type="button" style="margin-top:4px">Auto-size</button>

                  <div class="sidebar-row" style="margin-top:4px;">
                    <button id="wm-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="wm-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
