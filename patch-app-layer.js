const fs = require('fs');
let t = fs.readFileSync('src/App.tsx', 'utf8');

const target = "{fp.attachedSpineId && (\n                          <div className=\"property-row\">\n                            <label>Sample Mode</label>\n                            <select\n                                value={fp.attachedSpineMode ?? 'surface'}\n                                onChange={e => upd('attachedSpineMode', e.target.value)}\n                                style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}\n                            >\n                                <option value=\"surface\">Visible Surface</option>\n                                <option value=\"edge\">Outer Edge</option>\n                            </select>\n                          </div>\n                      )}";

const insert = target + "\n\n                      {(fp.attachedSpineId || fp.attachedShapeId) && (\n                          <div className=\"property-row\">\n                            <label>Depth Placement</label>\n                            <select\n                                value={fp.placementZ ?? 'center'}\n                                onChange={e => upd('placementZ', e.target.value)}\n                                style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}\n                            >\n                                <option value=\"front\">In Front (+Z)</option>\n                                <option value=\"center\">Surface (0)</option>\n                                <option value=\"back\">Behind (-Z)</option>\n                            </select>\n                          </div>\n                      )}";

t = t.replace(
    /\{fp\.attachedSpineId && \(\s*<div className="property-row">\s*<label>Sample Mode<\/label>[\s\S]*?<\/select>\s*<\/div>\s*\)\}/,
    insert
);

fs.writeFileSync('src/App.tsx', t);
console.log('App.tsx patched for Z!');
