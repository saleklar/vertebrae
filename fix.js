const fs = require('fs');
let lines = fs.readFileSync('src/Scene3D.tsx', 'utf8').split('\n');

const idx1 = lines.findIndex(l => l.includes('const baseOffZ = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;'));
let block1 = "            const pZ1 = fp.placementZ || 'center';\n            const offsetZ1 = pZ1 === 'front' ? 15 : (pZ1 === 'back' ? -15 : 0);\n            bz += offsetZ1;";
if (!lines[idx1+1].includes('pZ1')) {
    lines.splice(idx1 + 1, 0, block1);
}

const idx2 = lines.findIndex((l, i) => i > idx1+1 && l.includes('const baseOffZ     = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;'));
let block2 = "            const pZ2 = fp.placementZ || 'center';\n            const offsetZ2 = pZ2 === 'front' ? 15 : (pZ2 === 'back' ? -15 : 0);\n            tendrilBaseZ += offsetZ2;";
if (!lines[idx2+1].includes('pZ2')) {
    lines.splice(idx2 + 1, 0, block2);
}

fs.writeFileSync('src/Scene3D.tsx', lines.join('\n'));
console.log('Patched Scene3D cleanly');
