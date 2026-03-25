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

// ─── Self-contained helpers (mirrors what Scene3D exposes at module level) ────

const _fgFlameTexCache = new Map<string, THREE.CanvasTexture>();

function fgBuildFlameTex(innerHex: number, outerHex: number): THREE.CanvasTexture {
  const key = `fg_${innerHex}_${outerHex}`;
  if (_fgFlameTexCache.has(key)) return _fgFlameTexCache.get(key)!;
  const S = 128, H = S / 2;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  const rgb = (hex: number) => `${(hex >> 16) & 0xff},${(hex >> 8) & 0xff},${hex & 0xff}`;
  const bri = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.4));
  const rr = bri((innerHex >> 16) & 0xff), rgg = bri((innerHex >> 8) & 0xff), rb = bri(innerHex & 0xff);
  const gr = ctx.createRadialGradient(H, H, 0, H, H, H);
  gr.addColorStop(0.00, `rgba(${rr},${rgg},${rb},1.00)`);
  gr.addColorStop(0.15, `rgba(${rgb(innerHex)},0.94)`);
  gr.addColorStop(0.38, `rgba(${rgb(outerHex)},0.78)`);
  gr.addColorStop(0.62, `rgba(${rgb(outerHex)},0.32)`);
  gr.addColorStop(0.84, `rgba(${rgb(outerHex)},0.07)`);
  gr.addColorStop(1.00, `rgba(${rgb(outerHex)},0.00)`);
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  _fgFlameTexCache.set(key, tex);
  return tex;
}

function fgSamplePolylineEvenly(
  pts: { x: number; y: number; z?: number }[],
  spacing: number,
): { x: number; y: number; z: number }[] {
  if (pts.length < 2) return [{ x: pts[0].x, y: pts[0].y, z: pts[0].z ?? 0 }];
  const out: { x: number; y: number; z: number }[] = [{ x: pts[0].x, y: pts[0].y, z: pts[0].z ?? 0 }];
  let accumulated = 0;
  for (let i = 1; i < pts.length; i++) {
    const az = pts[i - 1].z ?? 0, bz = pts[i].z ?? 0;
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y, dz = bz - az;
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (segLen < 1e-6) continue;
    let d = spacing - accumulated;
    while (d <= segLen) {
      const t = d / segLen;
      out.push({ x: pts[i - 1].x + dx * t, y: pts[i - 1].y + dy * t, z: az + dz * t });
      d += spacing;
    }
    accumulated = segLen - (d - spacing);
  }
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, z: pts[pts.length - 1].z ?? 0 });
  return out;
}

const hexStrToNum = (s: string) => parseInt(s.replace('#', ''), 16);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FlameGeneratorProps {
  onExportToParticleSystem?: (urls: string[], fps: number) => void;
  onAttachToEmitter?: (urls: string[]) => void;
}

interface FP {
  coreColor: string;
  glowColor: string;
  height: number;
  width: number;
  numTendrils: number;
  turbulence: number;
  speed: number;
  coreWidth: number;
  coreBlur: number;
  glowWidth: number;
  density: number;
  glowFalloff: number;
  flickerIntensity: number;
  flickerType: 'smooth' | 'fractal' | 'turbulent';
}

const DEFAULT_FP: FP = {
  coreColor: '#ffff88',
  glowColor: '#ff3300',
  height: 80,
  width: 30,
  numTendrils: 5,
  turbulence: 0.55,
  speed: 1.4,
  coreWidth: 6,
  coreBlur: 0.2,
  glowWidth: 16,
  density: 1.6,
  glowFalloff: 1.2,
  flickerIntensity: 0.45,
  flickerType: 'fractal',
};

// ─── Component ───────────────────────────────────────────────────────────────

