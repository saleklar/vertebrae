const fs = require('fs');
let sceneCode = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex = /let smokeFBM = 0;[\s\S]*?sGroup\.add\(spCore\);\s*}/;

const replacement = `const tangent = loopMode ? 
                  curve.getTangentAt((effectiveT % 1.0 + 1.0) % 1.0) : 
                  curve.getTangentAt(Math.max(0, Math.min(1, effectiveT)));
                  
              // Create orthogonal basis for displacement
              let upVec = new THREE.Vector3(0, 1, 0);
              if (Math.abs(tangent.y) > 0.99) upVec.set(1, 0, 0);
              const right = new THREE.Vector3().crossVectors(tangent, upVec).normalize();
              const up2 = new THREE.Vector3().crossVectors(right, tangent).normalize();

              let edgeTaper = 1.0;
              if (!loopMode) {
                  if (tRaw < startTaper && startTaper > 0.0) edgeTaper = tRaw / startTaper;
                  if (tRaw > 1.0 - endTaper && endTaper > 0.0) edgeTaper = (1.0 - tRaw) / endTaper;
              }

              // Layer 1: Ambient Base Glow (Always smooth, creates the neon tube feel)
              const ambientMat = new THREE.SpriteMaterial({
                  map: tex,
                  color: currentGlowColor,
                  transparent: true,
                  opacity: Math.max(0, (1.0 / sFalloff) * 0.15 * edgeTaper),
                  blending: THREE.AdditiveBlending,
                  depthWrite: false,
                  depthTest: true
              });
              const spAmbient = new THREE.Sprite(ambientMat);
              spAmbient.position.copy(pos);
              spAmbient.scale.set(glowWidth * edgeTaper, glowWidth * edgeTaper, 1.0);
              sGroup.add(spAmbient);

              // Layer 2: Core Beam (Solid, sharp)
              const coreOpacity = Math.max(0, (1.0 / cFalloff) * 0.9) * edgeTaper;
              if (coreOpacity > 0) {
                  const matCore = new THREE.SpriteMaterial({
                      map: tex,
                      color: currentCoreColor,
                      transparent: true,
                      opacity: coreOpacity,
                      blending: THREE.AdditiveBlending,
                      depthWrite: false,
                      depthTest: true
                  });
                  const spCore = new THREE.Sprite(matCore);
                  spCore.position.copy(pos);
                  spCore.scale.set(coreWidth * edgeTaper, coreWidth * edgeTaper, 1.0);
                  sGroup.add(spCore);
              }

              // Layer 3: Energy/Plasma Strands (Jagged wisps driven by noise)
              if (noiseInt > 0) {
                 const timeOffset = isAnim ? sAnimT * noiseSpeed : 0;
                 const scale = noiseScale * 10.0; 
                 // Create 2 jagged strands wrapping around the core
                 for (let strand = 0; strand < 2; strand++) {
                     const phase = strand * 50.0; // offset noise for each strand
                     
                     // Layered sin/cos noise based strictly on 'effectiveT' and 'time'
                     // This guarantees perfect continuity along the curve!
                     const nxVec1 = Math.sin((effectiveT * scale) + timeOffset * 4.0 + phase) * Math.cos((effectiveT * scale * 0.7) - timeOffset * 2.0);
                     const nxVec2 = Math.sin((effectiveT * scale * 2.3) + timeOffset * 6.0) * Math.cos((effectiveT * scale * 1.9) + phase);
                     const offsetX = (nxVec1 + nxVec2 * 0.5) * noiseInt * glowWidth * 0.4;
                     
                     const nyVec1 = Math.cos((effectiveT * scale * 1.1) - timeOffset * 3.0 + phase) * Math.sin((effectiveT * scale * 0.8) + timeOffset * 5.0);
                     const nyVec2 = Math.cos((effectiveT * scale * 2.5) - timeOffset * 7.0) * Math.sin((effectiveT * scale * 2.1) + phase);
                     const offsetY = (nyVec1 + nyVec2 * 0.5) * noiseInt * glowWidth * 0.4;
                     
                     const strandPos = pos.clone()
                         .addScaledVector(right, offsetX * edgeTaper)
                         .addScaledVector(up2, offsetY * edgeTaper);
                         
                     // The strands are thinner and brighter than the ambient glow, forming electrical webs
                     const strandMat = new THREE.SpriteMaterial({
                         map: tex,
                         color: currentGlowColor,
                         transparent: true,
                         opacity: Math.max(0, (1.0 / sFalloff) * 0.4 * edgeTaper),
                         blending: THREE.AdditiveBlending,
                         depthWrite: false,
                         depthTest: true
                     });
                     
                     const spStrand = new THREE.Sprite(strandMat);
                     spStrand.position.copy(strandPos);
                     // Slightly vary strand width 
                     const sWidth = Math.max(0.5, glowWidth * 0.25 * (1.0 + Math.sin(effectiveT * scale * 5.0 + timeOffset * 10.0) * 0.5));
                     spStrand.scale.set(sWidth * edgeTaper, sWidth * edgeTaper, 1.0);
                     sGroup.add(spStrand);
                 }
              }
          }`;

sceneCode = sceneCode.replace(regex, replacement);
fs.writeFileSync('src/Scene3D.tsx', sceneCode);
console.log("Patched Scene3D with new Saber algorithm");
