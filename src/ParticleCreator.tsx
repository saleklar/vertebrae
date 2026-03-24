import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CustomParticlePainter } from './CustomParticlePainter';
import { FireGenerator } from './FireGenerator';
import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ShapeType =
  | 'soft-dot' | 'glint' | 'bubble' | 'nebula' | 'anamorphic-streak'
  | 'circle'   | 'ring'  | 'star'   | 'polygon' | 'diamond'
  | 'spark'    | 'cross' | 'smoke'  | 'metallic-sphere' | 'custom-paint' | 'image';

export type FillMode   = 'solid' | 'radial' | 'linear';
export type LayerBlend = 'normal' | 'add' | 'screen' | 'multiply';
export type AnimType   = 'none' | 'spin' | 'pulse' | 'flicker' | 'color-cycle' | 'unfold';

export type ParticleLayer = {
  id: string;
  type: ShapeType;
  customImageDataUrl?: string; // For raster image shapes from paint mode
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
  filterThreshold: number;  // 0–100  cut pixels below this luminance (like Animator3D threshold)
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
  // Metallic
  metalness: number;
  roughness: number;
  lightAngle: number;
  specularColor: string;
  metalSheen: number;   // 0–100 sheen overlay strength (works on any shape type)
};

export type AnimConfig = {
  type: AnimType;
  frames: number;
  fps: number;
};

// ─── Defaults ────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

