const fs = require('fs');

// Patch App.tsx
let appCode = fs.readFileSync('src/App.tsx', 'utf8');

const appDefaultsRegex = /coreColor: '#ffffff',\s*glowColor: '#0088ff',/g;
const appDefaultsInject = `coreColor: '#ffffff',
                  coreColorEnd: '#ffffff',
                  glowColor: '#0088ff',
                  glowColorEnd: '#ff00ff',`;
appCode = appCode.replace(appDefaultsRegex, appDefaultsInject);

const appPropsRegex = /<div className="property-row">\s*<label>Glow Color<\/label>[\s\S]*?<\/div>/;
const appPropsInject = `<div className="property-row">
          <label>Glow Color</label>
          <input type="color" value={sp.glowColor ?? '#0088ff'} onChange={(e) => upd('glowColor', e.target.value)} />
        </div>
        <div className="property-row">
          <label>Glow Color End</label>
          <input type="color" value={sp.glowColorEnd ?? sp.glowColor ?? '#ff00ff'} onChange={(e) => upd('glowColorEnd', e.target.value)} />
        </div>
        <div className="property-row">
          <label>Core Color End</label>
          <input type="color" value={sp.coreColorEnd ?? sp.coreColor ?? '#ffffff'} onChange={(e) => upd('coreColorEnd', e.target.value)} />
        </div>`;
appCode = appCode.replace(appPropsRegex, appPropsInject);

fs.writeFileSync('src/App.tsx', appCode);

// Patch Scene3D.tsx
let sceneCode = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const sceneColorsRegex = /const coreColor  = new THREE\.Color\(sp\.coreColor \?\? '#ffffff'\);\s*const glowColor  = new THREE\.Color\(sp\.glowColor \?\? '#0088ff'\);/;
const sceneColorsInject = `const coreColorStart  = new THREE.Color(sp.coreColor ?? '#ffffff');
          const coreColorEnd    = new THREE.Color(sp.coreColorEnd ?? sp.coreColor ?? '#ffffff');
          const glowColorStart  = new THREE.Color(sp.glowColor ?? '#0088ff');
          const glowColorEnd    = new THREE.Color(sp.glowColorEnd ?? sp.glowColor ?? '#ff00ff');`;
sceneCode = sceneCode.replace(sceneColorsRegex, sceneColorsInject);

const sceneLoopRegex = /const pos = getCurvePoint\(effectiveT\);[\s\S]*?sGroup\.add\(spCore\);\s*}/;
const sceneLoopInject = `const pos = getCurvePoint(effectiveT);
              
              const currentGlowColor = new THREE.Color().copy(glowColorStart).lerp(glowColorEnd, tRaw);
              const currentCoreColor = new THREE.Color().copy(coreColorStart).lerp(coreColorEnd, tRaw);

              let dispX = 0, dispY = 0, dispZ = 0;
              let displacementMag = 0;
              let rotDisp = 0;
              if (noiseInt > 0) {
                 const timeOffset = isAnim ? -sAnimT * noiseSpeed : 0;
                 // 3D FBM smoke offset
                 const nx = Math.sin(pos.y * noiseScale * 0.2 + timeOffset) * Math.cos(pos.z * noiseScale * 0.2 - timeOffset * 0.8);
                 const ny = Math.sin(pos.z * noiseScale * 0.2 + timeOffset * 1.1) * Math.cos(pos.x * noiseScale * 0.2 - timeOffset);
                 const nz = Math.sin(pos.x * noiseScale * 0.2 + timeOffset * 0.9) * Math.cos(pos.y * noiseScale * 0.2 - timeOffset * 1.2);
                 
                 dispX = nx * noiseInt * (glowWidth * 0.5);
                 dispY = ny * noiseInt * (glowWidth * 0.5);
                 dispZ = nz * noiseInt * (glowWidth * 0.5);
                 displacementMag = Math.sqrt(nx*nx + ny*ny + nz*nz) * noiseInt;
                 rotDisp = nx * Math.PI;
              }

              let edgeTaper = 1.0;
              if (!loopMode) {
                  if (tRaw < startTaper && startTaper > 0.0) edgeTaper = tRaw / startTaper;
                  if (tRaw > 1.0 - endTaper && endTaper > 0.0) edgeTaper = (1.0 - tRaw) / endTaper;
              }

              const coreSizeScale = edgeTaper; 
              const glowSizeScale = Math.max(0.1, 1.0 + displacementMag * 1.5) * edgeTaper;
              
              const visibilityScale = Math.max(0.0, 1.0 + displacementMag) * edgeTaper;

              const matGlow = new THREE.SpriteMaterial({
                  map: tex,
                  color: currentGlowColor,
                  transparent: true,
                  opacity: Math.max(0, (1.0 / sFalloff) * 0.5 * visibilityScale),
                  blending: THREE.AdditiveBlending,
                  depthWrite: false,
                  depthTest: true,
                  rotation: rotDisp
              });

              const spGlow = new THREE.Sprite(matGlow);
              spGlow.position.set(pos.x + dispX, pos.y + dispY, pos.z + dispZ);
              spGlow.scale.set(glowWidth * glowSizeScale, glowWidth * glowSizeScale, 1.0);
              sGroup.add(spGlow);

              const matCore = new THREE.SpriteMaterial({
                  map: tex,
                  color: currentCoreColor,
                  transparent: true,
                  opacity: Math.max(0, (1.0 / cFalloff) * 0.8 * edgeTaper),
                  blending: THREE.AdditiveBlending,
                  depthWrite: false,
                  depthTest: true
              });

              const spCore = new THREE.Sprite(matCore);
              spCore.position.copy(pos); // Core STAYS on the line
              spCore.scale.set(coreWidth * coreSizeScale, coreWidth * coreSizeScale, 1.0);
              sGroup.add(spCore);
          }`;
sceneCode = sceneCode.replace(sceneLoopRegex, sceneLoopInject);

fs.writeFileSync('src/Scene3D.tsx', sceneCode);
console.log("Patched App and Scene3D successfully.");
