const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<div style=\{\{ marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' \}\}>Source Path<\/div>\s*<div className="property-row">\s*<label>Path<\/label>\s*<select\s*value=\{fp\.targetPathId \?\? ''\}\s*onChange=\{e => upd\('targetPathId', e\.target\.value \|\| undefined\)\}\s*style=\{\{ flex:1, padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 \}\}\s*>\s*<option value="">\(none — object position\)<\/option>\s*\{sceneObjects\.filter\(\(o: any\) => o\.type === 'Path'\)\.map\(\(o: any\) => \(\s*<option key=\{o\.id\} value=\{o\.id\}>\{o\.name \?\? o\.id\}<\/option>\s*\)\)\}\s*<\/select>\s*<\/div>\s*\{fp\.targetPathId && \(/g;

const replacement = `<div style={{ marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Source Geometry</div>
                      <div className="property-row">
                        <label>Path</label>
                        <select
                          value={fp.targetPathId ?? ''}
                          onChange={e => { upd('targetPathId', e.target.value || undefined); if (e.target.value) upd('attachedShapeId', undefined); }}
                          style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}
                        >
                          <option value="">(none)</option>
                          {sceneObjects.filter((o: any) => o.type === 'Path').map((o: any) => (
                            <option key={o.id} value={o.id}>{o.name ?? o.id}</option>
                          ))}
                        </select>
                      </div>

                      <div className="property-row">
                        <label>3D Mesh</label>
                        <select
                          value={fp.attachedShapeId ?? ''}
                          onChange={e => { upd('attachedShapeId', e.target.value || undefined); if (e.target.value) upd('targetPathId', undefined); }}
                          style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}
                        >
                          <option value="">(none)</option>
                          {sceneObjects.filter((o: any) => o.type === '3DModel').map((o: any) => (
                            <option key={o.id} value={o.id}>{o.name ?? o.id}</option>
                          ))}
                        </select>
                      </div>

                      {fp.targetPathId && (`;

if (regex.test(code)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync('src/App.tsx', code, 'utf8');
    console.log("App.tsx patched successfully!");
} else {
    console.log("Failed to patch App.tsx - regex didn't match.");
}
