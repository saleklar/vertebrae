const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex = /\/\/ ── Saber live preview ───────────────────────────────────────────────────────────────────[\s\S]*?\/\/ ── End saber live preview ─────────────────────────────────────────────────────────────────/;
const replacement = require('fs').readFileSync('tube_saber_code.txt', 'utf8');

if (code.includes('// ── Saber live preview')) {
    code = code.replace(regex, replacement);
    fs.writeFileSync('src/Scene3D.tsx', code);
    console.log("Patched Scene3D.tsx with Tube/Shader Saber implementation");
} else {
    console.log("Could not find saber preview section to replace");
}
