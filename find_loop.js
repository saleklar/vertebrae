const fs = require('fs');
const lines = fs.readFileSync('src/Scene3D.tsx', 'utf8').split('\n');
console.log(lines.slice(6120, 6170).join('\n'));
