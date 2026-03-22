import React, { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ShapeType =
  | 'soft-dot' | 'circle' | 'ring' | 'star' | 'polygon'
  | 'diamond'  | 'spark'  | 'cross' | 'smoke';

export type FillMode   = 'solid' | 'radial' | 'linear';
export type LayerBlend = 'normal' | 'add' | 'screen' | 'multiply';
export type AnimType   = 'none' | 'spin' | 'pulse' | 'flicker' | 'color-cycle' | 'unfold';

export type ParticleLayer = {
  id: string;
  type: ShapeType;
  // Fill
  fillMode: FillMode;
  color1: string;
  color2: string;
  gradientMid: number;
  gradientAngle: number;
  hardness: number;
  // Shape
  size: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  points: number;
  innerRadius: number;
  // Base
  opacity: number;
  blend: LayerBlend;
  blur: number;
  // Filters
  saturate: number;
  contrast: number;
  brightness: number;
  hueShift: number;
  // Glow
  glow: number;
  glowSize: number;
  glowColor: string;
  // Bloom
  bloom: number;
  bloomSize: number;
  // Star glow
  starGlow: number;
  starGlowArms: number;
  starGlowLength: number;
  // Glitter
  glitter: number;
  glitterSize: number;
  // Chromatic aberration
  ca: number;
};

export type AnimConfig = {
  type: AnimType;
  frames: number;
  fps: number;
};

// ─── Defaults ────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const defaultLayer = (type: ShapeType): ParticleLayer => ({
  id: uid(), type,
  fillMode: type === 'soft-dot' ? 'radial' : 'solid',
  color1: '#ffffff', color2: '#ffffff',
  gradientMid: 0.5, gradientAngle: 90,
  hardness: type === 'soft-dot' ? 20 : 95,
  size: 70, offsetX: 0, offsetY: 0, rotation: 0,
  points: type === 'star' ? 5 : 6,
  innerRadius: type === 'ring' ? 0.55 : 0.45,
  opacity: 1, blend: 'normal',
  blur: type === 'soft-dot' ? 6 : 0,
  saturate: 100, contrast: 100, brightness: 100, hueShift: 0,
  glow: 0, glowSize: 2.5, glowColor: '#ffffff',
  bloom: 0, bloomSize: 3,
  starGlow: 0, starGlowArms: 4, starGlowLength: 1.0,
  glitter: 0, glitterSize: 1.5,
  ca: 0,
});

const defaultAnim = (): AnimConfig => ({ type: 'none', frames: 8, fps: 12 });

// ─── Canvas helpers ───────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(s, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function buildCssFilter(layer: ParticleLayer, extraBlur = 0): string {
  const parts: string[] = [];
  const totalBlur = layer.blur + extraBlur;
  if (totalBlur > 0)           parts.push(`blur(${totalBlur}px)`);
  if (layer.saturate !== 100)  parts.push(`saturate(${layer.saturate}%)`);
  if (layer.contrast !== 100)  parts.push(`contrast(${layer.contrast}%)`);
  if (layer.brightness !== 100) parts.push(`brightness(${layer.brightness}%)`);
  if (layer.hueShift !== 0)   parts.push(`hue-rotate(${layer.hueShift}deg)`);
  return parts.length ? parts.join(' ') : 'none';
}

function makeGradient(
  ctx: CanvasRenderingContext2D,
  layer: ParticleLayer,
  r: number,
): CanvasGradient | string {
  if (layer.fillMode === 'solid') return layer.color1;

  if (layer.fillMode === 'radial') {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const hard = Math.min(0.99, layer.hardness / 100);
    g.addColorStop(0, hexToRgba(layer.color1, 1));
    if (hard > 0.01) g.addColorStop(hard, hexToRgba(layer.color1, 1));
    g.addColorStop(layer.gradientMid, hexToRgba(layer.color2, 0.6));
    g.addColorStop(1, hexToRgba(layer.color2, 0));
    return g;
  }

  const ang = (layer.gradientAngle * Math.PI) / 180;
  const dx = Math.cos(ang) * r;
  const dy = Math.sin(ang) * r;
  const g = ctx.createLinearGradient(-dx, -dy, dx, dy);
  g.addColorStop(0, hexToRgba(layer.color1, 1));
  g.addColorStop(layer.gradientMid, hexToRgba(layer.color2, 1));
  g.addColorStop(1, hexToRgba(layer.color1, 0));
  return g;
}

