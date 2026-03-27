const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<div className="properties-section">\s*<div className="properties-section">\s*<h4>Target Path<\/h4>\s*<div className="property-row">\s*<label>Target<\/label>\s*<span[^>]*>\{sp\.targetPathId \|\| 'None'\}<\/span>\s*<\/div>\s*<\/div>\s*<\/div>/m;

if (!regex.test(code)) {
    console.log("Could not find malformed section");
    process.exit(1);
}

const inject = `<div className="properties-section">
        <h4>Target Path</h4>
        <div className="property-row">
          <label>Target</label>
          <span style={{color: '#99b', fontSize: '0.8rem', paddingLeft: 4}}>{sp.targetPathId || 'None'}</span>
        </div>
      </div>`;

code = code.replace(regex, inject);
fs.writeFileSync('src/App.tsx', code);
console.log("Fixed JSX in App.tsx");
