const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const targetStr = "            let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y, tendrilBaseZ = fBase.z;\n" +
"            if (pathCurveF) {\n" +
"              const pathT = ( (numTendrils > 1 ? ti / (numTendrils - 1) : 0) + (fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)) ) % 1.0;\n" +
"              const pathPt = pathCurveF.getPointAt(Math.min(0.9999, pathT));\n" +
"              tendrilBaseX = pathPt.x; tendrilBaseY = pathPt.y; tendrilBaseZ = pathPt.z;\n" +
"            }";

const replacement = "            let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y, tendrilBaseZ = fBase.z;\n" +
"            let pathFade = 1.0;\n" +
"            if (pathCurveF) {\n" +
"              const pathT = ( (numTendrils > 1 ? ti / (numTendrils - 1) : 0) + (fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)) ) % 1.0;\n" +
"              const pathPt = pathCurveF.getPointAt(Math.min(0.9999, pathT));\n" +
"              tendrilBaseX = pathPt.x; tendrilBaseY = pathPt.y; tendrilBaseZ = pathPt.z;\n" +
"              pathFade = Math.min(pathT * 20.0, (1.0 - pathT) * 20.0, 1.0);\n" +
"            }";

code = code.replace(targetStr, replacement);
const targetStr2 = 'let activeHeight = flameHeight * ageScale * (0.75 + 0.25 * lifeFade) * sharedHeightScale;';
const replacement2 = 'let activeHeight = flameHeight * ageScale * (0.75 + 0.25 * lifeFade) * sharedHeightScale * pathFade;\n            const baseWidthMul = Math.max(0.05, 1.0 - detachT * 0.9) * pathFade;';

code = code.replace('const baseWidthMul = Math.max(0.05, 1.0 - detachT * 0.9);', ''); 
code = code.replace(targetStr2, replacement2);

fs.writeFileSync('src/Scene3D.tsx', code, 'utf8');
console.log('Path fade script completed =', code.includes('pathFade = Math.min'));
