const fs = require('fs');
const filepath = 'src/Scene3D.tsx';
let content = fs.readFileSync(filepath, 'utf8');
const newText = fs.readFileSync('new_physics.txt', 'utf8');

const startTag = 'if (usePhysicsF && physicsForceRef.current.length > 0)';
const startIdx = content.indexOf(startTag);

if (startIdx !== -1) {
    let braceCount = 0;
    let started = false;
    let endIdx = -1;
    for (let i = startIdx; i < content.length; i++) {
        if (content[i] === '{') {
            braceCount++;
            started = true;
        } else if (content[i] === '}') {
            braceCount--;
        }
        if (started && braceCount === 0) {
            endIdx = i;
            break;
        }
    }

    if (endIdx !== -1) {
        content = content.substring(0, startIdx) + newText + content.substring(endIdx + 1);
        fs.writeFileSync(filepath, content, 'utf8');
        console.log("Updated!");
    } else {
        console.log("Could not find matching end brace for block.");
    }
} else {
    console.log("Tags not found");
}
