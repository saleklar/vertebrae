const fs = require('fs');
let code = fs.readFileSync('e:/VIBE_PROJECTS/vertebrae/src/App.tsx', 'utf8');

const targetStr = \        const dataUrl = await readFileAsDataUrl(file);
        handleUpdateEmitterProperty('particleSpriteImageDataUrl', dataUrl);\;

const replacementStr = \        const dataUrl = await readFileAsDataUrl(file);
        const newStored = { id: crypto.randomUUID(), name: file.name, dataUrl, timestamp: Date.now() };
        saveImageToDB(newStored).catch(e => console.warn('Could not save to library', e));
        setSpriteLibrary(prev => [newStored, ...prev]);
        handleUpdateEmitterProperty('particleSpriteImageDataUrl', dataUrl);\;

if (code.includes(targetStr)) {
    code = code.replace(targetStr, replacementStr);
    fs.writeFileSync('e:/VIBE_PROJECTS/vertebrae/src/App.tsx', code);
    console.log('App.tsx upload handler patched.');
} else {
    console.log('Target string not found.');
}
