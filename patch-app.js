const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

// The block in `handleFinishDrawBezierCurve` starts around line 465
// and `applySpineJson` is further down. Let's do replacements.

const oldBlock = `        properties: { emitterType: 'curve' }
      };

      const emitterId = 'emitter_' + Date.now();
      const newEmitter: SceneObject = {
        id: emitterId,
        name: 'Bezier Emitter',
        type: 'Emitter',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: null,
        properties: {
          emissionRate: 100,
          particleSpeed: 10,
          particleLifetime: 3,
          particleSize: 5,
          particleColor: '#ffffff',
          shape_emitterType: 'curve'
        }
      };

      pathObject.parentId = emitterId;

      const pointObjects: SceneObject[] = points.map((pt, i) => ({
        id: 'bezier_pt_' + Date.now() + '_' + i,
        name: 'Point ' + i,
        type: 'PathPoint',
        position: { x: pt.x, y: pt.y, z: pt.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: pathId,
        properties: {}
      }));

      setSceneObjects(prev => [...prev, newEmitter, pathObject, ...pointObjects]);
      setSelectedObjectId(newEmitter.id);`;

const newBlock = `        properties: { }
      };

      const pointObjects: SceneObject[] = points.map((pt, i) => ({
        id: 'bezier_pt_' + Date.now() + '_' + i,
        name: 'Point ' + i,
        type: 'PathPoint',
        position: { x: pt.x, y: pt.y, z: pt.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: pathId,
        properties: {}
      }));

      setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);
      setSelectedObjectId(pathObject.id);`;

if (code.includes(oldBlock)) {
    code = code.replace(oldBlock, newBlock);
} else {
    console.log("Could not find block 1 in App.tsx");
}


// Wait, there's another instance of Bezier shape generation in App.tsx (the Add Bezier Curve button).
const oldBlock2 = `        properties: { emitterType: 'curve' }
      };

      const emitterId = 'emitter_' + Date.now();
      const newEmitter: SceneObject = {
        id: emitterId,
        name: 'Bezier Emitter',
        type: 'Emitter',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: null,
        properties: {
          emissionRate: 100,
          particleSpeed: 10,
          particleLifetime: 3,
          particleSize: 5,
          particleColor: '#ffffff',
          shape_emitterType: 'curve'
        }
      };

      pathObject.parentId = emitterId;

      const pointObjects: SceneObject[] = simplifiedPoints.map((pt, i) => ({
        id: 'path_pt_' + Date.now() + '_' + i,
        name: 'Point ' + i,
        type: 'PathPoint',
        position: { x: pt.x, y: pt.y, z: pt.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: pathId,
        properties: {}
      }));

      setSceneObjects(prev => [...prev, newEmitter, pathObject, ...pointObjects]);
      setSelectedObjectId(newEmitter.id);`;

const newBlock2 = `        properties: { }
      };

      const pointObjects: SceneObject[] = simplifiedPoints.map((pt, i) => ({
        id: 'path_pt_' + Date.now() + '_' + i,
        name: 'Point ' + i,
        type: 'PathPoint',
        position: { x: pt.x, y: pt.y, z: pt.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: pathId,
        properties: {}
      }));

      setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);
      setSelectedObjectId(pathObject.id);`;

if (code.includes(oldBlock2)) {
    code = code.replace(oldBlock2, newBlock2);
} else {
    console.log("Could not find block 2 in App.tsx");
}

fs.writeFileSync(file, code, 'utf8');
console.log("App.tsx patches applied");
