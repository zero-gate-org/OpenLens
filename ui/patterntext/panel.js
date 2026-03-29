const markup = `<div class="sidebar-panel" data-panel="patterntext">
                  <div class="sidebar-section-label">Text Content</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Text</span>
                    <textarea id="pt-text" class="sidebar-textarea" rows="2" placeholder="Type your pattern text...">Pattern\nText</textarea>
                  </label>

                  <div class="sidebar-section-label">Typography</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Font Family</span>
                    <select id="pt-font-family" class="sidebar-select">
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
                    <input id="pt-google-font" class="sidebar-input" type="text" placeholder="Type font name + Enter" />
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Font Size</span>
                    <div class="sidebar-range-row">
                      <input id="pt-font-size" class="sidebar-range" type="range" min="20" max="400" step="1" value="120" />
                      <output id="pt-font-size-val" class="sidebar-range-value" for="pt-font-size">120px</output>
                    </div>
                  </label>
                  <div class="sidebar-row">
                    <label class="sidebar-check">
                      <input id="pt-font-bold" type="checkbox" checked />
                      <span>Bold</span>
                    </label>
                    <label class="sidebar-check">
                      <input id="pt-font-italic" type="checkbox" />
                      <span>Italic</span>
                    </label>
                  </div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Letter Spacing</span>
                    <div class="sidebar-range-row">
                      <input id="pt-letter-spacing" class="sidebar-range" type="range" min="-10" max="60" step="1" value="4" />
                      <output id="pt-letter-spacing-val" class="sidebar-range-value" for="pt-letter-spacing">4px</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Line Height</span>
                    <div class="sidebar-range-row">
                      <input id="pt-line-height" class="sidebar-range" type="range" min="80" max="300" step="1" value="120" />
                      <output id="pt-line-height-val" class="sidebar-range-value" for="pt-line-height">1.2x</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Text Align</span>
                    <div class="pt-align-group">
                      <button class="pt-align-btn" type="button" data-align="left">Left</button>
                      <button class="pt-align-btn active" type="button" data-align="center">Center</button>
                      <button class="pt-align-btn" type="button" data-align="right">Right</button>
                    </div>
                  </label>

                  <div class="sidebar-section-label">Position & Rotation</div>
                  <div class="sidebar-row">
                    <label class="sidebar-field">
                      <span class="sidebar-label">X</span>
                      <input id="pt-x" class="sidebar-input" type="number" min="0" step="1" />
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Y</span>
                      <input id="pt-y" class="sidebar-input" type="number" min="0" step="1" />
                    </label>
                  </div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Rotation</span>
                    <div class="sidebar-range-row">
                      <input id="pt-rotation" class="sidebar-range" type="range" min="-180" max="180" step="1" value="0" />
                      <output id="pt-rotation-val" class="sidebar-range-value" for="pt-rotation">0°</output>
                    </div>
                  </label>

                  <!-- Pattern Selector -->
                  <div class="sidebar-section-label">Pattern Type</div>
                  <div class="pt-pattern-grid">
                    <div class="pt-pattern-card active" data-pattern="polka">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Polka</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="stripes">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Stripes</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="checker">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Checker</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="crosshatch">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Cross</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="diagcross">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Diag X</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="honeycomb">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Honey</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="zigzag">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Zigzag</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="circles">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Circles</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="halftone">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Halftone</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="brick">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Brick</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="stars">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Stars</div>
                    </div>
                    <div class="pt-pattern-card" data-pattern="stamp">
                      <div class="pt-pattern-thumb"></div>
                      <div class="pt-pattern-name">Stamp</div>
                    </div>
                  </div>

                  <!-- Pattern Scale & Rotation -->
                  <div class="sidebar-section-label">Pattern Transform</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Scale</span>
                    <div class="sidebar-range-row">
                      <input id="pt-pattern-scale" class="sidebar-range" type="range" min="25" max="400" step="1" value="100" />
                      <output id="pt-pattern-scale-val" class="sidebar-range-value" for="pt-pattern-scale">1x</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Rotation</span>
                    <div class="sidebar-range-row">
                      <input id="pt-pattern-rotation" class="sidebar-range" type="range" min="0" max="360" step="1" value="0" />
                      <output id="pt-pattern-rotation-val" class="sidebar-range-value" for="pt-pattern-rotation">0°</output>
                    </div>
                  </label>

                  <!-- Shared Colors -->
                  <div class="sidebar-section-label">Colors</div>
                  <div class="sidebar-row">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Foreground</span>
                      <div class="sidebar-color-row">
                        <input id="pt-foreground" type="color" class="sidebar-color" value="#000000" />
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Background</span>
                      <div class="sidebar-color-row">
                        <input id="pt-background" type="color" class="sidebar-color" value="#ffffff" />
                      </div>
                    </label>
                  </div>

                  <!-- Pattern-Specific Controls -->
                  <div class="sidebar-section-label">Pattern Settings</div>

                  <!-- Polka Dots -->
                  <div class="pt-pattern-controls" data-pattern="polka">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Dot Size</span>
                      <div class="sidebar-range-row">
                        <input id="pt-dot-size" class="sidebar-range" type="range" min="2" max="40" step="1" value="12" />
                        <output id="pt-dot-size-val" class="sidebar-range-value" for="pt-dot-size">12px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Spacing</span>
                      <div class="sidebar-range-row">
                        <input id="pt-dot-spacing" class="sidebar-range" type="range" min="0" max="40" step="1" value="8" />
                        <output id="pt-dot-spacing-val" class="sidebar-range-value" for="pt-dot-spacing">8px</output>
                      </div>
                    </label>
                    <label class="sidebar-check">
                      <input id="pt-dot-offset" type="checkbox" />
                      <span>Offset dots (hex packing)</span>
                    </label>
                  </div>

                  <!-- Diagonal Stripes -->
                  <div class="pt-pattern-controls" data-pattern="stripes" style="display:none;">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Stripe Width</span>
                      <div class="sidebar-range-row">
                        <input id="pt-stripe-width" class="sidebar-range" type="range" min="2" max="40" step="1" value="8" />
                        <output id="pt-stripe-width-val" class="sidebar-range-value" for="pt-stripe-width">8px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Angle</span>
                      <div class="sidebar-range-row">
                        <input id="pt-stripe-angle" class="sidebar-range" type="range" min="0" max="180" step="1" value="45" />
                        <output id="pt-stripe-angle-val" class="sidebar-range-value" for="pt-stripe-angle">45°</output>
                      </div>
                    </label>
                  </div>

                  <!-- Checkerboard -->
                  <div class="pt-pattern-controls" data-pattern="checker" style="display:none;">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Cell Size</span>
                      <div class="sidebar-range-row">
                        <input id="pt-cell-size" class="sidebar-range" type="range" min="4" max="60" step="1" value="16" />
                        <output id="pt-cell-size-val" class="sidebar-range-value" for="pt-cell-size">16px</output>
                      </div>
                    </label>
                    <div class="sidebar-row">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Color 1</span>
                        <div class="sidebar-color-row">
                          <input id="pt-checker-color1" type="color" class="sidebar-color" value="#000000" />
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Color 2</span>
                        <div class="sidebar-color-row">
                          <input id="pt-checker-color2" type="color" class="sidebar-color" value="#ffffff" />
                        </div>
                      </label>
                    </div>
                    <label class="sidebar-check">
                      <input id="pt-checker-diamond" type="checkbox" />
                      <span>Diamond variant</span>
                    </label>
                  </div>

                  <!-- Crosshatch -->
                  <div class="pt-pattern-controls" data-pattern="crosshatch" style="display:none;">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Spacing</span>
                      <div class="sidebar-range-row">
                        <input id="pt-cross-spacing" class="sidebar-range" type="range" min="4" max="60" step="1" value="16" />
                        <output id="pt-cross-spacing-val" class="sidebar-range-value" for="pt-cross-spacing">16px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Line Width</span>
                      <div class="sidebar-range-row">
                        <input id="pt-cross-lw" class="sidebar-range" type="range" min="1" max="8" step="1" value="2" />
                        <output id="pt-cross-lw-val" class="sidebar-range-value" for="pt-cross-lw">2px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Angle</span>
                      <div class="sidebar-range-row">
                        <input id="pt-cross-angle" class="sidebar-range" type="range" min="0" max="90" step="1" value="0" />
                        <output id="pt-cross-angle-val" class="sidebar-range-value" for="pt-cross-angle">0°</output>
                      </div>
                    </label>
                  </div>

                  <!-- Diagonal Crosshatch -->
                  <div class="pt-pattern-controls" data-pattern="diagcross" style="display:none;">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Spacing</span>
                      <div class="sidebar-range-row">
                        <input id="pt-diag-spacing" class="sidebar-range" type="range" min="4" max="60" step="1" value="16" />
                        <output id="pt-diag-spacing-val" class="sidebar-range-value" for="pt-diag-spacing">16px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Line Width</span>
                      <div class="sidebar-range-row">
                        <input id="pt-diag-lw" class="sidebar-range" type="range" min="1" max="6" step="1" value="1" />
                        <output id="pt-diag-lw-val" class="sidebar-range-value" for="pt-diag-lw">1px</output>
                      </div>
                    </label>
                  </div>

                  <!-- Honeycomb -->
                  <div class="pt-pattern-controls" data-pattern="honeycomb" style="display:none;">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Hex Radius</span>
                      <div class="sidebar-range-row">
                        <input id="pt-hex-radius" class="sidebar-range" type="range" min="6" max="40" step="1" value="14" />
                        <output id="pt-hex-radius-val" class="sidebar-range-value" for="pt-hex-radius">14px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Gap</span>
                      <div class="sidebar-range-row">
                        <input id="pt-hex-gap" class="sidebar-range" type="range" min="1" max="8" step="1" value="2" />
                        <output id="pt-hex-gap-val" class="sidebar-range-value" for="pt-hex-gap">2px</output>
                      </div>
                    </label>
                  </div>

                  <!-- Zigzag -->
                  <div class="pt-pattern-controls" data-pattern="zigzag" style="display:none;">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Width</span>
                      <div class="sidebar-range-row">
                        <input id="pt-zig-width" class="sidebar-range" type="range" min="8" max="60" step="1" value="24" />
                        <output id="pt-zig-width-val" class="sidebar-range-value" for="pt-zig-width">24px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Height</span>
                      <div class="sidebar-range-row">
                        <input id="pt-zig-height" class="sidebar-range" type="range" min="4" max="40" step="1" value="12" />
                        <output id="pt-zig-height-val" class="sidebar-range-value" for="pt-zig-height">12px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Line Width</span>
                      <div class="sidebar-range-row">
                        <input id="pt-zig-lw" class="sidebar-range" type="range" min="1" max="8" step="1" value="2" />
                        <output id="pt-zig-lw-val" class="sidebar-range-value" for="pt-zig-lw">2px</output>
                      </div>
                    </label>
                    <label class="sidebar-check">
                      <input id="pt-zig-filled" type="checkbox" />
                      <span>Filled triangles</span>
                    </label>
                  </div>

                  <!-- Circles -->
                  <div class="pt-pattern-controls" data-pattern="circles" style="display:none;">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Spacing</span>
                      <div class="sidebar-range-row">
                        <input id="pt-circle-spacing" class="sidebar-range" type="range" min="10" max="60" step="1" value="30" />
                        <output id="pt-circle-spacing-val" class="sidebar-range-value" for="pt-circle-spacing">30px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Line Width</span>
                      <div class="sidebar-range-row">
                        <input id="pt-circle-lw" class="sidebar-range" type="range" min="1" max="4" step="1" value="2" />
                        <output id="pt-circle-lw-val" class="sidebar-range-value" for="pt-circle-lw">2px</output>
                      </div>
                    </label>
                  </div>

                  <!-- Halftone -->
                  <div class="pt-pattern-controls" data-pattern="halftone" style="display:none;">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Cell Size</span>
                      <div class="sidebar-range-row">
                        <input id="pt-ht-cell" class="sidebar-range" type="range" min="4" max="20" step="1" value="8" />
                        <output id="pt-ht-cell-val" class="sidebar-range-value" for="pt-ht-cell">8px</output>
                      </div>
                    </label>
                    <div class="sidebar-row">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Min Radius</span>
                        <div class="sidebar-range-row">
                          <input id="pt-ht-minr" class="sidebar-range" type="range" min="1" max="8" step="1" value="1" />
                          <output id="pt-ht-minr-val" class="sidebar-range-value" for="pt-ht-minr">1px</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Max Radius</span>
                        <div class="sidebar-range-row">
                          <input id="pt-ht-maxr" class="sidebar-range" type="range" min="2" max="12" step="1" value="4" />
                          <output id="pt-ht-maxr-val" class="sidebar-range-value" for="pt-ht-maxr">4px</output>
                        </div>
                      </label>
                    </div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Frequency</span>
                      <div class="sidebar-range-row">
                        <input id="pt-ht-freq" class="sidebar-range" type="range" min="5" max="30" step="1" value="15" />
                        <output id="pt-ht-freq-val" class="sidebar-range-value" for="pt-ht-freq">1.5x</output>
                      </div>
                    </label>
                  </div>

                  <!-- Brick -->
                  <div class="pt-pattern-controls" data-pattern="brick" style="display:none;">
                    <div class="sidebar-row">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Brick Width</span>
                        <div class="sidebar-range-row">
                          <input id="pt-brick-w" class="sidebar-range" type="range" min="20" max="80" step="1" value="40" />
                          <output id="pt-brick-w-val" class="sidebar-range-value" for="pt-brick-w">40px</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Height</span>
                        <div class="sidebar-range-row">
                          <input id="pt-brick-h" class="sidebar-range" type="range" min="10" max="40" step="1" value="20" />
                          <output id="pt-brick-h-val" class="sidebar-range-value" for="pt-brick-h">20px</output>
                        </div>
                      </label>
                    </div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Gap</span>
                      <div class="sidebar-range-row">
                        <input id="pt-brick-gap" class="sidebar-range" type="range" min="1" max="6" step="1" value="2" />
                        <output id="pt-brick-gap-val" class="sidebar-range-value" for="pt-brick-gap">2px</output>
                      </div>
                    </label>
                    <div class="sidebar-row">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Brick Color</span>
                        <div class="sidebar-color-row">
                          <input id="pt-brick-color" type="color" class="sidebar-color" value="#b5651d" />
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Mortar</span>
                        <div class="sidebar-color-row">
                          <input id="pt-mortar-color" type="color" class="sidebar-color" value="#f5f0e1" />
                        </div>
                      </label>
                    </div>
                    <label class="sidebar-check">
                      <input id="pt-weave-mode" type="checkbox" />
                      <span>Weave mode</span>
                    </label>
                  </div>

                  <!-- Stars -->
                  <div class="pt-pattern-controls" data-pattern="stars" style="display:none;">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Outer Radius</span>
                      <div class="sidebar-range-row">
                        <input id="pt-star-outer" class="sidebar-range" type="range" min="4" max="30" step="1" value="10" />
                        <output id="pt-star-outer-val" class="sidebar-range-value" for="pt-star-outer">10px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Inner Radius</span>
                      <div class="sidebar-range-row">
                        <input id="pt-star-inner" class="sidebar-range" type="range" min="2" max="15" step="1" value="4" />
                        <output id="pt-star-inner-val" class="sidebar-range-value" for="pt-star-inner">4px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Spacing</span>
                      <div class="sidebar-range-row">
                        <input id="pt-star-spacing" class="sidebar-range" type="range" min="2" max="20" step="1" value="6" />
                        <output id="pt-star-spacing-val" class="sidebar-range-value" for="pt-star-spacing">6px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Points</span>
                      <div class="sidebar-range-row">
                        <input id="pt-star-points" class="sidebar-range" type="range" min="4" max="8" step="1" value="5" />
                        <output id="pt-star-points-val" class="sidebar-range-value" for="pt-star-points">5</output>
                      </div>
                    </label>
                  </div>

                  <!-- Custom Stamp -->
                  <div class="pt-pattern-controls" data-pattern="stamp" style="display:none;">
                    <div class="sidebar-field">
                      <span class="sidebar-label">Draw your pattern (64×64)</span>
                      <div class="pt-stamp-pad">
                        <canvas id="pt-stamp-canvas" width="128" height="128" style="width:128px;height:128px;"></canvas>
                      </div>
                    </div>
                    <div class="pt-stamp-actions">
                      <button id="pt-stamp-clear" class="btn btn-ghost btn-xs" type="button">Clear</button>
                      <button id="pt-stamp-invert" class="btn btn-ghost btn-xs" type="button">Invert</button>
                    </div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Tile Scale</span>
                      <div class="sidebar-range-row">
                        <input id="pt-stamp-scale" class="sidebar-range" type="range" min="25" max="400" step="1" value="100" />
                        <output id="pt-stamp-scale-val" class="sidebar-range-value" for="pt-stamp-scale">1x</output>
                      </div>
                    </label>
                  </div>

                  <!-- Stroke & Shadow -->
                  <div class="sidebar-section-label">Stroke</div>
                  <label class="sidebar-check">
                    <input id="pt-stroke-enable" type="checkbox" />
                    <span>Enable Stroke</span>
                  </label>
                  <div class="pt-stroke-section pt-subsection">
                    <div class="sidebar-row">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Color</span>
                        <div class="sidebar-color-row">
                          <input id="pt-stroke-color" type="color" class="sidebar-color" value="#000000" />
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Width</span>
                        <div class="sidebar-range-row">
                          <input id="pt-stroke-width" class="sidebar-range" type="range" min="1" max="30" step="1" value="3" />
                          <output id="pt-stroke-width-val" class="sidebar-range-value" for="pt-stroke-width">3px</output>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div class="sidebar-section-label">Shadow</div>
                  <label class="sidebar-check">
                    <input id="pt-shadow-enable" type="checkbox" />
                    <span>Enable Shadow</span>
                  </label>
                  <div class="pt-shadow-section pt-subsection">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Shadow Color</span>
                      <div class="sidebar-color-row">
                        <input id="pt-shadow-color" type="color" class="sidebar-color" value="#000000" />
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Blur</span>
                      <div class="sidebar-range-row">
                        <input id="pt-shadow-blur" class="sidebar-range" type="range" min="0" max="30" step="1" value="15" />
                        <output id="pt-shadow-blur-val" class="sidebar-range-value" for="pt-shadow-blur">15px</output>
                      </div>
                    </label>
                    <div class="sidebar-row">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Offset X</span>
                        <div class="sidebar-range-row">
                          <input id="pt-shadow-ox" class="sidebar-range" type="range" min="-30" max="30" step="1" value="5" />
                          <output id="pt-shadow-ox-val" class="sidebar-range-value" for="pt-shadow-ox">5px</output>
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Offset Y</span>
                        <div class="sidebar-range-row">
                          <input id="pt-shadow-oy" class="sidebar-range" type="range" min="-30" max="30" step="1" value="8" />
                          <output id="pt-shadow-oy-val" class="sidebar-range-value" for="pt-shadow-oy">8px</output>
                        </div>
                      </label>
                    </div>
                  </div>

                  <!-- Background Band -->
                  <div class="sidebar-section-label">Background Band</div>
                  <label class="sidebar-check">
                    <input id="pt-bg-enable" type="checkbox" />
                    <span>Enable Background</span>
                  </label>
                  <div class="pt-bg-section pt-subsection">
                    <div class="sidebar-row">
                      <label class="sidebar-field">
                        <span class="sidebar-label">Color</span>
                        <div class="sidebar-color-row">
                          <input id="pt-bg-color" type="color" class="sidebar-color" value="#ffffff" />
                        </div>
                      </label>
                      <label class="sidebar-field">
                        <span class="sidebar-label">Opacity</span>
                        <div class="sidebar-range-row">
                          <input id="pt-bg-opacity" class="sidebar-range" type="range" min="0" max="100" step="1" value="80" />
                          <output id="pt-bg-opacity-val" class="sidebar-range-value" for="pt-bg-opacity">80%</output>
                        </div>
                      </label>
                    </div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Padding</span>
                      <div class="sidebar-range-row">
                        <input id="pt-bg-padding" class="sidebar-range" type="range" min="0" max="60" step="1" value="20" />
                        <output id="pt-bg-padding-val" class="sidebar-range-value" for="pt-bg-padding">20px</output>
                      </div>
                    </label>
                  </div>

                  <!-- Master Opacity -->
                  <div class="sidebar-section-label">Master Opacity</div>
                  <label class="sidebar-field">
                    <div class="sidebar-range-row">
                      <input id="pt-master-opacity" class="sidebar-range" type="range" min="0" max="100" step="1" value="100" />
                      <output id="pt-master-opacity-val" class="sidebar-range-value" for="pt-master-opacity">100%</output>
                    </div>
                  </label>

                  <div class="sidebar-row" style="margin-top:8px;">
                    <button id="pt-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="pt-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
