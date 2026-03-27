const fs = require('fs');
let c = fs.readFileSync('src/Scene3D.tsx', 'utf8');

c = c.replace(
  /fAnimT \* Math\.max\(0\.1, speed\) \* 0\.05/g,
  'fAnimT * Math.max(0.1, speed) * (fp.pathSpeed ?? 0.05)'
);

const oldPhysics = \if (force.type === 'attractor' || force.type === 'repulsor') {
                  let targetPos = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
                  if (force.targetShapeId) {
                    const ts = sceneObjectsRef.current.find(o => o.id === force.targetShapeId);
                    if (ts) targetPos.set(ts.position.x, ts.position.y, ts.position.z);
                  }
                  const sign = force.type === 'attractor' ? 1 : -1;
                  pts.forEach((p, pi) => {
                    if (pi === 0) return;
                    const pos  = new THREE.Vector3(p.x, p.y, p.z);
                    const dir  = new THREE.Vector3().subVectors(targetPos, pos);
                    const dist = dir.length();
                    const radius = Math.max(0.1, force.radius ?? 250);
                    const falloff = Math.max(0, 1 - dist / radius);
                    if (falloff <= 0 || dist < 1e-4) return;
                    dir.normalize();
                    const mag = Math.abs(force.strength) * 0.018 * falloff * modStrengthF * (pi / (FLAME_PTS - 1));
                    p.x += dir.x * sign * mag;
                    p.y += dir.y * sign * mag;
                    p.z += dir.z * sign * mag;
                  });
                } else if (force.type === 'flow-curve' && force.curveId) {
                  const pathMesh = sceneObjectMeshesRef.current.get(force.curveId) as any;
                  if (!pathMesh?.pathCurve) return;
                  const curve = pathMesh.pathCurve as THREE.Curve<THREE.Vector3>;
                  pts.forEach((p, pi) => {
                    if (pi === 0) return;
                    const pos = new THREE.Vector3(p.x, p.y, p.z);
                    let closestT = 0, minDSq = Infinity;
                    for (let si = 0; si <= 16; si++) {
                      const t = si / 16;
                      const d = curve.getPointAt(t).distanceToSquared(pos);
                      if (d < minDSq) { minDSq = d; closestT = t; }
                    }
                    const nearest = curve.getPointAt(closestT);
                    const toCurve = new THREE.Vector3().subVectors(nearest, pos);
                    const dist = toCurve.length();
                    if (dist < 1e-4) return;
                    const strength = Math.abs(force.strength) * 0.008 * modStrengthF * (pi / (FLAME_PTS - 1));
                    const pull = Math.min(1, strength / (dist + 0.01));
                    p.x += toCurve.x * pull;
                    p.y += toCurve.y * pull;
                    p.z += toCurve.z * pull;
                  });
                }\;

