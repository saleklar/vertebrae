import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
const flippedTextureCache = new WeakMap<THREE.Texture, THREE.Texture>();

import Stats from 'three/examples/jsm/libs/stats.module.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SceneObject, EmitterObject, SnapSettings, PhysicsForce } from './App';
import { buildLightningPreview } from './LightningGenerator';

// ─── Tint Gradient: per-particle colour-over-lifetime ─────────────────────────
/** A single colour stop in a particle tint-over-lifetime gradient. */
export type TintStop = {
  t: number;     // normalised lifetime position 0–1
  color: string; // CSS hex colour e.g. '#ff8800'
  alpha: number; // opacity 0–1 at this stop
};

/** Sample a TintStop[] gradient at normalised time t → { r, g, b, a } in 0–1 range. */
export function sampleTintGradient(
  stops: TintStop[],
  t: number,
): { r: number; g: number; b: number; a: number } {
  if (!stops || stops.length === 0) return { r: 1, g: 1, b: 1, a: 1 };
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return _tintRgba(sorted[0]);
  if (t >= sorted[sorted.length - 1].t) return _tintRgba(sorted[sorted.length - 1]);
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1];
    if (t >= lo.t && t <= hi.t) {
      const f = (t - lo.t) / (hi.t - lo.t);
      const ca = _tintRgba(lo), cb = _tintRgba(hi);
      return { r: ca.r+(cb.r-ca.r)*f, g: ca.g+(cb.g-ca.g)*f, b: ca.b+(cb.b-ca.b)*f, a: ca.a+(cb.a-ca.a)*f };
    }
  }
  return { r: 1, g: 1, b: 1, a: 1 };
}
function _tintRgba(s: TintStop): { r: number; g: number; b: number; a: number } {
  const c = new THREE.Color(s.color);
  return { r: c.r, g: c.g, b: c.b, a: s.alpha };
}

// ─── Lightning viewport: sprite-based glow rendering ────────────────────────────────────
// Each point along the bolt path gets a radial-gradient sprite with additive blending,
// producing a seamless glowing tube that looks like real plasma / electricity.

/** Cache: key = "glowHex_coreHex" → CanvasTexture */
const _lightningTexCache = new Map<string, THREE.CanvasTexture>();

/**
 * Builds (and caches) a 128×128 radial-gradient canvas texture:
 *   centre → bright white → coreColor → glowColor → fully transparent edge
 */
function buildLightningGlowTex(glowHex: number, coreHex: number): THREE.CanvasTexture {
  const key = `${glowHex}_${coreHex}`;
  if (_lightningTexCache.has(key)) return _lightningTexCache.get(key)!;
  const S = 128, H = S / 2;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  const rgb = (hex: number) => `${(hex>>16)&0xff},${(hex>>8)&0xff},${hex&0xff}`;
  const gr  = ctx.createRadialGradient(H, H, 0, H, H, H);
  gr.addColorStop(0.00, 'rgba(255,255,255,1.00)');
  gr.addColorStop(0.10, `rgba(${rgb(0xffffff)},0.95)`);
  gr.addColorStop(0.22, `rgba(${rgb(coreHex)},0.90)`);
  gr.addColorStop(0.42, `rgba(${rgb(glowHex)},0.80)`);
  gr.addColorStop(0.65, `rgba(${rgb(glowHex)},0.35)`);
  gr.addColorStop(0.85, `rgba(${rgb(glowHex)},0.08)`);
  gr.addColorStop(1.00, `rgba(${rgb(glowHex)},0.00)`);
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  _lightningTexCache.set(key, tex);
  return tex;
}

/**
 * Walks a polyline and returns points sampled at `spacing` world-unit intervals.
 * Ensures the first and last original points are always included.
 */
function samplePolylineEvenly(
  pts: { x: number; y: number; z?: number }[],
  spacing: number,
): { x: number; y: number; z: number }[] {
  if (pts.length < 2) return [{ x: pts[0].x, y: pts[0].y, z: pts[0].z ?? 0 }];
  const out: { x: number; y: number; z: number }[] = [{ x: pts[0].x, y: pts[0].y, z: pts[0].z ?? 0 }];
  let accumulated = 0;
  for (let i = 1; i < pts.length; i++) {
    const az = pts[i-1].z ?? 0, bz = pts[i].z ?? 0;
    const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y, dz = bz - az;
    const segLen = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (segLen < 1e-6) continue;
    let d = spacing - accumulated;
    while (d <= segLen) {
      const t = d / segLen;
      out.push({ x: pts[i-1].x + dx*t, y: pts[i-1].y + dy*t, z: az + dz*t });
      d += spacing;
    }
    accumulated = segLen - (d - spacing);
  }
  out.push({ x: pts[pts.length-1].x, y: pts[pts.length-1].y, z: pts[pts.length-1].z ?? 0 });
  return out;
}

// --- Simple 3D Noise for Turbulence ---
const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;
const pNoise = new Uint8Array(256);
for (let i = 0; i < 256; i++) pNoise[i] = Math.floor(Math.random() * 256);
const p = new Uint8Array(512);
for (let i = 0; i < 512; i++) p[i] = pNoise[i & 255];
function dot(g: number[], x: number, y: number, z: number) { return g[0]*x + g[1]*y + g[2]*z; }
const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
function simplex3(xin: number, yin: number, zin: number) {
  let n0, n1, n2, n3;
  const s = (xin+yin+zin)*F3;
  const i = Math.floor(xin+s); const j = Math.floor(yin+s); const k = Math.floor(zin+s);
  const t = (i+j+k)*G3;
  const X0 = i-t; const Y0 = j-t; const Z0 = k-t;
  const x0 = xin-X0; const y0 = yin-Y0; const z0 = zin-Z0;
  let i1, j1, k1, i2, j2, k2;
  if(x0>=y0) { if(y0>=z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; } else if(x0>=z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; } else { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; } }
  else { if(y0<z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; } else if(x0<z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; } else { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; } }
  const x1 = x0 - i1 + G3; const y1 = y0 - j1 + G3; const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2.0*G3; const y2 = y0 - j2 + 2.0*G3; const z2 = z0 - k2 + 2.0*G3;
  const x3 = x0 - 1.0 + 3.0*G3; const y3 = y0 - 1.0 + 3.0*G3; const z3 = z0 - 1.0 + 3.0*G3;
  const ii = i & 255; const jj = j & 255; const kk = k & 255;
  const gi0 = p[ii+p[jj+p[kk]]] % 12;
  const gi1 = p[ii+i1+p[jj+j1+p[kk+k1]]] % 12;
  const gi2 = p[ii+i2+p[jj+j2+p[kk+k2]]] % 12;
  const gi3 = p[ii+1+p[jj+1+p[kk+1]]] % 12;
  let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0; if(t0<0) n0 = 0.0; else { t0 *= t0; n0 = t0 * t0 * dot(grad3[gi0], x0, y0, z0); }
  let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1; if(t1<0) n1 = 0.0; else { t1 *= t1; n1 = t1 * t1 * dot(grad3[gi1], x1, y1, z1); }
  let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2; if(t2<0) n2 = 0.0; else { t2 *= t2; n2 = t2 * t2 * dot(grad3[gi2], x2, y2, z2); }
  let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3; if(t3<0) n3 = 0.0; else { t3 *= t3; n3 = t3 * t3 * dot(grad3[gi3], x3, y3, z3); }
  return 32.0*(n0 + n1 + n2 + n3);
}

function curlNoise(x: number, y: number, z: number, scale: number) {
  const e = 0.1;
  const dx = new THREE.Vector3(e, 0.0, 0.0);
  const dy = new THREE.Vector3(0.0, e, 0.0);
  const dz = new THREE.Vector3(0.0, 0.0, e);

  const n_x = simplex3(x/scale, y/scale, z/scale);
  
  // Fake quick curl using simplex offsets
  const x0 = simplex3((x-e)/scale, y/scale, z/scale);
  const x1 = simplex3((x+e)/scale, y/scale, z/scale);
  const y0 = simplex3(x/scale, (y-e)/scale, z/scale);
  const y1 = simplex3(x/scale, (y+e)/scale, z/scale);
  const z0 = simplex3(x/scale, y/scale, (z-e)/scale);
  const z1 = simplex3(x/scale, y/scale, (z+e)/scale);

  const cx = ((y1 - y0) - (z1 - z0)) / (2.0 * e);
  const cy = ((z1 - z0) - (x1 - x0)) / (2.0 * e);
  const cz = ((x1 - x0) - (y1 - y0)) / (2.0 * e);

  return new THREE.Vector3(cx, cy, cz).normalize();
}
// ----------------------------------------


type SceneSize = {
  x: number;
  y: number;
  z: number;
};

type SceneSettings = {
  particleType?: string;
  customGlow?: boolean;
  backgroundColor: string;
  gridOpacity: number;
  zoomSpeed: number;
  particlePreviewMode: 'real' | 'white-dots';
  particlePreviewSize: number;
  particleBudget: number;
  adaptiveEmission?: boolean;
  particleLivePreview?: boolean;
  particleSequenceBudget?: number;
  particleSequenceBudgetLoop?: boolean;
  exportProjectionMode?: 'orthographic' | 'perspective';
  cameraOrbitSpeed?: number;
  referenceImage?: string | null;
  referenceOpacity?: number;
  showGrid?: boolean;
  showObjects?: boolean;
  showParticles?: boolean;
  showSpineImages?: boolean;
  showBones?: boolean;
};

const DEFAULT_THETA = Math.PI / 4;
const DEFAULT_PHI = Math.PI / 4;
const DEFAULT_EMISSION_AXIS = new THREE.Vector3(0, 1, 0);

export type SpineAttachmentInfo = {
  id: string;
  slotName: string;
  boneObjectId: string;
  imageDataUrl: string;
  localX: number;
  localY: number;
  localRotationDeg: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  /** Pre-resolved data URLs for each frame of a sequence attachment */
  sequenceFrames?: string[];
  /** Slot order index (0 = back, higher = front) */
  slotIndex: number;
  /** Spine blend mode: 'normal' | 'additive' | 'multiply' | 'screen' */
  blendMode?: string;
  /** Slot base color as RGBA hex string e.g. 'ffffffff' */
  color?: string;
};

/** Per-frame override: visibility + optional sequence frame index + optional animated alpha */
export type SpineFrameOverrides = Record<string, { visible: boolean; seqFrame?: number; alpha?: number; tintR?: number; tintG?: number; tintB?: number }>;

type Scene3DProps = {
  sceneSize: SceneSize;
  sceneSettings: SceneSettings;
  snapSettings: SnapSettings;
  viewMode: 'perspective' | 'x' | 'y' | 'z';
  drawMode?: boolean;
  onDrawComplete?: (points: {x:number, y:number, z:number}[]) => void;
  onViewModeChange: (mode: 'perspective' | 'x' | 'y' | 'z') => void;
  sceneObjects: SceneObject[];
  currentFrame: number;
  isPlaying: boolean;
  isCaching: boolean;
  timelineIn: number;
  timelineOut: number;
  physicsForces: PhysicsForce[];
  selectedObjectId: string | null;
  selectedObjectIds?: string[];
  selectedForceId?: string | null;
  onObjectSelect: (objectId: string | null) => void;
  onMultiObjectSelect?: (objectIds: string[]) => void;
  onForceSelect?: (forceId: string | null) => void;
  onObjectTransform?: (objectId: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }) => void;
  onForceTransform?: (forceId: string, position: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }) => void;
  handleScale?: number;
  onCacheFrameCountChange?: (count: number) => void;
  cacheResetToken?: number;
  onUpdateSceneSettings?: (settings: Partial<SceneSettings>) => void;
  onCameraChange?: (cameraState: { position: THREE.Vector3, quaternion: THREE.Quaternion }) => void;
  drawBezierCurveMode?: boolean;
  onFinishDrawBezierCurve?: (points?: {x:number, y:number, z:number}[]) => void;
  spineAttachments?: SpineAttachmentInfo[];
  spineFrameOverrides?: SpineFrameOverrides;
  spineLayerSpread?: number;
  quadViewport?: boolean;
  onQuadPanelClick?: (panel: 'top' | 'front' | 'side' | 'perspective') => void;
  manipulatorMode?: 'translate' | 'rotate' | 'scale';
  onManipulatorModeChange?: (mode: 'translate' | 'rotate' | 'scale') => void;
};

type CachedParticleState = {
  emitterId: string;
  trackId: number; // For Spine bone pooling
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  lifetime: number;
  age: number;
  opacity: number;
  visible: boolean;
  rotation: number;
  size: number;
  color?: string; // hex e.g. 'ff8800' — baked current material colour for Spine export
};

type ParticleVisualType = 'dots' | 'stars' | 'circles' | 'glow-circles' | 'sparkle' | 'glitter' | 'sprites' | '3d-model' | 'volumetric-fire' | 'metallic-sphere';

export interface Scene3DRef {
  exportSpineData: (options?: any) => any;
  getParticleTextureBlob: () => Promise<Blob | null>;
  getExportAssets: () => Promise<Array<{ name: string, blob: Blob }>>;
  exportLightningSequenceFromViewport: (options: {
    lightningId: string;
    frameCount: number;
    fps: number;
    width: number;
    height: number;
    mode: 'strike' | 'loop' | 'loop-strike';
  }) => Promise<string[]>;
  /** Reset all physics-driven objects back to their positions at the last play-start */
  resetRigidBodies: () => void;
  focusSelectedObject: () => void;
}


const resampleSequence = (urls: string[], budget: number | undefined) => {
  if (!budget || budget <= 0 || urls.length <= budget) return urls;
  const step = urls.length / budget;
  const resampled = [];
  for(let i=0; i<budget; i++) {
      resampled.push(urls[Math.floor(i * step)]);
  }
  return resampled;
};

const getResampledSequenceProps = (props: any, budget?: number, loop?: boolean) => {
    let urls = Array.isArray(props?.particleSpriteSequenceDataUrls) ? props.particleSpriteSequenceDataUrls : [];
    let fps = Number(props?.particleSpriteSequenceFps ?? 12);
    const originalLength = urls.length;
    const resampledUrls = resampleSequence(urls, budget);
    if (!loop && originalLength > resampledUrls.length && resampledUrls.length > 0) {
        fps = fps * (resampledUrls.length / originalLength);
    }
    return { urls: resampledUrls, fps };
};


function evaluateCurve(curveJson: string | any[] | undefined, t: number, defaultValue: number = 1): number {
  if (!curveJson) return defaultValue;
  try {
    const points = typeof curveJson === 'string' ? JSON.parse(curveJson) : curveJson;
    if (!Array.isArray(points) || points.length === 0) return defaultValue;
    if (points.length === 1) return points[0].y;
    
const mappedPoints = points.map((p: any) => ({
        x: p.x !== undefined ? p.x : (p.t !== undefined ? p.t : 0),
        y: p.y !== undefined ? p.y : (p.v !== undefined ? p.v : 0),
        rx: p.rx, ry: p.ry, lx: p.lx, ly: p.ly
      }));
      const sortedPoints = [...mappedPoints].sort((a: any, b: any) => a.x - b.x);

    if (t <= sortedPoints[0].x) return sortedPoints[0].y;
    if (t >= sortedPoints[sortedPoints.length - 1].x) return sortedPoints[sortedPoints.length - 1].y;

    for (let i = 0; i < sortedPoints.length - 1; i++) {
       const p1 = sortedPoints[i];
       const p2 = sortedPoints[i+1];
       if (t >= p1.x && t <= p2.x) {
         if (p1.rx !== undefined || p2.lx !== undefined) {
             const cp1x = p1.rx !== undefined ? p1.rx : p1.x + (p2.x - p1.x) / 3;
             const cp1y = p1.ry !== undefined ? p1.ry : p1.y + (p2.y - p1.y) / 3;
             const cp2x = p2.lx !== undefined ? p2.lx : p2.x - (p2.x - p1.x) / 3;
             const cp2y = p2.ly !== undefined ? p2.ly : p2.y - (p2.y - p1.y) / 3;
             
             let lower = 0;
             let upper = 1;
             let u = 0.5;
             for (let iter = 0; iter < 15; iter++) {
                 const invU = 1 - u;
                 const currentX = invU*invU*invU*p1.x + 3*invU*invU*u*cp1x + 3*invU*u*u*cp2x + u*u*u*p2.x;
                 if (currentX < t) lower = u;
                 else upper = u;
                 u = (lower + upper) / 2;
             }
             const invU = 1 - u;
             return invU*invU*invU*p1.y + 3*invU*invU*u*cp1y + 3*invU*u*u*cp2y + u*u*u*p2.y;
         } else {
             const segmentT = (t - p1.x) / (p2.x - p1.x);
             return p1.y + (p2.y - p1.y) * segmentT;
         }
       }
    }
  } catch(e) {
  }
  return defaultValue;
}

// ── Module-level surface-snap cache infrastructure (never re-allocated per frame) ───────────────
type SurfaceTri = { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; n: THREE.Vector3 };
type SpineMaskSample = { u: number; v: number };
type SpineAttachmentMaskData = {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  surfaceSamples: SpineMaskSample[];
  edgeSamples: SpineMaskSample[];
};
const SPINE_MASK_ALPHA_THRESHOLD = 10;
const SPINE_MASK_MAX_SURFACE_SAMPLES = 12000;
const SPINE_MASK_MAX_EDGE_SAMPLES = 6000;

function decimateMaskSamples(samples: SpineMaskSample[], maxSamples: number): SpineMaskSample[] {
  if (samples.length <= maxSamples) return samples;
  const step = Math.max(1, Math.ceil(samples.length / maxSamples));
  const out: SpineMaskSample[] = [];
  for (let i = 0; i < samples.length; i += step) out.push(samples[i]);
  const last = samples[samples.length - 1];
  if (out.length === 0 || out[out.length - 1] !== last) out.push(last);
  return out;
}

function buildSpineAttachmentMaskData(data: Uint8ClampedArray, w: number, h: number): SpineAttachmentMaskData {
  const surfaceSamples: SpineMaskSample[] = [];
  const edgeSamples: SpineMaskSample[] = [];
  const alphaAt = (x: number, y: number) => data[(y * w + x) * 4 + 3];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = alphaAt(x, y);
      if (alpha <= SPINE_MASK_ALPHA_THRESHOLD) continue;

      const sample = { u: (x + 0.5) / w, v: (y + 0.5) / h };
      surfaceSamples.push(sample);

      let isEdge = false;
      for (let oy = -1; oy <= 1 && !isEdge; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || alphaAt(nx, ny) <= SPINE_MASK_ALPHA_THRESHOLD) {
            isEdge = true;
            break;
          }
        }
      }
      if (isEdge) edgeSamples.push(sample);
    }
  }

  return {
    data,
    w,
    h,
    surfaceSamples: decimateMaskSamples(surfaceSamples, SPINE_MASK_MAX_SURFACE_SAMPLES),
    edgeSamples: decimateMaskSamples(edgeSamples, SPINE_MASK_MAX_EDGE_SAMPLES),
  };
}

const _cpotAB  = new THREE.Vector3(), _cpotAC  = new THREE.Vector3(),
      _cpotAP  = new THREE.Vector3(), _cpotBP  = new THREE.Vector3(),
      _cpotCP2 = new THREE.Vector3(), _cpotRes = new THREE.Vector3();
function closestPointOnTriangleCached(
  p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3,
): void {
  _cpotAB.subVectors(b, a); _cpotAC.subVectors(c, a); _cpotAP.subVectors(p, a);
  const d1 = _cpotAB.dot(_cpotAP), d2 = _cpotAC.dot(_cpotAP);
  if (d1 <= 0 && d2 <= 0) { out.copy(a); return; }
  _cpotBP.subVectors(p, b);
  const d3 = _cpotAB.dot(_cpotBP), d4 = _cpotAC.dot(_cpotBP);
  if (d3 >= 0 && d4 <= d3) { out.copy(b); return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { out.copy(a).addScaledVector(_cpotAB, d1 / (d1 - d3)); return; }
  _cpotCP2.subVectors(p, c);
  const d5 = _cpotAB.dot(_cpotCP2), d6 = _cpotAC.dot(_cpotCP2);
  if (d6 >= 0 && d5 <= d6) { out.copy(c); return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { out.copy(a).addScaledVector(_cpotAC, d2 / (d2 - d6)); return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    out.copy(b).addScaledVector(_cpotCP2.subVectors(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))); return;
  }
  const denom = 1 / (va + vb + vc);
  out.copy(a).addScaledVector(_cpotAB, vb * denom).addScaledVector(_cpotAC, vc * denom);
}
function meshMatrixKey(meshRoot: THREE.Object3D): string {
  const e = meshRoot.matrixWorld.elements;
  return `${e[12].toFixed(2)}_${e[13].toFixed(2)}_${e[14].toFixed(2)}_${e[0].toFixed(3)}_${e[5].toFixed(3)}_${e[10].toFixed(3)}`;
}
function buildSurfaceTris(meshRoot: THREE.Object3D): SurfaceTri[] {
  const tris: SurfaceTri[] = [];
  meshRoot.updateWorldMatrix(true, true);
  const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
  meshRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const mat = mesh.matrixWorld;
    const normalMat = new THREE.Matrix3().getNormalMatrix(mat);
    const geoIdx = geo.index;
    const totalTris = geoIdx ? Math.floor(geoIdx.count / 3) : Math.floor(pos.count / 3);
    const step = Math.max(1, Math.floor(totalTris / 600));
    const rv = (i: number) => new THREE.Vector3().fromBufferAttribute(pos!, i).applyMatrix4(mat);
    const addTri = (ia: number, ib: number, ic: number) => {
      const a = rv(ia), b = rv(ib), c = rv(ic);
      _e1.subVectors(b, a); _e2.subVectors(c, a);
      const n = new THREE.Vector3().crossVectors(_e1, _e2).applyMatrix3(normalMat).normalize();
      tris.push({ a, b, c, n });
    };
    if (geoIdx) {
      for (let i = 0; i < geoIdx.count - 2; i += step * 3)
        addTri(geoIdx.getX(i), geoIdx.getX(i + 1), geoIdx.getX(i + 2));
    } else {
      for (let i = 0; i < pos.count - 2; i += step * 3) addTri(i, i + 1, i + 2);
    }
  });
  return tris;
}
function buildSurfaceVerts(meshRoot: THREE.Object3D): THREE.Vector3[] {
  const verts: THREE.Vector3[] = [];
  meshRoot.updateWorldMatrix(true, true);
  meshRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = (mesh.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const mat = mesh.matrixWorld;
    const step = Math.max(1, Math.floor(pos.count / 1600));
    for (let i = 0; i < pos.count; i += step)
      verts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat));
  });
  return verts;
}

/** Loopable fractal glow noise: time ∈ [0,1) → perfectly repeating. Returns 0–1. */
function lightningLoopNoise(pos: number, time: number, scale: number): number {
  const TWO_PI = Math.PI * 2;
  let v = 0, amp = 0.5, freq = scale;
  for (let i = 0; i < 4; i++) {
    const tp = time * TWO_PI * (i + 1);
    const sp = pos * freq;
    v += amp * (0.5 + 0.5 * Math.sin(sp + tp));
    v += amp * 0.25 * (0.5 + 0.5 * Math.sin(sp * 1.618 - tp * 1.3));
    freq *= 2.1;
    amp  *= 0.52;
  }
  return Math.max(0, Math.min(1, v / 0.9375));
}
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const Scene3D = forwardRef<Scene3DRef, Scene3DProps>(({ drawMode, onDrawComplete, sceneSize, sceneSettings, onCameraChange, snapSettings, viewMode, onViewModeChange, sceneObjects, currentFrame, isPlaying, isCaching, timelineIn, timelineOut, physicsForces, selectedObjectId, selectedObjectIds, selectedForceId, onObjectSelect, onMultiObjectSelect, onForceSelect, onObjectTransform, onForceTransform, handleScale = 1.0, onCacheFrameCountChange, cacheResetToken = 0, onUpdateSceneSettings, drawBezierCurveMode = false, onFinishDrawBezierCurve, spineAttachments = [], spineFrameOverrides, spineLayerSpread = 0, quadViewport = false, onQuadPanelClick, manipulatorMode: manipulatorModeProp, onManipulatorModeChange }, ref) => {
    // State for Bezier curve drawing
    const [bezierCurvePoints, setBezierCurvePoints] = useState<{x: number, y: number, z: number}[]>([]);
    const bezierCurveMeshRef = useRef<THREE.Line | null>(null);

    // Helper: convert screen (client) coordinates to 3D world position on XZ plane (y=0)
    function screenToWorld(x: number, y: number): THREE.Vector3 | null {
      if (!rendererRef.current || !currentCameraRef.current) return null;
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      const ndcX = ((x - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((y - rect.top) / rect.height) * 2 + 1;
      const ndc = new THREE.Vector3(ndcX, ndcY, 0.5);
      ndc.unproject(currentCameraRef.current);
      // Project onto y=0 plane
      const camera = currentCameraRef.current;
      const camPos = camera.position.clone();
      const dir = ndc.clone().sub(camPos).normalize();
      const t = -camPos.y / dir.y;
      if (!isFinite(t)) return null;
      return camPos.clone().add(dir.multiplyScalar(t));
    }

    // Mouse click handler for Bezier curve drawing
    useEffect(() => {
      if (!drawBezierCurveMode) return;
      const handleClick = (event: MouseEvent) => {
        if (event.button !== 0) return; // Only LMB
        if (!rendererRef.current) return;
        const pos = screenToWorld(event.clientX, event.clientY);
        if (pos) {
          setBezierCurvePoints(prev => [...prev, { x: pos.x, y: pos.y, z: pos.z }]);
        }
      };
      window.addEventListener('mousedown', handleClick);
      return () => window.removeEventListener('mousedown', handleClick);
    }, [drawBezierCurveMode]);

    // Render/update the Bezier curve as points are added
    useEffect(() => {
      if (!sceneRef.current) return;
      // Remove previous curve
      if (bezierCurveMeshRef.current) {
        sceneRef.current.remove(bezierCurveMeshRef.current);
        bezierCurveMeshRef.current.geometry.dispose();
        bezierCurveMeshRef.current = null;
      }
      if (bezierCurvePoints.length < 2) return;
      // Create a simple Bezier curve (CatmullRom for now, can upgrade to true Bezier)
      const curve = new THREE.CatmullRomCurve3(bezierCurvePoints.map(p => new THREE.Vector3(p.x, p.y, p.z)));
      const curveGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(100));
      const curveMaterial = new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 2 });
      const curveLine = new THREE.Line(curveGeometry, curveMaterial);
      sceneRef.current.add(curveLine);
      bezierCurveMeshRef.current = curveLine;
    }, [bezierCurvePoints]);

    // Finish drawing (double-click or ESC to complete)
    useEffect(() => {
      if (!drawBezierCurveMode) return;
      const handleFinish = (event: KeyboardEvent | MouseEvent) => {
        if ((event instanceof KeyboardEvent && event.key === 'Escape') || (event instanceof MouseEvent && event.detail === 2)) {
          if (bezierCurvePoints.length >= 2) {
            // TODO: Add curve to scene objects or call onDrawComplete/onFinishDrawBezierCurve
          }
          setBezierCurvePoints([]);
          if (onFinishDrawBezierCurve) onFinishDrawBezierCurve(bezierCurvePoints);
        }
      };
      window.addEventListener('keydown', handleFinish);
      window.addEventListener('dblclick', handleFinish);
      return () => {
        window.removeEventListener('keydown', handleFinish);
        window.removeEventListener('dblclick', handleFinish);
      };
    }, [drawBezierCurveMode, bezierCurvePoints, onFinishDrawBezierCurve]);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const gridHelpersRef = useRef<THREE.GridHelper[]>([]);
  const perspectiveCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const currentCameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null);

  // Mouse control state
  const mouseStateRef = useRef({
    isDown: false,
    button: -1,
    x: 0,
    y: 0,
    deltaX: 0,
    deltaY: 0,
    altKey: false,
    shiftKey: false,
  });

  const cameraStateRef = useRef({
    theta: DEFAULT_THETA,
    phi: DEFAULT_PHI,
    radius: 1500,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    viewOffsetX: 0,
    viewOffsetY: 0,
    viewOffsetZ: 0,
    orthoZoom: 1,
    targetTheta: DEFAULT_THETA,
    targetPhi: DEFAULT_PHI,
    isAnimating: false,
  });

  const selectedObjectRef = useRef<THREE.Object3D | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const isOrthoRef = useRef(false);
  const gizmoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gizmoSceneRef = useRef<THREE.Scene | null>(null);
  const gizmoRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const gizmoAxisObjectsRef = useRef<{ x: THREE.Object3D; y: THREE.Object3D; z: THREE.Object3D } | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  
  // Scene objects tracking
  const focusSelectedObjectRef = useRef<() => void>();
  const sceneObjectMeshesRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const selectionOutlineHelpersRef = useRef<Map<string, THREE.BoxHelper>>(new Map());
  const spineAttachmentMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const spineLayerSpreadRef = useRef(0);
  // Geometry caches: rebuilt only when the mesh world-matrix changes, never per-render-frame
  const surfaceTriCacheRef   = useRef<Map<string, { tris: SurfaceTri[]; key: string }>>(new Map());
  const endAnchorVertsCacheRef = useRef<Map<string, { verts: THREE.Vector3[]; key: string }>>(new Map());
  const spineAttachPixelDataRef = useRef<Map<string, SpineAttachmentMaskData | null>>(new Map());
  const quadViewportRef = useRef(false);
  const quadCamerasRef = useRef<{ front: THREE.OrthographicCamera; top: THREE.OrthographicCamera; side: THREE.OrthographicCamera } | null>(null);
  type QuadPanel = 'top' | 'front' | 'side' | 'perspective';
  const [focusedQuadPanel, setFocusedQuadPanel] = useState<QuadPanel | null>(null);
  const focusedQuadPanelRef = useRef<QuadPanel | null>(null);
  const sceneExtentRef = useRef(500);
  const physicsForceGizmosRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const particleSystemsRef = useRef<Map<string, {
    particles: Array<{
      trackId: number; // Persistent ID for bone reuse
      mesh: THREE.Points | THREE.Sprite;
      velocity: THREE.Vector3; 
      lifetime: number; 
      age: number;
      baseColor?: string;
      baseOpacity?: number;
      baseSize?: number;
      sizeMultiplier?: number;
        flipX?: boolean;
      particleType?: ParticleVisualType;
      customGlow?: boolean;
      rotation?: number;
      rotationOffset?: number;
      rotationVariation?: number;
      rotationSpeed?: number;
      rotationSpeedMultiplier?: number;
      rotationSpeedVariation?: number;
      rotationDriftPhase?: number;   // per-particle random phase for smooth wobble
      spriteImageDataUrl?: string;
      spriteSequenceDataUrls?: string[];
      opacityOverLife?: boolean;
      colorOverLife?: boolean;
      colorOverLifeTarget?: string;
      tintGradient?: TintStop[];
      sizeOverLife?: string;
      positionHistory?: THREE.Vector3[];
    }>;
    lastEmit: number;
  }>>(new Map());
  
  // Refs for animation loop to access latest values
  const sceneObjectsRef = useRef<SceneObject[]>(sceneObjects);
  const sceneSettingsRef = useRef<SceneSettings>(sceneSettings);
  const snapSettingsRef = useRef<SnapSettings>(snapSettings);
  const isPlayingRef = useRef(isPlaying);
  const isCachingRef = useRef(isCaching);
  const timelineInRef = useRef(timelineIn);
const timelineOutRef = useRef(timelineOut);
  const physicsForceRef = useRef<PhysicsForce[]>(physicsForces);
  // Rigid-body simulation state: velocity per scene-object id
  const rigidBodyStateRef = useRef<Map<string, { velocity: THREE.Vector3 }>>(new Map());
  // Snapshot of initial world positions captured the moment playback starts — used by resetRigidBodies
  const rigidBodyOriginRef = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());
  // Stable ref to onObjectTransform so the animation loop can call it without stale closure
  const onObjectTransformRef = useRef(onObjectTransform);
  useEffect(() => { onObjectTransformRef.current = onObjectTransform; }, [onObjectTransform]);
  // Throttle: sync rigid-body positions to React state every N frames
  const rigidBodySyncFrameRef = useRef(0);
  const currentFrameRef = useRef(currentFrame);
  const lastTimelineFrameRef = useRef(currentFrame);
  const particleFrameCacheRef = useRef<Map<number, CachedParticleState[]>>(new Map());
  const pathAnimTimesRef = useRef<Map<string, number>>(new Map());
  const pathAnimFreeStateRef = useRef<Map<string, { pos: THREE.Vector3; vel: THREE.Vector3 }>>(new Map());
  const lastFrameTimeRef = useRef<number>(Date.now());
  const cacheCountRef = useRef(0);
  const selectedObjectIdRef = useRef<string | null>(selectedObjectId);
  const selectedForceIdRef = useRef<string | null>(selectedForceId ?? null);
  const onManipulatorModeChangeRef = useRef(onManipulatorModeChange);
  useEffect(() => { onManipulatorModeChangeRef.current = onManipulatorModeChange; }, [onManipulatorModeChange]);
  const isDraggingTransformRef = useRef(false);
    const isDrawingRef = useRef(false);
  // Tracks last-seen sprite key per emitter to detect changes and flush stale particles
  const emitterSpriteKeyRef = useRef<Map<string, string>>(new Map());
  // Per-lightning cyclic strike animation state (loop-strike mode)
  const loopStrikeStateRef = useRef<Map<string, {
    phase:    'growing' | 'holding' | 'fading';
    progress: number;
    seed:     number;
  }>>(new Map());
  const lightningViewportExportRef = useRef<{
    lightningId: string;
    frameIndex: number;
    frameCount: number;
    fps: number;
    mode: 'strike' | 'loop' | 'loop-strike';
  } | null>(null);
    const drawnPointsRef = useRef<THREE.Vector3[]>([]);
    const drawnLineRef = useRef<THREE.Line | null>(null);
    const drawModeRef = useRef(drawMode);
    useEffect(() => {
      drawModeRef.current = drawMode; 
    }, [drawMode]);

  const [isMarqueeSelectMode, setIsMarqueeSelectMode] = useState(false);
  const isMarqueeSelectModeRef = useRef(false);
  useEffect(() => {
    isMarqueeSelectModeRef.current = isMarqueeSelectMode;
  }, [isMarqueeSelectMode]);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);

  const dragOrbitTargetRef = useRef<THREE.Vector3 | null>(null);
  const handlesRef = useRef<{ xArrow: THREE.Mesh; yArrow: THREE.Mesh; zArrow: THREE.Mesh } | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    axis: 'x' | 'y' | 'z' | 'free' | 'free-rotate' | null;
    startX: number;
    startY: number;
    startPos: THREE.Vector3;
    startRot: THREE.Euler;
    startScale: THREE.Vector3;
    dragPlanePoint?: THREE.Vector3;
    dragPlaneNormal?: THREE.Vector3;
  }>(
    {
      active: false,
      axis: null,
      startX: 0,
      startY: 0,
      startPos: new THREE.Vector3(),
      startRot: new THREE.Euler(),
      startScale: new THREE.Vector3(1, 1, 1),
    }
  );
  const [manipulatorMode, setManipulatorMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const manipulatorModeRef = useRef<'translate' | 'rotate' | 'scale'>('translate');


  const createStandardObjectMesh = (objectType: string) => {
    const meshMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a8a8a,
      roughness: 0.62,
      metalness: 0.08,
    });
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x8a8a8a });

    if (objectType === 'Cube') {
      return new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), meshMaterial);
    }
    if (objectType === 'Sphere') {
      return new THREE.Mesh(new THREE.SphereGeometry(18, 24, 16), meshMaterial);
    }
    if (objectType === 'Cylinder') {
      return new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 34, 20), meshMaterial);
    }
    if (objectType === 'Cone') {
      return new THREE.Mesh(new THREE.ConeGeometry(14, 34, 20), meshMaterial);
    }
    if (objectType === 'Plane') {
      return new THREE.Mesh(new THREE.PlaneGeometry(40, 40), meshMaterial);
    }
    if (objectType === 'Torus') {
      return new THREE.Mesh(new THREE.TorusGeometry(18, 5, 14, 28), meshMaterial);
    }
    if (objectType === 'Circle') {
      const circleGeometry = new THREE.CircleGeometry(18, 28);
      return new THREE.Mesh(circleGeometry, meshMaterial);
    }
    if (objectType === 'Rectangle') {
      return new THREE.Mesh(new THREE.PlaneGeometry(36, 20), meshMaterial);
    }
    if (objectType === 'Triangle') {
      const triangleShape = new THREE.Shape();
      triangleShape.moveTo(0, 18);
      triangleShape.lineTo(-18, -14);
      triangleShape.lineTo(18, -14);
      triangleShape.lineTo(0, 18);
      return new THREE.Mesh(new THREE.ShapeGeometry(triangleShape), meshMaterial);
    }
    if (objectType === 'Line') {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-20, 0, 0, 20, 0, 0]), 3));
      return new THREE.Line(geometry, lineMaterial);
    }
    if (objectType === 'Arc') {
      const points: number[] = [];
      const radius = 20;
      const start = -Math.PI * 0.7;
      const end = Math.PI * 0.7;
      const steps = 32;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = start + (end - start) * t;
        points.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
      return new THREE.Line(geometry, lineMaterial);
    }
    if (objectType === 'Polygon') {
      const radius = 18;
      const sides = 6;
      const points: number[] = [];
      for (let i = 0; i <= sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        points.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
      return new THREE.Line(geometry, lineMaterial);
    }

    return new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), meshMaterial);
  };
  
  // Update refs when props change
  useEffect(() => {
    sceneObjectsRef.current = sceneObjects;
  }, [sceneObjects]);

  useEffect(() => {
    sceneSettingsRef.current = sceneSettings;
  }, [sceneSettings]);

  useEffect(() => {
    snapSettingsRef.current = snapSettings;
  }, [snapSettings]);
  
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    const PHYS_EXCLUDED_TYPES = new Set([
      'Emitter', 'PathPoint', 'Force', 'Bone', 'Path', 'Lightning', 'Camera', 'Light',
    ]);
    if (isPlaying) {
      // Snapshot initial positions of all physics-driven objects at play-start
      rigidBodyOriginRef.current.clear();
      physicsForceRef.current.forEach(f => {
        if (!f.enabled) return;
        f.affectedEmitterIds.forEach(id => {
          const o = sceneObjectsRef.current.find(x => x.id === id);
          if (o && !PHYS_EXCLUDED_TYPES.has(o.type)) {
            // Use the THREE mesh position (the authoritative live value)
            const mesh = sceneObjectMeshesRef.current.get(id);
            const px = mesh ? mesh.position.x : o.position.x;
            const py = mesh ? mesh.position.y : o.position.y;
            const pz = mesh ? mesh.position.z : o.position.z;
            if (!rigidBodyOriginRef.current.has(id)) {
              rigidBodyOriginRef.current.set(id, { x: px, y: py, z: pz });
            }
          }
        });
      });
    } else {
      // When playback stops, push final rigid-body positions back to React state
      // so the property panel and timeline reflect where objects landed.
      if (onObjectTransformRef.current) {
        rigidBodyStateRef.current.forEach((_, objId) => {
          const mesh = sceneObjectMeshesRef.current.get(objId);
          const obj = sceneObjectsRef.current.find(o => o.id === objId);
          if (mesh && obj) {
            onObjectTransformRef.current!(
              objId,
              { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
              { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
              { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
            );
          }
        });
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    isCachingRef.current = isCaching;
    }, [isCaching]);

    useEffect(() => {
      timelineInRef.current = timelineIn;
    }, [timelineIn]);

    useEffect(() => {
      timelineOutRef.current = timelineOut;
    }, [timelineOut]);

  useEffect(() => {
    physicsForceRef.current = physicsForces;
  }, [physicsForces]);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    onCacheFrameCountChange?.(particleFrameCacheRef.current.size);
  }, [onCacheFrameCountChange]);

  useEffect(() => {
    selectedObjectIdRef.current = selectedObjectId;
  }, [selectedObjectId]);

  const getViewportSelectedIds = () => {
    const ids = new Set<string>();
    if (selectedObjectIds && selectedObjectIds.length > 0) {
      selectedObjectIds.forEach((id) => ids.add(id));
    } else if (selectedObjectId) {
      ids.add(selectedObjectId);
    }
    return [...ids];
  };

  const clearSelectionOutlines = () => {
    const scene = sceneRef.current;
    selectionOutlineHelpersRef.current.forEach((helper) => {
      if (scene) scene.remove(helper);
      helper.geometry.dispose();
      const material = helper.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    });
    selectionOutlineHelpersRef.current.clear();
  };

  const refreshSelectionOutlines = () => {
    selectionOutlineHelpersRef.current.forEach((helper) => helper.update());
  };

  const rebuildSelectionOutlines = () => {
    const scene = sceneRef.current;
    if (!scene) return;

    clearSelectionOutlines();

    const ids = getViewportSelectedIds();
    ids.forEach((id, index) => {
      const mesh = sceneObjectMeshesRef.current.get(id);
      if (!mesh) return;

      const helper = new THREE.BoxHelper(mesh, index === 0 ? 0xffcc33 : 0x66b3ff);
      helper.name = index === 0 ? 'selection-outline' : `selection-outline-${id}`;
      helper.renderOrder = 999;
      const material = helper.material as THREE.LineBasicMaterial;
      material.depthTest = false;
      material.transparent = true;
      material.opacity = index === 0 ? 0.95 : 0.75;
      material.toneMapped = false;
      helper.visible = mesh.visible;
      helper.update();
      scene.add(helper);
      selectionOutlineHelpersRef.current.set(id, helper);
    });
  };

  useEffect(() => {
    selectedForceIdRef.current = selectedForceId ?? null;
  }, [selectedForceId]);

  // Sync external manipulatorMode prop → internal state
  useEffect(() => {
    if (manipulatorModeProp && manipulatorModeProp !== manipulatorModeRef.current) {
      manipulatorModeRef.current = manipulatorModeProp;
      setManipulatorMode(manipulatorModeProp);
      if (transformControlsRef.current) {
        transformControlsRef.current.setMode(manipulatorModeProp);
      }
    }
  }, [manipulatorModeProp]);

  useEffect(() => {
    manipulatorModeRef.current = manipulatorMode;
  }, [manipulatorMode]);

  useEffect(() => {
    if (!containerRef.current) return;

    const sceneSizeX = Math.max(100, sceneSize.x || 0);
    const sceneSizeY = Math.max(100, sceneSize.y || 0);
    const sceneSizeZ = Math.max(100, sceneSize.z || 0);
    const sceneExtent = Math.max(sceneSizeX, sceneSizeY, sceneSizeZ);
    sceneExtentRef.current = sceneExtent;

    const raycaster = new THREE.Raycaster();
    const mouseNdc = new THREE.Vector2();
    const orbitTarget = new THREE.Vector3();
    const panRight = new THREE.Vector3();
    const panUp = new THREE.Vector3();
    const panDelta = new THREE.Vector3();
    const selectionBounds = new THREE.Box3();
    const selectionSphere = new THREE.Sphere();

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(sceneSettingsRef.current.backgroundColor);
    sceneRef.current = scene;

    // Camera setup
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, sceneExtent * 20);
    camera.position.set(sceneExtent * 0.35, sceneExtent * 0.35, sceneExtent * 0.35);
    camera.lookAt(0, 0, 0);
    perspectiveCameraRef.current = camera;
    currentCameraRef.current = camera;

    // Ensure the whole default system is visible on initial load
    const cubeBoundingRadius = Math.sqrt(
      (sceneSizeX / 2) * (sceneSizeX / 2) +
      (sceneSizeY / 2) * (sceneSizeY / 2) +
      (sceneSizeZ / 2) * (sceneSizeZ / 2)
    );
    const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
    const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
    const fitRadius = cubeBoundingRadius / Math.sin(limitingHalfFov);
    cameraStateRef.current.radius = fitRadius * 0.8;
    const defaultRadius = cameraStateRef.current.radius;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    renderer.setScissorTest(true);

    // Quad-viewport cameras (front/top/side orthographic)
    const _qAspect = width / height;
    const _qExtent = sceneExtent * 0.75;
    const _qD = sceneExtent * 8;
    const _mkOrtho = (aspect: number) =>
      new THREE.OrthographicCamera(-_qExtent * aspect, _qExtent * aspect, _qExtent, -_qExtent, -_qD, _qD);
    const _frontCam = _mkOrtho(_qAspect);
    _frontCam.position.set(0, 0, _qD * 0.5);
    _frontCam.up.set(0, 1, 0);
    _frontCam.lookAt(0, 0, 0);
    const _topCam = _mkOrtho(_qAspect);
    _topCam.position.set(0, _qD * 0.5, 0);
    _topCam.up.set(0, 0, -1);
    _topCam.lookAt(0, 0, 0);
    const _sideCam = _mkOrtho(_qAspect);
    _sideCam.position.set(_qD * 0.5, 0, 0);
    _sideCam.up.set(0, 1, 0);
    _sideCam.lookAt(0, 0, 0);
    quadCamerasRef.current = { front: _frontCam, top: _topCam, side: _sideCam };

          const stats = new Stats();

      const statsDisplay = document.createElement('div');
      statsDisplay.style.position = 'absolute';
      statsDisplay.style.top = '10px';
      statsDisplay.style.right = '10px';
      statsDisplay.style.color = 'rgba(255, 255, 255, 0.6)';
      statsDisplay.style.backgroundColor = 'transparent';
      statsDisplay.style.fontFamily = 'monospace';
      statsDisplay.style.fontSize = '12px';
      statsDisplay.style.pointerEvents = 'none';
      statsDisplay.style.zIndex = '1000';
      statsDisplay.style.textShadow = '1px 1px 1px #000, -1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000';
      statsDisplay.innerText = 'Particles: 0 | Emitters: 0';
      containerRef.current.appendChild(statsDisplay);

    // Transform controls setup
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.setSpace('world');
    transformControls.setSize(1.2);
    transformControlsRef.current = transformControls;
    
    // Listen for transform changes
    transformControls.addEventListener('dragging-changed', (event: any) => {
      // Disable camera controls while dragging
      isDraggingTransformRef.current = event.value;
      if (event.value) {
        mouseStateRef.current.isDown = false;
      }
    });

    transformControls.addEventListener('objectChange', () => {
      // Update object position/rotation in scene objects
      const attachedObject = transformControls.object;
      
      // Update selection outline to follow the object
      if (attachedObject && sceneRef.current) {
        refreshSelectionOutlines();
        
        // Update transform handles to follow the object
        const handles = sceneRef.current.getObjectByName('transform-handles') as THREE.Group;
        if (handles) {
          handles.position.copy(attachedObject.position);
          handles.rotation.copy(attachedObject.rotation);
        }
      }
      
      if (attachedObject && onObjectTransform) {
        // Find the object ID
        let objectId: string | null = null;
        for (const [id, mesh] of sceneObjectMeshesRef.current.entries()) {
          if (mesh === attachedObject) {
            objectId = id;
            break;
          }
        }
        if (objectId) {
          onObjectTransform(
            objectId,
            { x: attachedObject.position.x, y: attachedObject.position.y, z: attachedObject.position.z },
            { x: attachedObject.rotation.x, y: attachedObject.rotation.y, z: attachedObject.rotation.z },
            { x: attachedObject.scale.x, y: attachedObject.scale.y, z: attachedObject.scale.z }
          );
        }
      }
    });

    // Create grid planes (xy, xz, yz)
    const gridSize = sceneExtent;
    const gridDivisions = Math.max(10, Math.round(sceneExtent / 50));
    const gridStep = gridSize / gridDivisions;

    // XY Grid (z = 0)
    const gridXY = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x222222);
    gridXY.position.z = 0;
    if (gridXY.material instanceof THREE.Material) {
      gridXY.material.opacity = sceneSettingsRef.current.gridOpacity;
      gridXY.material.transparent = true;
    }
    scene.add(gridXY);

    // XZ Grid (y = 0)
    const gridXZ = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x222222);
    gridXZ.rotation.x = Math.PI / 2;
    gridXZ.position.y = 0;
    if (gridXZ.material instanceof THREE.Material) {
      gridXZ.material.opacity = sceneSettingsRef.current.gridOpacity;
      gridXZ.material.transparent = true;
    }
    scene.add(gridXZ);

    // YZ Grid (x = 0)
    const gridYZ = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x222222);
    gridYZ.rotation.z = Math.PI / 2;
    gridYZ.position.x = 0;
    if (gridYZ.material instanceof THREE.Material) {
      gridYZ.material.opacity = sceneSettingsRef.current.gridOpacity;
      gridYZ.material.transparent = true;
    }
    scene.add(gridYZ);
    gridHelpersRef.current = [gridXY, gridXZ, gridYZ];

    // Add axis helpers for better visualization
    const axesHelper = new THREE.AxesHelper(60);
    scene.add(axesHelper);

    // Neutral viewport lighting so shaded meshes are visible and readable
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
    keyLight.position.set(sceneExtent * 0.7, sceneExtent, sceneExtent * 0.6);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-sceneExtent * 0.6, sceneExtent * 0.45, -sceneExtent * 0.5);
    scene.add(fillLight);

    // Add colored lines for axes
    const axisLength = sceneExtent / 2;
    
    // X axis (red)
    const xGeometry = new THREE.BufferGeometry();
    xGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, axisLength, 0, 0]),
      3
    ));
    const xLine = new THREE.Line(xGeometry, new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 3 }));
    scene.add(xLine);

    // Y axis (green)
    const yGeometry = new THREE.BufferGeometry();
    yGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 0, axisLength, 0]),
      3
    ));
    const yLine = new THREE.Line(yGeometry, new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3 }));
    scene.add(yLine);

    // Z axis (blue)
    const zGeometry = new THREE.BufferGeometry();
    zGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 0, 0, axisLength]),
      3
    ));
    const zLine = new THREE.Line(zGeometry, new THREE.LineBasicMaterial({ color: 0x0000ff, linewidth: 3 }));
    scene.add(zLine);

    // Create raycaster for handle detection
    const raycasterHandles = new THREE.Raycaster();
    const mouseNdcHandles = new THREE.Vector2();

    const getSnappedPosition = (position: THREE.Vector3) => {
      const snap = snapSettingsRef.current;
      const enabledPlanes: Array<'x' | 'y' | 'z'> = [];
      if (snap.snapX) enabledPlanes.push('x');
      if (snap.snapY) enabledPlanes.push('y');
      if (snap.snapZ) enabledPlanes.push('z');

      if (enabledPlanes.length === 0) {
        return position.clone();
      }

      const snapAxis = (value: number) => Math.round(value / gridStep) * gridStep;
      const getPlaneAxes = (plane: 'x' | 'y' | 'z'): Array<'x' | 'y' | 'z'> => {
        if (plane === 'x') return ['y', 'z'];
        if (plane === 'y') return ['x', 'z'];
        return ['x', 'y'];
      };

      const candidates: THREE.Vector3[] = [];
      enabledPlanes.forEach((plane) => {
        const planeAxes = getPlaneAxes(plane);
        const [axisA, axisB] = planeAxes;

        const vertexCandidate = position.clone();
        vertexCandidate[plane] = 0;
        vertexCandidate[axisA] = snapAxis(vertexCandidate[axisA]);
        vertexCandidate[axisB] = snapAxis(vertexCandidate[axisB]);

        if (snap.snapTarget === 'vertices') {
          candidates.push(vertexCandidate);
          return;
        }

        const lineCandidateA = position.clone();
        lineCandidateA[plane] = 0;
        lineCandidateA[axisA] = snapAxis(lineCandidateA[axisA]);

        const lineCandidateB = position.clone();
        lineCandidateB[plane] = 0;
        lineCandidateB[axisB] = snapAxis(lineCandidateB[axisB]);

        if (snap.snapTarget === 'lines') {
          candidates.push(lineCandidateA, lineCandidateB);
          return;
        }

        candidates.push(vertexCandidate, lineCandidateA, lineCandidateB);
      });

      if (candidates.length === 0) {
        return position.clone();
      }

      return candidates.reduce((best, candidate) => (
        candidate.distanceTo(position) < best.distanceTo(position) ? candidate : best
      ), candidates[0]);
    };

    // Mouse event handlers
    const onMouseDown = (event: MouseEvent) => {
        // In quad viewport mode, detect which panel was clicked and track it
        if (quadViewportRef.current && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const mx = event.clientX - rect.left;
          const my = event.clientY - rect.top;
          const isLeft = mx < rect.width / 2;
          const isTop = my < rect.height / 2;
          let panel: QuadPanel;
          if (isLeft && isTop) panel = 'top';
          else if (!isLeft && isTop) panel = 'front';
          else if (isLeft && !isTop) panel = 'side';
          else panel = 'perspective';
          focusedQuadPanelRef.current = panel;
          setFocusedQuadPanel(panel);
          onQuadPanelClick?.(panel);
        }
        if (drawModeRef.current) {
          isDrawingRef.current = true;
          drawnPointsRef.current = [];
          if (drawnLineRef.current) {
            scene.remove(drawnLineRef.current);
            drawnLineRef.current.geometry.dispose();
            (drawnLineRef.current.material as THREE.Material).dispose();
            drawnLineRef.current = null;
          }
          return;
        }
        if (drawModeRef.current) {
          isDrawingRef.current = true;
          drawnPointsRef.current = [];
          if (drawnLineRef.current) {
            scene.remove(drawnLineRef.current);
            drawnLineRef.current.geometry.dispose();
            (drawnLineRef.current.material as THREE.Material).dispose();
            drawnLineRef.current = null;
          }
          return;
        }
      containerRef.current?.focus();

      // Check if clicking on transform handles (only if Alt is not pressed for camera rotation)
      if (!event.altKey && handlesRef.current && (selectedObjectIdRef.current || selectedForceIdRef.current)) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouseNdcHandles.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseNdcHandles.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        raycasterHandles.setFromCamera(mouseNdcHandles, camera);
        const handleObjects = [handlesRef.current.xArrow, handlesRef.current.yArrow, handlesRef.current.zArrow];
        const hits = raycasterHandles.intersectObjects(handleObjects);
        
        if (hits.length > 0) {
          const hitObject = hits[0].object;
          
          // Start drag
          dragStateRef.current.active = true;
          dragStateRef.current.startX = event.clientX;
          dragStateRef.current.startY = event.clientY;
          isDraggingTransformRef.current = true;
          
          if (hitObject.name === 'x-arrow') dragStateRef.current.axis = 'x';
          else if (hitObject.name === 'y-arrow') dragStateRef.current.axis = 'y';
          else if (hitObject.name === 'z-arrow') dragStateRef.current.axis = 'z';
          
          // Store selected target initial transform (object or force gizmo)
          const selectedMesh = selectedForceIdRef.current
            ? physicsForceGizmosRef.current.get(selectedForceIdRef.current)
            : (selectedObjectIdRef.current ? sceneObjectMeshesRef.current.get(selectedObjectIdRef.current) : null);
          if (selectedMesh) {
            dragStateRef.current.startPos.copy(selectedMesh.position);
            dragStateRef.current.startRot.copy(selectedMesh.rotation);
            dragStateRef.current.startScale.copy(selectedMesh.scale);

            // Lock camera orbit to current view target to prevent jumping
            const cameraState = cameraStateRef.current;
            dragOrbitTargetRef.current = new THREE.Vector3(
              cameraState.viewOffsetX,
              cameraState.viewOffsetY,
              cameraState.viewOffsetZ
            );
          }
          
          event.preventDefault();
          return;
        }
        
        // Check if clicking on any object to select and start drag
        if (!event.altKey && event.button === 0) {
          const rect = renderer.domElement.getBoundingClientRect();
          mouseNdcHandles.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          mouseNdcHandles.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

          raycasterHandles.setFromCamera(mouseNdcHandles, camera);
          
          let clickedObjectId: string | null = null;
          let selectedMesh: THREE.Object3D | null = null;
          let hitPoint: THREE.Vector3 | null = null;

          const selectableObjects: THREE.Object3D[] = [];
          sceneObjectMeshesRef.current.forEach(mesh => selectableObjects.push(mesh));
          const objectHits = raycasterHandles.intersectObjects(selectableObjects, true);

          if (objectHits.length > 0) {
            for (const [id, mesh] of sceneObjectMeshesRef.current.entries()) {
              let obj: THREE.Object3D | null = objectHits[0].object;
              while (obj) {
                if (obj === mesh) {
                  clickedObjectId = id;
                  break;
                }
                obj = obj.parent;
              }
              if (clickedObjectId) {
                selectedMesh = mesh;
                hitPoint = objectHits[0].point;
                break;
              }
            }
          }

          if (clickedObjectId && selectedMesh && hitPoint) {
            if (clickedObjectId !== selectedObjectIdRef.current) {
              onObjectSelect(clickedObjectId);
              onForceSelect?.(null);
              selectedForceIdRef.current = null;
              selectedObjectIdRef.current = clickedObjectId;
              selectedObjectRef.current = selectedMesh;
            }
            const objectHits = [{ point: hitPoint }]; // Mock structure for underlying logic
            if (true) {              const mode = manipulatorModeRef.current; // eslint-disable-line
              
              // Rotate mode: free-rotate with mouse. Scale: closest axis. Translate: free drag.
              if (mode === 'rotate') {
                // Free rotation — no axis constraint
                dragStateRef.current.active = true;
                dragStateRef.current.axis = 'free-rotate';
                dragStateRef.current.startX = event.clientX;
                dragStateRef.current.startY = event.clientY;
                dragStateRef.current.startPos.copy(selectedMesh.position);
                dragStateRef.current.startRot.copy(selectedMesh.rotation);
                dragStateRef.current.startScale.copy(selectedMesh.scale);
                isDraggingTransformRef.current = true;
                const cameraState0 = cameraStateRef.current;
                dragOrbitTargetRef.current = new THREE.Vector3(
                  cameraState0.viewOffsetX,
                  cameraState0.viewOffsetY,
                  cameraState0.viewOffsetZ
                );
              } else if (mode === 'scale') {
                // Get mouse position in 3D
                const hitPoint = objectHits[0].point;
                const objPos = selectedMesh.position;
                
                // Calculate distance from hit point to each handle
                const handlePositions = {
                  x: new THREE.Vector3(120 * handleScale, 0, 0).add(objPos),
                  y: new THREE.Vector3(0, 120 * handleScale, 0).add(objPos),
                  z: new THREE.Vector3(0, 0, 120 * handleScale).add(objPos)
                };
                
                const distances = {
                  x: hitPoint.distanceTo(handlePositions.x),
                  y: hitPoint.distanceTo(handlePositions.y),
                  z: hitPoint.distanceTo(handlePositions.z)
                };
                
                // Find closest axis
                let closestAxis: 'x' | 'y' | 'z' = 'x';
                let minDist = distances.x;
                if (distances.y < minDist) {
                  closestAxis = 'y';
                  minDist = distances.y;
                }
                if (distances.z < minDist) {
                  closestAxis = 'z';
                }
                
                // Start constrained drag with closest axis
                dragStateRef.current.active = true;
                dragStateRef.current.axis = closestAxis;
                dragStateRef.current.startX = event.clientX;
                dragStateRef.current.startY = event.clientY;
                dragStateRef.current.startPos.copy(selectedMesh.position);
                dragStateRef.current.startRot.copy(selectedMesh.rotation);
                dragStateRef.current.startScale.copy(selectedMesh.scale);
                isDraggingTransformRef.current = true;
                
                // Lock camera orbit
                const cameraState = cameraStateRef.current;
                dragOrbitTargetRef.current = new THREE.Vector3(
                  cameraState.viewOffsetX,
                  cameraState.viewOffsetY,
                  cameraState.viewOffsetZ
                );
              } else {
                // For translate mode, use free drag
                dragStateRef.current.active = true;
                dragStateRef.current.axis = 'free';
                dragStateRef.current.startX = event.clientX;
                dragStateRef.current.startY = event.clientY;
                dragStateRef.current.startPos.copy(selectedMesh.position);
                dragStateRef.current.startRot.copy(selectedMesh.rotation);
                dragStateRef.current.startScale.copy(selectedMesh.scale);
                isDraggingTransformRef.current = true;
                
                // Create drag plane perpendicular to camera view
                const cameraDirection = new THREE.Vector3();
                camera.getWorldDirection(cameraDirection);
                dragStateRef.current.dragPlaneNormal = cameraDirection.normalize();
                dragStateRef.current.dragPlanePoint = selectedMesh.position.clone();
                
                // Lock camera orbit
                const cameraState = cameraStateRef.current;
                dragOrbitTargetRef.current = new THREE.Vector3(
                  cameraState.viewOffsetX,
                  cameraState.viewOffsetY,
                  cameraState.viewOffsetZ
                );
              }
              
              event.preventDefault();
              return;
            }
          }
        }
      }

      // Check if clicking on a physics force gizmo to select and drag it (runs regardless of current selection)
      if (!event.altKey && event.button === 0) {
        const rect2 = renderer.domElement.getBoundingClientRect();
        const mx2 = ((event.clientX - rect2.left) / rect2.width) * 2 - 1;
        const my2 = -((event.clientY - rect2.top) / rect2.height) * 2 + 1;
        raycasterHandles.setFromCamera(new THREE.Vector2(mx2, my2), camera);

        const forceGizmoObjects: THREE.Object3D[] = [];
        physicsForceGizmosRef.current.forEach(gizmo => forceGizmoObjects.push(gizmo));
        const gizmoHits = raycasterHandles.intersectObjects(forceGizmoObjects, true);

        if (gizmoHits.length > 0) {
          let clickedForceId: string | null = null;
          let clickedGizmo: THREE.Object3D | null = null;

          for (const [id, gizmo] of physicsForceGizmosRef.current.entries()) {
            let obj: THREE.Object3D | null = gizmoHits[0].object;
            while (obj) {
              if (obj === gizmo) {
                clickedForceId = id;
                break;
              }
              obj = obj.parent;
            }
            if (clickedForceId) {
              clickedGizmo = gizmo;
              break;
            }
          }

          if (clickedForceId && clickedGizmo) {
            onObjectSelect(null);
            onForceSelect?.(clickedForceId);
            selectedForceIdRef.current = clickedForceId;
            selectedObjectIdRef.current = null;
            selectedObjectRef.current = null;

            dragStateRef.current.active = true;
            dragStateRef.current.axis = 'free';
            dragStateRef.current.startX = event.clientX;
            dragStateRef.current.startY = event.clientY;
            dragStateRef.current.startPos.copy(clickedGizmo.position);
            dragStateRef.current.startRot.copy(clickedGizmo.rotation);
            dragStateRef.current.startScale.copy(clickedGizmo.scale);
            isDraggingTransformRef.current = true;

            const cameraDir = new THREE.Vector3();
            camera.getWorldDirection(cameraDir);
            dragStateRef.current.dragPlaneNormal = cameraDir.normalize();
            dragStateRef.current.dragPlanePoint = clickedGizmo.position.clone();

            const cs = cameraStateRef.current;
            dragOrbitTargetRef.current = new THREE.Vector3(cs.viewOffsetX, cs.viewOffsetY, cs.viewOffsetZ);

            event.preventDefault();
            return;
          }
        }
      }

      // If left-click hit nothing (no object, no handle), start a marquee drag-select
      // Ctrl+LMB only.
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.button === 0) {
        marqueeStartRef.current = { x: event.clientX, y: event.clientY };
        if (marqueeRef.current) {
          const parentRect = ((marqueeRef.current.offsetParent ?? marqueeRef.current.parentElement) as HTMLElement).getBoundingClientRect();
          marqueeRef.current.style.display = 'block';
          marqueeRef.current.style.left = `${event.clientX - parentRect.left}px`;
          marqueeRef.current.style.top = `${event.clientY - parentRect.top}px`;
          marqueeRef.current.style.width = '0px';
          marqueeRef.current.style.height = '0px';
        }
      }

      const isRotateStart = event.altKey && event.button === 0;
      const isPanStart = event.altKey && event.button === 2;
      const isSelectStart = !event.altKey && !event.shiftKey && event.button === 0;

      if (!isRotateStart && !isPanStart && !isSelectStart) return;
      
      // Only preventDefault for camera controls, not for selection
      if (isRotateStart || isPanStart) {
        event.preventDefault();
      }
      
      mouseStateRef.current.isDown = true;
      mouseStateRef.current.button = event.button;
      mouseStateRef.current.x = event.clientX;
      mouseStateRef.current.y = event.clientY;
      mouseStateRef.current.deltaX = 0;
      mouseStateRef.current.deltaY = 0;
      mouseStateRef.current.altKey = event.altKey;
      mouseStateRef.current.shiftKey = event.shiftKey;
    };

    const onMouseMove = (event: MouseEvent) => {
        if (drawModeRef.current && isDrawingRef.current) {
          const rect = renderer.domElement.getBoundingClientRect();
          const mouseNd = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
          raycasterHandles.setFromCamera(mouseNd, camera);
          const planeNormal = new THREE.Vector3();
          camera.getWorldDirection(planeNormal);
          planeNormal.negate();
          const target = dragOrbitTargetRef.current || new THREE.Vector3(0, 0, 0);
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, target);
          const intersectPoint = new THREE.Vector3();
          raycasterHandles.ray.intersectPlane(plane, intersectPoint);
          if (intersectPoint) {
            drawnPointsRef.current.push(intersectPoint.clone());
            if (!drawnLineRef.current) {
              const geo = new THREE.BufferGeometry().setFromPoints(drawnPointsRef.current);
              const mat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
              const line = new THREE.Line(geo, mat);
              drawnLineRef.current = line;
              scene.add(line);
            } else {
              drawnLineRef.current.geometry.setFromPoints(drawnPointsRef.current);
            }
          }
          return;
        }
        if (drawModeRef.current && isDrawingRef.current) {
          const rect = renderer.domElement.getBoundingClientRect();
          const mouseNd = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
          raycasterHandles.setFromCamera(mouseNd, camera);
          const planeNormal = new THREE.Vector3();
          camera.getWorldDirection(planeNormal);
          planeNormal.negate();
          const target = dragOrbitTargetRef.current || new THREE.Vector3(0, 0, 0);
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, target);
          const intersectPoint = new THREE.Vector3();
          raycasterHandles.ray.intersectPlane(plane, intersectPoint);
          if (intersectPoint) {
            drawnPointsRef.current.push(intersectPoint.clone());
            if (!drawnLineRef.current) {
              const geo = new THREE.BufferGeometry().setFromPoints(drawnPointsRef.current);
              const mat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
              const line = new THREE.Line(geo, mat);
              drawnLineRef.current = line;
              scene.add(line);
            } else {
              drawnLineRef.current.geometry.setFromPoints(drawnPointsRef.current);
            }
          }
          return;
        }

      if (marqueeStartRef.current && mouseStateRef.current.isDown && mouseStateRef.current.button === 0) {
        if (marqueeRef.current) {
          const parentRect = ((marqueeRef.current.offsetParent ?? marqueeRef.current.parentElement) as HTMLElement).getBoundingClientRect();
          const startX = marqueeStartRef.current.x - parentRect.left;
          const startY = marqueeStartRef.current.y - parentRect.top;
          const currentX = event.clientX - parentRect.left;
          const currentY = event.clientY - parentRect.top;
          
          const left = Math.min(startX, currentX);
          const top = Math.min(startY, currentY);
          const width = Math.abs(currentX - startX);
          const height = Math.abs(currentY - startY);
          
          marqueeRef.current.style.left = `${left}px`;
          marqueeRef.current.style.top = `${top}px`;
          marqueeRef.current.style.width = `${width}px`;
          marqueeRef.current.style.height = `${height}px`;
        }
        return;
      }

      // Handle free dragging
      if (dragStateRef.current.active && dragStateRef.current.axis === 'free') {
        const selectedMesh = selectedForceIdRef.current
          ? physicsForceGizmosRef.current.get(selectedForceIdRef.current)
          : (selectedObjectIdRef.current ? sceneObjectMeshesRef.current.get(selectedObjectIdRef.current) : null);
        if (selectedMesh && dragStateRef.current.dragPlaneNormal && dragStateRef.current.dragPlanePoint) {
          const rect = renderer.domElement.getBoundingClientRect();
          const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          
          // Create ray from camera through mouse position
          raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
          
          // Intersect with drag plane
          const plane = new THREE.Plane();
          plane.setFromNormalAndCoplanarPoint(
            dragStateRef.current.dragPlaneNormal,
            dragStateRef.current.dragPlanePoint
          );
          
          const intersection = new THREE.Vector3();
          raycaster.ray.intersectPlane(plane, intersection);
          
          if (intersection) {
            selectedMesh.position.copy(getSnappedPosition(intersection));
            dragStateRef.current.dragPlanePoint = intersection.clone();
            
            // Update outline and handles
            if (sceneRef.current) {
              refreshSelectionOutlines();
              const handles = sceneRef.current.getObjectByName('transform-handles');
              if (handles) {
                handles.position.copy(selectedMesh.position);
                handles.rotation.copy(selectedMesh.rotation);
              }
            }
          }
        }
        return;
      }
      
      // Handle free rotation (rotate mode, no axis handle)
      if (dragStateRef.current.active && dragStateRef.current.axis === 'free-rotate' && selectedObjectIdRef.current) {
        const selectedMesh = sceneObjectMeshesRef.current.get(selectedObjectIdRef.current);
        if (selectedMesh) {
          const dx = event.clientX - dragStateRef.current.startX;
          const dy = event.clientY - dragStateRef.current.startY;
          const sensitivity = 0.007;

          // Yaw: mouse X → rotate around world Y axis
          const yawQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), -dx * sensitivity
          );
          // Pitch: mouse Y → rotate around camera's right axis
          const cameraForward = new THREE.Vector3();
          camera.getWorldDirection(cameraForward);
          const cameraRight = new THREE.Vector3().crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();
          const pitchQuat = new THREE.Quaternion().setFromAxisAngle(cameraRight, -dy * sensitivity);

          // Apply incremental world-space rotation
          const deltaQuat = new THREE.Quaternion().multiplyQuaternions(pitchQuat, yawQuat);
          selectedMesh.quaternion.multiplyQuaternions(deltaQuat, selectedMesh.quaternion);
          selectedMesh.rotation.setFromQuaternion(selectedMesh.quaternion);

          // Update outline and handles
          if (sceneRef.current) {
            refreshSelectionOutlines();
            const handles = sceneRef.current.getObjectByName('transform-handles');
            if (handles) {
              handles.rotation.copy(selectedMesh.rotation);
            }
          }

          dragStateRef.current.startX = event.clientX;
          dragStateRef.current.startY = event.clientY;
        }
        return;
      }

      // Handle arrow dragging
      if (dragStateRef.current.active && dragStateRef.current.axis) {
        const selectedMesh = selectedForceIdRef.current
          ? physicsForceGizmosRef.current.get(selectedForceIdRef.current)
          : (selectedObjectIdRef.current ? sceneObjectMeshesRef.current.get(selectedObjectIdRef.current) : null);
        if (selectedMesh) {
          const deltaX = event.clientX - dragStateRef.current.startX;
          const deltaY = event.clientY - dragStateRef.current.startY;
          const mode = manipulatorModeRef.current;
          const axis = dragStateRef.current.axis as 'x' | 'y' | 'z';

          const axisLocal =
            axis === 'x'
              ? new THREE.Vector3(1, 0, 0)
              : axis === 'y'
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, 1);
          const axisWorld = axisLocal.clone().applyQuaternion(selectedMesh.quaternion).normalize();

          const objectWorldPos = new THREE.Vector3();
          selectedMesh.getWorldPosition(objectWorldPos);
          const axisTipWorld = objectWorldPos.clone().add(axisWorld);

          const objectScreen = objectWorldPos.clone().project(camera);
          const tipScreen = axisTipWorld.clone().project(camera);
          const axisScreen = new THREE.Vector2(tipScreen.x - objectScreen.x, tipScreen.y - objectScreen.y);
          const mouseDeltaScreen = new THREE.Vector2(
            (deltaX / renderer.domElement.clientWidth) * 2,
            (-deltaY / renderer.domElement.clientHeight) * 2
          );

          let axisDragDelta = 0;
          const axisScreenLength = axisScreen.length();
          if (axisScreenLength > 0.000001) {
            axisScreen.divideScalar(axisScreenLength);
            axisDragDelta = mouseDeltaScreen.dot(axisScreen);
          } else {
            axisDragDelta = (deltaX - deltaY) * 0.001;
          }

          if (mode === 'translate') {
            const newPos = dragStateRef.current.startPos.clone();
            const moveDistance = axisDragDelta * sceneExtent * 0.75;

            if (axis === 'x') {
              newPos.x += moveDistance;
            } else if (axis === 'y') {
              newPos.y += moveDistance;
            } else if (axis === 'z') {
              newPos.z += moveDistance;
            }

            selectedMesh.position.copy(getSnappedPosition(newPos));
            dragStateRef.current.startPos.copy(selectedMesh.position);
          } else if (mode === 'rotate') {
            const rotateAmount = axisDragDelta * Math.PI;
            const newRot = dragStateRef.current.startRot.clone();

            if (axis === 'x') {
              newRot.x += rotateAmount;
            } else if (axis === 'y') {
              newRot.y += rotateAmount;
            } else if (axis === 'z') {
              newRot.z += rotateAmount;
            }

            selectedMesh.rotation.copy(newRot);
            dragStateRef.current.startRot.copy(newRot);
          } else {
            const scaleAmount = 1 + axisDragDelta * 2;
            const safeScaleAmount = Math.max(0.05, scaleAmount);
            const newScale = dragStateRef.current.startScale.clone();

            if (axis === 'x') {
              newScale.x = Math.max(0.05, newScale.x * safeScaleAmount);
            } else if (axis === 'y') {
              newScale.y = Math.max(0.05, newScale.y * safeScaleAmount);
            } else if (axis === 'z') {
              newScale.z = Math.max(0.05, newScale.z * safeScaleAmount);
            }

            selectedMesh.scale.copy(newScale);
            dragStateRef.current.startScale.copy(newScale);
          }
          
          // Update outline and handles
          if (sceneRef.current) {
            refreshSelectionOutlines();
            const handles = sceneRef.current.getObjectByName('transform-handles');
            if (handles) {
              handles.position.copy(selectedMesh.position);
              handles.rotation.copy(selectedMesh.rotation);
            }
          }
          
          // Store cursor baseline for incremental drag
          dragStateRef.current.startX = event.clientX;
          dragStateRef.current.startY = event.clientY;
        }
        return;
      }

      // If dragging the custom handles, don't handle camera movement
      if (isDraggingTransformRef.current) {
        return;
      }

      if (!mouseStateRef.current.isDown) return;

      const deltaX = event.clientX - mouseStateRef.current.x;
      const deltaY = event.clientY - mouseStateRef.current.y;
      mouseStateRef.current.deltaX += Math.abs(deltaX);
      mouseStateRef.current.deltaY += Math.abs(deltaY);

      const cameraState = cameraStateRef.current;
      const sensitivity = 0.01;

      if (mouseStateRef.current.altKey && mouseStateRef.current.button === 0) {
        // Rotate with alt+lmb (only in perspective mode)
        if (!isOrthoRef.current) {
          cameraState.isAnimating = false;
          cameraState.theta -= deltaX * sensitivity;
          cameraState.phi -= deltaY * sensitivity;
          cameraState.phi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraState.phi));
          cameraState.targetTheta = cameraState.theta;
          cameraState.targetPhi = cameraState.phi;
        }
      } else if (mouseStateRef.current.altKey && mouseStateRef.current.button === 2) {
        // Pan with alt+rmb
        const panSpeed = Math.max(0.01, cameraState.radius * 0.002);

        camera.updateMatrixWorld();
        panRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        panUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
        panDelta
          .copy(panRight)
          .multiplyScalar(-deltaX * panSpeed)
          .addScaledVector(panUp, deltaY * panSpeed);

        cameraState.viewOffsetX += panDelta.x;
        cameraState.viewOffsetY += panDelta.y;
        cameraState.viewOffsetZ += panDelta.z;
      }

      mouseStateRef.current.x = event.clientX;
      mouseStateRef.current.y = event.clientY;
    };

    const onMouseUp = (event: MouseEvent) => {
        if (drawModeRef.current && isDrawingRef.current) {
          isDrawingRef.current = false;
          if (drawnPointsRef.current.length > 2 && onDrawComplete) {
            onDrawComplete(drawnPointsRef.current.map(p => ({ x: p.x, y: p.y, z: p.z })));
          }
          if (drawnLineRef.current) {
            scene.remove(drawnLineRef.current);
            drawnLineRef.current.geometry.dispose();
            (drawnLineRef.current.material as THREE.Material).dispose();
            drawnLineRef.current = null;
          }
          drawnPointsRef.current = [];
          return;
        }

        if (marqueeStartRef.current) {
          if (marqueeRef.current) marqueeRef.current.style.display = 'none';
          const endX = event.clientX;
          const endY = event.clientY;
          const startX = marqueeStartRef.current.x;
          const startY = marqueeStartRef.current.y;
          
          if (Math.abs(endX - startX) > 5 || Math.abs(endY - startY) > 5) {
             const rect = renderer.domElement.getBoundingClientRect();
             const minX = Math.min(startX, endX) - rect.left;
             const maxX = Math.max(startX, endX) - rect.left;
             const minY = Math.min(startY, endY) - rect.top;
             const maxY = Math.max(startY, endY) - rect.top;
             
             const marqueeSelectedIds: string[] = [];
             // project objects
             for (const [id, mesh] of sceneObjectMeshesRef.current.entries()) {
               const pos = new THREE.Vector3();
               mesh.getWorldPosition(pos);
               pos.project(camera);
               // POS is in NDC (-1 to +1)
               const screenX = (pos.x * 0.5 + 0.5) * rect.width;
               const screenY = (-(pos.y) * 0.5 + 0.5) * rect.height;
               
               if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) {
                 marqueeSelectedIds.push(id);
               }
             }
             if (marqueeSelectedIds.length > 0) {
                if (onMultiObjectSelect) {
                  onMultiObjectSelect(marqueeSelectedIds);
                } else {
                  onObjectSelect(marqueeSelectedIds[0]);
                }
                onForceSelect?.(null);
                selectedForceIdRef.current = null;
                selectedObjectRef.current = sceneObjectMeshesRef.current.get(marqueeSelectedIds[0]) || null;
             } else {
                if (onMultiObjectSelect) onMultiObjectSelect([]);
                onObjectSelect(null);
                selectedObjectRef.current = null;
             }
             
             marqueeStartRef.current = null;
             mouseStateRef.current.isDown = false;
             mouseStateRef.current.button = -1;
             return;
          } else {
             marqueeStartRef.current = null; // Too small to be a marquee drag, fall through to click select
          }
        }
      // End arrow drag
      if (dragStateRef.current.active) {
        // Update state when drag ends
        if (selectedForceIdRef.current && onForceTransform) {
          const forceGizmo = physicsForceGizmosRef.current.get(selectedForceIdRef.current);
          if (forceGizmo) {
            const existingForce = physicsForceRef.current.find((f) => f.id === selectedForceIdRef.current);
            const direction = existingForce?.direction ?? { x: 0, y: 1, z: 0 };
            onForceTransform(
              selectedForceIdRef.current,
              { x: forceGizmo.position.x, y: forceGizmo.position.y, z: forceGizmo.position.z },
              direction,
            );
          }
        } else if (selectedObjectIdRef.current && onObjectTransform) {
          const selectedMesh = sceneObjectMeshesRef.current.get(selectedObjectIdRef.current);
          if (selectedMesh) {
            onObjectTransform(
              selectedObjectIdRef.current,
              { x: selectedMesh.position.x, y: selectedMesh.position.y, z: selectedMesh.position.z },
              { x: selectedMesh.rotation.x, y: selectedMesh.rotation.y, z: selectedMesh.rotation.z },
              { x: selectedMesh.scale.x, y: selectedMesh.scale.y, z: selectedMesh.scale.z }
            );
          }
        }
        
        dragStateRef.current.active = false;
        dragStateRef.current.axis = null;
        isDraggingTransformRef.current = false;
        dragOrbitTargetRef.current = null;
        return;
      }

      if (event.button !== mouseStateRef.current.button) return;

      // If custom handles were being used, skip selection
      if (isDraggingTransformRef.current) {
        mouseStateRef.current.isDown = false;
        mouseStateRef.current.button = -1;
        return;
      }

      const wasClick = mouseStateRef.current.deltaX + mouseStateRef.current.deltaY < 4;
      const isModifierAction = mouseStateRef.current.altKey || mouseStateRef.current.shiftKey;

      // Only handle selection if it was a click, not during transform dragging, and no modifiers
      if (wasClick && !isModifierAction && !isDraggingTransformRef.current && containerRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouseNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouseNdc, camera);

        // Filter to only scene object meshes (recursive to check children of groups)
        const selectableObjects: THREE.Object3D[] = [];
        sceneObjectMeshesRef.current.forEach(mesh => selectableObjects.push(mesh));
        const hits = raycaster.intersectObjects(selectableObjects, true);

        if (hits.length > 0) {
          // Find the object ID for the clicked mesh (or its parent group)
          let clickedObjectId: string | null = null;
          for (const [id, mesh] of sceneObjectMeshesRef.current.entries()) {
            // Traverse up the parent chain to find the root mesh
            let obj: THREE.Object3D | null = hits[0].object;
            while (obj) {
              if (obj === mesh) {
                clickedObjectId = id;
                break;
              }
              obj = obj.parent;
            }
            if (clickedObjectId) break;
          }
          onObjectSelect(clickedObjectId);
          selectedObjectRef.current = hits[0].object;
        } else {
          onObjectSelect(null);
          selectedObjectRef.current = null;
        }
      }

      mouseStateRef.current.isDown = false;
      mouseStateRef.current.button = -1;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraStateRef.current.radius += event.deltaY * sceneSettingsRef.current.zoomSpeed / 100;
      cameraStateRef.current.radius = Math.max(10, Math.min(sceneExtent * 10, cameraStateRef.current.radius));
    };

    const applyFocusSceneCenter = () => {
      const cameraState = cameraStateRef.current;
      cameraState.theta = DEFAULT_THETA;
      cameraState.phi = DEFAULT_PHI;
      cameraState.radius = defaultRadius;
      cameraState.viewOffsetX = 0;
      cameraState.viewOffsetY = 0;
      cameraState.viewOffsetZ = 0;
    };

    const applyFocusSelectedObject = () => {
      const cameraState = cameraStateRef.current;
      const selectedMesh = selectedObjectIdRef.current
        ? sceneObjectMeshesRef.current.get(selectedObjectIdRef.current)
        : null;

      if (selectedMesh) {
        selectedMesh.getWorldPosition(orbitTarget);
        cameraState.viewOffsetX = orbitTarget.x;
        cameraState.viewOffsetY = orbitTarget.y;
        cameraState.viewOffsetZ = orbitTarget.z;

        selectionBounds.setFromObject(selectedMesh);
        if (!selectionBounds.isEmpty()) {
          selectionBounds.getBoundingSphere(selectionSphere);
          const minRadius = Math.max(1, selectionSphere.radius * 2.4);
          cameraState.radius = Math.max(10, Math.min(sceneExtent * 10, minRadius));
        }
      }
    };
    
    focusSelectedObjectRef.current = applyFocusSelectedObject;

    const onKeyUp = (event: KeyboardEvent) => {
      const isAKey = event.code === 'KeyA' || event.key.toLowerCase() === 'a';
      const isFKey = event.code === 'KeyF' || event.key.toLowerCase() === 'f';
      const isWKey = event.code === 'KeyW' || event.key.toLowerCase() === 'w';
      const isEKey = event.code === 'KeyE' || event.key.toLowerCase() === 'e';
      const isRKey = event.code === 'KeyR' || event.key.toLowerCase() === 'r';

      if (isAKey) {
        event.preventDefault();
        applyFocusSceneCenter();
        return;
      }

      if (isFKey) {
        event.preventDefault();
        applyFocusSelectedObject();
        return;
      }

      // Transform controls mode switching
      if (transformControlsRef.current) {
        if (isWKey) {
          event.preventDefault();
          transformControlsRef.current.setMode('translate');
          manipulatorModeRef.current = 'translate';
          setManipulatorMode('translate');
          onManipulatorModeChangeRef.current?.('translate');
        } else if (isEKey) {
          event.preventDefault();
          transformControlsRef.current.setMode('rotate');
          manipulatorModeRef.current = 'rotate';
          setManipulatorMode('rotate');
          onManipulatorModeChangeRef.current?.('rotate');
        } else if (isRKey) {
          event.preventDefault();
          transformControlsRef.current.setMode('scale');
          manipulatorModeRef.current = 'scale';
          setManipulatorMode('scale');
          onManipulatorModeChangeRef.current?.('scale');
        }
      }
    };

    if (containerRef.current) {
      containerRef.current.addEventListener('mousedown', onMouseDown);
      containerRef.current.addEventListener('contextmenu', (e) => e.preventDefault());
      containerRef.current.addEventListener('wheel', onWheel, { passive: false });
    }
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    const particleTextureCache = new Map<string, THREE.CanvasTexture>();
    const spriteTextureCache = new Map<string, THREE.Texture>();
    const textureLoader = new THREE.TextureLoader();

    // Animation loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const activeCamera = currentCameraRef.current;
      if (!activeCamera) return;

      if (onCameraChange && activeCamera) {
        // Track changes
        if (!(activeCamera as any)._lastQ) { (activeCamera as any)._lastQ = new THREE.Quaternion(); (activeCamera as any)._lastP = new THREE.Vector3(); }
        if (!(activeCamera as any)._lastQ.equals(activeCamera.quaternion) || !(activeCamera as any)._lastP.equals(activeCamera.position)) {
          (activeCamera as any)._lastQ.copy(activeCamera.quaternion);
          (activeCamera as any)._lastP.copy(activeCamera.position);
          onCameraChange({ position: activeCamera.position.clone(), quaternion: activeCamera.quaternion.clone() });
        }
      }
      stats.update();

      const cameraState = cameraStateRef.current;

      // Animate camera angles if needed
      if (cameraState.isAnimating) {
        const lerpSpeed = 0.1;
        const thetaDiff = cameraState.targetTheta - cameraState.theta;
        const phiDiff = cameraState.targetPhi - cameraState.phi;
        
        cameraState.theta += thetaDiff * lerpSpeed;
        cameraState.phi += phiDiff * lerpSpeed;
        
        // Stop animating when close enough
        if (Math.abs(thetaDiff) < 0.001 && Math.abs(phiDiff) < 0.001) {
          cameraState.theta = cameraState.targetTheta;
          cameraState.phi = cameraState.targetPhi;
          cameraState.isAnimating = false;
        }
      }

      // Update camera position based on type
      if (activeCamera instanceof THREE.PerspectiveCamera) {
        // Update perspective camera position based on spherical coordinates
        const sin_phi = Math.sin(cameraState.phi);
        const cos_phi = Math.cos(cameraState.phi);
        const orbitOffset = (sceneSettingsRef.current.cameraOrbitSpeed || 0) * (currentFrameRef.current / 24) * (Math.PI / 180);
        const effectiveTheta = cameraState.theta + orbitOffset;
        const sin_theta = Math.sin(effectiveTheta);
        const cos_theta = Math.cos(effectiveTheta);

        orbitTarget.set(0, 0, 0);
        if (isDraggingTransformRef.current && dragOrbitTargetRef.current) {
          orbitTarget.copy(dragOrbitTargetRef.current);
        } else {
          orbitTarget.x += cameraState.viewOffsetX;
          orbitTarget.y += cameraState.viewOffsetY;
          orbitTarget.z += cameraState.viewOffsetZ;
        }

        activeCamera.position.x = orbitTarget.x + cameraState.radius * sin_phi * sin_theta;
        activeCamera.position.y = orbitTarget.y + cameraState.radius * cos_phi;
        activeCamera.position.z = orbitTarget.z + cameraState.radius * sin_phi * cos_theta;

        activeCamera.lookAt(orbitTarget.x, orbitTarget.y, orbitTarget.z);
      } else if (activeCamera instanceof THREE.OrthographicCamera) {
        // Update orthographic camera - apply pan offsets
        const basePos = new THREE.Vector3();
        const lookAtPos = new THREE.Vector3();
        
        // Get base position and direction based on view mode
        if (viewMode === 'x') {
          basePos.set(sceneExtent * 0.75, 0, 0);
        } else if (viewMode === 'y') {
          basePos.set(0, sceneExtent * 0.75, 0);
        } else if (viewMode === 'z') {
          basePos.set(0, 0, sceneExtent * 0.75);
        }
        
        // Apply pan offsets
        const offsetX = cameraState.viewOffsetX;
        const offsetY = cameraState.viewOffsetY;
        const offsetZ = cameraState.viewOffsetZ;
        
        basePos.x += offsetX;
        basePos.y += offsetY;
        basePos.z += offsetZ;
        
        lookAtPos.set(offsetX, offsetY, offsetZ);
        
        activeCamera.position.copy(basePos);
        activeCamera.lookAt(lookAtPos);
      }

      const getParticleTexture = (particleType: ParticleVisualType, customGlow: boolean, metalness: number = 0.9, roughness: number = 0.15, metalSheen: number = 0, sheenColor: string = '#ffffff') => {
        const textureType = particleType === 'dots' && !customGlow ? 'circles' : particleType;
        const key = `${textureType}:${customGlow ? '1' : '0'}:${textureType === 'metallic-sphere' ? `m${metalness.toFixed(2)}r${roughness.toFixed(2)}` : ''}:s${(metalSheen > 0 ? `${metalSheen.toFixed(0)}${sheenColor}` : '0')}`;
        const cached = particleTextureCache.get(key);
        if (cached) return cached;

        // High-res for glow types, standard for simple shapes
        const isGlowType = textureType === 'glow-circles' || textureType === 'stars' || textureType === 'sparkle' || textureType === 'glitter' || textureType === 'metallic-sphere';
        const size = isGlowType ? 256 : 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        ctx.clearRect(0, 0, size, size);
        const C = size / 2; // center
        const R = size * 0.45; // max radius

        // ── Shared helpers ────────────────────────────────────────────────
        const radGrad = (r0: number, r1: number, stops: [number, string][]) => {
          const g = ctx.createRadialGradient(C, C, r0, C, C, r1);
          stops.forEach(([t, c]) => g.addColorStop(t, c));
          return g;
        };
        const fillSpike = (angleRad: number, widthScale: number, lengthScale: number) => {
          // Draw a very narrow spike rotated to angleRad
          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, R * lengthScale);
          grad.addColorStop(0,   'rgba(255,255,255,1.0)');
          grad.addColorStop(0.12,'rgba(255,255,255,0.98)');
          grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
          grad.addColorStop(0.8, 'rgba(255,255,255,0.12)');
          grad.addColorStop(1,   'rgba(255,255,255,0)');
          ctx.save();
          ctx.translate(C, C);
          ctx.rotate(angleRad);
          ctx.scale(widthScale, lengthScale);
          ctx.beginPath();
          ctx.arc(0, 0, R, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.restore();
        };

        if (textureType === 'glow-circles') {
          // ── Premium Bloom bokeh circle: 3 concentric gradient layers ──────────
          // Layer 1 – super wide, very soft halo for deep bloom
          ctx.fillStyle = radGrad(0, R, [
            [0,    'rgba(255,255,255,1.0)'],
            [0.15, 'rgba(255,255,255,0.85)'],
            [0.35, 'rgba(255,255,255,0.45)'],
            [0.65, 'rgba(255,255,255,0.15)'],
            [1.0,  'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);
          // Layer 2 – bright mid corona (additive blend)
          if (customGlow) ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = radGrad(0, R * 0.45, [
            [0,   'rgba(255,255,255,1.0)'],
            [0.4, 'rgba(255,255,255,0.7)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);
          // Layer 3 – intense hot white core
          ctx.fillStyle = radGrad(0, R * 0.15, [
            [0,   'rgba(255,255,255,1.0)'],
            [0.6, 'rgba(255,255,255,0.95)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else if (textureType === 'stars') {
          // ── 4-point starburst lens flare (enhanced) ──────────────────────────────
          // Background bloom halo
          ctx.fillStyle = radGrad(0, R, [
            [0,   'rgba(255,255,255,0.80)'],
            [0.2, 'rgba(255,255,255,0.45)'],
            [0.55, 'rgba(255,255,255,0.15)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);
          if (customGlow) ctx.globalCompositeOperation = 'lighter';
          // 4 primary cross spikes – slightly thicker & longer
          fillSpike(0,           0.065, 1.7);
          fillSpike(Math.PI / 2, 0.065, 1.7);
          // 4 diagonal secondary spikes – shorter
          fillSpike(Math.PI / 4,       0.035, 1.15);
          fillSpike(Math.PI * 3 / 4,   0.035, 1.15);
          // Bright, sharp core
          ctx.fillStyle = radGrad(0, R * 0.18, [
            [0,   'rgba(255,255,255,1.0)'],
            [0.5, 'rgba(255,255,255,0.9)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else if (textureType === 'sparkle') {
          // ── 8-point lens-flare sparkle (enhanced dynamic range) ────────────
          // Massive bloom aura
          ctx.fillStyle = radGrad(0, R, [
            [0,    'rgba(255,255,255,0.9)'],
            [0.15, 'rgba(255,255,255,0.65)'],
            [0.4,  'rgba(255,255,255,0.25)'],
            [0.75, 'rgba(255,255,255,0.08)'],
            [1.0,  'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);
          ctx.globalCompositeOperation = 'lighter';
          // 4 extra-long primary spikes
          fillSpike(0,              0.040, 2.0);
          fillSpike(Math.PI / 2,    0.040, 2.0);
          // 4 medium diagonal spikes
          fillSpike(Math.PI / 4,         0.028, 1.35);
          fillSpike(Math.PI * 3 / 4,     0.028, 1.35);
          // 4 short tertiary spikes
          fillSpike(Math.PI / 8,         0.018, 0.85);
          fillSpike(Math.PI * 3 / 8,     0.018, 0.85);
          fillSpike(Math.PI * 5 / 8,     0.018, 0.85);
          fillSpike(Math.PI * 7 / 8,     0.018, 0.85);
          // Chromatic inner halo
          ctx.fillStyle = radGrad(0, R * 0.35, [
            [0,   'rgba(255,255,255,1.0)'],
            [0.4, 'rgba(255,255,255,0.8)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);
          // Blinding PIN/core
          ctx.fillStyle = radGrad(0, R * 0.08, [
            [0,   'rgba(255,255,255,1.0)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else if (textureType === 'metallic-sphere') {
          // ── Faux metallic sphere: diffuse shading + specular highlight + rim ──
          const lightX = C - R * 0.38;
          const lightY = C - R * 0.38;

          // 1. Base sphere clip + diffuse shading
          ctx.save();
          ctx.beginPath();
          ctx.arc(C, C, R * 0.9, 0, Math.PI * 2);
          ctx.clip();

          // diffuse: dark bottom-right → bright top-left
          const diffuseGrad = ctx.createRadialGradient(lightX, lightY, 0, C + R * 0.25, C + R * 0.25, R * 1.3);
          diffuseGrad.addColorStop(0,    'rgba(255,255,255,0.98)');
          diffuseGrad.addColorStop(0.22, 'rgba(210,210,210,0.88)');
          diffuseGrad.addColorStop(0.55, 'rgba(120,120,120,0.82)');
          diffuseGrad.addColorStop(0.82, 'rgba(40,40,40,0.92)');
          diffuseGrad.addColorStop(1.0,  'rgba(8,8,8,0.97)');
          ctx.fillStyle = diffuseGrad;
          ctx.fillRect(0, 0, size, size);

          // rim light: soft bright ring at the back/bottom edge (environment bounce)
          const rimGrad = ctx.createRadialGradient(C, C, R * 0.72, C, C, R * 0.95);
          rimGrad.addColorStop(0,   'rgba(255,255,255,0)');
          rimGrad.addColorStop(0.65,'rgba(255,255,255,0.10)');
          rimGrad.addColorStop(1.0, 'rgba(255,255,255,0.52)');
          ctx.fillStyle = rimGrad;
          ctx.fillRect(0, 0, size, size);

          ctx.restore();

          // 2. Specular highlight — tighter/sharper at low roughness, wider/softer at high roughness
          const specRadius = R * (0.06 + roughness * 0.38);
          const specX = lightX + (C - lightX) * 0.08;
          const specY = lightY + (C - lightY) * 0.08;
          const specGrad = ctx.createRadialGradient(specX, specY, 0, specX, specY, specRadius);
          const specPeakAlpha = 0.95 - roughness * 0.30; // sharper highlight for low roughness
          specGrad.addColorStop(0,   `rgba(255,255,255,${specPeakAlpha.toFixed(2)})`);
          specGrad.addColorStop(0.25,'rgba(255,255,255,0.85)');
          specGrad.addColorStop(0.6, 'rgba(255,255,255,0.35)');
          specGrad.addColorStop(1.0, 'rgba(255,255,255,0)');
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = specGrad;
          ctx.fillRect(0, 0, size, size);

          // 3. Outer alpha fade so sprite blends cleanly with no hard edge
          ctx.globalCompositeOperation = 'destination-in';
          ctx.fillStyle = radGrad(0, R * 0.92, [
            [0,    'rgba(0,0,0,1)'],
            [0.78, 'rgba(0,0,0,1)'],
            [1.0,  'rgba(0,0,0,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else if (textureType === 'sprites' || textureType === '3d-model' || textureType === 'volumetric-fire') {
          ctx.fillStyle = radGrad(0, R * 1.1, [
            [0,    'rgba(255,255,255,1.0)'],
            [0.25, 'rgba(255,255,255,0.98)'],
            [0.6,  'rgba(255,255,255,0.6)'],
            [1,    'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else if (customGlow) {
          // simple dots / circles with glow enabled → dense bloom version
          ctx.fillStyle = radGrad(0, R, [
            [0,    'rgba(255,255,255,1.0)'],
            [0.2,  'rgba(255,255,255,0.85)'],
            [0.5,  'rgba(255,255,255,0.4)'],
            [0.8,  'rgba(255,255,255,0.1)'],
            [1,    'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else {
          // plain crisp dot, softened edge for AA
          ctx.beginPath();
          ctx.arc(C, C, R * 0.82, 0, Math.PI * 2);
          ctx.fillStyle = radGrad(0, R * 0.82, [
            [0,   'rgba(255,255,255,1.0)'],
            [0.85, 'rgba(255,255,255,0.98)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fill();
        }

        // ── Metallic sheen overlay (works on any type) ──
        if (metalSheen > 0 && textureType !== 'metallic-sphere') {
          const sheenStrength = metalSheen / 100;
          const lightRad = 315 * Math.PI / 180;
          const lx = C + Math.cos(lightRad) * R * 0.30;
          const ly = C - Math.sin(lightRad) * R * 0.30;
          const hn = sheenColor.replace('#', '');
          const hs = hn.length === 3 ? hn.split('').map(c => c+c).join('') : hn;
          const hn2 = parseInt(hs, 16);
          const sr = (hn2 >> 16) & 255, sg = (hn2 >> 8) & 255, sb = hn2 & 255;
          const baseSnap = document.createElement('canvas');
          baseSnap.width = baseSnap.height = size;
          baseSnap.getContext('2d')!.drawImage(canvas, 0, 0);
          const metal = document.createElement('canvas');
          metal.width = metal.height = size;
          const mc = metal.getContext('2d')!;
          // Reflection band: transparent-at-edges, bright stripe – no dark stops, no colour cast
          const bx0 = C - Math.cos(lightRad) * R, by0 = C + Math.sin(lightRad) * R;
          const bx1 = C + Math.cos(lightRad) * R, by1 = C - Math.sin(lightRad) * R;
          const bandGrad = mc.createLinearGradient(bx0, by0, bx1, by1);
          bandGrad.addColorStop(0,    `rgba(${sr},${sg},${sb},0)`);
          bandGrad.addColorStop(0.38, `rgba(${sr},${sg},${sb},0.12)`);
          bandGrad.addColorStop(0.55, `rgba(${sr},${sg},${sb},0.65)`);
          bandGrad.addColorStop(0.68, `rgba(${sr},${sg},${sb},0.18)`);
          bandGrad.addColorStop(1.0,  `rgba(${sr},${sg},${sb},0)`);
          mc.fillStyle = bandGrad;
          mc.fillRect(0, 0, size, size);
          // Tight specular spot
          const specR = R * 0.32;
          const specGrad = mc.createRadialGradient(lx, ly, 0, lx, ly, specR);
          specGrad.addColorStop(0,    `rgba(255,255,255,0.90)`);
          specGrad.addColorStop(0.25, `rgba(${sr},${sg},${sb},0.55)`);
          specGrad.addColorStop(0.65, `rgba(${sr},${sg},${sb},0.10)`);
          specGrad.addColorStop(1.0,  `rgba(${sr},${sg},${sb},0)`);
          mc.globalCompositeOperation = 'lighter';
          mc.fillStyle = specGrad;
          mc.fillRect(0, 0, size, size);
          mc.globalCompositeOperation = 'source-over';
          // Clip to shape
          mc.globalCompositeOperation = 'destination-in';
          mc.drawImage(baseSnap, 0, 0);
          mc.globalCompositeOperation = 'source-over';
          // Composite – additive, no colour cast
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = sheenStrength * 0.75;
          ctx.drawImage(metal, 0, 0);
          ctx.restore();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        particleTextureCache.set(key, texture);
        return texture;
      };

      const setParticleSize = (mesh: THREE.Points | THREE.Sprite, size: number, flipX: boolean = false) => {
        if (mesh instanceof THREE.Points) {
          const material = mesh.material as THREE.PointsMaterial;
          material.size = size;
        } else {
          const spriteScale = Math.max(0.05, size * 4);
          mesh.scale.set(flipX ? -spriteScale : spriteScale, spriteScale, spriteScale);
        }
      };

      const getParticleMaterial = (mesh: THREE.Points | THREE.Sprite) => {
        if (mesh instanceof THREE.Points) {
          return mesh.material as THREE.PointsMaterial;
        }
        return mesh.material as THREE.SpriteMaterial;
      };

      const getParticleRotation = (mesh: THREE.Points | THREE.Sprite) => {
        if (mesh instanceof THREE.Sprite) {
          return (mesh.material as THREE.SpriteMaterial).rotation;
        }
        return mesh.rotation.z;
      };

      const getParticleSize = (mesh: THREE.Points | THREE.Sprite) => {
        if (mesh instanceof THREE.Points) {
          return (mesh.material as THREE.PointsMaterial).size;
        }
        return Math.abs(mesh.scale.x) / 4;
      };

      const setParticleRotation = (mesh: THREE.Points | THREE.Sprite, rotation: number) => {
        if (mesh instanceof THREE.Sprite) {
          (mesh.material as THREE.SpriteMaterial).rotation = rotation;
        } else {
          mesh.rotation.z = rotation;
        }
      };

      const getPreviewedParticleType = (particleType: ParticleVisualType): ParticleVisualType => {
        const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
        return isWhiteDotPreview ? 'dots' : particleType;
      };

      const getPreviewedParticleColor = (color: string) => {
        const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
        return isWhiteDotPreview ? '#ffffff' : color;
      };

      const getPreviewedParticleSize = (size: number) => {
        const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
        const previewDotSize = Math.max(0.2, Number(sceneSettingsRef.current.particlePreviewSize ?? 1.2));
        return isWhiteDotPreview ? previewDotSize : size;
      };

      const getPreviewedGlow = (customGlow: boolean) => {
        const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
        return isWhiteDotPreview ? false : customGlow;
      };

      const getExternalSpriteTexture = (dataUrl: string) => {
        const cached = spriteTextureCache.get(dataUrl);
        if (cached) {
          return cached;
        }

        const texture = textureLoader.load(dataUrl);
        texture.colorSpace = THREE.SRGBColorSpace;
        spriteTextureCache.set(dataUrl, texture);
        return texture;
      };

      const resolveSpriteTexture = (imageDataUrl: string, sequenceDataUrls: string[], age: number, fps: number = 12, mode: string = 'loop', particleLifetime: number = 1, trackId: number = 0) => {
          const validSequence = Array.isArray(sequenceDataUrls)
            ? sequenceDataUrls.filter((url) => typeof url === 'string' && url.length > 0)
            : [];

          if (validSequence.length > 0) {
            let frameIndex = 0;
            if (mode === 'random-static') {
               frameIndex = Math.abs(trackId * 2654435761) % validSequence.length;
            } else if (mode === 'match-life') {
               let progress = Math.max(0, age) / Math.max(0.001, particleLifetime);
               if (progress > 0.999) progress = 0.999;
               frameIndex = Math.floor(progress * validSequence.length);
            } else {
               const sequenceFps = fps;
               frameIndex = Math.floor(Math.max(0, age) * sequenceFps) % validSequence.length;
            }
            return getExternalSpriteTexture(validSequence[frameIndex]);
          }

          if (imageDataUrl && imageDataUrl.length > 0) {
            return getExternalSpriteTexture(imageDataUrl);
          }

          return undefined;
        };

      const createParticleMesh = (
          position: THREE.Vector3,
          color = '#ffffff',
          size = 3,
          opacity = 1,
          particleType: ParticleVisualType = 'dots',
          customGlow = false,
          rotation = 0,
          spriteTexture?: THREE.Texture,
          pivotX: number = 0.5,
          pivotY: number = 0.5,
          flipX: boolean = false,
          blendMode: string = 'normal',
          metalness: number = 0.9,
          roughness: number = 0.15,
          metalSheen: number = 0,
          sheenColor: string = '#ffffff'
      ) => {
        const resolvedParticleType = (particleType ?? 'dots') as ParticleVisualType;
        const shouldUseSprite = resolvedParticleType === 'circles' || resolvedParticleType === 'glow-circles' || resolvedParticleType === 'sparkle' || resolvedParticleType === 'glitter' || resolvedParticleType === 'sprites' || resolvedParticleType === '3d-model' || resolvedParticleType === 'stars' || resolvedParticleType === 'volumetric-fire' || resolvedParticleType === 'metallic-sphere';
        const texture = getParticleTexture(resolvedParticleType, customGlow, metalness, roughness, metalSheen, sheenColor);

        if (shouldUseSprite) {
          let baseMap = (resolvedParticleType === 'sprites' || resolvedParticleType === '3d-model' || resolvedParticleType === 'volumetric-fire') && spriteTexture ? spriteTexture : texture;
          if (baseMap && flipX) {
            baseMap = baseMap.clone();
            baseMap.repeat.x = -1;
            baseMap.offset.x = 1;
            baseMap.needsUpdate = true;
          }

          const spriteMaterial = new THREE.SpriteMaterial({
            color: new THREE.Color(color),
            map: baseMap,
            transparent: true,
            opacity,
            depthWrite: !customGlow,
            blending: blendMode === 'lighter' || blendMode === 'screen' ? THREE.AdditiveBlending : (customGlow ? THREE.AdditiveBlending : THREE.NormalBlending),
          });
          const sprite = new THREE.Sprite(spriteMaterial);
          sprite.position.copy(position);
          sprite.center.set(flipX ? 1.0 - pivotX : pivotX, pivotY);
          setParticleSize(sprite, size, flipX);
          setParticleRotation(sprite, rotation);
          sprite.visible = sceneSettingsRef.current.showParticles ?? true;
          return sprite;
        }

        const particlesGeometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([0, 0, 0]);
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

        const particlesMaterial = new THREE.PointsMaterial({
          color: new THREE.Color(color),
          size,
          map: texture,
          alphaTest: texture ? 0.01 : 0,
          transparent: true,
          opacity,
          depthWrite: !customGlow,
          blending: blendMode === 'lighter' || blendMode === 'screen' ? THREE.AdditiveBlending : (customGlow ? THREE.AdditiveBlending : THREE.NormalBlending),
        });

        const particleMesh = new THREE.Points(particlesGeometry, particlesMaterial);
        particleMesh.position.copy(position);
        setParticleRotation(particleMesh, rotation);
        particleMesh.visible = sceneSettingsRef.current.showParticles ?? true;
        return particleMesh;
      };

      const reportCacheCount = () => {
        const next = particleFrameCacheRef.current.size;
        if (next !== cacheCountRef.current) {
          cacheCountRef.current = next;
          onCacheFrameCountChange?.(next);
        }
      };

      const captureParticleFrame = (frame: number) => {
        const snapshot: CachedParticleState[] = [];

        particleSystemsRef.current.forEach((particleSystem, emitterId) => {
          particleSystem.particles.forEach((particle) => {
            const material = getParticleMaterial(particle.mesh);
            snapshot.push({
              emitterId,
              trackId: particle.trackId,
              position: {
                x: particle.mesh.position.x,
                y: particle.mesh.position.y,
                z: particle.mesh.position.z,
              },
              velocity: {
                x: particle.velocity.x,
                y: particle.velocity.y,
                z: particle.velocity.z,
              },
              lifetime: particle.lifetime,
              age: particle.age,
              opacity: material.opacity,
              visible: particle.mesh.visible,
              rotation: getParticleRotation(particle.mesh),
              size: particle.baseSize ?? getParticleSize(particle.mesh),
              color: material.color.getHexString(),
            });
          });
        });

        particleFrameCacheRef.current.set(frame, snapshot);
        reportCacheCount();
      };

      const clearAllParticles = () => {
        particleSystemsRef.current.forEach((particleSystem) => {
          particleSystem.particles.forEach((particle) => scene.remove(particle.mesh));
          particleSystem.particles = [];
        });
      };

      const restoreParticleFrame = (frame: number) => {
        const snapshot = particleFrameCacheRef.current.get(frame);
        if (!snapshot) return false;

        clearAllParticles();

        snapshot.forEach((cached) => {
          const particleSystem = particleSystemsRef.current.get(cached.emitterId);
          if (!particleSystem) return;

          // Look up emitter to get current particle properties
          const emitter = sceneObjectsRef.current.find(obj => obj.id === cached.emitterId);
          const emitterProps = emitter && emitter.type === 'Emitter' ? ((emitter.properties ?? {}) as Record<string, any>) : {};
          const emitterColor = emitter && emitter.type === 'Emitter' ? emitterProps.particleColor ?? '#ffffff' : '#ffffff';
          const emitterSize = emitter && emitter.type === 'Emitter' ? emitterProps.particleSize ?? 0.8 : 0.8;
          const emitterOpacity = emitter && emitter.type === 'Emitter' ? emitterProps.particleOpacity ?? 1 : cached.opacity;
          const restoredSize = Number(cached.size ?? emitterSize);
          const emitterParticleType = emitter && emitter.type === 'Emitter'
            ? (emitterProps.particleType ?? 'dots') as ParticleVisualType
            : 'dots';
          const emitterGlow = emitter && emitter.type === 'Emitter'
            ? Boolean(emitterProps.particleGlow ?? false)
            : false;
          const emitterRotationSpeed = emitter && emitter.type === 'Emitter'
            ? Number(emitterProps.particleRotationSpeed ?? 0)
            : 0;
          const emitterRotationSpeedVariation = emitter && emitter.type === 'Emitter'
            ? Number(emitterProps.particleRotationSpeedVariation ?? 0)
            : 0;
          const emitterSpriteImageDataUrl = emitter && emitter.type === 'Emitter'
            ? String(emitterProps.particleSpriteImageDataUrl ?? '')
            : '';
          const seqProps = emitter && emitter.type === 'Emitter' ? getResampledSequenceProps(emitterProps, sceneSettingsRef.current.particleSequenceBudget, sceneSettingsRef.current.particleSequenceBudgetLoop) : { urls: [], fps: 12 };
          const emitterSpriteSequenceDataUrls = seqProps.urls;
          const emitterSpriteSequenceFps = seqProps.fps;
          const restoredSpeedMultiplier = 1 - emitterRotationSpeedVariation * 0.5 + Math.random() * emitterRotationSpeedVariation;
          const restoredSpriteTexture = (emitterParticleType === 'sprites' || emitterParticleType === '3d-model' || emitterParticleType === 'volumetric-fire')
            ? resolveSpriteTexture(emitterSpriteImageDataUrl, emitterSpriteSequenceDataUrls, cached.age, emitterSpriteSequenceFps, String(emitterProps.particleSpriteSequenceMode ?? 'loop'), Number(emitterProps.particleLifetime ?? 3), cached.trackId)
            : undefined;
          const previewedType = getPreviewedParticleType(emitterParticleType);
          const previewedColor = getPreviewedParticleColor(emitterColor);
          const previewedSize = getPreviewedParticleSize(restoredSize);
          const previewedGlow = getPreviewedGlow(emitterGlow);

          const particleBlendMode = emitterProps.particleBlendMode || 'normal';
          const emitterMetalnessR = emitter && emitter.type === 'Emitter' ? Number(emitterProps.particleMetalness ?? 0.9) : 0.9;
          const emitterRoughnessR = emitter && emitter.type === 'Emitter' ? Number(emitterProps.particleRoughness ?? 0.15) : 0.15;
          const emitterMetalSheenR = emitter && emitter.type === 'Emitter' ? Number(emitterProps.particleMetalSheen ?? 0) : 0;
          const emitterSheenColorR = emitter && emitter.type === 'Emitter' ? String(emitterProps.particleMetalSheenColor ?? '#ffffff') : '#ffffff';
          const particleMesh = createParticleMesh(
            new THREE.Vector3(cached.position.x, cached.position.y, cached.position.z),
            previewedColor,
            previewedSize,
            emitterOpacity,
            previewedType,
            previewedGlow,
            cached.rotation,
            (previewedType === 'sprites' || previewedType === '3d-model') ? restoredSpriteTexture : undefined,
            0.5,
            0.5,
            false,
            particleBlendMode,
            emitterMetalnessR,
            emitterRoughnessR,
            emitterMetalSheenR,
            emitterSheenColorR
          );

          const particleFlipXChance = Number(emitterProps.particleHorizontalFlipChance ?? 0);
                const flipX = Math.random() < particleFlipXChance;
                scene.add(particleMesh);

                // Visibility will be corrected by the lifecycle loop at the end of this rAF.
                // Start hidden — the loop will evaluate lifetime bounds correctly.
                particleMesh.visible = false;

                particleSystem.particles.push({
            trackId: cached.trackId ?? 0, // Restore the bone/track ID for Spine export
            mesh: particleMesh,
            velocity: new THREE.Vector3(cached.velocity.x, cached.velocity.y, cached.velocity.z),
            lifetime: cached.lifetime,
            age: cached.age,
            particleType: emitterParticleType,
            customGlow: emitterGlow,
            rotation: cached.rotation,
            rotationOffset: 0,
            rotationVariation: 0,
            rotationSpeed: emitterRotationSpeed * restoredSpeedMultiplier,
            rotationSpeedMultiplier: restoredSpeedMultiplier,
            rotationSpeedVariation: emitterRotationSpeedVariation,
            baseSize: restoredSize,
            sizeMultiplier: emitterSize > 0 ? (restoredSize / emitterSize) : 1,
            spriteImageDataUrl: emitterSpriteImageDataUrl,
            spriteSequenceDataUrls: emitterSpriteSequenceDataUrls,
            positionHistory: [new THREE.Vector3(cached.position.x, cached.position.y, cached.position.z)],
          });
        });

        particleSystemsRef.current.forEach((particleSystem) => {
          particleSystem.lastEmit = Date.now();
        });

        return true;
      };

      const now = Date.now();
      const frameDeltaTime = Math.min((now - lastFrameTimeRef.current) / 1000, 0.1);
      lastFrameTimeRef.current = now;

      // ── Path Animation ──────────────────────────────────────────────────────
      if (isPlayingRef.current) {
        sceneObjectsRef.current.forEach(obj => {
          const props = (obj.properties ?? {}) as Record<string, any>;
          const pathId = props.pathAnimPathId as string | undefined;
          if (!pathId) return;
          const mesh = sceneObjectMeshesRef.current.get(obj.id);
          if (!mesh) return;

          const speed = Number(props.pathAnimSpeed ?? 0.1);
          const loop = props.pathAnimLoop !== false; // default: loop
          const orient = !!props.pathAnimOrient;
          const alignUp = !!props.pathAnimAlignUp;
          const twistDeg = Number(props.pathAnimTwist ?? 0);
          const falloffStart = Math.min(0.9999, Number(props.pathAnimFalloff ?? 100) / 100);
          // falloffStart = 1.0 means no falloff (slider at 100%)

          // Build CatmullRom curve from the path's PathPoint children
          const pathPointObjs = sceneObjectsRef.current.filter(
            o => o.type === 'PathPoint' && o.parentId === pathId
          );
          if (pathPointObjs.length < 2) return;
          const pts = pathPointObjs.map(p => {
            const pm = sceneObjectMeshesRef.current.get(p.id);
            return pm
              ? pm.position.clone()
              : new THREE.Vector3(p.position.x, p.position.y, p.position.z);
          });

          const curve = new THREE.CatmullRomCurve3(pts, loop);

          // Advance normalised parameter t
          let t = pathAnimTimesRef.current.get(obj.id) ?? 0;
          t += speed * frameDeltaTime;
          if (loop) {
            t = t % 1;
            if (t < 0) t = 1 + t;
          } else {
            t = Math.min(t, 0.9999);
          }
          pathAnimTimesRef.current.set(obj.id, t);

          // When loop resets clear free-state so momentum restarts cleanly
          const prevT = pathAnimTimesRef.current.get(obj.id + '_prev') ?? t;
          pathAnimTimesRef.current.set(obj.id + '_prev', t);
          if (t < prevT) pathAnimFreeStateRef.current.delete(obj.id);

          const pathPos = curve.getPointAt(t);

          // ── Falloff: after falloffStart, object leaves path with momentum ──
          let adherence = 1.0;
          if (falloffStart < 0.9999) {
            if (t <= falloffStart) {
              adherence = 1.0;
              // Keep free-state in sync with path so release is smooth
              const seg0 = curve.getPointAt(Math.max(0, t - 0.001));
              const seg1 = curve.getPointAt(Math.min(0.9999, t + 0.001));
              const pathVel = seg1.clone().sub(seg0).normalize().multiplyScalar(
                speed * (curve.getLength() / Math.max(0.0001, 0.002))
              );
              pathAnimFreeStateRef.current.set(obj.id, { pos: pathPos.clone(), vel: pathVel });
            } else {
              adherence = 1 - (t - falloffStart) / (1 - falloffStart);
              const free = pathAnimFreeStateRef.current.get(obj.id);
              if (!free) {
                const seg0 = curve.getPointAt(Math.max(0, falloffStart - 0.001));
                const seg1 = curve.getPointAt(Math.min(0.9999, falloffStart + 0.001));
                const pathVel = seg1.clone().sub(seg0).normalize().multiplyScalar(
                  speed * (curve.getLength() / Math.max(0.0001, 0.002))
                );
                pathAnimFreeStateRef.current.set(obj.id, { pos: pathPos.clone(), vel: pathVel });
              } else {
                free.pos.addScaledVector(free.vel, frameDeltaTime);
              }
              const freePos = pathAnimFreeStateRef.current.get(obj.id)!.pos;
              pathPos.lerp(freePos, 1 - adherence);
            }
          }

          const pos = pathPos;
          mesh.position.copy(pos);

          if (orient) {
            const tangent = curve.getTangentAt(t).normalize();
            if (alignUp) {
              // Full free-roll: align Z-forward to tangent, derive up from path curvature
              const p0 = curve.getPointAt(Math.max(0, t - 0.001));
              const p2 = curve.getPointAt(Math.min(0.9999, t + 0.01));
              const curveUp = new THREE.Vector3().subVectors(p2, p0).normalize();
              const right = new THREE.Vector3().crossVectors(curveUp, tangent).normalize();
              const up2 = new THREE.Vector3().crossVectors(tangent, right).normalize();
              const m = new THREE.Matrix4().makeBasis(right, up2, tangent);
              mesh.quaternion.setFromRotationMatrix(m);
            } else {
              // Keep world-Y up, only yaw to face tangent direction
              const worldUp = new THREE.Vector3(0, 1, 0);
              const right = new THREE.Vector3().crossVectors(worldUp, tangent);
              if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
              right.normalize();
              const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
              const m = new THREE.Matrix4().makeBasis(right, up, tangent);
              mesh.quaternion.setFromRotationMatrix(m);
            }
            // Apply twist: rotate around tangent (forward) axis by twistDeg * t
            if (twistDeg !== 0) {
              const tangent2 = curve.getTangentAt(t).normalize();
              const twistQuat = new THREE.Quaternion().setFromAxisAngle(
                tangent2,
                (twistDeg * t * Math.PI) / 180
              );
              mesh.quaternion.premultiply(twistQuat);
            }
            mesh.rotation.setFromQuaternion(mesh.quaternion);
          } else if (twistDeg !== 0) {
            // Orient not enabled but twist still applies — rotate around tangent from current orientation
            const tangent2 = curve.getTangentAt(t).normalize();
            const twistQuat = new THREE.Quaternion().setFromAxisAngle(
              tangent2,
              (twistDeg * t * Math.PI) / 180
            );
            mesh.quaternion.premultiply(twistQuat);
            mesh.rotation.setFromQuaternion(mesh.quaternion);
          }

          // Keep selection outline + handles in sync
          if (selectedObjectIdRef.current === obj.id && sceneRef.current) {
            refreshSelectionOutlines();
            const handles = sceneRef.current.getObjectByName('transform-handles');
            if (handles) handles.position.copy(pos);
          }
        });
      }
      // ── End Path Animation ──────────────────────────────────────────────────
      const timelineFrame = Math.max(0, Math.floor(currentFrameRef.current));
      const previousTimelineFrame = lastTimelineFrameRef.current;
      const frameChanged = timelineFrame !== previousTimelineFrame;
      // Once a frame snapshot exists in the cache, NEVER run physics for it again —
      // not even on repeated rAF renders of the same frame (60 Hz display vs 30 fps timeline).
      // Running physics a second time per cached frame corrupts subsequent frames during baking
      // AND causes the "forth and back" visual jitter during playback.
      const frameIsInCache = particleFrameCacheRef.current.has(timelineFrame);
      const restoredFromCache =
        (frameChanged && restoreParticleFrame(timelineFrame)) ||
        frameIsInCache;

      // ── Rigid-body object physics ──────────────────────────────────────────
      // Apply physics forces to non-emitter 3D objects listed in each force's
      // affectedEmitterIds. Mesh positions are driven directly; React state is
      // only synced when playback stops to avoid per-frame re-render overhead.
      {
        const PHYS_EXCLUDED = new Set([
          'Emitter', 'PathPoint', 'Force', 'Bone', 'Path', 'Lightning', 'Camera', 'Light',
        ]);
        const dt = Math.min(frameDeltaTime, 0.05);

        if (isPlayingRef.current) {
          // Collect all physics-driven object IDs
          const drivenObjectIds = new Set<string>();
          physicsForceRef.current.forEach(f => {
            if (!f.enabled) return;
            f.affectedEmitterIds.forEach(id => {
              const o = sceneObjectsRef.current.find(x => x.id === id);
              if (o && !PHYS_EXCLUDED.has(o.type)) drivenObjectIds.add(id);
            });
          });

          // Drop state for objects no longer driven
          rigidBodyStateRef.current.forEach((_, id) => {
            if (!drivenObjectIds.has(id)) rigidBodyStateRef.current.delete(id);
          });

          drivenObjectIds.forEach(objId => {
            const obj = sceneObjectsRef.current.find(o => o.id === objId);
            const mesh = sceneObjectMeshesRef.current.get(objId);
            if (!obj || !mesh) return;

            if (!rigidBodyStateRef.current.has(objId)) {
              rigidBodyStateRef.current.set(objId, { velocity: new THREE.Vector3() });
            }
            const rbState = rigidBodyStateRef.current.get(objId)!;

            const affectingForces = physicsForceRef.current.filter(
              f => f.enabled && f.affectedEmitterIds.includes(objId),
            );
            const objPos = mesh.position;

            affectingForces.forEach(force => {
              let forceOrigin = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
              if ((force.type === 'attractor' || force.type === 'repulsor') && force.targetShapeId) {
                const tgt = sceneObjectsRef.current.find(o => o.id === force.targetShapeId);
                if (tgt) forceOrigin.set(tgt.position.x, tgt.position.y, tgt.position.z);
              }
              const toForce = new THREE.Vector3().subVectors(forceOrigin, objPos);
              const dist = toForce.length();

              switch (force.type) {
                case 'gravity':
                  rbState.velocity.y -= force.strength * 9.8 * dt;
                  break;
                case 'wind':
                  if (force.direction) {
                    const windDir = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                    rbState.velocity.addScaledVector(windDir, force.strength * dt);
                  }
                  break;
                case 'attractor':
                  if (dist > 0.1) rbState.velocity.addScaledVector(toForce.clone().normalize(), force.strength * dt);
                  break;
                case 'repulsor':
                  if (dist > 0.1) rbState.velocity.addScaledVector(toForce.clone().normalize(), -force.strength * dt);
                  break;
                case 'drag':
                case 'damping':
                  rbState.velocity.multiplyScalar(Math.max(0, 1 - force.strength * 5 * dt));
                  break;
                case 'turbulence':
                  rbState.velocity.add(new THREE.Vector3(
                    (Math.random() - 0.5) * 2 * force.strength * dt,
                    (Math.random() - 0.5) * 2 * force.strength * dt,
                    (Math.random() - 0.5) * 2 * force.strength * dt,
                  ));
                  break;
                case 'tornado':
                  if (force.direction) {
                    const axis = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                    const radVec = new THREE.Vector3().crossVectors(axis, toForce.clone().normalize());
                    if (radVec.length() > 0.01) {
                      rbState.velocity.addScaledVector(radVec.normalize(), force.strength * dt);
                      rbState.velocity.y += force.strength * 0.3 * dt;
                    }
                  }
                  break;
                case 'vortex':
                  if (force.direction && dist > 0.1) {
                    const vAxis = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                    const radVec2 = new THREE.Vector3().crossVectors(vAxis, toForce.clone().normalize());
                    if (radVec2.length() > 0.01) {
                      const tangent = new THREE.Vector3().crossVectors(vAxis, radVec2.normalize());
                      rbState.velocity.addScaledVector(tangent, force.strength * dt);
                    }
                  }
                  break;
                case 'thermal-updraft':
                  rbState.velocity.y += force.strength * dt;
                  break;
                default:
                  break;
              }
            });

            // Integrate position
            mesh.position.addScaledVector(rbState.velocity, dt);

            // Keep the sceneObjectsRef entry consistent so inspectors read current data
            const mutableObj = obj as any;
            mutableObj.position = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };

            // Keep transform handles / selection outline in sync
            if (selectedObjectIdRef.current === objId && sceneRef.current) {
              refreshSelectionOutlines();
              const handles = sceneRef.current.getObjectByName('transform-handles');
              if (handles) handles.position.copy(mesh.position);
            }
          });
        } else {
          // When not playing, clear all rigid-body velocity state so the next
          // play-session starts from a still position.
          rigidBodyStateRef.current.clear();
        }
      }
      // ── End Rigid-body object physics ───────────────────────────────────────

      // Physics runs every rAF using real elapsed time (frameDeltaTime), so it is always
      // rate-correct regardless of rAF frequency. The only gate is restoredFromCache so we
      // never double-advance a frame that was already baked into the cache.
      if (!restoredFromCache) {
        let globalActiveParticles = 0;
        particleSystemsRef.current.forEach((system) => {
          globalActiveParticles += system.particles.length;
        });
        const particleBudget = sceneSettingsRef.current.particleBudget ?? 500;

        sceneObjectsRef.current.forEach(obj => {
          if (obj.type === 'Emitter') {
            const emitter = obj as EmitterObject;
            const particleSystem = particleSystemsRef.current.get(obj.id);
            const emitterMesh = sceneObjectMeshesRef.current.get(obj.id);
            
            if (particleSystem && emitterMesh) {
              const emitterProps = (emitter.properties ?? {}) as Record<string, any>;
              const timeSinceLastEmit = now - particleSystem.lastEmit;
              const emissionRate = Number(emitterProps.emissionRate ?? 100);
              const rawSafeEmissionRate = Number.isFinite(emissionRate) && emissionRate > 0 ? emissionRate : 100;
              
              const totalEmitters = Array.from(sceneObjectsRef.current.values()).filter(o => o.type === 'Emitter').length || 1;
              const isAdaptive = sceneSettingsRef.current.adaptiveEmission !== false;
              
              const emitterLifetimeBase = Number(emitterProps.particleLifetime ?? 3);
              const maxContinuousEmission = (particleBudget / totalEmitters) / Math.max(0.1, emitterLifetimeBase);
              const safeEmissionRate = isAdaptive ? Math.min(rawSafeEmissionRate, maxContinuousEmission) : rawSafeEmissionRate;
              const emissionInterval = 1000 / safeEmissionRate;

              // Use connected shapes as emission sources if available, otherwise just use the emitter itself
              const childShapes = Array.from(sceneObjectsRef.current.values()).filter(o =>
                  o.parentId === obj.id && o.type !== 'PathPoint' && o.type !== 'Emitter' && o.type !== 'Force'
                );
              const activeSources = childShapes.length > 0 ? childShapes : [obj];
              // Dynamic sourceExtent placeholder — computed per-source below

              // Emit new particles when playing or actively caching
              const isUnderBudget = globalActiveParticles < particleBudget;

              if (isUnderBudget && (isPlayingRef.current || isCachingRef.current || sceneSettingsRef.current.particleLivePreview) && timeSinceLastEmit >= emissionInterval && activeSources.length > 0 && (timelineFrame >= timelineInRef.current || sceneSettingsRef.current.particleLivePreview)) {
                // Keep budget tracked correctly if multiple particles spawn across different emitters in the same frame
                globalActiveParticles++;
                
                const sourceNode = activeSources[Math.floor(Math.random() * activeSources.length)];
                const sourceProps = (sourceNode.properties ?? {}) as Record<string, any>;
                  let emitterType = sourceNode.id === obj.id
                    ? (sourceProps.emitterType ?? 'point')   // standalone emitter: use its own setting
                    : 'mesh_bounds';                          // child shape fallback: bounding box
                  if (sourceNode.type === 'Path') emitterType = 'curve';
                  else if (sourceNode.type === 'Cube' || sourceNode.type === 'Box') emitterType = 'cube';
                  else if (sourceNode.type === 'Sphere' || sourceNode.type === 'Torus') emitterType = 'ball';
                  else if (sourceNode.type === 'Cylinder' || sourceNode.type === 'Cone') emitterType = 'ball';
                  else if (sourceNode.type === 'Plane' || sourceNode.type === 'Rectangle') emitterType = 'square';
                  else if (sourceNode.type === 'Circle') emitterType = 'circle';
                  else if (sourceNode.id === obj.id) emitterType = sourceProps.emitterType ?? 'point'; // own emitter type
                const emissionMode = sourceProps.emissionMode ?? emitterProps.emissionMode ?? 'volume';
                const isSurfaceMode = emissionMode === 'surface';
                const isEdgeMode = emissionMode === 'edge';
                const sourceMesh = sceneObjectMeshesRef.current.get(sourceNode.id) ?? emitterMesh;
                const localOffset = new THREE.Vector3(0, 0, 0);
                const localNormal = new THREE.Vector3(0, 1, 0);

                // Compute local-space half-extents from the source mesh geometry
                let seX = 25, seY = 25, seZ = 25;
                if (sourceNode.id !== obj.id) {
                  const geom = (sourceMesh as THREE.Mesh)?.geometry;
                  if (geom) {
                    if (!geom.boundingBox) geom.computeBoundingBox();
                    const bb = geom.boundingBox;
                    if (bb) {
                      const ex = (bb.max.x - bb.min.x) / 2;
                      const ey = (bb.max.y - bb.min.y) / 2;
                      const ez = (bb.max.z - bb.min.z) / 2;
                      // Only use computed extents if non-zero; keep default otherwise
                      if (ex > 0) seX = ex;
                      if (ey > 0) seY = ey;
                      if (ez > 0) seZ = ez;
                    }
                  }
                }
                const sourceExtent = Math.max(seX, seY, seZ);

                if (emitterType === 'circle') {
                  const angle = Math.random() * Math.PI * 2;
                  if (isEdgeMode) {
                    localOffset.set(Math.cos(angle) * sourceExtent, 0, Math.sin(angle) * sourceExtent);
                  } else if (isSurfaceMode) {
                    // Emit uniformly across full disk area
                    const radius = Math.sqrt(Math.random()) * sourceExtent;
                    localOffset.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
                  } else {
                    // Emit from entire disk
                    const radius = Math.sqrt(Math.random()) * sourceExtent;
                    localOffset.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
                  }
                  localNormal.set(0, 1, 0);
                } else if (emitterType === 'square') {
                  if (isEdgeMode) {
                    const side = Math.floor(Math.random() * 4);
                    const t = (Math.random() * 2 - 1) * sourceExtent;
                    if (side === 0) localOffset.set(t, 0, sourceExtent);
                    else if (side === 1) localOffset.set(t, 0, -sourceExtent);
                    else if (side === 2) localOffset.set(sourceExtent, 0, t);
                    else localOffset.set(-sourceExtent, 0, t);
                  } else if (isSurfaceMode) {
                    // Emit uniformly across full square area
                    localOffset.set(
                      (Math.random() * 2 - 1) * sourceExtent,
                      0,
                      (Math.random() * 2 - 1) * sourceExtent
                    );
                  } else {
                    // Emit from entire square
                    localOffset.set(
                      (Math.random() * 2 - 1) * sourceExtent,
                      0,
                      (Math.random() * 2 - 1) * sourceExtent
                    );
                  }
                  localNormal.set(0, 1, 0);
                } else if (emitterType === 'cube') {
                    if (isEdgeMode) {
                      // 12 edges of the bounding box
                      const edge = Math.floor(Math.random() * 12);
                      const tx = (Math.random() * 2 - 1) * seX;
                      const ty = (Math.random() * 2 - 1) * seY;
                      const tz = (Math.random() * 2 - 1) * seZ;
                      const signs = [
                        [seY, seZ], [seY, -seZ], [-seY, seZ], [-seY, -seZ]
                      ];
                      const sgn = signs[edge % 4];
                      if (edge < 4) { // X-axis parallel edges
                        localOffset.set(tx, sgn[0], sgn[1]);
                      } else if (edge < 8) { // Y-axis parallel edges
                        localOffset.set(sgn[0], ty, sgn[1]);
                      } else { // Z-axis parallel edges
                        localOffset.set(sgn[0], sgn[1], tz);
                      }
                      localNormal.copy(localOffset).normalize();
                    } else if (isSurfaceMode) {
                      // Weight faces by actual face area (seY*seZ for ±X, etc.)
                      const areaX = seY * seZ;
                      const areaY = seX * seZ;
                      const areaZ = seX * seY;
                      const totalArea = 2 * (areaX + areaY + areaZ);
                      const pick = Math.random() * totalArea;
                      const sign = Math.random() < 0.5 ? -1 : 1;
                      if (pick < 2 * areaX) {
                        localOffset.set(sign * seX, (Math.random() * 2 - 1) * seY, (Math.random() * 2 - 1) * seZ);
                        localNormal.set(sign, 0, 0);
                      } else if (pick < 2 * (areaX + areaY)) {
                        localOffset.set((Math.random() * 2 - 1) * seX, sign * seY, (Math.random() * 2 - 1) * seZ);
                        localNormal.set(0, sign, 0);
                      } else {
                        localOffset.set((Math.random() * 2 - 1) * seX, (Math.random() * 2 - 1) * seY, sign * seZ);
                        localNormal.set(0, 0, sign);
                      }
                  } else {
                    // Emit from entire volume
                    localOffset.set(
                      (Math.random() * 2 - 1) * seX,
                      (Math.random() * 2 - 1) * seY,
                      (Math.random() * 2 - 1) * seZ
                    );
                    if (localOffset.lengthSq() > 1e-6) {
                      localNormal.copy(localOffset).normalize();
                    }
                  }
                } else if (emitterType === 'ball') {
                  if (isSurfaceMode || isEdgeMode) {
                    // Emit uniformly across sphere surface
                    const thetaSurface = Math.random() * Math.PI * 2;
                    const zSurface = Math.random() * 2 - 1;
                    const radialSurface = Math.sqrt(Math.max(0, 1 - zSurface * zSurface));
                    localOffset.set(
                      radialSurface * Math.cos(thetaSurface) * sourceExtent,
                      zSurface * sourceExtent,
                      radialSurface * Math.sin(thetaSurface) * sourceExtent
                    );
                    localNormal.copy(localOffset).normalize();
                  } else {
                    // Emit from entire volume
                    let point = new THREE.Vector3();
                    do {
                      point.set(
                        Math.random() * 2 - 1,
                        Math.random() * 2 - 1,
                        Math.random() * 2 - 1
                      );
                    } while (point.lengthSq() > 1);
                    localOffset.copy(point.multiplyScalar(sourceExtent));
                    if (localOffset.lengthSq() > 1e-6) {
                      localNormal.copy(localOffset).normalize();
                    }
                  }
                } else if (emitterType === 'mesh_bounds') {
                  // Use the shape's geometry bounds in local space so emission stays
                  // centred on the emitter even after the emitter has been moved.
                  const geomMb = (sourceMesh as THREE.Mesh)?.geometry;
                  if (geomMb) {
                    if (!geomMb.boundingBox) geomMb.computeBoundingBox();
                    const bbMb = geomMb.boundingBox;
                    if (bbMb) {
                      const rndX = bbMb.min.x + Math.random() * (bbMb.max.x - bbMb.min.x);
                      const rndY = bbMb.min.y + Math.random() * (bbMb.max.y - bbMb.min.y);
                      const rndZ = bbMb.min.z + Math.random() * (bbMb.max.z - bbMb.min.z);
                      if (isEdgeMode || isSurfaceMode) {
                        // Snap to the nearest face of the bounding box
                        const cx = (bbMb.min.x + bbMb.max.x) / 2;
                        const cy = (bbMb.min.y + bbMb.max.y) / 2;
                        const cz = (bbMb.min.z + bbMb.max.z) / 2;
                        const hx = (bbMb.max.x - bbMb.min.x) / 2;
                        const hy = (bbMb.max.y - bbMb.min.y) / 2;
                        const hz = (bbMb.max.z - bbMb.min.z) / 2;
                        const dx = Math.abs(rndX - cx) / (hx || 1);
                        const dy = Math.abs(rndY - cy) / (hy || 1);
                        const dz = Math.abs(rndZ - cz) / (hz || 1);
                        const m = Math.max(dx, dy, dz);
                        if (m === dx) localOffset.set(cx + Math.sign(rndX - cx) * hx, rndY, rndZ);
                        else if (m === dy) localOffset.set(rndX, cy + Math.sign(rndY - cy) * hy, rndZ);
                        else localOffset.set(rndX, rndY, cz + Math.sign(rndZ - cz) * hz);
                      } else {
                        localOffset.set(rndX, rndY, rndZ);
                      }
                    }
                  }
                  localNormal.set(0, 1, 0);
                } else if (emitterType === 'point') {
                  localNormal.set(0, -0.5, 1).normalize();
                } else if (emitterType === 'curve' || sourceNode.type === 'Path') {
                  let pts: THREE.Vector3[] = [];
                  if (sourceNode.type === 'Path') {
                    const pathPoints = sceneObjectsRef.current.filter(o => o.type === 'PathPoint' && o.parentId === sourceNode.id);
                    pts = pathPoints.map(p => {
                      const pm = sceneObjectMeshesRef.current.get(p.id);
                      return pm ? pm.position.clone() : new THREE.Vector3(p.position.x, p.position.y, p.position.z);
                    });
                  } else if (sourceProps.points) {
                    pts = sourceProps.points.map((p: any) => new THREE.Vector3(p.x, p.y, p.z));
                  }
                  if (pts.length > 1) {
                    const t = Math.random();
                    const cur = new THREE.CatmullRomCurve3(pts);
                    const pt = cur.getPoint(t);
                    const tang = cur.getTangent(t).normalize();
                    const normal = new THREE.Vector3();
                    if (Math.abs(tang.y) > 0.99) {
                      normal.set(1, 0, 0);
                    } else {
                      normal.set(0, 1, 0);
                    }
                    normal.cross(tang).normalize();
                    localNormal.copy(normal);
                    const smWorldPos = new THREE.Vector3();
                    sourceMesh.getWorldPosition(smWorldPos);
                    const diff = pt.clone().sub(smWorldPos);
                    diff.applyEuler(new THREE.Euler(-sourceMesh.rotation.x, -sourceMesh.rotation.y, -sourceMesh.rotation.z));
                    diff.set(diff.x / sourceMesh.scale.x, diff.y / sourceMesh.scale.y, diff.z / sourceMesh.scale.z);
                    localOffset.set(diff.x, diff.y, diff.z);
                  }
                } else if (emitterType === 'layer') {
                  if (isEdgeMode) {
                    const side = Math.floor(Math.random() * 4);
                    const t = (Math.random() * 2 - 1) * sourceExtent;
                    if (side === 0) localOffset.set(t, 0, sourceExtent);
                    else if (side === 1) localOffset.set(t, 0, -sourceExtent);
                    else if (side === 2) localOffset.set(sourceExtent, 0, t);
                    else localOffset.set(-sourceExtent, 0, t);
                  } else {
                    localOffset.set(
                      (Math.random() * 2 - 1) * sourceExtent,
                      0,
                      (Math.random() * 2 - 1) * sourceExtent
                    );
                  }
                  localNormal.set(0, 1, 0);
                }

                // Determine spawn position.
                // When emitFromSpineAttachmentId is set, sample a random opaque pixel
                // from that attachment's alpha map. If the attachment is not selected,
                // not yet loaded, or all sampled pixels are transparent, fall back to
                // the emitter's own world position so it always emits.
                const _spineEmitId = (emitterProps.emitFromSpineAttachmentId as string | undefined) || '';
                let spawnPosition: THREE.Vector3;
                if (_spineEmitId) {
                  const attMesh = spineAttachmentMeshesRef.current.get(_spineEmitId);
                  const pixData = spineAttachPixelDataRef.current.get(_spineEmitId);
                  let foundSpinePos: THREE.Vector3 | null = null;
                  if (attMesh && pixData) {
                    const { data, w, h } = pixData;
                    for (let _t = 0; _t < 32; _t++) {
                      const su = Math.random(), sv = Math.random();
                      const px = Math.min(Math.floor(su * w), w - 1);
                      const py = Math.min(Math.floor(sv * h), h - 1);
                      if (data[(py * w + px) * 4 + 3] > 10) {
                        const geom = attMesh.geometry as THREE.PlaneGeometry;
                        foundSpinePos = attMesh.localToWorld(
                          new THREE.Vector3(
                            (su - 0.5) * geom.parameters.width,
                            (0.5 - sv) * geom.parameters.height,
                            0
                          )
                        );
                        break;
                      }
                    }
                  }
                  // Fall back to emitter position if attachment not ready / all transparent
                  spawnPosition = foundSpinePos ?? sourceMesh.localToWorld(localOffset.clone());
                } else {
                  // Spawn position is in the source mesh's LOCAL space; localToWorld converts
                  // it to world space so particles appear within the shape's bounds at its
                  // actual world position (independent of the emitter's position).
                  spawnPosition = sourceMesh.localToWorld(localOffset.clone());
                }

                // Get particle properties from emitter
                const emitterColor = emitterProps.particleColor ?? '#ffffff';
                const emitterSize = emitterProps.particleSize ?? 0.8;
                const emitterOpacity = emitterProps.particleOpacity ?? 1;
                const emitterParticleType = (emitterProps.particleType ?? 'dots') as ParticleVisualType;
                const emitterGlow = Boolean(emitterProps.particleGlow ?? false);
                const emitterRotation = Number(emitterProps.particleRotation ?? 0);
                const emitterRotationVariation = Number(emitterProps.particleRotationVariation ?? 0);
                const emitterRotationSpeed = Number(emitterProps.particleRotationSpeed ?? 0);
                const emitterRotationSpeedVariation = Number(emitterProps.particleRotationSpeedVariation ?? 0);
                const emitterSpriteImageDataUrl = String(emitterProps.particleSpriteImageDataUrl ?? '');
                const seqProps = getResampledSequenceProps(emitterProps, sceneSettingsRef.current.particleSequenceBudget, sceneSettingsRef.current.particleSequenceBudgetLoop);
                const emitterSpriteSequenceDataUrls = seqProps.urls;
                const emitterSpriteSequenceFps = seqProps.fps;
                const emitterColorVariation = emitterProps.particleColorVariation ?? 0;
                const emitterSizeVariation = emitterProps.particleSizeVariation ?? 0;
                
                // Apply variations to color (randomize hue)
                  let particleColor = emitterColor;
                  if (emitterColorVariation > 0) {
                    const c3 = new THREE.Color(emitterColor);
                    const hsl = { h: 0, s: 0, l: 0 };
                    c3.getHSL(hsl);
                    hsl.h = (hsl.h + (Math.random() * 2 - 1) * emitterColorVariation + 1.0) % 1.0;
                    c3.setHSL(hsl.h, hsl.s, hsl.l);
                    particleColor = '#' + c3.getHexString();
                  }
                
                // Apply size variation
                const particleSize = emitterSize * (1 - emitterSizeVariation * 0.5 + Math.random() * emitterSizeVariation);
                const particleRotationOffset = (Math.random() * 2 - 1) * emitterRotationVariation;
                const particleRotation = emitterRotation + particleRotationOffset;
                const particleRotationSpeedMultiplier = 1 - emitterRotationSpeedVariation * 0.5 + Math.random() * emitterRotationSpeedVariation;
                const particleRotationSpeed = emitterRotationSpeed * particleRotationSpeedMultiplier;
                
                // Find lowest available track ID for pooling/Spine export bone reuse
                const activeTracks = new Set<number>();
                particleSystem.particles.forEach(p => activeTracks.add(p.trackId));
                let spawnTrackId = 0;
                while (activeTracks.has(spawnTrackId)) {
                  spawnTrackId++;
                }

                const spawnSpriteTexture = (emitterParticleType === 'sprites' || emitterParticleType === '3d-model')
                  ? resolveSpriteTexture(emitterSpriteImageDataUrl, emitterSpriteSequenceDataUrls, 0, emitterSpriteSequenceFps, String(emitterProps.particleSpriteSequenceMode ?? 'loop'), Number(emitterProps.particleLifetime ?? 3), spawnTrackId)
                  : undefined;
                const previewedType = getPreviewedParticleType(emitterParticleType);
                const previewedColor = getPreviewedParticleColor(particleColor);
                const previewedSize = getPreviewedParticleSize(particleSize);
                const previewedGlow = getPreviewedGlow(emitterGlow);
                
                const particleBlendMode = emitterProps.particleBlendMode || 'normal';
                const emitterMetalness = Number(emitterProps.particleMetalness ?? 0.9);
                const emitterRoughness = Number(emitterProps.particleRoughness ?? 0.15);
                const emitterMetalSheen = Number(emitterProps.particleMetalSheen ?? 0);
                const emitterSheenColor = String(emitterProps.particleMetalSheenColor ?? '#ffffff');
                const particleMesh = createParticleMesh(
                  spawnPosition,
                  previewedColor,
                  previewedSize,
                  emitterOpacity,
                  previewedType,
                  previewedGlow,
                  particleRotation,
                  (previewedType === 'sprites' || previewedType === '3d-model') ? spawnSpriteTexture : undefined,
                  0.5,
                  0.5,
                  false,
                  particleBlendMode,
                  emitterMetalness,
                  emitterRoughness,
                  emitterMetalSheen,
                  emitterSheenColor
                );
                
                const emitterSpeed = emitterProps.particleSpeed ?? 50;
                const emitterSpeedVariation = emitterProps.particleSpeedVariation ?? 0.2;
                const speed = emitterSpeed * (1 - emitterSpeedVariation * 0.5 + Math.random() * emitterSpeedVariation);
                const configuredSpread = emitterProps.particleSpreadAngle !== undefined ? (emitterProps.particleSpreadAngle / 180) * Math.PI : undefined;
                  const maxSpreadAngle = configuredSpread !== undefined ? configuredSpread : (emitterType === 'point' ? Math.PI : Math.PI * 0.2);

                  const theta = Math.random() * Math.PI * 2;
                  let phi;
                  if (maxSpreadAngle >= Math.PI) {
                    phi = Math.acos(Math.random() * 2 - 1);
                  } else {
                    const cosPhi = 1 - Math.random() * (1 - Math.cos(maxSpreadAngle));
                    phi = Math.acos(cosPhi);
                  }

                const emitterWorldQuaternion = sourceMesh.getWorldQuaternion(new THREE.Quaternion());
                const actualNormal = localNormal.lengthSq() > 1e-6 ? localNormal : DEFAULT_EMISSION_AXIS;
                
                const baseDirection = actualNormal
                  .clone()
                  .applyQuaternion(emitterWorldQuaternion)
                  .normalize();

                const perpVector = new THREE.Vector3(1, 0, 0);
                if (Math.abs(baseDirection.dot(perpVector)) > 0.9) {
                  perpVector.set(0, 1, 0);
                }
                const right = new THREE.Vector3().crossVectors(baseDirection, perpVector).normalize();
                const up = new THREE.Vector3().crossVectors(right, baseDirection).normalize();

                const baseVelocity = new THREE.Vector3()
                  .copy(baseDirection)
                  .multiplyScalar(Math.cos(phi))
                  .addScaledVector(right, Math.sin(phi) * Math.cos(theta))
                  .addScaledVector(up, Math.sin(phi) * Math.sin(theta))
                  .normalize()
                  .multiplyScalar(speed);
                
                const velocity = baseVelocity;

                // Apply lifetime variation
                const emitterLifetime = emitterProps.particleLifetime ?? 3;
                const emitterLifetimeVariation = emitterProps.particleLifetimeVariation ?? 0;
                const particleLifetime = emitterLifetime * (1 - emitterLifetimeVariation * 0.5 + Math.random() * emitterLifetimeVariation);



                const particleFlipXChance = Number(emitterProps.particleHorizontalFlipChance ?? 0);
                const flipX = Math.random() < particleFlipXChance;
                scene.add(particleMesh);
                particleMesh.visible = false; // hidden until lifecycle loop allows it (5% of lifetime)
                particleSystem.particles.push({
                  trackId: spawnTrackId,
                  mesh: particleMesh,
                  velocity,
                  lifetime: particleLifetime,
                  age: 0,
                  baseColor: particleColor,
                  baseOpacity: emitterOpacity,
                  baseSize: particleSize,
                  sizeMultiplier: emitterSize > 0 ? (particleSize / emitterSize) : 1,
                  particleType: emitterParticleType,
                  customGlow: emitterGlow,
                  rotation: particleRotation,
                  rotationOffset: particleRotationOffset,
                  rotationVariation: emitterRotationVariation,
                  rotationSpeed: particleRotationSpeed,
                  rotationSpeedMultiplier: particleRotationSpeedMultiplier,
                  rotationSpeedVariation: emitterRotationSpeedVariation,
                  rotationDriftPhase: Math.random() * Math.PI * 2,
                  spriteImageDataUrl: emitterSpriteImageDataUrl,
                  spriteSequenceDataUrls: emitterSpriteSequenceDataUrls,
                  opacityOverLife: emitterProps.particleOpacityOverLife ?? false,
                  colorOverLife: emitterProps.particleColorOverLife ?? false,
                  colorOverLifeTarget: emitterProps.particleColorOverLifeTarget ?? '#000000',
                  tintGradient: (emitterProps.particleTintGradient as TintStop[] | undefined) ?? undefined,
                  sizeOverLife: emitterProps.particleSizeOverLife ?? 'none',
                    flipX,
                  positionHistory: [new THREE.Vector3(particleMesh.position.x, particleMesh.position.y, particleMesh.position.z)],
                });
                
                particleSystem.lastEmit = now;
              }
              
              // Flush stale particles when the sprite asset changes so fresh ones spawn with the new texture
              const _newSpriteKey =
                String(emitterProps.particleSpriteImageDataUrl ?? '') +
                (Array.isArray(emitterProps.particleSpriteSequenceDataUrls) && emitterProps.particleSpriteSequenceDataUrls.length > 0
                  ? (emitterProps.particleSpriteSequenceDataUrls[0] ?? '').slice(-32)
                  : '');
              const _prevSpriteKey = emitterSpriteKeyRef.current.get(obj.id) ?? '';
              if (_prevSpriteKey !== '' && _prevSpriteKey !== _newSpriteKey) {
                for (const _p of particleSystem.particles) {
                  scene.remove(_p.mesh);
                  const _pl = _p.mesh.userData.pathLine as THREE.Line;
                  const _pp = _p.mesh.userData.pathPoints as THREE.Group;
                  if (_pl) scene.remove(_pl);
                  if (_pp) scene.remove(_pp);
                }
                particleSystem.particles = [];
              }
              emitterSpriteKeyRef.current.set(obj.id, _newSpriteKey);

              // Update existing particles; movement/lifetime only advance while playing or caching.
              const deltaTime = 0.016; // Fixed 60fps step — stable regardless of rAF timing jitter
              for (let i = particleSystem.particles.length - 1; i >= 0; i--) {
                const particle = particleSystem.particles[i];

                if (isPlayingRef.current || isCachingRef.current || sceneSettingsRef.current.particleLivePreview) {
                  particle.age += deltaTime;

                  // Recycle dead particles: reset age + position instead of destroying the mesh.
                  // This keeps the same THREE object in the scene and budget count unchanged.
                  // The lifecycle visibility loop hides it during the 0–20% birth window so it
                  // is never seen at the emitter origin — no snap, no teleport flash.
                  if (particle.age >= particle.lifetime) {
                    particle.mesh.visible = false;
                    particle.age = 0;
                    // Teleport mesh back to a random active source position (not necessarily
                    // the emitter itself when child shapes are driving emission).
                    {
                      const recycleSources = sceneObjectsRef.current.filter(o =>
                        o.parentId === obj.id && o.type !== 'PathPoint' && o.type !== 'Emitter' && o.type !== 'Force'
                      );
                      const recycleSource = recycleSources.length > 0
                        ? recycleSources[Math.floor(Math.random() * recycleSources.length)]
                        : null;
                      const recycleMesh = recycleSource
                        ? (sceneObjectMeshesRef.current.get(recycleSource.id) ?? emitterMesh)
                        : emitterMesh;
                      const recycleWorldPos = new THREE.Vector3();
                      recycleMesh.getWorldPosition(recycleWorldPos);
                      particle.mesh.position.copy(recycleWorldPos);
                    }
                    // Re-randomise velocity so each cycle can follow a different arc
                    {
                      const rSpeed = Number(emitterProps.particleSpeed ?? 50) *
                        (1 - Number(emitterProps.particleSpeedVariation ?? 0.2) * 0.5 +
                          Math.random() * Number(emitterProps.particleSpeedVariation ?? 0.2));
                      const rTheta = Math.random() * Math.PI * 2;
                      const rCos   = emitterProps.particleSpreadAngle !== undefined
                        ? Math.cos((Number(emitterProps.particleSpreadAngle) / 180) * Math.PI)
                        : -1;
                      const rPhi   = Math.acos(1 - Math.random() * (1 - rCos));
                      particle.velocity.set(
                        Math.sin(rPhi) * Math.cos(rTheta),
                        Math.cos(rPhi),
                        Math.sin(rPhi) * Math.sin(rTheta)
                      ).normalize().multiplyScalar(rSpeed);
                    }
                    // Clear path history for the new cycle
                    particle.positionHistory = [particle.mesh.position.clone()];
                    continue;
                  }

                  // Apply physics forces
                  const emitterId = obj.id;
                  const affectingForces = physicsForceRef.current.filter(f => f.affectedEmitterIds.includes(emitterId) && f.enabled);
                  
                  if (affectingForces.length > 0) {
                    const particlePos = new THREE.Vector3(particle.mesh.position.x, particle.mesh.position.y, particle.mesh.position.z);
                    
                    affectingForces.forEach(force => {
                      let forcePos = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
                      
                      // For attractor/repulsor, use target shape position if specified
                      if ((force.type === 'attractor' || force.type === 'repulsor') && force.targetShapeId) {
                        const targetShape = sceneObjectsRef.current.find(obj => obj.id === force.targetShapeId);
                        if (targetShape) {
                          forcePos.set(targetShape.position.x, targetShape.position.y, targetShape.position.z);
                        }
                      }
                      
                      const directionToParticle = new THREE.Vector3().subVectors(particlePos, forcePos);
                      const distanceToParticle = directionToParticle.length();
                      
                      switch (force.type) {
                        case 'gravity':
                          particle.velocity.y -= force.strength * 9.8 * deltaTime;
                          break;
                          
                        case 'wind':
                          if (force.direction) {
                            const windDir = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                            particle.velocity.addScaledVector(windDir, force.strength * deltaTime);
                          }
                          break;
                          
                        case 'tornado':
                          if (force.direction) {
                            const tornadoAxis = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                            const radiusFromAxis = new THREE.Vector3().crossVectors(tornadoAxis, directionToParticle);
                            const radius = radiusFromAxis.length();
                            if (radius > 0.1) {
                              radiusFromAxis.normalize();
                              const tangentialVel = radiusFromAxis.clone().multiplyScalar(force.strength * (1 - Math.min(radius / (force.radius || 100), 1)));
                              particle.velocity.add(tangentialVel.multiplyScalar(deltaTime));
                              // Also pull upward
                              particle.velocity.y += force.strength * 0.5 * deltaTime;
                            }
                          }
                          break;
                          
                        case 'vortex':
                          if (force.direction && distanceToParticle > 0.1) {
                            const vortexAxis = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                            const radiusVec = new THREE.Vector3().crossVectors(vortexAxis, directionToParticle);
                            const radius = radiusVec.length();
                            if (radius > 0.1) {
                              radiusVec.normalize();
                              const tangent = new THREE.Vector3().crossVectors(vortexAxis, radiusVec);
                              particle.velocity.addScaledVector(tangent, force.strength * deltaTime);
                            }
                          }
                          break;
                          
                        case 'attractor':
                          if (distanceToParticle > 0.1) {
                            const attractorForce = directionToParticle.clone().normalize().multiplyScalar(-force.strength);
                            particle.velocity.addScaledVector(attractorForce, deltaTime);
                          }
                          break;
                          
                        case 'repulsor':
                          if (distanceToParticle > 0.1) {
                            const repulsorForce = directionToParticle.clone().normalize().multiplyScalar(force.strength);
                            particle.velocity.addScaledVector(repulsorForce, deltaTime);
                          }
                          break;
                          
                        case 'collider':
                          // Bounce particles off target shape surface
                          if (force.targetShapeId) {
                            const targetShape = sceneObjectsRef.current.find(obj => obj.id === force.targetShapeId);
                            if (targetShape) {
                              const colliderPos = new THREE.Vector3(targetShape.position.x, targetShape.position.y, targetShape.position.z);
                              const scale = new THREE.Vector3(targetShape.scale?.x || 50, targetShape.scale?.y || 50, targetShape.scale?.z || 50);
                              
                              // Calculate closest point on the shape's surface (treating as a box)
                              const localParticlePos = new THREE.Vector3(
                                particlePos.x - colliderPos.x,
                                particlePos.y - colliderPos.y,
                                particlePos.z - colliderPos.z
                              );
                              
                              // Clamp particle position to box surface
                              const closestPoint = new THREE.Vector3(
                                Math.max(-scale.x, Math.min(scale.x, localParticlePos.x)),
                                Math.max(-scale.y, Math.min(scale.y, localParticlePos.y)),
                                Math.max(-scale.z, Math.min(scale.z, localParticlePos.z))
                              );
                              
                              // Calculate distance to surface
                              const surfaceVec = new THREE.Vector3().subVectors(localParticlePos, closestPoint);
                              const distToSurface = surfaceVec.length();
                              const collisionThreshold = 5; // How close particles need to be to collide
                              
                              if (distToSurface < collisionThreshold && distToSurface > 0.1) {
                                // Particle is colliding with surface - bounce it away
                                const surfaceNormal = surfaceVec.normalize();
                                const currentSpeed = particle.velocity.length();
                                particle.velocity.copy(surfaceNormal.multiplyScalar(currentSpeed * force.strength));
                              }
                            }
                          }
                          break;
                          
                        case 'drag':
                          particle.velocity.multiplyScalar(1 - force.strength * 0.1 * deltaTime);
                          break;
                          
                        case 'damping':
                          const dampingFactor = Math.pow(1 - force.strength * 0.05, deltaTime);
                          particle.velocity.multiplyScalar(dampingFactor);
                          break;
                          
                        case 'turbulence': {
                            const noiseScale = force.radius || 20.0;
                            const timeDrift = Date.now() * 0.001 * 0.5;
                            const curl = curlNoise(
                                particlePos.x,
                                particlePos.y + timeDrift * 10,
                                particlePos.z,
                                noiseScale
                            );
                            particle.velocity.addScaledVector(curl, force.strength * deltaTime);
                            break;
                          }

                          case 'thermal-updraft': {
                            const lifeRatio = 1.0 - (particle.age / (particle.lifetime || 1.0));
                            const heatMultiplier = Math.max(0.1, lifeRatio);
                            particle.velocity.y += force.strength * heatMultiplier * deltaTime;

                            const d = directionToParticle.clone();
                            d.y = 0;
                            if (d.lengthSq() > 0.01) {
                                particle.velocity.addScaledVector(d.normalize(), force.strength * 0.1 * heatMultiplier * deltaTime);
                            }
                            break;
                          }
                          
                                                case 'flow-curve':
                          if (force.curveId) {
                            const pathMesh = sceneObjectMeshesRef.current.get(force.curveId) as any;
                            if (pathMesh && pathMesh.pathCurve) {
                               const curve = pathMesh.pathCurve;
                               let closestT = 0;
                               let minDist = Infinity;
                               
                               for (let i = 0; i <= 20; i++) {
                                   const t = i / 20;
                                   const p = curve.getPointAt(t);
                                   const distSq = p.distanceToSquared(particle.mesh.position);
                                   if (distSq < minDist) {
                                       minDist = distSq;
                                       closestT = t;
                                   }
                               }
                               
                               let tangent = curve.getTangentAt(closestT);
                               if (force.reverseFlow) {
                                   tangent.negate();
                               }

                               // Falloff: reduce pull/steer after falloffStart % of path
                               const falloffStart = Math.min(0.9999, (force.falloff ?? 100) / 100);
                               const falloffFactor = closestT <= falloffStart
                                 ? 1.0
                                 : 1.0 - (closestT - falloffStart) / (1.0 - falloffStart + 0.0001);

                               // Twist: rotate desiredVel around tangent by twist angle at closestT
                               const twistDeg = force.twist ?? 0;
                               
                               // Calculate desired speed forward along path
                               let desiredSpeed = force.strength * 2.0; 
                               let desiredVel = tangent.clone().multiplyScalar(desiredSpeed);

                               if (twistDeg !== 0) {
                                 // Build a perpendicular to tangent
                                 const anyUp = Math.abs(tangent.y) < 0.9
                                   ? new THREE.Vector3(0, 1, 0)
                                   : new THREE.Vector3(1, 0, 0);
                                 const perp = new THREE.Vector3()
                                   .crossVectors(tangent.clone().normalize(), anyUp)
                                   .normalize();
                                 // Rotate the perp around the tangent by the accumulated angle at closestT
                                 const twistAngle = (twistDeg * closestT * Math.PI) / 180;
                                 const twistQ = new THREE.Quaternion().setFromAxisAngle(
                                   tangent.clone().normalize(), twistAngle
                                 );
                                 perp.applyQuaternion(twistQ);
                                 // Blend forward + sideways keeping total magnitude = desiredSpeed
                                 // revPerLoop controls how tight the helix is, NOT the speed
                                 const revPerLoop = Math.abs(twistDeg) / 360;
                                 const sideRatio = Math.tanh(revPerLoop); // approaches 1 asymptotically
                                 const fwdRatio = Math.sqrt(Math.max(0, 1 - sideRatio * sideRatio));
                                 desiredVel = new THREE.Vector3()
                                   .copy(tangent.clone().normalize()).multiplyScalar(fwdRatio)
                                   .addScaledVector(perp, sideRatio * Math.sign(twistDeg))
                                   .normalize()
                                   .multiplyScalar(desiredSpeed);
                               }
                               
                               // Pull force toward path core
                               const nearestPoint = curve.getPointAt(closestT);
                               const toCurve = new THREE.Vector3().subVectors(nearestPoint, particle.mesh.position);
                               const distToCurveSq = toCurve.lengthSq();
                               
                               // Determine the "tube" radius
                               const maxRadius = force.radius !== undefined ? Math.max(0.1, force.radius) : 50;
                               
                               let responsiveness = 5.0; // Base responsiveness
                               
                               if (distToCurveSq > 0.01) {
                                   const distToCurve = Math.sqrt(distToCurveSq);
                                   const normalizedDist = Math.max(0, distToCurve / maxRadius);
                                   
                                   // Inside the tube (normalizedDist < 1), we let the particle drift more, 
                                   // applying a very weak pull. Once it hits or exceeds the radius, the pull heavily ramps up.
                                   let pullStrength = Math.abs(force.strength) * 2.5 * Math.pow(normalizedDist, 4.0);
                                   
                                   // Cap the pull so it doesn't instantly snap back and jitter if it gets too far
                                   pullStrength = Math.min(pullStrength, Math.abs(force.strength) * 10.0);
                                   // Apply falloff to pull strength
                                   pullStrength *= falloffFactor;
                                   
                                   desiredVel.add(toCurve.normalize().multiplyScalar(pullStrength));
                                   
                                   // If we're freely floating inside the radius, loosen the steering responsiveness 
                                   // so particles can retain their own organic inertia and noise. 
                                   // If drifting too far out, steering gets tight again.
                                   responsiveness = Math.max(0.5, Math.min(5.0, 5.0 * Math.pow(normalizedDist, 2.0)));
                               }
                               
                               // Apply correction steering (damping existing outward velocity)
                               let steer = desiredVel.clone().sub(particle.velocity);
                               particle.velocity.add(steer.multiplyScalar(Math.min(1.0, responsiveness * falloffFactor * deltaTime)));
                            }
                          } else if (force.direction) {
                            const flowDir = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                            particle.velocity.addScaledVector(flowDir, force.strength * deltaTime);
                          }
                          break;
                      }
                    });
                  }

                  // Update position
                  particle.mesh.position.x += particle.velocity.x * deltaTime;
                  particle.mesh.position.y += particle.velocity.y * deltaTime;
                  particle.mesh.position.z += particle.velocity.z * deltaTime;

                  // Track position history for path visualization
                  const emitterShowPaths = emitterProps.showPathCurves ?? false;
                  const pathKeyCount = emitterProps.pathCurveKeyCount ?? 5;
                  if (emitterShowPaths && particle.positionHistory) {
                    particle.positionHistory.push(new THREE.Vector3(particle.mesh.position.x, particle.mesh.position.y, particle.mesh.position.z));
                    // Keep only the most recent positions to match keyCount
                    if (particle.positionHistory.length > pathKeyCount) {
                      particle.positionHistory = particle.positionHistory.slice(-pathKeyCount);
                    }
                  }
                }

                // Sync emitter properties so viewport updates immediately when values change.
                const emitterColor = emitterProps.particleColor ?? '#ffffff';
                const emitterSize = emitterProps.particleSize ?? 0.8;
                const emitterOpacity = emitterProps.particleOpacity ?? 1;
                const emitterParticleType = (emitterProps.particleType ?? 'dots') as ParticleVisualType;
                const emitterGlow = Boolean(emitterProps.particleGlow ?? false);
                const emitterRotation = Number(emitterProps.particleRotation ?? 0);
                const emitterRotationVariation = Number(emitterProps.particleRotationVariation ?? 0);
                const emitterRotationSpeed = Number(emitterProps.particleRotationSpeed ?? 0);
                const emitterRotationSpeedVariation = Number(emitterProps.particleRotationSpeedVariation ?? 0);
                const emitterSpriteImageDataUrl = String(emitterProps.particleSpriteImageDataUrl ?? '');
                const seqProps = getResampledSequenceProps(emitterProps, sceneSettingsRef.current.particleSequenceBudget, sceneSettingsRef.current.particleSequenceBudgetLoop);
                const emitterSpriteSequenceDataUrls = seqProps.urls;
                particle.baseColor = emitterColor;
                particle.baseOpacity = emitterOpacity;
                particle.particleType = emitterParticleType;
                particle.customGlow = emitterGlow;
                particle.rotationVariation = emitterRotationVariation;
                particle.rotationSpeedVariation = emitterRotationSpeedVariation;
                particle.spriteImageDataUrl = emitterSpriteImageDataUrl;
                particle.spriteSequenceDataUrls = emitterSpriteSequenceDataUrls;
                particle.opacityOverLife = emitterProps.particleOpacityOverLife ?? false;
                particle.colorOverLife = emitterProps.particleColorOverLife ?? false;
                particle.colorOverLifeTarget = emitterProps.particleColorOverLifeTarget ?? '#000000';
                particle.tintGradient = (emitterProps.particleTintGradient as TintStop[] | undefined) ?? undefined;
                particle.sizeOverLife = emitterProps.particleSizeOverLife ?? 'none';
                const sizeMultiplier = particle.sizeMultiplier ?? 1;
                particle.baseSize = emitterSize * sizeMultiplier;
                if (particle.rotationOffset === undefined) {
                  particle.rotationOffset = 0;
                }
                if (particle.rotationSpeedMultiplier === undefined) {
                  particle.rotationSpeedMultiplier = 1;
                }
                if (particle.rotationDriftPhase === undefined) {
                  particle.rotationDriftPhase = Math.random() * Math.PI * 2;
                }
                particle.rotationSpeed = emitterRotationSpeed * (particle.rotationSpeedMultiplier ?? 1);

                // Smooth rotation drift: slow sinusoidal wobble, unique phase per particle
                const driftAmp = ((emitterProps.particleRotationDrift as number | undefined) ?? 0) * (Math.PI / 180);
                const driftAngle = driftAmp > 0
                  ? driftAmp * Math.sin(particle.age * 0.8 + (particle.rotationDriftPhase ?? 0))
                  : 0;
                particle.rotation = emitterRotation + (particle.rotationOffset ?? 0) + particle.rotationSpeed * particle.age + driftAngle;

                const effectiveParticleType = getPreviewedParticleType(emitterParticleType);
                const expectedSprite = effectiveParticleType === 'circles' || effectiveParticleType === 'glow-circles' || effectiveParticleType === 'sparkle' || effectiveParticleType === 'glitter' || effectiveParticleType === 'sprites' || effectiveParticleType === '3d-model' || effectiveParticleType === 'stars' || effectiveParticleType === 'volumetric-fire' || effectiveParticleType === 'metallic-sphere';
                const needsMeshSwap = expectedSprite !== (particle.mesh instanceof THREE.Sprite);
                const currentEmitterFps = getResampledSequenceProps(emitterProps, sceneSettingsRef.current.particleSequenceBudget, sceneSettingsRef.current.particleSequenceBudgetLoop).fps;
                const currentEmitterMetalness = Number(emitterProps.particleMetalness ?? 0.9);
                const currentEmitterRoughness = Number(emitterProps.particleRoughness ?? 0.15);
                const currentEmitterMetalSheen = Number(emitterProps.particleMetalSheen ?? 0);
                const currentEmitterSheenColor = String(emitterProps.particleMetalSheenColor ?? '#ffffff');
                if (needsMeshSwap) {
                  const existingMaterial = getParticleMaterial(particle.mesh);
                  const replacementSpriteTexture = (emitterParticleType === 'sprites' || emitterParticleType === '3d-model')
                    ? resolveSpriteTexture(particle.spriteImageDataUrl ?? '', particle.spriteSequenceDataUrls ?? [], particle.age, currentEmitterFps, String(emitterProps.particleSpriteSequenceMode ?? 'loop'), particle.lifetime, particle.trackId)
                    : undefined;
                  const replacementMesh = createParticleMesh(
                    particle.mesh.position.clone(),
                    getPreviewedParticleColor(particle.baseColor ?? '#ffffff'),
                    getPreviewedParticleSize(particle.baseSize ?? 3),
                    existingMaterial.opacity,
                    effectiveParticleType,
                    getPreviewedGlow(emitterGlow),
                    particle.rotation ?? getParticleRotation(particle.mesh),
                    (effectiveParticleType === 'sprites' || effectiveParticleType === '3d-model') ? replacementSpriteTexture : undefined,
                    0.5,
                    0.5,
                    false,
                    emitterProps.particleBlendMode || 'normal',
                    currentEmitterMetalness,
                    currentEmitterRoughness,
                    currentEmitterMetalSheen,
                    currentEmitterSheenColor
                  );
                  scene.remove(particle.mesh);
                  scene.add(replacementMesh);
                  particle.mesh = replacementMesh;
                    setParticleSize(particle.mesh, getPreviewedParticleSize(particle.baseSize ?? 3), particle.flipX);
                  }

                // Apply particle appearance updates based on lifetime and current emitter settings
                const material = getParticleMaterial(particle.mesh);
                const progress = particle.lifetime > 0
                  ? Math.min(1, Math.max(0, particle.age / particle.lifetime))
                  : 1;

                const nextBlending = emitterGlow ? THREE.AdditiveBlending : THREE.NormalBlending;
                if (material.blending !== nextBlending || material.depthWrite !== !emitterGlow) {
                  material.blending = nextBlending;
                  material.depthWrite = !emitterGlow;
                  material.needsUpdate = true;
                }

                if (particle.tintGradient && particle.tintGradient.length > 0) {
                    const tintSample = sampleTintGradient(particle.tintGradient, progress);
                    material.opacity = tintSample.a;
                  } else if (emitterProps.particleOpacityOverLifeCurve && !particle.opacityOverLife) {
                    const curveValue = evaluateCurve(emitterProps.particleOpacityOverLifeCurve, progress, 1);
                    material.opacity = (particle.baseOpacity ?? 0.8) * curveValue;
                  } else if (particle.opacityOverLife) {
                    material.opacity = (particle.baseOpacity ?? 0.8) * (1 - progress);
                  } else {
                    material.opacity = particle.baseOpacity ?? 0.8;
                  }

                // Visibility is handled entirely by the unconditional lifecycle loop below.
                // Do NOT set visible here — the oldest-only rule requires seeing all particles
                // at once to determine which one is active.

                if ((effectiveParticleType === 'sprites' || effectiveParticleType === '3d-model')) {
                  let spriteTexture = resolveSpriteTexture(particle.spriteImageDataUrl ?? '', particle.spriteSequenceDataUrls ?? [], particle.age, currentEmitterFps, String(emitterProps.particleSpriteSequenceMode ?? 'loop'), particle.lifetime);
                  
                  if (particle.flipX && spriteTexture) {
                    let flipped = flippedTextureCache.get(spriteTexture);
                    if (!flipped) {
                        flipped = spriteTexture.clone();
                        flipped.repeat.x = -1;
                        flipped.offset.x = 1;
                        flippedTextureCache.set(spriteTexture, flipped);
                    }
                    spriteTexture = flipped;
                  }

                  if (material.map !== (spriteTexture ?? null)) {
                    material.map = spriteTexture ?? null;
                    material.needsUpdate = true;
                  }
                }

                if (effectiveParticleType === 'metallic-sphere') {
                  const metallicTex = getParticleTexture('metallic-sphere', getPreviewedGlow(emitterGlow), currentEmitterMetalness, currentEmitterRoughness, 0, '#ffffff') ?? null;
                  if (material.map !== metallicTex) {
                    material.map = metallicTex;
                    material.needsUpdate = true;
                  }
                }

                // Per-frame sheen texture refresh for non-metallic-sphere types
                if (effectiveParticleType !== 'metallic-sphere' && currentEmitterMetalSheen > 0) {
                  const sheenTex = getParticleTexture(effectiveParticleType, getPreviewedGlow(emitterGlow), currentEmitterMetalness, currentEmitterRoughness, currentEmitterMetalSheen, currentEmitterSheenColor) ?? null;
                  if (material.map !== sheenTex) {
                    material.map = sheenTex;
                    material.needsUpdate = true;
                  }
                }

                setParticleRotation(particle.mesh, particle.rotation);

                if (particle.tintGradient && particle.tintGradient.length > 0) {
                  const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
                  if (isWhiteDotPreview) {
                    material.color.copy(new THREE.Color('#ffffff'));
                  } else {
                    const tintSample = sampleTintGradient(particle.tintGradient, progress);
                    material.color.setRGB(tintSample.r, tintSample.g, tintSample.b);
                  }
                } else if (particle.colorOverLife) {
                  const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
                  if (isWhiteDotPreview) {
                    material.color.copy(new THREE.Color('#ffffff'));
                  } else {
                    const startColor = new THREE.Color(particle.baseColor ?? '#ffffff');
                    const targetColor = new THREE.Color(particle.colorOverLifeTarget ?? '#000000');
                    material.color.lerpColors(startColor, targetColor, progress);
                  }
                } else {
                  material.color.copy(new THREE.Color(getPreviewedParticleColor(particle.baseColor ?? '#ffffff')));
                }

                const sizeOverLife = particle.sizeOverLife ?? 'none';
                const baseSize = particle.baseSize ?? 3;
                const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
                const previewDotSize = Math.max(0.2, Number(sceneSettingsRef.current.particlePreviewSize ?? 1.2));
                if (isWhiteDotPreview) {
                  setParticleSize(particle.mesh, previewDotSize, particle.flipX);
                } else if (sizeOverLife === 'curve') {
                    const curveValue = evaluateCurve(emitterProps?.particleSizeOverLifeCurve, progress, 1);
                    setParticleSize(particle.mesh, baseSize * curveValue, particle.flipX);
                  } else if (sizeOverLife === 'curve') {
                    const curveValue = evaluateCurve(emitterProps?.particleSizeOverLifeCurve, progress, 1);
                    setParticleSize(particle.mesh, baseSize * curveValue, particle.flipX);
                  } else if (sizeOverLife === 'shrink') {
                    setParticleSize(particle.mesh, baseSize * (1 - progress), particle.flipX);
                  } else if (sizeOverLife === 'grow') {
                    setParticleSize(particle.mesh, baseSize * (0.5 + progress * 0.5), particle.flipX);
                  } else {
                    setParticleSize(particle.mesh, baseSize, particle.flipX);
                  }
              }
            }
          }
        });

        // Draw particle paths as exact Bezier control points for Spine export
        particleSystemsRef.current.forEach((particleSystem, emitterId) => {
          const emitterObj = sceneObjectsRef.current.find(obj => obj.id === emitterId);
          if (!emitterObj || !emitterObj.properties) return;
          
          const emitterProps = emitterObj.properties as unknown as { showPathCurves?: boolean; pathCurveKeyCount?: number };
          const showPaths = emitterProps.showPathCurves ?? false;
          
          if (showPaths) {
            particleSystem.particles.forEach(particle => {
              if (particle.positionHistory && particle.positionHistory.length >= 2) {
                const oldLine = particle.mesh.userData.pathLine as THREE.Line;
                const oldPoints = particle.mesh.userData.pathPoints as THREE.Group;
                if (oldLine) scene.remove(oldLine);
                if (oldPoints) scene.remove(oldPoints);

                const pathPointsGroup = new THREE.Group();

                const historyLength = particle.positionHistory.length;
                const keysCount = Math.max(2, Math.min(emitterProps.pathCurveKeyCount ?? 5, historyLength));
                const sampledPoints: THREE.Vector3[] = [];
                for (let i = 0; i < keysCount; i++) {
                    const idx = Math.floor(i * (historyLength - 1) / (keysCount - 1));
                    sampledPoints.push(particle.positionHistory[idx]);
                }

                const controlPointGeometry = new THREE.SphereGeometry(2, 8, 8);
                const controlPointMaterial = new THREE.MeshBasicMaterial({ color: 0xff6600 });
                
                sampledPoints.forEach((pos) => {
                  const controlPoint = new THREE.Mesh(controlPointGeometry, controlPointMaterial.clone());
                  controlPoint.position.copy(pos);
                  pathPointsGroup.add(controlPoint);
                });

                const curve = new THREE.CatmullRomCurve3(sampledPoints, false, 'catmullrom', 0.5);
                const curvePoints = curve.getPoints(50);

                const lineGeometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
                const lineMaterial = new THREE.LineBasicMaterial({
                  color: 0x00ff99,
                  transparent: true,
                  opacity: 0.7
                });
                const controlLine = new THREE.Line(lineGeometry, lineMaterial);
                pathPointsGroup.add(controlLine);

                particle.mesh.userData.pathLine = controlLine;
                particle.mesh.userData.pathPoints = pathPointsGroup;
                scene.add(pathPointsGroup);
              }
            });
          }
        });

        if (isCachingRef.current && frameChanged && timelineFrame >= timelineInRef.current && timelineFrame <= timelineOutRef.current) {
          captureParticleFrame(timelineFrame);
        }
      }

      lastTimelineFrameRef.current = timelineFrame;

      // ── Lifecycle visibility (always runs — live, baking, and cache-restored playback) ──────
      particleSystemsRef.current.forEach((ps) => {
        ps.particles.forEach((p) => {
          // Particles rely on their material opacity, scale, and color curves for fade in/out.
          // They should remain visible throughout their active lifetime (0.0 to 1.0)
          // instead of being abruptly culled.
          const visible = p.age < p.lifetime;
          p.mesh.visible = visible && (sceneSettingsRef.current.showParticles ?? true);
        });
      });
      // ── End lifecycle visibility ─────────────────────────────────────────────────────────────

      // ── Lightning live preview ───────────────────────────────────────────────────────────────
      sceneObjectsRef.current.forEach(lObj => {
        if (lObj.type !== 'Lightning') return;
        const lGroup = sceneObjectMeshesRef.current.get(lObj.id) as THREE.Group | undefined;
        if (!lGroup) return;

        // Flush stale lines from the previous tick
        while (lGroup.children.length > 0) {
          const child = lGroup.children[0] as THREE.Line;
          (child as any).geometry?.dispose();
          ((child as any).material as THREE.Material)?.dispose();
          lGroup.remove(child);
        }
        lGroup.position.set(0, 0, 0);

        const lPts = sceneObjectsRef.current.filter(
          o => o.parentId === lObj.id && o.type === 'LightningPoint',
        );
        const lProps = (lObj.properties ?? {}) as any;
        const lStart = lPts.find(p => (p.properties as any)?.role === 'start') ?? lPts[0];
        const lEnd   = lPts.find(p => (p.properties as any)?.role === 'end')   ?? lPts[1];

        const resolveAnchorCenter = (shapeId: string | undefined, fallback: { x: number; y: number; z?: number }) => {
          if (!shapeId) return fallback;

          const anchorMesh = sceneObjectMeshesRef.current.get(shapeId);
          if (anchorMesh) {
            const wp = new THREE.Vector3();
            anchorMesh.getWorldPosition(wp);
            return { x: wp.x, y: wp.y, z: wp.z };
          }

          const anchorObj = sceneObjectsRef.current.find((o) => o.id === shapeId);
          if (anchorObj) {
            return { x: anchorObj.position.x, y: anchorObj.position.y, z: anchorObj.position.z };
          }

          return fallback;
        };

        const resolveAnchorSurface = (
          shapeId: string | undefined,
          toward: { x: number; y: number; z?: number },
          fallback: { x: number; y: number; z?: number },
        ) => {
          if (!shapeId) return fallback;

          const anchorMesh = sceneObjectMeshesRef.current.get(shapeId);
          const centerGuess = resolveAnchorCenter(shapeId, fallback);
          const center = new THREE.Vector3(centerGuess.x, centerGuess.y, centerGuess.z ?? 0);
          const towardVec = new THREE.Vector3(toward.x, toward.y, toward.z ?? 0);
          const dir = towardVec.clone().sub(center);
          if (dir.lengthSq() < 1e-8) return centerGuess;
          dir.normalize();

          let size = new THREE.Vector3(24, 24, 24);
          if (anchorMesh) {
            const box = new THREE.Box3().setFromObject(anchorMesh);
            const boxSize = box.getSize(new THREE.Vector3());
            const boxCenter = box.getCenter(new THREE.Vector3());
            if (Number.isFinite(boxSize.x + boxSize.y + boxSize.z) && boxSize.lengthSq() > 1e-8) {
              size.copy(boxSize);
              center.copy(boxCenter);
            }
          } else {
            const anchorObj = sceneObjectsRef.current.find((o) => o.id === shapeId);
            if (anchorObj) {
              const sx = Math.abs(anchorObj.scale.x || 1);
              const sy = Math.abs(anchorObj.scale.y || 1);
              const sz = Math.abs(anchorObj.scale.z || 1);
              if (anchorObj.type === 'Cube') size.set(30 * sx, 30 * sy, 30 * sz);
              else if (anchorObj.type === 'Sphere') size.set(36 * sx, 36 * sy, 36 * sz);
              else if (anchorObj.type === 'Cylinder') size.set(28 * sx, 34 * sy, 28 * sz);
              else if (anchorObj.type === 'Cone') size.set(28 * sx, 34 * sy, 28 * sz);
              else if (anchorObj.type === 'Plane') size.set(40 * sx, 40 * sy, 2 * sz);
              else if (anchorObj.type === 'Torus') size.set(46 * sx, 46 * sy, 10 * sz);
              else if (anchorObj.type === 'Circle') size.set(36 * sx, 36 * sy, 2 * sz);
              else if (anchorObj.type === 'Rectangle') size.set(36 * sx, 20 * sy, 2 * sz);
              else if (anchorObj.type === 'Triangle') size.set(36 * sx, 32 * sy, 2 * sz);
            }
          }

          const rx = Math.max(1, size.x * 0.5);
          const ry = Math.max(1, size.y * 0.5);
          const rz = Math.max(1, size.z * 0.5);
          const denom = Math.sqrt(
            (dir.x * dir.x) / (rx * rx) +
            (dir.y * dir.y) / (ry * ry) +
            (dir.z * dir.z) / (rz * rz)
          );
          if (!Number.isFinite(denom) || denom <= 1e-6) {
            return { x: center.x, y: center.y, z: center.z };
          }
          const dist = 1 / denom;
          const hit = center.clone().addScaledVector(dir, dist);
          return { x: hit.x, y: hit.y, z: hit.z };
        };

        const fallbackStart = lStart?.position ?? { x: -80, y: 0, z: 0 };
        const fallbackEnd = lEnd?.position ?? { x: 80, y: 0, z: 0 };
        const startCenter = resolveAnchorCenter(lProps.startShapeId, fallbackStart);
        const endCenter = resolveAnchorCenter(lProps.endShapeId, fallbackEnd);
        const lStartPos = lProps.startShapeId
          ? resolveAnchorSurface(lProps.startShapeId, endCenter, fallbackStart)
          : fallbackStart;
        const lEndPos = lProps.endShapeId
          ? resolveAnchorSurface(lProps.endShapeId, startCenter, fallbackEnd)
          : fallbackEnd;

        const lMode  = (lProps.mode ?? 'loop-strike') as 'strike' | 'loop' | 'loop-strike';
        const exportState = lightningViewportExportRef.current?.lightningId === lObj.id
          ? lightningViewportExportRef.current
          : null;

        // ── Per-mode seed / subset / opacityScale ──────────────────────────
        let lSeed         = 777;
        let lSubset       = 1.0;
        let lOpacityScale = 1.0;

        if (exportState) {
          const exportFrameCount = Math.max(1, exportState.frameCount);
          const exportFrameIndex = Math.max(0, Math.min(exportFrameCount - 1, exportState.frameIndex));
          const exportFps = Math.max(1, exportState.fps || Number(lProps.fps ?? 12));
          const easeStrike = (t: number) => Math.pow(Math.max(0, Math.min(1, t)), 2.35);

          if (lMode === 'loop') {
            lSeed = 777 + exportFrameIndex * 7919;
          } else if (lMode === 'strike') {
            lSubset = exportFrameCount <= 1 ? 1 : exportFrameIndex / Math.max(1, exportFrameCount - 1);
          } else {
            const strikeDur = Math.max(0.1, Number(lProps.frameCount ?? 10) / exportFps);
            const holdDur = 0.26;
            const fadeDur = strikeDur * 0.55;
            const totalDur = strikeDur + holdDur + fadeDur;
            const timeSec = exportFrameCount <= 1
              ? strikeDur
              : (exportFrameIndex / Math.max(1, exportFrameCount - 1)) * totalDur;

            if (timeSec <= strikeDur) {
              lSubset = easeStrike(timeSec / Math.max(strikeDur, 1e-6));
            } else if (timeSec <= strikeDur + holdDur) {
              lSubset = 1;
              const shimmer = 0.90
                + 0.07 * Math.abs(Math.sin(timeSec * 32.0))
                + 0.03 * Math.abs(Math.sin(timeSec * 11.2 + 0.8));
              lOpacityScale = Math.min(1.0, shimmer);
            } else {
              lSubset = 1;
              const fadeT = Math.max(0, Math.min(1, (timeSec - strikeDur - holdDur) / Math.max(fadeDur, 1e-6)));
              const baseDecay = Math.max(0, 1 - fadeT);
              const flickerAmt = Math.min(1, fadeT * 5.0);
              const f1 = Math.abs(Math.sin(timeSec * 38.0));
              const f2 = Math.abs(Math.sin(timeSec * 13.7 + 1.1));
              const flicker = Math.pow(f1 * f2, 0.4);
              lOpacityScale = baseDecay * (1.0 - flickerAmt * 0.82 + flicker * flickerAmt * 0.82);
            }
          }
        } else if (lMode === 'loop') {
          lSeed = isPlayingRef.current ? (Date.now() / 80) | 0 : 777;

        } else if (lMode === 'strike') {
          // Grows via timeline scrub
          const frameIn     = timelineInRef.current ?? 0;
          const totalFrames = Math.max(1, Number(lProps.frameCount ?? 10) - 1);
          lSubset = Math.max(0, Math.min(1, (timelineFrame - frameIn) / totalFrames));

        } else { // loop-strike
          const strikeDur = Math.max(0.1, Number(lProps.frameCount ?? 10) / Math.max(1, Number(lProps.fps ?? 12)));
          const holdDur   = 0.26;
          const fadeDur   = strikeDur * 0.55;
          const easeStrike = (t: number) => Math.pow(Math.max(0, Math.min(1, t)), 2.35);

          if (!loopStrikeStateRef.current.has(lObj.id)) {
            loopStrikeStateRef.current.set(lObj.id, { phase: 'growing', progress: 0, seed: (Date.now() * 0.01) | 0 });
          }
          const ls = loopStrikeStateRef.current.get(lObj.id)!;

          if (isPlayingRef.current) {
            const phaseDur = ls.phase === 'growing' ? strikeDur
                           : ls.phase === 'holding' ? holdDur
                           : fadeDur;
            ls.progress += frameDeltaTime / phaseDur;

            if (ls.progress >= 1) {
              ls.progress = 0;
              if      (ls.phase === 'growing') { ls.phase = 'holding'; }
              else if (ls.phase === 'holding') { ls.phase = 'fading'; }
              else {
                ls.phase = 'growing';
                ls.seed  = (Date.now() * 0.01 + Math.random() * 99999) | 0;
              }
            }
          }

          lSeed   = ls.seed;
          lSubset = ls.phase === 'growing' ? easeStrike(ls.progress)
                  : ls.phase === 'holding' ? 1.0
                  : 1.0;

          if (ls.phase === 'holding') {
            const t = Date.now() * 0.001;
            const shimmer = 0.90
              + 0.07 * Math.abs(Math.sin(t * 32.0))
              + 0.03 * Math.abs(Math.sin(t * 11.2 + 0.8));
            lOpacityScale = Math.min(1.0, shimmer);
          } else if (ls.phase === 'fading') {
            const t         = Date.now() * 0.001;
            const baseDecay = Math.max(0, 1 - ls.progress);
            const flickerAmt = Math.min(1, ls.progress * 5.0);
            const f1 = Math.abs(Math.sin(t * 38.0));
            const f2 = Math.abs(Math.sin(t * 13.7 + 1.1));
            const flicker = Math.pow(f1 * f2, 0.4);
            lOpacityScale = baseDecay * (1.0 - flickerAmt * 0.82 + flicker * flickerAmt * 0.82);
          } else {
            lOpacityScale = 1.0;
          }
        }

        /** Trim a polyline (2-D or 3-D) to the first `subset` fraction of arc length. */
        const trimPolyline = (
          pts: { x: number; y: number; z?: number }[],
          subset: number,
        ): { x: number; y: number; z?: number }[] => {
          if (subset >= 1 || pts.length < 2) return pts;
          if (subset <= 0) return [pts[0], pts[0]];
          let total = 0;
          for (let i = 1; i < pts.length; i++) {
            const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
            const dz = (pts[i].z ?? 0) - (pts[i-1].z ?? 0);
            total += Math.sqrt(dx*dx + dy*dy + dz*dz);
          }
          const target = total * subset;
          const out: { x: number; y: number; z?: number }[] = [pts[0]];
          let acc = 0;
          for (let i = 1; i < pts.length; i++) {
            const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
            const dz = (pts[i].z ?? 0) - (pts[i-1].z ?? 0);
            const seg = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (acc + seg >= target) {
              const t = (target - acc) / Math.max(seg, 1e-9);
              out.push({
                x: pts[i-1].x + dx * t,
                y: pts[i-1].y + dy * t,
                z: (pts[i-1].z ?? 0) + dz * t,
              });
              return out;
            }
            out.push(pts[i]);
            acc += seg;
          }
          return out;
        };

        const samplePolylineAtFraction = (
          pts: { x: number; y: number; z?: number }[],
          frac: number,
        ): { x: number; y: number; z?: number } => {
          if (pts.length === 0) return { x: 0, y: 0, z: 0 };
          if (pts.length === 1) return pts[0];
          const targetFrac = Math.max(0, Math.min(1, frac));
          let total = 0;
          for (let i = 1; i < pts.length; i++) {
            const dx = pts[i].x - pts[i - 1].x;
            const dy = pts[i].y - pts[i - 1].y;
            const dz = (pts[i].z ?? 0) - (pts[i - 1].z ?? 0);
            total += Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
          if (total <= 1e-8) return pts[0];
          const target = total * targetFrac;
          let acc = 0;
          for (let i = 1; i < pts.length; i++) {
            const ax = pts[i - 1].x, ay = pts[i - 1].y, az = pts[i - 1].z ?? 0;
            const bx = pts[i].x, by = pts[i].y, bz = pts[i].z ?? 0;
            const dx = bx - ax, dy = by - ay, dz = bz - az;
            const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (acc + seg >= target) {
              const t = (target - acc) / Math.max(seg, 1e-8);
              return { x: ax + dx * t, y: ay + dy * t, z: az + dz * t };
            }
            acc += seg;
          }
          return pts[pts.length - 1];
        };

        const lStartVec = new THREE.Vector3(lStartPos.x, lStartPos.y, lStartPos.z ?? 0);
        const lEndVec = new THREE.Vector3(lEndPos.x, lEndPos.y, lEndPos.z ?? 0);
        const lDir = new THREE.Vector3().subVectors(lEndVec, lStartVec);
        const lLen = Math.max(1e-3, lDir.length());
        lDir.normalize();

        const upRef = Math.abs(lDir.y) < 0.95
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);
        const lRight = new THREE.Vector3().crossVectors(upRef, lDir).normalize();
        const lUp = new THREE.Vector3().crossVectors(lDir, lRight).normalize();

        const localToWorld = (pt: { x: number; y: number; z?: number }) => {
          const world = lStartVec.clone()
            .addScaledVector(lDir, pt.x)
            .addScaledVector(lUp, pt.y)
            .addScaledVector(lRight, pt.z ?? 0);
          return { x: world.x, y: world.y, z: world.z };
        };

        const localPreview = buildLightningPreview(
          0, 0,
          lLen, 0,
          Number(lProps.segmentDepth      ?? 2),
          Number(lProps.roughness         ?? 0.45),
          Number(lProps.branchCount       ?? 2),
          Number(lProps.branchDecay       ?? 0.5),
          lSeed,
          Number(lProps.numSegments       ?? 4),
          Number(lProps.branchProbability ?? 0.5),
          Number(lProps.subBranchSegments ?? 2),
          Number(lProps.turbulence        ?? 0.35),
          Number(lProps.branchLevels      ?? 2),
          Number(lProps.bend              ?? 0),
          Number(lProps.branchAngle       ?? 90),
        );

        const lMainFull = localPreview.main.map(localToWorld);
        const lBranchesFull = localPreview.branches.map((branchPts) => branchPts.map(localToWorld));
        const lBrParentTs = localPreview.branchParentTs;
        const lBrGens = localPreview.branchGenerations;
        const lWpts = localPreview.waypoints.map(localToWorld);
        const lBrWpts = localPreview.branchWaypoints.map((branchWp) => branchWp.map(localToWorld));

        const applyForceModifiersToPolyline = (
          points: { x: number; y: number; z?: number }[],
          keepStart: boolean,
          keepEnd: boolean,
          strengthMul: number,
        ): { x: number; y: number; z?: number }[] => {
          if (points.length < 2 || strengthMul <= 0) return points;

          const startP = points[0];
          const endP = points[points.length - 1];
          const baseLen = Math.max(
            1,
            new THREE.Vector3(endP.x - startP.x, endP.y - startP.y, (endP.z ?? 0) - (startP.z ?? 0)).length(),
          );
          const maxOffset = Math.min(160, baseLen * Math.max(0.25, 0.55 * strengthMul));

          const forces = physicsForceRef.current.filter((f) =>
            f.enabled && (f.type === 'attractor' || f.type === 'repulsor' || f.type === 'flow-curve')
          );
          if (forces.length === 0) return points;

          return points.map((pt, idx) => {
            if ((keepStart && idx === 0) || (keepEnd && idx === points.length - 1)) {
              return pt;
            }

            const pos = new THREE.Vector3(pt.x, pt.y, pt.z ?? 0);
            const offset = new THREE.Vector3();

            forces.forEach((force) => {
              if (force.type === 'attractor' || force.type === 'repulsor') {
                let targetPos = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
                if (force.targetShapeId) {
                  const targetShape = sceneObjectsRef.current.find((obj) => obj.id === force.targetShapeId);
                  if (targetShape) {
                    targetPos = new THREE.Vector3(targetShape.position.x, targetShape.position.y, targetShape.position.z);
                  }
                }

                const toTarget = new THREE.Vector3().subVectors(targetPos, pos);
                const dist = toTarget.length();
                const radius = Math.max(0.1, force.radius ?? 250);
                const falloff = Math.max(0, 1 - dist / radius);
                if (falloff <= 0 || dist < 1e-4) return;

                const direction = toTarget.normalize();
                const sign = force.type === 'attractor' ? 1 : -1;
                const mag = Math.abs(force.strength) * 0.018 * falloff * strengthMul;
                offset.addScaledVector(direction, sign * mag);
                return;
              }

              if (force.type === 'flow-curve' && force.curveId) {
                const pathMesh = sceneObjectMeshesRef.current.get(force.curveId) as any;
                if (!pathMesh?.pathCurve) return;
                const curve = pathMesh.pathCurve as THREE.Curve<THREE.Vector3>;

                let closestT = 0;
                let minDistSq = Infinity;
                for (let i = 0; i <= 24; i++) {
                  const t = i / 24;
                  const sample = curve.getPointAt(t);
                  const distSq = sample.distanceToSquared(pos);
                  if (distSq < minDistSq) {
                    minDistSq = distSq;
                    closestT = t;
                  }
                }

                const nearest = curve.getPointAt(closestT);
                const toCurve = new THREE.Vector3().subVectors(nearest, pos);
                const dist = Math.sqrt(minDistSq);
                const radius = Math.max(0.1, force.radius ?? 120);
                const pull = Math.max(0, 1 - dist / radius);
                if (pull <= 0) return;

                let tangent = curve.getTangentAt(closestT).normalize();
                if (!Number.isFinite(tangent.x) || !Number.isFinite(tangent.y) || !Number.isFinite(tangent.z) || tangent.lengthSq() < 1e-8) {
                  return;
                }
                if (force.reverseFlow) tangent.negate();

                const flowMag = Math.abs(force.strength) * 0.01 * pull * strengthMul;
                const pullMag = Math.abs(force.strength) * 0.02 * pull * strengthMul;

                offset.addScaledVector(tangent, flowMag);
                if (toCurve.lengthSq() > 1e-6) {
                  offset.addScaledVector(toCurve.normalize(), pullMag);
                }
              }
            });

            if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y) || !Number.isFinite(offset.z)) {
              return pt;
            }

            if (offset.length() > maxOffset) {
              offset.setLength(maxOffset);
            }

            const nx = pos.x + offset.x;
            const ny = pos.y + offset.y;
            const nz = (pt.z ?? 0) + offset.z;
            if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
              return pt;
            }
            return { x: nx, y: ny, z: nz };
          });
        };

        const usePhysicsModifiers = Boolean(lProps.usePhysicsModifiers ?? false);
        const modifierStrength = Math.max(0, Number(lProps.modifierStrength ?? 1));
        const targetAttraction = Math.max(0, Math.min(10, Number(lProps.targetAttraction ?? 0.6)));
        const targetAttractionNorm = Math.max(0, Math.min(1, targetAttraction / 10));

        const pullPolylineTowardTarget = (
          pts: { x: number; y: number; z?: number }[],
          target: { x: number; y: number; z?: number },
          amount: number,
          keepStart: boolean,
          keepEnd: boolean,
        ) => {
          if (amount <= 0.001 || pts.length < 2) return pts;
          const targetVec = new THREE.Vector3(target.x, target.y, target.z ?? 0);
          return pts.map((pt, idx) => {
            if ((keepStart && idx === 0) || (keepEnd && idx === pts.length - 1)) return pt;
            const t = idx / Math.max(1, pts.length - 1);
            const weight = Math.pow(t, 2.15) * amount;
            const p = new THREE.Vector3(pt.x, pt.y, pt.z ?? 0);
            p.lerp(targetVec, Math.min(0.82, weight * 0.085));
            return { x: p.x, y: p.y, z: p.z };
          });
        };

        let lMainMod = usePhysicsModifiers
          ? applyForceModifiersToPolyline(lMainFull, true, true, modifierStrength)
          : lMainFull;
        if (lProps.endShapeId) {
          lMainMod = pullPolylineTowardTarget(lMainMod, lEndPos, targetAttraction, true, true);
        }
        const lBranchesMod = usePhysicsModifiers
          ? lBranchesFull.map((branchPts) => applyForceModifiersToPolyline(branchPts, true, false, modifierStrength))
          : lBranchesFull;

        const curveTightness = Math.max(0, Math.min(10, Number(lProps.curveTightness ?? 0.65)));
        const followBezierPathIds = Array.isArray(lProps.followBezierPathIds)
          ? (lProps.followBezierPathIds as string[]).filter((id) => typeof id === 'string' && id.trim().length > 0)
          : [];
        const followCurves: Array<{ id: string; curve: THREE.Curve<THREE.Vector3> }> = [];
        followBezierPathIds.forEach((pathId) => {
          const pathMesh = sceneObjectMeshesRef.current.get(pathId) as any;
          const curve = pathMesh?.pathCurve as THREE.Curve<THREE.Vector3> | undefined;
          if (curve && typeof curve.getPointAt === 'function') {
            followCurves.push({ id: pathId, curve });
          }
        });

        const bendMainTowardCurve = (
          pts: { x: number; y: number; z?: number }[],
          curve: THREE.Curve<THREE.Vector3>,
          tightness: number,
        ) => {
          if (tightness <= 0.001 || pts.length < 3) return pts;
          const start = new THREE.Vector3(pts[0].x, pts[0].y, pts[0].z ?? 0);
          const end   = new THREE.Vector3(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[pts.length - 1].z ?? 0);
          // Minimum turbulence fraction always visible regardless of tightness
          const MIN_TURB = 0.12;
          return pts.map((pt, idx) => {
            if (idx === 0 || idx === pts.length - 1) return pt;
            const t = idx / Math.max(1, pts.length - 1);
            const curvePt = curve.getPointAt(Math.max(0, Math.min(1, t)));
            const p = new THREE.Vector3(pt.x, pt.y, pt.z ?? 0);
            // Turbulence offset = deviation from straight-line baseline
            const straight = start.clone().lerp(end, t);
            const turbOff = p.clone().sub(straight);
            const edgeFalloff = Math.sin(Math.PI * t); // 0 at ends, 1 at center
            const w = Math.max(0, Math.min(0.985, tightness * edgeFalloff));
            p.lerp(curvePt, w);
            // Ensure at least MIN_TURB fraction of turbulence is always preserved
            const turbPreserved = 1 - w;
            if (turbPreserved < MIN_TURB) {
              p.addScaledVector(turbOff, MIN_TURB - turbPreserved);
            }
            return { x: p.x, y: p.y, z: p.z };
          });
        };

        type ArcVariant = {
          mainMod: { x: number; y: number; z?: number }[];
          seedBias: number;
        };

        // ── Surface binding ──────────────────────────────────────────────────
        const bindSurfaceId = typeof lProps.bindSurfaceId === 'string' ? lProps.bindSurfaceId : '';
        const bindSpineAttachmentId = typeof lProps.bindSpineAttachmentId === 'string' ? lProps.bindSpineAttachmentId : '';
        const spineEdgeRatio = Math.max(0, Math.min(1, Number(lProps.spineEdgeRatio ?? 0)));
        const surfaceTightness = Math.max(0, Math.min(1, Number(lProps.surfaceTightness ?? 0.72)));

        // ── Surface snap — uses module-level cached triangle lists ───────────
        const snapToSurface = (
          pts: { x: number; y: number; z?: number }[],
          surfObjId: string,
          meshRoot: THREE.Object3D,
          tightness: number,
          keepEnd = true,
        ) => {
          if (tightness <= 0.001 || pts.length < 3) return pts;

          // Get or rebuild cached triangle list (only when mesh moves/scales)
          meshRoot.updateWorldMatrix(true, true);
          const matKey = meshMatrixKey(meshRoot);
          let cached = surfaceTriCacheRef.current.get(surfObjId);
          if (!cached || cached.key !== matKey) {
            cached = { tris: buildSurfaceTris(meshRoot), key: matKey };
            surfaceTriCacheRef.current.set(surfObjId, cached);
          }
          const tris = cached.tris;
          if (tris.length === 0) return pts;

          const SURFACE_OFFSET = 0.8;
          const findClosestOnSurface = (p: THREE.Vector3): THREE.Vector3 => {
            let bestDistSq = Infinity;
            let bestPt = p.clone();
            let bestNormal = new THREE.Vector3(0, 0, 1);
            for (let ti = 0; ti < tris.length; ti++) {
              const { a, b, c, n } = tris[ti];
              closestPointOnTriangleCached(p, a, b, c, _cpotRes);
              const dsq = p.distanceToSquared(_cpotRes);
              if (dsq < bestDistSq) { bestDistSq = dsq; bestPt = _cpotRes.clone(); bestNormal = n; }
            }
            return bestPt.addScaledVector(bestNormal, SURFACE_OFFSET);
          };

          return pts.map((pt, idx) => {
            if (idx === 0) return pt;
            if (keepEnd && idx === pts.length - 1) return pt;
            const p = new THREE.Vector3(pt.x, pt.y, pt.z ?? 0);
            const surfPt = findClosestOnSurface(p);
            const t = idx / Math.max(1, pts.length - 1);
            const edgeFalloff = keepEnd
              ? Math.sin(Math.PI * t)
              : Math.max(Math.sin(Math.PI * t), t * 0.85);
            const w = Math.max(0, Math.min(1.0, tightness * edgeFalloff));
            const snapped = p.clone().lerp(surfPt, w);
            return { x: snapped.x, y: snapped.y, z: snapped.z };
          });
        };

        const snapToSpineAttachmentMask = (
          pts: { x: number; y: number; z?: number }[],
          attachmentId: string,
          edgeRatio: number,
          tightness: number,
          keepStart = true,
          keepEnd = true,
        ) => {
          if (tightness <= 0.001 || pts.length < 3) return pts;

          const attMesh = spineAttachmentMeshesRef.current.get(attachmentId);
          const maskData = spineAttachPixelDataRef.current.get(attachmentId);
          if (!attMesh || !maskData) return pts;

          const geom = attMesh.geometry as THREE.PlaneGeometry;
          const width = Number(geom.parameters?.width ?? 0);
          const height = Number(geom.parameters?.height ?? 0);
          if (width <= 1e-6 || height <= 1e-6) return pts;

          // Build blended candidate pool: lerp between surface and edge samples
          const { surfaceSamples, edgeSamples } = maskData;
          const ratio = Math.max(0, Math.min(1, edgeRatio));
          let candidates: SpineMaskSample[];
          if (ratio <= 0.02) {
            candidates = surfaceSamples.length ? surfaceSamples : edgeSamples;
          } else if (ratio >= 0.98) {
            candidates = edgeSamples.length ? edgeSamples : surfaceSamples;
          } else {
            // Interleave: pick proportional samples from each pool
            const total = Math.max(1, surfaceSamples.length + edgeSamples.length);
            const edgeCount = Math.round(ratio * total);
            const surfCount = total - edgeCount;
            const eSrc = edgeSamples.length ? edgeSamples : surfaceSamples;
            const sSrc = surfaceSamples.length ? surfaceSamples : edgeSamples;
            const eStep = Math.max(1, Math.floor(eSrc.length / Math.max(1, edgeCount)));
            const sStep = Math.max(1, Math.floor(sSrc.length / Math.max(1, surfCount)));
            const mixed: SpineMaskSample[] = [];
            for (let i = 0; i < eSrc.length && mixed.length < edgeCount; i += eStep) mixed.push(eSrc[i]);
            for (let i = 0; i < sSrc.length && mixed.length < edgeCount + surfCount; i += sStep) mixed.push(sSrc[i]);
            candidates = mixed.length ? mixed : (surfaceSamples.length ? surfaceSamples : edgeSamples);
          }
          if (candidates.length === 0) return pts;

          const findNearestSample = (u: number, v: number): SpineMaskSample => {
            let best = candidates[0];
            let bestDistSq = Infinity;
            for (let i = 0; i < candidates.length; i++) {
              const sample = candidates[i];
              const du = sample.u - u;
              const dv = sample.v - v;
              const distSq = du * du + dv * dv;
              if (distSq < bestDistSq) {
                bestDistSq = distSq;
                best = sample;
              }
            }
            return best;
          };

          attMesh.updateWorldMatrix(true, true);

          return pts.map((pt, idx) => {
            if ((keepStart && idx === 0) || (keepEnd && idx === pts.length - 1)) return pt;

            const worldPt = new THREE.Vector3(pt.x, pt.y, pt.z ?? 0);
            const localPt = attMesh.worldToLocal(worldPt.clone());
            const u = THREE.MathUtils.clamp(localPt.x / width + 0.5, 0, 1);
            const v = THREE.MathUtils.clamp(0.5 - localPt.y / height, 0, 1);
            const sample = findNearestSample(u, v);
            const snappedLocal = new THREE.Vector3(
              (sample.u - 0.5) * width,
              (0.5 - sample.v) * height,
              0,
            );
            const snappedWorld = attMesh.localToWorld(snappedLocal.clone());

            const t = idx / Math.max(1, pts.length - 1);
            let falloff = 1;
            if (keepStart && keepEnd) {
              falloff = Math.sin(Math.PI * t);
            } else if (keepStart) {
              falloff = Math.max(Math.sin(Math.PI * t), t * 0.95);
            } else if (keepEnd) {
              falloff = Math.max(Math.sin(Math.PI * t), (1 - t) * 0.95);
            }
            const w = Math.max(0, Math.min(1, tightness * falloff));
            const blended = worldPt.clone().lerp(snappedWorld, w);
            return { x: blended.x, y: blended.y, z: blended.z };
          });
        };

        // Apply surface snapping to main arc and branches before curve-follow
        let lMainBound = lMainMod;
        let lBranchesBound = lBranchesMod;
        if (bindSurfaceId) {
          const surfaceObj = sceneObjectMeshesRef.current.get(bindSurfaceId) as THREE.Object3D | undefined;
          if (surfaceObj) {
            lMainBound = snapToSurface(lMainMod, bindSurfaceId, surfaceObj, surfaceTightness, true);
            lBranchesBound = lBranchesMod.map((bPts) => snapToSurface(bPts, bindSurfaceId, surfaceObj, surfaceTightness, false));
          }
        }
        // ────────────────────────────────────────────────────────────────────────

        const arcVariants: ArcVariant[] = followCurves.length > 0
          ? followCurves.map((entry, idx) => ({
              mainMod: bendMainTowardCurve(lMainBound, entry.curve, curveTightness),
              seedBias: idx * 7919,
            }))
          : [{ mainMod: lMainBound, seedBias: 0 }];

        // Branches hide until junction reached (both strike and loop-strike)
        const isBoltGrowing = lMode === 'strike' || lMode === 'loop-strike';
        const endAnchorObj = lProps.endShapeId
          ? sceneObjectsRef.current.find((o) => o.id === lProps.endShapeId)
          : undefined;
        const endAnchorIsShape = !!endAnchorObj && endAnchorObj.type !== 'LightningPoint' && endAnchorObj.type !== 'PathPoint';

        // End-anchor surface points — cached per object ID + matrix key
        let endAnchorSurfacePoints: THREE.Vector3[] = [];
        if (endAnchorIsShape && lProps.endShapeId) {
          const endAnchorMeshRoot = sceneObjectMeshesRef.current.get(lProps.endShapeId) as THREE.Object3D | undefined;
          if (endAnchorMeshRoot) {
            endAnchorMeshRoot.updateWorldMatrix(true, true);
            const eaMatKey = meshMatrixKey(endAnchorMeshRoot);
            let eaCached = endAnchorVertsCacheRef.current.get(lProps.endShapeId);
            if (!eaCached || eaCached.key !== eaMatKey) {
              eaCached = { verts: buildSurfaceVerts(endAnchorMeshRoot), key: eaMatKey };
              endAnchorVertsCacheRef.current.set(lProps.endShapeId, eaCached);
            }
            endAnchorSurfacePoints = eaCached.verts;
          }
        }

        const pickScatteredEndTarget = (
          generation: number,
          branchIndex: number,
          seedBias: number,
          usedSurfaceIndices: Set<number>,
        ) => {
          if (endAnchorSurfacePoints.length === 0) {
            return new THREE.Vector3(lEndPos.x, lEndPos.y, lEndPos.z ?? 0);
          }

          const count = endAnchorSurfacePoints.length;
          const key = Math.abs(
            Math.sin((branchIndex + 1) * 12.9898 + (generation + 1) * 78.233 + (lSeed + seedBias) * 0.01937),
          );
          const baseIdx = Math.floor(key * count) % count;

          let chosenIdx = baseIdx;
          if (count > 1) {
            const stride = 97 % count || 1;
            for (let s = 0; s < count; s++) {
              const idx = (baseIdx + s * stride) % count;
              if (!usedSurfaceIndices.has(idx)) {
                chosenIdx = idx;
                break;
              }
            }
          }
          usedSurfaceIndices.add(chosenIdx);
          return endAnchorSurfacePoints[chosenIdx].clone();
        };

        const forceBranchStrikeToSurface = endAnchorSurfacePoints.length > 0;

        const pullBranchTipToStrikeTarget = (
          branchPts: { x: number; y: number; z?: number }[],
          generation: number,
          branchIndex: number,
          seedBias: number,
          overrideTarget?: THREE.Vector3,
        ) => {
          if (!endAnchorIsShape || branchPts.length < 3) return branchPts;

          const branchBias = Math.min(1, 0.10 + targetAttraction * 0.11);
          if (!forceBranchStrikeToSurface) {
            const branchPick = Math.abs(Math.sin((branchIndex + 1) * 12.9898 + (generation + 1) * 78.233 + (lSeed + seedBias) * 0.013));
            if (branchPick > branchBias) return branchPts;
          }

          const target = overrideTarget?.clone() ?? new THREE.Vector3(lEndPos.x, lEndPos.y, lEndPos.z ?? 0);
          const tip = branchPts[branchPts.length - 1];
          const tipVec = new THREE.Vector3(tip.x, tip.y, tip.z ?? 0);
          const tipDist = tipVec.distanceTo(target);

          const boltLen = Math.max(
            1,
            new THREE.Vector3(lEndPos.x - lStartPos.x, lEndPos.y - lStartPos.y, (lEndPos.z ?? 0) - (lStartPos.z ?? 0)).length(),
          );
          const attractRadius = Math.max(20, Math.min(320, boltLen * (0.30 + targetAttraction * 0.06)));
          if (!forceBranchStrikeToSurface && tipDist > attractRadius) return branchPts;

          const distFactor = Math.max(0, 1 - (tipDist / attractRadius));
          const genFactor = Math.max(0.35, 1 - generation * 0.18);
          const phaseBoost = isBoltGrowing ? 1.15 : 0.9;
          const basePull = Math.pow(distFactor, 1.2) * (0.08 + targetAttraction * 0.15) * genFactor * phaseBoost;
          const pull = forceBranchStrikeToSurface
            ? Math.min(0.995, Math.max(0.14, basePull * 1.75))
            : Math.min(0.985, basePull);
          if (pull <= 0.001) return branchPts;

          return branchPts.map((pt, idx) => {
            if (idx === 0) return pt;
            const t = idx / Math.max(1, branchPts.length - 1);
            const weight = Math.pow(t, 2.4);
            const p = new THREE.Vector3(pt.x, pt.y, pt.z ?? 0);
            p.lerp(target, pull * weight);
            return { x: p.x, y: p.y, z: p.z };
          });
        };

        interface BranchDraw { pts: { x: number; y: number; z?: number }[]; subset: number; generation: number; }

        const anchorBranchToMain = (
          pts: { x: number; y: number; z?: number }[],
          junctionT: number,
          mainPolyline: { x: number; y: number; z?: number }[],
        ) => {
          if (pts.length === 0) return pts;
          const mainAnchor = samplePolylineAtFraction(mainPolyline, junctionT);
          const root = pts[0];
          const dx = mainAnchor.x - root.x;
          const dy = mainAnchor.y - root.y;
          const dz = (mainAnchor.z ?? 0) - (root.z ?? 0);
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-6) return pts;
          return pts.map((pt) => ({ x: pt.x + dx, y: pt.y + dy, z: (pt.z ?? 0) + dz }));
        };

        const parsedGlow = parseInt((lProps.glowColor ?? '#4466ff').replace('#', ''), 16);
        const parsedCore = parseInt((lProps.coreColor ?? '#ffffff').replace('#', ''), 16);
        const coreW = Math.max(0.5, Number(lProps.coreWidth ?? 2));
        const glowW = Math.max(1,   Number(lProps.glowWidth ?? 6));
        const density = Math.max(0.5, Math.min(4, Number(lProps.density ?? 1.6)));
        // occludeByGeometry now defaults TRUE — sprites are depth-tested against scene geometry.
        // Set lProps.occludeByGeometry = false for the old always-on-top / overlay style.
        const occludeByGeometry = lProps.occludeByGeometry !== false;

        // ── Fractal glow noise ────────────────────────────────────────────────
        const glowNoiseIntensity = Math.max(0, Math.min(1,  Number(lProps.glowNoiseIntensity ?? 0)));
        const glowNoiseScale     = Math.max(0.5, Math.min(120, Number(lProps.glowNoiseScale ?? 3.0)));
        const glowNoiseSpeed     = Math.max(0, Math.min(8,   Number(lProps.glowNoiseSpeed ?? 1.0)));
        // For export-loop: phase = frameIndex/frameCount  → frame 0 == frame N (perfect loop)
        const noisePhase = glowNoiseIntensity > 0.001
          ? (exportState && lMode === 'loop'
              ? exportState.frameIndex / Math.max(1, exportState.frameCount)
              : (Date.now() * 0.001 * glowNoiseSpeed) % 1)
          : 0;
        const noiseFn = glowNoiseIntensity > 0.001
          ? (t: number) => Math.max(0.1,
              1.0 - glowNoiseIntensity * 0.65
                  + lightningLoopNoise(t, noisePhase, glowNoiseScale) * glowNoiseIntensity * 1.3)
          : undefined;
        // ────────────────────────────────────────────────────────────────────────
        const glowTex = buildLightningGlowTex(parsedGlow, parsedCore);

        /**
         * Places one THREE.Sprite per sample point along `bolt`.
         * `spriteWorldSize` = full diameter of the sprite in world units.
         * Sprites use AdditiveBlending so overlapping areas accumulate naturally.
         */
        /**
         * `taperStart` — normalised path position (0–1) where taper begins.
         * Sprites shrink from full size at `taperStart` down to ~4% at the tip.
         * Use a sqrt curve so the taper is gradual then sharp at the very end.
         */
        const addGlowChain = (
          bolt:            { x: number; y: number; z?: number }[],
          spriteWorldSize: number,
          opacity:         number,
          zOffset:         number,
          taperStart:      number = 0.65,
          noiseFn?:        (t: number) => number,
        ) => {
          const spacing = Math.max(0.2, (spriteWorldSize * 0.30) / density);
          const samples = samplePolylineEvenly(bolt, spacing);
          const N = samples.length;
          const mat = new THREE.SpriteMaterial({
            map:         glowTex,
            transparent: true,
            opacity:     (opacity * lOpacityScale) / Math.sqrt(density),
            blending:    THREE.AdditiveBlending,
            depthTest:   occludeByGeometry,
            depthWrite:  false,
          });
          samples.forEach((pt, i) => {
            const t = N > 1 ? i / (N - 1) : 0;
            // Taper scale: 1.0 before taperStart, then sqrt falloff → 0.04 at tip
            const taperScale = t <= taperStart
              ? 1.0
              : Math.sqrt(Math.max(0, 1.0 - (t - taperStart) / (1.0 - taperStart + 1e-9))) * 0.96 + 0.04;
            const noiseMul = noiseFn ? noiseFn(t) : 1.0;
            const sz = spriteWorldSize * taperScale * noiseMul;
            const sp = new THREE.Sprite(mat);
            // Use the point's own Z (from 3D branch spread) plus the layer zOffset
            sp.position.set(pt.x, pt.y, (pt.z ?? 0) + zOffset);
            sp.scale.set(sz, sz, 1);
            lGroup.add(sp);
          });
        };

        // Total visual diameter = glow halo diameter + texture falloff margin (×2 each side)
        const haloD = glowW * 5.0;   // outer atmospheric halo sprite diameter
        const glowD = glowW * 2.4;   // main glow sprite diameter
        const coreD = coreW * 2.2;   // bright core sprite diameter

        const arcOpacityMul = 1 / Math.sqrt(Math.max(1, arcVariants.length));

        arcVariants.forEach((variant, variantIndex) => {
          const usedSurfaceStrikeIndices = new Set<number>();
          const variantMain = bindSpineAttachmentId
            ? snapToSpineAttachmentMask(variant.mainMod, bindSpineAttachmentId, spineEdgeRatio, surfaceTightness, true, true)
            : variant.mainMod;

          // Trim main arc
          const lMain = trimPolyline(variantMain, lSubset);

          const lBranches: BranchDraw[] = [];
          lBranchesBound.forEach((bPts, i) => {
            const junctionT  = lBrParentTs[i] ?? 0;
            const generation = lBrGens[i] ?? 0;
            const branchTarget = pickScatteredEndTarget(generation, i, variant.seedBias, usedSurfaceStrikeIndices);

            if (isBoltGrowing) {
              if (lSubset < junctionT) return;
              const brSubset = Math.min(1, (lSubset - junctionT) / Math.max(0.001, 1 - junctionT));
              const trimmed = trimPolyline(bPts, brSubset);
              const anchored = anchorBranchToMain(trimmed, junctionT, variantMain);
              const struck = pullBranchTipToStrikeTarget(anchored, generation, i, variant.seedBias, branchTarget);
              const masked = bindSpineAttachmentId
                ? snapToSpineAttachmentMask(struck, bindSpineAttachmentId, spineEdgeRatio, surfaceTightness, true, false)
                : struck;
              lBranches.push({ pts: masked, subset: brSubset, generation });
            } else {
              const anchored = anchorBranchToMain(bPts, junctionT, variantMain);
              const struck = pullBranchTipToStrikeTarget(anchored, generation, i, variant.seedBias, branchTarget);
              const masked = bindSpineAttachmentId
                ? snapToSpineAttachmentMask(struck, bindSpineAttachmentId, spineEdgeRatio, surfaceTightness, true, false)
                : struck;
              lBranches.push({ pts: masked, subset: 1, generation });
            }
          });

          // ── Branches: more aggressive taper (start at 40%); dim deeper generations ──
          lBranches.forEach(b => {
            const genScale = Math.pow(0.75, b.generation) * arcOpacityMul;
            addGlowChain(b.pts, haloD  * 0.7, 0.10 * genScale, -0.2 + variantIndex * 0.01, 0.40, noiseFn);
            addGlowChain(b.pts, glowD  * 0.8, 0.28 * genScale, -0.1 + variantIndex * 0.01, 0.40, noiseFn);
            addGlowChain(b.pts, coreD  * 0.9, 0.55 * genScale,  0.0 + variantIndex * 0.01, 0.40, noiseFn);
          });

          // ── Main arc: taper starts at 65% ──
          addGlowChain(lMain, haloD,  0.12 * arcOpacityMul, 0.0 + variantIndex * 0.01, 0.65, noiseFn);
          addGlowChain(lMain, glowD,  0.35 * arcOpacityMul, 0.1 + variantIndex * 0.01, 0.65, noiseFn);
          addGlowChain(lMain, coreD,  0.75 * arcOpacityMul, 0.2 + variantIndex * 0.01, 0.65, noiseFn);
        });

        // ── Bone marker dots at segment junctions (shown only for selected bolt) ──
        const isSelected = selectedObjectIdRef.current === lObj.id && !exportState;
        const hasCurveFollow = followCurves.length > 0;
        if (isSelected) {
          const addBoneDot = (pt: { x: number; y: number; z?: number }, color: number) => {
            const marker = new THREE.Mesh(
              new THREE.SphereGeometry(Math.max(0.6, coreD * 0.22), 10, 10),
              new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.95,
                depthTest: occludeByGeometry,
                depthWrite: false,
              }),
            );
            marker.position.set(pt.x, pt.y, (pt.z ?? 0) + 0.5);
            lGroup.add(marker);
          };
          if (!hasCurveFollow) {
            lWpts.forEach(wp => addBoneDot(wp, 0xffdd44));
            lBrWpts.forEach(brWpts => brWpts.forEach(wp => addBoneDot(wp, 0xff9933)));
          }
        }
      });
      // ── End lightning live preview ───────────────────────────────────────────────────────────

      // ── Flame live preview ───────────────────────────────────────────────────────────────────
      {
        const fAnimT = Date.now() / 1000.0;
        const FLAME_PTS = 10; // control points per tendril

        sceneObjectsRef.current.forEach(fObj => {
          if (fObj.type !== 'Flame') return;
          const fGroup = sceneObjectMeshesRef.current.get(fObj.id) as THREE.Group | undefined;
          if (!fGroup) return;

          // Flush sprites from the previous tick
          while (fGroup.children.length > 0) {
            const child = fGroup.children[0] as any;
            child.geometry?.dispose();
            (child.material as THREE.Material)?.dispose();
            fGroup.remove(child);
          }
          fGroup.position.set(0, 0, 0);

          const fp = (fObj.properties ?? {}) as any;
          const flameHeight   = fp.height            ?? 80;
          const flameWidth    = fp.width             ?? 30;
          const numTendrils   = fp.numTendrils       ?? 5;
          const turbulence    = fp.turbulence        ?? 0.55;
          const speed         = fp.speed             ?? 1.4;
          const coreW         = fp.coreWidth         ?? 6;
          const glowW         = fp.glowWidth         ?? 16;
          const densityF      = fp.density           ?? 1.6;
          const coreHexF      = fp.coreColor         ?? '#ffff88';
          const glowHexF      = fp.glowColor         ?? '#ff3300';
          const occludeF         = fp.occludeByGeometry !== false;
          const usePhysicsF    = fp.usePhysicsModifiers ?? false;
          const modStrengthF   = fp.modifierStrength  ?? 1.0;
          const flickerIntensF = Math.max(0, Math.min(1, fp.flickerIntensity ?? 0.45));
          const flickerTypeF   = (fp.flickerType ?? 'fractal') as 'smooth' | 'fractal' | 'turbulent';

          const hexStrToNum = (s: string) => parseInt(s.replace('#', ''), 16);
          const coreNum = hexStrToNum(coreHexF);
          const glowNum = hexStrToNum(glowHexF);
          // glow texture: full gradient (white centre → coreHex → glowHex → transparent)
          const gTexF = buildLightningGlowTex(glowNum, coreNum);
          // core texture: same gradient but coreHex used as the outer colour for max brightness
          const cTexF = buildLightningGlowTex(coreNum, 0xffffff);

          const fBase = { x: fObj.position.x, y: fObj.position.y, z: fObj.position.z };

          // Sprite chain helper (mirrors addGlowChain but for Flame group)
          const addFlameChain = (
            pts:      { x: number; y: number; z?: number }[],
            tex:      THREE.Texture,
            sprSz:    number,
            opacity:  number,
            zOff:     number,
            noiseSeed: number,  // per-tendril seed so each tendril flickers independently
          ) => {
            const spacing = Math.max(0.2, (sprSz * 0.35) / densityF);
            const samples = samplePolylineEvenly(pts, spacing);
            const N = samples.length;
            const baseOpacity = opacity / Math.sqrt(densityF);
            samples.forEach((pt, i) => {
              const t = N > 1 ? i / (N - 1) : 0;
              const taperStart = 0.5;
              const taper = t <= taperStart
                ? 1.0
                : Math.sqrt(Math.max(0, 1.0 - (t - taperStart) / (1.0 - taperStart + 1e-9))) * 0.96 + 0.04;
              // Per-sprite opacity flicker — controllable type + intensity
              // phase: spatial (t*k) travels upward, time term subtracted → upward wave
              const phase = noiseSeed + t * 5.1 - fAnimT * speed * 2.3;
              let noise01: number;
              if (flickerTypeF === 'smooth') {
                // Two gentle sine waves → soft pulsing
                noise01 = 0.5 + 0.5 * (
                  0.65 * Math.sin(phase) +
                  0.35 * Math.cos(phase * 1.61 + noiseSeed * 1.4 + t * 3.2)
                );
              } else if (flickerTypeF === 'turbulent') {
                // abs(sin) FBM → sharp spiky bursts like combustion
                let v = 0, a = 1.0, fr = 1.0, nm = 0;
                for (let oct = 0; oct < 4; oct++) {
                  v += a * Math.abs(Math.sin(phase * fr + oct * 1.3));
                  nm += a; fr *= 2.07; a *= 0.5;
                }
                noise01 = v / nm;
              } else {
                // fractal FBM: smooth octave stacking → natural flame complexity
                let v = 0, a = 1.0, fr = 1.0, nm = 0;
                for (let oct = 0; oct < 4; oct++) {
                  v += a * (0.5 + 0.5 * Math.sin(phase * fr + oct * 1.3));
                  nm += a; fr *= 2.07; a *= 0.5;
                }
                noise01 = v / nm;
              }
              // Map [0..1] noise to [1-intensity .. 1] brightness range
              const flicker = (1.0 - flickerIntensF) + flickerIntensF * noise01;

              // Size modulation from turbulence — same noise type, shifted phase
              const sizePhase = noiseSeed * 1.3 + t * 4.7 - fAnimT * speed * 1.9;
              let sizeNoise01: number;
              if (flickerTypeF === 'smooth') {
                sizeNoise01 = 0.5 + 0.5 * Math.sin(sizePhase);
              } else if (flickerTypeF === 'turbulent') {
                let sv = 0, sa = 1.0, sfr = 1.0, snm = 0;
                for (let oct = 0; oct < 3; oct++) {
                  sv += sa * Math.abs(Math.sin(sizePhase * sfr + oct * 2.1));
                  snm += sa; sfr *= 2.07; sa *= 0.5;
                }
                sizeNoise01 = sv / snm;
              } else {
                let sv = 0, sa = 1.0, sfr = 1.0, snm = 0;
                for (let oct = 0; oct < 3; oct++) {
                  sv += sa * (0.5 + 0.5 * Math.sin(sizePhase * sfr + oct * 2.1));
                  snm += sa; sfr *= 2.07; sa *= 0.5;
                }
                sizeNoise01 = sv / snm;
              }
              // turbulence controls how much the width can swell/shrink (0 = fixed, 1 = ±45%)
              const sizeScale = 1.0 + turbulence * (sizeNoise01 * 2.0 - 1.0) * 0.45;
              const mat = new THREE.SpriteMaterial({
                map:         tex,
                transparent: true,
                opacity:     Math.max(0, baseOpacity * taper * flicker),
                blending:    THREE.AdditiveBlending,
                depthTest:   occludeF,
                depthWrite:  false,
              });
              const sp = new THREE.Sprite(mat);
              sp.position.set(pt.x, pt.y, (pt.z ?? 0) + zOff);
              sp.scale.set(sprSz * taper * sizeScale, sprSz * taper * sizeScale, 1);
              fGroup.add(sp);
            });
          };

          for (let ti = 0; ti < numTendrils; ti++) {
            // ── Tendril lifecycle ──────────────────────────────────────────────
            // Each slot has its own pseudo-random lifetime derived from its seed.
            // A sawtooth over time gives a normalised age [0..1].
            // When age resets the tendril "re-ignites" at a new random base angle.
            const slotSeed    = ti * 2.399963;          // stable golden-angle seed
            const minLife     = 1.2 / Math.max(0.1, speed);
            const maxLife     = 3.8 / Math.max(0.1, speed);
            // Deterministic pseudo-random lifetime per slot (0..1 → minLife..maxLife)
            const pr1 = Math.abs(Math.sin(slotSeed * 13.7 + 0.5));
            const lifespan    = minLife + pr1 * (maxLife - minLife);
            // Offset each slot so they don't all birth at t=0
            const birthOffset = Math.abs(Math.sin(slotSeed * 7.3 + 1.1)) * lifespan;
            const age01       = ((fAnimT + birthOffset) % lifespan) / lifespan; // 0=birth 1=death

            // Fade envelope: quick fade-in, long plateau, sharp fade-out at tip
            let lifeFade: number;
            if (age01 < 0.12)        lifeFade = age01 / 0.12;           // 0→1 fade-in
            else if (age01 < 0.75)   lifeFade = 1.0;                    // plateau
            else                     lifeFade = 1.0 - (age01 - 0.75) / 0.25; // 1→0 fade-out
            lifeFade = Math.max(0, lifeFade);

            // The whole tendril drifts upward as it ages — accelerating rise
            // At birth base = fBase.y; at death it has risen ~55% of flameHeight
            const riseOffset = Math.pow(age01, 1.3) * flameHeight * 0.55;

            // Height stays close to full length; just narrows slightly at very end of life
            const activeHeight = flameHeight * (0.75 + 0.25 * lifeFade);

            // The actual noise seed varies per life cycle so each new tendril wiggles differently
            const tendrilSeed  = slotSeed + Math.floor((fAnimT + birthOffset) / lifespan) * 1.618;

            // Base spread angle shifts each new life
            const spreadAngle  = (numTendrils > 1 ? (ti / (numTendrils - 1)) : 0.5) * Math.PI * 2
                                 + Math.floor((fAnimT + birthOffset) / lifespan) * 0.97;
            const baseR        = flameWidth * 0.35 * (numTendrils > 1 ? 1 : 0);
            const baseOffX     = Math.cos(spreadAngle + slotSeed) * baseR;
            const baseOffZ     = Math.sin(spreadAngle + slotSeed) * baseR * 0.4;

            // Build polyline from base to tip
            const pts: { x: number; y: number; z: number }[] = [];
            for (let pi = 0; pi < FLAME_PTS; pi++) {
              const yNorm    = pi / (FLAME_PTS - 1);
              const y        = fBase.y + riseOffset + yNorm * activeHeight;
              // Turbulence envelope: zero at base (anchored), grows toward tip
              const widthEnv = Math.pow(yNorm, 0.65) * flameWidth * 0.5;
              // Base spread fades out as we rise so tendrils converge upward
              const baseSpread = 1.0 - yNorm;
              // yNorm*k - fAnimT*speed → upward-traveling wave (sin(ky - ωt))
              const noiseT   = tendrilSeed + yNorm * 3.0 - fAnimT * speed;
              const dx = (Math.sin(noiseT * 1.3 + tendrilSeed)       * 1.0
                        + Math.cos(noiseT * 2.1 + tendrilSeed * 1.7)  * 0.4) * turbulence * widthEnv;
              const dz = Math.cos(noiseT * 0.9  + tendrilSeed * 2.3)          * turbulence * widthEnv * 0.6;
              pts.push({ x: fBase.x + baseOffX * baseSpread + dx, y, z: fBase.z + baseOffZ * baseSpread + dz });
            }

            // Optional physics modifiers (attractor / repulsor / flow-curve)
            if (usePhysicsF && physicsForceRef.current.length > 0) {
              physicsForceRef.current.forEach(force => {
                if (!force.enabled) return;
                if (force.type === 'attractor' || force.type === 'repulsor') {
                  let targetPos = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
                  if (force.targetShapeId) {
                    const ts = sceneObjectsRef.current.find(o => o.id === force.targetShapeId);
                    if (ts) targetPos.set(ts.position.x, ts.position.y, ts.position.z);
                  }
                  const sign = force.type === 'attractor' ? 1 : -1;
                  pts.forEach((p, pi) => {
                    if (pi === 0) return;
                    const pos  = new THREE.Vector3(p.x, p.y, p.z);
                    const dir  = new THREE.Vector3().subVectors(targetPos, pos);
                    const dist = dir.length();
                    const radius = Math.max(0.1, force.radius ?? 250);
                    const falloff = Math.max(0, 1 - dist / radius);
                    if (falloff <= 0 || dist < 1e-4) return;
                    dir.normalize();
                    const mag = Math.abs(force.strength) * 0.018 * falloff * modStrengthF * (pi / (FLAME_PTS - 1));
                    p.x += dir.x * sign * mag;
                    p.y += dir.y * sign * mag;
                    p.z += dir.z * sign * mag;
                  });
                } else if (force.type === 'flow-curve' && force.curveId) {
                  const pathMesh = sceneObjectMeshesRef.current.get(force.curveId) as any;
                  if (!pathMesh?.pathCurve) return;
                  const curve = pathMesh.pathCurve as THREE.Curve<THREE.Vector3>;
                  pts.forEach((p, pi) => {
                    if (pi === 0) return;
                    const pos = new THREE.Vector3(p.x, p.y, p.z);
                    let closestT = 0, minDSq = Infinity;
                    for (let si = 0; si <= 16; si++) {
                      const t = si / 16;
                      const d = curve.getPointAt(t).distanceToSquared(pos);
                      if (d < minDSq) { minDSq = d; closestT = t; }
                    }
                    const nearest = curve.getPointAt(closestT);
                    const toCurve = new THREE.Vector3().subVectors(nearest, pos);
                    const dist = toCurve.length();
                    if (dist < 1e-4) return;
                    const strength = Math.abs(force.strength) * 0.008 * modStrengthF * (pi / (FLAME_PTS - 1));
                    const pull = Math.min(1, strength / (dist + 0.01));
                    p.x += toCurve.x * pull;
                    p.y += toCurve.y * pull;
                    p.z += toCurve.z * pull;
                  });
                }
              });
            }

            // Three sprite layers: outer halo, glow, bright core — all scaled by lifeFade
            const haloD = glowW * 4.0;
            const glowD = glowW * 2.0;
            const coreD = coreW * 2.2;
            addFlameChain(pts, gTexF, haloD, 0.09 * lifeFade, -0.1, tendrilSeed);
            addFlameChain(pts, gTexF, glowD, 0.28 * lifeFade,  0.0, tendrilSeed + 1.1);
            addFlameChain(pts, cTexF, coreD, 0.60 * lifeFade,  0.1, tendrilSeed + 2.2);
          }
        });
      }
      // ── End flame live preview ────────────────────────────────────────────────────────────────

      // Update particle stats every few frames
      if (Math.random() < 0.1) {
        let totalParticles = 0;
        let numEmitters = 0;
        particleSystemsRef.current.forEach((system) => {
          totalParticles += system.particles.length;
          numEmitters++;
        });
        statsDisplay.innerText = `Particles: ${totalParticles}
Emitters: ${numEmitters}`;
      }

      // ── Spine layer Z spread + renderOrder (zero matrix traversal) ──
      // All spine bone positions have z=0, so world Z of each plane = 1 + slotIndex * spread.
      // renderOrder is flipped when the camera is behind the rig (camera.z < 1).
      const _spineMap = spineAttachmentMeshesRef.current;
      const spread = spineLayerSpreadRef.current;
      const camBehind = activeCamera.position.z < 1;
      if (_spineMap.size > 0) {
        _spineMap.forEach((mesh) => {
          const si: number = mesh.userData.slotIndex ?? 0;
          mesh.position.z = 1 + si * spread;
          mesh.renderOrder = camBehind ? -si : si;
        });
      }

      // ── Particle renderOrder: slot into spine layer Z space ──────────
      // When spread > 0, each particle's world Z maps to a fractional spine slot.
      // This allows particles to appear between — or in front of / behind — individual
      // spine layers rather than all landing behind or all on top.
      if (spread > 0.0001) {
        const invSpread = 1 / spread;
        particleSystemsRef.current.forEach((system) => {
          system.particles.forEach((p) => {
            const slot = (p.mesh.position.z - 1) * invSpread;
            p.mesh.renderOrder = camBehind ? -slot : slot;
          });
        });
      }

      if (quadViewportRef.current && quadCamerasRef.current) {
        // ── Quad viewport (Maya-style) ───────────────────────────────
        const rW = renderer.domElement.clientWidth;
        const rH = renderer.domElement.clientHeight;
        const qW = Math.floor(rW / 2);
        const qH = Math.floor(rH / 2);
        const { front, top, side } = quadCamerasRef.current;
        // Top-left: overhead (top) view
        renderer.setScissor(0, rH - qH, qW, qH);
        renderer.setViewport(0, rH - qH, qW, qH);
        renderer.render(scene, top);
        // Top-right: front view
        renderer.setScissor(rW - qW, rH - qH, qW, qH);
        renderer.setViewport(rW - qW, rH - qH, qW, qH);
        renderer.render(scene, front);
        // Bottom-left: side view
        renderer.setScissor(0, 0, qW, qH);
        renderer.setViewport(0, 0, qW, qH);
        renderer.render(scene, side);
        // Bottom-right: perspective
        renderer.setScissor(rW - qW, 0, qW, qH);
        renderer.setViewport(rW - qW, 0, qW, qH);
        renderer.render(scene, activeCamera);
        // Restore full viewport
        renderer.setScissor(0, 0, rW, rH);
        renderer.setViewport(0, 0, rW, rH);
      } else {
        const rW = renderer.domElement.clientWidth;
        const rH = renderer.domElement.clientHeight;
        renderer.setScissor(0, 0, rW, rH);
        renderer.setViewport(0, 0, rW, rH);
        renderer.render(scene, activeCamera);
      }
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;
      
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
      }
      
      // Update quad ortho cameras aspect
      if (quadCamerasRef.current) {
        const newAspect = newWidth / newHeight;
        const se = sceneExtentRef.current;
        const ext = se * 0.75;
        const updateOrtho = (cam: THREE.OrthographicCamera) => {
          cam.left = -ext * newAspect;
          cam.right = ext * newAspect;
          cam.top = ext;
          cam.bottom = -ext;
          cam.updateProjectionMatrix();
        };
        updateOrtho(quadCamerasRef.current.front);
        updateOrtho(quadCamerasRef.current.top);
        updateOrtho(quadCamerasRef.current.side);
      }

      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousedown', onMouseDown);
        containerRef.current.removeEventListener('wheel', onWheel);
      }
      document.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      gridHelpersRef.current = [];
      if (containerRef.current) {
        if (renderer.domElement.parentNode === containerRef.current) {
          containerRef.current.removeChild(renderer.domElement);
        }
        if (stats.dom.parentNode === containerRef.current) {
          containerRef.current.removeChild(stats.dom);
        }
        if (statsDisplay.parentNode === containerRef.current) {
          containerRef.current.removeChild(statsDisplay);
        }
      }
    };
  }, [sceneSize.x, sceneSize.y, sceneSize.z]);

  useEffect(() => {
    if (!sceneRef.current) return;
    if (sceneSettings.referenceImage) {
      sceneRef.current.background = null;
    } else {
      sceneRef.current.background = new THREE.Color(sceneSettings.backgroundColor);
    }
  }, [sceneSettings.backgroundColor, sceneSettings.referenceImage]);

  useEffect(() => {
    const opacity = Math.max(0, Math.min(1, Number(sceneSettings.gridOpacity ?? 0.2)));
    gridHelpersRef.current.forEach((grid) => {
      grid.visible = sceneSettings.showGrid ?? true;
      const material = grid.material;
      if (Array.isArray(material)) {
        material.forEach((m) => {
          m.opacity = opacity;
          m.transparent = true;
        });
      } else if (material instanceof THREE.Material) {
        material.opacity = opacity;
        material.transparent = true;
      }
    });
  }, [sceneSettings.gridOpacity, sceneSettings.showGrid]);

  
  useEffect(() => {
    const showObjects = sceneSettings.showObjects ?? true;
    const showBones = sceneSettings.showBones ?? true;
    sceneObjectMeshesRef.current.forEach((mesh, objectId) => {
      const obj = sceneObjects.find((o) => o.id === objectId);
      if (!obj) return;
      if (obj.type === 'Bone') {
        // Keep the bone parent visible so spine attachment planes can remain visible
        // even when bone visuals are filtered out.
        mesh.visible = showObjects;
        mesh.children.forEach((child) => {
          const isSpineAttachment = child.name?.startsWith('spine-att-') ?? false;
          if (!isSpineAttachment) {
            child.visible = showBones;
          }
        });
      } else {
        mesh.visible = showObjects;
      }
    });
  }, [sceneSettings.showObjects, sceneSettings.showBones, sceneObjects]);

  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.particles.forEach(p => {
        if (p.mesh) p.mesh.visible = sceneSettings.showParticles ?? true;
      });
    });
  }, [sceneSettings.showParticles]);

  // Handle view mode changes
  useEffect(() => {
    if (!perspectiveCameraRef.current || !sceneRef.current) return;

    const sceneSizeX = Math.max(100, sceneSize.x || 0);
    const sceneSizeY = Math.max(100, sceneSize.y || 0);
    const sceneSizeZ = Math.max(100, sceneSize.z || 0);
    const sceneExtent = Math.max(sceneSizeX, sceneSizeY, sceneSizeZ);

    // Always use perspective camera, just change the viewing angle
    isOrthoRef.current = false;
    currentCameraRef.current = perspectiveCameraRef.current;

    const cameraState = cameraStateRef.current;
    
    if (viewMode === 'perspective') {
      // Default perspective view
      cameraState.targetTheta = DEFAULT_THETA;
      cameraState.targetPhi = DEFAULT_PHI;
      cameraState.radius = sceneExtent * 0.6;
      cameraState.isAnimating = true;
    } else if (viewMode === 'x') {
      // View along X axis (from +X looking at origin)
      cameraState.targetTheta = 0;
      cameraState.targetPhi = Math.PI / 2;
      cameraState.radius = sceneExtent * 0.6;
      cameraState.isAnimating = true;
    } else if (viewMode === 'y') {
      // View along Y axis (from +Y looking down)
      cameraState.targetTheta = 0;
      cameraState.targetPhi = 0.01;
      cameraState.radius = sceneExtent * 0.6;
      cameraState.isAnimating = true;
    } else if (viewMode === 'z') {
      // View along Z axis (from +Z looking at origin)
      cameraState.targetTheta = Math.PI / 2;
      cameraState.targetPhi = Math.PI / 2;
      cameraState.radius = sceneExtent * 0.6;
      cameraState.isAnimating = true;
    }
  }, [viewMode, sceneSize]);

  // Sync quadViewport prop into ref (read by render loop without causing re-renders)
  useEffect(() => {
    quadViewportRef.current = quadViewport;
    // Clear focused panel when leaving quad mode
    if (!quadViewport) {
      focusedQuadPanelRef.current = null;
      setFocusedQuadPanel(null);
    }
  }, [quadViewport]);

  // Clear particles when stopped (frame reset to 0)
  useEffect(() => {
    if (!sceneRef.current || currentFrame !== 0 || isPlaying) return;
    
    const scene = sceneRef.current;
    
    // Clear all particles from all emitters
    particleSystemsRef.current.forEach((particleSystem) => {
      particleSystem.particles.forEach(p => scene.remove(p.mesh));
      particleSystem.particles = [];
      particleSystem.lastEmit = Date.now();
    });
    particleFrameCacheRef.current.clear();
    cacheCountRef.current = 0;
    onCacheFrameCountChange?.(0);
    lastTimelineFrameRef.current = 0;
  }, [currentFrame, isPlaying, onCacheFrameCountChange]);

  // Explicit cache reset trigger (used by fast rewind)
  useEffect(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    particleSystemsRef.current.forEach((particleSystem) => {
      particleSystem.particles.forEach((particle) => scene.remove(particle.mesh));
      particleSystem.particles = [];
      particleSystem.lastEmit = Date.now();
    });
    particleFrameCacheRef.current.clear();
    cacheCountRef.current = 0;
    onCacheFrameCountChange?.(0);
    lastTimelineFrameRef.current = Math.max(0, Math.floor(currentFrameRef.current));
  }, [cacheResetToken, onCacheFrameCountChange]);

  // Handle scene objects (emitters, shapes, etc.)
  useEffect(() => {
    if (!sceneRef.current) return;
    
    const scene = sceneRef.current;
    const currentIds = new Set(sceneObjects.map(obj => obj.id));
    
    // Remove deleted objects
    sceneObjectMeshesRef.current.forEach((mesh, id) => {
      if (!currentIds.has(id)) {
        scene.remove(mesh);
        sceneObjectMeshesRef.current.delete(id);
        
        // Clean up particle system if it's an emitter
        const particleSystem = particleSystemsRef.current.get(id);
        if (particleSystem) {
          particleSystem.particles.forEach(p => scene.remove(p.mesh));
          particleSystemsRef.current.delete(id);
        }
      }
    });
    
    // Add new objects and update existing ones
    sceneObjects.forEach(obj => {
      if (!sceneObjectMeshesRef.current.has(obj.id)) {
        let mesh: THREE.Object3D | null = null;

        if (obj.type === 'Path') {
          mesh = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 }));
          (mesh as any).isPathRender = true;
          scene.add(mesh);
        } else if (obj.type === 'PathPoint') {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.8 }));
          (mesh as any).isPathPointRender = true;
          scene.add(mesh);
        } else if (obj.type === 'EmitterShape') {
          // EmitterShape is a data-only child node — no 3D visual representation needed
          mesh = null;
        } else if (obj.type === 'Emitter') {
          // Render Emitter as a 3D crosshair only
          const crosshairGroup = new THREE.Group();
          const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 });
          const size = 18;
          const crossGeometry = new THREE.BufferGeometry();
          crossGeometry.setAttribute('position', new THREE.BufferAttribute(
            new Float32Array([
              -size, 0, 0, size, 0, 0,
              0, -size, 0, 0, size, 0,
              0, 0, -size, 0, 0, size,
            ]),
            3
          ));
          crosshairGroup.add(new THREE.LineSegments(crossGeometry, lineMaterial));
          mesh = crosshairGroup;
          // Ensure a particle system exists for this emitter
          if (!particleSystemsRef.current.has(obj.id)) {
            particleSystemsRef.current.set(obj.id, { particles: [], lastEmit: Date.now() });
          }
        } else if (obj.type === 'Lightning') {
          // Bolt geometry is rebuilt every rAF in the animate loop
          mesh = new THREE.Group();
          (mesh as any).isLightningRender = true;
        } else if (obj.type === 'LightningPoint') {
          // Crosshair gizmo — teal for start, magenta for end
          const isStart = (obj.properties as any)?.role === 'start';
          const color = isStart ? 0x00ffcc : 0xff00cc;
          const xhGroup = new THREE.Group();
          const size = 14;
          const crossGeo = new THREE.BufferGeometry();
          crossGeo.setAttribute('position', new THREE.BufferAttribute(
            new Float32Array([
              -size, 0, 0,  size, 0, 0,
              0, -size, 0,  0, size, 0,
              0, 0, -size,  0, 0,  size,
            ]), 3,
          ));
          xhGroup.add(new THREE.LineSegments(
            crossGeo,
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }),
          ));
          mesh = xhGroup;
        } else if (obj.type === 'Flame') {
          const flameGroup = new THREE.Group();
          (flameGroup as any).isFlameRender = true;
          mesh = flameGroup;
        } else if (obj.type === 'ImportedModel') {
          const modelGroup = new THREE.Group();
          (modelGroup as any).isImportedModel = true;
          mesh = modelGroup;

          const props = (obj.properties ?? {}) as any;
          const dataUrl = String(props.importedModelDataUrl ?? '');
          const fmt = String(props.importedModelFormat ?? '').toLowerCase();

          if (dataUrl && fmt) {
            const applyLoadedModel = (root: THREE.Object3D) => {
              const currentMesh = sceneObjectMeshesRef.current.get(obj.id);
              if (currentMesh !== modelGroup) return;

              root.traverse((child: any) => {
                if (child?.isMesh) {
                  child.castShadow = false;
                  child.receiveShadow = false;
                }
              });

              const box = new THREE.Box3().setFromObject(root);
              const size = box.getSize(new THREE.Vector3());
              const center = box.getCenter(new THREE.Vector3());
              const maxDim = Math.max(1e-5, size.x, size.y, size.z);
              const targetSize = 60;
              const s = targetSize / maxDim;
              root.position.sub(center);
              root.scale.multiplyScalar(s);

              modelGroup.add(root);
            };

            const failImport = (err: unknown) => {
              console.error(`Failed to import model ${props.sourceFileName ?? obj.id}:`, err);
            };

            if (fmt === 'obj') {
              fetch(dataUrl)
                .then((r) => r.text())
                .then((text) => {
                  const loader = new OBJLoader();
                  applyLoadedModel(loader.parse(text));
                })
                .catch(failImport);
            } else if (fmt === 'fbx') {
              fetch(dataUrl)
                .then((r) => r.arrayBuffer())
                .then((ab) => {
                  const loader = new FBXLoader();
                  applyLoadedModel(loader.parse(ab, ''));
                })
                .catch(failImport);
            } else if (fmt === 'gltf' || fmt === 'glb') {
              fetch(dataUrl)
                .then((r) => r.arrayBuffer())
                .then((ab) => {
                  const loader = new GLTFLoader();
                  loader.parse(
                    ab,
                    '',
                    (gltf) => applyLoadedModel(gltf.scene),
                    (err) => failImport(err),
                  );
                })
                .catch(failImport);
            }
          }
        } else if (obj.type === 'Bone') {
          // Render bone as a small yellow diamond (octahedron) with thin bone-spine line toward parent
          const boneGroup = new THREE.Group();
          const diamondGeo = new THREE.OctahedronGeometry(7, 0);
          const diamondMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, depthTest: false });
          boneGroup.add(new THREE.Mesh(diamondGeo, diamondMat));
          // Wireframe overlay for crisp edge visibility
          const wireframeMat = new THREE.LineBasicMaterial({ color: 0xffd700, transparent: true, opacity: 1, depthTest: false });
          boneGroup.add(new THREE.LineSegments(new THREE.WireframeGeometry(diamondGeo), wireframeMat));
          mesh = boneGroup;
        } else {
          mesh = createStandardObjectMesh(obj.type);
        }

        if (mesh) {
          mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
          mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          mesh.scale.set(obj.scale.x, obj.scale.y, obj.scale.z);
          scene.add(mesh);
          sceneObjectMeshesRef.current.set(obj.id, mesh);
        }
      } else {
        // Check if emitter type changed, if so rebuild the mesh
        const mesh = sceneObjectMeshesRef.current.get(obj.id);
        if (obj.type === 'Emitter' && mesh) {
          // Remove all legacy emitterType visualizations. Only render crosshair for emitters.
          scene.remove(mesh);
          sceneObjectMeshesRef.current.delete(obj.id);
          // Add crosshair only
          const crosshairGroup = new THREE.Group();
          const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 });
          const size = 18;
          const crossGeometry = new THREE.BufferGeometry();
          crossGeometry.setAttribute('position', new THREE.BufferAttribute(
            new Float32Array([
              -size, 0, 0, size, 0, 0,
              0, -size, 0, 0, size, 0,
              0, 0, -size, 0, 0, size,
            ]),
            3
          ));
          crosshairGroup.add(new THREE.LineSegments(crossGeometry, lineMaterial));
          crosshairGroup.position.set(obj.position.x, obj.position.y, obj.position.z);
          crosshairGroup.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          crosshairGroup.scale.set(obj.scale.x, obj.scale.y, obj.scale.z);
          scene.add(crosshairGroup);
          sceneObjectMeshesRef.current.set(obj.id, crosshairGroup);
          return;
        }
        
      
      // Update Path visuals
      if (obj.type === 'Path' && mesh && (mesh as any).isPathRender) {
         const points = sceneObjects.filter(o => o.type === 'PathPoint' && o.parentId === obj.id);
         if (points.length >= 2) {
             const curvePoints = points.map(p => {
                 const pMesh = sceneObjectMeshesRef.current.get(p.id);
                 return pMesh ? pMesh.position.clone() : new THREE.Vector3(p.position.x, p.position.y, p.position.z);
             });
             const curve = new THREE.CatmullRomCurve3(curvePoints, (obj.properties as any)?.closed || false, 'catmullrom', (obj.properties as any)?.tension ?? 0.5);
             const segments = Math.max((points.length - 1) * 20, 50);
             const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(segments));
             (mesh as THREE.Line).geometry.dispose();
             (mesh as THREE.Line).geometry = geometry;
             (mesh as any).pathCurve = curve;
             
             // Move the mesh itself to origin so its vertices match world coords
             mesh.position.set(0,0,0);
             mesh.rotation.set(0,0,0);
             mesh.scale.set(1,1,1);
             return;
         }
      }
        // Update existing object transforms (but not while dragging with transform controls,
        // and not while the rigid-body physics loop is actively driving the object's position)
        const isPhysicsDriven = rigidBodyStateRef.current.has(obj.id);
        if (mesh && !isPhysicsDriven && (!transformControlsRef.current || transformControlsRef.current.object !== mesh || !(transformControlsRef.current as any).dragging)) {
          mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
          mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          mesh.scale.set(obj.scale.x, obj.scale.y, obj.scale.z);
        }
      }
    });
  }, [sceneObjects]);

  // ── Spine attachment planes: textured quads parented to bone meshes ──
  useEffect(() => {
    // Remove old attachment meshes
    spineAttachmentMeshesRef.current.forEach((mesh) => {
      if (mesh.parent) mesh.parent.remove(mesh);
      (mesh.geometry as THREE.BufferGeometry).dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
      // Dispose preloaded sequence textures
      if (mesh.userData.seqTextures) {
        for (const t of mesh.userData.seqTextures) { if (t) t.dispose(); }
        mesh.userData.seqTextures = undefined;
      }
    });
    spineAttachmentMeshesRef.current.clear();

    for (const att of spineAttachments) {
      const boneMesh = sceneObjectMeshesRef.current.get(att.boneObjectId);
      if (!boneMesh) continue;
      const geo = new THREE.PlaneGeometry(att.width * att.scaleX, att.height * att.scaleY);

      // Parse slot color tint (RGBA hex 'rrggbbaa')
      let tintColor = 0xffffff;
      let tintOpacity = 1.0;
      if (att.color && att.color.length >= 8) {
        tintColor = parseInt(att.color.substring(0, 6), 16);
        tintOpacity = parseInt(att.color.substring(6, 8), 16) / 255;
      }

      // Blend mode
      let blending: THREE.Blending = THREE.NormalBlending;
      if (att.blendMode === 'additive') blending = THREE.AdditiveBlending;
      else if (att.blendMode === 'multiply') blending = THREE.MultiplyBlending;
      else if (att.blendMode === 'screen') {
        blending = THREE.CustomBlending;
      }

      let texture: THREE.Texture | null = null;
      if (att.imageDataUrl) {
        texture = new THREE.TextureLoader().load(att.imageDataUrl);
        texture.colorSpace = THREE.SRGBColorSpace;
      }
      const mat = new THREE.MeshBasicMaterial({
        map: texture ?? undefined,
        color: texture ? tintColor : 0x7799bb,
        transparent: true,
        opacity: texture ? tintOpacity : 0.45,
        side: THREE.DoubleSide,
        blending,
        depthTest: false,
        depthWrite: false,
      });
      // Store base opacity so per-frame alpha can blend with it
      mat.userData = { baseOpacity: texture ? tintOpacity : 0.45 };
      // Screen blending: ONE / ONE_MINUS_SRC_COLOR
      if (att.blendMode === 'screen') {
        mat.blendEquation = THREE.AddEquation;
        mat.blendSrc = THREE.OneFactor;
        mat.blendDst = THREE.OneMinusSrcColorFactor;
      }
      const planeMesh = new THREE.Mesh(geo, mat);
      planeMesh.userData.localX = att.localX;
      planeMesh.userData.localY = att.localY;
      planeMesh.userData.slotIndex = att.slotIndex;
      planeMesh.position.set(att.localX, att.localY, 1);
      planeMesh.rotation.z = (att.localRotationDeg * Math.PI) / 180;
      planeMesh.renderOrder = att.slotIndex;
      planeMesh.name = `spine-att-${att.id}`;
      // Preload sequence textures so per-frame swaps don’t stall
      if (att.sequenceFrames && att.sequenceFrames.length > 0) {
        planeMesh.userData.seqTextures = att.sequenceFrames.map((url) => {
          if (!url) return null;
          const t = new THREE.TextureLoader().load(url);
          t.colorSpace = THREE.SRGBColorSpace;
          return t;
        });
      }
      boneMesh.add(planeMesh);
      spineAttachmentMeshesRef.current.set(att.id, planeMesh);
    }
  }, [spineAttachments]);

  // Pre-cache each attachment's alpha mask and sampled visible/edge pixels
  useEffect(() => {
    spineAttachPixelDataRef.current.clear();
    for (const att of spineAttachments) {
      if (!att.imageDataUrl) continue;
      const attId = att.id;
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          spineAttachPixelDataRef.current.set(attId, buildSpineAttachmentMaskData(data, canvas.width, canvas.height));
        } catch (_e) { /* cross-origin or decode error — leave entry absent */ }
      };
      img.src = att.imageDataUrl;
    }
  }, [spineAttachments]);

  // Sync spineLayerSpread into ref so the render loop can access it without stale closure
  useEffect(() => { spineLayerSpreadRef.current = spineLayerSpread; }, [spineLayerSpread]);

  // ── Fast per-frame: toggle visibility + swap sequence textures + apply animated alpha/tint ──
  useEffect(() => {
    const showSpineImages = sceneSettings.showSpineImages ?? true;
    spineAttachmentMeshesRef.current.forEach((mesh, id) => {
      if (!showSpineImages) {
        mesh.visible = false;
        return;
      }

      if (!spineFrameOverrides) {
        mesh.visible = true;
        return;
      }

      const ov = spineFrameOverrides[id];
      if (!ov) { mesh.visible = false; return; }
      mesh.visible = ov.visible;
      if (!ov.visible) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      // Animated alpha: multiply with base setup-pose opacity
      if (ov.alpha !== undefined) {
        const base: number = mat.userData?.baseOpacity ?? 1.0;
        mat.opacity = base * ov.alpha;
        mat.needsUpdate = true;
      }
      // Animated tint color
      if (ov.tintR !== undefined && ov.tintG !== undefined && ov.tintB !== undefined) {
        mat.color.setRGB(ov.tintR, ov.tintG, ov.tintB);
        mat.needsUpdate = true;
      }
      // Sequence texture swap
      if (ov.seqFrame !== undefined && mesh.userData.seqTextures) {
        const tex = mesh.userData.seqTextures[ov.seqFrame];
        if (tex && mat.map !== tex) {
          mat.map = tex;
          mat.needsUpdate = true;
        }
      }
    });
  }, [spineFrameOverrides, sceneSettings.showSpineImages]);

  // Update object materials based on selection
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const selectedIds = new Set<string>(getViewportSelectedIds());

    sceneObjectMeshesRef.current.forEach((mesh, objectId) => {
      const obj = sceneObjects.find(o => o.id === objectId);
      if (!obj) return;
      
      if (obj.type === 'Emitter') {
        // Emitter is a Group containing another Group with Line objects
        const emitterGroup = mesh.children[0] as THREE.Group;
        if (!emitterGroup) return;
        
        if (selectedIds.has(objectId)) {
          // Highlight selected emitter with brighter color
          emitterGroup.children.forEach(child => {
            if (child instanceof THREE.Line) {
              const material = child.material as THREE.LineBasicMaterial;
              material.color.setHex(0xffcc33);
              material.opacity = 1.0;
            }
          });
        } else {
          // Normal emitter appearance
          emitterGroup.children.forEach(child => {
            if (child instanceof THREE.Line) {
              const material = child.material as THREE.LineBasicMaterial;
              material.color.setHex(0xff6600);
              material.opacity = 0.8;
            }
          });
        }
      }
    });

    rebuildSelectionOutlines();

    return () => {
      clearSelectionOutlines();
    };
  }, [selectedObjectId, selectedObjectIds, sceneObjects]);

  // Handle physics force gizmos
  useEffect(() => {
    if (!sceneRef.current) return;
    
    const scene = sceneRef.current;
    const currentForceIds = new Set(physicsForces.map(f => f.id));
    
    // Remove deleted force gizmos
    physicsForceGizmosRef.current.forEach((gizmo, id) => {
      if (!currentForceIds.has(id)) {
        scene.remove(gizmo);
        physicsForceGizmosRef.current.delete(id);
      }
    });
    
    // Add or update force gizmos
    physicsForces.forEach(force => {
      const forcePos = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
      
      // Determine direction based on force type
      let direction = new THREE.Vector3(0, -1, 0); // Default downward
      let length = 100;
      let color = 0xff6600; // Default orange
      
      switch (force.type) {
        case 'gravity':
          direction.set(0, -1, 0);
          color = 0x0099ff; // Blue for gravity (down)
          break;
        case 'wind':
          if (force.direction) {
            direction.set(force.direction.x, force.direction.y, force.direction.z);
          }
          color = 0x00ff99; // Cyan for wind
          break;
        case 'tornado':
          if (force.direction) {
            direction.set(force.direction.x, force.direction.y, force.direction.z);
          }
          color = 0xff9900; // Orange for tornado
          break;
        case 'vortex':
          if (force.direction) {
            direction.set(force.direction.x, force.direction.y, force.direction.z);
          }
          color = 0xff00ff; // Magenta for vortex
          break;
        case 'attractor':
          // Attractor pulls inward - show as sphere indicator instead of arrow
          color = 0xff0000; // Red for attractor
          break;
        case 'repulsor':
          // Repulsor pushes outward - show as sphere indicator instead of arrow
          color = 0x00ff00; // Green for repulsor
          break;
        case 'collider':
          // Collider bounces particles
          color = 0xffaa00; // Orange for collider
          break;
        case 'flow-curve':
          if (force.direction) {
            direction.set(force.direction.x, force.direction.y, force.direction.z);
          }
          color = 0xffff00; // Yellow for curve flow
          break;
        case 'drag':
          // Drag is multi-directional, use neutral indicator
          direction.set(0, 0, 1);
          color = 0x9900ff; // Purple for drag
          break;
        case 'damping':
          // Damping is multi-directional, use neutral indicator
          direction.set(0, 0, 1);
          color = 0x999999; // Gray for damping
          break;
        case 'turbulence':
          // Turbulence is chaotic, use neutral indicator
          direction.set(1, 0, 0);
          color = 0x8800ff; // Purple for turbulence
          break;
        case 'thermal-updraft':
          direction.set(0, 1, 0); // Always up
          color = 0xff3300; // Deep Orange for heat
          break;
      }
      
      // Normalize direction and apply strength scaling
      if (direction.lengthSq() > 0) {
        direction.normalize();
        length = 80 + Math.min(force.strength * 2, 150); // Scale by strength
      }
      
      // Remove existing gizmo
      if (physicsForceGizmosRef.current.has(force.id)) {
        const oldGizmo = physicsForceGizmosRef.current.get(force.id);
        if (oldGizmo) {
          scene.remove(oldGizmo);
        }
      }
      
      // Create appropriate gizmo based on force type
      let gizmo: THREE.Object3D;
      let gizmoPosition = forcePos.clone();
      
      // For attractor/repulsor/collider with target shape, position gizmo at the shape
      if ((force.type === 'attractor' || force.type === 'repulsor' || force.type === 'collider') && force.targetShapeId) {
        const targetShape = sceneObjectsRef.current.find(obj => obj.id === force.targetShapeId);
        if (targetShape) {
          gizmoPosition.set(targetShape.position.x, targetShape.position.y, targetShape.position.z);
        }
      }
      
      if (force.type === 'attractor' || force.type === 'repulsor' || force.type === 'collider') {
        // Create text label for attractor/repulsor/collider
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Determine background color based on force type
          let bgColor = 'rgba(255, 0, 0, 0.4)'; // Default red for attractor
          if (force.type === 'repulsor') {
            bgColor = 'rgba(0, 255, 0, 0.4)'; // Green for repulsor
          } else if (force.type === 'collider') {
            bgColor = 'rgba(255, 170, 0, 0.4)'; // Orange for collider
          }
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Draw text
          ctx.fillStyle = 'white';
          ctx.font = 'bold 120px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          let label = 'AT'; // attractor
          if (force.type === 'repulsor') label = 'RP';
          else if (force.type === 'collider') label = 'CO';
          ctx.fillText(label, canvas.width / 2, canvas.height / 2);
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: true });
        gizmo = new THREE.Sprite(spriteMat);
        gizmo.scale.set(30, 30, 1);
        gizmo.position.copy(gizmoPosition);
      } else if (force.type === 'tornado' || force.type === 'vortex') {
        // Create curved arrow gizmo to show rotation
        const group = new THREE.Group();
        const axis = new THREE.Vector3(force.direction?.x ?? 0, force.direction?.y ?? 1, force.direction?.z ?? 0).normalize();
        
        // Create torus to show the circular motion plane
        const torusGeo = new THREE.TorusGeometry(60, 8, 8, 32);
        const torusMat = new THREE.MeshBasicMaterial({ 
          color, 
          transparent: true, 
          opacity: 0.15,
          wireframe: false
        });
        const torus = new THREE.Mesh(torusGeo, torusMat);
        group.add(torus);
        
        // Add curved arrow indicators (multiple arrows around the torus)
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2;
          const arrowPos = new THREE.Vector3(
            Math.cos(angle) * 60,
            0,
            Math.sin(angle) * 60
          );
          
          // Perpendicular direction to show rotation
          const nextAngle = angle + Math.PI * 0.3;
          const nextPos = new THREE.Vector3(
            Math.cos(nextAngle) * 60,
            0,
            Math.sin(nextAngle) * 60
          );
          const arrowDir = new THREE.Vector3().subVectors(nextPos, arrowPos).normalize();
          
          const arrow = new THREE.ArrowHelper(arrowDir, arrowPos, 20, color, 8, 6);
          group.add(arrow);
        }
        
        // Rotate group based on axis direction
        const up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(axis.dot(up)) < 0.9) {
          const rotAxis = new THREE.Vector3().crossVectors(up, axis).normalize();
          const angle = Math.acos(axis.dot(up));
          group.quaternion.setFromAxisAngle(rotAxis, angle);
        }
        
        group.position.copy(forcePos);
        gizmo = group;
      } else if (force.type === 'flow-curve') {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'rgba(0, 150, 255, 0.4)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 16;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          
          // Draw sine waves
          for (let i = 0; i < 3; i++) {
            const y = 70 + i * 58;
            ctx.beginPath();
            for (let x = 40; x <= 216; x += 4) {
              const dx = (x - 40) / 176;
              const waveY = y + Math.sin(dx * Math.PI * 2 * 1.5) * 18;
              if (x === 40) ctx.moveTo(x, waveY);
              else ctx.lineTo(x, waveY);
            }
            ctx.stroke();
          }
        }
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: true });
        gizmo = new THREE.Sprite(spriteMat);
        gizmo.scale.set(30, 30, 1);
        gizmo.position.copy(gizmoPosition);
      } else {
        // Create arrow for directional forces
        gizmo = new THREE.ArrowHelper(direction, forcePos, length, color, 30, 20);
      }
      
      gizmo.name = `force-gizmo-${force.id}`;
      scene.add(gizmo);
      physicsForceGizmosRef.current.set(force.id, gizmo);
    });
  }, [physicsForces]);

  // Attach transform controls to selected object and create visual handles
  useEffect(() => {
    if (!transformControlsRef.current || !sceneRef.current) return;

    const transformControls = transformControlsRef.current;
    const scene = sceneRef.current;
    
    // Remove old handles
    const oldHandles = scene.getObjectByName('transform-handles');
    if (oldHandles) {
      scene.remove(oldHandles);
    }
    
    if (selectedForceId) {
      const selectedGizmo = physicsForceGizmosRef.current.get(selectedForceId);
      if (selectedGizmo) {
        transformControls.attach(selectedGizmo);
        transformControls.enabled = false;
        transformControls.setMode('translate');

        const handlesGroup = new THREE.Group();
        handlesGroup.name = 'transform-handles';
        handlesGroup.position.copy(selectedGizmo.position);
        handlesGroup.rotation.set(0, 0, 0);

        const xArrowGeom = new THREE.ConeGeometry(4 * handleScale, 16 * handleScale, 8);
        const yArrowGeom = new THREE.ConeGeometry(4 * handleScale, 16 * handleScale, 8);
        const zArrowGeom = new THREE.ConeGeometry(4 * handleScale, 16 * handleScale, 8);

        const xArrow = new THREE.Mesh(xArrowGeom, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
        const yArrow = new THREE.Mesh(yArrowGeom, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
        const zArrow = new THREE.Mesh(zArrowGeom, new THREE.MeshBasicMaterial({ color: 0x0000ff }));

        xArrow.rotation.z = -Math.PI / 2;
        xArrow.position.x = 40 * handleScale;
        yArrow.position.y = 40 * handleScale;
        zArrow.rotation.x = Math.PI / 2;
        zArrow.position.z = 40 * handleScale;

        xArrow.name = 'x-arrow';
        yArrow.name = 'y-arrow';
        zArrow.name = 'z-arrow';
        handlesGroup.add(xArrow, yArrow, zArrow);

        scene.add(handlesGroup);
        handlesRef.current = { xArrow, yArrow, zArrow };
      }
    } else if (selectedObjectId) {
      const selectedMesh = sceneObjectMeshesRef.current.get(selectedObjectId);
      if (selectedMesh) {
        transformControls.attach(selectedMesh);
        transformControls.enabled = false; // Disabled: using custom visual handles instead
        transformControls.setMode(manipulatorMode);
        
        // Create visual handles by mode (translate/rotate/scale)
        const handlesGroup = new THREE.Group();
        handlesGroup.name = 'transform-handles';
        handlesGroup.position.copy(selectedMesh.position);
        handlesGroup.rotation.copy(selectedMesh.rotation);

        let xArrow: THREE.Mesh;
        let yArrow: THREE.Mesh;
        let zArrow: THREE.Mesh;

        if (manipulatorMode === 'translate') {
          const xArrowGeom = new THREE.ConeGeometry(4 * handleScale, 16 * handleScale, 8);
          const yArrowGeom = new THREE.ConeGeometry(4 * handleScale, 16 * handleScale, 8);
          const zArrowGeom = new THREE.ConeGeometry(4 * handleScale, 16 * handleScale, 8);

          xArrow = new THREE.Mesh(xArrowGeom, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
          yArrow = new THREE.Mesh(yArrowGeom, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
          zArrow = new THREE.Mesh(zArrowGeom, new THREE.MeshBasicMaterial({ color: 0x0000ff }));

          xArrow.rotation.z = -Math.PI / 2;
          xArrow.position.x = 40 * handleScale;
          yArrow.position.y = 40 * handleScale;
          zArrow.rotation.x = Math.PI / 2;
          zArrow.position.z = 40 * handleScale;
        } else if (manipulatorMode === 'rotate') {
          const xRingGeom = new THREE.TorusGeometry(40 * handleScale, 1 * handleScale, 8, 64);
          const yRingGeom = new THREE.TorusGeometry(40 * handleScale, 1 * handleScale, 8, 64);
          const zRingGeom = new THREE.TorusGeometry(40 * handleScale, 1 * handleScale, 8, 64);

          xArrow = new THREE.Mesh(xRingGeom, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
          yArrow = new THREE.Mesh(yRingGeom, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
          zArrow = new THREE.Mesh(zRingGeom, new THREE.MeshBasicMaterial({ color: 0x0000ff }));

          xArrow.rotation.y = Math.PI / 2;
          yArrow.rotation.x = Math.PI / 2;
        } else {
          const xBoxGeom = new THREE.BoxGeometry(8 * handleScale, 8 * handleScale, 8 * handleScale);
          const yBoxGeom = new THREE.BoxGeometry(8 * handleScale, 8 * handleScale, 8 * handleScale);
          const zBoxGeom = new THREE.BoxGeometry(8 * handleScale, 8 * handleScale, 8 * handleScale);

          xArrow = new THREE.Mesh(xBoxGeom, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
          yArrow = new THREE.Mesh(yBoxGeom, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
          zArrow = new THREE.Mesh(zBoxGeom, new THREE.MeshBasicMaterial({ color: 0x0000ff }));

          xArrow.position.x = 40 * handleScale;
          yArrow.position.y = 40 * handleScale;
          zArrow.position.z = 40 * handleScale;
        }

        xArrow.name = 'x-arrow';
        yArrow.name = 'y-arrow';
        zArrow.name = 'z-arrow';
        handlesGroup.add(xArrow, yArrow, zArrow);
        
        scene.add(handlesGroup);
        handlesRef.current = { xArrow, yArrow, zArrow };
      } else {
        // Could not find mesh for selectedObjectId
      }
    } else {
      transformControls.detach();
      transformControls.enabled = false;
      handlesRef.current = null;
      dragStateRef.current.active = false;
    }
  }, [selectedObjectId, selectedForceId, manipulatorMode, handleScale]);

  // Keep visual helpers in sync when object transforms are changed from property sliders
  useEffect(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    const selectedMesh = selectedForceId
      ? physicsForceGizmosRef.current.get(selectedForceId)
      : (selectedObjectId ? sceneObjectMeshesRef.current.get(selectedObjectId) : null);
    if (!selectedMesh) return;

    const handles = scene.getObjectByName('transform-handles');
    if (handles) {
      handles.position.copy(selectedMesh.position);
      handles.rotation.copy(selectedMesh.rotation);
    }

    const outline = scene.getObjectByName('selection-outline');
    if (outline && selectedObjectId) refreshSelectionOutlines();
  }, [sceneObjects, physicsForces, selectedObjectId, selectedForceId]);

  // Setup gizmo renderer
  useEffect(() => {
    if (!containerRef.current || !rendererRef.current) return;

    const gizmoSize = 120;
    const gizmoCanvas = document.createElement('canvas');
    gizmoCanvas.width = gizmoSize;
    gizmoCanvas.height = gizmoSize;
    gizmoCanvas.className = 'gizmo-canvas';
    gizmoCanvasRef.current = gizmoCanvas;

    const gizmoScene = new THREE.Scene();
    gizmoScene.background = null;
    gizmoSceneRef.current = gizmoScene;

    const gizmoCamera = new THREE.OrthographicCamera(-60, 60, 60, -60, 0.1, 1000);
    gizmoCamera.position.set(50, 50, 50);
    gizmoCamera.lookAt(0, 0, 0);

    const gizmoRenderer = new THREE.WebGLRenderer({ canvas: gizmoCanvas, antialias: true, alpha: true });
    gizmoRenderer.setSize(gizmoSize, gizmoSize);
    gizmoRenderer.setPixelRatio(window.devicePixelRatio);
    gizmoRendererRef.current = gizmoRenderer;

    // Create a group to hold and rotate the axes
    const gizmoAxesGroup = new THREE.Group();
    gizmoScene.add(gizmoAxesGroup);

    // Create axis arrows
    const arrowLength = 40;
    const arrowHeadLength = 12;

    // X axis (red)
    const xArrow = new THREE.Group();
    const xCone = new THREE.Mesh(
      new THREE.ConeGeometry(5, arrowHeadLength, 8),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    xCone.position.set(arrowLength - arrowHeadLength / 2, 0, 0);
    xCone.rotation.z = -Math.PI / 2;
    const xLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, arrowLength - arrowHeadLength * 0.5, 0, 0]), 3)
      ),
      new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 })
    );
    xArrow.add(xLine, xCone);
    xArrow.userData.axis = 'x';
    gizmoAxesGroup.add(xArrow);

    // Y axis (green)
    const yArrow = new THREE.Group();
    const yCone = new THREE.Mesh(
      new THREE.ConeGeometry(5, arrowHeadLength, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    yCone.position.set(0, arrowLength - arrowHeadLength / 2, 0);
    const yLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, arrowLength - arrowHeadLength * 0.5, 0]), 3)
      ),
      new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 })
    );
    yArrow.add(yLine, yCone);
    yArrow.userData.axis = 'y';
    gizmoAxesGroup.add(yArrow);

    // Z axis (blue)
    const zArrow = new THREE.Group();
    const zCone = new THREE.Mesh(
      new THREE.ConeGeometry(5, arrowHeadLength, 8),
      new THREE.MeshBasicMaterial({ color: 0x0000ff })
    );
    zCone.position.set(0, 0, arrowLength - arrowHeadLength / 2);
    zCone.rotation.x = Math.PI / 2;
    const zLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, arrowLength - arrowHeadLength * 0.5]), 3)
      ),
      new THREE.LineBasicMaterial({ color: 0x0000ff, linewidth: 2 })
    );
    zArrow.add(zLine, zCone);
    zArrow.userData.axis = 'z';
    gizmoAxesGroup.add(zArrow);

    // Center cube for perspective view
    const centerCube = new THREE.Mesh(
      new THREE.BoxGeometry(8, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x888888 })
    );
    centerCube.userData.axis = 'perspective';
    gizmoAxesGroup.add(centerCube);

    gizmoAxisObjectsRef.current = { x: xArrow, y: yArrow, z: zArrow };

    // Add to DOM
    containerRef.current.appendChild(gizmoCanvas);

    // Track hovered object for hover effect
    let hoveredAxisGroup: THREE.Object3D | null = null;

    // Handle gizmo hover
    const onGizmoMove = (event: MouseEvent) => {
      const rect = gizmoCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      mouse.x = (x / gizmoSize) * 2 - 1;
      mouse.y = -(y / gizmoSize) * 2 + 1;

      raycaster.setFromCamera(mouse, gizmoCamera);
      const intersects = raycaster.intersectObjects(gizmoScene.children, true);

      let newHoveredGroup: THREE.Object3D | null = null;

      if (intersects.length > 0) {
        // Find the axis group
        for (let obj = intersects[0].object as any; obj; obj = obj.parent) {
          if (obj.userData.axis) {
            newHoveredGroup = obj;
            break;
          }
        }
      }

      // Reset previous hover
      if (hoveredAxisGroup && hoveredAxisGroup !== newHoveredGroup) {
        hoveredAxisGroup.scale.set(1, 1, 1);
      }

      // Apply hover effect
      if (newHoveredGroup && newHoveredGroup !== hoveredAxisGroup) {
        newHoveredGroup.scale.set(1.2, 1.2, 1.2);
        gizmoCanvas.style.cursor = 'pointer';
      } else if (!newHoveredGroup) {
        gizmoCanvas.style.cursor = 'default';
      }

      hoveredAxisGroup = newHoveredGroup;
    };

    // Handle gizmo clicks
    const onGizmoClick = (event: MouseEvent) => {
      const rect = gizmoCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      mouse.x = (x / gizmoSize) * 2 - 1;
      mouse.y = -(y / gizmoSize) * 2 + 1;

      raycaster.setFromCamera(mouse, gizmoCamera);
      const intersects = raycaster.intersectObjects(gizmoScene.children, true);

      if (intersects.length > 0) {
        let axis = null;
        for (let obj = intersects[0].object as any; obj; obj = obj.parent) {
          if (obj.userData.axis) {
            axis = obj.userData.axis;
            break;
          }
        }

        if (axis) {
          onViewModeChange(axis as 'perspective' | 'x' | 'y' | 'z');
        }
      }
    };

    gizmoCanvas.addEventListener('mousemove', onGizmoMove);
    gizmoCanvas.addEventListener('click', onGizmoClick);

    // Animation loop for gizmo
    let gizmoAnimationId: number;
    const animateGizmo = () => {
      gizmoAnimationId = requestAnimationFrame(animateGizmo);
      
      // Synchronize gizmo camera rotation with main camera
      const perspectiveCamera = perspectiveCameraRef.current;
      if (perspectiveCamera) {
        // Get the camera's world quaternion
        const quat = new THREE.Quaternion();
        perspectiveCamera.getWorldQuaternion(quat);
        // Apply it to the gizmo camera so it's oriented the same way
        gizmoCamera.quaternion.copy(quat);
        
        // Position the camera at a fixed distance from origin along its viewing direction
        const distance = 100;
        gizmoCamera.position.set(0, 0, distance);
        gizmoCamera.position.applyQuaternion(quat);
        
        // Update the camera matrix
        gizmoCamera.updateMatrixWorld();
      }
      
      gizmoRenderer.render(gizmoScene, gizmoCamera);
    };
    animateGizmo();

    return () => {
      gizmoCanvas.removeEventListener('mousemove', onGizmoMove);
      gizmoCanvas.removeEventListener('click', onGizmoClick);
      cancelAnimationFrame(gizmoAnimationId);
      gizmoRenderer.dispose();
      if (containerRef.current && gizmoCanvas.parentNode === containerRef.current) {
        containerRef.current.removeChild(gizmoCanvas);
      }
    };
  }, [onViewModeChange]);

  useImperativeHandle(ref, () => ({
    exportLightningSequenceFromViewport: async ({ lightningId, frameCount, fps, width, height, mode }) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      // Use the focused quad panel's camera for export when in quad mode
      const focusedPanel = focusedQuadPanelRef.current;
      const quadCams = quadCamerasRef.current;
      const exportCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null =
        quadViewportRef.current && focusedPanel && quadCams
          ? (focusedPanel === 'top' ? quadCams.top
            : focusedPanel === 'front' ? quadCams.front
            : focusedPanel === 'side' ? quadCams.side
            : currentCameraRef.current)
          : currentCameraRef.current;
      const activeCamera = exportCamera;
      if (!renderer || !scene || !activeCamera) return [];

      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const size = renderer.getSize(new THREE.Vector2());
      const prevPixelRatio = renderer.getPixelRatio();
      const prevBackground = scene.background;
      const prevQuad = quadViewportRef.current;
      const visibility = new Map<THREE.Object3D, boolean>();
      const particleVisibility = new Map<THREE.Object3D, boolean>();
      const helperVisibility = new Map<any, boolean>();
      const sceneSettingsBg = sceneSettingsRef.current.referenceImage ? null : new THREE.Color(sceneSettingsRef.current.backgroundColor);
      const prevAspect = activeCamera instanceof THREE.PerspectiveCamera ? activeCamera.aspect : null;

      try {
        sceneObjectMeshesRef.current.forEach((mesh, id) => {
          visibility.set(mesh, mesh.visible);
          mesh.visible = id === lightningId;
        });
        physicsForceGizmosRef.current.forEach((gizmo) => {
          helperVisibility.set(gizmo, gizmo.visible);
          gizmo.visible = false;
        });
        gridHelpersRef.current.forEach((grid) => {
          helperVisibility.set(grid, grid.visible);
          grid.visible = false;
        });
        selectionOutlineHelpersRef.current.forEach((helper) => {
          helperVisibility.set(helper, helper.visible);
          helper.visible = false;
        });
        const handles = scene.getObjectByName('transform-handles');
        if (handles) {
          helperVisibility.set(handles, handles.visible);
          handles.visible = false;
        }
        spineAttachmentMeshesRef.current.forEach((mesh) => {
          helperVisibility.set(mesh, mesh.visible);
          mesh.visible = false;
        });
        particleSystemsRef.current.forEach((system) => {
          system.particles.forEach((p) => {
            particleVisibility.set(p.mesh, p.mesh.visible);
            p.mesh.visible = false;
          });
        });

        quadViewportRef.current = false;
        scene.background = null;
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        renderer.setScissor(0, 0, width, height);
        renderer.setViewport(0, 0, width, height);
        if (activeCamera instanceof THREE.PerspectiveCamera) {
          activeCamera.aspect = width / Math.max(1, height);
          activeCamera.updateProjectionMatrix();
        }

        const frames: string[] = [];
        for (let i = 0; i < Math.max(1, frameCount); i++) {
          lightningViewportExportRef.current = {
            lightningId,
            frameIndex: i,
            frameCount: Math.max(1, frameCount),
            fps,
            mode,
          };
          await nextFrame();
          renderer.render(scene, activeCamera);
          frames.push(renderer.domElement.toDataURL('image/png'));
        }

        lightningViewportExportRef.current = null;
        await nextFrame();
        return frames;
      } finally {
        lightningViewportExportRef.current = null;
        visibility.forEach((value, mesh) => { mesh.visible = value; });
        particleVisibility.forEach((value, mesh) => { mesh.visible = value; });
        helperVisibility.forEach((value, mesh) => { mesh.visible = value; });
        quadViewportRef.current = prevQuad;
        scene.background = prevBackground ?? sceneSettingsBg;
        renderer.setPixelRatio(prevPixelRatio);
        renderer.setSize(size.x, size.y, false);
        renderer.setScissor(0, 0, size.x, size.y);
        renderer.setViewport(0, 0, size.x, size.y);
        if (activeCamera instanceof THREE.PerspectiveCamera && prevAspect) {
          activeCamera.aspect = prevAspect;
          activeCamera.updateProjectionMatrix();
        }
      }
    },
    getParticleTextureBlob: async () => {
        const particleType = sceneSettings.particleType ?? 'dots';
        const customGlow = sceneSettings.customGlow ?? false;
        
        return new Promise<Blob | null>((resolve) => {
            const textureType = particleType === 'dots' && !customGlow ? 'circles' : particleType;
            const size = 64;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(null);

            ctx.clearRect(0, 0, size, size);
            const center = size / 2;
            const radius = size * 0.4;

            const makeGlowGradient = () => {
              const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius * 1.15);
              gradient.addColorStop(0, 'rgba(255,255,255,1)');
              gradient.addColorStop(0.45, 'rgba(255,255,255,0.85)');
              gradient.addColorStop(1, 'rgba(255,255,255,0)');
              return gradient;
            };

            if (textureType === 'stars') {
              const makeFlare = () => {
                const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
                grad.addColorStop(0, 'rgba(255,255,255,1)');
                grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
                grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
                grad.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(0, 0, radius, 0, Math.PI * 2);
                ctx.fill();
              };

              ctx.save();
              if (customGlow) ctx.globalCompositeOperation = 'lighter';

              // Vertical flare
              ctx.save();
              ctx.translate(center, center);
              ctx.scale(0.15, 1.0);
              makeFlare();
              ctx.restore();

              // Horizontal flare
              ctx.save();
              ctx.translate(center, center);
              ctx.scale(1.0, 0.15);
              makeFlare();
              ctx.restore();

              // Core
              ctx.save();
              ctx.translate(center, center);
              ctx.beginPath();
              ctx.arc(0, 0, radius * 0.25, 0, Math.PI * 2);
              const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.25);
              coreGrad.addColorStop(0, 'rgba(255,255,255,1)');
              coreGrad.addColorStop(1, 'rgba(255,255,255,0)');
              ctx.fillStyle = coreGrad;
              ctx.fill();
              ctx.restore();
              
              ctx.restore();
            } else if ((textureType === 'sprites' || textureType === '3d-model')) {
              const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius * 1.2);
              gradient.addColorStop(0, 'rgba(255,255,255,1)');
              gradient.addColorStop(0.25, 'rgba(255,255,255,0.95)');
              gradient.addColorStop(0.6, 'rgba(255,255,255,0.5)');
              gradient.addColorStop(1, 'rgba(255,255,255,0)');
              ctx.fillStyle = gradient;
              ctx.fillRect(0, 0, size, size);
            } else if (textureType === 'glow-circles') {
              ctx.beginPath();
              ctx.arc(center, center, radius, 0, Math.PI * 2);
              ctx.closePath();
              ctx.fillStyle = makeGlowGradient();
              ctx.fill();
            } else {
              if (customGlow) {
                ctx.beginPath();
                ctx.arc(center, center, radius, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fillStyle = makeGlowGradient();
                ctx.fill();
              } else {
                ctx.beginPath();
                ctx.arc(center, center, radius * 0.5, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fillStyle = 'rgba(255,255,255,1)';
                ctx.fill();
              }
            }

            canvas.toBlob((blob) => {
                resolve(blob);
            }, 'image/png');
        });
    },
    getExportAssets: async () => {
        const assets: Array<{name: string, blob: Blob}> = [];
        let pUrls: string[] = [];
        let singleUrl: string = '';
        let hasCustomSequence = false;
        let hasSingleImage = false;
        let customParticleType = sceneSettings.particleType ?? 'dots';
        let customGlow = sceneSettings.customGlow ?? false;
        
        for (const obj of sceneObjectsRef.current) {
            if (obj.type === 'Emitter') {
                const props = obj.properties as any;
                if (props?.particleSpriteSequenceDataUrls?.length > 0) {
                    pUrls = resampleSequence(props.particleSpriteSequenceDataUrls, sceneSettings.particleSequenceBudget);
                    hasCustomSequence = true;
                    break;
                } else if (props?.particleSpriteImageDataUrl) {
                    singleUrl = props.particleSpriteImageDataUrl;
                    hasSingleImage = true;
                    break;
                }
                if (props?.particleType) {
                    customParticleType = props.particleType;
                    customGlow = props.particleGlow ?? false;
                }
            }
        }
        
        if (hasCustomSequence && pUrls.length > 0) {
            for (let i=0; i<pUrls.length; i++) {
                try {
                    const res = await fetch(pUrls[i]);
                    const blob = await (await fetch(pUrls[i])).blob();
                    const frameName = String(i).padStart(2, '0');
                    assets.push({ name: `images/particles/png/particle_${frameName}.png`, blob });
                } catch (e) {
                    console.error("Error fetching blob for sequence frame", i, e);
                }
            }
            return assets;
        }

        if (hasSingleImage && singleUrl) {
            try {
                const res = await fetch(singleUrl);
                const blob = await res.blob();
                assets.push({ name: 'images/particles/png/particle.png', blob });
                return assets;
            } catch(e) {
                console.error("Error fetching single image blob", e);
            }
        }

        // Add standard static texture
        const textureType = customParticleType === 'dots' && !customGlow ? 'circles' : customParticleType;
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return [];

        ctx.clearRect(0, 0, size, size);
        const center = size / 2;
        const radius = size * 0.4;

        const makeGlowGradient = () => {
            const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius * 1.15);
            gradient.addColorStop(0, 'rgba(255,255,255,1)');
            gradient.addColorStop(0.45, 'rgba(255,255,255,0.85)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            return gradient;
        };

        if (textureType === 'stars') {
            const makeFlare = () => {
              const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
              grad.addColorStop(0, 'rgba(255,255,255,1)');
              grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
              grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
              grad.addColorStop(1, 'rgba(255,255,255,0)');
              ctx.fillStyle = grad;
              ctx.beginPath();
              ctx.arc(0, 0, radius, 0, Math.PI * 2);
              ctx.fill();
            };

            ctx.save();
            if (customGlow) ctx.globalCompositeOperation = 'lighter';

            // Vertical flare
            ctx.save();
            ctx.translate(center, center);
            ctx.scale(0.15, 1.0);
            makeFlare();
            ctx.restore();

            // Horizontal flare
            ctx.save();
            ctx.translate(center, center);
            ctx.scale(1.0, 0.15);
            makeFlare();
            ctx.restore();

            // Core
            ctx.save();
            ctx.translate(center, center);
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.25, 0, Math.PI * 2);
            const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.25);
            coreGrad.addColorStop(0, 'rgba(255,255,255,1)');
            coreGrad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = coreGrad;
            ctx.fill();
            ctx.restore();
            
            ctx.restore();
        } else if ((textureType === 'sprites' || textureType === '3d-model')) {
            const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius * 1.2);
            gradient.addColorStop(0, 'rgba(255,255,255,1)');
            gradient.addColorStop(0.25, 'rgba(255,255,255,0.95)');
            gradient.addColorStop(0.6, 'rgba(255,255,255,0.5)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);
        } else if (textureType === 'glow-circles') {
            ctx.beginPath();
            ctx.arc(center, center, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fillStyle = makeGlowGradient();
            ctx.fill();
        } else {
            if (customGlow) {
                ctx.beginPath();
                ctx.arc(center, center, radius, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fillStyle = makeGlowGradient();
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(center, center, radius * 0.5, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fillStyle = 'rgba(255,255,255,1)';
                ctx.fill();
            }
        }

        return new Promise<Array<{name: string, blob: Blob}>>((resolve) => {
            canvas.toBlob((blob) => {
                if (blob) assets.push({ name: 'images/particles/png/particle.png', blob });
                resolve(assets);
            }, 'image/png');
        });
    },
    exportSpineData: (options?: any) => {
      // Gather data across all cached frames
      const spineData = {
        skeleton: {
          hash: "particle-export",
          spine: "4.2.43",
          x: -sceneSize.x / 2,
          y: -sceneSize.y / 2,
          width: sceneSize.x,
          height: sceneSize.y,
          fps: 24,
        },
        bones: [] as any[],
        slots: [] as any[],
        skins: [{ name: "default", attachments: {} }] as any[],
        animations: { animation: { slots: {} as any, bones: {} as any, attachments: {"default": {}} as any } } as any
      };
      
      if (options?.sequenceMode) {
          spineData.animations["intro"] = { slots: {}, bones: {}, attachments: {"default": {}} };
          spineData.animations["loop"] = { slots: {}, bones: {}, attachments: {"default": {}} };
          spineData.animations["outro"] = { slots: {}, bones: {}, attachments: {"default": {}} };
      }
      

      const frames = Array.from(particleFrameCacheRef.current.entries())
        .sort((a, b) => a[0] - b[0]);
      
      if (frames.length === 0) return null;

      const trackData = new Map<string, { frame: number, state: CachedParticleState }[]>();

      // Group states by trackId
      for (const [frameObj, states] of frames) {
        for (const state of states) {
          const uniqueId = `${state.emitterId}_${state.trackId}`;
          if (!trackData.has(uniqueId)) trackData.set(uniqueId, []);
          
          let pushedState = state;
          const activeCam = currentCameraRef.current;
          const basePerspectiveCam = activeCam instanceof THREE.PerspectiveCamera
            ? activeCam
            : perspectiveCameraRef.current;
          if (sceneSettings.exportProjectionMode === 'perspective' && basePerspectiveCam) {
            let cam = basePerspectiveCam;
            const cameraState = cameraStateRef.current;
            const orbitTarget = new THREE.Vector3(
              cameraState.viewOffsetX,
              cameraState.viewOffsetY,
              cameraState.viewOffsetZ,
            );

            if (sceneSettings.cameraOrbitSpeed) {
                cam = cam.clone();
                const orbitOffset = (sceneSettings.cameraOrbitSpeed || 0) * (frameObj / 24) * (Math.PI / 180);
                const effectiveTheta = cameraState.theta + orbitOffset;
                const sin_phi = Math.sin(cameraState.phi);
                const cos_phi = Math.cos(cameraState.phi);
                const sin_theta = Math.sin(effectiveTheta);
                const cos_theta = Math.cos(effectiveTheta);
                cam.position.x = orbitTarget.x + cameraState.radius * sin_phi * sin_theta;
                cam.position.y = orbitTarget.y + cameraState.radius * cos_phi;
                cam.position.z = orbitTarget.z + cameraState.radius * sin_phi * cos_theta;
                cam.lookAt(orbitTarget);
            }
            cam.updateMatrixWorld(true);

            const particlePosNdc = new THREE.Vector3(state.position.x, state.position.y, state.position.z).project(cam);
            const particleVelNdc = new THREE.Vector3(
              state.position.x + state.velocity.x,
              state.position.y + state.velocity.y,
              state.position.z + state.velocity.z,
            ).project(cam);

            const refDist = Math.max(1e-4, cam.position.distanceTo(orbitTarget));
            const fov = cam.fov;
            const aspect = cam.aspect;
            const scaleY = Math.tan(fov * Math.PI / 360) * refDist;
            const scaleX = scaleY * aspect;

            const particleDist = Math.max(
              1e-4,
              cam.position.distanceTo(new THREE.Vector3(state.position.x, state.position.y, state.position.z)),
            );
            const distRatio = refDist / particleDist;

            pushedState = {
              ...state,
              position: {
                x: particlePosNdc.x * scaleX,
                y: particlePosNdc.y * scaleY,
                z: state.position.z,
              },
              velocity: {
                x: (particleVelNdc.x - particlePosNdc.x) * scaleX,
                y: (particleVelNdc.y - particlePosNdc.y) * scaleY,
                z: state.velocity.z,
              },
              size: state.size * distRatio,
            };
          }

          trackData.get(uniqueId)!.push({ frame: frameObj, state: pushedState });
        }
      }

      // Root bone
      spineData.bones.push({ name: "root" });

      // Cache emitter sequence info
      const emitterSequences = new Map<string, { count: number, fps: number }>();
      sceneObjectsRef.current.forEach(obj => {
          if (obj.type === 'Emitter') {
              const props = obj.properties as any;
              const seqProps = getResampledSequenceProps(props, sceneSettings.particleSequenceBudget, sceneSettings.particleSequenceBudgetLoop);
              const urls = seqProps.urls;
              if (urls.length > 0) {
                  emitterSequences.set(obj.id, {
                      count: urls.length,
                      fps: seqProps.fps
                  });
              }
          }
      });

      trackData.forEach((history, trackId) => {
        const boneName = `track_${trackId}`;

        const slotName = 'slot_' + trackId;
        
        spineData.bones.push({ name: boneName, parent: "root" });
        spineData.slots.push({ name: slotName, bone: boneName, attachment: null });

        const firstState = history[0]?.state;
        const seqInfo = firstState ? emitterSequences.get(firstState.emitterId) : undefined;

        const skinAttachments = spineData.skins[0].attachments as any;
        if (seqInfo && seqInfo.count > 0) {
            skinAttachments[slotName] = { 
                "particle": { type: "region", name: "particles/png/particle", width: 64, height: 64, sequence: { count: seqInfo.count, start: 0, digits: 2 } }
            };
        } else {
            skinAttachments[slotName] = { "particle": { type: "region", name: "particles/png/particle", width: 64, height: 64 } };
        }
        const boneAnim = { translate: [] as any[], scale: [] as any[], rotate: [] as any[] };
        const slotAnim: any = { rgba: [] as any[], attachment: [] as any[] };
        let sequenceAnim: any = null;
        if (seqInfo && seqInfo.count > 0) {
            sequenceAnim = [] as any[];
            if (!spineData.animations.animation.attachments["default"][slotName]) {
                spineData.animations.animation.attachments["default"][slotName] = {};
            }
            spineData.animations.animation.attachments["default"][slotName]["particle"] = { sequence: sequenceAnim };
        }

        // Chunk history into contiguous life segments
        if (history.length > 0 && history[0].frame > 0) {
            slotAnim.attachment.push({ time: 0, name: null });
            slotAnim.rgba.push({ time: 0, color: "ffffff00", curve: "stepped" });
            boneAnim.scale.push({ time: 0, x: 0, y: 0, curve: "stepped" });
            boneAnim.rotate.push({ time: 0, value: 0, curve: "stepped" });
        }
          const lifespans: {frame: number, state: CachedParticleState}[][] = [];
          let currentLifespan: {frame: number, state: CachedParticleState}[] = [];
          let lastFrame = -2;
          let lastAge = -1;

          for (const item of history) {
            if ((item.frame > lastFrame + 1 || item.state.age < lastAge) && lastFrame !== -2) {
              lifespans.push(currentLifespan);
              currentLifespan = [];
            }
            currentLifespan.push(item);
            lastFrame = item.frame;
            lastAge = item.state.age;
          }
          if (currentLifespan.length > 0) lifespans.push(currentLifespan);

          // Process each lifespan segment, downsampling to exactly 4 keys
          for (let i = 0; i < lifespans.length; i++) {
            const life = lifespans[i];
            if (life.length === 0) continue;

            // No rebirth-gap key needed here: the death key of the previous lifespan already sets
            // scale/rgba to 0 at deathFrame+1, and Spine maintains that value until the next keyframe.
            // Pushing a key at (life[0].frame - 1) creates out-of-order or duplicate entries.
            
            slotAnim.attachment.push({ time: life[0].frame / 24, name: "particles/png/particle" });

            if (seqInfo && seqInfo.count > 0) {
                sequenceAnim!.push({
                   time: life[0].frame / 24,
                   mode: "loop",
                   index: 0,
                   delay: 1 / seqInfo.fps
                });
            }

            // 3 keys (start, mid, end) — cubic bezier covers the full motion accurately
            const maxKeys = 3;
            const bakedKeys: {frame: number, state: CachedParticleState}[] = [];
            if (life.length <= maxKeys) {
                bakedKeys.push(...life);
            } else {
                for (let j = 0; j < maxKeys; j++) {
                    const idx = Math.floor(j * (life.length - 1) / (maxKeys - 1));
                    bakedKeys.push(life[idx]);
                }
            }

            // Catmull-Rom tangent helpers — returns the slope at index k for a
            // uniformly-sampled scalar sequence, clamped at the endpoints.
            type BakedKey = {frame: number, state: CachedParticleState};
            const crTangent = (keys: BakedKey[], k: number, getValue: (s: BakedKey) => number): number => {
                if (keys.length < 2) return 0;
                const prev = keys[Math.max(0, k - 1)];
                const next = keys[Math.min(keys.length - 1, k + 1)];
                const prevTime = prev.frame / 24;
                const nextTime = next.frame / 24;
                const dt = nextTime - prevTime;
                return dt > 0 ? (getValue(next) - getValue(prev)) / dt : 0;
            };

            // Build a single-value bezier curve definition [cx1,cy1,cx2,cy2].
            const makeBezier1 = (
                t0: number, v0: number, tan0: number,
                t1: number, v1: number, tan1: number,
                clampMin?: number
            ): number[] => {
                const dt = t1 - t0;
                const third = dt / 3;
                const cp0v = clampMin !== undefined ? Math.max(clampMin, v0 + tan0 * third) : v0 + tan0 * third;
                const cp1v = clampMin !== undefined ? Math.max(clampMin, v1 - tan1 * third) : v1 - tan1 * third;
                return [t0 + third, cp0v, t1 - third, cp1v];
            };

            for (let k = 0; k < bakedKeys.length; k++) {
              const { frame, state } = bakedKeys[k];
              const time = frame / 24;

              // Gate alpha by the lifecycle visibility flag: when visible=false (birth 0-20% / death 80-100%
              // windows), emit rgba=0 so the particle is transparent at origin/end in Spine — no snap flash.
              const effectiveOpacity = state.visible ? state.opacity : 0;
              const finalAlpha = Math.floor(Math.max(0, Math.min(1, effectiveOpacity)) * 255).toString(16).padStart(2, '0');
              
              const isLastKey = k === bakedKeys.length - 1;
              const steppedDef = { curve: "stepped" };

              // ── Translate bezier (Catmull-Rom tangents from position data) ──
              let translateCurveDefinition: any = steppedDef;
              if (!isLastKey) {
                  const nextObj = bakedKeys[k + 1];
                  const nextTime = nextObj.frame / 24;
                  const getX = (bk: BakedKey) => bk.state.position.x * 10;
                  const getY = (bk: BakedKey) => bk.state.position.y * 10;
                  const tanX0 = crTangent(bakedKeys, k,     getX) * 10;
                  const tanX1 = crTangent(bakedKeys, k + 1, getX) * 10;
                  const tanY0 = crTangent(bakedKeys, k,     getY) * 10;
                  const tanY1 = crTangent(bakedKeys, k + 1, getY) * 10;
                  const bx = makeBezier1(time, getX(bakedKeys[k]), tanX0, nextTime, getX(nextObj), tanX1);
                  const by = makeBezier1(time, getY(bakedKeys[k]), tanY0, nextTime, getY(nextObj), tanY1);
                  translateCurveDefinition = { curve: [...bx, ...by] };
              }

              // ── RGBA bezier: per-channel Catmull-Rom for colour tint + smooth alpha fade ──
              let rgbaCurveDefinition: any = steppedDef;
              if (!isLastKey) {
                  const nextObj = bakedKeys[k + 1];
                  const nextTime = nextObj.frame / 24;
                  const getA = (bk: BakedKey) => bk.state.visible ? Math.max(0, Math.min(1, bk.state.opacity)) : 0;
                  const tanA0 = crTangent(bakedKeys, k,     getA);
                  const tanA1 = crTangent(bakedKeys, k + 1, getA);
                  const ba = makeBezier1(time, getA(bakedKeys[k]), tanA0, nextTime, getA(nextObj), tanA1, 0);
                  // Per-channel colour bezier (handles tint gradient; degenerates to 1→1 for white)
                  const _ch = (col: string | undefined, sh: number) => ((parseInt((col ?? 'ffffff'), 16) >> sh) & 0xff) / 255;
                  const getR = (bk: BakedKey) => _ch(bk.state.color, 16);
                  const getG = (bk: BakedKey) => _ch(bk.state.color, 8);
                  const getB = (bk: BakedKey) => _ch(bk.state.color, 0);
                  const tanR0 = crTangent(bakedKeys, k, getR), tanR1 = crTangent(bakedKeys, k+1, getR);
                  const tanG0 = crTangent(bakedKeys, k, getG), tanG1 = crTangent(bakedKeys, k+1, getG);
                  const tanB0 = crTangent(bakedKeys, k, getB), tanB1 = crTangent(bakedKeys, k+1, getB);
                  const br = makeBezier1(time, getR(bakedKeys[k]), tanR0, nextTime, getR(nextObj), tanR1, 0);
                  const bg = makeBezier1(time, getG(bakedKeys[k]), tanG0, nextTime, getG(nextObj), tanG1, 0);
                  const bb = makeBezier1(time, getB(bakedKeys[k]), tanB0, nextTime, getB(nextObj), tanB1, 0);
                  rgbaCurveDefinition = { curve: [...br, ...bg, ...bb, ...ba] };
              }

              const stateColorHex = (state.color ?? 'ffffff');
              slotAnim.rgba.push({ time, color: `${stateColorHex}${finalAlpha}`, ...rgbaCurveDefinition });

              boneAnim.translate.push({
                 time,
                 x: state.position.x * 10,
                 y: state.position.y * 10,
                 ...translateCurveDefinition
              });

              // ── Scale bezier (Catmull-Rom tangents) ──
              // Also gate scale by visibility so the bone collapses to 0 at birth/death windows
              // For perspective mode, state.size already has distRatio baked in by the projection step
              // above, so we use the same x10/64 factor as ortho — no separate constant needed.
              const rawScale = Math.max(0.05, state.size * 10) / 64;
              const sizeScale = state.visible ? rawScale : 0;
              let scaleCurveDefinition: any = steppedDef;
              if (!isLastKey) {
                  const nextObj = bakedKeys[k + 1];
                  const nextTime = nextObj.frame / 24;
                  const scaleOf = (bk: BakedKey) => {
                      if (!bk.state.visible) return 0;
                      return Math.max(0.01, Math.max(0.05, bk.state.size * 10) / 64);
                  };
                  const tan0 = crTangent(bakedKeys, k,     scaleOf);
                  const tan1 = crTangent(bakedKeys, k + 1, scaleOf);
                  const bs = makeBezier1(time, scaleOf(bakedKeys[k]), tan0, nextTime, scaleOf(nextObj), tan1, 0);
                  // x and y are identical — duplicate the same bezier
                  scaleCurveDefinition = { curve: [...bs, ...bs] };
              }

              boneAnim.scale.push({
                 time,
                 x: sizeScale,
                 y: sizeScale,
                 ...scaleCurveDefinition
              });

              // ── Rotate bezier (Catmull-Rom tangents) ──
              let rotateCurveDefinition: any = steppedDef;
              if (!isLastKey) {
                  const nextObj = bakedKeys[k + 1];
                  const nextTime = nextObj.frame / 24;
                  const getRot = (bk: BakedKey) => bk.state.rotation * -(180 / Math.PI);
                  const tanR0 = crTangent(bakedKeys, k,     getRot);
                  const tanR1 = crTangent(bakedKeys, k + 1, getRot);
                  const br = makeBezier1(time, getRot(bakedKeys[k]), tanR0, nextTime, getRot(nextObj), tanR1);
                  rotateCurveDefinition = { curve: br };
              }

              boneAnim.rotate.push({
                 time,
                 value: state.rotation * -(180 / Math.PI),
                 ...rotateCurveDefinition
              });
            }

            // Death invisible frame toggle visibility
            const deathFrame = life[life.length - 1].frame;
            slotAnim.rgba.push({ time: (deathFrame + 1) / 24, color: 'ffffff00', curve: "stepped" });
            boneAnim.scale.push({ time: (deathFrame + 1) / 24, x: 0, y: 0, curve: "stepped" });
            boneAnim.rotate.push({ time: (deathFrame + 1) / 24, value: 0, curve: "stepped" });
            slotAnim.attachment.push({ time: (deathFrame + 1) / 24, name: null });
          }

          
          if (options?.sequenceMode) {
            const seqIn = options.timelineIn || 0;
            const seqLoopStart = options.loopStart || 60;
            const seqLoopEnd = options.loopEnd || 180;
            const seqOut = options.timelineOut || 240;

            const sliceAnim = (anim: any, startFrame: number, endFrame: number) => {
                const startTime = startFrame / 24;
                const endTime = endFrame / 24;
                const filterCurve = (arr: any[]) => {
                    const filtered = arr.filter(k => k.time >= startTime && k.time <= endTime);
                    return filtered.map(k => {
                        const newK = { ...k, time: k.time - startTime };
                        return newK;
                    });
                };
                return {
                    translate: filterCurve(anim.translate || []),
                    scale: filterCurve(anim.scale || []),
                    rotate: filterCurve(anim.rotate || [])
                };
            };
            const sliceSlot = (anim: any, startFrame: number, endFrame: number) => {
                const startTime = startFrame / 24;
                const endTime = endFrame / 24;
                const filterCurve = (arr: any[]) => {
                    const filtered = arr.filter(k => k.time >= startTime && k.time <= endTime);
                    return filtered.map(k => ({ ...k, time: k.time - startTime }));
                };
                const res: any = {
                    rgba: filterCurve(anim.rgba || []),
                    attachment: filterCurve(anim.attachment || [])
                };
                if (anim.particle && anim.particle.sequence) {
                    res.particle = { sequence: filterCurve(anim.particle.sequence) };
                }
                return res;
            };

            spineData.animations["intro"].bones[boneName] = sliceAnim(boneAnim, seqIn, seqLoopStart);
            spineData.animations["intro"].slots[slotName] = sliceSlot(slotAnim, seqIn, seqLoopStart);
            if (sequenceAnim) {
                if (!spineData.animations["intro"].attachments["default"][slotName]) spineData.animations["intro"].attachments["default"][slotName] = {};
                spineData.animations["intro"].attachments["default"][slotName]["particle"] = { sequence: sliceSlot({particle: {sequence: sequenceAnim}}, seqIn, seqLoopStart).particle?.sequence || [] };
            }

            spineData.animations["loop"].bones[boneName] = sliceAnim(boneAnim, seqLoopStart, seqLoopEnd);
            spineData.animations["loop"].slots[slotName] = sliceSlot(slotAnim, seqLoopStart, seqLoopEnd);
            if (sequenceAnim) {
                if (!spineData.animations["loop"].attachments["default"][slotName]) spineData.animations["loop"].attachments["default"][slotName] = {};
                spineData.animations["loop"].attachments["default"][slotName]["particle"] = { sequence: sliceSlot({particle: {sequence: sequenceAnim}}, seqLoopStart, seqLoopEnd).particle?.sequence || [] };
            }

            // outro start time should match seqLoopEnd start to seqOut end.
            spineData.animations["outro"].bones[boneName] = sliceAnim(boneAnim, seqLoopEnd, seqOut);
            spineData.animations["outro"].slots[slotName] = sliceSlot(slotAnim, seqLoopEnd, seqOut);
            if (sequenceAnim) {
                if (!spineData.animations["outro"].attachments["default"][slotName]) spineData.animations["outro"].attachments["default"][slotName] = {};
                spineData.animations["outro"].attachments["default"][slotName]["particle"] = { sequence: sliceSlot({particle: {sequence: sequenceAnim}}, seqLoopEnd, seqOut).particle?.sequence || [] };
            }
          } else {
             spineData.animations.animation.bones[boneName] = boneAnim;
             spineData.animations.animation.slots[slotName] = slotAnim;
          }

      });

      return spineData;
    },
    focusSelectedObject: () => {
      focusSelectedObjectRef.current?.();
    },
    resetRigidBodies: () => {
      // Stop any active simulation state
      rigidBodyStateRef.current.clear();
      // Restore every physics-driven object to the position it had when play last started
      if (rigidBodyOriginRef.current.size === 0) return;
      rigidBodyOriginRef.current.forEach((origin, objId) => {
        const mesh = sceneObjectMeshesRef.current.get(objId);
        const obj = sceneObjectsRef.current.find(o => o.id === objId);
        if (mesh) {
          mesh.position.set(origin.x, origin.y, origin.z);
        }
        if (obj && onObjectTransformRef.current) {
          const rotation = obj.rotation;
          const scale = obj.scale;
          onObjectTransformRef.current(
            objId,
            { x: origin.x, y: origin.y, z: origin.z },
            { x: rotation.x, y: rotation.y, z: rotation.z },
            { x: scale.x, y: scale.y, z: scale.z },
          );
        }
      });
    },
  }));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: sceneSettings.backgroundColor }}>
      {/* Quad viewport panel labels + active highlight overlay */}
      {quadViewport && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
          {(['top', 'front', 'side', 'perspective'] as QuadPanel[]).map((panel) => {
            const isLeft = panel === 'top' || panel === 'side';
            const isTopRow = panel === 'top' || panel === 'front';
            const isFocused = focusedQuadPanel === panel;
            const labels: Record<QuadPanel, string> = { top: 'TOP', front: 'FRONT', side: 'RIGHT', perspective: 'PERSP' };
            return (
              <div key={panel} style={{
                position: 'absolute',
                top: isTopRow ? 0 : '50%',
                bottom: isTopRow ? '50%' : 0,
                left: isLeft ? 0 : '50%',
                right: isLeft ? '50%' : 0,
                border: isFocused ? '2px solid #f39c12' : '1px solid rgba(255,255,255,0.1)',
                boxSizing: 'border-box',
                boxShadow: isFocused ? 'inset 0 0 0 1px #f39c12' : 'none',
              }}>
                <span style={{
                  position: 'absolute',
                  top: '6px',
                  left: '8px',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: isFocused ? '#f39c12' : 'rgba(255,255,255,0.4)',
                  userSelect: 'none',
                }}>{labels[panel]}</span>
              </div>
            );
          })}
        </div>
      )}
      {/* Viewport label in single-view mode */}
      {!quadViewport && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
          <span style={{
            position: 'absolute',
            top: '6px',
            left: '8px',
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'rgba(255,255,255,0.4)',
            userSelect: 'none',
          }}>
            {viewMode === 'y' ? 'TOP' : viewMode === 'z' ? 'FRONT' : viewMode === 'x' ? 'RIGHT' : 'PERSPECTIVE'}
          </span>
        </div>
      )}
      {sceneSettings.referenceImage && (
        <img
          src={sceneSettings.referenceImage}
          alt="Reference Background"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: sceneSettings.referenceOpacity ?? 0.5,
            zIndex: 0,
            pointerEvents: 'none'
          }}
        />
      )}
      <div className="scene-canvas" ref={containerRef} tabIndex={0} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'auto' }} />
      <div
        ref={marqueeRef}
        style={{
          display: 'none',
          position: 'absolute',
          border: '1px dashed #ffffff',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          pointerEvents: 'none',
          zIndex: 3,
        }}
      />
      <div
        className="viewport-shelf"
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 2,
          display: 'flex',
          gap: '15px',
          background: 'rgba(30, 30, 30, 0.8)',
          padding: '10px 15px',
          borderRadius: '8px',
          color: 'white',
          alignItems: 'center',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          pointerEvents: 'auto'
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
          <input
            type="checkbox"
            checked={sceneSettings.showGrid ?? true}
            onChange={(e) => onUpdateSceneSettings?.({ showGrid: e.target.checked })}
          /> Grid
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
          <input
            type="checkbox"
            checked={sceneSettings.showObjects ?? true}
            onChange={(e) => onUpdateSceneSettings?.({ showObjects: e.target.checked })}
          /> Objects
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
          <input
            type="checkbox"
            checked={sceneSettings.showBones ?? true}
            onChange={(e) => onUpdateSceneSettings?.({ showBones: e.target.checked })}
          /> Bones
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
          <input
            type="checkbox"
            checked={sceneSettings.showSpineImages ?? true}
            onChange={(e) => onUpdateSceneSettings?.({ showSpineImages: e.target.checked })}
          /> Spine Images
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
          <input
            type="checkbox"
            checked={sceneSettings.showParticles ?? true}
            onChange={(e) => onUpdateSceneSettings?.({ showParticles: e.target.checked })}
          /> Particles
        </label>

        <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.2)' }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', cursor: 'pointer' }}>
          Ref Img:
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = (re) => onUpdateSceneSettings?.({ referenceImage: re.target?.result as string });
                reader.readAsDataURL(file);
              } else {
                onUpdateSceneSettings?.({ referenceImage: null });
              }
            }}
          />
          <span style={{ background: '#444', padding: '2px 6px', borderRadius: '4px' }}>Browse</span>
        </label>

        {sceneSettings.referenceImage && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
            Opacity:
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={sceneSettings.referenceOpacity ?? 0.5}
              onChange={(e) => onUpdateSceneSettings?.({ referenceOpacity: parseFloat(e.target.value) })}
              style={{ width: '60px' }}
            />
          </label>
        )}
      </div>
    </div>
  );
});


