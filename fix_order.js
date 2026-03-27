const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

// The line we recently added by accident (maybe duplicated or not, let's remove it)
code = code.replace('let pathFade = 1.0; const slotSeed', 'const slotSeed');
code = code.replace('let pathFade = 1.0;\n          const slotSeed', 'const slotSeed');

// Remove the `pathFade` from the bottom block
let regex = /if \(pathCurveF\) \{\s*const pathT = \( \(numTendrils > 1 \? ti \/ \(numTendrils - 1\) : 0\) \+ \(fAnimT \* Math\.max\(0\.1, speed\) \* \(fp\.pathSpeed \?\? 0\.05\)\) \) \% 1\.0;\s*pathFade = Math\.min\(pathT \* 20\.0, \(1\.0 - pathT\) \* 20\.0, 1\.0\);\s*const pathPt = pathCurveF\.getPointAt\(Math\.min\(0\.9999, pathT\)\);\s*tendrilBaseX = pathPt\.x; tendrilBaseY = pathPt\.y; tendrilBaseZ = pathPt\.z;\s*\} else if \(fp\.attachedShapeId\) \{/g;

let replaceWith = `if (pathCurveF) {
            const pathT = ( (numTendrils > 1 ? ti / (numTendrils - 1) : 0) + (fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)) ) % 1.0;
            const pathPt = pathCurveF.getPointAt(Math.min(0.9999, pathT));
            tendrilBaseX = pathPt.x; tendrilBaseY = pathPt.y; tendrilBaseZ = pathPt.z;
          } else if (fp.attachedShapeId) {`;

code = code.replace(regex, replaceWith);

const insertFadeStr =
`let pathFade = 1.0;
            if (pathCurveF) {
                const pathT = ( (numTendrils > 1 ? ti / (numTendrils - 1) : 0) + (fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)) ) % 1.0;
                pathFade = Math.min(pathT * 20.0, (1.0 - pathT) * 20.0, 1.0);
            }
            `;

code = code.replace('let activeHeight = flameHeight * ageScale', insertFadeStr + 'let activeHeight = flameHeight * ageScale');

fs.writeFileSync('src/Scene3D.tsx', code, 'utf8');
console.log('Moved pathFade');
