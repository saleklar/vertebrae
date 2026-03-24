const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const target = `Clear Sprite Asset
                                </button>
                              )}
                            </>
                          )}`;

const replacement = `Clear Sprite Asset
                                </button>
                              )}

                              {/* SPRITE LIBRARY */}
                              <div style={{ marginTop: '12px', background: '#0a0d18', borderRadius: '6px', padding: '8px', border: '1px solid #3b455c' }}>
                                <div style={{ fontSize: '0.8rem', color: '#c8d0e0', marginBottom: '8px', fontWeight: 'bold' }}>Sprite Library</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: '6px', maxHeight: '160px', overflowY: 'auto', paddingRight: '4px' }}>
                                  {spriteLibrary.length === 0 && <div style={{ fontSize: '0.7rem', color: '#8a93a2', gridColumn: '1 / -1' }}>No saved sprites. Upload a PNG to add it to your library.</div>}
                                  {spriteLibrary.map(img => (
                                    <div key={img.id} style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: '4px', background: '#1a1f2e', border: ((selectedEmitterProperties.particleSpriteImageDataUrl === img.dataUrl) ? '2px solid #4f6ef7' : '1px solid #3b455c'), cursor: 'pointer', overflow: 'hidden' }} onClick={() => {
                                      handleUpdateEmitterProperty('particleSpriteImageDataUrl', img.dataUrl);
                                      handleUpdateEmitterProperty('particleSpriteImageName', img.name);
                                      handleUpdateEmitterProperty('particleSpriteSequenceDataUrls', []);
                                      handleUpdateEmitterProperty('particleSpriteSequenceFirstName', '');
                                    }} title={img.name}>
                                      <img src={img.dataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }} alt={img.name} />
                                      <button type="button" onClick={(e) => {
                                        e.stopPropagation();
                                        deleteImageFromDB(img.id);
                                        setSpriteLibrary(prev => prev.filter(i => i.id !== img.id));
                                      }} style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', fontSize: '10px', borderRadius: '3px', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 10 }}>×</button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}`;

const linesObjTarget = target.split('\\n');
console.log(code.includes(target) ? "YES" : "NO");
code = code.replace(target, replacement);

fs.writeFileSync('src/App.tsx', code);
console.log("Done");