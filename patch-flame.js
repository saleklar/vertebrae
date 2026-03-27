const fs = require('fs');
let c = fs.readFileSync('src/Scene3D.tsx', 'utf8');

c = c.replace(
  'function buildFlameTex(innerHex: number, outerHex: number): THREE.CanvasTexture {',
  'function buildFlameTex(innerHex: number, outerHex: number): THREE.Texture {'
);
c = c.replace(
  'function buildFlameTex(innerHex: number, outerHex: number): THREE.CanvasTexture \r\n{',
  'function buildFlameTex(innerHex: number, outerHex: number): THREE.Texture {'
);
c = c.replace(
  'function buildFlameTex(innerHex: number, outerHex: number): THREE.CanvasTexture \n{',
  'function buildFlameTex(innerHex: number, outerHex: number): THREE.Texture {'
);

fs.writeFileSync('src/Scene3D.tsx', c);
