const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex = /\/\/ Create ONE material for all glow and ONE for core per tick to avoid leak[\s\S]*?depthTest: true\s*\}\);\s*\(matGlow as any\)\.__isSaberMat = true;\s*\(matCore as any\)\.__isSaberMat = true;/m;

if (!regex.test(code)) {
    console.log("Could not find regex!");
    process.exit(1);
}

const inject = `// Materials will be created per point to support noise-driven visibility`;

code = code.replace(regex, inject);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log("Patched out shared materials.");