function drawShape(ctx: CanvasRenderingContext2D, layer: ParticleLayer, r: number) {
  const { type, points, innerRadius } = layer;
  ctx.beginPath();
  switch (type) {
    case 'soft-dot':
    case 'circle':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'ring':
      ctx.arc(0, 0, r, 0, Math.PI * 2, false);
      ctx.arc(0, 0, r * Math.max(0.05, innerRadius), 0, Math.PI * 2, true);
      break;
    case 'star': {
      const n = Math.max(3, Math.round(points));
      for (let i = 0; i < n * 2; i++) {
        const ang = (i * Math.PI) / n - Math.PI / 2;
        const rad = i % 2 === 0 ? r : r * Math.max(0.05, innerRadius);
        if (i === 0) ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
        else         ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
      }
      ctx.closePath();
      break;
    }
    case 'polygon': {
      const n = Math.max(3, Math.round(points));
      for (let i = 0; i < n; i++) {
        const ang = (i * 2 * Math.PI) / n - Math.PI / 2;
        if (i === 0) ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
        else         ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
      }
      ctx.closePath();
      break;
    }
    case 'diamond': {
      const s = r * 1.1;
      ctx.moveTo(0, -s); ctx.lineTo(s * 0.6, 0);
      ctx.lineTo(0, s);  ctx.lineTo(-s * 0.6, 0);
      ctx.closePath();
      break;
    }
    case 'spark':
      ctx.ellipse(0, 0, r, r * 0.12, 0, 0, Math.PI * 2);
      break;
    case 'cross': {
      const arm = r; const thick = r * 0.22;
      ctx.rect(-arm, -thick, arm * 2, thick * 2);
      ctx.rect(-thick, -arm, thick * 2, arm * 2);
      break;
    }
    case 'smoke': {
      const np = 8; let first = true;
      for (let i = 0; i < np; i++) {
        const ang  = (i * 2 * Math.PI) / np;
        const angN = ((i + 1) * 2 * Math.PI) / np;
        const lump  = 0.85 + ((Math.sin(i * 7.3) + 1) / 2) * 0.25;
        const lumpN = 0.85 + ((Math.sin((i + 1) * 7.3) + 1) / 2) * 0.25;
        const x = Math.cos(ang) * r * lump;
        const y = Math.sin(ang) * r * lump;
        const cx1 = Math.cos(ang + 0.5) * r * 1.1;
        const cy1 = Math.sin(ang + 0.5) * r * 1.1;
        const nx = Math.cos(angN) * r * lumpN;
        const ny = Math.sin(angN) * r * lumpN;
        if (first) { ctx.moveTo(x, y); first = false; }
        ctx.quadraticCurveTo(cx1, cy1, nx, ny);
      }
      ctx.closePath();
      break;
    }
    default:
      ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
}

// Render a single layer's base shape to an offscreen canvas
function renderLayerToOffscreen(size: number, layer: ParticleLayer, frameT: number, animType: AnimType): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = off.height = size;
  const ctx = off.getContext('2d')!;
  const cx = size / 2;

  ctx.save();

  let extraRot = layer.rotation;
  if (animType === 'spin') extraRot += frameT * 360;
  ctx.translate(cx + (layer.offsetX / 100) * size, cx + (layer.offsetY / 100) * size);
  ctx.rotate((extraRot * Math.PI) / 180);

  let r = (layer.size / 100) * cx;
  if (animType === 'pulse')  r *= 0.5 + 0.5 * Math.sin(frameT * Math.PI * 2);
  if (animType === 'unfold') r *= frameT;

  let opacityMod = layer.opacity;
  if (animType === 'flicker') opacityMod *= 0.3 + 0.7 * Math.abs(Math.sin(frameT * Math.PI * 7));
  ctx.globalAlpha = opacityMod;

  const effectiveLayer = animType === 'color-cycle'
    ? { ...layer, hueShift: (layer.hueShift + frameT * 360) % 360 }
    : layer;

  const fstr = buildCssFilter(effectiveLayer);
  if (fstr !== 'none') ctx.filter = fstr;

  const blendMap: Record<LayerBlend, GlobalCompositeOperation> = {
    normal: 'source-over', add: 'lighter', screen: 'screen', multiply: 'multiply',
  };
  ctx.globalCompositeOperation = blendMap[effectiveLayer.blend] ?? 'source-over';

  ctx.fillStyle = makeGradient(ctx, effectiveLayer, r);
  drawShape(ctx, effectiveLayer, r);
  if (effectiveLayer.type === 'ring')  ctx.fill('evenodd');
  else if (effectiveLayer.type === 'cross') ctx.fill('nonzero');
  else ctx.fill();

  ctx.restore();
  return off;
}

