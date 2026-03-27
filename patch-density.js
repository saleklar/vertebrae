const fs = require('fs');
let sceneCode = fs.readFileSync('src/Scene3D.tsx', 'utf8');

sceneCode = sceneCode.replace(
  /let segments = Math\.floor\(curve\.getLength\(\) \* 5\);\s*segments = Math\.max\(20, Math\.min\(segments, 1000\)\);/,
  `let segments = Math.floor(curve.getLength() * 15); 
          segments = Math.max(50, Math.min(segments, 3000));` // Much higher density for jagged plasma lines
);

fs.writeFileSync('src/Scene3D.tsx', sceneCode);
console.log("Boosted segment density");
