const markup = `<div class="sidebar-panel" data-panel="sketch">
                  <div class="sidebar-section-label">Algorithm</div>
                  <div class="sketch-mode-group">
                    <label class="sketch-mode-btn active">
                      <input class="sketch-mode-radio" type="radio" name="sketch-mode" value="sobel" checked />
                      Sobel
                    </label>
                    <label class="sketch-mode-btn">
                      <input class="sketch-mode-radio" type="radio" name="sketch-mode" value="laplacian" />
                      Laplacian
                    </label>
                    <label class="sketch-mode-btn">
                      <input class="sketch-mode-radio" type="radio" name="sketch-mode" value="pencil" />
                      Pencil
                    </label>
                    <label class="sketch-mode-btn">
                      <input class="sketch-mode-radio" type="radio" name="sketch-mode" value="colored-pencil" />
                      Color Pencil
                    </label>
                    <label class="sketch-mode-btn">
                      <input class="sketch-mode-radio" type="radio" name="sketch-mode" value="hatching" />
                      Hatching
                    </label>
                  </div>

                  <div class="sidebar-section-label">Edge Detection</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Edge Sensitivity</span>
                    <div class="sidebar-range-row">
                      <input id="sketch-threshold" class="sidebar-range" type="range" min="0" max="255" step="1" value="80" />
                      <output id="sketch-threshold-val" class="sidebar-range-value" for="sketch-threshold">80</output>
                    </div>
                    <small style="color:#888;font-size:11px;margin-top:4px;display:block;">Lower = more edges detected</small>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Line Weight</span>
                    <div class="sidebar-range-row">
                      <input id="sketch-line-weight" class="sidebar-range" type="range" min="1" max="5" step="1" value="1" />
                      <output id="sketch-line-weight-val" class="sidebar-range-value" for="sketch-line-weight">1</output>
                    </div>
                    <small style="color:#888;font-size:11px;margin-top:4px;display:block;">Thicker strokes via dilation</small>
                  </label>

                  <div class="sidebar-section-label">Colors</div>
                  <div class="sketch-color-row">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Paper Color</span>
                      <div class="sidebar-color-row">
                        <input id="sketch-paper-color" type="color" class="sidebar-color" value="#ffffff" />
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Ink Color</span>
                      <div class="sidebar-color-row">
                        <input id="sketch-ink-color" type="color" class="sidebar-color" value="#1a1a1a" />
                      </div>
                    </label>
                  </div>

                  <div class="sketch-blend-row">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Sketch Blend</span>
                      <div class="sidebar-range-row">
                        <input id="sketch-blend" class="sidebar-range" type="range" min="0" max="100" step="1" value="30" />
                        <output id="sketch-blend-val" class="sidebar-range-value" for="sketch-blend">30%</output>
                      </div>
                      <small style="color:#888;font-size:11px;margin-top:4px;display:block;">How much grayscale shows through</small>
                    </label>
                  </div>

                  <div class="sketch-hatch-row">
                    <div class="sidebar-section-label">Hatching</div>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Hatch Length</span>
                      <div class="sidebar-range-row">
                        <input id="sketch-hatch-length" class="sidebar-range" type="range" min="4" max="20" step="1" value="8" />
                        <output id="sketch-hatch-length-val" class="sidebar-range-value" for="sketch-hatch-length">8px</output>
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Hatch Density</span>
                      <div class="sidebar-range-row">
                        <input id="sketch-hatch-density" class="sidebar-range" type="range" min="0" max="100" step="1" value="60" />
                        <output id="sketch-hatch-density-val" class="sidebar-range-value" for="sketch-hatch-density">60%</output>
                      </div>
                    </label>
                  </div>

                  <div class="sidebar-section-label">Presets</div>
                  <div id="sketch-presets" class="sketch-presets"></div>

                  <div class="sketch-actions-row">
                    <button id="sketch-reset" class="btn btn-ghost btn-full" type="button">Reset</button>
                    <button id="sketch-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
