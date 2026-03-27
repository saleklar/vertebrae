const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const sIdx = code.indexOf('          let tendrilBaseX =');
let slice = code.slice(sIdx, code.indexOf('          // Base spread angle', sIdx));
console.log('REPLACING:', slice.slice(0, 100));

let rep = \          let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y, tendrilBaseZ = fBase.z;
          let pathFade = 1.0;
          if (pathCurveF) {
            const pathT = ( (numTendrils > 1 ? ti / (numTendrils - 1) : 0) + (fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)) ) % 1.0;
            pathFade = Math.min(pathT * 20.0, (1.0 - pathT) * 20.0, 1.0);
            const pathPt = pathCurveF.getPointAt(Math.min(0.9999, pathT));
            tendrilBaseX = pathPt.x; tendrilBaseY = pathPt.y; tendrilBaseZ = pathPt.z;
          } else if (fp.attachedShapeId) {
            const attachMesh: any = sceneObjectMeshesRef.current.get(fp.attachedShapeId);
            if (attachMesh) {
              let geom: any = null;
              attachMesh.traverse((child: any) => { if (child.isMesh && child.geometry) geom = child.geometry; });
              if (geom && geom.attributes && geom.attributes.position) {
                  const posAttr = geom.attributes.position;
                  const offsetCycle = Math.floor((fAnimT + birthOffset) / lifespan);
                  const vIdx = Math.floor((ti * 1337 + offsetCycle) * 31.14) % posAttr.count;
                  const v = new THREE.Vector3().fromBufferAttribute(posAttr, Math.floor(vIdx));
                  v.applyMatrix4(attachMesh.matrixWorld);
                  tendrilBaseX = v.x; tendrilBaseY = v.y; tendrilBaseZ = v.z;
              }
            }
          }
\;

code = code.substring(0, sIdx) + rep + code.substring(code.indexOf('          // Base spread angle', sIdx));

code = code.replace(/let activeHeight = flameHeight \* ageScale \* \\(0\.75 \+ 0\.25 \* lifeFade\\) \* sharedHeightScale;/, 'let activeHeight = flameHeight * ageScale * (0.75 + 0.25 * lifeFade) * sharedHeightScale * pathFade;');
code = code.replace(/const baseWidthMul = Math\\.max\\(0\\.05, 1\\.0 \\- detachT \\* 0\\.9\\);/, 'const baseWidthMul = Math.max(0.05, 1.0 - detachT * 0.9) * pathFade;');

code = code.replace('let attachMesh = ', 'let ignoredMesh = '); // avoid conflict if left
code = code.replace(/if \\(false\\) \\{\\s*const pathT =[^}]*\\}\\s*/gs, '');

fs.writeFileSync('src/Scene3D.tsx', code, 'utf8');
console.log('Done');
