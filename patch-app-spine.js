const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regexPath = /onChange=\{e => \{ upd\('targetPathId', e\.target\.value \|\| undefined\); if \(e\.target\.value\) upd\('attachedShapeId', undefined\); \}\}/;
const newPath = `onChange={e => { upd('targetPathId', e.target.value || undefined); if (e.target.value) { upd('attachedShapeId', undefined); upd('attachedSpineId', undefined); } }}`;

const regexMesh = /onChange=\{e => \{ upd\('attachedShapeId', e\.target\.value \|\| undefined\); if \(e\.target\.value\) upd\('targetPathId', undefined\); \}\}/;
const newMesh = `onChange={e => { upd('attachedShapeId', e.target.value || undefined); if (e.target.value) { upd('targetPathId', undefined); upd('attachedSpineId', undefined); } }}`;

const regexInject = /<\/select>\s*<\/div>\s*\{fp\.targetPathId && \(/;

const newInject = `</select>
                      </div>

                      <div className="property-row">
                        <label>Spine Image</label>
                        <select
                          value={fp.attachedSpineId ?? ''}
                          onChange={e => { upd('attachedSpineId', e.target.value || undefined); if (e.target.value) { upd('targetPathId', undefined); upd('attachedShapeId', undefined); } }}
                          style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}
                        >
                          <option value="">(none)</option>
                          {spineAllAttachments.map(att => (
                            <option key={att.id} value={att.id}>{att.slotName}</option>
                          ))}
                        </select>
                      </div>

                      {fp.attachedSpineId && (
                          <div className="property-row">
                            <label>Sample Mode</label>
                            <select
                                value={fp.attachedSpineMode ?? 'surface'}
                                onChange={e => upd('attachedSpineMode', e.target.value)}
                                style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}
                            >
                                <option value="surface">Visible Surface</option>
                                <option value="edge">Outer Edge</option>
                            </select>
                          </div>
                      )}

                      {fp.targetPathId && (`

if (regexPath.test(code) && regexMesh.test(code) && regexInject.test(code)) {
    code = code.replace(regexPath, newPath).replace(regexMesh, newMesh).replace(regexInject, newInject);
    fs.writeFileSync('src/App.tsx', code, 'utf8');
    console.log("App.tsx patched for Spine successfully!");
} else {
    console.log("Failed to patch App.tsx!");
    console.log("Path Regex:", regexPath.test(code));
    console.log("Mesh Regex:", regexMesh.test(code));
    console.log("Inject Regex:", regexInject.test(code));
}