// Apply glow / bloom / star-glow / glitter / CA effects
function applyLayerEffects(
  dst: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  layer: ParticleLayer,
  size: number,
  frameT: number,
  animType: AnimType,
) {
  const cx = size / 2;
  let r = (layer.size / 100) * cx;
  if (animType === 'pulse')  r *= 0.5 + 0.5 * Math.sin(frameT * Math.PI * 2);
  if (animType === 'unfold') r *= frameT;

  // Glow
  if (layer.glow > 0) {
    const blurPx = Math.max(1, r * layer.glowSize * 0.5);
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = size;
    const tc = tmp.getContext('2d')!;
    tc.filter = `blur(${blurPx.toFixed(1)}px)`;
    tc.drawImage(base, 0, 0);
    dst.save();
    dst.globalCompositeOperation = 'lighter';
    dst.globalAlpha = (layer.glow / 100) * 0.85;
    dst.drawImage(tmp, 0, 0);
    dst.restore();
  }

  // Bloom
  if (layer.bloom > 0) {
    const blurPx = Math.max(1, r * layer.bloomSize * 0.4);
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = size;
    const tc = tmp.getContext('2d')!;
    tc.filter = `blur(${blurPx.toFixed(1)}px) brightness(200%)`;
    tc.drawImage(base, 0, 0);
    dst.save();
    dst.globalCompositeOperation = 'screen';
    dst.globalAlpha = layer.bloom / 100;
    dst.drawImage(tmp, 0, 0);
    dst.restore();
  }

  // Star glow
  if (layer.starGlow > 0) {
    const ox = cx + (layer.offsetX / 100) * size;
    const oy = cx + (layer.offsetY / 100) * size;
    const arms = Math.round(layer.starGlowArms);
    const len = r * layer.starGlowLength * 2;
    const baseAlpha = (layer.starGlow / 100) * 0.9;
    dst.save();
    dst.globalCompositeOperation = 'lighter';
    for (let i = 0; i < arms; i++) {
      const ang = (i * Math.PI) / arms + (layer.rotation * Math.PI / 180);
      const grad = dst.createLinearGradient(
        ox - Math.cos(ang) * len, oy - Math.sin(ang) * len,
        ox + Math.cos(ang) * len, oy + Math.sin(ang) * len,
      );
      grad.addColorStop(0, hexToRgba(layer.glowColor, 0));
      grad.addColorStop(0.4, hexToRgba(layer.glowColor, baseAlpha));
      grad.addColorStop(0.5, hexToRgba(layer.glowColor, baseAlpha));
      grad.addColorStop(1, hexToRgba(layer.glowColor, 0));
      dst.strokeStyle = grad;
      dst.lineWidth = Math.max(1, r * 0.07);
      dst.beginPath();
      dst.moveTo(ox - Math.cos(ang) * len, oy - Math.sin(ang) * len);
      dst.lineTo(ox + Math.cos(ang) * len, oy + Math.sin(ang) * len);
      dst.stroke();
    }
    dst.restore();
  }

  // Glitter
  if (layer.glitter > 0) {
    const count = Math.round((layer.glitter / 100) * 120);
    const ox = cx + (layer.offsetX / 100) * size;
    const oy = cx + (layer.offsetY / 100) * size;
    dst.save();
    dst.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const s1 = Math.sin(i * 127.1) * 0.5 + 0.5;
      const s2 = Math.sin(i * 311.7) * 0.5 + 0.5;
      const s3 = Math.sin(i * 53.3)  * 0.5 + 0.5;
      const angle = s1 * Math.PI * 2;
      const dist  = Math.sqrt(s2) * r * 0.9;
      const px = ox + Math.cos(angle) * dist;
      const py = oy + Math.sin(angle) * dist;
      const shimmer = Math.abs(Math.sin(frameT * Math.PI * 2 + s3 * Math.PI * 3));
      dst.globalAlpha = shimmer * 0.85;
      dst.fillStyle = layer.glowColor;
      dst.beginPath();
      dst.arc(px, py, layer.glitterSize, 0, Math.PI * 2);
      dst.fill();
      if (r > 30) {
        const sl = layer.glitterSize * 2.5;
        dst.strokeStyle = layer.glowColor;
        dst.lineWidth = 0.8;
        dst.globalAlpha = shimmer * 0.55;
        dst.beginPath();
        dst.moveTo(px - sl, py); dst.lineTo(px + sl, py);
        dst.moveTo(px, py - sl); dst.lineTo(px, py + sl);
        dst.stroke();
      }
    }
    dst.restore();
  }

  // Chromatic aberration
  if (layer.ca > 0) {
    const shift = layer.ca;
    // Red channel left-shifted
    const tmpR = document.createElement('canvas');
    tmpR.width = tmpR.height = size;
    const tcR = tmpR.getContext('2d')!;
    tcR.drawImage(base, -shift, 0);
    tcR.globalCompositeOperation = 'source-in';
    tcR.fillStyle = 'red'; tcR.fillRect(0, 0, size, size);
    dst.save(); dst.globalCompositeOperation = 'screen'; dst.globalAlpha = 0.55;
    dst.drawImage(tmpR, 0, 0); dst.restore();

    // Blue channel right-shifted
    const tmpB = document.createElement('canvas');
    tmpB.width = tmpB.height = size;
    const tcB = tmpB.getContext('2d')!;
    tcB.drawImage(base, shift, 0);
    tcB.globalCompositeOperation = 'source-in';
    tcB.fillStyle = 'blue'; tcB.fillRect(0, 0, size, size);
    dst.save(); dst.globalCompositeOperation = 'screen'; dst.globalAlpha = 0.55;
    dst.drawImage(tmpB, 0, 0); dst.restore();
  }
}

