const fs = require('fs');
const file = 'src/Scene3D.tsx';
let code = fs.readFileSync(file, 'utf8');

const regex = /\} else if \(emitterType === 'cube'\) \{\s*if \(isSurfaceMode \|\| isEdgeMode\) \{/g;

const replacement = `} else if (emitterType === 'cube') {
                    if (isEdgeMode) {
                      const edge = Math.floor(Math.random() * 12);
                      const t = (Math.random() * 2 - 1) * sourceExtent;
                      const s = sourceExtent;
                      const signs = [
                        [s, s], [s, -s], [-s, s], [-s, -s]
                      ];
                      const sgn = signs[edge % 4];
                      if (edge < 4) { // X-axis parallel
                        localOffset.set(t, sgn[0], sgn[1]);
                      } else if (edge < 8) { // Y-axis parallel
                        localOffset.set(sgn[0], t, sgn[1]);
                      } else { // Z-axis parallel
                        localOffset.set(sgn[0], sgn[1], t);
                      }
                      localNormal.copy(localOffset).normalize();
                    } else if (isSurfaceMode) {`;

code = code.replace(regex, replacement);
fs.writeFileSync(file, code, 'utf8');
console.log("Patched Scene3D.tsx to handle cube edge mode");
