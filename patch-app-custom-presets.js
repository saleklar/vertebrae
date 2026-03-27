const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /{FLAME_PRESETS\.map\(preset => \([\s\S]*?<\/button>\s*\)\)}\s*<\/div>/;

const newString = `{FLAME_PRESETS.map(preset => (
                          <button
                            key={preset.label}
                            onClick={() => applyPreset(preset)}
                            title={preset.label}
                            style={{
                              padding: '4px 8px',
                              backgroundColor: '#1e2c3a',
                              color: '#ddccaa',
                              border: '1px solid #4a5a3a',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                          >
                            <span>{preset.emoji}</span>
                            <span>{preset.label}</span>
                          </button>
                        ))}
                        {customFlamePresets.map((preset, idx) => (
                          <button
                            key={'custom_'+preset.label+'_'+idx}
                            onClick={() => applyPreset(preset)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                if (confirm('Delete custom preset "' + preset.label + '"?')) {
                                    const next = customFlamePresets.filter((_, i) => i !== idx);
                                    setCustomFlamePresets(next);
                                    localStorage.setItem('v_customFlamePresets', JSON.stringify(next));
                                }
                            }}
                            title={preset.label + " (Right-click to delete)"}
                            style={{
                              padding: '4px 8px',
                              backgroundColor: '#2a1a3a',
                              color: '#ccaadd',
                              border: '1px solid #5a3a5a',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                          >
                            <span>{preset.emoji}</span>
                            <span>{preset.label}</span>
                          </button>
                        ))}
                        <button
                          onClick={() => {
                              const name = prompt('Enter a name for your custom flame preset:', 'My Flame');
                              if (name) {
                                  const emoji = prompt('Enter an emoji for this preset:', '🔥') || '🔥';
                                  // extract current props
                                  const p = (selectedObject.properties ?? {}) as any;
                                  const propNames = [
                                    'coreColor', 'coreColorTop', 'glowColor', 'glowColorTop', 'height', 'width', 'numTendrils',
                                    'detachRate', 'turbulence', 'speed', 'flickerType', 'flickerIntensity', 'coreWidth', 'coreBlur',
                                    'glowWidth', 'glowFalloff', 'density', 'emberFrequency', 'emberSize', 'emberLife', 'emberOffset', 'emberSpeed', 'oscillation', 'shapeTwist'
                                  ];
                                  const newProps: any = {};
                                  propNames.forEach(pn => {
                                      if (p[pn] !== undefined) newProps[pn] = p[pn];
                                  });
                                  
                                  const preset = {
                                      label: name,
                                      emoji,
                                      tendrilDensity: p.tendrilDensity ?? 3.0,
                                      props: newProps
                                  };
                                  const next = [...customFlamePresets, preset];
                                  setCustomFlamePresets(next);
                                  localStorage.setItem('v_customFlamePresets', JSON.stringify(next));
                              }
                          }}
                          style={{
                              padding: '4px 8px',
                              backgroundColor: '#1a222c',
                              color: '#8a93a2',
                              border: '1px dashed #3c4c5c',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                          }}
                          title="Save current settings as a new preset"
                        >
                          + Save Preset
                        </button>
                      </div>`;

if (regex.test(code)) {
    code = code.replace(regex, newString);
    fs.writeFileSync('src/App.tsx', code, 'utf8');
    console.log("App.tsx patched successfully for custom presets!");
} else {
    console.log("Failed to patch App.tsx - regex didn't match.");
}