// Render all layers + effects for one animation frame
function renderFrame(
  canvas: HTMLCanvasElement,
  layers: ParticleLayer[],
  frameT: number,
  animType: AnimType,
) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const blendMap: Record<LayerBlend, GlobalCompositeOperation> = {
    normal: 'source-over', add: 'lighter', screen: 'screen', multiply: 'multiply',
  };
  for (const layer of layers) {
    const base = renderLayerToOffscreen(size, layer, frameT, animType);
    ctx.save();
    ctx.globalCompositeOperation = blendMap[layer.blend] ?? 'source-over';
    ctx.drawImage(base, 0, 0);
    ctx.restore();
    applyLayerEffects(ctx, base, layer, size, frameT, animType);
  }
}

// ─── Shape palette ────────────────────────────────────────────────────────────

const SHAPES: { type: ShapeType; label: string }[] = [
  { type: 'soft-dot', label: '✦ Soft Dot' },
  { type: 'circle',   label: '⬤ Circle'   },
  { type: 'ring',     label: '◯ Ring'     },
  { type: 'star',     label: '★ Star'     },
  { type: 'polygon',  label: '⬡ Polygon'  },
  { type: 'diamond',  label: '◆ Diamond'  },
  { type: 'spark',    label: '— Spark'    },
  { type: 'cross',    label: '✛ Cross'    },
  { type: 'smoke',    label: '☁ Smoke'    },
];

// ─── Component ───────────────────────────────────────────────────────────────

type Props = {
  onExport:         (dataUrl: string, name: string) => void;
  onExportSequence: (dataUrls: string[], name: string, fps: number) => void;
  onClose:          () => void;
  visible?:         boolean;
};

