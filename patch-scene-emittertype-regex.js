const fs = require('fs');
const file = 'src/Scene3D.tsx';
let code = fs.readFileSync(file, 'utf8');

const regex = /const sourceProps = \(sourceNode\.properties \?\? \{\}\) as Record<string, any>;\s+const emitterType = sourceProps\.emitterType \?\? 'point';/g;

const replacement = `const sourceProps = (sourceNode.properties ?? {}) as Record<string, any>;
                  let emitterType = sourceProps.emitterType ?? 'point';
                  if (sourceNode.type === 'Path') emitterType = 'curve';
                  else if (sourceNode.type === 'Box') emitterType = 'cube';
                  else if (sourceNode.type === 'Sphere') emitterType = 'ball';
                  else if (sourceNode.type === 'Mesh') emitterType = 'mesh_bounds';`;

code = code.replace(regex, replacement);
fs.writeFileSync(file, code, 'utf8');
console.log("Successfully regex-patched emitterType logic in Scene3D.tsx");
