const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');
const rx = /\/\/ ── Saber live preview ───────────────────────────────────────────────────────────────────[\s\S]*?\/\/ ── End saber live preview ─────────────────────────────────────────────────────────────────/;
code = code.replace(rx, fs.readFileSync('shader_code.txt', 'utf8'));
fs.writeFileSync('src/Scene3D.tsx', code);
console.log('Done!');
