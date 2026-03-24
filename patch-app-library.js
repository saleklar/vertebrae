const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

// 1. Add import
if (!code.includes("import { StoredImage")) {
    const importAnchor = "import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';";
    const importReplacement = importAnchor + "\nimport { StoredImage, loadImagesFromDB, saveImageToDB, deleteImageFromDB } from './imageStorage';";
    code = code.replace(importAnchor, importReplacement);
}

const stateAnchor = "const [sceneObjects, setSceneObjects] = useState<SceneObject[]>(initialObjects);";
if (code.includes(stateAnchor) && !code.includes("const [spriteLibrary")) {
     code = code.replace(stateAnchor, stateAnchor + "\n  const [spriteLibrary, setSpriteLibrary] = useState<StoredImage[]>([]);\n\n  useEffect(() => {\n    loadImagesFromDB().then((imgs) => setSpriteLibrary(imgs));\n  }, []);");
}

// 2. Modify handleParticleSpriteImageUpload
const handlerAnchor = `const dataUrl = await readFileAsDataUrl(file);\n        handleUpdateEmitterProperty('particleSpriteImageDataUrl', dataUrl);`;
const handlerReplacement = `const dataUrl = await readFileAsDataUrl(file);\n        const newStored: StoredImage = { id: crypto.randomUUID(), name: file.name, dataUrl, timestamp: Date.now() };\n        saveImageToDB(newStored).catch(e => console.warn('Could not save to library', e));\n        setSpriteLibrary(prev => [newStored, ...prev]);\n        handleUpdateEmitterProperty('particleSpriteImageDataUrl', dataUrl);`;

if (code.includes(handlerAnchor)) {
    code = code.replace(handlerAnchor, handlerReplacement);
} else {
    console.log("handlerAnchor missing");
}


// 3. Add to UI
const uiAnchor = `                                  Clear Sprite Asset\n                                </button>\n                              )}\n                            </>\n                          )}`;

const uiReplacement = `                                  Clear Sprite Asset\n                                </button>\n                              )}\n\n                              {/* SPRITE LIBRARY */}\n                              <div style={{ marginTop: '12px', background: '#0a0d18', borderRadius: '6px', padding: '8px', border: '1px solid #3b455c' }}>\n                                <div style={{ fontSize: '0.8rem', color: '#c8d0e0', marginBottom: '8px', fontWeight: 'bold' }}>Sprite Library</div>\n                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: '6px', maxHeight: '160px', overflowY: 'auto', paddingRight: '4px' }}>\n                                  {spriteLibrary.length === 0 && <div style={{ fontSize: '0.7rem', color: '#8a93a2', gridColumn: '1 / -1' }}>No saved sprites.</div>}\n                                  {spriteLibrary.map(img => (\n                                    <div key={img.id} style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: '4px', background: '#1a1f2e', border: ((selectedEmitterProperties.particleSpriteImageDataUrl === img.dataUrl) ? '2px solid #4f6ef7' : '1px solid #3b455c'), cursor: 'pointer', overflow: 'hidden' }} onClick={() => {\n                                      handleUpdateEmitterProperty('particleSpriteImageDataUrl', img.dataUrl);\n                                      handleUpdateEmitterProperty('particleSpriteImageName', img.name);\n                                      handleUpdateEmitterProperty('particleSpriteSequenceDataUrls', []);\n                                      handleUpdateEmitterProperty('particleSpriteSequenceFirstName', '');\n                                    }} title={img.name}>\n                                      <img src={img.dataUrl} style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }} alt={img.name} />\n                                      <button type="button" onClick={(e) => {\n                                        e.stopPropagation();\n                                        deleteImageFromDB(img.id);\n                                        setSpriteLibrary(prev => prev.filter(i => i.id !== img.id));\n                                      }} style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', fontSize: '10px', borderRadius: '3px', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 10 }}>×</button>\n                                    </div>\n                                  ))}\n                                </div>\n                              </div>\n                            </>\n                          )}`;

if (code.includes(uiAnchor) && !code.includes("SPRITE LIBRARY")) {
    code = code.replace(uiAnchor, uiReplacement);
} else {
    console.log("uiAnchor missing");
}


fs.writeFileSync('src/App.tsx', code);
console.log('Done patch');
