const fs = require('fs');

const file = 'src/Scene3D.tsx';
let code = fs.readFileSync(file, 'utf8');

const regex4 = /\/\/ Only use the Emitter itself as the emission source\s*const activeSources = \[obj\];/g;
code = code.replace(regex4, `// Use connected shapes as emission sources if available, otherwise just use the emitter itself
              const childShapes = Array.from(sceneObjectsRef.current.values()).filter(o => 
                o.parentId === obj.id && (o.type === 'Path' || o.type === 'Box' || o.type === 'Sphere' || o.type.toLowerCase().includes('shape') || o.type === 'Mesh')
              );
              const activeSources = childShapes.length > 0 ? childShapes : [obj];`);

fs.writeFileSync(file, code, 'utf8');
console.log("Regex patch applied to Scene3D.tsx!");
