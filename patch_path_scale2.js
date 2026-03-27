const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const s1 = code.indexOf('let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y');
if (s1 === -1) { console.log('cant find s1'); process.exit(1); }
const s2 = code.indexOf('}', s1) + 1;

let block = code.substring(s1, s2);
let newBlock = block.replace(
    'tendrilBaseZ = pathPt.z;',
    'tendrilBaseZ = pathPt.z;\n              pathFade = Math.min(pathT * 20.0, (1.0 - pathT) * 20.0, 1.0); // fade in/out'
);
newBlock = newBlock.replace(
    'let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y, tendrilBaseZ = fBase.z;',
    'let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y, tendrilBaseZ = fBase.z;\n            let pathFade = 1.0;'
);

code = code.substring(0, s1) + newBlock + code.substring(s2);

const tar2 = 'let activeHeight = flameHeight * ageScale * (0.75 + 0.25 * lifeFade) * sharedHeightScale;';
const rep2 = 'let activeHeight = flameHeight * ageScale * (0.75 + 0.25 * lifeFade) * sharedHeightScale * pathFade;\n            const baseWidthMul = Math.max(0.05, 1.0 - detachT * 0.9) * pathFade;';
code = code.replace('const baseWidthMul = Math.max(0.05, 1.0 - detachT * 0.9);', '');
code = code.replace(tar2, rep2);

fs.writeFileSync('src/Scene3D.tsx', code, 'utf8');
console.log('Path fade script completed =', code.includes('pathFade = Math.min'));
