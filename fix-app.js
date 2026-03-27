const fs = require('fs');
let t = fs.readFileSync('src/App.tsx', 'utf8');

const s = "                      {(fp.attachedSpineId || fp.attachedShapeId) && (\n                          <div className=\"property-row\">\n                            <label>Depth Placement</label>\n                            <select\n                                value={fp.placementZ ?? 'center'}\n                                onChange={e => upd('placementZ', e.target.value)}\n                                style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}\n                            >\n                                <option value=\"front\">In Front (+Z)</option>\n                                <option value=\"center\">Surface (0)</option>\n                                <option value=\"back\">Behind (-Z)</option>\n                            </select>\n                          </div>\n                      )}";

t = t.replace(s + '\n\n' + s, s);

fs.writeFileSync('src/App.tsx', t);