export const FlameGenerator: React.FC<FlameGeneratorProps> = ({ onExportToParticleSystem, onAttachToEmitter }) => {
  const [fp, setFp] = useState<FP>(DEFAULT_FP);
  const fpRef = useRef<FP>(fp);
  useEffect(() => { fpRef.current = fp; }, [fp]);

  const [exportRes,    setExportRes]    = useState(256);
  const [exportFrames, setExportFrames] = useState(24);
  const [exportFps,    setExportFps]    = useState(24);
  const [isExporting,  setIsExporting]  = useState(false);
  const [exportProg,   setExportProg]   = useState(0); // 0-100

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
    renderer.setClearColor(0x080808, 1);
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
  const buildSprites = useCallback((fAnimT: number) => {
    const g = groupRef.current;
    if (!g) return;

    // Flush previous frame's sprites
    while (g.children.length > 0) {
      const c = g.children[0] as any;
      c.geometry?.dispose();
      (c.material as THREE.Material)?.dispose();
      g.remove(c);
    }

    const f          = fpRef.current;
    const flameHeight  = f.height;
    const flameWidth   = f.width;
    const numTendrils  = f.numTendrils;
    const turbulence   = f.turbulence;
    const speed        = f.speed;
    const coreW        = Math.max(0.5, f.coreWidth);
    const glowW        = Math.max(1, f.glowWidth);
    const densityF     = Math.max(0.5, Math.min(4, f.density));
    const flickerIntensF = Math.max(0, Math.min(1, f.flickerIntensity));
    const flickerTypeF  = f.flickerType;
    const coreBlurF     = Math.max(0, Math.min(1, f.coreBlur));
    const glowFalloffF  = Math.max(0, f.glowFalloff);

    const coreNum = hexStrToNum(f.coreColor);
    const glowNum = hexStrToNum(f.glowColor);
    const gTexF   = fgBuildFlameTex(coreNum, glowNum);
    const cTexF   = fgBuildFlameTex(coreNum, coreNum);

    /** Add a sprite chain along `pts` */
    const addFlameChain = (
      pts:       { x: number; y: number; z?: number }[],
      tex:       THREE.Texture,
      sprSz:     number,
      opacity:   number,
      zOff:      number,
      noiseSeed: number,
      growFront: number,
    ) => {
      const spacing   = Math.max(0.2, (sprSz * 0.35) / densityF);
      const samples   = fgSamplePolylineEvenly(pts, spacing);
      const N         = samples.length;
      const baseOpa   = opacity / Math.sqrt(densityF);

      samples.forEach((pt, i) => {
        const t         = N > 1 ? i / (N - 1) : 0;
        const growMask  = Math.max(0, Math.min(1, (growFront - t) / 0.14 + 1));
        const taperStart = 0.5;
        const taper     = t <= taperStart
          ? 1.0
          : Math.sqrt(Math.max(0, 1.0 - (t - taperStart) / (1.0 - taperStart + 1e-9))) * 0.96 + 0.04;

        const phase = noiseSeed + t * 5.1 - fAnimT * speed * 2.3;
        let noise01: number;
        if (flickerTypeF === 'smooth') {
          noise01 = 0.5 + 0.5 * (0.65 * Math.sin(phase) + 0.35 * Math.cos(phase * 1.61 + noiseSeed * 1.4 + t * 3.2));
        } else if (flickerTypeF === 'turbulent') {
          let v = 0, a = 1.0, fr = 1.0, nm = 0;
          for (let oct = 0; oct < 4; oct++) { v += a * Math.abs(Math.sin(phase * fr + oct * 1.3)); nm += a; fr *= 2.07; a *= 0.5; }
          noise01 = v / nm;
        } else {
          let v = 0, a = 1.0, fr = 1.0, nm = 0;
          for (let oct = 0; oct < 4; oct++) { v += a * (0.5 + 0.5 * Math.sin(phase * fr + oct * 1.3)); nm += a; fr *= 2.07; a *= 0.5; }
          noise01 = v / nm;
        }
        const flicker = (1.0 - flickerIntensF) + flickerIntensF * noise01;

        const sizePhase = noiseSeed * 1.3 + t * 4.7 - fAnimT * speed * 1.9;
        let sizeNoise01: number;
        if (flickerTypeF === 'smooth') {
          sizeNoise01 = 0.5 + 0.5 * Math.sin(sizePhase);
        } else if (flickerTypeF === 'turbulent') {
          let sv = 0, sa = 1.0, sfr = 1.0, snm = 0;
          for (let oct = 0; oct < 3; oct++) { sv += sa * Math.abs(Math.sin(sizePhase * sfr + oct * 2.1)); snm += sa; sfr *= 2.07; sa *= 0.5; }
          sizeNoise01 = sv / snm;
        } else {
          let sv = 0, sa = 1.0, sfr = 1.0, snm = 0;
          for (let oct = 0; oct < 3; oct++) { sv += sa * (0.5 + 0.5 * Math.sin(sizePhase * sfr + oct * 2.1)); snm += sa; sfr *= 2.07; sa *= 0.5; }
          sizeNoise01 = sv / snm;
        }
        const sizeScale = 1.0 + turbulence * (sizeNoise01 * 2.0 - 1.0) * 0.45;
        const vertGrad  = glowFalloffF > 0 ? Math.pow(Math.max(0, 1.0 - t), glowFalloffF) : 1.0;

        const mat = new THREE.SpriteMaterial({
          map: tex, transparent: true,
          opacity:  Math.max(0, baseOpa * taper * flicker * growMask * vertGrad),
          blending: THREE.AdditiveBlending,
          depthTest:  false,
          depthWrite: false,
        });
        const sp = new THREE.Sprite(mat);
        sp.position.set(pt.x, pt.y, (pt.z ?? 0) + zOff);
        sp.scale.set(sprSz * taper * sizeScale, sprSz * taper * sizeScale, 1);
        g.add(sp);
      });
    };

    const FLAME_PTS = 10;
    for (let ti = 0; ti < numTendrils; ti++) {
      const slotSeed   = ti * 2.399963;
      const minLife    = 1.2 / Math.max(0.1, speed);
      const maxLife    = 3.8 / Math.max(0.1, speed);
      const pr1        = Math.abs(Math.sin(slotSeed * 13.7 + 0.5));
      const lifespan   = minLife + pr1 * (maxLife - minLife);
      const birthOffset = Math.abs(Math.sin(slotSeed * 7.3 + 1.1)) * lifespan;
      const age01      = ((fAnimT + birthOffset) % lifespan) / lifespan;

      const FADE_IN    = 0.30;
      let lifeFade: number, growFront: number;
      if (age01 < FADE_IN) {
        growFront = age01 / FADE_IN; lifeFade = 1.0;
      } else if (age01 < 0.75) {
        growFront = 1.0; lifeFade = 1.0;
      } else {
        growFront = 1.0; lifeFade = 1.0 - (age01 - 0.75) / 0.25;
      }
      lifeFade = Math.max(0, lifeFade);

      const DETACH_START = 0.65;
      const detachT    = age01 < DETACH_START ? 0 : (age01 - DETACH_START) / (1.0 - DETACH_START);
      const riseOffset = Math.pow(detachT, 1.3) * flameHeight * 0.55;
      const ageScale   = 1.0 - detachT * 0.70;
      const deformMul  = 1.0 + detachT * 2.2;
      const baseWidthMul = Math.max(0.05, 1.0 - detachT * 0.9);
      const activeHeight = flameHeight * ageScale * (0.75 + 0.25 * lifeFade);
      const tendrilSeed  = slotSeed + Math.floor((fAnimT + birthOffset) / lifespan) * 1.618;
      const spreadAngle  = (numTendrils > 1 ? ti / (numTendrils - 1) : 0.5) * Math.PI * 2
                         + Math.floor((fAnimT + birthOffset) / lifespan) * 0.97;
      const baseR      = flameWidth * 0.35 * (numTendrils > 1 ? 1 : 0);
      const baseOffX   = Math.cos(spreadAngle + slotSeed) * baseR;
      const baseOffZ   = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;

      const pts: { x: number; y: number; z: number }[] = [];
      for (let pi = 0; pi < FLAME_PTS; pi++) {
        const yNorm    = pi / (FLAME_PTS - 1);
        const y        = riseOffset + yNorm * activeHeight;
        const widthEnv = Math.pow(yNorm, 0.65) * flameWidth * 0.5 * ageScale * baseWidthMul;
        const baseSpread = (1.0 - yNorm) * baseWidthMul;
        const noiseT   = tendrilSeed + yNorm * 3.0 - fAnimT * speed;
        const dx = (Math.sin(noiseT * 1.3 + tendrilSeed)      * 1.0
                  + Math.cos(noiseT * 2.1 + tendrilSeed * 1.7) * 0.4) * turbulence * widthEnv * deformMul;
        const dz = Math.cos(noiseT * 0.9 + tendrilSeed * 2.3) * turbulence * widthEnv * 0.6 * deformMul;
        pts.push({ x: baseOffX * baseSpread + dx, y, z: baseOffZ * baseSpread + dz });
      }

      const haloD          = glowW * 4.0 * ageScale;
      const glowD          = glowW * 2.0 * ageScale;
      const coreBlurSizeMul = 1.0 + coreBlurF * 2.6;
      const coreBlurOpaMul  = 1.0 / Math.sqrt(coreBlurSizeMul);
      const coreD          = coreW * 2.2 * coreBlurSizeMul * ageScale;
      addFlameChain(pts, gTexF, haloD, 0.09 * lifeFade, -0.1, tendrilSeed,       growFront);
      addFlameChain(pts, gTexF, glowD, 0.28 * lifeFade,  0.0, tendrilSeed + 1.1, growFront);
      addFlameChain(pts, cTexF, coreD, 0.60 * lifeFade * coreBlurOpaMul, 0.1, tendrilSeed + 2.2, growFront);
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

    // Loop duration: 2× average lifespan at current speed (good coverage of all tendril phases)
    const speed     = Math.max(0.1, f.speed);
    const avgLife   = (1.2 + 3.8) / 2 / speed; // average life in seconds
    const loopDur   = avgLife * 2.0;

    const urls: string[] = [];
    const pixels   = new Uint8Array(res * res * 4);
    const tmpCv    = document.createElement('canvas');
    tmpCv.width    = res; tmpCv.height = res;
    const tmpCtx   = tmpCv.getContext('2d')!;

    for (let fi = 0; fi < numFrames; fi++) {
      const t = loopDur * (fi / Math.max(1, numFrames));
      buildSprites(t);
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 1);
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

        {/* Colors */}
        <div style={S.sec}>Colors</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div>
            <label style={S.label}>Core</label>
            <input type="color" value={fp.coreColor} onChange={e => upd('coreColor', e.target.value)}
              style={{ width: '100%', height: '28px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
          </div>
          <div>
            <label style={S.label}>Glow / Outer</label>
            <input type="color" value={fp.glowColor} onChange={e => upd('glowColor', e.target.value)}
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
        <div style={S.row}>{lbl('Glow Width', fp.glowWidth)}<input  type="range" style={S.input} min={2}  max={60} step={1}    value={fp.glowWidth}   onChange={e => upd('glowWidth',   Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Vertical Falloff', fp.glowFalloff.toFixed(2))}<input type="range" style={S.input} min={0} max={4} step={0.05} value={fp.glowFalloff} onChange={e => upd('glowFalloff', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Density', fp.density.toFixed(1))}<input type="range" style={S.input} min={0.5} max={4} step={0.1} value={fp.density} onChange={e => upd('density', Number(e.target.value))} /></div>

        {/* Export settings */}
        <div style={S.sec}>Export</div>
        <div style={S.row}>
          <label style={S.label}>Resolution</label>
          <select value={exportRes} onChange={e => setExportRes(Number(e.target.value))}
            style={{ width: '100%', background: '#1e2840', border: '1px solid #3b455c', color: '#c8d0e0', borderRadius: '4px', padding: '3px 6px', fontSize: '0.74rem' }}>
            <option value={128}>128 ×128</option>
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
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#080808' }}>
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
