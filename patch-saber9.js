const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex = /\/\/ Gather points\s*const sPts = sceneObjectsRef\.current\.filter\(o => o\.parentId === sObj\.id && o\.type === 'PathPoint'\);\s*if \(sPts\.length < 2\) return;/;

if (!regex.test(code)) {
    console.log("Could not find point gather code.");
    process.exit(1);
}

const inject = `// Gather points from target Path
          const sp = (sObj.properties ?? {}) as any;
          const targetId = sp.targetPathId;
          let sPts = [];
          if (targetId) {
             sPts = sceneObjectsRef.current.filter(o => o.parentId === targetId && o.type === 'PathPoint');
          } else {
             // Fallback for sabers created during earlier dev
             sPts = sceneObjectsRef.current.filter(o => o.parentId === sObj.id && o.type === 'PathPoint');
          }
          if (sPts.length < 2) return;`;

code = code.replace(regex, inject);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log("Updated Scene3D.tsx Saber points gathering.");