const newPhysics = \let targetPos = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
                if (force.targetShapeId) {
                  const ts = sceneObjectsRef.current.find(o => o.id === force.targetShapeId);
                  if (ts) targetPos.set(ts.position.x, ts.position.y, ts.position.z);
                }

                if (force.type === 'attractor' || force.type === 'repulsor') {
                  const sign = force.type === 'attractor' ? 1 : -1;
                  pts.forEach((p, pi) => {
                    if (pi === 0) return;
                    const pos  = new THREE.Vector3(p.x, p.y, p.z);
                    const dir  = new THREE.Vector3().subVectors(targetPos, pos);
                    const dist = dir.length();
                    const radius = Math.max(0.1, force.radius ?? 250);
                    const falloff = Math.max(0, 1 - dist / radius);
                    if (falloff <= 0 || dist < 1e-4) return;
                    dir.normalize();
                    const mag = Math.abs(force.strength) * 0.018 * falloff * modStrengthF * (pi / (FLAME_PTS - 1));
                    p.x += dir.x * sign * mag;
                    p.y += dir.y * sign * mag;
                    p.z += dir.z * sign * mag;
                  });
                } else if (force.type === 'flow-curve' && force.curveId) {
                  const pathMesh = sceneObjectMeshesRef.current.get(force.curveId) as any;
                  if (!pathMesh?.pathCurve) return;
                  const curve = pathMesh.pathCurve as THREE.Curve<THREE.Vector3>;
                  pts.forEach((p, pi) => {
                    if (pi === 0) return;
                    const pos = new THREE.Vector3(p.x, p.y, p.z);
                    let closestT = 0, minDSq = Infinity;
                    for (let si = 0; si <= 16; si++) {
                      const t = si / 16;
                      const d = curve.getPointAt(t).distanceToSquared(pos);
                      if (d < minDSq) { minDSq = d; closestT = t; }
                    }
                    const nearest = curve.getPointAt(closestT);
                    const toCurve = new THREE.Vector3().subVectors(nearest, pos);
                    const dist = toCurve.length();
                    if (dist < 1e-4) return;
                    const strength = Math.abs(force.strength) * 0.008 * modStrengthF * (pi / (FLAME_PTS - 1));
                    const pull = Math.min(1, strength / (dist + 0.01));
                    p.x += toCurve.x * pull;
                    p.y += toCurve.y * pull;
                    p.z += toCurve.z * pull;
                  });
                } else if (force.type === 'wind') {
                   const dir = new THREE.Vector3(force.direction?.x ?? 0, force.direction?.y ?? 0, force.direction?.z ?? 0);
                   if (dir.lengthSq() < 0.001) return;
                   pts.forEach((p, pi) => {
                     if (pi === 0) return;
                     const mag = force.strength * 0.1 * modStrengthF * (pi / (FLAME_PTS - 1));
                     p.x += dir.x * mag;
                     p.y += dir.y * mag;
                     p.z += dir.z * mag;
                   });
                } else if (force.type === 'tornado' || force.type === 'vortex') {
                   const liftSign = force.type === 'tornado' ? 1 : -1;
                   pts.forEach((p, pi) => {
                     if (pi === 0) return;
                     const dx = p.x - targetPos.x;
                     const dz = p.z - targetPos.z;
                     const dist = Math.sqrt(dx*dx + dz*dz);
                     const radius = Math.max(0.1, force.radius ?? 150);
                     const falloff = Math.max(0, 1 - dist / radius);
                     if (falloff <= 0) return;
                     
                     const piWeight = (pi / (FLAME_PTS - 1));
                     // Increased tornado angle influence slightly
                     const angle = force.strength * 0.1 * falloff * modStrengthF * piWeight;
                     
                     const cosA = Math.cos(angle);
                     const sinA = Math.sin(angle);
                     const nx = targetPos.x + dx * cosA - dz * sinA;
                     const nz = targetPos.z + dx * sinA + dz * cosA;
                     
                     p.x = nx + (force.type === 'tornado' ? -dx * 0.02 * force.strength * falloff : 0);
                     p.z = nz + (force.type === 'tornado' ? -dz * 0.02 * force.strength * falloff : 0);
                     p.y += liftSign * force.strength * 0.1 * falloff * piWeight * modStrengthF;
                   });
                } else if (force.type === 'turbulence') {
                   const radius = Math.max(0.1, force.radius ?? 50);
                   // Using simple offset noise to deform points
                   pts.forEach((p, pi) => {
                      if (pi === 0) return;
                      const piWeight = (pi / (FLAME_PTS - 1));
                      const turbX = (Math.sin(p.y / radius + fAnimT) + Math.cos(p.z / radius)) * 0.5;
                      const turbY = (Math.sin(p.z / radius + fAnimT) + Math.cos(p.x / radius)) * 0.5;
                      const turbZ = (Math.sin(p.x / radius + fAnimT) + Math.cos(p.y / radius)) * 0.5;
                      const mag = force.strength * 2.0 * modStrengthF * piWeight;
                      p.x += turbX * mag;
                      p.y += turbY * mag;
                      p.z += turbZ * mag;
                   });
                } else if (force.type === 'thermal-updraft') {
                   pts.forEach((p, pi) => {
                      if (pi === 0) return;
                      const dx = p.x - targetPos.x;
                      const dz = p.z - targetPos.z;
                      const dist = Math.sqrt(dx*dx + dz*dz);
                      const radius = Math.max(0.1, force.radius ?? 150);
                      const falloff = Math.max(0, 1 - dist / radius);
                      if (falloff <= 0) return;
                      const mag = force.strength * 0.15 * falloff * modStrengthF * (pi / (FLAME_PTS - 1));
                      p.y += mag * 2.5; 
                      p.x += dx * mag * 0.05; 
                      p.z += dz * mag * 0.05;
                   });
                } else if (force.type === 'gravity') {
                   pts.forEach((p, pi) => {
                      if (pi === 0) return;
                      const mag = force.strength * 0.5 * modStrengthF * (pi / (FLAME_PTS - 1));
                      p.y -= mag;
                   });
                } else if (force.type === 'drag' || force.type === 'damping') {
                   const baseX = pts[0].x;
                   const baseZ = pts[0].z;
                   pts.forEach((p, pi) => {
                      if (pi === 0) return;
                      const piWeight = (pi / (FLAME_PTS - 1));
                      const drag = Math.max(0, Math.min(1, force.strength * 0.05 * modStrengthF * piWeight));
                      p.x += (baseX - p.x) * drag;
                      p.z += (baseZ - p.z) * drag;
                      p.y *= Math.max(0, 1 - force.strength * 0.01 * modStrengthF * piWeight);
                   });
                }\;

c = c.replace(oldPhysics, newPhysics);

// fallback for CR LF
c = c.replace(oldPhysics.replaceAll('\n', '\r\n'), newPhysics);

fs.writeFileSync('src/Scene3D.tsx', c);
console.log('Done scene physics patch');
