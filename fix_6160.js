const fs = require('fs');
const lines = fs.readFileSync('src/Scene3D.tsx', 'utf8').split('\n');

const sIdx = lines.findIndex(l => l.includes('let tendrilBaseX = fBase.x'));
const eIdx = lines.findIndex((l, i) => i > sIdx && l.includes('// Base spread angle shifts each new life'));

if (sIdx > -1 && eIdx > -1) {
    const repLines = \            let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y, tendrilBaseZ = fBase.z;
            let pathFade = 1.0;
            if (pathCurveF) {
              const pathT = ( (numTendrils > 1 ? ti / (numTendrils - 1) : 0) + (fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)) ) % 1.0;
              pathFade = Math.min(pathT * 20.0, (1.0 - pathT) * 20.0, 1.0);
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
                    v.applyMatrix4(attachMesh.matrixWorld);
                    tendrilBaseX = v.x; tendrilBaseY = v.y; tendrilBaseZ = v.z;
                }
              }
            }
\.split('\\n');

    lines.splice(sIdx, eIdx - sIdx, ...repLines);

    let activeIdx = lines.findIndex(l => l.includes('let activeHeight = flameHeight * ageScale'));
    if (activeIdx > -1) lines[activeIdx] = lines[activeIdx].replace(/;?$/, '') + ' * pathFade;';
    let baseMulIdx = lines.findIndex(l => l.includes('const baseWidthMul = Math.max(0.05, 1.0 - detachT * 0.9)'));
    if (baseMulIdx > -1) lines[baseMulIdx] = lines[baseMulIdx].replace(/;?$/, '') + ' * pathFade;';

    fs.writeFileSync('src/Scene3D.tsx', lines.join('\n'), 'utf8');
    console.log('Fixed block');
} else {
    console.log('Block not found');
}
