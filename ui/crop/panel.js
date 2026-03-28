const markup = `<div class="sidebar-panel is-active" data-panel="crop">
                  <label class="sidebar-field">
                    <span class="sidebar-label">Width</span>
                    <input id="crop-width" class="sidebar-input" type="number" min="1" step="1" placeholder="W" />
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Height</span>
                    <input id="crop-height" class="sidebar-input" type="number" min="1" step="1" placeholder="H" />
                  </label>
                  <label class="sidebar-field">
                    <span class="sidebar-label">Aspect Ratio</span>
                    <select id="aspect-ratio" class="sidebar-select">
                      <option value="free">Free</option>
                      <option value="1">1 : 1</option>
                      <option value="1.3333333333">4 : 3</option>
                      <option value="1.7777777778">16 : 9</option>
                      <option value="0.75">3 : 4</option>
                      <option value="0.5625">9 : 16</option>
                    </select>
                  </label>
                  <button id="apply-crop" class="btn btn-accent btn-full" type="button">Apply Crop</button>
                </div>`;

export default markup;
