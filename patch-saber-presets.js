const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const presetRegex = /const upd = \(key: string, val: unknown\) => handleUpdateEmitterProperty\(key, val as any\);/;
const presetInject = `const upd = (key: string, val: unknown) => handleUpdateEmitterProperty(key, val as any);
  const applyPreset = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const presetName = e.target.value;
    let preset: any = null;
    if (presetName === 'Fire') {
        preset = { coreColor: '#ffffff', coreColorEnd: '#ffff00', glowColor: '#ffaa00', glowColorEnd: '#ff0000', coreWidth: 0.5, glowWidth: 12.0, noiseIntensity: 2.5, noiseScale: 6.0, noiseSpeed: 1.5, coreFalloff: 0.2, glowFalloff: 1.5 };
    } else if (presetName === 'Neon') {
        preset = { coreColor: '#eef5ff', coreColorEnd: '#eef5ff', glowColor: '#0066ff', glowColorEnd: '#0022ff', coreWidth: 1.2, glowWidth: 15.0, noiseIntensity: 0.0, coreFalloff: 0.1, glowFalloff: 1.0 };
    } else if (presetName === 'Electric') {
        preset = { coreColor: '#ffffff', coreColorEnd: '#ffffff', glowColor: '#aa00ff', glowColorEnd: '#00aaff', coreWidth: 0.3, glowWidth: 6.0, noiseIntensity: 3.5, noiseScale: 15.0, noiseSpeed: 3.5, coreFalloff: 0.1, glowFalloff: 0.8 };
    } else if (presetName === 'Ghost') {
        preset = { coreColor: '#ffffff', coreColorEnd: '#aaffaa', glowColor: '#00ffaa', glowColorEnd: '#0088ff', coreWidth: 1.0, glowWidth: 10.0, noiseIntensity: 1.2, noiseScale: 3.0, noiseSpeed: 0.8, coreFalloff: 0.4, glowFalloff: 1.2 };
    } else if (presetName === 'Default') {
        preset = { coreColor: '#ffffff', coreColorEnd: '#ffffff', glowColor: '#0088ff', glowColorEnd: '#ff00ff', coreWidth: 1.0, glowWidth: 6.0, noiseIntensity: 0.5, noiseScale: 5.0, noiseSpeed: 1.0, glowFalloff: 1.2, coreFalloff: 0.2 };
    }
    if (preset) {
        setSceneObjects(prev => prev.map(obj => obj.id === selectedObject.id ? { ...obj, properties: { ...(obj.properties || {}), ...preset } } : obj));
    }
    // Reset select to allow choosing same preset again
    e.target.value = "";
  };`;

code = code.replace(presetRegex, presetInject);

const renderRegex = /<h4>⚔ Saber Render<\/h4>/;
const renderInject = `<h4>⚔ Saber Render</h4>
        <div className="property-row" style={{marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #3c4c5c'}}>
          <label style={{color: '#fff', fontWeight: 'bold'}}>Preset Dropdown</label>
          <select onChange={applyPreset} defaultValue="" style={{width: '60%', padding: '4px', backgroundColor: '#1a222c', color: '#fff', border: '1px solid #3c4c5c', borderRadius: '4px'}}>
            <option value="" disabled>Select Preset...</option>
            <option value="Default">Restore Default</option>
            <option value="Fire">🔥 Chaotic Fire</option>
            <option value="Neon">⭕ Smooth Neon</option>
            <option value="Electric">⚡ Electric Lightning</option>
            <option value="Ghost">👻 Ghostly Plasma</option>
          </select>
        </div>`;
code = code.replace(renderRegex, renderInject);

fs.writeFileSync('src/App.tsx', code);
console.log("Patched App.tsx with Saber presets");
