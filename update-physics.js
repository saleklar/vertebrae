const fs = require('fs');

const sceneFile = 'src/Scene3D.tsx';
let sceneCode = fs.readFileSync(sceneFile, 'utf8');

const targetBlock = `                                 let tangent = curve.getTangentAt(closestT);
                                 if (force.reverseFlow) {
                                     tangent.negate();
                                 }
                                 particle.velocity.addScaledVector(tangent, force.strength * deltaTime);
                               
                               const nearestPoint = curve.getPointAt(closestT);
                               const toCurve = new THREE.Vector3().subVectors(nearestPoint, particle.mesh.position);
                               if (toCurve.lengthSq() > 0.1) {
                                   toCurve.normalize();
                                   particle.velocity.addScaledVector(toCurve, Math.abs(force.strength * 0.5) * deltaTime);
                               }`;

const replacementBlock = `                                 let tangent = curve.getTangentAt(closestT);
                                 if (force.reverseFlow) {
                                     tangent.negate();
                                 }
                                 
                                 // "Steering behavior" to tightly follow the path while cancelling overshoot:
                                 let desiredSpeed = force.strength * 2.0; // The target forward speed
                                 let desiredVel = tangent.clone().multiplyScalar(desiredSpeed);
                                 
                                 const nearestPoint = curve.getPointAt(closestT);
                                 const toCurve = new THREE.Vector3().subVectors(nearestPoint, particle.mesh.position);
                                 
                                 // Add an inward pull towards the path
                                 if (toCurve.lengthSq() > 0.01) {
                                     let pullStrength = Math.abs(force.strength) * 2.5; 
                                     desiredVel.add(toCurve.normalize().multiplyScalar(pullStrength));
                                 }
                                 
                                 // Determine how far off our current velocity is from the desired velocity
                                 let steer = desiredVel.clone().sub(particle.velocity);
                                 
                                 // Apply the steering correction, bounded by a tightness factor (e.g. 5.0) 
                                 // multiplying by deltaTime ensures frame-rate independence.
                                 // Math.min(1) prevents the steering from instantly throwing the particle 
                                 // if deltaTime * responsiveness goes above 100%.
                                 let responsiveness = 5.0; 
                                 particle.velocity.add(steer.multiplyScalar(Math.min(1.0, responsiveness * deltaTime)));`;

if (sceneCode.includes(targetBlock)) {
    sceneCode = sceneCode.replace(targetBlock, replacementBlock);
    fs.writeFileSync(sceneFile, sceneCode, 'utf8');
    console.log("Successfully replaced steering logic in Scene3D.tsx");
} else {
    console.log("Could not find the target block in Scene3D.tsx!!!");
}
