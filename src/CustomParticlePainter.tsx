import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { defaultLayer, renderFrame, ShapeType, ParticleLayer } from './ParticleCreator';
import { parseAbr, AbrBrush } from './abrParser';
import { saveBrushesToDB, loadBrushesFromDB } from './brushStorage';

// ─── Types ───────────────────────────────────────────────────────────────────

type BrushTool = 'pencil' | 'brush' | 'airbrush' | 'eraser' | 'smear';

type PainterPreset = {
  id: string;
  name: string;
  thumbnail: string; // 64×64 data URL
  fullDataUrl: string; // 512×512 PNG data URL
};

type EmitterEntry = { id: string; name: string };

export type CustomParticlePainterProps = {
  visible: boolean;
  emitters: EmitterEntry[];
  onInjectToEmitter: (emitterId: string, dataUrl: string) => void;
  onClose: () => void;
  /** Render inline inside a parent panel (no modal backdrop/header) */
  embedded?: boolean;
  /** Called with a function that returns the current canvas dataUrl */
  onReady?: (getDataUrl: () => string) => void;
};

const CANVAS_SIZE = 512;
const PRESET_KEY = 'vertebrae_painter_presets';
const MAX_UNDO = 20;

// ─── Stamp shape catalogue ────────────────────────────────────────────────────

type StampEntry = { type: ShapeType; label: string; icon: string };
const STAMPS: StampEntry[] = [
  { type: 'soft-dot',          label: 'Soft Dot',  icon: '✦' },
  { type: 'glint',             label: 'Glint',     icon: '✤' },
  { type: 'bubble',            label: 'Bubble',    icon: '◎' },
  { type: 'nebula',            label: 'Nebula',    icon: '❋' },
  { type: 'anamorphic-streak', label: 'Streak',    icon: '—' },
  { type: 'circle',            label: 'Circle',    icon: '⬤' },
  { type: 'ring',              label: 'Ring',      icon: '◯' },
  { type: 'star',              label: 'Star',      icon: '★' },
  { type: 'polygon',           label: 'Polygon',   icon: '⬡' },
  { type: 'diamond',           label: 'Diamond',   icon: '◆' },
  { type: 'spark',             label: 'Spark',     icon: '—' },
  { type: 'cross',             label: 'Cross',     icon: '✛' },
  { type: 'smoke',             label: 'Smoke',     icon: '☁' },
  { type: 'metallic-sphere',   label: 'Metal',     icon: '●' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadPresets(): PainterPreset[] {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]'); }
  catch { return []; }
}
function savePresets(p: PainterPreset[]) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(p));
}

/** Render a stamp shape to a new canvas at the given size */
function renderStampToCanvas(type: ShapeType, size: number, color: string): HTMLCanvasElement {
  const layer: ParticleLayer = {
    ...defaultLayer(type),
    color1: color,
    color2: color,
    size: 70,
    opacity: 1,
  };
  const c = document.createElement('canvas');
  c.width = c.height = size;
  renderFrame(c, [layer], 0, 'none');
  return c;
}

/** Place a stamp dab centered at (cx, cy) on dst context */
function stampDab(
  dst: CanvasRenderingContext2D,
  tool: BrushTool,
  type: ShapeType,
  cx: number,
  cy: number,
  size: number,
  color: string,
  opacity: number,
  angle: number = 0,
): void {
  const stamp = renderStampToCanvas(type, size, color);
  dst.save();
  dst.globalAlpha = opacity / 100;
  dst.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  dst.translate(cx, cy);
  if (angle) dst.rotate(angle * Math.PI / 180);
  dst.drawImage(stamp, -size / 2, -size / 2, size, size);
  dst.restore();
}

