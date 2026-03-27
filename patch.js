const fs = require('fs');
const filepath = 'src/Scene3D.tsx';
let content = fs.readFileSync(filepath, 'utf8');

const startTag = "if (usePhysicsF && physicsForceRef.current.length > 0)";
const startIdx = content.indexOf(startTag);

if (startIdx !== -1) {
    let braceCount = 0;
    let started = false;
    let endIdx = -1;
    for (let i = startIdx; i < content.length; i++) {
        if (content[i] === '{') {
            braceCount++;
            started = true;
        } else if (content[i] === '}') {
            braceCount--;
        }
        if (started && braceCount === 0) {
            endIdx = i;
            break;
        }
    }

    if (endIdx !== -1) {
        const oldText = content.substring(startIdx, endIdx + 1);
        console.log("Found old text: " + oldText.length + " chars");
        
        const newText = \if (usePhysicsF && physicsForceRef.current.length > 0) {
              physicsForceRef.current.forEach(force => {
                if (!force.enabled) return;
                
                let targetPos = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
                if (force.targetShapeId) {
                  const ts = sceneObjectsRef.current.find(o => o.id === force.targetShapeId);
                  if (ts) targetPos.set(ts.position.x, ts.position.y, ts.position.z);
                }
                
                pts.forEach((p, pi) => {
                  if (pi === 0) return; // Base anchor is fixed
                  
                  const pos = new THREE.Vector3(p.x, p.y, p.z);
                  const dist = pos.distanceTo(targetPos);
                  const radius = Math.max(0.1, force.radius ?? 250);
                  const falloff = Math.max(0, 1 - dist / radius);
                  const t = pi / (FLAME_PTS - 1); // 0 at base, 1 at tip
                  
                  if (falloff <= 0 && force.type !== 'wind' && force.type !== 'gravity' && force.type !== 'turbulence' && force.type !== 'drag' && force.type !== 'damping') return;
                  
                  const strength = force.strength * 0.05 * modStrengthF;
                  let applyStrength = strength * t; // Forces affect tip more
                  if (force.type === 'attractor' || force.type === 'repulsor' || force.type === 'tornado' || force.type === 'vortex' || force.type === 'thermal-updraft') {
                    applyStrength *= falloff;
                  }

                  switch (force.type) {
                    case 'attractor': {
                      const dir = new THREE.Vector3().subVectors(targetPos, pos).normalize();
                      p.x += dir.x * applyStrength;
                      p.y += dir.y * applyStrength;
                      p.z += dir.z * applyStrength;
                      break;
                    }
                    case 'repulsor': {
                      const dir = new THREE.Vector3().subVectors(pos, targetPos).normalize();
                      p.x += dir.x * applyStrength;
                      p.y += dir.y * applyStrength;
                      p.z += dir.z * applyStrength;
                      break;
                    }
                    case 'wind': {
                      if(force.direction) {
                        const dir = new THREE.Vector3(force.direction[0], force.direction[1], force.direction[2]).normalize();
                        p.x += dir.x * applyStrength;
                        p.y += dir.y * applyStrength;
                        p.z += dir.z * applyStrength;
                      }
                      break;
                    }
                    case 'gravity': {
                      p.y -= applyStrength * 2;
                      break;
                    }
                    case 'tornado':
                    case 'vortex': {
                      const dx = p.x - targetPos.x;
                      const dz = p.z - targetPos.z;
                      const rad = Math.sqrt(dx * dx + dz * dz);
                      const angle = Math.atan2(dz, dx) + applyStrength * 0.5;
                      
                      const nx = targetPos.x + Math.cos(angle) * rad;
                      const nz = targetPos.z + Math.sin(angle) * rad;
                      
                      p.x += (nx - p.x) * 0.5;
                      p.z += (nz - p.z) * 0.5;
                      p.y += applyStrength * 0.5; // slight updraft
                      break;
                    }
                    case 'turbulence': {
                      const time = performance.now() * 0.001 * Math.max(0.1, fp.speed || 1);
                      p.x += Math.sin(time * 2 + p.y * 0.02) * applyStrength * 2;
                      p.y += Math.cos(time * 2 + p.x * 0.02) * applyStrength * 2;
                      p.z += Math.sin(time * 2 + p.x * 0.02) * applyStrength * 2;
                      break;
                    }
                    case 'thermal-updraft': {
                      const dx = targetPos.x - pos.x;
                      const dz = targetPos.z - pos.z;
                      p.x += dx * applyStrength * 0.1;
                      p.z += dz * applyStrength * 0.1;
                      p.y += applyStrength * 2;
                      break;
                    }
                    case 'drag':
                    case 'damping': {
                      const basePos = new THREE.Vector3(pts[0].x, pts[0].y, pts[0].z);
                      const lerpVec = new THREE.Vector3(p.x, p.y, p.z).lerp(basePos, applyStrength * 0.02);
                      p.x = lerpVec.x; p.y = lerpVec.y; p.z = lerpVec.z;
                      break;
                    }
                    case 'flow-curve': {
                      if (force.curveId) {
                        const pathMesh = sceneObjectMeshesRef.current.get(force.curveId) as any;
                        if (!pathMesh?.pathCurve) return;
                        const curve = pathMesh.pathCurve as THREE.Curve<THREE.Vector3>;
                        let closestT = 0, minDSq = Infinity;
                        for (let si = 0; si <= 16; si++) {
                          const sqT = si / 16;
                          const d = curve.getPointAt(sqT).distanceToSquared(pos);
                          if (d < minDSq) { minDSq = d; closestT = sqT; }
                        }
                        const nearest = curve.getPointAt(closestT);
                        const toCurve = new THREE.Vector3().subVectors(nearest, pos);
                        const distC = toCurve.length();
                        if (distC < 1e-4) return;
                        const pull = Math.min(1, applyStrength * 0.5 / (distC + 0.01));
                        
                        p.x += toCurve.x * pull;
                        p.y += toCurve.y * pull;
                        p.z += toCurve.z * pull;
                      }
                      break;
                    }
                  }
                });
              });
            }\;
        content = content.substring(0, startIdx) + newText + content.substring(endIdx + 1);
        fs.writeFileSync(filepath, content, 'utf8');
        console.log("Updated!");
    } else {
        console.log("Could not find matching end brace for block.");
    }
} else {
    console.log("Tags not found");
}
