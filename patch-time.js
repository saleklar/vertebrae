const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');
code = code.replace(/Date\.now\(\) \/ 1000\.0/g, "(Date.now() % 10000000) / 1000.0");
fs.writeFileSync('src/Scene3D.tsx', code);
console.log('Fixed precision issue in GLSL floats');
