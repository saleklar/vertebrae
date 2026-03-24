const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const t1 = \const isLastKey = k === bakedKeys.length - 1;
                const steppedDef = { curve: "stepped" };\;

const r1 = \const isLastKey = k === bakedKeys.length - 1;
                const steppedDef = { curve: "stepped" };
                
                let isRecycled = false;
                if (!isLastKey) {
                    const nextObj = bakedKeys[k + 1];
                    isRecycled = nextObj.state.age < state.age;
                }\;

const t2 = \if (!isLastKey) {
                    const nextObj = bakedKeys[k + 1];\;

const r2 = \if (!isLastKey && !isRecycled) {
                    const nextObj = bakedKeys[k + 1];\;

code = code.replace(t1, r1);
// There are 4 if (!isLastKey) blocks
code = code.replace(t2, r2);
code = code.replace(t2, r2);
code = code.replace(t2, r2);
code = code.replace(t2, r2);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log('patched');
