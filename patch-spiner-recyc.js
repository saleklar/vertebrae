const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

code = code.replace(/const isLastKey = k === bakedKeys\.length - 1;\s*const steppedDef = \{ curve: \x22stepped\x22 \};\s*\/\/\s+\u2500{2} Translate/, 
\const isLastKey = k === bakedKeys.length - 1;
                const steppedDef = { curve: "stepped" };

                let isRecycled = false;
                if (!isLastKey) {
                    const nextObj = bakedKeys[k + 1];
                    isRecycled = nextObj.state.age < state.age;
                }

                // \u2500\u2500 Translate\);

code = code.replace(/let translateCurveDefinition: any = steppedDef;\s*if \(!isLastKey\) \{/,
\let translateCurveDefinition: any = steppedDef;
                if (!isLastKey && !isRecycled) {\);

code = code.replace(/let rgbaCurveDefinition: any = steppedDef;\s*if \(!isLastKey\) \{/,
\let rgbaCurveDefinition: any = steppedDef;
                if (!isLastKey && !isRecycled) {\);

code = code.replace(/let scaleCurveDefinition: any = steppedDef;\s*if \(!isLastKey\) \{/,
\let scaleCurveDefinition: any = steppedDef;
                if (!isLastKey && !isRecycled) {\);

code = code.replace(/let rotateCurveDefinition: any = steppedDef;\s*if \(!isLastKey\) \{/,
\let rotateCurveDefinition: any = steppedDef;
                if (!isLastKey && !isRecycled) {\);

fs.writeFileSync('src/Scene3D.tsx', code);
console.log('patched spine exporter recycled frame stepping');
