const fs = require('fs');

const sceneFile = 'src/Scene3D.tsx';
let sceneCode = fs.readFileSync(sceneFile, 'utf8');

const targetBlock = `                               // Calculate desired speed forward along path
                               let desiredSpeed = force.strength * 2.0; 
                               let desiredVel = tangent.clone().multiplyScalar(desiredSpeed);
                               
                               // Pull force toward path core
                               const nearestPoint = curve.getPointAt(closestT);
                               const toCurve = new THREE.Vector3().subVectors(nearestPoint, particle.mesh.position);
                               if (toCurve.lengthSq() > 0.01) {
                                   let pullStrength = Math.abs(force.strength) * 2.5;
                                   desiredVel.add(toCurve.normalize().multiplyScalar(pullStrength));
                               }
                               
                               // Apply correction steering (damping existing outward velocity)
                               let steer = desiredVel.clone().sub(particle.velocity);
                               let responsiveness = 5.0; // Higher = tighter hugging of the path curve
                               particle.velocity.add(steer.multiplyScalar(Math.min(1.0, responsiveness * deltaTime)));`;

const replacementBlock = `                               // Calculate desired speed forward along path
                               let desiredSpeed = force.strength * 2.0; 
                               let desiredVel = tangent.clone().multiplyScalar(desiredSpeed);
                               
                               // Pull force toward path core
                               const nearestPoint = curve.getPointAt(closestT);
                               const toCurve = new THREE.Vector3().subVectors(nearestPoint, particle.mesh.position);
                               const distToCurveSq = toCurve.lengthSq();
                               
                               // Determine the "tube" radius
                               const maxRadius = force.radius !== undefined ? Math.max(0.1, force.radius) : 50;
                               
                               let responsiveness = 5.0; // Base responsiveness
                               
                               if (distToCurveSq > 0.01) {
                                   const distToCurve = Math.sqrt(distToCurveSq);
                                   const normalizedDist = Math.max(0, distToCurve / maxRadius);
                                   
                                   // Inside the tube (normalizedDist < 1), we let the particle drift more, 
                                   // applying a very weak pull. Once it hits or exceeds the radius, the pull heavily ramps up.
                                   let pullStrength = Math.abs(force.strength) * 2.5 * Math.pow(normalizedDist, 4.0);
                                   
                                   // Cap the pull so it doesn't instantly snap back and jitter if it gets too far
                                   pullStrength = Math.min(pullStrength, Math.abs(force.strength) * 10.0);
                                   
                                   desiredVel.add(toCurve.normalize().multiplyScalar(pullStrength));
                                   
                                   // If we're freely floating inside the radius, loosen the steering responsiveness 
                                   // so particles can retain their own organic inertia and noise. 
                                   // If drifting too far out, steering gets tight again.
                                   responsiveness = Math.max(0.5, Math.min(5.0, 5.0 * Math.pow(normalizedDist, 2.0)));
                               }
                               
                               // Apply correction steering (damping existing outward velocity)
                               let steer = desiredVel.clone().sub(particle.velocity);
                               particle.velocity.add(steer.multiplyScalar(Math.min(1.0, responsiveness * deltaTime)));`;

if (sceneCode.includes(targetBlock)) {
    sceneCode = sceneCode.replace(targetBlock, replacementBlock);
    fs.writeFileSync(sceneFile, sceneCode, 'utf8');
    console.log("SUCCESS: Replaced steering logic with tube radius constraint in Scene3D.tsx");
} else {
    console.log("FAILED: Could not find the target block in Scene3D.tsx!!!");
}
