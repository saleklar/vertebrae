const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

const regex1 = /if \(obj\.id === selectedObjectId && obj\.type === 'Emitter'\) \{\s*return \{\s*\.\.\.obj,\s*properties:\s*\{\s*\.\.\.\(obj as EmitterObject\)\.properties,\s*\[property\]:\ value\s*\}\s*\};\s*\}/g;

code = code.replace(regex1, `if (obj.id === selectedObjectId) {
          return {
            ...obj,
            properties: {
              ...(obj.properties || {}),
              [property]: value
            }
          };
        }`);

fs.writeFileSync(file, code, 'utf8');
console.log("Patched App.tsx handleUpdateEmitterProperty");
