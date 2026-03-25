/**
 * FlameGenerator.tsx
 * Standalone sprite-based flame generator with 3-D preview, still PNG export,
 * and animated PNG-sequence export for use as particle sprites.
 *
 * Architecture mirrors FireGenerator but uses the Scene3D sprite / tendril
 * system instead of a fragment-shader volume approach.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import JSZip from 'jszip';

// ─── Texture helpers ──────────────────────────────────────────────────────────

/** White radial gradient — colour applied via SpriteMaterial.color */
let _fgShapeTex: THREE.CanvasTexture | null = null;
function fgShape(): THREE.CanvasTexture {
  if (_fgShapeTex) return _fgShapeTex;
  const S = 128, H = S / 2;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  const gr = ctx.createRadialGradient(H, H, 0, H, H, H);
  gr.addColorStop(0.00, 'rgba(255,255,255,1.00)');
  gr.addColorStop(0.15, 'rgba(255,255,255,0.94)');
  gr.addColorStop(0.38, 'rgba(255,255,255,0.78)');
  gr.addColorStop(0.62, 'rgba(255,255,255,0.32)');
  gr.addColorStop(0.84, 'rgba(255,255,255,0.07)');
  gr.addColorStop(1.00, 'rgba(255,255,255,0.00)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, S, S);
  _fgShapeTex = new THREE.CanvasTexture(cv);
  return _fgShapeTex;
}

/** Tiny sharp dot for embers */
let _fgEmberTex: THREE.CanvasTexture | null = null;
function fgEmber(): THREE.CanvasTexture {
  if (_fgEmberTex) return _fgEmberTex;
  const S = 64, H = S / 2;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  const gr = ctx.createRadialGradient(H, H, 0, H, H, H);
  gr.addColorStop(0.00, 'rgba(255,255,255,1.00)');
  gr.addColorStop(0.20, 'rgba(255,255,255,0.90)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.50)');
  gr.addColorStop(0.75, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1.00, 'rgba(255,255,255,0.00)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, S, S);
  _fgEmberTex = new THREE.CanvasTexture(cv);
  return _fgEmberTex;
}

// ─── Polyline sampler ──────────────────────────────────────────────────────────

function fgSample(
  pts: { x: number; y: number; z?: number }[],
  spacing: number,
): { x: number; y: number; z: number }[] {
  if (pts.length < 2) return [{ x: pts[0].x, y: pts[0].y, z: pts[0].z ?? 0 }];
  const out: { x: number; y: number; z: number }[] = [{ x: pts[0].x, y: pts[0].y, z: pts[0].z ?? 0 }];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const az = pts[i-1].z ?? 0, bz = pts[i].z ?? 0;
    const dx = pts[i].x-pts[i-1].x, dy = pts[i].y-pts[i-1].y, dz = bz-az;
    const len = Math.sqrt(dx*dx+dy*dy+dz*dz);
    if (len < 1e-6) continue;
    let d = spacing - acc;
    while (d <= len) {
      const u = d/len;
      out.push({ x: pts[i-1].x+dx*u, y: pts[i-1].y+dy*u, z: az+dz*u });
      d += spacing;
    }
    acc = len-(d-spacing);
  }
  out.push({ x: pts[pts.length-1].x, y: pts[pts.length-1].y, z: pts[pts.length-1].z ?? 0 });
  return out;
}

const h2n = (s: string) => parseInt(s.replace('#',''), 16);
const n2c = (n: number) => new THREE.Color(((n>>16)&0xff)/255, ((n>>8)&0xff)/255, (n&0xff)/255);

// ─── Seamless-loop LCM helpers ───────────────────────────────────────────

function fGcd(a: number, b: number): number { return b < 1e-6 ? a : fGcd(b, a % b); }
function fLcm(a: number, b: number): number { return a / fGcd(a, b) * b; }

/** Returns a loop duration that is an integer multiple of every tendril lifespan. */
function computeLoopDur(fp: FP, maxSecs = 8): number {
  const speed = Math.max(0.1, fp.speed);
  const PREC  = 100; // 0.01 s precision
  let lcmInt  = 1;
  for (let ti = 0; ti < fp.numTendrils; ti++) {
    const ss   = ti * 2.399963;
    const minL = 1.2 / speed, maxL = 3.8 / speed;
    const life = minL + Math.abs(Math.sin(ss*13.7+0.5)) * (maxL - minL);
    const intL = Math.max(1, Math.round(life * PREC));
    lcmInt = Math.round(fLcm(lcmInt, intL));
    if (lcmInt / PREC > maxSecs) { lcmInt = Math.round(maxSecs * PREC); break; }
  }
  return Math.min(lcmInt / PREC, maxSecs);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FlameGeneratorProps {
  onExportToParticleSystem?: (urls: string[], fps: number) => void;
  onAttachToEmitter?: (urls: string[]) => void;
  onSendToShape?: (url: string) => void;
  onSendToPaint?: (url: string) => void;
}

interface FP {
  coreColor:        string;
  coreColorTop:     string;
  glowColor:        string;
  glowColorTop:     string;
  height:           number;
  width:            number;
  numTendrils:      number;
  turbulence:       number;
  speed:            number;
  thermalDraft:     number;
  coreWidth:        number;
  coreBlur:         number;
  coreWidthNoise:   number;  // 0 = steady core, >1 = wild fractal width variation
  glowWidth:        number;
  density:          number;
  glowFalloff:      number;
  flickerIntensity: number;
  flickerType:      'smooth' | 'fractal' | 'turbulent';
  emberCount:       number;
  emberSize:        number;
}

interface Preset { name: string; fp: FP; }

const DEFAULT_FP: FP = {
  coreColor:        '#ffff88',
  coreColorTop:     '#ffaa00',
  glowColor:        '#ff3300',
  glowColorTop:     '#880000',
  height:           80,
  width:            30,
  numTendrils:      5,
  turbulence:       0.55,
  speed:            1.4,
  thermalDraft:     0.45,
  coreWidth:        6,
  coreBlur:         0.2,
  coreWidthNoise:   0.45,
  glowWidth:        16,
  density:          1.6,
  glowFalloff:      1.2,
  flickerIntensity: 0.45,
  flickerType:      'fractal',
  emberCount:       20,
  emberSize:        4,
};

const LS_KEY = 'flameGeneratorPresets';
function loadPresets(): Preset[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]'); } catch { return []; }
}
function savePresets(p: Preset[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

// ─── Component ───────────────────────────────────────────────────────────────

export const FlameGenerator: React.FC<FlameGeneratorProps> = ({ onExportToParticleSystem, onAttachToEmitter, onSendToShape, onSendToPaint }) => {
  const [fp, setFp] = useState<FP>(DEFAULT_FP);
  const fpRef = useRef<FP>(fp);
  useEffect(() => { fpRef.current = fp; }, [fp]);

  const [presets,     setPresets]     = useState<Preset[]>(loadPresets);
  const [presetName,  setPresetName]  = useState('');

  const handleSavePreset = () => {
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const next = [...presets.filter(p => p.name !== name), { name, fp: { ...fpRef.current } }];
    setPresets(next); savePresets(next); setPresetName('');
  };
  const handleLoadPreset  = (p: Preset) => { setFp({ ...DEFAULT_FP, ...p.fp }); };
  const handleDeletePreset = (name: string) => {
    const next = presets.filter(p => p.name !== name);
    setPresets(next); savePresets(next);
  };

  const [exportRes,      setExportRes]      = useState(256);
  const [exportFrames,   setExportFrames]   = useState(24);
  const [exportFps,      setExportFps]      = useState(24);
  const [isExporting,    setIsExporting]    = useState(false);
  const [exportProg,     setExportProg]     = useState(0); // 0-100
  const [flameMatteChoke, setFlameMatteChoke] = useState(0); // -50…+50
  const [flameEdgeEnhance,    setFlameEdgeEnhance]    = useState(0); // 0–100
  const [flameFractalDistort, setFlameFractalDistort] = useState(0); // 0–100
  const [bgColor,        setBgColor]        = useState('#080808');
  const bgColorRef = useRef('#080808');
  useEffect(() => {
    bgColorRef.current = bgColor;
    if (rendererRef.current) rendererRef.current.setClearColor(new THREE.Color(bgColor), 1);
  }, [bgColor]);

  // Convert a black-background additive-blend render to transparent PNG by deriving alpha from luminance
  const deriveAlphaFromLuma = (url: string): Promise<string> =>
    new Promise<string>(resolve => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const W = cv.width, H = cv.height;
        const iData = ctx.getImageData(0, 0, W, H);
        const d = iData.data;
        for (let i = 0; i < W * H; i++) {
          const r = d[i*4], g = d[i*4+1], b = d[i*4+2];
          // Perceptual luminance used as alpha
          d[i*4+3] = Math.round(0.299*r + 0.587*g + 0.114*b);
        }
        ctx.putImageData(iData, 0, 0);
        resolve(cv.toDataURL('image/png'));
      };
      img.src = url;
    });

  // Apply morphological alpha erosion (choke<0) or dilation (spread>0) to a PNG data URL
  const applyMatteChoke = (url: string, choke: number): Promise<string> =>
    new Promise<string>(resolve => {
      if (choke === 0) { resolve(url); return; }
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const W = cv.width, H = cv.height;
        const iData = ctx.getImageData(0, 0, W, H);
        const src = new Uint8ClampedArray(iData.data);
        const d = iData.data;
        const radius = Math.max(1, Math.min(15, Math.round(Math.abs(choke) * 0.3)));
        const isChoke = choke < 0;
        const tmp = new Uint8ClampedArray(W * H);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            let val = isChoke ? 255 : 0;
            for (let dx = -radius; dx <= radius; dx++) {
              const nx = Math.max(0, Math.min(W - 1, x + dx));
              const a = src[(y * W + nx) * 4 + 3];
              val = isChoke ? Math.min(val, a) : Math.max(val, a);
            }
            tmp[y * W + x] = val;
          }
        }
        for (let x = 0; x < W; x++) {
          for (let y = 0; y < H; y++) {
            let val = isChoke ? 255 : 0;
            for (let dy = -radius; dy <= radius; dy++) {
              const ny = Math.max(0, Math.min(H - 1, y + dy));
              val = isChoke ? Math.min(val, tmp[ny * W + x]) : Math.max(val, tmp[ny * W + x]);
            }
            d[(y * W + x) * 4 + 3] = val;
          }
        }
        ctx.putImageData(iData, 0, 0);
        resolve(cv.toDataURL('image/png'));
      };
      img.src = url;
    });

  // Unsharp mask edge enhancement: sharp = original + amount*(original - blurred)
  const applyEdgeEnhance = (url: string, strength100: number): Promise<string> =>
    new Promise<string>(resolve => {
      if (strength100 === 0) { resolve(url); return; }
      const img = new Image();
      img.onload = () => {
        const W = img.width, H = img.height;
        // Canvas A: original pixels
        const cvA = document.createElement('canvas');
        cvA.width = W; cvA.height = H;
        const ctxA = cvA.getContext('2d')!;
        ctxA.drawImage(img, 0, 0);
        const orig = ctxA.getImageData(0, 0, W, H);

        // Canvas B: blurred version (use CSS filter on a temp canvas)
        const blurPx = 1 + (strength100 / 100) * 3; // 1–4 px blur
        const cvB = document.createElement('canvas');
        cvB.width = W; cvB.height = H;
        const ctxB = cvB.getContext('2d')!;
        ctxB.filter = `blur(${blurPx.toFixed(1)}px)`;
        ctxB.drawImage(img, 0, 0);
        const blurred = ctxB.getImageData(0, 0, W, H);

        // Unsharp mask: result = orig + amount * (orig - blurred)
        const amount = (strength100 / 100) * 2.5;
        const out = ctxA.getImageData(0, 0, W, H);
        const o = orig.data, b = blurred.data, d = out.data;
        for (let i = 0; i < o.length; i += 4) {
          d[i]   = Math.max(0, Math.min(255, o[i]   + amount * (o[i]   - b[i])));
          d[i+1] = Math.max(0, Math.min(255, o[i+1] + amount * (o[i+1] - b[i+1])));
          d[i+2] = Math.max(0, Math.min(255, o[i+2] + amount * (o[i+2] - b[i+2])));
          d[i+3] = o[i+3]; // preserve alpha
        }
        ctxA.putImageData(out, 0, 0);
        resolve(cvA.toDataURL('image/png'));
      };
      img.src = url;
    });

  // Fractal distort: hash-based value noise fBm domain-warp, bilinear sampled
  const applyFractalDistort = (url: string, strength100: number): Promise<string> =>
    new Promise<string>(resolve => {
      if (strength100 === 0) { resolve(url); return; }
      const img = new Image();
      img.onload = () => {
        const W = img.width, H = img.height;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const amp = (strength100 / 100) * W * 0.45;
        const src = ctx.getImageData(0, 0, W, H);
        const s = src.data;
        const out = ctx.createImageData(W, H);
        const d = out.data;
        const hash = (n: number) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
        const vnoise = (x: number, y: number) => {
          const ix = Math.floor(x), iy = Math.floor(y);
          const fx = x-ix, fy = y-iy;
          const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy);
          const a = hash(ix + iy*157), b = hash(ix+1 + iy*157);
          const c = hash(ix + (iy+1)*157), dd = hash(ix+1 + (iy+1)*157);
          return a + (b-a)*ux + (c-a)*uy + (b-a+a-b-c+dd)*ux*uy;
        };
        const fbm = (ox: number, oy: number, seedX: number, seedY: number) => {
          let v = 0, a = 0.5, f = 3.0;
          for (let o = 0; o < 4; o++) {
            v += (vnoise(ox/W*f + seedX + o*31.7, oy/H*f + seedY + o*17.3) * 2 - 1) * a;
            a *= 0.5; f *= 2.0;
          }
          return v;
        };
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const sx = x + fbm(x, y, 0.0, 4.2) * amp;
            const sy = y + fbm(x, y, 8.3, 1.7) * amp;
            const x0 = Math.max(0, Math.min(W-1, Math.floor(sx)));
            const y0 = Math.max(0, Math.min(H-1, Math.floor(sy)));
            const x1 = Math.min(W-1, x0+1), y1 = Math.min(H-1, y0+1);
            const tx = sx-x0, ty = sy-y0;
            const i00=(y0*W+x0)*4, i10=(y0*W+x1)*4;
            const i01=(y1*W+x0)*4, i11=(y1*W+x1)*4;
            const di=(y*W+x)*4;
            for (let c = 0; c < 4; c++)
              d[di+c] = Math.round(s[i00+c]*(1-tx)*(1-ty)+s[i10+c]*tx*(1-ty)+s[i01+c]*(1-tx)*ty+s[i11+c]*tx*ty);
          }
        }
        ctx.putImageData(out, 0, 0);
        resolve(cv.toDataURL('image/png'));
      };
      img.src = url;
    });

  const mountRef     = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef     = useRef<THREE.Scene | null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef  = useRef<OrbitControls | null>(null);
  const groupRef     = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number>(0);
  const loopActiveRef = useRef(true);

  // ── Three.js scene init ──────────────────────────────────────────────────
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const W = Math.max(container.clientWidth,  1);
    const H = Math.max(container.clientHeight, 1);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(new THREE.Color(bgColorRef.current), 1);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 10000);
    const initH = DEFAULT_FP.height;
    camera.position.set(0, initH * 0.45, initH * 2.2);
    camera.lookAt(0, initH * 0.35, 0);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, initH * 0.35, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.update();
    controlsRef.current = controls;

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    const ro = new ResizeObserver(() => {
      const w = Math.max(container.clientWidth,  1);
      const h = Math.max(container.clientHeight, 1);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    return () => {
      loopActiveRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
      ro.disconnect();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  // ── Sprite-chain builder (flame tendril rendering) ───────────────────────
  const buildSprites = useCallback((fAnimT: number, seamless = false) => {
    const g = groupRef.current;
    if (!g) return;

    // Flush previous frame's sprites
    while (g.children.length > 0) {
      const c = g.children[0] as any;
      c.geometry?.dispose();
      (c.material as THREE.Material)?.dispose();
      g.remove(c);
    }

    const f             = fpRef.current;
    const flameHeight   = f.height;
    const flameWidth    = f.width;
    const numTendrils   = f.numTendrils;
    const turbulence    = f.turbulence;
    const speed         = f.speed;
    const coreW         = Math.max(0.5, f.coreWidth);
    const glowW         = Math.max(1, f.glowWidth);
    const densityF      = Math.max(0.5, Math.min(4, f.density));
    const flickerIntensF = Math.max(0, Math.min(1, f.flickerIntensity));
    const flickerTypeF  = f.flickerType;
    const coreBlurF     = Math.max(0, Math.min(1, f.coreBlur));
    const glowFalloffF  = Math.max(0, f.glowFalloff);
    const thermalDraft  = Math.max(0, Math.min(1, f.thermalDraft));
    const emberCount    = Math.max(0, Math.round(f.emberCount));
    const emberSize     = Math.max(1, f.emberSize);

    // Shared white sprite texture (colour applied via mat.color)
    const shapeTex = fgShape();
    const emberTex = fgEmber();

    // Color endpoints
    const coreColorA = n2c(h2n(f.coreColor));
    const coreColorB = n2c(h2n(f.coreColorTop));
    const glowColorA = n2c(h2n(f.glowColor));
    const glowColorB = n2c(h2n(f.glowColorTop));

    // Inline fbm helper
    const fbm = (phase: number, octs = 4): number => {
      let v = 0, a = 1.0, fr = 1.0, nm = 0;
      if (flickerTypeF === 'smooth') {
        for (let o = 0; o < octs; o++) { v += a * (0.5 + 0.5 * Math.sin(phase * fr + o * 1.3)); nm += a; fr *= 2.07; a *= 0.5; }
      } else if (flickerTypeF === 'turbulent') {
        for (let o = 0; o < octs; o++) { v += a * Math.abs(Math.sin(phase * fr + o * 1.3)); nm += a; fr *= 2.07; a *= 0.5; }
      } else {
        for (let o = 0; o < octs; o++) { v += a * (0.5 + 0.5 * Math.sin(phase * fr + o * 1.3)); nm += a; fr *= 2.07; a *= 0.5; }
      }
      return v / nm;
    };

    /** Add a sprite chain along `pts` with vertical color gradient */
    const addChain = (
      pts:       { x: number; y: number; z?: number }[],
      colorA:    THREE.Color,
      colorB:    THREE.Color,
      sprSz:     number,
      opacity:   number,
      zOff:      number,
      noiseSeed: number,
      growFront: number,
      sizeNoiseMul = 0.45,
    ) => {
      const spacing = Math.max(0.2, (sprSz * 0.35) / densityF);
      const samples = fgSample(pts, spacing);
      const N       = samples.length;
      const baseOpa = opacity / Math.sqrt(densityF);

      samples.forEach((pt, i) => {
        const t         = N > 1 ? i / (N - 1) : 0;
        const growMask  = Math.max(0, Math.min(1, (growFront - t) / 0.14 + 1));
        const taperStart = 0.5;
        const taper     = t <= taperStart
          ? 1.0
          : Math.sqrt(Math.max(0, 1.0 - (t - taperStart) / (1.0 - taperStart + 1e-9))) * 0.96 + 0.04;

        const flicker   = (1.0 - flickerIntensF) + flickerIntensF * fbm(noiseSeed + t * 5.1 - fAnimT * speed * 2.3);
        const sizeScale = 1.0 + turbulence * (fbm(noiseSeed * 1.3 + t * 4.7 - fAnimT * speed * 1.9, 3) * 2.0 - 1.0) * sizeNoiseMul;
        const vertGrad  = glowFalloffF > 0 ? Math.pow(Math.max(0, 1.0 - t), glowFalloffF) : 1.0;

        const mat = new THREE.SpriteMaterial({
          map: shapeTex, transparent: true,
          opacity:  Math.max(0, baseOpa * taper * flicker * growMask * vertGrad),
          blending: THREE.AdditiveBlending,
          depthTest: false, depthWrite: false,
        });
        mat.color.lerpColors(colorA, colorB, t);
        const sp = new THREE.Sprite(mat);
        sp.position.set(pt.x, pt.y, (pt.z ?? 0) + zOff);
        sp.scale.set(sprSz * taper * sizeScale, sprSz * taper * sizeScale, 1);
        g.add(sp);
      });
    };

    // Collect tendril base positions so embers can spawn from each one
    const tendrilBaseX: number[] = [];
    const tendrilBaseZ: number[] = [];

    const FLAME_PTS = 10;
    for (let ti = 0; ti < numTendrils; ti++) {
      const slotSeed    = ti * 2.399963;
      const minLife     = 1.2 / Math.max(0.1, speed);
      const maxLife     = 3.8 / Math.max(0.1, speed);
      const pr1         = Math.abs(Math.sin(slotSeed * 13.7 + 0.5));
      const lifespan    = minLife + pr1 * (maxLife - minLife);
      const birthOffset = Math.abs(Math.sin(slotSeed * 7.3 + 1.1)) * lifespan;
      const age01       = ((fAnimT + birthOffset) % lifespan) / lifespan;

      const FADE_IN = 0.30;
      let lifeFade: number, growFront: number;
      if (age01 < FADE_IN) {
        growFront = age01 / FADE_IN; lifeFade = 1.0;
      } else if (age01 < 0.75) {
        growFront = 1.0; lifeFade = 1.0;
      } else {
        growFront = 1.0; lifeFade = 1.0 - (age01 - 0.75) / 0.25;
      }
      lifeFade = Math.max(0, lifeFade);

      const DETACH_START  = 0.65;
      const detachT       = age01 < DETACH_START ? 0 : (age01 - DETACH_START) / (1.0 - DETACH_START);
      const riseOffset    = Math.pow(detachT, 1.3) * flameHeight * 0.55;
      const ageScale      = 1.0 - detachT * 0.70;
      const deformMul     = 1.0 + detachT * 2.2;
      const baseWidthMul  = Math.max(0.05, 1.0 - detachT * 0.9);
      const cycleIdx      = Math.floor((fAnimT + birthOffset) / lifespan);
      const tendrilSeed   = seamless ? slotSeed : slotSeed + cycleIdx * 1.618;
      const spreadAngle   = (numTendrils > 1 ? ti / (numTendrils - 1) : 0.5) * Math.PI * 2
                          + (seamless ? 0 : cycleIdx * 0.97);

      // Thermal draft: centre tendrils rise higher + are narrower at base
      const axisProx      = 1.0 - Math.abs(Math.sin(slotSeed * 5.7));           // 0=outer, 1=centre
      const thermalMul    = 1.0 + thermalDraft * axisProx * 0.7;
      // Per-tendril turbulent height variation via fbm
      const hNoise        = fbm(slotSeed * 4.1 - fAnimT * speed * 0.25);
      const heightMul     = thermalMul * (1.0 + turbulence * (hNoise * 2.0 - 1.0) * 0.35);
      const activeHeight  = flameHeight * ageScale * (0.75 + 0.25 * lifeFade) * heightMul;
      // Outer ring radius, thermal centre tendrils sit closer to axis
      const baseR         = flameWidth * 0.35 * (numTendrils > 1 ? 1 : 0)
                          * (1.0 - thermalDraft * axisProx * 0.5);
      const baseOffX      = Math.cos(spreadAngle + slotSeed) * baseR;
      const baseOffZ      = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;
      tendrilBaseX.push(baseOffX);
      tendrilBaseZ.push(baseOffZ);

      const pts: { x: number; y: number; z: number }[] = [];
      for (let pi = 0; pi < FLAME_PTS; pi++) {
        const yNorm      = pi / (FLAME_PTS - 1);
        const y          = riseOffset + yNorm * activeHeight;
        const widthEnv   = Math.pow(yNorm, 0.65) * flameWidth * 0.5 * ageScale * baseWidthMul;
        const baseSpread = (1.0 - yNorm) * baseWidthMul;
        const noiseT     = tendrilSeed + yNorm * 3.0 - fAnimT * speed;
        const dx = (Math.sin(noiseT * 1.3 + tendrilSeed)      * 1.0
                  + Math.cos(noiseT * 2.1 + tendrilSeed * 1.7) * 0.4) * turbulence * widthEnv * deformMul;
        const dz = Math.cos(noiseT * 0.9 + tendrilSeed * 2.3) * turbulence * widthEnv * 0.6 * deformMul;
        pts.push({ x: baseOffX * baseSpread + dx, y, z: baseOffZ * baseSpread + dz });
      }

      const haloD           = glowW * 4.0 * ageScale;
      const glowD           = glowW * 2.0 * ageScale;
      const coreBlurSizeMul = 1.0 + coreBlurF * 2.6;
      const coreBlurOpaMul  = 1.0 / Math.sqrt(coreBlurSizeMul);
      const coreD           = coreW * 2.2 * coreBlurSizeMul * ageScale;
      const coreWidthNoiseF = Math.max(0, f.coreWidthNoise);
      addChain(pts, glowColorA, glowColorB, haloD, 0.09 * lifeFade, -0.1, tendrilSeed,       growFront);
      addChain(pts, glowColorA, glowColorB, glowD, 0.28 * lifeFade,  0.0, tendrilSeed + 1.1, growFront);
      addChain(pts, coreColorA, coreColorB, coreD, 0.60 * lifeFade * coreBlurOpaMul, 0.1, tendrilSeed + 2.2, growFront, coreWidthNoiseF);
    }

    // ── Embers ──────────────────────────────────────────────────────────────
    const emberLife  = 2.5 / Math.max(0.1, speed);
    const emberC1    = n2c(h2n(f.coreColor));
    const emberC2    = n2c(h2n(f.glowColorTop));
    const nT = tendrilBaseX.length || 1;
    for (let ei = 0; ei < emberCount; ei++) {
      const eseed      = ei * 3.7 + 0.31;
      const eBirth     = Math.abs(Math.sin(eseed * 7.3)) * emberLife;
      const eAge01     = ((fAnimT + eBirth) % emberLife) / emberLife;
      // Pin this ember to the base of one of the tendrils
      const ti         = ei % nT;
      const startX     = tendrilBaseX[ti] + Math.sin(eseed * 5.1) * flameWidth * 0.08;
      const startZ     = tendrilBaseZ[ti] + Math.cos(eseed * 3.1) * flameWidth * 0.05;
      const noiseT     = eseed + eAge01 * 3.0 - fAnimT * speed;
      const driftX     = (Math.sin(noiseT * 1.3) * 0.6 + Math.cos(noiseT * 2.1 + eseed) * 0.4)
                       * turbulence * flameWidth * 0.4 * eAge01;
      const eX         = startX + driftX;
      const eY         = flameHeight * (0.20 + eAge01 * 1.70);
      const eZ         = startZ;
      const eOpa       = eAge01 < 0.1 ? eAge01 / 0.1 : eAge01 > 0.8 ? (1.0 - eAge01) / 0.2 : 1.0;
      const eSz        = emberSize * (1.0 - eAge01 * 0.5);
      const eMat       = new THREE.SpriteMaterial({
        map: emberTex, transparent: true,
        opacity:  Math.max(0, eOpa * 0.85),
        blending: THREE.AdditiveBlending,
        depthTest: false, depthWrite: false,
      });
      eMat.color.lerpColors(emberC1, emberC2, eAge01);
      const esp = new THREE.Sprite(eMat);
      esp.position.set(eX, eY, eZ);
      esp.scale.set(eSz, eSz, 1);
      g.add(esp);
    }
  }, []);

  // ── rAF loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    loopActiveRef.current = true;
    const loop = () => {
      if (!loopActiveRef.current) return;
      animFrameRef.current = requestAnimationFrame(loop);
      buildSprites(Date.now() / 1000.0);
      controlsRef.current?.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    loop();
    return () => {
      loopActiveRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [buildSprites]);

  // ── Render N frames to data-URL array (front-facing ortho camera) ─────────
  const renderFrames = useCallback(async (
    numFrames: number,
    res: number,
    onProgress?: (pct: number) => void,
  ): Promise<string[]> => {
    const renderer = rendererRef.current;
    const scene    = sceneRef.current;
    if (!renderer || !scene) return [];

    const f = fpRef.current;

    // Pause live loop
    loopActiveRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
    await new Promise(r => setTimeout(r, 24)); // let rAF drain

    // Export camera — orthographic, front-facing, square crop around flame
    const viewSize = Math.max(f.width * 2.0, f.height) * 1.25;
    const half     = viewSize / 2;
    const centerY  = f.height * 0.42;
    const exportCam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 10000);
    exportCam.position.set(0, centerY, viewSize * 3);
    exportCam.lookAt(0, centerY, 0);

    // Render target at export resolution
    const rt = new THREE.WebGLRenderTarget(res, res, {
      format: THREE.RGBAFormat,
      type:   THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // Loop duration: LCM of all tendril lifespans → perfect seamless loop
    const loopDur = computeLoopDur(f);

    const urls: string[] = [];
    const pixels   = new Uint8Array(res * res * 4);
    const tmpCv    = document.createElement('canvas');
    tmpCv.width    = res; tmpCv.height = res;
    const tmpCtx   = tmpCv.getContext('2d')!;

    for (let fi = 0; fi < numFrames; fi++) {
      const t = loopDur * (fi / Math.max(1, numFrames));
      buildSprites(t, true /* seamless */);
      renderer.setRenderTarget(rt);
      renderer.setClearColor(new THREE.Color(bgColorRef.current), 1);
      renderer.clear();
      renderer.render(scene, exportCam);
      renderer.setRenderTarget(null);

      renderer.readRenderTargetPixels(rt, 0, 0, res, res, pixels);

      // Flip Y (WebGL bottom-left origin → canvas top-left)
      const imgData = tmpCtx.createImageData(res, res);
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const src  = ((res - 1 - y) * res + x) * 4;
          const dst  = (y * res + x) * 4;
          imgData.data[dst]   = pixels[src];
          imgData.data[dst+1] = pixels[src+1];
          imgData.data[dst+2] = pixels[src+2];
          imgData.data[dst+3] = pixels[src+3];
        }
      }
      tmpCtx.putImageData(imgData, 0, 0);
      urls.push(tmpCv.toDataURL('image/png'));
      onProgress?.((fi + 1) / numFrames * 100);
      // Yield to keep UI from freezing on large exports
      if (fi % 4 === 3) await new Promise(r => setTimeout(r));
    }

    rt.dispose();

    // Resume live loop
    loopActiveRef.current = true;
    const loop = () => {
      if (!loopActiveRef.current) return;
      animFrameRef.current = requestAnimationFrame(loop);
      buildSprites(Date.now() / 1000.0);
      controlsRef.current?.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    loop();

    return urls;
  }, [buildSprites]);

  // ── Export: single still PNG ──────────────────────────────────────────────
  const handleExportStill = useCallback(async () => {
    setIsExporting(true);
    setExportProg(0);
    const urls = await renderFrames(1, exportRes, p => setExportProg(p));
    setIsExporting(false);
    if (!urls.length) return;
    if (onAttachToEmitter) {
      onAttachToEmitter(urls);
    } else {
      const a = document.createElement('a');
      a.href     = urls[0];
      a.download = 'flame_sprite.png';
      a.click();
    }
  }, [exportRes, onAttachToEmitter, renderFrames]);

  // ── Export: PNG sequence → zip or callback ────────────────────────────────
  const handleExportSequence = useCallback(async () => {
    setIsExporting(true);
    setExportProg(0);
    const urls = await renderFrames(exportFrames, exportRes, p => setExportProg(p));
    setIsExporting(false);
    if (!urls.length) return;
    if (onExportToParticleSystem) {
      onExportToParticleSystem(urls, exportFps);
    } else {
      const zip = new JSZip();
      urls.forEach((url, i) => {
        const b64 = url.split(',')[1];
        zip.file(`flame_${String(i).padStart(4, '0')}.png`, b64, { base64: true });
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = 'flame_sequence.zip';
      a.click();
    }
  }, [exportFrames, exportRes, exportFps, onExportToParticleSystem, renderFrames]);

  // ── Reset camera ─────────────────────────────────────────────────────────
  const handleResetCamera = useCallback(() => {
    const cam   = cameraRef.current;
    const ctrl  = controlsRef.current;
    if (!cam || !ctrl) return;
    const h = fpRef.current.height;
    cam.position.set(0, h * 0.45, h * 2.2);
    ctrl.target.set(0, h * 0.35, 0);
    ctrl.update();
  }, []);

  // ── Property updater ─────────────────────────────────────────────────────
  const upd = <K extends keyof FP>(k: K, v: FP[K]) => setFp(p => ({ ...p, [k]: v }));

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    label:  { fontSize: '0.74rem', color: '#8a93a2', marginBottom: '2px', display: 'block' } as React.CSSProperties,
    row:    { marginBottom: '8px' } as React.CSSProperties,
    input:  { width: '100%', accentColor: '#4f6ef7' } as React.CSSProperties,
    sec:    { fontSize: '0.68rem', color: '#4f6ef7', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #2a3450', marginBottom: '6px', paddingBottom: '2px', marginTop: '10px' },
    btn:    (c: string) => ({ background: c, color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 10px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 'bold' as const }),
  };
  const lbl = (txt: string, val: string | number) => (
    <label style={S.label}>{txt}: <strong style={{ color: '#c8d0e0' }}>{val}</strong></label>
  );

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: '300px', background: '#141a28' }}>

      {/* ── Left: properties panel ─────────────────────────────────────── */}
      <div style={{ width: '230px', flexShrink: 0, overflowY: 'auto', padding: '10px 12px', borderRight: '1px solid #2a3450', background: '#141a28' }}>

        {/* Presets */}
        <div style={S.sec}>Presets</div>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
          <input
            type="text"
            placeholder="preset name…"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            style={{ flex: 1, background: '#1e2840', border: '1px solid #3b455c', color: '#c8d0e0',
                     borderRadius: '4px', padding: '3px 6px', fontSize: '0.72rem' }}
          />
          <button type="button" onClick={handleSavePreset} style={S.btn('#4f6ef7')}>Save</button>
        </div>
        {presets.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            {presets.map(p => (
              <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                <button type="button" onClick={() => handleLoadPreset(p)}
                  style={{ flex: 1, background: '#1e2840', border: '1px solid #3b455c', color: '#c8d0e0',
                           borderRadius: '4px', padding: '2px 6px', fontSize: '0.72rem', cursor: 'pointer',
                           textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {p.name}
                </button>
                <button type="button" onClick={() => handleDeletePreset(p.name)}
                  style={{ background: '#3b2020', border: 'none', color: '#aa5555', borderRadius: '4px',
                           padding: '2px 5px', fontSize: '0.72rem', cursor: 'pointer' }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Colors */}
        <div style={S.sec}>Colors</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={S.label}>Background</label>
            <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
              style={{ width: '100%', height: '28px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
          </div>
          <div>
            <label style={S.label}>Core Base</label>
            <input type="color" value={fp.coreColor} onChange={e => upd('coreColor', e.target.value)}
              style={{ width: '100%', height: '28px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
          </div>
          <div>
            <label style={S.label}>Core Tip</label>
            <input type="color" value={fp.coreColorTop} onChange={e => upd('coreColorTop', e.target.value)}
              style={{ width: '100%', height: '28px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
          </div>
          <div>
            <label style={S.label}>Glow Base</label>
            <input type="color" value={fp.glowColor} onChange={e => upd('glowColor', e.target.value)}
              style={{ width: '100%', height: '28px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
          </div>
          <div>
            <label style={S.label}>Glow Tip</label>
            <input type="color" value={fp.glowColorTop} onChange={e => upd('glowColorTop', e.target.value)}
              style={{ width: '100%', height: '28px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
          </div>
        </div>

        {/* Shape */}
        <div style={S.sec}>Shape</div>
        <div style={S.row}>{lbl('Height', fp.height)}<input type="range" style={S.input} min={10} max={200} step={1}  value={fp.height}      onChange={e => upd('height',      Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Width', fp.width)}<input  type="range" style={S.input} min={4}  max={120} step={1}  value={fp.width}       onChange={e => upd('width',       Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Tendrils', fp.numTendrils)}<input type="range" style={S.input} min={1} max={20} step={1} value={fp.numTendrils} onChange={e => upd('numTendrils', Number(e.target.value))} /></div>

        {/* Motion */}
        <div style={S.sec}>Motion</div>
        <div style={S.row}>{lbl('Speed', fp.speed.toFixed(2))}<input type="range" style={S.input} min={0.1} max={5} step={0.05} value={fp.speed}      onChange={e => upd('speed',      Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Turbulence', fp.turbulence.toFixed(2))}<input type="range" style={S.input} min={0} max={1} step={0.01} value={fp.turbulence} onChange={e => upd('turbulence', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Thermal Draft', fp.thermalDraft.toFixed(2))}<input type="range" style={S.input} min={0} max={1} step={0.01} value={fp.thermalDraft} onChange={e => upd('thermalDraft', Number(e.target.value))} /></div>

        {/* Flicker */}
        <div style={S.sec}>Flicker</div>
        <div style={S.row}>
          <label style={S.label}>Type</label>
          <select value={fp.flickerType} onChange={e => upd('flickerType', e.target.value as FP['flickerType'])}
            style={{ width: '100%', background: '#1e2840', border: '1px solid #3b455c', color: '#c8d0e0', borderRadius: '4px', padding: '3px 6px', fontSize: '0.74rem' }}>
            <option value="smooth">Smooth</option>
            <option value="fractal">Fractal (natural)</option>
            <option value="turbulent">Turbulent</option>
          </select>
        </div>
        <div style={S.row}>{lbl('Intensity', `${(fp.flickerIntensity * 100).toFixed(0)}%`)}<input type="range" style={S.input} min={0} max={1} step={0.01} value={fp.flickerIntensity} onChange={e => upd('flickerIntensity', Number(e.target.value))} /></div>

        {/* Glow */}
        <div style={S.sec}>Glow</div>
        <div style={S.row}>{lbl('Core Width', fp.coreWidth)}<input  type="range" style={S.input} min={1}  max={30} step={0.5}  value={fp.coreWidth}   onChange={e => upd('coreWidth',   Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Core Blur', `${(fp.coreBlur * 100).toFixed(0)}%`)}<input type="range" style={S.input} min={0} max={1} step={0.01} value={fp.coreBlur} onChange={e => upd('coreBlur', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Core Width Noise', fp.coreWidthNoise.toFixed(2))}<input type="range" style={S.input} min={0} max={3} step={0.05} value={fp.coreWidthNoise} onChange={e => upd('coreWidthNoise', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Glow Width', fp.glowWidth)}<input  type="range" style={S.input} min={2}  max={60} step={1}    value={fp.glowWidth}   onChange={e => upd('glowWidth',   Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Vertical Falloff', fp.glowFalloff.toFixed(2))}<input type="range" style={S.input} min={0} max={4} step={0.05} value={fp.glowFalloff} onChange={e => upd('glowFalloff', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Density', fp.density.toFixed(1))}<input type="range" style={S.input} min={0.5} max={4} step={0.1} value={fp.density} onChange={e => upd('density', Number(e.target.value))} /></div>

        {/* Embers */}
        <div style={S.sec}>Embers</div>
        <div style={S.row}>{lbl('Count', fp.emberCount)}<input type="range" style={S.input} min={0} max={80} step={1} value={fp.emberCount} onChange={e => upd('emberCount', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Size', fp.emberSize)}<input type="range" style={S.input} min={1} max={20} step={0.5} value={fp.emberSize} onChange={e => upd('emberSize', Number(e.target.value))} /></div>

        {/* Send-to buttons */}
          {(onSendToShape || onSendToPaint) && (
            <div style={{ borderTop: '1px solid #2a3450', paddingTop: '8px', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ fontSize: '0.68rem', color: '#4a5880', marginBottom: '2px' }}>Send still to…</div>
              {/* Matte Choker pre-process */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                  <span style={{ color: '#e07070' }}>Choke (−{Math.abs(Math.min(0, flameMatteChoke))})</span>
                  <span style={{ color: '#c8d0e0' }}>Matte {flameMatteChoke > 0 ? `+${flameMatteChoke}` : flameMatteChoke}</span>
                  <span style={{ color: '#70c0e0' }}>Spread (+{Math.max(0, flameMatteChoke)})</span>
                </div>
                <input type="range" min={-50} max={50} step={1} value={flameMatteChoke} style={{ width: '100%' }}
                  onChange={e => setFlameMatteChoke(Number(e.target.value))} />
              </div>
              {/* Edge Enhance pre-process */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                  <span style={{ color: '#8a93a2' }}>Edge Enhance</span>
                  <span style={{ color: '#c8d0e0' }}>{flameEdgeEnhance}%</span>
                </div>
                <input type="range" min={0} max={100} step={1} value={flameEdgeEnhance} style={{ width: '100%' }}
                  onChange={e => setFlameEdgeEnhance(Number(e.target.value))} />
              </div>
              {/* Fractal Distort pre-process */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                  <span style={{ color: '#8a93a2' }}>Fractal Distort</span>
                  <span style={{ color: '#c8d0e0' }}>{flameFractalDistort}%</span>
                </div>
                <input type="range" min={0} max={100} step={1} value={flameFractalDistort} style={{ width: '100%' }}
                  onChange={e => setFlameFractalDistort(Number(e.target.value))} />
              </div>
              {onSendToShape && (
                <button type="button" disabled={isExporting} onClick={async () => {
                  setIsExporting(true);
                  const urls = await renderFrames(1, exportRes, p => setExportProg(p));
                  let url = urls[0] ? await deriveAlphaFromLuma(urls[0]) : '';
                  if (url) url = await applyMatteChoke(url, flameMatteChoke);
                  if (url) url = await applyEdgeEnhance(url, flameEdgeEnhance);
                  if (url) url = await applyFractalDistort(url, flameFractalDistort);
                  setIsExporting(false);
                  if (url) onSendToShape(url);
                }} style={{ ...S.btn('#5a3fc0'), opacity: isExporting ? 0.5 : 1 }}>
                  ✨ Add to Shape tab
                </button>
              )}
              {onSendToPaint && (
                <button type="button" disabled={isExporting} onClick={async () => {
                  setIsExporting(true);
                  const urls = await renderFrames(1, exportRes, p => setExportProg(p));
                  let url = urls[0] ? await deriveAlphaFromLuma(urls[0]) : '';
                  if (url) url = await applyMatteChoke(url, flameMatteChoke);
                  if (url) url = await applyEdgeEnhance(url, flameEdgeEnhance);
                  if (url) url = await applyFractalDistort(url, flameFractalDistort);
                  setIsExporting(false);
                  if (url) onSendToPaint(url);
                }} style={{ ...S.btn('#3a7fd4'), opacity: isExporting ? 0.5 : 1 }}>
                  🎨 Send to Paint tab
                </button>
              )}
            </div>
          )}

        {/* Export settings */}
        <div style={S.sec}>Export</div>
        <div style={{ fontSize: '0.68rem', color: '#4a5880', marginBottom: '6px' }}>
          Loop: <strong style={{ color: '#7a90c0' }}>{computeLoopDur(fp).toFixed(2)} s</strong>
          &nbsp;({exportFrames} frames @ {exportFps} fps)
        </div>
        <div style={S.row}>
          <label style={S.label}>Resolution</label>
          <select value={exportRes} onChange={e => setExportRes(Number(e.target.value))}
            style={{ width: '100%', background: '#1e2840', border: '1px solid #3b455c', color: '#c8d0e0', borderRadius: '4px', padding: '3px 6px', fontSize: '0.74rem' }}>
            <option value={128}>128 × 128</option>
            <option value={256}>256 × 256</option>
            <option value={512}>512 × 512</option>
          </select>
        </div>
        <div style={S.row}>{lbl('Frames', exportFrames)}<input type="range" style={S.input} min={1} max={64} step={1} value={exportFrames} onChange={e => setExportFrames(Number(e.target.value))} /></div>
        <div style={S.row}>
          <label style={S.label}>FPS</label>
          <select value={exportFps} onChange={e => setExportFps(Number(e.target.value))}
            style={{ width: '100%', background: '#1e2840', border: '1px solid #3b455c', color: '#c8d0e0', borderRadius: '4px', padding: '3px 6px', fontSize: '0.74rem' }}>
            <option value={8}>8 fps</option>
            <option value={12}>12 fps</option>
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
          </select>
        </div>

        {/* Export buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
          <button type="button" disabled={isExporting} onClick={handleExportStill}
            style={{ ...S.btn('#4f6ef7'), opacity: isExporting ? 0.5 : 1 }}>
            📷 Export Still PNG
          </button>
          <button type="button" disabled={isExporting} onClick={handleExportSequence}
            style={{ ...S.btn('#27ae60'), opacity: isExporting ? 0.5 : 1 }}>
            🎞 Export PNG Sequence
          </button>
          {onAttachToEmitter && (
            <button type="button" disabled={isExporting} onClick={handleExportStill}
              style={{ ...S.btn('#e67e22'), opacity: isExporting ? 0.5 : 1 }}>
              Use Still ↗
            </button>
          )}
          {onExportToParticleSystem && (
            <button type="button" disabled={isExporting} onClick={handleExportSequence}
              style={{ ...S.btn('#27ae60'), opacity: isExporting ? 0.5 : 1 }}>
              Use Anim ↗
            </button>
          )}
        </div>

        {isExporting && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '3px' }}>
              Rendering… {exportProg.toFixed(0)}%
            </div>
            <div style={{ height: '4px', background: '#2a3450', borderRadius: '2px' }}>
              <div style={{ height: '100%', width: `${exportProg}%`, background: '#4f6ef7', borderRadius: '2px', transition: 'width 0.1s' }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Right: 3-D viewport ────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: bgColor }}>
        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
        {/* Camera reset button */}
        <button type="button" onClick={handleResetCamera}
          style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.55)', color: '#8a93a2', border: '1px solid #3b455c', borderRadius: '4px', padding: '3px 7px', fontSize: '0.68rem', cursor: 'pointer' }}>
          ⟳ Reset Camera
        </button>
        <div style={{ position: 'absolute', bottom: '8px', left: '8px', fontSize: '0.65rem', color: '#3b455c', pointerEvents: 'none' }}>
          Left-drag: orbit · Scroll: zoom · Right-drag: pan
        </div>
      </div>
    </div>
  );
};

export default FlameGenerator;
