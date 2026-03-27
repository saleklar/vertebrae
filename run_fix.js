const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

code = code.replace(
    /const dir = new THREE.Vector3\(force\.direction\[0\], force\.direction\[1\], force\.direction\[2\]\)\.normalize\(\);/g,
    'const dir = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();'
);

fs.writeFileSync('src/Scene3D.tsx', code, 'utf8');
console.log('Fixed wind direction TS error');
