const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const constantsRegex = /const phaseOff   = sp\.phaseOffset \?\? 0\.0;/;
const constantsInject = `const phaseOff   = sp.phaseOffset ?? 0.0;
          const startTaper = sp.startTaper ?? 0.05;
          const endTaper   = sp.endTaper ?? 0.05;
          const offsetSpeed= sp.offsetSpeed ?? 0.0;`;
code = code.replace(constantsRegex, constantsInject);

const effTRegex = /let effectiveT = startOff \+ \(endOff - startOff\) \* t \+ phaseOff;/;
const effTInject = `let effectiveT = startOff + (endOff - startOff) * t + phaseOff;
              if (offsetSpeed !== 0) {
                  effectiveT += sAnimT * offsetSpeed * 0.1;
              }`;
code = code.replace(effTRegex, effTInject);


const edgeTaperRegex = /let edgeTaper = 1\.0;\s*if \(!loopMode\) {\s*if \(tRaw < 0\.05\) edgeTaper = tRaw \/ 0\.05;\s*if \(tRaw > 0\.95\) edgeTaper = \(1\.0 - tRaw\) \/ 0\.05;\s*}/;

const edgeTaperInject = `let edgeTaper = 1.0;
              if (!loopMode) {
                  if (tRaw < startTaper && startTaper > 0.0) edgeTaper = tRaw / startTaper;
                  if (tRaw > 1.0 - endTaper && endTaper > 0.0) edgeTaper = (1.0 - tRaw) / endTaper;
              }`;

code = code.replace(edgeTaperRegex, edgeTaperInject);

fs.writeFileSync('src/Scene3D.tsx', code);
console.log("Patched Scene3D.tsx");