export const defaultLayer = (type: ShapeType): ParticleLayer => ({
  id: uid(), type,
  fillMode: (type === 'soft-dot' || type === 'nebula') ? 'radial' : 'solid',
  color1: type === 'metallic-sphere' ? '#c0c0c0' : '#ffffff',
  color2: type === 'nebula' ? '#8822ee' : '#ffffff',
  gradientMid: 0.5, gradientAngle: 90,
  hardness: type === 'soft-dot' ? 20 : 95,
  size: type === 'anamorphic-streak' ? 55 : 70,
  offsetX: 0, offsetY: 0, rotation: 0,
  points: type === 'star' ? 5 : type === 'glint' ? 4 : 6,
  innerRadius: type === 'ring' ? 0.55 : 0.45,
  opacity: 1,
  blend: (type === 'glint' || type === 'nebula' || type === 'anamorphic-streak') ? 'add' : 'normal',
  blur: 0,
  saturate: 100, contrast: 100, brightness: 100, hueShift: 0, filterThreshold: 0,
  glow: 0, glowSize: 2.5, glowColor: '#ffffff',
  bloom: 0, bloomSize: 3,
  starGlow: 0, starGlowArms: 4, starGlowLength: 1.0,
  glitter: 0, glitterSize: 1.5,
  ca: 0,
  metalness: 0.9,
  roughness: 0.15,
  lightAngle: 315,
  specularColor: '#ffffff',
  metalSheen: 0,
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

// ─── Metal presets ──────────────────────────────────────────────────────────

const METAL_PRESETS: { id: string; label: string; color1: string; specularColor: string; metalSheen: number; lightAngle: number }[] = [
  { id: 'gold',      label: '🥇 Gold',      color1: '#c8860a', specularColor: '#fff7a0', metalSheen: 75, lightAngle: 315 },
  { id: 'silver',    label: '🥈 Silver',    color1: '#909aaa', specularColor: '#ffffff', metalSheen: 70, lightAngle: 300 },
  { id: 'copper',    label: '🟤 Copper',    color1: '#b56020', specularColor: '#ffb060', metalSheen: 65, lightAngle: 315 },
  { id: 'bronze',    label: '🏆 Bronze',    color1: '#7a5020', specularColor: '#d49040', metalSheen: 60, lightAngle: 330 },
  { id: 'platinum',  label: '⬡ Platinum',  color1: '#c0ccd4', specularColor: '#e8eaf0', metalSheen: 80, lightAngle: 290 },
  { id: 'rose-gold', label: '🌸 Rose Gold', color1: '#c07060', specularColor: '#ffd0b0', metalSheen: 65, lightAngle: 315 },
];

// ─── Metallic sphere renderer ────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function renderMetallicSphere(off: HTMLCanvasElement, layer: ParticleLayer, r: number): void {
  const ctx = off.getContext('2d')!;
  const size = off.width;
  const C = size / 2;
  const { metalness, roughness, lightAngle, specularColor } = layer;

  const lightRad = ((lightAngle ?? 315) * Math.PI) / 180;
  const lx = C + Math.cos(lightRad) * r * 0.45;
  const ly = C - Math.sin(lightRad) * r * 0.45;  // canvas y is flipped

  const [br, bg, bb] = hexToRgb(layer.color1);

  // Darker shadow colour (base colour * 0.08)
  const dr = Math.round(br * 0.08), dg = Math.round(bg * 0.08), db = Math.round(bb * 0.08);
  // Mid-lit colour (base colour * 0.70)
  const mr = Math.round(br * 0.70), mg = Math.round(bg * 0.70), mb = Math.round(bb * 0.70);
  // Rim bounce colour (base colour * 0.55 boosted)
  const rimBoost = 0.45 + metalness * 0.4;
  const rr2 = Math.min(255, Math.round(br * rimBoost + 40));
  const rg2 = Math.min(255, Math.round(bg * rimBoost + 40));
  const rb2 = Math.min(255, Math.round(bb * rimBoost + 40));

  // 1. Clip to sphere disc
  ctx.save();
  ctx.beginPath();
  ctx.arc(C, C, r * 0.92, 0, Math.PI * 2);
  ctx.clip();

  // 2. Diffuse shading: lit centre → dark opposite corner
  const shadowX = C + (C - lx) * 0.6;
  const shadowY = C + (C - ly) * 0.6;
  const diffGrad = ctx.createRadialGradient(lx, ly, 0, shadowX, shadowY, r * 1.4);
  diffGrad.addColorStop(0,    `rgba(${Math.min(255,br+40)},${Math.min(255,bg+40)},${Math.min(255,bb+40)},1)`);
  diffGrad.addColorStop(0.20, `rgba(${br},${bg},${bb},1)`);
  diffGrad.addColorStop(0.55, `rgba(${mr},${mg},${mb},0.9)`);
  diffGrad.addColorStop(0.85, `rgba(${dr},${dg},${db},1)`);
  diffGrad.addColorStop(1.0,  `rgba(${Math.round(dr*0.4)},${Math.round(dg*0.4)},${Math.round(db*0.4)},1)`);
  ctx.fillStyle = diffGrad;
  ctx.fillRect(0, 0, size, size);

  // 3. Rim light: annular halo at sphere edge
  const rimAlpha = 0.30 + metalness * 0.45;
  const rimGrad = ctx.createRadialGradient(C, C, r * 0.70, C, C, r * 0.94);
  rimGrad.addColorStop(0,   `rgba(${rr2},${rg2},${rb2},0)`);
  rimGrad.addColorStop(0.6, `rgba(${rr2},${rg2},${rb2},${(rimAlpha * 0.4).toFixed(3)})`);
  rimGrad.addColorStop(1.0, `rgba(${rr2},${rg2},${rb2},${rimAlpha.toFixed(3)})`);
  ctx.fillStyle = rimGrad;
  ctx.fillRect(0, 0, size, size);

  ctx.restore();

  // 4. Specular highlight (outside clip, lighter blend)
  const [sr, sg, sb] = hexToRgb(specularColor ?? '#ffffff');
  const specR = r * (0.05 + roughness * 0.40);       // tighter = sharper
  const specPeak = 0.98 - roughness * 0.35;          // dimmer at high roughness
  const specGrad = ctx.createRadialGradient(lx, ly, 0, lx, ly, specR);
  specGrad.addColorStop(0,    `rgba(${sr},${sg},${sb},${specPeak.toFixed(3)})`);
  specGrad.addColorStop(0.3,  `rgba(${sr},${sg},${sb},${(specPeak * 0.75).toFixed(3)})`);
  specGrad.addColorStop(0.65, `rgba(${sr},${sg},${sb},0.20)`);
  specGrad.addColorStop(1.0,  `rgba(${sr},${sg},${sb},0)`);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = specGrad;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  // 5. Alpha fade: clean circular edge
  ctx.globalCompositeOperation = 'destination-in';
  const fadeGrad = ctx.createRadialGradient(C, C, 0, C, C, r * 0.93);
  fadeGrad.addColorStop(0,    'rgba(0,0,0,1)');
  fadeGrad.addColorStop(0.76, 'rgba(0,0,0,1)');
  fadeGrad.addColorStop(1.0,  'rgba(0,0,0,0)');
  ctx.fillStyle = fadeGrad;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
}

// ── 4-pass Particle Illusion–style glowing light source dot ──────────────────
function renderSoftDot(off: HTMLCanvasElement, layer: ParticleLayer, r: number): void {
  const ctx = off.getContext('2d')!;
  const size = off.width;
  const C = size / 2;
  const ox = C + (layer.offsetX / 100) * size;
  const oy = C + (layer.offsetY / 100) * size;
  const [cr, cg, cb] = hexToRgb(layer.color1);
  const lr = Math.min(255, cr + 70), lg = Math.min(255, cg + 70), lb = Math.min(255, cb + 70);
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  // Pass 1: ultra-wide ambient halo (~200% r)
  const halo = ctx.createRadialGradient(ox, oy, 0, ox, oy, r * 2.0);
  halo.addColorStop(0,   `rgba(${cr},${cg},${cb},0.14)`);
  halo.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.06)`);
  halo.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = halo; ctx.fillRect(0, 0, size, size);
  // Pass 2: outer colour glow (~100% r)
  const outerG = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
  outerG.addColorStop(0,    `rgba(${cr},${cg},${cb},0.82)`);
  outerG.addColorStop(0.50, `rgba(${cr},${cg},${cb},0.62)`);
  outerG.addColorStop(0.80, `rgba(${cr},${cg},${cb},0.22)`);
  outerG.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = outerG; ctx.fillRect(0, 0, size, size);
  // Pass 3: inner bright zone (~44% r) — lightened colour
  const innerG = ctx.createRadialGradient(ox, oy, 0, ox, oy, r * 0.44);
  innerG.addColorStop(0,    `rgba(${lr},${lg},${lb},1)`);
  innerG.addColorStop(0.50, `rgba(${cr},${cg},${cb},0.88)`);
  innerG.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = innerG; ctx.fillRect(0, 0, size, size);
  // Pass 4: white-hot core (~14% r)
  const core = ctx.createRadialGradient(ox, oy, 0, ox, oy, r * 0.14);
  core.addColorStop(0,    `rgba(255,255,255,1)`);
  core.addColorStop(0.55, `rgba(255,255,255,0.92)`);
  core.addColorStop(1,    `rgba(255,255,255,0)`);
  ctx.fillStyle = core; ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

// ── Lens diffraction spikes — pure cross-hair / star glint, no body ──────────
function renderGlint(off: HTMLCanvasElement, layer: ParticleLayer, r: number, rotOverride?: number): void {
  const ctx = off.getContext('2d')!;
  const size = off.width;
  const C = size / 2;
  const ox = C + (layer.offsetX / 100) * size;
  const oy = C + (layer.offsetY / 100) * size;
  const [cr, cg, cb] = hexToRgb(layer.color1);
  const arms = Math.max(2, Math.round(layer.points));
  const len = r * 2.0;
  const w   = Math.max(1.2, r * 0.032);
  const fw  = w * 4.5;
  const rotRad = ((rotOverride ?? layer.rotation) * Math.PI) / 180;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(rotRad);
  ctx.globalAlpha = layer.opacity;
  for (let i = 0; i < arms; i++) {
    const ang = (i * Math.PI) / arms;
    const sg = ctx.createLinearGradient(-len, 0, len, 0);
    sg.addColorStop(0,    `rgba(${cr},${cg},${cb},0)`);
    sg.addColorStop(0.28, `rgba(${cr},${cg},${cb},0.42)`);
    sg.addColorStop(0.46, `rgba(255,255,255,0.88)`);
    sg.addColorStop(0.50, `rgba(255,255,255,1)`);
    sg.addColorStop(0.54, `rgba(255,255,255,0.88)`);
    sg.addColorStop(0.72, `rgba(${cr},${cg},${cb},0.42)`);
    sg.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
    ctx.save();
    ctx.rotate(ang);
    // sharp core streak
    ctx.fillStyle = sg;
    ctx.fillRect(-len, -w, len * 2, w * 2);
    // wide soft feather
    ctx.globalAlpha = layer.opacity * 0.22;
    ctx.fillRect(-len * 0.85, -fw, len * 1.70, fw * 2);
    ctx.restore();
  }
  // white-hot centre point
  ctx.globalAlpha = layer.opacity;
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.11);
  core.addColorStop(0, `rgba(255,255,255,1)`);
  core.addColorStop(1, `rgba(255,255,255,0)`);
  ctx.fillStyle = core;
  ctx.fillRect(-r * 0.11, -r * 0.11, r * 0.22, r * 0.22);
  ctx.restore();
}

// ── Soap-bubble / glass sphere — transparent with rim light + dual specular ───
function renderBubble(off: HTMLCanvasElement, layer: ParticleLayer, r: number): void {
  const ctx = off.getContext('2d')!;
  const size = off.width;
  const C = size / 2;
  const ox = C + (layer.offsetX / 100) * size;
  const oy = C + (layer.offsetY / 100) * size;
  const [cr, cg, cb] = hexToRgb(layer.color1);
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  // Faint interior tint
  ctx.beginPath();
  ctx.arc(ox, oy, r, 0, Math.PI * 2);
  const body = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
  body.addColorStop(0,   `rgba(${cr},${cg},${cb},0.03)`);
  body.addColorStop(0.7, `rgba(${cr},${cg},${cb},0.06)`);
  body.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = body; ctx.fill();
  // Rim light
  const rim = ctx.createRadialGradient(ox, oy, r * 0.68, ox, oy, r * 1.05);
  rim.addColorStop(0,    `rgba(${cr},${cg},${cb},0)`);
  rim.addColorStop(0.50, `rgba(${cr},${cg},${cb},0.38)`);
  rim.addColorStop(0.82, `rgba(${cr},${cg},${cb},0.72)`);
  rim.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
  ctx.beginPath(); ctx.arc(ox, oy, r * 1.05, 0, Math.PI * 2);
  ctx.fillStyle = rim; ctx.fill();
  // Primary specular (top-left)
  const sx = ox - r * 0.30, sy = oy - r * 0.34;
  const spec = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.26);
  spec.addColorStop(0,    `rgba(255,255,255,0.95)`);
  spec.addColorStop(0.40, `rgba(255,255,255,0.55)`);
  spec.addColorStop(1,    `rgba(255,255,255,0)`);
  ctx.fillStyle = spec; ctx.fillRect(0, 0, size, size);
  // Secondary env-bounce specular (bottom-right)
  const sx2 = ox + r * 0.38, sy2 = oy + r * 0.42;
  const spec2 = ctx.createRadialGradient(sx2, sy2, 0, sx2, sy2, r * 0.10);
  spec2.addColorStop(0, `rgba(255,255,255,0.48)`);
  spec2.addColorStop(1, `rgba(255,255,255,0)`);
  ctx.fillStyle = spec2; ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

// ── Soft multi-blob nebula / magic cloud ─────────────────────────────────────
function renderNebula(off: HTMLCanvasElement, layer: ParticleLayer, r: number, rotOverride?: number): void {
  const ctx = off.getContext('2d')!;
  const size = off.width;
  const C = size / 2;
  const ox = C + (layer.offsetX / 100) * size;
  const oy = C + (layer.offsetY / 100) * size;
  const [cr, cg, cb] = hexToRgb(layer.color1);
  const [cr2, cg2, cb2] = hexToRgb(layer.color2);
  const rotRad = ((rotOverride ?? layer.rotation) * Math.PI) / 180;
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.translate(ox, oy);
  ctx.rotate(rotRad);
  const half = size / 2;
  const blobCount = 9;
  for (let i = 0; i < blobCount; i++) {
    const ang   = (i / blobCount) * Math.PI * 2 + Math.sin(i * 4.7) * 0.6;
    const dist  = r * (0.15 + Math.abs(Math.sin(i * 7.3)) * 0.55);
    const blobR = r * (0.26 + Math.abs(Math.sin(i * 11.1)) * 0.40);
    const mix   = Math.sin(i * 5.1) * 0.5 + 0.5;
    const br    = Math.round(cr  + (cr2  - cr)  * mix);
    const bg_c  = Math.round(cg  + (cg2  - cg)  * mix);
    const bb_c  = Math.round(cb  + (cb2  - cb)  * mix);
    const bx = Math.cos(ang) * dist, by = Math.sin(ang) * dist;
    const bg = ctx.createRadialGradient(bx, by, 0, bx, by, blobR);
    bg.addColorStop(0,    `rgba(${br},${bg_c},${bb_c},0.55)`);
    bg.addColorStop(0.55, `rgba(${br},${bg_c},${bb_c},0.22)`);
    bg.addColorStop(1,    `rgba(${br},${bg_c},${bb_c},0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = bg; ctx.fillRect(-half, -half, size, size);
  }
  // Bright white core
  ctx.globalCompositeOperation = 'lighter';
  const cgg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.20);
  cgg.addColorStop(0,    `rgba(255,255,255,0.72)`);
  cgg.addColorStop(0.50, `rgba(${cr},${cg},${cb},0.55)`);
  cgg.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = cgg; ctx.fillRect(-half, -half, size, size);
  ctx.restore();
}

