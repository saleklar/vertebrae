const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex = /\/\/ ── Saber live preview ───────────────────────────────────────────────────────────────────[\s\S]*?\/\/ ── End saber live preview ─────────────────────────────────────────────────────────────────/;
if (!regex.test(code)) {
    console.log("Could not find saber block");
    process.exit(1);
}

const inject = `// ── Saber live preview ───────────────────────────────────────────────────────────────────
      {
        const sAnimT = Date.now() / 1000.0;
        sceneObjectsRef.current.forEach((sObj) => {
          if (sObj.type !== 'Saber') return;
          const sGroup = sceneObjectMeshesRef.current.get(sObj.id) as THREE.Group | undefined;
          if (!sGroup) return;

          // clean up old materials to prevent leak
          while (sGroup.children.length > 0) {
            const child = sGroup.children[0] as THREE.Sprite;
            if (child.material) {
                // only dispose if it's the first time seeing this material
                // since we will share materials among children
                if ((child.material as any).__isSaberMat) {
                    // we can dispose, but multiple children share it, so we do it carefully later.
                    // Actually, if we just clear, we can dispose of a set.
                }
            }
            sGroup.remove(child);
          }

          // Gather points
          const sPts = sceneObjectsRef.current.filter(o => o.parentId === sObj.id && o.type === 'PathPoint');
          if (sPts.length < 2) return;

          const rawPoints = sPts.map(p => {
              const pMesh = sceneObjectMeshesRef.current.get(p.id);
              if (pMesh) {
                  const wp = new THREE.Vector3();
                  pMesh.getWorldPosition(wp);
                  return wp;
              }
              return new THREE.Vector3(p.position.x, p.position.y, p.position.z);
          });

          const sp = (sObj.properties ?? {}) as any;
          const closed = sp.closed ?? false;
          const tension = sp.tension ?? 0.5;
          const curve = new THREE.CatmullRomCurve3(rawPoints, closed, 'catmullrom', tension);

          const coreColor  = new THREE.Color(sp.coreColor ?? '#ffffff');
          const glowColor  = new THREE.Color(sp.glowColor ?? '#0088ff');
          const coreWidth  = sp.coreWidth ?? 1.0;
          const glowWidth  = sp.glowWidth ?? 6.0;
          const startOff   = sp.startOffset ?? 0.0;
          const endOff     = sp.endOffset ?? 1.0;
          const phaseOff   = sp.phaseOffset ?? 0.0;
          const noiseInt   = sp.noiseIntensity ?? 0.5;
          const noiseScale = sp.noiseScale ?? 5.0;
          const isAnim     = sp.noiseAnimated ?? true;
          const noiseSpeed = sp.noiseSpeed ?? 1.0;
          const loopMode   = sp.loopMode ?? true;
          const sFalloff   = sp.glowFalloff ?? 1.2;
          const cFalloff   = sp.coreFalloff ?? 0.2;

          const tex = buildFlameTexShape(); 
          
          let segments = Math.floor(curve.getLength() * 5); 
          segments = Math.max(20, Math.min(segments, 1000));

          // Create ONE material for all glow and ONE for core per tick to avoid leak
          const matGlow = new THREE.SpriteMaterial({
              map: tex,
              color: glowColor,
              transparent: true,
              opacity: Math.max(0, 1.0 / sFalloff) * 0.5,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              depthTest: true
          });
          const matCore = new THREE.SpriteMaterial({
              map: tex,
              color: coreColor,
              transparent: true,
              opacity: Math.max(0, 1.0 / cFalloff) * 0.8,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              depthTest: true
          });
          (matGlow as any).__isSaberMat = true;
          (matCore as any).__isSaberMat = true;

          // Helper for loop distance
          const getCurvePoint = (tVal: number) => {
              if (loopMode) {
                  return curve.getPointAt((tVal % 1.0 + 1.0) % 1.0);
              }
              return curve.getPointAt(Math.max(0, Math.min(1, tVal)));
          };

          for (let i = 0; i <= segments; i++) {
              let tRaw = i / segments; 
              let t = tRaw;
              let effectiveT = startOff + (endOff - startOff) * t + phaseOff;
              
              if (loopMode) {
                  effectiveT = (effectiveT % 1.0 + 1.0) % 1.0;
              } else {
                  if (effectiveT < 0 || effectiveT > 1) continue;
              }

              const pos = getCurvePoint(effectiveT);
              let displacement = 0;
              if (noiseInt > 0) {
                 const timeOffset = isAnim ? -sAnimT * noiseSpeed : 0;
                 const noiseVal1 = Math.sin(pos.x * noiseScale * 0.1 + timeOffset) * 
                                  Math.cos(pos.y * noiseScale * 0.1 + timeOffset * 1.3) *
                                  Math.sin(pos.z * noiseScale * 0.1 + timeOffset * 0.8);
                 const noiseVal2 = Math.sin(pos.x * noiseScale * 0.3 - timeOffset * 1.1) * 
                                  Math.cos(pos.y * noiseScale * 0.3 - timeOffset * 0.9);
                 const fbm = noiseVal1 + 0.5 * noiseVal2;
                 displacement = fbm * noiseInt;
              }
              
              let edgeTaper = 1.0;
              if (!loopMode) {
                  if (tRaw < 0.05) edgeTaper = tRaw / 0.05;
                  if (tRaw > 0.95) edgeTaper = (1.0 - tRaw) / 0.05;
              }

              const sizeScale = Math.max(0.1, 1.0 + displacement) * edgeTaper;

              const spGlow = new THREE.Sprite(matGlow);
              spGlow.position.copy(pos);
              spGlow.scale.set(glowWidth * sizeScale, glowWidth * sizeScale, 1.0);
              sGroup.add(spGlow);

              const spCore = new THREE.Sprite(matCore);
              spCore.position.copy(pos);
              spCore.scale.set(coreWidth * sizeScale, coreWidth * sizeScale, 1.0);
              sGroup.add(spCore);
          }
          sGroup.position.set(0, 0, 0);
          sGroup.rotation.set(0, 0, 0);
          sGroup.scale.set(1, 1, 1);
        });
      }
      // ── End saber live preview ─────────────────────────────────────────────────────────────────`;

code = code.replace(regex, inject);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log("Patched Scene3D.tsx loop successfully.");
