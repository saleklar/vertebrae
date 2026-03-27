const fs = require('fs');
let c = fs.readFileSync('src/Scene3D.tsx', 'utf8');

c = c.replace(
  'if (_flameShapeTexCache.has(shape)) return _flameShapeTexCache.get(shape)!;\n  const S = 128, H = S / 2;',
  'if (_flameShapeTexCache.has(shape)) return _flameShapeTexCache.get(shape)!;\n  if (shape.startsWith("data:image")) {\n    const tex = new THREE.TextureLoader().load(shape);\n    _flameShapeTexCache.set(shape, tex);\n    return tex;\n  }\n  const S = 128, H = S / 2;'
);
c = c.replace(
  'if (_flameShapeTexCache.has(shape)) return _flameShapeTexCache.get(shape)!;\r\n  const S = 128, H = S / 2;',
  'if (_flameShapeTexCache.has(shape)) return _flameShapeTexCache.get(shape)!;\n  if (shape.startsWith("data:image")) {\n    const tex = new THREE.TextureLoader().load(shape);\n    _flameShapeTexCache.set(shape, tex);\n    return tex;\n  }\n  const S = 128, H = S / 2;'
);

c = c.replace(
  'if (_lightningTexCache.has(key)) return _lightningTexCache.get(key)!;\n  const S = 128, H = S / 2;',
  'if (_lightningTexCache.has(key)) return _lightningTexCache.get(key)!;\n  if (shape.startsWith("data:image")) {\n    const tex = new THREE.TextureLoader().load(shape);\n    _lightningTexCache.set(key, tex);\n    return tex;\n  }\n  const S = 128, H = S / 2;'
);
c = c.replace(
  'if (_lightningTexCache.has(key)) return _lightningTexCache.get(key)!;\r\n  const S = 128, H = S / 2;',
  'if (_lightningTexCache.has(key)) return _lightningTexCache.get(key)!;\n  if (shape.startsWith("data:image")) {\n    const tex = new THREE.TextureLoader().load(shape);\n    _lightningTexCache.set(key, tex);\n    return tex;\n  }\n  const S = 128, H = S / 2;'
);

fs.writeFileSync('src/Scene3D.tsx', c);
console.log('Done types');
