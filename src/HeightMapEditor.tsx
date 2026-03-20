import React, { useRef, useState, useEffect } from 'react';

type HeightMapEditorProps = {
  width: number;
  height: number;
  onHeightMapChange: (imageData: ImageData) => void;
  onGenerateMaps?: (heightDataUrl: string, normalDataUrl: string, bumpDataUrl: string) => void;
};

export function HeightMapEditor({ width, height, onHeightMapChange, onGenerateMaps }: HeightMapEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [brushStrength, setBrushStrength] = useState(0.5);
  const [brushMode, setBrushMode] = useState<'raise' | 'lower' | 'smooth'>('raise');
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize with gray (middle height)
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, width, height);
  }, [width, height]);

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const paint = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const radius = brushSize;
    const strength = brushStrength;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > radius) continue;

        const px = Math.floor(x + dx);
        const py = Math.floor(y + dy);

        if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) continue;

        const index = (py * canvas.width + px) * 4;
        const falloff = 1 - (distance / radius);
        const effectiveStrength = strength * falloff;

        let currentValue = data[index]; // R channel (all RGB are same for grayscale)

        switch (brushMode) {
          case 'raise':
            currentValue = Math.min(255, currentValue + effectiveStrength * 255 * 0.1);
            break;
          case 'lower':
            currentValue = Math.max(0, currentValue - effectiveStrength * 255 * 0.1);
            break;
          case 'smooth':
            // Sample surrounding pixels
            let sum = 0;
            let count = 0;
            for (let sy = -2; sy <= 2; sy++) {
              for (let sx = -2; sx <= 2; sx++) {
                const spx = px + sx;
                const spy = py + sy;
                if (spx >= 0 && spx < canvas.width && spy >= 0 && spy < canvas.height) {
                  const sindex = (spy * canvas.width + spx) * 4;
                  sum += data[sindex];
                  count++;
                }
              }
            }
            const avg = sum / count;
            currentValue = currentValue * (1 - effectiveStrength) + avg * effectiveStrength;
            break;
        }

        data[index] = currentValue;     // R
        data[index + 1] = currentValue; // G
        data[index + 2] = currentValue; // B
        data[index + 3] = 255;          // A
      }
    }

    ctx.putImageData(imageData, 0, 0);
    onHeightMapChange(imageData);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const coords = getCanvasCoordinates(e);
    if (coords) {
      paint(coords.x, coords.y);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const coords = getCanvasCoordinates(e);
    if (coords) {
      paint(coords.x, coords.y);
    }
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    onHeightMapChange(imageData);
  };

  const handleGenerateMaps = () => {
    const canvas = canvasRef.current;
    if (!canvas || !onGenerateMaps) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const heightData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Generate normal map
    const normalMap = generateNormalMap(heightData);
    const normalCanvas = document.createElement('canvas');
    normalCanvas.width = canvas.width;
    normalCanvas.height = canvas.height;
    const normalCtx = normalCanvas.getContext('2d');
    if (normalCtx) {
      normalCtx.putImageData(normalMap, 0, 0);
    }

    // Height map as data URL
    const heightDataUrl = canvas.toDataURL('image/png');
    const normalDataUrl = normalCanvas.toDataURL('image/png');
    const bumpDataUrl = heightDataUrl; // Bump map is same as height map

    onGenerateMaps(heightDataUrl, normalDataUrl, bumpDataUrl);
  };

  const generateNormalMap = (heightData: ImageData): ImageData => {
    const width = heightData.width;
    const height = heightData.height;
    const data = heightData.data;
    const normalData = new ImageData(width, height);
    const strength = 3; // Normal map strength

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;

        // Sample neighboring pixels
        const getHeight = (px: number, py: number) => {
          px = Math.max(0, Math.min(width - 1, px));
          py = Math.max(0, Math.min(height - 1, py));
          const idx = (py * width + px) * 4;
          return data[idx] / 255; // Normalize to 0-1
        };

        const left = getHeight(x - 1, y);
        const right = getHeight(x + 1, y);
        const up = getHeight(x, y - 1);
        const down = getHeight(x, y + 1);

        // Calculate gradients
        const dx = (right - left) * strength;
        const dy = (down - up) * strength;
        const dz = 1;

        // Normalize
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const nx = dx / length;
        const ny = dy / length;
        const nz = dz / length;

        // Convert to RGB (normal map format)
        normalData.data[index] = ((nx + 1) * 0.5 * 255) | 0;     // R
        normalData.data[index + 1] = ((ny + 1) * 0.5 * 255) | 0; // G
        normalData.data[index + 2] = ((nz + 1) * 0.5 * 255) | 0; // B
        normalData.data[index + 3] = 255;                         // A
      }
    }

    return normalData;
  };

  const handleLoadImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Draw image and convert to grayscale
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Convert to grayscale
        for (let i = 0; i < data.length; i += 4) {
          const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }

        ctx.putImageData(imageData, 0, 0);
        onHeightMapChange(imageData);
      };
      img.src = URL.createObjectURL(file);
    };
    input.click();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Canvas */}
      <div style={{ position: 'relative', border: '1px solid #444' }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            width: '100%',
            height: 'auto',
            cursor: 'crosshair',
            imageRendering: showPreview ? 'auto' : 'pixelated',
          }}
        />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label style={{ fontSize: '12px' }}>Brush Mode</label>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['raise', 'lower', 'smooth'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setBrushMode(mode)}
              style={{
                flex: 1,
                padding: '6px',
                backgroundColor: brushMode === mode ? '#0066cc' : '#333',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontSize: '11px',
                textTransform: 'capitalize',
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                              <label style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}>
                                Brush Size
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                  type="number"
                                  value={brushSize}
                                  onChange={(e) => setBrushSize(Number(e.target.value))}
                                  step={"1"}
                                  style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                                />
                              </div>
                            </div>
                            <input
          type="range"
          min="5"
          max="50"
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          style={{ width: '100%' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                              <label style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}>
                                Brush Strength
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                  type="number"
                                  value={brushStrength.toFixed(2)}
                                  onChange={(e) => setBrushStrength(Number(e.target.value))}
                                  step={0.1}
                                  style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                                />
                              </div>
                            </div>
                            <input
          type="range"
          min="0.1"
          max="1"
          step="0.1"
          value={brushStrength}
          onChange={(e) => setBrushStrength(Number(e.target.value))}
          style={{ width: '100%' }}
        />

        <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
          <button
            onClick={handleLoadImage}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: '#333',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            Load Image
          </button>
          <button
            onClick={handleClear}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: '#500',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            Clear
          </button>
        </div>

        <button
          onClick={handleGenerateMaps}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: '#0066cc',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            marginTop: '8px',
          }}
        >
          Generate Normal & Bump Maps
        </button>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginTop: '4px' }}>
          <input
            type="checkbox"
            checked={showPreview}
            onChange={(e) => setShowPreview(e.target.checked)}
          />
          Smooth Preview
        </label>
      </div>
    </div>
  );
}
