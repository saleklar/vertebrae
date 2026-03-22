const fs = require('fs');

const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

const regex1 = /properties:\s*\{\s*emitterType:\s*'curve'\s*\}\s*};\s*const\s*emitterId\s*=\s*'emitter_'\s*\+\s*Date\.now\(\);\s*const\s*newEmitter:\s*SceneObject\s*=\s*\{[\s\S]*?shape_emitterType:\s*'curve'\s*\}\s*};\s*pathObject\.parentId\s*=\s*emitterId;\s*const\s*pointObjects/g;

code = code.replace(regex1, `properties: { }
        };

        const pointObjects`);

const regex2 = /setSceneObjects\(prev\s*=>\s*\[\.\.\.prev,\s*newEmitter,\s*pathObject,\s*\.\.\.pointObjects\]\);\s*setSelectedObjectId\(newEmitter\.id\);/g;

code = code.replace(regex2, `setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);
      setSelectedObjectId(pathObject.id);`);
      
// Fix the hook for drawing bezier curves where `setSelectedObjectId` might not exist or might need manual replacement.
const regex3 = /setSceneObjects\(prev\s*=>\s*\[\.\.\.prev,\s*newEmitter,\s*pathObject,\s*\.\.\.pointObjects\]\);/g;
code = code.replace(regex3, `setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);`);

fs.writeFileSync(file, code, 'utf8');
console.log("Regex patch applied to App.tsx!");