// ── Anamorphic lens streak / bokeh streak ─────────────────────────────────────
function renderAnamorphicStreak(off: HTMLCanvasElement, layer: ParticleLayer, r: number, rotOverride?: number): void {
  const ctx = off.getContext('2d')!;
  const size = off.width;
  const C = size / 2;
  const ox = C + (layer.offsetX / 100) * size;
  const oy = C + (layer.offsetY / 100) * size;
  const [cr, cg, cb] = hexToRgb(layer.color1);
  const len = r * 2.5;
  const h   = Math.max(1.2, r * 0.040);
  const rotRad = ((rotOverride ?? layer.rotation) * Math.PI) / 180;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(rotRad);
  // Streak gradient: bright white centre, colour tips, transparent ends
  const sg = ctx.createLinearGradient(-len, 0, len, 0);
  sg.addColorStop(0,    `rgba(${cr},${cg},${cb},0)`);
  sg.addColorStop(0.18, `rgba(${cr},${cg},${cb},0.30)`);
  sg.addColorStop(0.42, `rgba(${cr},${cg},${cb},0.72)`);
  sg.addColorStop(0.50, `rgba(255,255,255,1)`);
  sg.addColorStop(0.58, `rgba(${cr},${cg},${cb},0.72)`);
  sg.addColorStop(0.82, `rgba(${cr},${cg},${cb},0.30)`);
  sg.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
  // 3 vertical passes: sharp core + mid halo + wide diffusion
  for (const [hScale, alpha] of [[1.0, 1.0], [3.2, 0.32], [10.0, 0.10]] as [number, number][]) {
    ctx.globalAlpha = layer.opacity * alpha;
    ctx.fillStyle = sg;
    ctx.fillRect(-len, -h * hScale, len * 2, h * hScale * 2);
  }
  // Bright central point
  ctx.globalAlpha = layer.opacity;
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.09);
  core.addColorStop(0, `rgba(255,255,255,1)`);
  core.addColorStop(1, `rgba(255,255,255,0)`);
  ctx.fillStyle = core;
  ctx.fillRect(-r * 0.09, -r * 0.09, r * 0.18, r * 0.18);
  ctx.restore();
}

