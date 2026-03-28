const markup = `<div class="sidebar-panel" data-panel="textoverlay">
                  <div class="sidebar-section-label">Text Content</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Text</span>
                    <textarea id="tvo-text" class="sidebar-textarea" rows="3" placeholder="Enter your text here...">Your Text Here</textarea>
                  </label>

                  <div class="sidebar-section-label">Typography</div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Font Family</span>
                    <select id="tvo-font-family" class="sidebar-select">
                      <option value="Inter">Inter</option>
                      <option value="Playfair Display">Playfair Display</option>
                      <option value="Montserrat">Montserrat</option>
                      <option value="Oswald">Oswald</option>
                      <option value="Dancing Script">Dancing Script</option>
                      <option value="Roboto Slab">Roboto Slab</option>
                    </select>
                  </label>
                  <div class="sidebar-row">
                    <label class="sidebar-field">
                      <span class="sidebar-label">Color</span>
                      <div class="sidebar-color-row">
                        <input id="tvo-font-color" type="color" class="sidebar-color" value="#ffffff" />
                      </div>
                    </label>
                    <label class="sidebar-field">
                      <span class="sidebar-label">Size</span>
                      <div class="sidebar-range-row">
                        <input id="tvo-font-size" class="sidebar-range" type="range" min="8" max="200" step="1" value="48" />
                        <output id="tvo-font-size-val" class="sidebar-range-value" for="tvo-font-size">48px</output>
                      </div>
                    </label>
                  </div>
                  <div class="sidebar-row">
                    <label class="sidebar-check">
                      <input id="tvo-font-bold" type="checkbox" />
                      <span>Bold</span>
                    </label>
                    <div class="sidebar-field" style="gap:4px;flex-direction:row;align-items:center;">
                      <span class="sidebar-label" style="white-space:nowrap;">Align</span>
                      <div class="btn-group">
                        <button id="tvo-align-left" class="btn btn-ghost btn-xs btn-toggle active" type="button" data-align="left">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
                        </button>
                        <button id="tvo-align-center" class="btn btn-ghost btn-xs btn-toggle" type="button" data-align="center">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
                        </button>
                        <button id="tvo-align-right" class="btn btn-ghost btn-xs btn-toggle" type="button" data-align="right">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Letter Spacing</span>
                    <div class="sidebar-range-row">
                      <input id="tvo-letter-spacing" class="sidebar-range" type="range" min="-5" max="20" step="1" value="0" />
                      <output id="tvo-letter-spacing-val" class="sidebar-range-value" for="tvo-letter-spacing">0px</output>
                    </div>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Shadow</span>
                    <label class="sidebar-check" style="flex-direction:row;gap:6px;align-items:center;">
                      <input id="tvo-shadow" type="checkbox" checked />
                      <span>Text shadow</span>
                    </label>
                  </label>

                  <div class="sidebar-section-label">Foreground Layer</div>
                  <div id="tvo-fg-status" class="tvo-hint">
                    We’ll prepare the cutout automatically when you open this tool.
                  </div>
                  <button id="tvo-load-fg" class="btn btn-ghost btn-full" type="button" style="margin-top:4px;">Rebuild Cutout</button>

                  <div class="sidebar-section-label">Layer Order</div>
                  <div id="tvo-layer-panel" class="layer-panel">
                    <div class="layer-hint">Load an image and foreground to see layers.</div>
                  </div>

                  <div class="sidebar-row" style="margin-top:4px;">
                    <button id="tvo-preview" class="btn btn-ghost btn-full" type="button">Preview</button>
                    <button id="tvo-apply" class="btn btn-accent btn-full" type="button">Apply</button>
                  </div>
                </div>`;

export default markup;
