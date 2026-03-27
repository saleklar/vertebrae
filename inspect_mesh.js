const fs = require('fs');
const lines = fs.readFileSync('src/Scene3D.tsx', 'utf8').split('\n');
const s1 = lines.findIndex(l => l.includes('let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y'));
fs.writeFileSync('temp.txt', lines.slice(s1, s1+15).join('\n'));