// Render a single layer's base shape to an offscreen canvas
function renderLayerToOffscreen(size: number, layer: ParticleLayer, frameT: number, animType: AnimType): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = off.height = size;
  const ctx = off.getContext('2d')!;
  const cx = size / 2;

  // Metallic sphere: fully custom rendering, bypass normal pipeline
  if (layer.type === 'metallic-sphere') {
    let r = (layer.size / 100) * cx;
    if (animType === 'pulse')  r *= 0.5 + 0.5 * Math.sin(frameT * Math.PI * 2);
    if (animType === 'unfold') r *= frameT;
    ctx.save();
    ctx.translate(cx + (layer.offsetX / 100) * size, cx + (layer.offsetY / 100) * size);
    // Render into a temp canvas centred at origin then composite it
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = size;
    const lightAngleMod = layer.lightAngle + (animType === 'spin' ? frameT * 360 : 0);
    renderMetallicSphere(tmp, { ...layer, lightAngle: lightAngleMod }, r);
    let opacityMod = layer.opacity;
    if (animType === 'flicker') opacityMod *= 0.3 + 0.7 * Math.abs(Math.sin(frameT * Math.PI * 7));
    ctx.globalAlpha = opacityMod;
    ctx.drawImage(tmp, -cx, -cx);
    ctx.restore();
    return off;
  }

  // Fully custom renderers — bypass generic gradient pipeline
  if (layer.type === 'soft-dot' || layer.type === 'glint' || layer.type === 'bubble' ||
      layer.type === 'nebula'   || layer.type === 'anamorphic-streak' || layer.type === 'custom-paint' || layer.type === 'image') {
    let r = (layer.size / 100) * cx;
    if (animType === 'pulse')  r *= 0.5 + 0.5 * Math.sin(frameT * Math.PI * 2);
    if (animType === 'unfold') r *= frameT;
    let opacityMod = layer.opacity;
    if (animType === 'flicker') opacityMod *= 0.3 + 0.7 * Math.abs(Math.sin(frameT * Math.PI * 7));
    const rotMod = layer.rotation + (animType === 'spin' ? frameT * 360 : 0);
    const eff = { ...layer, opacity: opacityMod };
    switch (layer.type) {
      case 'soft-dot':          renderSoftDot(off, eff, r);           break;
      case 'glint':             renderGlint(off, eff, r, rotMod);     break;
      case 'bubble':            renderBubble(off, eff, r);            break;
      case 'nebula':            renderNebula(off, eff, r, rotMod);    break;
      case 'anamorphic-streak': renderAnamorphicStreak(off, eff, r, rotMod); break;
      case 'custom-paint':
      case 'image': {
        // Sync render of a pre-loaded image from cache
        const cache = (window as any).__paintedImageCache;
        const img = cache?.[eff.id];
        if (img) {
          ctx.save();
          ctx.translate(cx + (eff.offsetX / 100) * size, cx + (eff.offsetY / 100) * size);
          ctx.rotate((rotMod * Math.PI) / 180);
          ctx.globalAlpha = eff.opacity;
          // Apply color tinting via composite ops
          ctx.drawImage(img, -r, -r, r * 2, r * 2);
          if (eff.fillMode !== 'solid') {
             ctx.globalCompositeOperation = 'source-in';
             ctx.fillStyle = eff.color1;
             ctx.fillRect(-r, -r, r * 2, r * 2);
          }
          ctx.restore();
        } else {
          // If no image cache, try reading straight from painter ref (if we can)
          // Actually, we should trigger a preload elsewhere, but the render string is sync.
          // The component should handle fetching the data string.
        }
        break;
      }
    }
    return off;
  }

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

  // CSS filter is applied as post-processing after all effects (see applyLayerPost)

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

  // Glow — 2-pass (tight definition + wide ambient), like Particle Illusion
  if (layer.glow > 0) {
    const str   = (layer.glow / 100) * 0.92;
    const baseR = Math.max(1, r * layer.glowSize * 0.5);
    for (const [blurPx, alpha] of [
      [baseR * 0.30, str * 0.78],
      [baseR,        str * 0.52],
    ] as [number, number][]) {
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = size;
      const tc = tmp.getContext('2d')!;
      tc.filter = `blur(${blurPx.toFixed(1)}px)`;
      tc.drawImage(base, 0, 0);
      dst.save();
      dst.globalCompositeOperation = 'lighter';
      dst.globalAlpha = alpha;
      dst.drawImage(tmp, 0, 0);
      dst.restore();
    }
  }

  // Bloom — 3-pass multi-radius (tight hot core + mid + wide ambient), like Trapcode Particular
  if (layer.bloom > 0) {
    const str   = layer.bloom / 100;
    const baseR = Math.max(1, r * layer.bloomSize * 0.4);
    for (const [blurPx, briPct, alpha, blend] of [
      [baseR * 0.18, 480, str * 0.88, 'lighter'],  // tight white-hot core
      [baseR,        210, str * 0.62, 'screen' ],  // mid glow
      [baseR * 3.2,  145, str * 0.28, 'screen' ],  // wide ambient bloom
    ] as [number, number, number, GlobalCompositeOperation][]) {
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = size;
      const tc = tmp.getContext('2d')!;
      tc.filter = `blur(${blurPx.toFixed(1)}px) brightness(${briPct}%)`;
      tc.drawImage(base, 0, 0);
      dst.save();
      dst.globalCompositeOperation = blend;
      dst.globalAlpha = alpha;
      dst.drawImage(tmp, 0, 0);
      dst.restore();
    }
  }

  // Star Glow — Trapcode Starglow style
  // Directional accumulation streaks seeded from the existing bright pixels,
  // so the rays grow from the actual luminance of the particle rather than
  // being drawn from scratch.
  if (layer.starGlow > 0) {
    const strength  = layer.starGlow / 100;
    const arms      = Math.max(2, Math.round(layer.starGlowArms));
    const streakLen = r * layer.starGlowLength * 3.2;
    const steps     = 16; // accumulation steps per direction
    const rotOff    = (layer.rotation * Math.PI) / 180;

    // ── Step 1: extract bright/saturated source ──
    // Boost contrast + brightness on a copy so low-luminance areas fade out
    // and only the already-bright regions seed the streaks.
    const bright = document.createElement('canvas');
    bright.width = bright.height = size;
    const bc = bright.getContext('2d')!;
    bc.filter = 'brightness(350%) contrast(500%) saturate(300%)';
    bc.drawImage(base, 0, 0);
    bc.filter = 'none';

    // ── Step 2: per-arm directional accumulation ──
    for (let i = 0; i < arms; i++) {
      const ang = (i * Math.PI) / arms + rotOff;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);

      // Streak canvas for this arm (both +/- directions combined)
      const streak = document.createElement('canvas');
      streak.width = streak.height = size;
      const sc = streak.getContext('2d')!;
      sc.globalCompositeOperation = 'lighter';

      for (const dir of [1, -1] as const) {
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          // Exponential falloff — near-center bright, trailing edge dim
          const alpha = strength * 0.55 * Math.pow(0.80, s - 1) * (1 - t * 0.35);
          sc.globalAlpha = alpha;
          sc.drawImage(bright, cosA * (t * streakLen) * dir, sinA * (t * streakLen) * dir);
        }
      }

      // ── Step 3: soft blur + color tint ──
      const tinted = document.createElement('canvas');
      tinted.width = tinted.height = size;
      const tc = tinted.getContext('2d')!;
      // Blur to smooth the accumulation steps into silky streaks
      const blurPx = Math.max(0.6, r * 0.03).toFixed(1);
      tc.filter = `blur(${blurPx}px)`;
      tc.drawImage(streak, 0, 0);
      tc.filter = 'none';
      // Tint toward glowColor at ~45% — preserves original hue but pushes the color
      tc.globalCompositeOperation = 'source-atop';
      tc.globalAlpha = 0.45;
      tc.fillStyle = layer.glowColor;
      tc.fillRect(0, 0, size, size);

      // ── Step 4: composite onto destination ──
      dst.save();
      dst.globalCompositeOperation = 'lighter';
      dst.globalAlpha = 1;
      dst.drawImage(tinted, 0, 0);
      dst.restore();
    }

    // ── Step 5: center bloom — knits the arm roots together ──
    const cBloom = document.createElement('canvas');
    cBloom.width = cBloom.height = size;
    const cb = cBloom.getContext('2d')!;
    cb.filter = `blur(${Math.max(1, r * 0.18).toFixed(1)}px) brightness(200%)`;
    cb.drawImage(bright, 0, 0);
    cb.filter = 'none';
    dst.save();
    dst.globalCompositeOperation = 'lighter';
    dst.globalAlpha = strength * 0.5;
    dst.drawImage(cBloom, 0, 0);
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

  // ── Metallic sheen overlay (works on any shape type) ──
  if (layer.metalSheen > 0) {
    const sheenStrength = layer.metalSheen / 100;
    const lightRad = ((layer.lightAngle ?? 315) * Math.PI) / 180;
    const ox = cx + (layer.offsetX / 100) * size;
    const oy = cx + (layer.offsetY / 100) * size;
    // Highlight and specular positions offset toward light direction
    const lx = ox + Math.cos(lightRad) * r * 0.30;
    const ly = oy - Math.sin(lightRad) * r * 0.30;

    const [sr, sg, sb] = hexToRgb(layer.specularColor ?? '#ffffff');

    const metal = document.createElement('canvas');
    metal.width = metal.height = size;
    const mc = metal.getContext('2d')!;

    // Reflection band: fully transparent at both ends, bright stripe on lit side
    // No dark regions – pure additive so no colour cast
    const bx0 = ox - Math.cos(lightRad) * r;
    const by0 = oy + Math.sin(lightRad) * r;
    const bx1 = ox + Math.cos(lightRad) * r;
    const by1 = oy - Math.sin(lightRad) * r;
    const bandGrad = mc.createLinearGradient(bx0, by0, bx1, by1);
    bandGrad.addColorStop(0,    `rgba(${sr},${sg},${sb},0)`);
    bandGrad.addColorStop(0.38, `rgba(${sr},${sg},${sb},0.12)`);
    bandGrad.addColorStop(0.55, `rgba(${sr},${sg},${sb},0.65)`);
    bandGrad.addColorStop(0.68, `rgba(${sr},${sg},${sb},0.18)`);
    bandGrad.addColorStop(1.0,  `rgba(${sr},${sg},${sb},0)`);
    mc.fillStyle = bandGrad;
    mc.fillRect(0, 0, size, size);

    // Tight specular spot (additive on top of band)
    const specR = r * 0.32;
    const specGrad = mc.createRadialGradient(lx, ly, 0, lx, ly, specR);
    specGrad.addColorStop(0,    `rgba(255,255,255,0.90)`);
    specGrad.addColorStop(0.25, `rgba(${sr},${sg},${sb},0.55)`);
    specGrad.addColorStop(0.65, `rgba(${sr},${sg},${sb},0.10)`);
    specGrad.addColorStop(1.0,  `rgba(${sr},${sg},${sb},0)`);
    mc.globalCompositeOperation = 'lighter';
    mc.fillStyle = specGrad;
    mc.fillRect(0, 0, size, size);
    mc.globalCompositeOperation = 'source-over';

    // Clip metallic gradient to existing shape pixels
    mc.globalCompositeOperation = 'destination-in';
    mc.drawImage(base, 0, 0);
    mc.globalCompositeOperation = 'source-over';

    // Composite onto destination – lighter (additive), no colour cast
    dst.save();
    dst.globalCompositeOperation = 'lighter';
    dst.globalAlpha = sheenStrength * 0.75;
    dst.drawImage(metal, 0, 0);
    dst.restore();
  }
}

