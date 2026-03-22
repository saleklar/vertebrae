const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

const targetStr = `                          <p style={{ fontSize: '0.8rem', color: '#8a93a2', marginTop: '0.5rem' }}>
                            {selectedObject.parentId
                              ? 'This shape is connected to an emitter and will be used as an emission source.'
                              : 'Select an emitter to use this shape as an emission source.'}
                          </p>
                        </div>`;

const replacement = `                          <p style={{ fontSize: '0.8rem', color: '#8a93a2', marginTop: '0.5rem', marginBottom: '0.8rem' }}>
                            {selectedObject.parentId
                              ? 'This shape is connected to an emitter and will be used as an emission source.'
                              : 'Select an emitter to use this shape as an emission source.'}
                          </p>

                          {selectedObject.parentId && (
                            <>
                              <label htmlFor="shape-emission-mode">Emission from Shape</label>
                              <select
                                id="shape-emission-mode"
                                value={(selectedObject.properties as any)?.emissionMode || 'volume'}
                                onChange={(event) => {
                                  handleUpdateEmitterProperty('emissionMode', event.target.value);
                                }}
                              >
                                <option value="volume">Volume (Fill/Inner)</option>
                                <option value="surface">Surface (Face Shel)</option>
                                <option value="edge">Edges (Wireframe)</option>
                              </select>
                            </>
                          )}
                        </div>`;

if(code.includes(targetStr)) {
    code = code.replace(targetStr, replacement);
    fs.writeFileSync(file, code, 'utf8');
    console.log("App.tsx emission mode UI injected");
} else {
    console.log("Could not find the target block in App.tsx!");
}
