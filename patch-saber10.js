const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex = /const closed = sp\.closed \?\? false;\s*const tension = sp\.tension \?\? 0\.5;/;

if (!regex.test(code)) {
    console.log("Could not find tension config");
    process.exit(1);
}

const inject = `const targetObj = targetId ? sceneObjectsRef.current.find(o => o.id === targetId) : undefined;
          const targetSp = (targetObj?.properties ?? {}) as any;
          const closed = targetSp.closed ?? sp.closed ?? false;
          const tension = targetSp.tension ?? sp.tension ?? 0.5;`;

code = code.replace(regex, inject);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log("Patched targetObj extraction for Saber curves");
