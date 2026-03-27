const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Update defaults
const defaultRegex = /phaseOffset: 0\.0,/;
const defaultInject = `phaseOffset: 0.0,
                  offsetSpeed: 0.0,
                  startTaper: 0.05,
                  endTaper: 0.05,`;
code = code.replace(defaultRegex, defaultInject);

// 2. Add properties UI for tapers
const taperRegex = /<div className="property-row">\s*<label>Smooth Curve<\/label>/;
const taperInject = `<div className="property-row">
          <label>Start Taper</label>
          <input type="range" min="0.0" max="0.5" step="0.01" value={sp.startTaper ?? 0.05} onChange={(e) => upd('startTaper', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>End Taper</label>
          <input type="range" min="0.0" max="0.5" step="0.01" value={sp.endTaper ?? 0.05} onChange={(e) => upd('endTaper', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Smooth Curve</label>`;
code = code.replace(taperRegex, taperInject);


// 3. Add property UI for offsetSpeed
const offsetSpeedRegex = /<div className="property-row">\s*<label>Loop Mode<\/label>/;
const offsetSpeedInject = `<div className="property-row">
          <label>Offset Speed</label>
          <input type="range" min="-5" max="5" step="0.1" value={sp.offsetSpeed ?? 0.0} onChange={(e) => upd('offsetSpeed', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Loop Mode</label>`;
code = code.replace(offsetSpeedRegex, offsetSpeedInject);


fs.writeFileSync('src/App.tsx', code);
console.log("Patched App.tsx with taper and offset speed features.");
