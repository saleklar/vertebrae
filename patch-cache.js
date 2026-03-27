const fs = require('fs');
let c = fs.readFileSync('src/Scene3D.tsx', 'utf8');

c = c.replace(
  'let _lightningTexCache = new Map<string, THREE.CanvasTexture>();',
  'let _lightningTexCache = new Map<string, THREE.Texture>();'
);

c = c.replace(
  'function buildLightningGlowTex(glowHex: number, coreHex: number, shape: string = \'circle\'): THREE.CanvasTexture {',
  'function buildLightningGlowTex(glowHex: number, coreHex: number, shape: string = \'circle\'): THREE.Texture {'
);

fs.writeFileSync('src/Scene3D.tsx', c);
console.log('Cache patched');
