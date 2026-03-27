const fs = require('fs');
let c = fs.readFileSync('src/Scene3D.tsx', 'utf8');

c = c.replace(
  'let _flameShapeTexCache = new Map<string, THREE.CanvasTexture>();\nfunction buildFlameTexShape(shape: string = \'circle\'): THREE.CanvasTexture {',
  'let _flameShapeTexCache = new Map<string, THREE.Texture>();\nfunction buildFlameTexShape(shape: string = \'circle\'): THREE.Texture {'
);
c = c.replace(
  'let _flameShapeTexCache = new Map<string, THREE.CanvasTexture>();\r\nfunction buildFlameTexShape(shape: string = \'circle\'): THREE.CanvasTexture {',
  'let _flameShapeTexCache = new Map<string, THREE.Texture>();\nfunction buildFlameTexShape(shape: string = \'circle\'): THREE.Texture {'
);

c = c.replace(
  'let _lightningTexCache = new Map<string, THREE.CanvasTexture>();\nfunction buildLightningGlowTex(glowHex: number, coreHex: number, shape: string = \'circle\'): THREE.CanvasTexture {',
  'let _lightningTexCache = new Map<string, THREE.Texture>();\nfunction buildLightningGlowTex(glowHex: number, coreHex: number, shape: string = \'circle\'): THREE.Texture {'
);
c = c.replace(
  'let _lightningTexCache = new Map<string, THREE.CanvasTexture>();\r\nfunction buildLightningGlowTex(glowHex: number, coreHex: number, shape: string = \'circle\'): THREE.CanvasTexture {',
  'let _lightningTexCache = new Map<string, THREE.Texture>();\nfunction buildLightningGlowTex(glowHex: number, coreHex: number, shape: string = \'circle\'): THREE.Texture {'
);

fs.writeFileSync('src/Scene3D.tsx', c);
console.log('Types patched');
