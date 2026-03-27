const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');
const search = "const sPts = sceneObjectsRef.current.filter(o => o.parentId === sObj.id && o.type === 'PathPoint');";
const replace = "const targetPathId = (sObj.properties ?? {}).targetPathId || sObj.id; const sPts = sceneObjectsRef.current.filter(o => o.parentId === targetPathId && o.type === 'PathPoint');";
code = code.replace(search, replace);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log('Fixed');
