const markup = `<div class="sidebar-panel" data-panel="convert">
                  <label class="sidebar-field">
                    <span class="sidebar-label">Format</span>
                    <select id="format-select" class="sidebar-select">
                      <option value="png">PNG</option>
                      <option value="jpeg">JPEG</option>
                      <option value="webp">WebP</option>
                    </select>
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Quality</span>
                    <div class="sidebar-range-row">
                      <input id="quality-range" class="sidebar-range" type="range" min="30" max="100" step="1" value="92" />
                      <output id="quality-output" class="sidebar-range-value" for="quality-range">92%</output>
                    </div>
                  </label>
                  <button id="apply-convert" class="btn btn-accent btn-full" type="button">Convert</button>
                </div>`;

export default markup;
