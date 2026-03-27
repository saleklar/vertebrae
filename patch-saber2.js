const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<span>Flame<\/span>\s*<\/button>\s*<\/div>/;

const inject = `<span>Flame</span>
            </button>
            <button className="create-shelf-action" onClick={() => {
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
              const pts = [
                { id: 'sbpt1_' + Date.now(), name: 'Pt 1', type: 'PathPoint', position: { x: -40, y: 0, z: 0 }, rotation: { x:0,y:0,z:0 }, scale: { x:1,y:1,z:1 }, parentId: sId, properties: {} },
                { id: 'sbpt2_' + Date.now(), name: 'Pt 2', type: 'PathPoint', position: { x: 0, y: 30, z: 0 }, rotation: { x:0,y:0,z:0 }, scale: { x:1,y:1,z:1 }, parentId: sId, properties: {} },
                { id: 'sbpt3_' + Date.now(), name: 'Pt 3', type: 'PathPoint', position: { x: 40, y: 0, z: 0 }, rotation: { x:0,y:0,z:0 }, scale: { x:1,y:1,z:1 }, parentId: sId, properties: {} }
              ];
              setSceneObjects(prev => [...prev, saber, ...pts]);
              setSelectedObjectId(sId);
              setShowScenePropertiesPanel(true);
            }} type="button">
              <span className="create-shelf-action-icon">⚔</span>
              <span>Saber</span>
            </button>
          </div>`;

if (!regex.test(code)) {
  console.log('Regex not found!');
  process.exit(1);
}

code = code.replace(regex, inject);
fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx patched for Saber creation button.');
