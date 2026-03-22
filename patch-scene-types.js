const fs = require('fs');
const file = 'src/Scene3D.tsx';
let code = fs.readFileSync(file, 'utf8');

const regex1 = /const childShapes = Array\.from\(sceneObjectsRef\.current\.values\(\)\)\.filter\(o =>\s*o\.parentId === obj\.id && \(o\.type === 'Path' \|\| o\.type === 'Box' \|\| o\.type === 'Sphere' \|\| o\.type\.toLowerCase\(\)\.includes\('shape'\) \|\| o\.type === 'Mesh'\)\s*\);/g;

const replacement1 = `const childShapes = Array.from(sceneObjectsRef.current.values()).filter(o =>
                  o.parentId === obj.id && o.type !== 'PathPoint' && o.type !== 'Emitter' && o.type !== 'Force'
                );`;

code = code.replace(regex1, replacement1);

const regex2 = /let emitterType = sourceProps\.emitterType \?\? 'point';\s*if \(sourceNode\.type === 'Path'\) emitterType = 'curve';\s*else if \(sourceNode\.type === 'Box'\) emitterType = 'cube';\s*else if \(sourceNode\.type === 'Sphere'\) emitterType = 'ball';\s*else if \(sourceNode\.type === 'Mesh'\) emitterType = 'mesh_bounds';/g;

const replacement2 = `let emitterType = sourceProps.emitterType ?? 'point';
                  if (sourceNode.type === 'Path') emitterType = 'curve';
                  else if (sourceNode.type === 'Cube' || sourceNode.type === 'Box') emitterType = 'cube';
                  else if (sourceNode.type === 'Sphere') emitterType = 'ball';
                  else if (sourceNode.type === 'Plane' || sourceNode.type === 'Rectangle') emitterType = 'square';
                  else if (sourceNode.type === 'Circle') emitterType = 'circle';
                  else if (sourceNode.type === 'Mesh') emitterType = 'mesh_bounds';`;

code = code.replace(regex2, replacement2);
fs.writeFileSync(file, code, 'utf8');
console.log("Patched Scene3D.tsx filter and types!");
