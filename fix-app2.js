const fs = require('fs');
let t = fs.readFileSync('src/App.tsx', 'utf8');

const depthBlock = 
                      {(fp.attachedSpineId || fp.attachedShapeId) && (
                          <div className="property-row">
                            <label>Depth Placement</label>
                            <select
                                value={fp.placementZ ?? 'center'}
                                onChange={e => upd('placementZ', e.target.value)}
                                style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}
                            >
                                <option value="front">In Front (+Z)</option>
                                <option value="center">Surface (0)</option>
                                <option value="back">Behind (-Z)</option>
                            </select>
                          </div>
                      )};

t = t.replace("\n\n                      {\n\n", "\n\n" + depthBlock + "\n\n");

fs.writeFileSync('src/App.tsx', t);
console.log('Fixed App.tsx');
