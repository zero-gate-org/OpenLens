const markup = `<div class="sidebar-panel" data-panel="stroketext">
                  <div class="sidebar-section-label">Text Content</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Text</span>
                    <textarea id="st-text" class="sidebar-textarea" rows="2" placeholder="Type your stroke text...">Stroke Text</textarea>
                  </label>

                  <div class="sidebar-section-label">Typography</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Font Family</span>
                    <select id="st-font-family" class="sidebar-select">
                      <option value="Arial">Arial</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Impact">Impact</option>
                      <option value="Courier New">Courier New</option>
                      <option value="Trebuchet MS">Trebuchet MS</option>
                      <option value="Palatino">Palatino</option>
                      <option value="Comic Sans MS">Comic Sans MS</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Inter">Inter</option>
                      <option value="Montserrat">Montserrat</option>
                      <option value="Oswald">Oswald</option>
                    </select>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Google Font</span>
                    <input id="st-google-font" class="sidebar-input" type="text" placeholder="Type font name + Enter" />
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Font Size</span>
                    <div class="sidebar-range-row">
                      <input id="st-font-size" class="sidebar-range" type="range" min="10" max="300" step="1" value="72" />
                      <output id="st-font-size-val" class="sidebar-range-value" for="st-font-size">72px</output>
                    </div>
                  </label>
                  <div class="sidebar-row">
                    <label class="sidebar-check">
                      <input id="st-font-bold" type="checkbox" checked />
                      <span>Bold</span>
                    </label>
                    <label class="sidebar-check">
                      <input id="st-font-italic" type="checkbox" />
                      <span>Italic</span>
                    </label>
                  </div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Text Align</span>
                    <div class="st-align-group">
                      <button class="st-align-btn" type="button" data-align="left">Left</button>
                      <button class="st-align-btn active" type="button" data-align="center">Center</button>
                      <button class="st-align-btn" type="button" data-align="right">Right</button>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Position & Wrap</div>
                  <div class="sidebar-row">
                    <label class="sidebar-field">
                      <span class="sidebar-label">X</span>
                      <input id="st-x" class="sidebar-input" type="number" min="0" step="1" />
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Y</span>
                      <input id="st-y" class="sidebar-input" type="number" min="0" step="1" />
                    </label>
                  </div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Rotation</span>
                    <div class="sidebar-range-row">
                      <input id="st-rotation" class="sidebar-range" type="range" min="-180" max="180" step="1" value="0" />
                      <output id="st-rotation-val" class="sidebar-range-value" for="st-rotation">0°</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Max Width (wrap)</span>
                    <div class="sidebar-range-row">
                      <input id="st-max-width" class="sidebar-range" type="range" min="0" max="2000" step="10" value="0" />
                      <output id="st-max-width-val" class="sidebar-range-value" for="st-max-width">0px</output>
                    </div>
                    <small style="color:#888;font-size:11px;margin-top:4px;display:block;">0 = no wrapping. Set value to enable word-wrap.</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Line Height</span>
                    <div class="sidebar-range-row">
                      <input id="st-line-height" class="sidebar-range" type="range" min="80" max="250" step="1" value="120" />
                      <output id="st-line-height-val" class="sidebar-range-value" for="st-line-height">1.2x</output>
                    </div>
                  </label>

                  <!-- Style Presets -->
                  <div class="sidebar-section-label">Style Presets</div>
                  <div class="st-presets-row">
                    <div class="st-preset-card" data-preset="classic-outline">
                      <div class="st-preset-thumb"></div>
                      <div class="st-preset-name">Classic</div>
                    </div>
                    <div class="st-preset-card" data-preset="neon-sign">
                      <div class="st-preset-thumb"></div>
                      <div class="st-preset-name">Neon</div>
                    </div>
                    <div class="st-preset-card" data-preset="retro-chrome">
                      <div class="st-preset-thumb"></div>
                      <div class="st-preset-name">Chrome</div>
                    </div>
                    <div class="st-preset-card" data-preset="knockout">
                      <div class="st-preset-thumb"></div>
                      <div class="st-preset-name">Knockout</div>
                    </div>
                    <div class="st-preset-card" data-preset="double-stroke">
                      <div class="st-preset-thumb"></div>
                      <div class="st-preset-name">Double</div>
                    </div>
                    <div class="st-preset-card" data-preset="comic-book">
                      <div class="st-preset-thumb"></div>
                      <div class="st-preset-name">Comic</div>
                    </div>
                    <div class="st-preset-card" data-preset="soft-shadow">
                      <div class="st-preset-thumb"></div>
                      <div class="st-preset-name">Shadow</div>
                    </div>
                    <div class="st-preset-card" data-preset="emboss">
                      <div class="st-preset-thumb"></div>
                      <div class="st-preset-name">Emboss</div>
                    </div>
                    <div class="st-preset-card" data-preset="vintage-stamp">
                      <div class="st-preset-thumb"></div>
                      <div class="st-preset-name">Vintage</div>
                    </div>
                    <div class="st-preset-card" data-preset="glassmorphism">
                      <div class="st-preset-thumb"></div>
                      <div class="st-preset-name">Glass</div>
                    </div>
                  </div>

                  <!-- Tabs: Fill / Stroke / Glow -->
                  <div class="sidebar-section-label">Style Details</div>
                  <div class="st-tab-bar">
                    <button class="st-tab-btn active" type="button" data-tab="fill">Fill</button>
                    <button class="st-tab-btn" type="button" data-tab="stroke">Stroke</button>
                    <button class="st-tab-btn" type="button" data-tab="glow">Glow</button>
                  </div>

                  <!-- FILL TAB -->
                  <div class="st-tab-panel active" data-tab="fill">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Fill Type</span>
                      <div class="st-segment-group">
                        <button class="st-fill-type-btn active" type="button" data-filltype="solid">Solid</button>
                        <button class="st-fill-type-btn" type="button" data-filltype="linear">Linear</button>
                        <button class="st-fill-type-btn" type="button" data-filltype="radial">Radial</button>
                        <button class="st-fill-type-btn" type="button" data-filltype="none">None</button>
                      </div>
                    </label>
                    <div class="st-solid-only">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Fill Color</span>
                        <div class="sidebar-color-row">
                          <input id="st-fill-color" type="color" class="sidebar-color" value="#ffffff" />
                        </div>
                      </label>
                    </div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Fill Opacity</span>
                      <div class="sidebar-range-row">
                        <input id="st-fill-opacity" class="sidebar-range" type="range" min="0" max="100" step="1" value="100" />
                        <output id="st-fill-opacity-val" class="sidebar-range-value" for="st-fill-opacity">100%</output>
                      </div>
                    </label>
                    <div class="st-grad-only" style="display:none;">
                      <div class="sidebar-row">
                        <label class="sidebar-field">
                          <span class="sidebar-label">Color 1</span>
                          <div class="sidebar-color-row">
                            <input id="st-grad-color1" type="color" class="sidebar-color" value="#ffffff" />
                          </div>
                        </label>
                        <label class="sidebar-field">
                          <span class="sidebar-label">Color 2</span>
                          <div class="sidebar-color-row">
                            <input id="st-grad-color2" type="color" class="sidebar-color" value="#333333" />
                          </div>
                        </label>
                      </div>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Gradient Angle</span>
                        <div class="sidebar-range-row">
                          <input id="st-grad-angle" class="sidebar-range" type="range" min="0" max="360" step="1" value="0" />
                          <output id="st-grad-angle-val" class="sidebar-range-value" for="st-grad-angle">0°</output>
                        </div>
                      </label>
                    </div>
                  </div>

                  <!-- STROKE TAB -->
                  <div class="st-tab-panel" data-tab="stroke">
                    <label class="sidebar-check">
                      <input id="st-stroke-enable" type="checkbox" checked />
                      <span>Enable Stroke</span>
                    </label>
                    <div class="st-subsection">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Stroke Color</span>
                        <div class="sidebar-color-row">
                          <input id="st-stroke-color" type="color" class="sidebar-color" value="#000000" />
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Stroke Width</span>
                        <div class="sidebar-range-row">
                          <input id="st-stroke-width" class="sidebar-range" type="range" min="0" max="50" step="1" value="3" />
                          <output id="st-stroke-width-val" class="sidebar-range-value" for="st-stroke-width">3px</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Stroke Opacity</span>
                        <div class="sidebar-range-row">
                          <input id="st-stroke-opacity" class="sidebar-range" type="range" min="0" max="100" step="1" value="100" />
                          <output id="st-stroke-opacity-val" class="sidebar-range-value" for="st-stroke-opacity">100%</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Stroke Position</span>
                        <div class="st-segment-group">
                          <button class="st-stroke-pos-btn" type="button" data-pos="outside">Outside</button>
                          <button class="st-stroke-pos-btn active" type="button" data-pos="center">Center</button>
                          <button class="st-stroke-pos-btn" type="button" data-pos="inside">Inside</button>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Line Join</span>
                        <div class="st-segment-group">
                          <button class="st-join-btn active" type="button" data-join="round">Round</button>
                          <button class="st-join-btn" type="button" data-join="miter">Miter</button>
                          <button class="st-join-btn" type="button" data-join="bevel">Bevel</button>
                        </div>
                      </label>
                    </div>

                    <div class="sidebar-section-label">Double Stroke</div>
                    <label class="sidebar-check">
                      <input id="st-double-stroke-enable" type="checkbox" />
                      <span>Enable Double Stroke</span>
                    </label>
                    <div class="st-double-stroke-sub">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Outer Color</span>
                        <div class="sidebar-color-row">
                          <input id="st-double-stroke-color" type="color" class="sidebar-color" value="#ff6b35" />
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Outer Width</span>
                        <div class="sidebar-range-row">
                          <input id="st-double-stroke-width" class="sidebar-range" type="range" min="1" max="50" step="1" value="6" />
                          <output id="st-double-stroke-width-val" class="sidebar-range-value" for="st-double-stroke-width">6px</output>
                        </div>
                      </label>
                    </div>
                  </div>

                  <!-- GLOW / SHADOW TAB -->
                  <div class="st-tab-panel" data-tab="glow">
                    <div class="sidebar-section-label">Outer Glow</div>
                    <label class="sidebar-check">
                      <input id="st-glow-enable" type="checkbox" />
                      <span>Enable Outer Glow</span>
                    </label>
                    <div class="st-subsection">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Glow Color</span>
                        <div class="sidebar-color-row">
                          <input id="st-glow-color" type="color" class="sidebar-color" value="#00ffff" />
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Blur Radius</span>
                        <div class="sidebar-range-row">
                          <input id="st-glow-blur" class="sidebar-range" type="range" min="0" max="60" step="1" value="20" />
                          <output id="st-glow-blur-val" class="sidebar-range-value" for="st-glow-blur">20px</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Glow Opacity</span>
                        <div class="sidebar-range-row">
                          <input id="st-glow-opacity" class="sidebar-range" type="range" min="0" max="100" step="1" value="80" />
                          <output id="st-glow-opacity-val" class="sidebar-range-value" for="st-glow-opacity">80%</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Glow Layers</span>
                        <div class="sidebar-range-row">
                          <input id="st-glow-layers" class="sidebar-range" type="range" min="1" max="5" step="1" value="3" />
                          <output id="st-glow-layers-val" class="sidebar-range-value" for="st-glow-layers">3</output>
                        </div>
                      </label>
                    </div>

                    <div class="sidebar-section-label">Drop Shadow</div>
                    <label class="sidebar-check">
                      <input id="st-shadow-enable" type="checkbox" />
                      <span>Enable Drop Shadow</span>
                    </label>
                    <div class="st-subsection">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Shadow Color</span>
                        <div class="sidebar-color-row">
                          <input id="st-shadow-color" type="color" class="sidebar-color" value="#000000" />
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Shadow Blur</span>
                        <div class="sidebar-range-row">
                          <input id="st-shadow-blur" class="sidebar-range" type="range" min="0" max="50" step="1" value="15" />
                          <output id="st-shadow-blur-val" class="sidebar-range-value" for="st-shadow-blur">15px</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Offset X</span>
                        <div class="sidebar-range-row">
                          <input id="st-shadow-ox" class="sidebar-range" type="range" min="-50" max="50" step="1" value="5" />
                          <output id="st-shadow-ox-val" class="sidebar-range-value" for="st-shadow-ox">5px</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Offset Y</span>
                        <div class="sidebar-range-row">
                          <input id="st-shadow-oy" class="sidebar-range" type="range" min="-50" max="50" step="1" value="8" />
                          <output id="st-shadow-oy-val" class="sidebar-range-value" for="st-shadow-oy">8px</output>
                        </div>
                      </label>
                    </div>

                    <div class="sidebar-section-label">Inner Shadow</div>
                    <label class="sidebar-check">
                      <input id="st-inner-shadow-enable" type="checkbox" />
                      <span>Enable Inner Shadow</span>
                    </label>
                    <div class="st-subsection">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Inner Color</span>
                        <div class="sidebar-color-row">
                          <input id="st-inner-shadow-color" type="color" class="sidebar-color" value="#000000" />
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Inner Blur</span>
                        <div class="sidebar-range-row">
                          <input id="st-inner-shadow-blur" class="sidebar-range" type="range" min="0" max="30" step="1" value="5" />
                          <output id="st-inner-shadow-blur-val" class="sidebar-range-value" for="st-inner-shadow-blur">5px</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Offset X</span>
                        <div class="sidebar-range-row">
                          <input id="st-inner-shadow-ox" class="sidebar-range" type="range" min="-20" max="20" step="1" value="2" />
                          <output id="st-inner-shadow-ox-val" class="sidebar-range-value" for="st-inner-shadow-ox">2px</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Offset Y</span>
                        <div class="sidebar-range-row">
                          <input id="st-inner-shadow-oy" class="sidebar-range" type="range" min="-20" max="20" step="1" value="2" />
                          <output id="st-inner-shadow-oy-val" class="sidebar-range-value" for="st-inner-shadow-oy">2px</output>
                        </div>
                      </label>
                    </div>
                  </div>

                  <!-- Master Opacity -->
                  <div class="sidebar-section-label">Master Opacity</div>
                  <label class="sidebar-field">
                    <div class="sidebar-range-row">
                      <input id="st-master-opacity" class="sidebar-range" type="range" min="0" max="100" step="1" value="100" />
                      <output id="st-master-opacity-val" class="sidebar-range-value" for="st-master-opacity">100%</output>
                    </div>
                  </label>

                  <div class="sidebar-row" style="margin-top:8px;">
                    <button id="st-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="st-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
