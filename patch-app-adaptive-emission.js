const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const anchor = `<input
                      id="particle-budget"
                      max={2000}
                      min={10}
                      onChange={(event) => setSceneSettings((prev) => ({
                        ...prev,
                        particleBudget: Number.parseInt(event.target.value, 10),
                      }))}
                      step={10}
                      type="range"
                      value={sceneSettings.particleBudget}
                    />`;

const replacement = anchor + `\n\n                    <label htmlFor="adaptive-emission" style={{ display: 'flex', alignItems: 'center', marginTop: '10px', fontSize: '0.81rem', color: '#c8d0e0', cursor: 'pointer' }} title="Automatically adapt emission rate so that the total lifetime of particles utilizes the continuous budget rather than creating bursts and pauses.">
                      <input
                        id="adaptive-emission"
                        type="checkbox"
                        checked={sceneSettings.adaptiveEmission !== false}
                        onChange={(event) => setSceneSettings((prev) => ({
                          ...prev,
                          adaptiveEmission: event.target.checked,
                        }))}
                        style={{ marginRight: '8px' }}
                      />
                      Adaptive Budget Rate (Spread over life)
                    </label>`;

if (code.includes(anchor)) {
    code = code.replace(anchor, replacement);
    fs.writeFileSync('src/App.tsx', code);
    console.log('Patched App.tsx successfully.');
} else {
    console.log('Anchor not found');
}