// Post-process a finished per-layer canvas: CSS filters + luminance threshold
// Applied AFTER all effects (metallic sheen, glow, bloom) so filters act on the full composite
function applyLayerPost(
  canvas: HTMLCanvasElement,
  layer: ParticleLayer,
  frameT: number,
  animType: AnimType,
): void {
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width;
  const animatedLayer = animType === 'color-cycle'
    ? { ...layer, hueShift: (layer.hueShift + frameT * 360) % 360 }
    : layer;

  // Apply CSS filter (blur, saturate, contrast, brightness, hue-rotate)
  const fstr = buildCssFilter(animatedLayer);
  if (fstr !== 'none') {
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = size;
    const tc = tmp.getContext('2d')!;
    tc.filter = fstr;
    tc.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(tmp, 0, 0);
  }

  // Luminance threshold — removes dim pixels and makes bright areas pop
  // Mimics the threshold slider in the 3D asset creator / Animator3D
  if (animatedLayer.filterThreshold > 0) {
    const t = (animatedLayer.filterThreshold / 100) * 255;
    const spread = Math.max(6, t * 0.28); // soft falloff ~28% of threshold value
    const imageData = ctx.getImageData(0, 0, size, size);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const factor = Math.max(0, Math.min(1, (luma - t + spread) / spread));
      d[i + 3] = Math.round(d[i + 3] * factor);
    }
    ctx.putImageData(imageData, 0, 0);
  }
}

// Render all layers + effects for one animation frame
// Each layer is composited to its own temp canvas so CSS filter + threshold
// are applied AFTER metallic sheen and all additive effects.
export function renderFrame(
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
    // 1. Base shape (no CSS filter here — applied in post step below)
    const base = renderLayerToOffscreen(size, layer, frameT, animType);
    // 2. Per-layer composite: base + glow/bloom/sheen on a fresh canvas
    const layerComp = document.createElement('canvas');
    layerComp.width = layerComp.height = size;
    const lc = layerComp.getContext('2d')!;
    lc.drawImage(base, 0, 0);
    applyLayerEffects(lc, base, layer, size, frameT, animType);
    // 3. Post-process: CSS filter + threshold applied AFTER metallic sheen
    applyLayerPost(layerComp, layer, frameT, animType);
    // 4. Blend finished layer onto the main canvas
    ctx.save();
    ctx.globalCompositeOperation = blendMap[layer.blend] ?? 'source-over';
    ctx.drawImage(layerComp, 0, 0);
    ctx.restore();
  }
}

// ─── Shape palette ────────────────────────────────────────────────────────────

const SHAPES: { type: ShapeType; label: string }[] = [
  { type: 'soft-dot',          label: '✦ Soft Dot'        },
  { type: 'glint',             label: '✤ Glint'            },
  { type: 'bubble',            label: '◎ Bubble'           },
  { type: 'nebula',            label: '❋ Nebula'           },
  { type: 'anamorphic-streak', label: '— Streak'           },
  { type: 'circle',            label: '⬤ Circle'           },
  { type: 'ring',              label: '◯ Ring'             },
  { type: 'star',              label: '★ Star'             },
  { type: 'polygon',           label: '⬡ Polygon'          },
  { type: 'diamond',           label: '◆ Diamond'          },
  { type: 'spark',             label: '— Spark'            },
  { type: 'cross',             label: '✛ Cross'            },
  { type: 'smoke',             label: '☁ Smoke'            },
  { type: 'metallic-sphere',   label: '● Metal Sphere'     },
  { type: 'custom-paint',      label: '🖌️ Painted Shape'  },
  { type: 'image',             label: '🖼️ Load Image'     },
];

// ─── Component ───────────────────────────────────────────────────────────────

