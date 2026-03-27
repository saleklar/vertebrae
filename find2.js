const code = require('fs').readFileSync('src/Scene3D.tsx', 'utf8');
const idx = code.indexOf("=== 'Shape'");
console.log(code.substring(idx - 100, idx + 800));
