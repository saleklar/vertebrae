const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const s1 = '<label>Base Twist: {((fp.shapeTwist ?? 0) * 100).toFixed(0)}%</label>';
const s1i = code.indexOf(s1);
if (s1i > -1) {
    const s1e = code.indexOf('<label>Height: {fp.height ?? 80}</label>', s1i);
    const block = code.substring(s1i, s1e);
    const rep = block + \
                      <label>Base Oscillation: {((fp.oscillation ?? 0) * 100).toFixed(0)}%</label>
                      <input type="range" min={0} max={4} step={0.01} value={fp.oscillation ?? 0} onChange={e => upd('oscillation', Number(e.target.value))} />
                      <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>Oscillates orientation instead of spinning.</div>
                      \;
    code = code.substring(0, s1i) + rep + code.substring(s1e);
}

const s2 = '<option value="">(none — object position)</option>';
const s2i = code.indexOf(s2);
if (s2i > -1) {
    const s2blockEnd = code.indexOf('</select>', s2i) + 9;
    const block = code.substring(code.lastIndexOf('<div', s2i), s2blockEnd + 7);
    const rep = block + \
                      <div style={{ marginTop: '6px' }}>
                        <label>Attach to 3D Shape Surface:</label>
                        <select
                          value={fp.attachedShapeId ?? ''}
                          onChange={e => upd('attachedShapeId', e.target.value)}
                        >
                          <option value="">(none — standalone)</option>
                          {sceneObjects.filter((o: any) => o.type === 'Shape').map((o: any) => (
                            <option key={o.id} value={o.id}>{o.name ?? o.id}</option>
                          ))}
                        </select>
                      </div>\;
    code = code.substring(0, code.lastIndexOf('<div', s2i)) + rep + code.substring(s2blockEnd + 7);
}

fs.writeFileSync('src/App.tsx', code, 'utf8');
console.log('UI patch completed');
