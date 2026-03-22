const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

const regex = /<p style={{ fontSize: '0.8rem', color: '#8a93a2', marginTop: '0.5rem' }}>\s*\{selectedObject.parentId\s*\?\s*'This shape is connected to an emitter and will be used as an emission source.'\s*:\s*'Select an emitter to use this shape as an emission source.'\}\s*<\/p>\s*<\/div>/g;

const replacement = `<p style={{ fontSize: '0.8rem', color: '#8a93a2', marginTop: '0.5rem', marginBottom: '0.8rem' }}>
                            {selectedObject.parentId
                              ? 'This shape is connected to an emitter and will be used as an emission source.'
                              : 'Select an emitter to use this shape as an emission source.'}
                          </p>

                          {selectedObject.parentId && (
                            <>
                              <label htmlFor="shape-emission-mode">Emission Mode</label>
                              <select
                                id="shape-emission-mode"
                                value={(selectedObject.properties as any)?.emissionMode || 'volume'}
                                onChange={(event) => {
                                  handleUpdateEmitterProperty('emissionMode', event.target.value);
                                }}
                              >
                                <option value="volume">Volume (Random fill / Inner)</option>
                                <option value="surface">Surface (Outer Shell)</option>
                                <option value="edge">Edge (Wireframe)</option>
                              </select>
                            </>
                          )}
                        </div>`;

code = code.replace(regex, replacement);
fs.writeFileSync(file, code, 'utf8');
console.log("Regex patch applied to App.tsx!");
