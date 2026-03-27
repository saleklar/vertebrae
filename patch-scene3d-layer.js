const fs = require('fs');
let t = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const s1 = "            const baseOffZ = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;";
const r1 = "            const baseOffZ = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;\n            const pZ1 = fp.placementZ || 'center';\n            const offsetZ1 = pZ1 === 'front' ? 15 : (pZ1 === 'back' ? -15 : 0);\n            bz += offsetZ1;";

t = t.replace(s1, r1);

const s2 = "            const baseOffZ     = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;";
const r2 = "            const baseOffZ     = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;\n            const pZ2 = fp.placementZ || 'center';\n            const offsetZ2 = pZ2 === 'front' ? 15 : (pZ2 === 'back' ? -15 : 0);\n            tendrilBaseZ += offsetZ2;";

t = t.replace(s2, r2);

fs.writeFileSync('src/Scene3D.tsx', t);
console.log('Scene3D.tsx patched accurately!');