/** Draw a single brush dab at (cx, cy) */
function brushDab(
  ctx: CanvasRenderingContext2D,
  tool: BrushTool,
  cx: number,
  cy: number,
  size: number,
  color: string,
  opacity: number,
  hardness: number,
): void {
  const r = Math.max(1, size / 2);
  ctx.save();

  if (tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = opacity / 100;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const h = hardness / 100;
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(h * 0.95, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.globalCompositeOperation = 'source-over';

  // Parse color to rgb
  const hex = color.replace('#', '');
  const s = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  const n = parseInt(s, 16);
  const cr = (n >> 16) & 255, cg = (n >> 8) & 255, cb = n & 255;

  if (tool === 'pencil') {
    ctx.globalAlpha = opacity / 100;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (tool === 'brush') {
    const h = Math.min(0.98, hardness / 100);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0,        `rgba(${cr},${cg},${cb},${opacity / 100})`);
    grad.addColorStop(h * 0.9,  `rgba(${cr},${cg},${cb},${opacity / 100})`);
    grad.addColorStop(1,        `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (tool === 'airbrush') {
    // Very wide, very soft — multiple passes build up
    const wideR = r * 2.5;
    const baseAlpha = (opacity / 100) * 0.06;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, wideR);
    grad.addColorStop(0,    `rgba(${cr},${cg},${cb},${baseAlpha})`);
    grad.addColorStop(0.4,  `rgba(${cr},${cg},${cb},${baseAlpha * 0.7})`);
    grad.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, wideR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ─── Component ───────────────────────────────────────────────────────────────

export const CustomParticlePainter: React.FC<CustomParticlePainterProps> = ({
  visible,
  emitters,
  onInjectToEmitter,
  onClose,
  embedded,
  onReady,
}) => {
  if (!visible && !embedded) return null;
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const isPointerDown  = useRef(false);
  const lastPos        = useRef<{ x: number; y: number } | null>(null);
  const smoothBuf      = useRef<{ x: number; y: number }[]>([]);
  const undoStack      = useRef<ImageData[]>([]);
  const pendingStamp   = useRef<ShapeType | null>(null);

  const [tool,          setTool      ] = useState<BrushTool>('brush');
  const [color,         setColor     ] = useState('#ffffff');
  const [brushSize,     setBrushSize ] = useState(32);
  const [opacity,       setOpacity   ] = useState(85);
  const [hardness,      setHardness  ] = useState(55);
  const [smooth,        setSmooth    ] = useState(true);
  const [activeStamp,   setActiveStamp] = useState<ShapeType | null>(null);
  const [sizeJitter,    setSizeJitter] = useState(0);
  const [angleJitter,   setAngleJitter] = useState(0);
  const [opacityJitter, setOpacityJitter] = useState(0);
  const [scatter,       setScatter   ] = useState(0);
  const [density,       setDensity   ] = useState(15);
  const [presets,       setPresets   ] = useState<PainterPreset[]>(loadPresets);
  const [presetName,    setPresetName] = useState('');
  const [showInject,    setShowInject] = useState(false);
  const [stampTab,       setStampTab  ] = useState<'shapes' | 'brushes'>('shapes');
  const [abrBrushes,     setAbrBrushes] = useState<AbrBrush[]>([]);
  const [activeBrush,    setActiveBrush] = useState<AbrBrush | null>(null);
  const customBrushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);    const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBrushesFromDB().then((brushes) => {
      if (brushes && brushes.length > 0) {
        setAbrBrushes(brushes);
      }
    });
  }, []);

  // Expose canvas dataUrl getter to parent (used in embedded mode)
  useEffect(() => {
    onReady?.(() => canvasRef.current?.toDataURL('image/png') ?? '');
  }, [onReady]);

  // ── preview thumbnails ──────────────────────────────────────────────────────
    const previewSizes = useMemo(() => [64, 48, 24, 12], []);
    const previewCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

    // Rebuild preview on canvas changes without React state re-renders
    const tickPreview = useCallback(() => {
      const src = canvasRef.current;
      if (!src) return;
      previewSizes.forEach((sz: number, i: number) => {
        const dst = previewCanvasRefs.current[i];
        if (!dst) return;
        const ctx = dst.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, sz, sz);
        ctx.drawImage(src, 0, 0, sz, sz);
      });
    }, [previewSizes]);

  // ── undo ─────────────────────────────────────────────────────────────────────
  const pushUndo = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), snap];
  }, []);

  const handleUndo = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || undoStack.current.length === 0) return;
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    ctx.putImageData(prev, 0, 0);
    tickPreview();
  }, [tickPreview]);

  const handleClear = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    pushUndo();
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    tickPreview();
  }, [pushUndo, tickPreview]);

  // ── canvas coordinate from pointer event ────────────────────────────────────
  const canvasCoords = (e: React.PointerEvent | PointerEvent) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  };

  // ── ABR brush tip cache — rebuild when active brush or color changes ────────
  useEffect(() => {
    if (!activeBrush) { customBrushCanvasRef.current = null; return; }
    const c = document.createElement('canvas');
    c.width = activeBrush.width; c.height = activeBrush.height;
    const ctx2 = c.getContext('2d')!;
    const hex = color.replace('#', '');
    const s   = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
    const nv  = parseInt(s, 16);
    const cr  = (nv >> 16) & 255;
    const cg  = (nv >> 8)  & 255;
    const cb  =  nv        & 255;
    const id  = ctx2.createImageData(activeBrush.width, activeBrush.height);
    for (let i = 0; i < activeBrush.width * activeBrush.height; i++) {
      id.data[i * 4]     = cr;
      id.data[i * 4 + 1] = cg;
      id.data[i * 4 + 2] = cb;
      id.data[i * 4 + 3] = 255 - activeBrush.pixels[i]; // invert: 0→255, 255→0
    }
    ctx2.putImageData(id, 0, 0);
    customBrushCanvasRef.current = c;
  }, [activeBrush, color]);

  // ── stroke sampling (Catmull-Rom interpolated for smooth mode) ───────────────
  const emitDab = useCallback((x: number, y: number) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

      // Calculate jitters
      let dSize = brushSize;
      if (sizeJitter > 0) dSize = Math.max(1, brushSize * (1 + (Math.random() * 2 - 1) * (sizeJitter / 100)));
      
      let dAngle = 0;
      if (angleJitter > 0) dAngle = (Math.random() * 2 - 1) * (angleJitter / 100) * 180;
      
      let dOpacity = opacity;
      if (opacityJitter > 0) dOpacity = Math.max(0, Math.min(100, opacity * (1 + (Math.random() * 2 - 1) * (opacityJitter / 100))));

      if (activeStamp) {
        stampDab(ctx, tool, activeStamp, x, y, dSize, color, dOpacity, dAngle);
      } else if (activeBrush && customBrushCanvasRef.current) {
        ctx.save();
        ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.globalAlpha = dOpacity / 100;
        ctx.translate(x, y);
        if (dAngle) ctx.rotate((dAngle * Math.PI) / 180);
        ctx.drawImage(
          customBrushCanvasRef.current,
          Math.round(-dSize / 2),
          Math.round(-dSize / 2),
          dSize,
          dSize,
        );
        ctx.restore();
      } else {
        brushDab(ctx, tool, x, y, dSize, color, dOpacity, hardness);
      }
    }, [tool, activeStamp, activeBrush, brushSize, color, opacity, hardness, sizeJitter, angleJitter, opacityJitter]);

    const flushSmoothBuffer = useCallback(() => {
      const buf = smoothBuf.current;
      if (buf.length < 2) {
      buf.forEach(p => emitDab(p.x, p.y));
      smoothBuf.current = [];
      return;
    }
    // Catmull-Rom: step through every consecutive 4-point window
      const spacing = Math.max(1, brushSize * (density / 100));
    for (let i = 0; i < buf.length - 1; i++) {
      const p0 = buf[Math.max(0, i - 1)];
      const p1 = buf[i];
      const p2 = buf[Math.min(buf.length - 1, i + 1)];
      const p3 = buf[Math.min(buf.length - 1, i + 2)];
      const steps = Math.max(2, Math.ceil(
        Math.hypot(p2.x - p1.x, p2.y - p1.y) / spacing
      ));
      for (let s = 0; s <= steps; s++) {
        const t  = s / steps;
        const t2 = t * t, t3 = t2 * t;
        const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        emitDab(x, y);
      }
    }
    smoothBuf.current = [];
  }, [emitDab, brushSize]);

  // ── pointer events ───────────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pushUndo();
    isPointerDown.current = true;
    const pos = canvasCoords(e);
    lastPos.current = pos;
    smoothBuf.current = [pos];
    emitDab(pos.x, pos.y);
    tickPreview();
  }, [pushUndo, emitDab, tickPreview]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDown.current) return;
    const pos = canvasCoords(e);
    if (smooth) {
      smoothBuf.current.push(pos);
      if (smoothBuf.current.length >= 4) flushSmoothBuffer();
    } else {
      // Direct mode — also ensure min spacing so dabs don't stack excessively
      const last = lastPos.current;
      if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) >= Math.max(1, brushSize * 0.12)) {
        emitDab(pos.x, pos.y);
        lastPos.current = pos;
      }
    }
    tickPreview();
  }, [smooth, brushSize, emitDab, flushSmoothBuffer, tickPreview]);

  const handlePointerUp = useCallback(() => {
    if (smoothBuf.current.length > 0) flushSmoothBuffer();
    isPointerDown.current = false;
    lastPos.current = null;
    smoothBuf.current = [];
    tickPreview();
  }, [flushSmoothBuffer, tickPreview]);

  // ── keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo]);

  // ── stamp preview thumbnails ─────────────────────────────────────────────────
  const stampThumbs = STAMPS.map(s => {
    const c = renderStampToCanvas(s.type, 36, color);
    return { ...s, thumb: c.toDataURL() };
  });

  // ── preset save ──────────────────────────────────────────────────────────────
  const handleSavePreset = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const thumb = document.createElement('canvas');
    thumb.width = thumb.height = 64;
    thumb.getContext('2d')!.drawImage(c, 0, 0, 64, 64);
    const preset: PainterPreset = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      thumbnail: thumb.toDataURL('image/png'),
      fullDataUrl: c.toDataURL('image/png'),
    };
    const next = [...presets, preset];
    setPresets(next);
    savePresets(next);
    setPresetName('');
  }, [presetName, presets]);

  const handleLoadPreset = useCallback((preset: PainterPreset) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    pushUndo();
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE); tickPreview(); };
    img.src = preset.fullDataUrl;
  }, [pushUndo, tickPreview]);

  const handleDeletePreset = useCallback((id: string) => {
    const next = presets.filter(p => p.id !== id);
    setPresets(next);
    savePresets(next);
  }, [presets]);

  // ── inject ───────────────────────────────────────────────────────────────────
  const handleInjectClick = useCallback(() => {
    if (emitters.length === 0) {
      alert('No emitters in the scene. Add an emitter first.');
      return;
    }
    if (emitters.length === 1) {
      onInjectToEmitter(emitters[0].id, canvasRef.current?.toDataURL('image/png') ?? '');
      return;
    }
    setShowInject(true);
  }, [emitters, onInjectToEmitter]);

  const handleInjectConfirm = useCallback((emitterId: string) => {
    onInjectToEmitter(emitterId, canvasRef.current?.toDataURL('image/png') ?? '');
    setShowInject(false);
  }, [onInjectToEmitter]);

  // ── stamp toggle ──────────────────────────────────────────────────────────────
  const handleStampClick = useCallback((type: ShapeType) => {
    setActiveStamp(prev => (prev === type ? null : type));
    setActiveBrush(null);
  }, []);
    // ── Image generic file loader
    const handleImageLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const img = new Image();
          img.onload = () => {
            const ctx = canvasRef.current?.getContext('2d');
            if (!ctx) return;
            pushUndo();
            ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
            tickPreview();
          };
          img.src = reader.result;
        }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    }, [pushUndo, tickPreview]);
  // ── ABR file loader ───────────────────────────────────────────────────────────
  const handleAbrLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (reader.result instanceof ArrayBuffer) {
        const brushes = parseAbr(reader.result);
        
        try {
          await saveBrushesToDB(brushes);
        } catch (err) {
          console.warn("Failed to save brushes to indexedDB:", err);
        }

        setAbrBrushes(brushes);
        setStampTab('brushes');
        if (brushes.length > 0) {
          setActiveBrush(brushes[0]);
          setActiveStamp(null);
        }
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // allow reloading same file
  }, []);

  // ── UI helpers ────────────────────────────────────────────────────────────────
  const slider = (
    label: string,
    val: number,
    min: number,
    max: number,
    step: number,
    set: (v: number) => void,
    fmt?: (v: number) => string,
  ) => (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#8a93a2', marginBottom: '2px' }}>
        <span>{label}</span>
        <span style={{ color: '#c8d0e0' }}>{fmt ? fmt(val) : val}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={val}
        style={{ width: '100%', accentColor: '#4f6ef7' }}
        onChange={e => set(parseFloat(e.target.value))} />
    </div>
  );

  const toolBtn = (t: BrushTool, icon: string, tip: string) => (
    <button
      type="button"
      title={tip}
      onClick={() => { setTool(t); setActiveStamp(null); setActiveBrush(null); }}
      style={{
        background: (tool === t && !activeStamp) ? '#4f6ef7' : '#252f45',
        border: '1px solid #3b455c',
        borderRadius: '5px',
        color: '#e2e8f0',
        padding: '6px 10px',
        cursor: 'pointer',
        fontSize: '1rem',
        flex: '1',
        transition: 'background 0.12s',
      }}
    >
      {icon}
    </button>
  );

  return (
    <div style={embedded ? {
      display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0,
    } : {
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={embedded ? {
        display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0,
      } : {
        background: '#1a2035',
        border: '1px solid #3b455c',
        borderRadius: '10px',
        width: '900px',
        maxWidth: '98vw',
        maxHeight: '88vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      }}>

        {/* Header - not shown when embedded */}
        {!embedded && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #3b455c', flexShrink: 0 }}>
            <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '0.97rem' }}>🎨 Custom Particle Painter</h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button type="button" onClick={handleInjectClick}
                style={{ background: '#27ae60', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' }}>
                Inject to Emitter ↗
              </button>
              <button type="button" onClick={onClose}
                style={{ background: 'transparent', color: '#8a93a2', border: '1px solid #3b455c', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}>
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
          <div style={{ width: '170px', borderRight: '1px solid #3b455c', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>

            {/* Tool buttons */}
            <div style={{ padding: '8px', borderBottom: '1px solid #3b455c', flexShrink: 0 }}>
              <div style={{ fontSize: '0.7rem', color: '#8a93a2', textTransform: 'uppercase', marginBottom: '5px' }}>Tool</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {toolBtn('pencil',   '✏️',  'Pencil'  )}
                {toolBtn('brush',    '🖌️', 'Brush'   )}
                {toolBtn('airbrush', '💨', 'Airbrush')}
                {toolBtn('eraser',   '⬜', 'Eraser'  )}
              </div>
            </div>

            {/* Color */}
            <div style={{ padding: '8px', borderBottom: '1px solid #3b455c', flexShrink: 0 }}>
              <div style={{ fontSize: '0.7rem', color: '#8a93a2', textTransform: 'uppercase', marginBottom: '5px' }}>Color</div>
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ width: '100%', height: '32px', cursor: 'pointer', border: '1px solid #3b455c', borderRadius: '4px', background: 'none' }} />
            </div>

            {/* Sliders */}
            <div style={{ padding: '8px', borderBottom: '1px solid #3b455c', flexShrink: 0 }}>
                {slider('Size',     brushSize, 1, 360, 1,  setBrushSize, v => `${v}px`)}
                {slider('Opacity',  opacity,   1, 100, 1,  setOpacity,   v => `${v}%` )}
                {slider('Hardness', hardness,  0, 100, 1,  setHardness,  v => `${v}%` )}
                <div style={{ height: '8px' }} />
                <div style={{ fontSize: '0.7rem', color: '#a0a8b4', marginBottom: '4px', textTransform: 'uppercase' }}>Brush Dynamics</div>
                {slider('Size Jitter',    sizeJitter,    0, 100, 1, setSizeJitter,    v => `${v}%`)}
                {slider('Angle Jitter',   angleJitter,   0, 100, 1, setAngleJitter,   v => `${v}%`)}
                {slider('Opacity Jitter', opacityJitter, 0, 100, 1, setOpacityJitter, v => `${v}%`)}
                {slider('Spacing',        density,       1, 100, 1, setDensity,       v => `${v}%`)}
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#8a93a2', cursor: 'pointer' }}>
                <input type="checkbox" checked={smooth} onChange={e => setSmooth(e.target.checked)} />
                Smooth stroke
              </label>
            </div>

            {/* Actions */}
            <div style={{ padding: '8px', borderBottom: '1px solid #3b455c', flexShrink: 0, display: 'flex', gap: '5px' }}>                <button type="button" onClick={() => imageInputRef.current?.click()}
                  style={{ flex: 1, background: '#252f45', border: '1px solid #3b455c', borderRadius: '4px', color: '#c8d0e0', padding: '5px 0', cursor: 'pointer', fontSize: '0.75rem' }}>
                  🖼 Load
                </button>              <button type="button" onClick={handleUndo}
                style={{ flex: 1, background: '#252f45', border: '1px solid #3b455c', borderRadius: '4px', color: '#c8d0e0', padding: '5px 0', cursor: 'pointer', fontSize: '0.75rem' }}>
                ↩ Undo
              </button>
              <button type="button" onClick={handleClear}
                style={{ flex: 1, background: '#3b1c1c', border: '1px solid #6b2a2a', borderRadius: '4px', color: '#e08080', padding: '5px 0', cursor: 'pointer', fontSize: '0.75rem' }}>
                🗑 Clear
              </button>
            </div>

            {/* Stamp / ABR tab bar */}
            <div style={{ display: 'flex', borderBottom: '1px solid #3b455c', flexShrink: 0 }}>
              {(['shapes', 'brushes'] as const).map(t => (
                <button key={t} type="button" onClick={() => setStampTab(t)}
                  style={{
                    flex: 1,
                    background: stampTab === t ? '#252f45' : 'transparent',
                    border: 'none',
                    borderBottom: stampTab === t ? '2px solid #4f6ef7' : '2px solid transparent',
                    color: stampTab === t ? '#c8d0e0' : '#5a6a82',
                    padding: '5px 0',
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                  }}>
                  {t === 'shapes' ? '⬡ Shapes' : '🖌 ABR'}
                </button>
              ))}
            </div>

            {/* Shapes tab */}
            {stampTab === 'shapes' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px', minHeight: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
                  {stampThumbs.map(s => (
                    <button
                      key={s.type}
                      type="button"
                      title={s.label}
                      onClick={() => handleStampClick(s.type)}
                      style={{
                        background: activeStamp === s.type ? '#2d3d60' : '#1e2840',
                        border: `1px solid ${activeStamp === s.type ? '#4f6ef7' : '#3b455c'}`,
                        borderRadius: '4px',
                        padding: '2px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                      }}
                    >
                      <img src={s.thumb} alt={s.label} style={{ width: 36, height: 36, imageRendering: 'pixelated' }} />
                      <span style={{ fontSize: '0.6rem', color: '#8a93a2', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{s.label}</span>
                    </button>
                  ))}
                </div>
                {activeStamp && (
                  <button type="button" onClick={() => setActiveStamp(null)}
                    style={{ marginTop: '6px', width: '100%', background: '#3a2a10', border: '1px solid #8a5a20', borderRadius: '4px', color: '#e8a050', padding: '4px 0', cursor: 'pointer', fontSize: '0.72rem' }}>
                    ✕ Cancel Stamp
                  </button>
                )}
              </div>
            )}

            {/* ABR Brushes tab */}
            {stampTab === 'brushes' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '8px', minHeight: 0, gap: '6px' }}>
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  style={{ width: '100%', background: '#2a3550', border: '1px dashed #4f6ef7', borderRadius: '4px', color: '#a0b0ff', padding: '6px 0', cursor: 'pointer', fontSize: '0.75rem', flexShrink: 0 }}>
                  📂 Load .abr file
                </button>
                {abrBrushes.length === 0 && (
                  <p style={{ color: '#4a5568', fontSize: '0.68rem', textAlign: 'center', margin: '8px 0' }}>Load a Photoshop .abr brush set to use brush tips here.</p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
                  {abrBrushes.map((b, idx) => (
                    <button key={idx} type="button" title={b.name}
                      onClick={() => { setActiveBrush(a => a === b ? null : b); setActiveStamp(null); }}
                      style={{
                        background: activeBrush === b ? '#2d3d60' : '#1e2840',
                        border: `1px solid ${activeBrush === b ? '#4f6ef7' : '#3b455c'}`,
                        borderRadius: '4px',
                        padding: '2px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                      }}>
                      <img src={b.thumbnail} alt={b.name} style={{ width: 36, height: 36, imageRendering: 'pixelated' }} />
                      <span style={{ fontSize: '0.6rem', color: '#8a93a2', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{b.name}</span>
                    </button>
                  ))}
                </div>
                {activeBrush && (
                  <button type="button" onClick={() => setActiveBrush(null)}
                    style={{ width: '100%', background: '#3a2a10', border: '1px solid #8a5a20', borderRadius: '4px', color: '#e8a050', padding: '4px 0', cursor: 'pointer', fontSize: '0.72rem', flexShrink: 0 }}>
                    ✕ Deselect Brush
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── CANVAS AREA ──────────────────────────────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0d1018', padding: '16px', minWidth: 0 }}>
            {(activeStamp || activeBrush) && (
              <div style={{ marginBottom: '8px', background: 'rgba(79,110,247,0.15)', border: '1px solid #4f6ef7', borderRadius: '6px', padding: '5px 12px', color: '#a0b0ff', fontSize: '0.78rem' }}>
                {activeStamp
                  ? <>🖱 Stamp: <strong>{STAMPS.find(s => s.type === activeStamp)?.label}</strong></>
                  : <>🖌 ABR brush: <strong>{activeBrush?.name}</strong></>}
              </div>
            )}

            {/* Checkerboard + canvas */}
            <div style={{
              position: 'relative',
              borderRadius: '4px',
              overflow: 'hidden',
              outline: '1px solid #3b455c',
              background: 'repeating-conic-gradient(#1c1c2e 0% 25%, #13131f 0% 50%) 0 0 / 16px 16px',
              lineHeight: 0,
            }}>
              <canvas
                ref={canvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(88vh - 200px)', cursor: activeStamp ? 'crosshair' : (tool === 'eraser' ? 'cell' : 'crosshair') }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              />
            </div>

            {/* Size indicator */}
            <div style={{ marginTop: '6px', fontSize: '0.7rem', color: '#555', letterSpacing: '0.06em' }}>
              {CANVAS_SIZE}×{CANVAS_SIZE}px | {activeStamp ? `Stamp: ${STAMPS.find(s => s.type === activeStamp)?.label}` : tool.charAt(0).toUpperCase() + tool.slice(1)}
            </div>
          </div>

          {/* ── RIGHT SIDEBAR ────────────────────────────────────────────────── */}
          <div style={{ width: '200px', borderLeft: '1px solid #3b455c', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>

            {/* Live preview */}
            <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid #3b455c', flexShrink: 0 }}>
              <div style={{ fontSize: '0.7rem', color: '#8a93a2', textTransform: 'uppercase', marginBottom: '8px' }}>Live Preview</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', flexWrap: 'wrap' }}>
                  {previewSizes.map((sz: number, i: number) => (
                    <div key={sz} style={{ textAlign: 'center' }}>
                      <div style={{
                        width: sz, height: sz,
                        background: 'repeating-conic-gradient(#1c1c2e 0% 25%, #13131f 0% 50%) 0 0 / 8px 8px',
                        borderRadius: '2px',
                        overflow: 'hidden',
                        border: '1px solid #2a3050',
                      }}>
                        <canvas
                          ref={el => { previewCanvasRefs.current[i] = el; }}
                          width={sz}
                          height={sz}
                          style={{ width: sz, height: sz, display: 'block' }}
                        />
                      </div>
                      <div style={{ fontSize: '0.6rem', color: '#555', marginTop: '2px' }}>{sz}px</div>
                    </div>
                  ))}
                </div>
            </div>

            {/* Preset save */}
            <div style={{ padding: '10px', borderBottom: '1px solid #3b455c', flexShrink: 0 }}>
              <div style={{ fontSize: '0.7rem', color: '#8a93a2', textTransform: 'uppercase', marginBottom: '6px' }}>Save Preset</div>
              <input
                type="text"
                placeholder="Preset name…"
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); }}
                style={{ width: '100%', background: '#252f45', color: '#e2e8f0', border: '1px solid #3b455c', borderRadius: '4px', padding: '4px 6px', fontSize: '0.78rem', boxSizing: 'border-box', marginBottom: '5px' }}
              />
              <button type="button" onClick={handleSavePreset}
                style={{ width: '100%', background: '#4f6ef7', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 0', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.78rem' }}>
                💾 Save
              </button>
            </div>

            {/* Preset gallery */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px', minHeight: 0 }}>
              <div style={{ fontSize: '0.7rem', color: '#8a93a2', textTransform: 'uppercase', marginBottom: '6px' }}>Presets</div>
              {presets.length === 0 && (
                <p style={{ color: '#444', fontSize: '0.73rem', textAlign: 'center', marginTop: '16px' }}>No presets saved.</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {presets.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#1e2840', border: '1px solid #3b455c', borderRadius: '5px', padding: '4px 5px' }}>
                    <img
                      src={p.thumbnail} alt={p.name}
                      onClick={() => handleLoadPreset(p)}
                      title="Load preset"
                      style={{ width: 36, height: 36, borderRadius: '3px', cursor: 'pointer', flexShrink: 0, background: '#111', imageRendering: 'pixelated' }}
                    />
                    <span
                      onClick={() => handleLoadPreset(p)}
                      title={p.name}
                      style={{ flex: 1, fontSize: '0.72rem', color: '#c8d0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                      {p.name}
                    </span>
                    <button type="button" onClick={() => handleDeletePreset(p.id)} title="Delete"
                      style={{ background: 'none', border: 'none', color: '#e05050', cursor: 'pointer', padding: '0 2px', fontSize: '0.75rem', flexShrink: 0 }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden ABR file input */}
      <input ref={fileInputRef} type="file" accept=".abr" style={{ display: 'none' }} onChange={handleAbrLoad} />
        {/* Hidden Image file input */}
        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageLoad} />
      {!embedded && showInject && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ background: '#1a2035', border: '1px solid #3b455c', borderRadius: '8px', padding: '20px', minWidth: '280px', boxShadow: '0 6px 30px rgba(0,0,0,0.5)' }}>
            <h4 style={{ margin: '0 0 14px', color: '#e2e8f0', fontSize: '0.95rem' }}>Choose Target Emitter</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '14px' }}>
              {emitters.map(em => (
                <button key={em.id} type="button" onClick={() => handleInjectConfirm(em.id)}
                  style={{ background: '#252f45', border: '1px solid #3b455c', borderRadius: '5px', color: '#c8d0e0', padding: '8px 12px', cursor: 'pointer', textAlign: 'left', fontSize: '0.85rem' }}>
                  💠 {em.name || em.id}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowInject(false)}
              style={{ width: '100%', background: 'transparent', border: '1px solid #3b455c', borderRadius: '5px', color: '#8a93a2', padding: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomParticlePainter;










