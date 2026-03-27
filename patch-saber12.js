const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `<div className="properties-section">
        <div className="properties-section">
        <h4>Target Path</h4>
        <div className="property-row">
          <label>Target</label>
          <span style={{color: '#99b', fontSize: '0.8rem', paddingLeft: 4}}>{sp.targetPathId || 'None'}</span>
        </div>
      </div>
    </>`;

const replacement = `<div className="properties-section">
        <h4>Target Path</h4>
        <div className="property-row">
          <label>Target</label>
          <span style={{color: '#99b', fontSize: '0.8rem', paddingLeft: 4}}>{sp.targetPathId || 'None'}</span>
        </div>
      </div>
    </>`;

code = code.replace(target, replacement);
fs.writeFileSync('src/App.tsx', code);
console.log("Fixed JSX!");