export const ParticleCreator: React.FC<Props> = ({ onExport, onExportSequence, onClose, visible = true }) => {
  const [layers,       setLayers      ] = useState<ParticleLayer[]>([defaultLayer('soft-dot')]);
  const [selectedId,   setSelectedId  ] = useState<string>(() => layers[0]?.id ?? '');
  const [canvasSize,   setCanvasSize  ] = useState<128 | 256 | 512>(256);
  const [previewBg,    setPreviewBg   ] = useState<'transparent' | 'black' | 'grey'>('black');
  const [anim,         setAnim        ] = useState<AnimConfig>(defaultAnim);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [playing,      setPlaying     ] = useState(false);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef        = useRef<number | null>(null);
  const playT         = useRef(0);

  const selectedLayer = layers.find(l => l.id === selectedId) ?? null;

  const redraw = useCallback((fi: number) => {
    if (!mainCanvasRef.current) return;
    const frameT = anim.type === 'none' ? 0 : fi / Math.max(1, anim.frames - 1);
    renderFrame(mainCanvasRef.current, layers, frameT, anim.type);
  }, [layers, anim]);

  useEffect(() => { redraw(previewFrame); }, [layers, canvasSize, anim, previewFrame, redraw]);

  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      playT.current += dt;
      const fi = Math.floor(playT.current * anim.fps) % anim.frames;
      setPreviewFrame(fi);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, anim.fps, anim.frames]);

  const updateLayer = useCallback((id: string, patch: Partial<ParticleLayer>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }, []);
  const addLayer = useCallback((type: ShapeType) => {
    const nl = defaultLayer(type);
    setLayers(prev => [...prev, nl]);
    setSelectedId(nl.id);
  }, []);
  const removeLayer = useCallback((id: string) => {
    setLayers(prev => {
      const next = prev.filter(l => l.id !== id);
      if (selectedId === id) setSelectedId(next[next.length - 1]?.id ?? '');
      return next;
    });
  }, [selectedId]);
  const moveLayer = useCallback((id: string, dir: -1 | 1) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }, []);

  const handleExport = useCallback(() => {
    const c = document.createElement('canvas');
    c.width = c.height = canvasSize;
    renderFrame(c, layers, 0, 'none');
    onExport(c.toDataURL('image/png'), `particle_${layers.map(l => l.type).join('+')}`);
  }, [layers, canvasSize, onExport]);

  const handleExportAnim = useCallback(() => {
    if (anim.type === 'none' || anim.frames <= 1) { handleExport(); return; }
    const urls: string[] = [];
    for (let f = 0; f < anim.frames; f++) {
      const c = document.createElement('canvas');
      c.width = c.height = canvasSize;
      renderFrame(c, layers, f / Math.max(1, anim.frames - 1), anim.type);
      urls.push(c.toDataURL('image/png'));
    }
    onExportSequence(urls, `particle_anim_${anim.type}`, anim.fps);
  }, [layers, canvasSize, anim, onExportSequence, handleExport]);

  const handleDownloadSheet = useCallback(() => {
    const n = anim.type === 'none' ? 1 : anim.frames;
    const sheet = document.createElement('canvas');
    sheet.width = canvasSize * n; sheet.height = canvasSize;
    const sc = sheet.getContext('2d')!;
    for (let f = 0; f < n; f++) {
      const frm = document.createElement('canvas');
      frm.width = frm.height = canvasSize;
      renderFrame(frm, layers, n === 1 ? 0 : f / Math.max(1, n - 1), anim.type === 'none' ? 'none' : anim.type);
      sc.drawImage(frm, f * canvasSize, 0);
    }
    const a = document.createElement('a');
    a.href = sheet.toDataURL('image/png');
    a.download = `particle_sheet_${n}f.png`;
    a.click();
  }, [layers, canvasSize, anim]);

  // ── UI helpers ────────────────────────────────────────────
  const row = (label: string, children: React.ReactNode) => (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ fontSize: '0.78rem', color: '#8a93a2', marginBottom: '3px' }}>{label}</div>
      {children}
    </div>
  );
  const numSlider = (prop: keyof ParticleLayer, min: number, max: number, step: number, label: string, display?: (v: number) => string) => {
    if (!selectedLayer) return null;
    const val = selectedLayer[prop] as number;
    return row(`${label}: ${display ? display(val) : val.toFixed(step < 1 ? 1 : 0)}`, (
      <input type="range" min={min} max={max} step={step} value={val} style={{ width: '100%' }}
        onChange={e => updateLayer(selectedLayer.id, { [prop]: parseFloat(e.target.value) } as Partial<ParticleLayer>)} />
    ));
  };
  const selectInput = (label: string, val: string, opts: [string, string][], onChange: (v: string) => void) =>
    row(label, (
      <select value={val} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', background: '#252f45', color: '#e2e8f0', border: '1px solid #3b455c', borderRadius: '4px', padding: '4px' }}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    ));
  const sectionHdr = (title: string) => (
    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#4f6ef7', marginTop: '12px', marginBottom: '6px', borderTop: '1px solid #3b455c', paddingTop: '8px' }}>{title}</div>
  );
  const bgBg: Record<typeof previewBg, string> = {
    transparent: 'repeating-conic-gradient(#444 0% 25%, #333 0% 50%) 0 0 / 16px 16px',
    black: '#000', grey: '#555',
  };
  const thumbs = [64, 32, 16, 8, 4].map(sz => {
    const c = document.createElement('canvas');
    c.width = c.height = sz;
    const ft = anim.type === 'none' ? 0 : previewFrame / Math.max(1, anim.frames - 1);
    renderFrame(c, layers, ft, anim.type);
    return { sz, url: c.toDataURL() };
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1a2035', border: '1px solid #3b455c', borderRadius: '10px', width: '1000px', maxWidth: '99vw', maxHeight: '97vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid #3b455c', flexShrink: 0 }}>
          <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '1rem' }}>✨ Particle Creator</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select value={canvasSize} onChange={e => setCanvasSize(Number(e.target.value) as 128|256|512)}
              style={{ background: '#252f45', color: '#e2e8f0', border: '1px solid #3b455c', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem' }}>
              <option value={128}>128 px</option>
              <option value={256}>256 px</option>
              <option value={512}>512 px</option>
            </select>
            <button type="button" onClick={handleExport} style={{ background: '#4f6ef7', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' }}>Use Still ↗</button>
            {anim.type !== 'none' && (
              <button type="button" onClick={handleExportAnim} style={{ background: '#27ae60', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' }}>Use Anim ↗</button>
            )}
            <button type="button" onClick={onClose} style={{ background: 'transparent', color: '#8a93a2', border: '1px solid #3b455c', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* LEFT: shape palette + layer list */}
          <div style={{ width: '168px', borderRight: '1px solid #3b455c', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ padding: '10px', borderBottom: '1px solid #3b455c' }}>
              <div style={{ fontSize: '0.7rem', color: '#8a93a2', marginBottom: '5px', textTransform: 'uppercase' }}>Add Shape</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                {SHAPES.map(s => (
                  <button key={s.type} type="button" onClick={() => addLayer(s.type)}
                    style={{ background: '#252f45', border: '1px solid #3b455c', borderRadius: '4px', color: '#c8d0e0', padding: '5px 4px', cursor: 'pointer', fontSize: '0.7rem', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              <div style={{ fontSize: '0.7rem', color: '#8a93a2', marginBottom: '5px', textTransform: 'uppercase' }}>Layers (top→bottom)</div>
              {[...layers].reverse().map(layer => (
                <div key={layer.id} onClick={() => setSelectedId(layer.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '4px 5px', marginBottom: '4px', borderRadius: '5px', cursor: 'pointer', background: selectedId === layer.id ? '#2d3d60' : '#1e2840', border: `1px solid ${selectedId === layer.id ? '#4f6ef7' : '#3b455c'}`, fontSize: '0.74rem', color: '#c8d0e0' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{SHAPES.find(s => s.type === layer.type)?.label ?? layer.type}</span>
                  <button type="button" onClick={e => { e.stopPropagation(); moveLayer(layer.id, -1); }} style={{ background: 'none', border: 'none', color: '#8a93a2', cursor: 'pointer', padding: '0 1px', fontSize: '0.7rem' }}>↑</button>
                  <button type="button" onClick={e => { e.stopPropagation(); moveLayer(layer.id, 1); }}  style={{ background: 'none', border: 'none', color: '#8a93a2', cursor: 'pointer', padding: '0 1px', fontSize: '0.7rem' }}>↓</button>
                  <button type="button" onClick={e => { e.stopPropagation(); removeLayer(layer.id); }} style={{ background: 'none', border: 'none', color: '#e05050', cursor: 'pointer', padding: '0 1px', fontSize: '0.74rem' }}>✕</button>
                </div>
              ))}
              {layers.length === 0 && <p style={{ color: '#555', fontSize: '0.74rem', textAlign: 'center', marginTop: '20px' }}>No layers.</p>}
            </div>
          </div>

          {/* CENTRE: layer properties */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', minWidth: 0 }}>
            {selectedLayer ? (<>
              <div style={{ fontSize: '0.78rem', color: '#8a93a2', marginBottom: '10px', textTransform: 'uppercase' }}>
                Layer — {SHAPES.find(s => s.type === selectedLayer.type)?.label}
              </div>

              {sectionHdr('Fill')}
              {selectInput('Fill Mode', selectedLayer.fillMode,
                [['solid','Solid'],['radial','Radial Gradient'],['linear','Linear Gradient']],
                v => updateLayer(selectedLayer.id, { fillMode: v as FillMode }))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: '#8a93a2', marginBottom: '3px' }}>{selectedLayer.fillMode === 'solid' ? 'Colour' : 'Colour 1'}</div>
                  <input type="color" value={selectedLayer.color1} onChange={e => updateLayer(selectedLayer.id, { color1: e.target.value })} style={{ width: '100%', height: '30px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
                </div>
                {selectedLayer.fillMode !== 'solid' && (
                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#8a93a2', marginBottom: '3px' }}>Colour 2</div>
                    <input type="color" value={selectedLayer.color2} onChange={e => updateLayer(selectedLayer.id, { color2: e.target.value })} style={{ width: '100%', height: '30px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
                  </div>
                )}
              </div>
              {selectedLayer.fillMode !== 'solid' && numSlider('gradientMid', 0, 1, 0.01, 'Gradient Midpoint', v => `${(v*100).toFixed(0)}%`)}
              {selectedLayer.fillMode === 'linear' && numSlider('gradientAngle', 0, 360, 1, 'Gradient Angle', v => `${v.toFixed(0)}°`)}

              {sectionHdr('Shape')}
              {numSlider('size', 1, 100, 1, 'Size', v => `${v}%`)}
              {(selectedLayer.type === 'soft-dot' || selectedLayer.type === 'circle') && numSlider('hardness', 0, 100, 1, 'Hardness', v => `${v}%`)}
              {selectedLayer.type === 'ring' && numSlider('innerRadius', 0.05, 0.95, 0.01, 'Inner Radius', v => `${(v*100).toFixed(0)}%`)}
              {selectedLayer.type === 'star' && <>{numSlider('points', 3, 12, 1, 'Points', v => `${Math.round(v)}`)}{numSlider('innerRadius', 0.05, 0.95, 0.01, 'Inner Radius', v => `${(v*100).toFixed(0)}%`)}</>}
              {selectedLayer.type === 'polygon' && numSlider('points', 3, 12, 1, 'Sides', v => `${Math.round(v)}`)}

              {sectionHdr('Transform')}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>{numSlider('offsetX', -50, 50, 0.5, 'Offset X', v => `${v.toFixed(1)}`)}</div>
                <div>{numSlider('offsetY', -50, 50, 0.5, 'Offset Y', v => `${v.toFixed(1)}`)}</div>
              </div>
              {numSlider('rotation', 0, 360, 1, 'Rotation', v => `${v.toFixed(0)}°`)}

              {sectionHdr('Blend & Opacity')}
              {numSlider('opacity', 0, 1, 0.01, 'Opacity', v => `${(v*100).toFixed(0)}%`)}
              {selectInput('Blend Mode', selectedLayer.blend,
                [['normal','Normal'],['add','Additive (Glow)'],['screen','Screen'],['multiply','Multiply']],
                v => updateLayer(selectedLayer.id, { blend: v as LayerBlend }))}

              {sectionHdr('Filters')}
              {numSlider('blur',       0,  60, 0.5, 'Blur / Softness', v => `${v.toFixed(1)}px`)}
              {numSlider('saturate',   0, 400, 1,   'Saturate',        v => `${v}%`)}
              {numSlider('contrast',   0, 300, 1,   'Contrast',        v => `${v}%`)}
              {numSlider('brightness', 0, 300, 1,   'Brightness',      v => `${v}%`)}
              {numSlider('hueShift',   0, 360, 1,   'Hue Shift',       v => `${v.toFixed(0)}°`)}

              {sectionHdr('Glow')}
              {numSlider('glow',     0, 100, 1,   'Glow Strength',  v => `${v}%`)}
              {numSlider('glowSize', 0.5, 8, 0.1, 'Glow Radius',    v => `×${v.toFixed(1)}`)}
              {row('Glow / Effect Colour', (
                <input type="color" value={selectedLayer.glowColor} onChange={e => updateLayer(selectedLayer.id, { glowColor: e.target.value })} style={{ width: '100%', height: '30px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
              ))}

              {sectionHdr('Bloom')}
              {numSlider('bloom',     0, 100,  1,   'Bloom Strength', v => `${v}%`)}
              {numSlider('bloomSize', 0.5, 10, 0.1, 'Bloom Radius',   v => `×${v.toFixed(1)}`)}

              {sectionHdr('Star Glow')}
              {numSlider('starGlow',       0, 100,  1,    'Star Glow',     v => `${v}%`)}
              {numSlider('starGlowArms',   2, 8,    1,    'Arms',          v => `${Math.round(v)}`)}
              {numSlider('starGlowLength', 0.2, 3,  0.05, 'Streak Length', v => `×${v.toFixed(2)}`)}

              {sectionHdr('Glitter')}
              {numSlider('glitter',     0, 100, 1,   'Glitter Density',  v => `${v}%`)}
              {numSlider('glitterSize', 0.5, 5, 0.1, 'Glitter Dot Size', v => `${v.toFixed(1)}px`)}

              {sectionHdr('Chromatic Aberration')}
              {numSlider('ca', 0, 20, 0.5, 'CA Shift', v => `${v.toFixed(1)}px`)}
            </>) : (
              <p style={{ color: '#555', textAlign: 'center', marginTop: '40px' }}>Select a layer to edit it.</p>
            )}
          </div>

          {/* RIGHT: preview + animation */}
          <div style={{ width: '296px', borderLeft: '1px solid #3b455c', display: 'flex', flexDirection: 'column', padding: '12px', overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ fontSize: '0.7rem', color: '#8a93a2', marginBottom: '6px', textTransform: 'uppercase' }}>Preview</div>

            <div style={{ width: '256px', height: '256px', alignSelf: 'center', background: previewBg !== 'transparent' ? bgBg[previewBg] : undefined, backgroundImage: previewBg === 'transparent' ? bgBg.transparent : undefined, borderRadius: '8px', border: '1px solid #3b455c', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <canvas ref={mainCanvasRef} width={256} height={256} style={{ width: '256px', height: '256px' }} />
            </div>

            <div style={{ display: 'flex', gap: '5px', marginTop: '8px', justifyContent: 'center' }}>
              {(['black','grey','transparent'] as const).map(bg => (
                <button key={bg} type="button" onClick={() => setPreviewBg(bg)}
                  style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '0.7rem', cursor: 'pointer', border: `1px solid ${previewBg===bg?'#4f6ef7':'#3b455c'}`, background: previewBg===bg?'#2d3d60':'#1e2840', color: '#c8d0e0' }}>
                  {bg}
                </button>
              ))}
            </div>

            {/* Thumbnail strip */}
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '0.7rem', color: '#8a93a2', marginBottom: '5px', textTransform: 'uppercase' }}>At particle sizes</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', flexWrap: 'wrap', background: '#0a0d18', borderRadius: '6px', padding: '10px' }}>
                {thumbs.map(({ sz, url }) => (
                  <div key={sz} style={{ textAlign: 'center' }}>
                    <img src={url} width={sz} height={sz} style={{ imageRendering: sz <= 8 ? 'pixelated' : 'auto', display: 'block' }} />
                    <span style={{ fontSize: '0.62rem', color: '#555' }}>{sz}px</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Animation config */}
            <div style={{ marginTop: '14px', borderTop: '1px solid #3b455c', paddingTop: '10px' }}>
              <div style={{ fontSize: '0.7rem', color: '#4f6ef7', textTransform: 'uppercase', marginBottom: '8px' }}>Animation</div>
              {row('Type', (
                <select value={anim.type} onChange={e => { setPlaying(false); setAnim(p => ({ ...p, type: e.target.value as AnimType })); }}
                  style={{ width: '100%', background: '#252f45', color: '#e2e8f0', border: '1px solid #3b455c', borderRadius: '4px', padding: '4px' }}>
                  <option value="none">None (still)</option>
                  <option value="spin">Spin</option>
                  <option value="pulse">Pulse (scale)</option>
                  <option value="flicker">Flicker (opacity)</option>
                  <option value="color-cycle">Color Cycle (hue)</option>
                  <option value="unfold">Unfold (grow-in)</option>
                </select>
              ))}
              {anim.type !== 'none' && (<>
                {row(`Frames: ${anim.frames}`, (
                  <input type="range" min={2} max={64} step={1} value={anim.frames} style={{ width: '100%' }}
                    onChange={e => setAnim(p => ({ ...p, frames: parseInt(e.target.value) }))} />
                ))}
                {row(`FPS: ${anim.fps}`, (
                  <input type="range" min={1} max={60} step={1} value={anim.fps} style={{ width: '100%' }}
                    onChange={e => setAnim(p => ({ ...p, fps: parseInt(e.target.value) }))} />
                ))}
                {row(`Frame: ${previewFrame + 1} / ${anim.frames}`, (
                  <input type="range" min={0} max={anim.frames - 1} step={1} value={previewFrame} style={{ width: '100%' }}
                    onChange={e => { setPlaying(false); setPreviewFrame(parseInt(e.target.value)); }} />
                ))}
                <button type="button" onClick={() => setPlaying(p => !p)}
                  style={{ width: '100%', background: playing ? '#c0392b' : '#27ae60', color: '#fff', border: 'none', borderRadius: '5px', padding: '6px', cursor: 'pointer', marginTop: '4px', fontSize: '0.82rem', fontWeight: 'bold' }}>
                  {playing ? '⏹ Stop' : '▶ Play Preview'}
                </button>
              </>)}
            </div>

            <hr style={{ width: '100%', borderColor: '#3b455c', margin: '12px 0' }} />

            <button type="button" onClick={handleExport}
              style={{ width: '100%', background: '#4f6ef7', color: '#fff', border: 'none', borderRadius: '6px', padding: '9px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem', marginBottom: '6px' }}>
              Use Still as Sprite ↗
            </button>
            {anim.type !== 'none' && (
              <button type="button" onClick={handleExportAnim}
                style={{ width: '100%', background: '#27ae60', color: '#fff', border: 'none', borderRadius: '6px', padding: '9px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem', marginBottom: '6px' }}>
                Use Animated Sequence ↗
              </button>
            )}
            <button type="button" onClick={handleDownloadSheet}
              style={{ width: '100%', background: 'transparent', color: '#8a93a2', border: '1px solid #3b455c', borderRadius: '6px', padding: '7px', cursor: 'pointer', fontSize: '0.8rem' }}>
              Download {anim.type !== 'none' ? 'Sprite Sheet' : 'PNG'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParticleCreator;