// ─── Presets ─────────────────────────────────────────────────────────────────

type ParticlePreset = {
  id: string;
  name: string;
  layers: ParticleLayer[];
  canvasSize: 128 | 256 | 512;
  anim: AnimConfig;
  thumbnail: string; // data URL
};

const PRESET_KEY = 'vertebrae_particle_presets';

const loadStoredPresets = (): ParticlePreset[] => {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]'); }
  catch { return []; }
};

const saveStoredPresets = (presets: ParticlePreset[]) => {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
};

type Props = {
  onExport:         (dataUrl: string, name: string) => void;
  onExportSequence: (dataUrls: string[], name: string, fps: number) => void;
  onClose:          () => void;
  visible?:         boolean;
  particleCameraState?: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null;
};

export const ParticleCreator: React.FC<Props> = ({ onExport, onExportSequence, onClose, visible = true, particleCameraState }) => {
  const [layers,       setLayers      ] = useState<ParticleLayer[]>([defaultLayer('soft-dot')]);
  const [selectedId,   setSelectedId  ] = useState<string>(() => layers[0]?.id ?? '');
  const [canvasSize,   setCanvasSize  ] = useState<128 | 256 | 512>(256);
  const [previewBg,    setPreviewBg   ] = useState<'transparent' | 'black' | 'grey'>('black');
  const [presets,      setPresets     ] = useState<ParticlePreset[]>(loadStoredPresets);
  const [presetName,   setPresetName  ] = useState('');
  const [anim,         setAnim        ] = useState<AnimConfig>(defaultAnim);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [playing,      setPlaying     ] = useState(false);
  const [creatorMode,  setCreatorMode ] = useState<'shape' | 'paint' | 'fire'>('shape');
  const painterGetUrlRef = useRef<(() => string) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const addLayer = useCallback((type: ShapeType, optUrl?: string) => {
    const nl = defaultLayer(type);

    if (type === 'custom-paint' && painterGetUrlRef.current) {
        const url = painterGetUrlRef.current();
        if (url) {
            nl.customImageDataUrl = url;
            // Eagerly insert the image into cache to avoid async loading issues on first frame
            const img = new Image();
            img.src = url;
            if (!(window as any).__paintedImageCache) (window as any).__paintedImageCache = {};
            (window as any).__paintedImageCache[nl.id] = img;
        }
    } else if (type === 'image' && optUrl) {
      nl.customImageDataUrl = optUrl;
      const img = new Image();
      img.src = optUrl;
      if (!(window as any).__paintedImageCache) (window as any).__paintedImageCache = {};
      (window as any).__paintedImageCache[nl.id] = img;
    }

    setLayers(prev => [...prev, nl]);
    setSelectedId(nl.id);
  }, []);

  const handleImageLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        addLayer('image', reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset input
  }, [addLayer]);
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

  // Sync cache when layer gets updated or deleted
  useEffect(() => {
    return () => {
       // Cleanup cache on unmount
       // (window as any).__paintedImageCache = {}; 
    };
  }, []);

  const handleExport = useCallback(() => {
    if (creatorMode === 'paint') {
      const dataUrl = painterGetUrlRef.current?.() ?? '';
      if (dataUrl) onExport(dataUrl, 'painted_particle');
      return;
    }
    const c = document.createElement('canvas');
    c.width = c.height = canvasSize;
    renderFrame(c, layers, 0, 'none');
    onExport(c.toDataURL('image/png'), `particle_${layers.map(l => l.type).join('+')}`);
  }, [creatorMode, layers, canvasSize, onExport]);

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

  const makeThumbnail = useCallback((): string => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    renderFrame(c, layers, 0, 'none');
    return c.toDataURL('image/png');
  }, [layers]);

  const handleSavePreset = useCallback(() => {
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const preset: ParticlePreset = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      layers: JSON.parse(JSON.stringify(layers)),
      canvasSize,
      anim: { ...anim },
      thumbnail: makeThumbnail(),
    };
    const updated = [...presets, preset];
    setPresets(updated);
    saveStoredPresets(updated);
    setPresetName('');
  }, [presetName, presets, layers, canvasSize, anim, makeThumbnail]);

  const handleLoadPreset = useCallback((preset: ParticlePreset) => {
    // Give each layer a fresh id to avoid key collisions
    const fresh = preset.layers.map(l => ({ ...l, id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }));
    setLayers(fresh);
    setSelectedId(fresh[0]?.id ?? '');
    setCanvasSize(preset.canvasSize);
    setAnim(preset.anim);
    setPlaying(false);
    setPreviewFrame(0);
  }, []);

  const handleDeletePreset = useCallback((id: string) => {
    const updated = presets.filter(p => p.id !== id);
    setPresets(updated);
    saveStoredPresets(updated);
  }, [presets]);

  const handleRenamePreset = useCallback((id: string, newName: string) => {
    const updated = presets.map(p => p.id === id ? { ...p, name: newName } : p);
    setPresets(updated);
    saveStoredPresets(updated);
  }, [presets]);

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
  const sec = (title: string, defaultOpen: boolean, children: React.ReactNode) => (
    <details open={defaultOpen} style={{ marginTop: '0', borderTop: '1px solid #3b455c' }}>
      <summary style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#4f6ef7', padding: '7px 2px', cursor: 'pointer', userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}>▸ {title}</summary>
      <div style={{ paddingBottom: '8px' }}>{children}</div>
    </details>
  );
  const bgBg: Record<typeof previewBg, string> = {
    transparent: 'repeating-conic-gradient(#444 0% 25%, #333 0% 50%) 0 0 / 16px 16px',
    black: '#000', grey: '#555',
  };
  const thumbs = [40, 24, 12, 6].map(sz => {
    const c = document.createElement('canvas');
    c.width = c.height = sz;
    const ft = anim.type === 'none' ? 0 : previewFrame / Math.max(1, anim.frames - 1);
    renderFrame(c, layers, ft, anim.type);
    return { sz, url: c.toDataURL() };
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1a2035', border: '1px solid #3b455c', borderRadius: '10px', width: '850px', maxWidth: '95vw', height: '85vh', maxHeight: '800px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}>

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
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0, flexDirection: 'column' }}>

          {/* Mode tabs */}
          <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #3b455c' }}>
            {(['shape', 'paint', 'fire'] as const).map(m => (
              <button key={m} type="button" onClick={() => setCreatorMode(m)}
                style={{ flex: 1, background: creatorMode === m ? '#252f45' : 'transparent', border: 'none', borderBottom: creatorMode === m ? '2px solid #4f6ef7' : '2px solid transparent', color: creatorMode === m ? '#c8d0e0' : '#5a6a82', padding: '6px 0', cursor: 'pointer', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                {m === 'shape' ? '✨ Shape Designer' : m === 'paint' ? '🎨 Paint' : '🔥 Fire Generator'}
              </button>
            ))}
          </div>

          {creatorMode === 'paint' && (
             <div style={{ padding: '8px 14px', background: '#1a4a6a', borderBottom: '1px solid #3b455c', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <div style={{ fontSize: '0.72rem', color: '#a9d4ff' }}>Draw a shape below, then use it as a layer.</div>
               <button type="button" onClick={() => { addLayer('custom-paint'); setCreatorMode('shape'); }} style={{ background: '#3a7fd4', border: 'none', borderRadius: '4px', color: '#fff', padding: '4px 8px', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 'bold' }}>Add to Designer ↗</button>
             </div>
          )}

          {creatorMode === 'shape' && (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* LEFT: shape palette + layer list */}
          <div style={{ width: '158px', borderRight: '1px solid #3b455c', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ padding: '8px', borderBottom: '1px solid #3b455c', overflowY: 'auto', maxHeight: '220px', flexShrink: 0 }}>
              <div style={{ fontSize: '0.7rem', color: '#8a93a2', marginBottom: '4px', textTransform: 'uppercase' }}>Add Shape</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' }}>
                {SHAPES.map(s => {
                  if (s.type === 'image') {
                    return (
                      <button key={s.type} type="button" onClick={() => fileInputRef.current?.click()}
                        style={{ background: '#1a4a6a', border: '1px dashed #4f6ef7', borderRadius: '4px', color: '#a0b0ff', padding: '4px 3px', cursor: 'pointer', fontSize: '0.68rem', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', gridColumn: 'span 2', marginTop: '2px' }}>
                        {s.label}
                      </button>
                    );
                  }
                  return (
                    <button key={s.type} type="button" onClick={() => addLayer(s.type)}
                      style={{ background: '#252f45', border: '1px solid #3b455c', borderRadius: '4px', color: '#c8d0e0', padding: '4px 3px', cursor: 'pointer', fontSize: '0.68rem', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px', minHeight: 0 }}>
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
              <div style={{ fontSize: '0.78rem', color: '#8a93a2', marginBottom: '6px', textTransform: 'uppercase' }}>
                Layer — {SHAPES.find(s => s.type === selectedLayer.type)?.label}
              </div>

              {sec('Fill', true, <>
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
              </>)}

              {sec('Shape', true, <>
                {numSlider('size', 1, 100, 1, 'Size', v => `${v}%`)}
                {(selectedLayer.type === 'soft-dot' || selectedLayer.type === 'circle') && numSlider('hardness', 0, 100, 1, 'Hardness', v => `${v}%`)}
                {selectedLayer.type === 'ring' && numSlider('innerRadius', 0.05, 0.95, 0.01, 'Inner Radius', v => `${(v*100).toFixed(0)}%`)}
                {selectedLayer.type === 'star' && <>{numSlider('points', 3, 12, 1, 'Points', v => `${Math.round(v)}`)}{numSlider('innerRadius', 0.05, 0.95, 0.01, 'Inner Radius', v => `${(v*100).toFixed(0)}%`)}</>}
                {selectedLayer.type === 'polygon' && numSlider('points', 3, 12, 1, 'Sides', v => `${Math.round(v)}`)}
                {selectedLayer.type === 'glint' && numSlider('points', 2, 8, 1, 'Spike Arms', v => `${Math.round(v)}`)}
              </>)}

              {sec('Transform', true, <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>{numSlider('offsetX', -50, 50, 0.5, 'Offset X', v => `${v.toFixed(1)}`)}</div>
                  <div>{numSlider('offsetY', -50, 50, 0.5, 'Offset Y', v => `${v.toFixed(1)}`)}</div>
                </div>
                {numSlider('rotation', 0, 360, 1, 'Rotation', v => `${v.toFixed(0)}°`)}
              </>)}

              {sec('Blend & Opacity', true, <>
                {numSlider('opacity', 0, 1, 0.01, 'Opacity', v => `${(v*100).toFixed(0)}%`)}
                {selectInput('Blend Mode', selectedLayer.blend,
                  [['normal','Normal'],['add','Additive (Glow)'],['screen','Screen'],['multiply','Multiply']],
                  v => updateLayer(selectedLayer.id, { blend: v as LayerBlend }))}
              </>)}

              {sec('Filters', false, <>
                {numSlider('blur',            0,   60, 0.5, 'Blur / Softness',           v => `${v.toFixed(1)}px`)}
                {numSlider('saturate',        0,  800,   1, 'Saturate',                  v => `${v}%`)}
                {numSlider('contrast',        0,  600,   1, 'Contrast',                  v => `${v}%`)}
                {numSlider('brightness',      0,  600,   1, 'Brightness',                v => `${v}%`)}
                {numSlider('hueShift',        0,  360,   1, 'Hue Shift',                 v => `${v.toFixed(0)}°`)}
                {numSlider('filterThreshold', 0,  100,   1, 'Threshold — cut dim pixels', v => `${v}%`)}
              </>)}

              {sec('Glow', false, <>
                {numSlider('glow',     0, 100, 1,   'Glow Strength',  v => `${v}%`)}
                {numSlider('glowSize', 0.5, 8, 0.1, 'Glow Radius',    v => `×${v.toFixed(1)}`)}
                {row('Glow / Effect Colour', (
                  <input type="color" value={selectedLayer.glowColor} onChange={e => updateLayer(selectedLayer.id, { glowColor: e.target.value })} style={{ width: '100%', height: '30px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
                ))}
              </>)}

              {sec('Bloom', false, <>
                {numSlider('bloom',     0, 100,  1,   'Bloom Strength', v => `${v}%`)}
                {numSlider('bloomSize', 0.5, 10, 0.1, 'Bloom Radius',   v => `×${v.toFixed(1)}`)}
              </>)}

              {sec('Star Glow', false, <>
                {numSlider('starGlow',       0, 100,  1,    'Star Glow',     v => `${v}%`)}
                {numSlider('starGlowArms',   2, 8,    1,    'Arms',          v => `${Math.round(v)}`)}
                {numSlider('starGlowLength', 0.2, 3,  0.05, 'Streak Length', v => `×${v.toFixed(2)}`)}
              </>)}

              {sec('Glitter', false, <>
                {numSlider('glitter',     0, 100, 1,   'Glitter Density',  v => `${v}%`)}
                {numSlider('glitterSize', 0.5, 5, 0.1, 'Glitter Dot Size', v => `${v.toFixed(1)}px`)}
              </>)}

              {sec('Chromatic Aberration', false, <>
                {numSlider('ca', 0, 20, 0.5, 'CA Shift', v => `${v.toFixed(1)}px`)}
              </>)}

              {sec('Metallic', false, <>
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '0.78rem', color: '#8a93a2', marginBottom: '5px' }}>Presets</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' }}>
                    {METAL_PRESETS.map(p => (
                      <button key={p.id} type="button"
                        onClick={() => updateLayer(selectedLayer.id, {
                          color1: p.color1,
                          specularColor: p.specularColor,
                          metalSheen: p.metalSheen,
                          lightAngle: p.lightAngle,
                        })}
                        style={{ background: '#252f45', border: '1px solid #3b455c', borderRadius: '4px', color: '#c8d0e0', padding: '3px 4px', cursor: 'pointer', fontSize: '0.66rem', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.label}
                      </button>
                    ))}
                    <button type="button"
                      onClick={() => updateLayer(selectedLayer.id, { metalSheen: 0 })}
                      style={{ background: '#1e2840', border: '1px solid #3b455c', borderRadius: '4px', color: '#8a93a2', padding: '3px 4px', cursor: 'pointer', fontSize: '0.66rem', textAlign: 'left' }}>
                      ✕ None
                    </button>
                  </div>
                </div>
                {selectedLayer.type !== 'metallic-sphere' && numSlider('metalSheen', 0, 100, 1, 'Sheen Strength', v => `${v}%`)}
                {row('Specular Colour', (
                  <input type="color" value={selectedLayer.specularColor ?? '#ffffff'} onChange={e => updateLayer(selectedLayer.id, { specularColor: e.target.value })} style={{ width: '100%', height: '30px', border: '1px solid #3b455c', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
                ))}
                {numSlider('lightAngle', 0, 360, 1, 'Light Angle', v => `${v.toFixed(0)}°`)}
                {selectedLayer.type === 'metallic-sphere' && (<>
                  {numSlider('metalness', 0, 1, 0.01, 'Metalness', v => `${(v*100).toFixed(0)}%`)}
                  {numSlider('roughness', 0, 1, 0.01, 'Roughness', v => `${(v*100).toFixed(0)}%`)}
                </>)}
              </>)}

            </>) : (
              <p style={{ color: '#555', textAlign: 'center', marginTop: '40px' }}>Select a layer to edit it.</p>
            )}
          </div>

          {/* RIGHT: preview + animation */}
          <div style={{ width: '260px', borderLeft: '1px solid #3b455c', display: 'block', padding: '10px', overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ fontSize: '0.7rem', color: '#8a93a2', marginBottom: '5px', textTransform: 'uppercase' }}>Preview</div>

            <div style={{ width: '100%', aspectRatio: '1 / 1', alignSelf: 'center', background: previewBg !== 'transparent' ? bgBg[previewBg] : undefined, backgroundImage: previewBg === 'transparent' ? bgBg.transparent : undefined, borderRadius: '8px', border: '1px solid #3b455c', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
              <canvas ref={mainCanvasRef} width={256} height={256} style={{ width: '100%', height: '100%' }} />
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
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '0.7rem', color: '#8a93a2', marginBottom: '4px', textTransform: 'uppercase' }}>At particle sizes</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', background: '#0a0d18', borderRadius: '6px', padding: '8px' }}>
                {thumbs.map(({ sz, url }) => (
                  <div key={sz} style={{ textAlign: 'center' }}>
                    <img src={url} width={sz} height={sz} style={{ imageRendering: sz <= 8 ? 'pixelated' : 'auto', display: 'block' }} />
                    <span style={{ fontSize: '0.6rem', color: '#555' }}>{sz}px</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Animation config */}
            <div style={{ marginTop: '10px', borderTop: '1px solid #3b455c', paddingTop: '8px' }}>
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

            <hr style={{ width: '100%', borderColor: '#3b455c', margin: '8px 0' }} />

            <button type="button" onClick={handleExport}
              style={{ width: '100%', background: '#4f6ef7', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem', marginBottom: '5px' }}>
              Use Still as Sprite ↗
            </button>
            {anim.type !== 'none' && (
              <button type="button" onClick={handleExportAnim}
                style={{ width: '100%', background: '#27ae60', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem', marginBottom: '5px' }}>
                Use Animated Sequence ↗
              </button>
            )}
            <button type="button" onClick={handleDownloadSheet}
              style={{ width: '100%', background: 'transparent', color: '#8a93a2', border: '1px solid #3b455c', borderRadius: '6px', padding: '6px', cursor: 'pointer', fontSize: '0.78rem' }}>
              Download {anim.type !== 'none' ? 'Sprite Sheet' : 'PNG'}
            </button>

            {/* ── Presets ── */}
            <div style={{ marginTop: '10px', borderTop: '1px solid #3b455c', paddingTop: '8px' }}>
              <div style={{ fontSize: '0.7rem', color: '#4f6ef7', textTransform: 'uppercase', marginBottom: '8px' }}>Presets</div>

              {/* Save row */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                <input
                  type="text"
                  placeholder="Preset name…"
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); }}
                  style={{ flex: 1, background: '#252f45', color: '#e2e8f0', border: '1px solid #3b455c', borderRadius: '4px', padding: '4px 6px', fontSize: '0.75rem', minWidth: 0 }}
                />
                <button type="button" onClick={handleSavePreset}
                  style={{ background: '#4f6ef7', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                  💾 Save
                </button>
              </div>

              {/* Preset list */}
              {presets.length === 0 && (
                <p style={{ color: '#555', fontSize: '0.72rem', textAlign: 'center', margin: '10px 0' }}>No presets saved yet.</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {presets.map(preset => (
                  <div key={preset.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#1e2840', border: '1px solid #3b455c', borderRadius: '5px', padding: '4px 6px' }}>
                    {/* Thumbnail */}
                    <img src={preset.thumbnail} width={28} height={28}
                      style={{ borderRadius: '3px', border: '1px solid #3b455c', flexShrink: 0, imageRendering: 'auto', background: '#000' }} />
                    {/* Editable name */}
                    <input
                      type="text"
                      value={preset.name}
                      onChange={e => handleRenamePreset(preset.id, e.target.value)}
                      style={{ flex: 1, background: 'transparent', color: '#c8d0e0', border: 'none', fontSize: '0.73rem', minWidth: 0, outline: 'none' }}
                    />
                    {/* Load */}
                    <button type="button" onClick={() => handleLoadPreset(preset)}
                      title="Load"
                      style={{ background: '#27ae60', color: '#fff', border: 'none', borderRadius: '3px', padding: '2px 6px', cursor: 'pointer', fontSize: '0.68rem', flexShrink: 0 }}>
                      ↩
                    </button>
                    {/* Delete */}
                    <button type="button" onClick={() => handleDeletePreset(preset.id)}
                      title="Delete"
                      style={{ background: 'none', color: '#e05050', border: '1px solid #e05050', borderRadius: '3px', padding: '2px 5px', cursor: 'pointer', fontSize: '0.68rem', flexShrink: 0 }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
            </div>
          )}

          {creatorMode === 'paint' && (
            <CustomParticlePainter
              embedded
              visible={true}
              emitters={[]}
              onInjectToEmitter={() => {}}
              onClose={() => {}}
              onReady={(fn) => { painterGetUrlRef.current = fn; }}
            />
          )}

          {creatorMode === 'fire' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: '300px' }}>
              <FireGenerator
                particleCameraState={particleCameraState}
                embeddedUI
                autoRenderOnChange
                onAttachToEmitter={(urls) => {
                  onExportSequence(urls, 'fire', 24);
                }}
                onExportToParticleSystem={(urls, fps) => {
                  onExportSequence(urls, 'fire', fps);
                }}
              />
            </div>
          )}
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/png, image/jpeg, image/webp" style={{ display: 'none' }} onChange={handleImageLoad} />
    </div>
  );
};

export default ParticleCreator;
