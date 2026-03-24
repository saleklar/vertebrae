const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

// 1. imports
code = code.replace("import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';", "import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';\nimport { StoredImage, loadImagesFromDB, saveImageToDB, deleteImageFromDB } from './imageStorage';");

// 2. State
code = code.replace("  const [sceneObjects, setSceneObjects] = useState<SceneObject[]>([]);", "  const [sceneObjects, setSceneObjects] = useState<SceneObject[]>([]);\n  const [spriteLibrary, setSpriteLibrary] = useState<StoredImage[]>([]);\n\n  useEffect(() => {\n    loadImagesFromDB().then((imgs) => setSpriteLibrary(imgs));\n  }, []);");

// 3. Upload handler
code = code.replace(`        const dataUrl = await readFileAsDataUrl(file);
        handleUpdateEmitterProperty('particleSpriteImageDataUrl', dataUrl);`, `        const dataUrl = await readFileAsDataUrl(file);
        const newStored: StoredImage = { id: crypto.randomUUID(), name: file.name, dataUrl, timestamp: Date.now() };
        saveImageToDB(newStored).catch(e => console.warn('Could not save to library', e));
        setSpriteLibrary(prev => [newStored, ...prev]);
        handleUpdateEmitterProperty('particleSpriteImageDataUrl', dataUrl);`);

// 4. UI block - look strictly for precisely this snippet in App.tsx
// find the place and replace just this string
let target = `                                  Clear Sprite Asset
                                </button>
                              )}
                            </>
                          )}

                          {selectedEmitterProperties.particleType === '3d-model' && (`;

let replacement = `                                  Clear Sprite Asset
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
                                      <img src={img.dataUrl} style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }} alt={img.name} />
                                      <button type="button" onClick={(e) => {
                                        e.stopPropagation();
                                        deleteImageFromDB(img.id);
                                        setSpriteLibrary(prev => prev.filter(i => i.id !== img.id));
                                      }} style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', fontSize: '10px', borderRadius: '3px', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}

                          {selectedEmitterProperties.particleType === '3d-model' && (`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('src/App.tsx', code);
    console.log("Successfully inserted Sprite Library UI");
} else {
    console.log("Target string for UI NOT found! Outputting window for debug");
}
