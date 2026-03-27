const fs = require('fs');
let c = fs.readFileSync('src/Scene3D.tsx', 'utf8');

c = c.replace(
  'const _lightningTexCache = new Map<string, THREE.CanvasTexture>();',
  'const _lightningTexCache = new Map<string, THREE.Texture>();'
);
c = c.replace(
  'const _flameTexCache = new Map<string, THREE.CanvasTexture>();',
  'const _flameTexCache = new Map<string, THREE.Texture>();'
);

fs.writeFileSync('src/Scene3D.tsx', c);
console.log('Cache correctly patched');
