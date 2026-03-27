const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf8');

c = c.replace(/<option value=\"sharp\">Hard Edge Circle<\/option>(\s*)<\/select>/g, '<option value=\"sharp\">Hard Edge Circle</option>  {spriteLibrary && spriteLibrary.map(s => <option key={s.id} value={s.dataUrl}>Custom: {s.name}</option>)}\n</select>');

fs.writeFileSync('src/App.tsx', c);
console.log('App regex patched');
