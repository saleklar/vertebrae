const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const initRegex = /\} else if \(obj\.type === 'Flame'\) \{/;
if (!initRegex.test(code)) {
    console.log("Could not find Flame init block.");
    process.exit(1);
}

code = code.replace(initRegex, `} else if (obj.type === 'Saber') {
          const saberGroup = new THREE.Group();
          (saberGroup as any).isSaberRender = true;
          mesh = saberGroup;
        } else if (obj.type === 'Flame') {`);

fs.writeFileSync('src/Scene3D.tsx', code);
console.log("Patched Scene3D.tsx init block.");
