const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex = /while \(sGroup\.children\.length > 0\) \{[\s\S]*?sGroup\.remove\(child\);\s*\}/;

const inject = `const matsToDispose = new Set<THREE.Material>();
          while (sGroup.children.length > 0) {
            const child = sGroup.children[0] as THREE.Sprite;
            if (child.material) matsToDispose.add(child.material);
            sGroup.remove(child);
          }
          matsToDispose.forEach(m => m.dispose());`;

code = code.replace(regex, inject);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log('Fixed material dispose leak in Saber');