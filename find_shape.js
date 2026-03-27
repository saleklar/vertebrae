const code = require('fs').readFileSync('src/Scene3D.tsx', 'utf8');
const idx = code.indexOf("if (obj.type === 'Shape')");
console.log(code.substring(idx, idx + 800));
