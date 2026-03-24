const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');
code = code.replace(/const sortedPoints = \\\\[\\\.\\\.\\\.points\\\\\]\\\.sort\\\\(\\\(a: any, b: any\\\\) => a\\\.x - b\\\.x\\\\);/g, 
  \const mappedPoints = points.map((p: any) => ({
        x: p.x !== undefined ? p.x : (p.t !== undefined ? p.t : 0),
        y: p.y !== undefined ? p.y : (p.v !== undefined ? p.v : 0),
        rx: p.rx, ry: p.ry, lx: p.lx, ly: p.ly
      }));
      const sortedPoints = [...mappedPoints].sort((a: any, b: any) => a.x - b.x);\);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log('patched');
