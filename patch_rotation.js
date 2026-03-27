const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

code = code.replace(
    /rotation:\s*\(fp\.shapeTwist([^,]+),/g,
    'rotation:    (fp.shapeTwist ?? 0) * (t * Math.PI * 8.0 - ((fp.oscillation ?? 0) > 0 ? 0 : fAnimT * speed * 2.0)) + (fp.oscillation ?? 0) * (Math.sin(fAnimT * speed * 1.5 + t * Math.PI) + Math.cos(fAnimT * speed * 0.7) * 0.5),'
);

fs.writeFileSync('src/Scene3D.tsx', code, 'utf8');
console.log('Rotation patch completed');
