const fs = require('fs');
const file = 'src/Scene3D.tsx';
let code = fs.readFileSync(file, 'utf8');

const oldStr = `                  const sourceProps = (sourceNode.properties ?? {}) as Record<string, any>;
                  const emitterType = sourceProps.emitterType ?? 'point';
                  const emissionMode = sourceProps.emissionMode ?? emitterProps.emissionMode ?? 'volume';`;

const newStr = `                  const sourceProps = (sourceNode.properties ?? {}) as Record<string, any>;
                  let emitterType = sourceProps.emitterType ?? 'point';
                  if (sourceNode.type === 'Path') emitterType = 'curve';
                  else if (sourceNode.type === 'Box') emitterType = 'cube';
                  else if (sourceNode.type === 'Sphere') emitterType = 'ball';
                  else if (sourceNode.type === 'Mesh') emitterType = 'mesh_bounds';
                  const emissionMode = sourceProps.emissionMode ?? emitterProps.emissionMode ?? 'volume';`;

if(code.includes(oldStr)) {
    code = code.replace(oldStr, newStr);
    fs.writeFileSync(file, code, 'utf8');
    console.log("Successfully patched emitterType logic in Scene3D.tsx");
} else {
    console.log("Failed to find emitterType block in Scene3D.tsx");
}
