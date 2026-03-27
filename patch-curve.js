const fs = require('fs');
let c = fs.readFileSync('src/Scene3D.tsx', 'utf8');

c = c.replace(
  '                depthTest:   occludeF,\n                depthWrite:  false,\n              });',
  '                depthTest:   occludeF,\n                depthWrite:  false,\n                rotation:    (fp.shapeTwist ?? 0) * t * Math.PI * 8.0,\n              });'
);
c = c.replace(
  '                depthTest:   occludeF,\r\n                depthWrite:  false,\r\n              });',
  '                depthTest:   occludeF,\n                depthWrite:  false,\n                rotation:    (fp.shapeTwist ?? 0) * t * Math.PI * 8.0,\n              });'
);

fs.writeFileSync('src/Scene3D.tsx', c);
console.log('Rotation added to Flame');
