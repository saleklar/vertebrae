const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const regex = /(<input\s+id="particle-budget".*?\/>)/s;

const match = code.match(regex);
if (match) {
    const replacement = match[1] + `\n\n                    <label htmlFor="adaptive-emission" style={{ display: 'flex', alignItems: 'center', marginTop: '10px', fontSize: '0.81rem', color: '#c8d0e0', cursor: 'pointer' }} title="Automatically adapt emission rate so that the total lifetime of particles utilizes the continuous budget rather than creating bursts and pauses.">
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
    code = code.replace(regex, replacement);
    fs.writeFileSync('src/App.tsx', code);
    console.log('Patched App.tsx successfully. (regex)');
} else {
    console.log('Regex not found');
}
