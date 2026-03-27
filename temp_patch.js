const fs = require('fs');
let src = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const prepassCode = \
        // PRE-PASS: Collect all active tendril positions to calculate heat density
        const globalTendrilBases: { x: number; z: number; weight: number }[] = [];
        sceneObjectsRef.current.forEach(fObj => {
          if (fObj.type !== 'Flame') return;
          const fp = (fObj.properties ?? {}) as any;
          const numT = fp.numTendrils ?? 5;
          const speed = fp.speed ?? 1.4;
          const fw = fp.width ?? 30;
          const fBase = { x: fObj.position.x, y: fObj.position.y, z: fObj.position.z };
          
          let pathCurveF: THREE.Curve<THREE.Vector3> | null = null;
          const targetPathIdF = fp.targetPathId as string | undefined;
          if (targetPathIdF) {
            const pathMeshF = sceneObjectMeshesRef.current.get(targetPathIdF) as any;
            if (pathMeshF?.pathCurve) pathCurveF = pathMeshF.pathCurve as THREE.Curve<THREE.Vector3>;
          }
          
          for (let ti = 0; ti < numT; ti++) {
            const slotSeed = ti * 2.399963;
            const minLife = 1.2 / Math.max(0.1, speed);
            const maxLife = 3.8 / Math.max(0.1, speed);
            const pr1 = Math.abs(Math.sin(slotSeed * 13.7 + 0.5));
            const lifespan = minLife + pr1 * (maxLife - minLife);
            const birthOffset = Math.abs(Math.sin(slotSeed * 7.3 + 1.1)) * lifespan;
            
            let bx = fBase.x, bz = fBase.z;
            if (pathCurveF) {
              const pathT = numT > 1 ? ti / (numT - 1) : 0;
              const pathPt = pathCurveF.getPointAt(Math.min(0.9999, pathT));
              bx = pathPt.x; bz = pathPt.z;
            }
            const spreadAngle = (numT > 1 ? (ti / (numT - 1)) : 0.5) * Math.PI * 2 + Math.floor((fAnimT + birthOffset) / lifespan) * 0.97;
            const baseR = fw * 0.35 * (numT > 1 ? 1 : 0);
            const baseOffX = Math.cos(spreadAngle + slotSeed) * baseR;
            const baseOffZ = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;
            
            globalTendrilBases.push({ x: bx + baseOffX, z: bz + baseOffZ, weight: fw });
          }
        });

\;

src = src.replace(
  "const FLAME_PTS = 10; // control points per tendril\\n\\n        sceneObjectsRef.current.forEach(fObj => {",
  "const FLAME_PTS = 10; // control points per tendril\\n" + prepassCode + "        sceneObjectsRef.current.forEach(fObj => {"
);

const searchStr = \
            // Height also shrinks after detach; shared breathing further modulates it
            const activeHeight = flameHeight * ageScale * (0.75 + 0.25 * lifeFade) * sharedHeightScale;

            // The actual noise seed varies per life cycle so each new tendril wiggles differently
            const tendrilSeed  = slotSeed + Math.floor((fAnimT + birthOffset) / lifespan) * 1.618;

            // Base origin: evenly distributed along target path, or all at object position
            let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y, tendrilBaseZ = fBase.z;
            if (pathCurveF) {
              const pathT = numTendrils > 1 ? ti / (numTendrils - 1) : 0;
              const pathPt = pathCurveF.getPointAt(Math.min(0.9999, pathT));
              tendrilBaseX = pathPt.x; tendrilBaseY = pathPt.y; tendrilBaseZ = pathPt.z;
            }

            // Base spread angle shifts each new life
            const spreadAngle  = (numTendrils > 1 ? (ti / (numTendrils - 1)) : 0.5) * Math.PI * 2
                               + Math.floor((fAnimT + birthOffset) / lifespan) * 0.97;
            const baseR        = flameWidth * 0.35 * (numTendrils > 1 ? 1 : 0);
            const baseOffX     = Math.cos(spreadAngle + slotSeed) * baseR;
            const baseOffZ     = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;
\;

const replaceStr = \
            // Height also shrinks after detach; shared breathing further modulates it
            let activeHeight = flameHeight * ageScale * (0.75 + 0.25 * lifeFade) * sharedHeightScale;

            // The actual noise seed varies per life cycle so each new tendril wiggles differently
            const tendrilSeed  = slotSeed + Math.floor((fAnimT + birthOffset) / lifespan) * 1.618;

            // Base origin: evenly distributed along target path, or all at object position
            let tendrilBaseX = fBase.x, tendrilBaseY = fBase.y, tendrilBaseZ = fBase.z;
            if (pathCurveF) {
              const pathT = numTendrils > 1 ? ti / (numTendrils - 1) : 0;
              const pathPt = pathCurveF.getPointAt(Math.min(0.9999, pathT));
              tendrilBaseX = pathPt.x; tendrilBaseY = pathPt.y; tendrilBaseZ = pathPt.z;
            }

            // Base spread angle shifts each new life
            const spreadAngle  = (numTendrils > 1 ? (ti / (numTendrils - 1)) : 0.5) * Math.PI * 2
                               + Math.floor((fAnimT + birthOffset) / lifespan) * 0.97;
            const baseR        = flameWidth * 0.35 * (numTendrils > 1 ? 1 : 0);
            const baseOffX     = Math.cos(spreadAngle + slotSeed) * baseR;
            const baseOffZ     = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;

            // ── Convection Heat / Mass Simulation ───────────────────────
            // Tendrils packed closely together accumulate visual heat, elongating and widening them.
            let heatDensity = 0;
            const myX = tendrilBaseX + baseOffX;
            const myZ = tendrilBaseZ + baseOffZ;
            const heatRadius = flameWidth * 1.5; 
            globalTendrilBases.forEach(other => {
              const dx = myX - other.x;
              const dz = myZ - other.z;
              const dist = Math.sqrt(dx * dx + dz * dz);
              if (dist < heatRadius) {
                // Closer tendrils add more heat (density score)
                heatDensity += (1.0 - dist / heatRadius); 
              }
            });
            // Score of ~1.0 is just 'self'. Heat rapidly amplifies for dense clusters.
            const heatMultiplier = 1.0 + Math.max(0, (heatDensity - 1.0) * 0.35);
            activeHeight *= heatMultiplier; // Inner/central tendrils stretch taller
\;

src = src.replace(searchStr, replaceStr);

const widthSearch = "const widthEnv = Math.pow(yNorm, 0.65) * flameWidth * 0.5 * ageScale * baseWidthMul;";
const widthReplace = "const widthEnv = Math.pow(yNorm, 0.65) * flameWidth * 0.5 * ageScale * baseWidthMul * (1.0 + (heatMultiplier - 1.0) * 0.65); // Add thickness from heat density";

src = src.replace(widthSearch, widthReplace);

fs.writeFileSync('src/Scene3D.tsx', src);
console.log('Patched correctly');
