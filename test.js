const fs = require('fs'); const txt = fs.readFileSync('src/App.tsx', 'utf8'); const idx = txt.indexOf('obj.type === \'Flame\''); console.log(txt.substring(idx - 100, idx + 1500));
