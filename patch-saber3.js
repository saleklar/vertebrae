const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /\{\s*selectedObject\.type === 'Flame'\s*&&\s*\(\(\)\s*=>\s*\{/;

const inject = `{selectedObject.type === 'Saber' && (() => {
  const sp = (selectedObject.properties ?? {}) as any;
  const upd = (key: string, val: unknown) => handleUpdateEmitterProperty(key, val as any);
  return (
    <>
      <div className="properties-section">
        <h4>⚔ Saber Render</h4>
        <div className="property-row">
          <label>Core Color</label>
          <input type="color" value={sp.coreColor ?? '#ffffff'} onChange={(e) => upd('coreColor', e.target.value)} />
        </div>
        <div className="property-row">
          <label>Glow Color</label>
          <input type="color" value={sp.glowColor ?? '#0088ff'} onChange={(e) => upd('glowColor', e.target.value)} />
        </div>
        <div className="property-row">
          <label>Core Width</label>
          <input type="range" min="0.1" max="20" step="0.1" value={sp.coreWidth ?? 1.0} onChange={(e) => upd('coreWidth', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Glow Width</label>
          <input type="range" min="0.1" max="100" step="0.1" value={sp.glowWidth ?? 6.0} onChange={(e) => upd('glowWidth', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Core Falloff</label>
          <input type="range" min="0.0" max="2.0" step="0.01" value={sp.coreFalloff ?? 0.2} onChange={(e) => upd('coreFalloff', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Glow Falloff</label>
          <input type="range" min="0.0" max="5.0" step="0.01" value={sp.glowFalloff ?? 1.2} onChange={(e) => upd('glowFalloff', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Smooth Curve</label>
          <input type="checkbox" checked={sp.smoothCurve ?? true} onChange={(e) => upd('smoothCurve', e.target.checked)} />
        </div>
      </div>
      <div className="properties-section">
        <h4>Timing & Offsets</h4>
        <div className="property-row">
          <label>Start Offset</label>
          <input type="range" min="0" max="1" step="0.01" value={sp.startOffset ?? 0.0} onChange={(e) => upd('startOffset', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>End Offset</label>
          <input type="range" min="0" max="1" step="0.01" value={sp.endOffset ?? 1.0} onChange={(e) => upd('endOffset', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Phase Offset</label>
          <input type="range" min="-5" max="5" step="0.01" value={sp.phaseOffset ?? 0.0} onChange={(e) => upd('phaseOffset', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Loop Mode</label>
          <input type="checkbox" checked={sp.loopMode ?? true} onChange={(e) => upd('loopMode', e.target.checked)} />
        </div>
      </div>
      <div className="properties-section">
        <h4>Volumetric Distortion</h4>
        <div className="property-row">
          <label>Intensity</label>
          <input type="range" min="0" max="5" step="0.01" value={sp.noiseIntensity ?? 0.5} onChange={(e) => upd('noiseIntensity', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Scale</label>
          <input type="range" min="0.1" max="50" step="0.1" value={sp.noiseScale ?? 5.0} onChange={(e) => upd('noiseScale', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Animated</label>
          <input type="checkbox" checked={sp.noiseAnimated ?? true} onChange={(e) => upd('noiseAnimated', e.target.checked)} />
        </div>
        <div className="property-row">
          <label>Speed</label>
          <input type="range" min="0" max="10" step="0.1" value={sp.noiseSpeed ?? 1.0} onChange={(e) => upd('noiseSpeed', parseFloat(e.target.value))} />
        </div>
      </div>
      <div className="properties-section">
        <h4>Geometry Controls</h4>
        <div className="property-row">
          <label>Adding/Removing</label>
          <button onClick={() => {
            const newPt = { id: 'sbpt_' + Date.now(), name: 'Point', type: 'PathPoint', position: { x: selectedObject.position.x, y: selectedObject.position.y, z: selectedObject.position.z }, rotation: { x:0,y:0,z:0 }, scale: { x:1,y:1,z:1 }, parentId: selectedObject.id };
            setSceneObjects(prev => [...prev, newPt]);
          }}>+ Add Point</button>
        </div>
      </div>
    </>
  );
})()}

                {selectedObject.type === 'Flame' && (() => {`;

if (!regex.test(code)) {
  console.log('Regex not found!');
  process.exit(1);
}

code = code.replace(regex, inject);
fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx patched for Saber properties.');
