const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `<h4>Geometry Controls</h4>
        <div className="property-row">
          <label>Adding/Removing</label>`;

const inject = `<h4>Geometry Controls</h4>
        <div className="property-row">
          <label>Closed Loop</label>
          <input type="checkbox" checked={sp.closed ?? false} onChange={(e) => upd('closed', e.target.checked)} />
        </div>
        <div className="property-row">
          <label>Curve Tension</label>
          <input type="range" min="0" max="1" step="0.01" value={sp.tension ?? 0.5} onChange={(e) => upd('tension', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Adding/Removing</label>`;

code = code.replace(target, inject);
fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx patched for Saber Geometry.');
