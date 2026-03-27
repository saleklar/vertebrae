const fs = require('fs');

let sceneCode = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex = /let dispX = 0, dispY = 0, dispZ = 0;[\s\S]*?sGroup\.add\(spCore\);\s*}/;

const replacement = `let smokeFBM = 0;
              let energyFBM = 0;
              if (noiseInt > 0) {
                 const timeOffset = isAnim ? -sAnimT * noiseSpeed : 0;
                 
                 // Low frequency smoke
                 const sVal1 = Math.sin(pos.x * noiseScale * 0.1 + timeOffset) * Math.cos(pos.y * noiseScale * 0.1 + timeOffset * 1.3) * Math.sin(pos.z * noiseScale * 0.1 + timeOffset * 0.8);
                 const sVal2 = Math.sin(pos.x * noiseScale * 0.3 - timeOffset * 1.1) * Math.cos(pos.y * noiseScale * 0.3 - timeOffset * 0.9);
                 smokeFBM = (sVal1 + 0.5 * sVal2) * noiseInt;

                 // High frequency core energy
                 const eVal1 = Math.sin(pos.y * noiseScale * 0.5 - timeOffset * 2.0) * Math.cos(pos.z * noiseScale * 0.4 + timeOffset * 1.5);
                 energyFBM = eVal1 * noiseInt;
              }

              let edgeTaper = 1.0;
              if (!loopMode) {
                  if (tRaw < startTaper && startTaper > 0.0) edgeTaper = tRaw / startTaper;
                  if (tRaw > 1.0 - endTaper && endTaper > 0.0) edgeTaper = (1.0 - tRaw) / endTaper;
              }

              // Layer 1: Ambient Smooth Glow (No noise, pure neon base)
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
              spAmbient.scale.set(glowWidth * 0.8 * edgeTaper, glowWidth * 0.8 * edgeTaper, 1.0);
              sGroup.add(spAmbient);

              // Layer 2: Turbulent Smoke/Energy Flow (Driven by noise)
              const smokeOpacity = Math.max(0, (1.0 / sFalloff) * 0.6 * (1.0 + smokeFBM * 1.5)) * edgeTaper;
              const smokeSize = Math.max(1.0, 1.0 + smokeFBM * 2.0);
              if (smokeOpacity > 0) {
                  const smokeMat = new THREE.SpriteMaterial({
                      map: tex,
                      color: currentGlowColor,
                      transparent: true,
                      opacity: smokeOpacity,
                      blending: THREE.AdditiveBlending,
                      depthWrite: false,
                      depthTest: true,
                      rotation: Math.PI * smokeFBM * 0.5 // subtle rotation
                  });
                  const spSmoke = new THREE.Sprite(smokeMat);
                  spSmoke.position.copy(pos);
                  spSmoke.scale.set(glowWidth * smokeSize * edgeTaper, glowWidth * smokeSize * edgeTaper, 1.0);
                  sGroup.add(spSmoke);
              }

              // Layer 3: Solid Core (Driven by energy noise gently, or solid)
              const coreOpacity = Math.max(0, (1.0 / cFalloff) * 1.0 * (1.0 + energyFBM * 0.2)) * edgeTaper;
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
          }`;

sceneCode = sceneCode.replace(regex, replacement);
fs.writeFileSync('src/Scene3D.tsx', sceneCode);
console.log("Patched noise rendering in Scene3D");
