import React, { useState, useRef, useEffect } from 'react';
import { CoinImageAnalyzer, DetectedRegion, RegionElevationSettings } from './ImageAnalyzer';
import { generateNormalMapFromHeight, imageDataToDataURL } from './TextureGenerator';

type UvProjection = {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
};

type UvSelection = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type UvDragTarget = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'left' | 'right' | 'top' | 'bottom' | null;

type RegionSelectorProps = {
  onMapsGenerated: (
    heightMap: string,
    normalMap: string,
    bumpMap: string,
    baseTextureDataUrl?: string,
    baseTextureName?: string,
    capProjection?: UvProjection,
    sideProjection?: UvProjection
  ) => void;
  onClose: () => void;
};

export function RegionSelector({ onMapsGenerated, onClose }: RegionSelectorProps) {
  const [analyzer] = useState(() => new CoinImageAnalyzer());
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [regions, setRegions] = useState<DetectedRegion[]>([]);
  const [elevationSettings, setElevationSettings] = useState<RegionElevationSettings[]>([]);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState(30);
  const [minRegionSize, setMinRegionSize] = useState(100);
  const [lineStrength, setLineStrength] = useState(65);
  const [sourceTextureDataUrl, setSourceTextureDataUrl] = useState<string | undefined>(undefined);
  const [sourceTextureName, setSourceTextureName] = useState<string | undefined>(undefined);
  const [uvSelection, setUvSelection] = useState<UvSelection | null>(null);
  const [uvDragTarget, setUvDragTarget] = useState<UvDragTarget>(null);
  const [applySelectionToSideUv, setApplySelectionToSideUv] = useState(true);
  const [lockCircularCapFit, setLockCircularCapFit] = useState(true);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const MIN_UV_SELECTION_SIZE = 8;

  const selectionToProjection = (selection: UvSelection, width: number, height: number): UvProjection => {
    const selWidth = Math.max(1, selection.right - selection.left);
    const selHeight = Math.max(1, selection.bottom - selection.top);
    const selCenterX = selection.left + selWidth * 0.5;
    const selCenterY = selection.top + selHeight * 0.5;

    if (lockCircularCapFit) {
      // For circular cap, use maximum dimension to ensure equal X/Y scaling (prevents distortion)
      const side = Math.max(1, Math.max(selWidth, selHeight));
      const scale = Math.max(0.01, side / Math.max(width, height));
      
      // In Three.js, offset centers the texture on the model
      // offset = (textureCenter / imageSize) - (scale / 2)
      const offsetX = (selCenterX / width) - (scale * 0.5);
      const offsetY = (selCenterY / height) - (scale * 0.5);

      return {
        scaleX: scale,
        scaleY: scale,
        offsetX: offsetX,
        offsetY: offsetY,
        rotation: 0,
      };
    }

    const centerX = selection.left + selWidth * 0.5;
    const centerY = selection.top + selHeight * 0.5;
    const scaleX = selWidth / width;
    const scaleY = selHeight / height;

    return {
      scaleX: Math.max(0.01, Math.min(1, scaleX)),
      scaleY: Math.max(0.01, Math.min(1, scaleY)),
      offsetX: (centerX / width) - (scaleX * 0.5),
      offsetY: (centerY / height) - (scaleY * 0.5),
      rotation: 0,
    };
  };

  const drawUvSelectionOverlay = (ctx: CanvasRenderingContext2D) => {
    const canvas = canvasRef.current;
    if (!canvas || !uvSelection) return;

    const { left, top, right, bottom } = uvSelection;
    const width = right - left;
    const height = bottom - top;
    const capSide = Math.min(width, height);
    const capLeft = left + (width - capSide) * 0.5;
    const capTop = top + (height - capSide) * 0.5;
    const centerX = capLeft + capSide * 0.5;
    const centerY = capTop + capSide * 0.5;
    const radius = capSide * 0.5;

    ctx.save();

    if (lockCircularCapFit && radius > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.moveTo(centerX + radius, centerY);
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    }

    ctx.strokeStyle = '#00d8ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(left, top, width, height);
    ctx.setLineDash([]);

    if (lockCircularCapFit && radius > 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX, centerY, Math.max(0, radius - 8), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 204, 0, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const drawHandle = (x: number, y: number) => {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#00d8ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    drawHandle(left, top);
    drawHandle(right, top);
    drawHandle(left, bottom);
    drawHandle(right, bottom);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(6, 6, 300, 58);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px sans-serif';
    ctx.fillText('UV Fit: Drag corners or edges', 12, 24);
    ctx.fillText(`Selection: ${Math.round(width)} x ${Math.round(height)} px`, 12, 40);
    ctx.fillText(lockCircularCapFit ? 'Cap Edge: circular (actual coin edge)' : 'Cap Edge: rectangular fit', 12, 54);
    ctx.restore();
  };

  const imagePointFromMouseEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    return {
      x: Math.max(0, Math.min(canvas.width, x)),
      y: Math.max(0, Math.min(canvas.height, y)),
    };
  };

  const detectUvDragTarget = (x: number, y: number, selection: UvSelection): UvDragTarget => {
    const { left, top, right, bottom } = selection;
    const handleRadius = 12;
    const edgeThreshold = 8;

    const near = (px: number, py: number) => Math.hypot(x - px, y - py) <= handleRadius;
    if (near(left, top)) return 'topLeft';
    if (near(right, top)) return 'topRight';
    if (near(left, bottom)) return 'bottomLeft';
    if (near(right, bottom)) return 'bottomRight';

    const withinY = y >= top && y <= bottom;
    const withinX = x >= left && x <= right;
    if (withinY && Math.abs(x - left) <= edgeThreshold) return 'left';
    if (withinY && Math.abs(x - right) <= edgeThreshold) return 'right';
    if (withinX && Math.abs(y - top) <= edgeThreshold) return 'top';
    if (withinX && Math.abs(y - bottom) <= edgeThreshold) return 'bottom';

    return null;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!uvSelection) return;
    const point = imagePointFromMouseEvent(e);
    if (!point) return;
    setUvDragTarget(detectUvDragTarget(point.x, point.y, uvSelection));
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!uvDragTarget || !uvSelection || !canvasRef.current) return;

    const point = imagePointFromMouseEvent(e);
    if (!point) return;

    const maxX = canvasRef.current.width;
    const maxY = canvasRef.current.height;

    setUvSelection(prev => {
      if (!prev) return prev;
      let { left, top, right, bottom } = prev;

      switch (uvDragTarget) {
        case 'topLeft':
          left = Math.max(0, Math.min(point.x, right - MIN_UV_SELECTION_SIZE));
          top = Math.max(0, Math.min(point.y, bottom - MIN_UV_SELECTION_SIZE));
          break;
        case 'topRight':
          right = Math.min(maxX, Math.max(point.x, left + MIN_UV_SELECTION_SIZE));
          top = Math.max(0, Math.min(point.y, bottom - MIN_UV_SELECTION_SIZE));
          break;
        case 'bottomLeft':
          left = Math.max(0, Math.min(point.x, right - MIN_UV_SELECTION_SIZE));
          bottom = Math.min(maxY, Math.max(point.y, top + MIN_UV_SELECTION_SIZE));
          break;
        case 'bottomRight':
          right = Math.min(maxX, Math.max(point.x, left + MIN_UV_SELECTION_SIZE));
          bottom = Math.min(maxY, Math.max(point.y, top + MIN_UV_SELECTION_SIZE));
          break;
        case 'left':
          left = Math.max(0, Math.min(point.x, right - MIN_UV_SELECTION_SIZE));
          break;
        case 'right':
          right = Math.min(maxX, Math.max(point.x, left + MIN_UV_SELECTION_SIZE));
          break;
        case 'top':
          top = Math.max(0, Math.min(point.y, bottom - MIN_UV_SELECTION_SIZE));
          break;
        case 'bottom':
          bottom = Math.min(maxY, Math.max(point.y, top + MIN_UV_SELECTION_SIZE));
          break;
      }

      return { left, top, right, bottom };
    });
  };

  const handleCanvasMouseUp = () => {
    setUvDragTarget(null);
  };

  const handleLoadImage = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSourceTextureName(file.name);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      setSourceTextureDataUrl(dataUrl);
      await analyzer.loadImage(dataUrl);
      setImageLoaded(true);
      
      // Draw original image on canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          setUvSelection({
            left: 0,
            top: 0,
            right: img.width,
            bottom: img.height,
          });
          ctx?.drawImage(img, 0, 0);
        };
        img.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  };

  // Auto-analyze regions when sensitivity or minRegionSize changes (with debounce)
  useEffect(() => {
    if (!imageLoaded) return;

    // Clear previous debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setIsAnalyzing(true);

    // Debounce region detection to avoid too many recalculations
    debounceTimerRef.current = setTimeout(() => {
      const detectedRegions = analyzer.detectRegions(
        sensitivity,
        minRegionSize,
        lineStrength / 100
      );
      setRegions(detectedRegions);
      
      // Initialize elevation settings
      const initialSettings: RegionElevationSettings[] = detectedRegions.map(region => ({
        regionId: region.id,
        elevation: region.isBackground ? 0.5 : 0.7,
        smoothing: 3,
      }));
      setElevationSettings(initialSettings);
      
      // Show region preview
      updatePreview(detectedRegions, null);
      
      setIsAnalyzing(false);
    }, 300); // 300ms debounce

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [sensitivity, minRegionSize, lineStrength, imageLoaded, analyzer]);

  const updatePreview = (regionsToShow: DetectedRegion[], highlightId: string | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const preview = analyzer.getRegionPreview(regionsToShow, highlightId || undefined);
    ctx.putImageData(preview, 0, 0);
    drawUvSelectionOverlay(ctx);
  };

  useEffect(() => {
    if (imageLoaded) {
      updatePreview(regions, hoveredRegionId);
    }
  }, [uvSelection]);

  useEffect(() => {
    const onWindowMouseUp = () => setUvDragTarget(null);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, []);

  const handleElevationChange = (regionId: string, elevation: number) => {
    setElevationSettings(prev => {
      const updated = prev.map(s => 
        s.regionId === regionId ? { ...s, elevation } : s
      );
      return updated;
    });
  };

  const handleSmoothingChange = (regionId: string, smoothing: number) => {
    setElevationSettings(prev => {
      const updated = prev.map(s => 
        s.regionId === regionId ? { ...s, smoothing } : s
      );
      return updated;
    });
  };

  const handleGenerateMaps = () => {
    if (regions.length === 0) return;

    // Generate height map from region selections
    const heightMap = analyzer.generateHeightMap(regions, elevationSettings);
    
    // Generate normal map from height map
    const normalMap = generateNormalMapFromHeight(heightMap, 10);
    
    // Convert to data URLs
    const heightDataUrl = imageDataToDataURL(heightMap);
    const normalDataUrl = imageDataToDataURL(normalMap);
    const bumpDataUrl = heightDataUrl;
    const canvas = canvasRef.current;

    const capProjection = uvSelection && canvas
      ? selectionToProjection(uvSelection, canvas.width, canvas.height)
      : undefined;
    const sideProjection = applySelectionToSideUv ? capProjection : undefined;
    
    onMapsGenerated(
      heightDataUrl,
      normalDataUrl,
      bumpDataUrl,
      sourceTextureDataUrl,
      sourceTextureName,
      capProjection,
      sideProjection
    );
  };

  const handleRegionHover = (regionId: string | null) => {
    setHoveredRegionId(regionId);
    if (regions.length > 0) {
      updatePreview(regions, regionId);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: '#1e1e1e',
        borderRadius: '8px',
        padding: '20px',
        maxWidth: '900px',
        maxHeight: '90vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        color: '#fff',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>🔍 Intelligent Region Analysis</h2>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: '#500',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
          {/* Left: Canvas Preview */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{
              border: '2px solid #333',
              borderRadius: '4px',
              overflow: 'auto',
              backgroundColor: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '300px',
              maxHeight: '520px',
            }}>
              <canvas
                ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                style={{
                  display: 'block',
                  margin: '0 auto',
                  width: 'auto',
                  height: 'auto',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            </div>

            {!imageLoaded ? (
              <button
                onClick={handleLoadImage}
                style={{
                  padding: '12px',
                  backgroundColor: '#0066cc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                📁 Load Coin Image
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                              <label style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}>
                                Sensitivity
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                  type="number"
                                  value={sensitivity}
                                  onChange={(e) => setSensitivity(Number(e.target.value))}
                                  step={"1"}
                                  style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                                />
                              </div>
                            </div>
                            <input
                  type="range"
                  min="10"
                  max="100"
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '10px', opacity: 0.6 }}>
                  Lower = stricter separator lines, Higher = more merged surfaces
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                              <label style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}>
                                Line Strength
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                  type="number"
                                  value={lineStrength}
                                  onChange={(e) => setLineStrength(Number(e.target.value))}
                                  step={"1"}
                                  style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                                /> <span style={{ fontSize: '11px', color: '#aaaaaa' }}>%</span>
                              </div>
                            </div>
                            <input
                  type="range"
                  min="0"
                  max="100"
                  value={lineStrength}
                  onChange={(e) => setLineStrength(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '10px', opacity: 0.6 }}>
                  Higher = treat dark separators as hard boundaries
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                              <label style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}>
                                Min Region Size
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                  type="number"
                                  value={minRegionSize}
                                  onChange={(e) => setMinRegionSize(Number(e.target.value))}
                                  step={50}
                                  style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                                /> <span style={{ fontSize: '11px', color: '#aaaaaa' }}>pixels</span>
                              </div>
                            </div>
                            <input
                  type="range"
                  min="50"
                  max="1000"
                  step="50"
                  value={minRegionSize}
                  onChange={(e) => setMinRegionSize(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '10px', opacity: 0.6 }}>
                  Ignore tiny fragments; keep face/star/border regions clean
                </div>

                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#252525', borderRadius: '4px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px' }}>UV Fit Editor</div>
                  <div style={{ fontSize: '10px', opacity: 0.7, marginBottom: '6px' }}>
                    Drag vertices or full edges on preview to fit projection to image content.
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', marginBottom: '4px' }}>
                    <input
                      type="checkbox"
                      checked={lockCircularCapFit}
                      onChange={(e) => setLockCircularCapFit(e.target.checked)}
                    />
                    Show/use actual circular cap edge
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                    <input
                      type="checkbox"
                      checked={applySelectionToSideUv}
                      onChange={(e) => setApplySelectionToSideUv(e.target.checked)}
                    />
                    Apply same fit to side UV
                  </label>
                  <button
                    onClick={() => {
                      const canvas = canvasRef.current;
                      if (!canvas) return;
                      setUvSelection({ left: 0, top: 0, right: canvas.width, bottom: canvas.height });
                    }}
                    style={{
                      width: '100%',
                      padding: '6px',
                      marginTop: '6px',
                      backgroundColor: '#333',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                    }}
                  >
                    Reset UV Selection
                  </button>
                </div>

                {regions.length > 0 && (
                  <>
                    <div style={{
                      marginTop: '8px',
                      padding: '8px',
                      backgroundColor: '#2a7f2a',
                      borderRadius: '4px',
                      fontSize: '12px',
                      textAlign: 'center',
                    }}>
                      ✓ {regions.length} regions detected
                    </div>
                    <button
                      onClick={handleGenerateMaps}
                      style={{
                        padding: '12px',
                        backgroundColor: '#0066cc',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: 600,
                      }}
                    >
                      ✨ Generate Height & Normal Maps
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right: Region Controls */}
          {regions.length > 0 && (
            <div style={{
              width: '300px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              overflowY: 'auto',
              maxHeight: '600px',
              paddingRight: '8px',
            }}>
              <div style={{
                padding: '12px',
                backgroundColor: '#252525',
                borderRadius: '4px',
                fontSize: '12px',
              }}>
                <strong>Found {regions.length} regions</strong>
                <div style={{ marginTop: '4px', opacity: 0.7 }}>
                  Hover to highlight, adjust elevation for each region
                </div>
              </div>

              {regions.map((region, index) => {
                const setting = elevationSettings.find(s => s.regionId === region.id);
                if (!setting) return null;

                const elevationPercent = ((setting.elevation - 0.5) * 200).toFixed(0);
                const elevationLabel = 
                  setting.elevation > 0.5 ? `+${elevationPercent}% Raised` :
                  setting.elevation < 0.5 ? `${elevationPercent}% Lowered` :
                  'Flat';

                return (
                  <div
                    key={region.id}
                    onMouseEnter={() => handleRegionHover(region.id)}
                    onMouseLeave={() => handleRegionHover(null)}
                    style={{
                      padding: '12px',
                      backgroundColor: hoveredRegionId === region.id ? '#333' : '#252525',
                      borderRadius: '4px',
                      border: hoveredRegionId === region.id ? '2px solid #0066cc' : '2px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}>
                      <div style={{ fontSize: '12px', fontWeight: 600 }}>
                        {index + 1}. {region.name}
                      </div>
                      <div style={{ fontSize: '11px', opacity: 0.7 }}>
                        {region.area} px
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                              <label style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}>
                                Elevation
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                  type="number"
                                  value={elevationLabel}
                                  onChange={(e) => handleElevationChange(region.id, Number(e.target.value))}
                                  step={0.05}
                                  style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                                />
                              </div>
                            </div>
                            <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={setting.elevation}
                      onChange={(e) => handleElevationChange(region.id, Number(e.target.value))}
                      style={{ width: '100%', marginBottom: '8px' }}
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                              <label style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}>
                                Edge Smoothing
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                  type="number"
                                  value={setting.smoothing.toFixed(1)}
                                  onChange={(e) => handleSmoothingChange(region.id, Number(e.target.value))}
                                  step={0.5}
                                  style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                                />
                              </div>
                            </div>
                            <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.5"
                      value={setting.smoothing}
                      onChange={(e) => handleSmoothingChange(region.id, Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelected}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
