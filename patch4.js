const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const s1 = \const baseWidthMul = Math.max(0.05, 1.0 - detachT * 0.9);\;
const r1 = \let pathFade = 1.0;
            if (pathCurveF) {
              const pathT = ( (numTendrils > 1 ? ti / (numTendrils - 1) : 0) + (fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)) ) % 1.0;
              pathFade = Math.min(pathT * 20.0, (1.0 - pathT) * 20.0, 1.0);
            }
            const baseWidthMul = Math.max(0.05, 1.0 - detachT * 0.9) * pathFade;
            activeHeight *= pathFade;\

code = code.replace(s1, r1);

const s2 = \let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y, tendrilBaseZ = fBase.z;
            if (pathCurveF) {
              const pathT = ( (numTendrils > 1 ? ti / (numTendrils - 1) : 0) + (fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)) ) % 1.0;
              const pathPt = pathCurveF.getPointAt(Math.min(0.9999, pathT));
              tendrilBaseX = pathPt.x; tendrilBaseY = pathPt.y; tendrilBaseZ = pathPt.z;
            }\
const r2 = \let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y, tendrilBaseZ = fBase.z;
            if (pathCurveF) {
              const pathT = ( (numTendrils > 1 ? ti / (numTendrils - 1) : 0) + (fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)) ) % 1.0;
              const pathPt = pathCurveF.getPointAt(Math.min(0.9999, pathT));
              tendrilBaseX = pathPt.x; tendrilBaseY = pathPt.y; tendrilBaseZ = pathPt.z;
            } else if (fp.attachedShapeId) {
              const attachMesh = sceneObjectMeshesRef.current.get(fp.attachedShapeId) as any;
              if (attachMesh) {
                let geom: any;
                attachMesh.traverse((child: any) => { if (child.isMesh && child.geometry) geom = child.geometry; });
                if (geom && geom.attributes && geom.attributes.position) {
                    const posAttr = geom.attributes.position;
                    const offsetCycle = Math.floor((fAnimT + birthOffset) / lifespan);
                    const vIdx = Math.floor((ti * 1337 + offsetCycle) * 31.14) % posAttr.count;
                    const v = new THREE.Vector3().fromBufferAttribute(posAttr, vIdx);
                    // note: we need world position!
                    v.applyMatrix4(attachMesh.matrixWorld);
                    tendrilBaseX = v.x; tendrilBaseY = v.y; tendrilBaseZ = v.z;
                }
              }
            }\

code = code.replace(s2, r2);
fs.writeFileSync('src/Scene3D.tsx', code, 'utf8');
