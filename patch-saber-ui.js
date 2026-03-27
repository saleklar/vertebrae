const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<h4>Geometry Controls<\/h4>[\s\S]*?<\/button>\s*<\/div>\s*<\/div>\s*<\/>\s*\);\s*\}\)\(\)\}/m;

if (!regex.test(code)) {
    console.log("Could not find Geometry Controls to remove");
    process.exit(1);
}

const inject = `<div className="properties-section">
        <h4>Target Path</h4>
        <div className="property-row">
          <label>Target</label>
          <span style={{color: '#99b', fontSize: '0.8rem', paddingLeft: 4}}>{sp.targetPathId || 'None'}</span>
        </div>
      </div>
    </>
  );
})()}`;

code = code.replace(regex, inject);
fs.writeFileSync('src/App.tsx', code);
console.log("Removed Geometry controls from Saber UI.");
