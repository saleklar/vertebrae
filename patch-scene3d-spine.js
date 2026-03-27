const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex1 = /if \(pathCurveF\) \{\s*const pathT = \( \(numT > 1 \? ti \/ \(numT - 1\) : 0\) \+ \(fAnimT \* Math\.max\(0\.1, speed\) \* \(fp\.pathSpeed \?\? 0\.05\)\) \) \% 1\.0;\s*const pathPt = pathCurveF\.getPointAt\(Math\.min\(0\.9999, pathT\)\);\s*bx = pathPt\.x; bz = pathPt\.z;\s*\}/g;

const replacement1 = `if (pathCurveF) {
              const pathT = ( (numT > 1 ? ti / (numT - 1) : 0) + (fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)) ) % 1.0;
              const pathPt = pathCurveF.getPointAt(Math.min(0.9999, pathT));
              bx = pathPt.x; bz = pathPt.z;
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
                      bx = v.x; bz = v.z;
                  }
                }
            } else if (fp.attachedSpineId) {
                const attMesh = spineAttachmentMeshesRef.current.get(fp.attachedSpineId);
                const pixData = spineAttachPixelDataRef.current.get(fp.attachedSpineId);
                if (attMesh && pixData) {
                    const isEdgeMode = fp.attachedSpineMode === 'edge';
                    const samples = isEdgeMode ? pixData.edgeSamples : pixData.surfaceSamples;
                    if (samples && samples.length > 0) {
                        const offsetCycle = Math.floor((fAnimT + birthOffset) / lifespan);
                        const sIdx = Math.floor((ti * 1337 + offsetCycle) * 31.14) % samples.length;
                        const sample = samples[sIdx];
                        const geom = attMesh.geometry as THREE.PlaneGeometry;
                        if (geom && geom.parameters) {
                            const wp = attMesh.localToWorld(new THREE.Vector3((sample.u - 0.5) * geom.parameters.width, (0.5 - sample.v) * geom.parameters.height, 0));
                            bx = wp.x; bz = wp.z;
                        }
                    }
                }
            }`;

const regex2 = /\} else if \(fp\.attachedShapeId\) \{\s*const attachMesh: any = sceneObjectMeshesRef\.current\.get\(fp\.attachedShapeId\);\s*if \(attachMesh\) \{\s*let geom: any = null;\s*attachMesh\.traverse\(\(child: any\) => \{ if \(child\.isMesh && child\.geometry\) geom = child\.geometry; \}\);\s*if \(geom && geom\.attributes && geom\.attributes\.position\) \{\s*const posAttr = geom\.attributes\.position;\s*const offsetCycle = Math\.floor\(\(fAnimT \+ birthOffset\) \/ lifespan\);\s*const vIdx = Math\.floor\(\(ti \* 1337 \+ offsetCycle\) \* 31\.14\) \% posAttr\.count;\s*const v = new THREE\.Vector3\(\)\.fromBufferAttribute\(posAttr, Math\.floor\(vIdx\)\);\s*v\.applyMatrix4\(attachMesh\.matrixWorld\);\s*tendrilBaseX = v\.x; tendrilBaseY = v\.y; tendrilBaseZ = v\.z;\s*\}\s*\}\s*\}/g;

const replacement2 = `} else if (fp.attachedShapeId) {
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
          } else if (fp.attachedSpineId) {
                const attMesh = spineAttachmentMeshesRef.current.get(fp.attachedSpineId);
                const pixData = spineAttachPixelDataRef.current.get(fp.attachedSpineId);
                if (attMesh && pixData) {
                    const isEdgeMode = fp.attachedSpineMode === 'edge';
                    const samples = isEdgeMode ? pixData.edgeSamples : pixData.surfaceSamples;
                    if (samples && samples.length > 0) {
                        const offsetCycle = Math.floor((fAnimT + birthOffset) / lifespan);
                        const sIdx = Math.floor((ti * 1337 + offsetCycle) * 31.14) % samples.length;
                        const sample = samples[sIdx];
                        const geom = attMesh.geometry as THREE.PlaneGeometry;
                        if (geom && geom.parameters) {
                            const wp = attMesh.localToWorld(new THREE.Vector3((sample.u - 0.5) * geom.parameters.width, (0.5 - sample.v) * geom.parameters.height, 0));
                            tendrilBaseX = wp.x; tendrilBaseY = wp.y; tendrilBaseZ = wp.z;
                        }
                    }
                }
          }`;

let patched1 = false;
let patched2 = false;

if (regex1.test(code)) {
    code = code.replace(regex1, replacement1);
    patched1 = true;
}

if (regex2.test(code)) {
    code = code.replace(regex2, replacement2);
    patched2 = true;
}

if (patched1 && patched2) {
    fs.writeFileSync('src/Scene3D.tsx', code, 'utf8');
    console.log("Scene3D.tsx patched successfully for Spine flame attachment!");
} else {
    console.log("Failed to patch Scene3D.tsx - regex1:", patched1, "regex2:", patched2);
}
