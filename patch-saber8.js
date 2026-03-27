const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex = /const sizeScale = Math\.max\(0\.1, 1\.0 \+ displacement\) \* edgeTaper;\s+const spGlow = new THREE\.Sprite\(matGlow\);\s*spGlow\.position\.copy\(pos\);\s*spGlow\.scale\.set\(glowWidth \* sizeScale, glowWidth \* sizeScale, 1\.0\);\s*sGroup\.add\(spGlow\);\s*const spCore = new THREE\.Sprite\(matCore\);\s*spCore\.position\.copy\(pos\);\s*spCore\.scale\.set\(coreWidth \* sizeScale, coreWidth \* sizeScale, 1\.0\);\s*sGroup\.add\(spCore\);/m;

if (!regex.test(code)) {
    console.log("Could not find loop body!");
    process.exit(1);
}

const inject = `const sizeScale = Math.max(0.1, 1.0 + displacement) * edgeTaper;
              const visibilityScale = Math.max(0.0, 1.0 + displacement * 1.5) * edgeTaper;

              const matGlow = new THREE.SpriteMaterial({
                  map: tex,
                  color: glowColor,
                  transparent: true,
                  opacity: Math.max(0, (1.0 / sFalloff) * 0.5 * visibilityScale),
                  blending: THREE.AdditiveBlending,
                  depthWrite: false,
                  depthTest: true
              });
              
              const spGlow = new THREE.Sprite(matGlow);
              spGlow.position.copy(pos);
              spGlow.scale.set(glowWidth * sizeScale, glowWidth * sizeScale, 1.0);
              sGroup.add(spGlow);

              const matCore = new THREE.SpriteMaterial({
                  map: tex,
                  color: coreColor,
                  transparent: true,
                  opacity: Math.max(0, (1.0 / cFalloff) * 0.8 * visibilityScale),
                  blending: THREE.AdditiveBlending,
                  depthWrite: false,
                  depthTest: true
              });
              
              const spCore = new THREE.Sprite(matCore);
              spCore.position.copy(pos);
              spCore.scale.set(coreWidth * sizeScale, coreWidth * sizeScale, 1.0);
              sGroup.add(spCore);`;

code = code.replace(regex, inject);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log("Patched per-sprite materials for Saber.")