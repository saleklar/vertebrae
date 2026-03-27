const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<button className="create-shelf-action" onClick=\{\(\) => \{\s*const sId = 'saber_' \+ Date\.now\(\);\s*const saber = \{[\s\S]*?setSceneObjects\(prev => \[\.\.\.prev, saber, \.\.\.pts\]\);\s*setSelectedObjectId\(sId\);\s*setShowScenePropertiesPanel\(true\);\s*\}\} type="button">/;

if (!regex.test(code)) {
    console.log("Could not find saber button in App.tsx");
    process.exit(1);
}

const inject = `<button className="create-shelf-action" onClick={() => {
              if (!selectedObject || selectedObject.type !== 'Path') {
                window.alert('Please select a bezier curve first');
                return;
              }
              const sId = 'saber_' + Date.now();
              const saber = {
                id: sId,
                name: 'Saber',
                type: 'Saber',
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                parentId: null,
                properties: {
                  targetPathId: selectedObject.id,
                  coreColor: '#ffffff',
                  glowColor: '#0088ff',
                  coreWidth: 1.0,
                  glowWidth: 6.0,
                  startOffset: 0.0,
                  endOffset: 1.0,
                  phaseOffset: 0.0,
                  noiseIntensity: 0.5,
                  noiseScale: 5.0,
                  noiseAnimated: true,
                  noiseSpeed: 1.0,
                  smoothCurve: true,
                  coreFalloff: 0.2,
                  glowFalloff: 1.2,
                  tubularSegments: 64,
                  radiusSegments: 8,
                }
              };
              setSceneObjects(prev => [...prev, saber]);
              setSelectedObjectId(sId);
              setShowScenePropertiesPanel(true);
            }} type="button">`;

code = code.replace(regex, inject);
fs.writeFileSync('src/App.tsx', code);
console.log("Patched Saber button to require Path target.");
