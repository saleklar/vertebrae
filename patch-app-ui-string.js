const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf8');

const anchor = "</select>\n                      </div>\n\n                      <div style={{ marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Rendering</div>";
const replacement = "<\/select>\n                      </div>\n\n                      {fp.targetPathId && (\n                        <>\n                          <label>Path Speed: {(fp.pathSpeed ?? 0.05).toFixed(3)}</label>\n                          <input type=\"range\" min={-1.5} max={1.5} step={0.01} value={fp.pathSpeed ?? 0.05} onChange={e => upd('pathSpeed', Number(e.target.value))} />\n                          <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>How fast the flame slides along the curve.</div>\n                        </>\n                      )}\n\n                      <div style={{ marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Rendering</div>";

c = c.replace(anchor, replacement);
c = c.replace(anchor.replaceAll('\n', '\r\n'), replacement);

fs.writeFileSync('src/App.tsx', c);
console.log('App patched');
