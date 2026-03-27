const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

code = code.replace(/let pathFade = 1.0;\s*/g, '');
code = code.replace(/pathFade = Math\.min\(pathT \* 20\.0, \(1\.0 - pathT\) \* 20\.0, 1\.0\);\s*(\/\/.*)?\n/g, '');
code = code.replace(/ \* pathFade/g, '');

fs.writeFileSync('src/Scene3D.tsx', code, 'utf8');
