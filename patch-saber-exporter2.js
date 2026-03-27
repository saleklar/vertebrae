const fs = require('fs');
const content = `/**
 * SaberExporter.ts – Spine 4.2.x bone-chain + region attachment export
 *
 * Each bone covers one curve segment. A REGION attachment (not a mesh) sits
 * on each bone, centered at the bone's midpoint, and stretches to cover the
 * full segment length.  Because the bone is already rotated to the correct
 * direction, the region follows the curve with no extra math.
 *
 * Region attachments support Spine sequences, so a sprite-sheet of 8 frames
 * is packed and played back automatically for a shimmer effect.  Per-slot
 * RGBA keyframes add a travelling ripple wave on top.
 *
 * pathPoints3D is expected to be in screen-space 2D (already projected by
 * the caller via THREE.Vector3.project(camera)).
 */

import * as THREE from 'three';
import JSZip from 'jszip';

export interface SaberSpineExportOpts {
  name?: string;
  coreColor?: string;
  glowColor?: string;
  /** Beam height in screen-space pixels (same units as projected path pts) */
  glowWidth?: number;
  glowFalloff?: number;
  noiseAnimated?: boolean;
  noiseSpeed?: number;
  animDuration?: number;
  fps?: number;
  maxBones?: number;
  seqFrames?: number;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const m = /^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) }
           : { r:255, g:255, b:255 };
}
function toSpineHex(hex: string, alpha = 1.0) {
  const {r,g,b} = hexToRgb(hex);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return [r,g,b,a].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function r3(n: number) { return Math.round(n * 1000) / 1000; }

// ─── curvature-adaptive sampling ─────────────────────────────────────────────

function adaptiveSample(curve: THREE.CatmullRomCurve3, maxSegs: number): THREE.Vector3[] {
  const over = Math.min(400, maxSegs * 10);
  const all  = curve.getSpacedPoints(over);
  const imp  = new Float64Array(all.length).fill(1.0);
  for (let i = 1; i < all.length - 1; i++) {
    const a1 = Math.atan2(all[i].y-all[i-1].y, all[i].x-all[i-1].x);
    const a2 = Math.atan2(all[i+1].y-all[i].y, all[i+1].x-all[i].x);
    let da = Math.abs(a2 - a1);
    if (da > Math.PI) da = 2*Math.PI - da;
    imp[i] = 1.0 + da * 10.0;
  }
  const sel = new Set([0, all.length-1]);
  const cands = Array.from({length: all.length-2}, (_,i)=>i+1);
  cands.sort((a,b) => imp[b]-imp[a]);
  for (const idx of cands) {
    if (sel.size >= maxSegs+1) break;
    sel.add(idx);
  }
  return Array.from(sel).sort((a,b)=>a-b).map(i=>all[i]);
}

// ─── sprite-sheet renderer ────────────────────────────────────────────────────
// Renders N frames side-by-side.  Each frame is a horizontal glow bar
// (height = BEAM_H) with a per-frame sine shimmer.

const BEAM_W = 256;
const BEAM_H = 128;

function renderSheet(numFrames: number, glowHex: string, coreHex: string, falloff: number) {
  const W = BEAM_W * numFrames;
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = BEAM_H;
  const ctx = canvas.getContext('2d')!;
  const {r:gr,g:gg,b:gb} = hexToRgb(glowHex);
  const {r:cr,g:cg,b:cb} = hexToRgb(coreHex);
  const cy = BEAM_H / 2;

  for (let f = 0; f < numFrames; f++) {
    const phase = (f / numFrames) * Math.PI * 2;
    const img = ctx.createImageData(BEAM_W, BEAM_H);
    const d   = img.data;
    for (let y = 0; y < BEAM_H; y++) {
      const t  = Math.abs(y - cy) / cy;
      const ga = Math.pow(Math.max(0, 1-t), falloff * 1.2);
      const cm = Math.pow(Math.max(0, 1-t*3), 2);
      const pr = Math.round(cr*cm + gr*(1-cm));
      const pg = Math.round(cg*cm + gg*(1-cm));
      const pb = Math.round(cb*cm + gb*(1-cm));
      for (let x = 0; x < BEAM_W; x++) {
        const shim = 0.78 + 0.22 * (
          Math.sin(x * 0.09 + phase) * Math.cos(x * 0.04 - phase * 1.3)
        );
        const idx = (y * BEAM_W + x) * 4;
        d[idx]=pr; d[idx+1]=pg; d[idx+2]=pb;
        d[idx+3] = Math.round(ga * shim * 255);
      }
    }
    ctx.putImageData(img, f * BEAM_W, 0);
  }
  return { dataUrl: canvas.toDataURL('image/png'), sheetW: W, sheetH: BEAM_H };
}

// ─── atlas builder ────────────────────────────────────────────────────────────

function buildAtlas(numFrames: number, sheetW: number, sheetH: number) {
  const lines: string[] = [
    'saber_beam.png',
    \`size: \${sheetW}, \${sheetH}\`,
    'format: RGBA8888',
    'filter: Linear, Linear',
    'repeat: none',
  ];
  for (let f = 0; f < numFrames; f++) {
    lines.push(
      '',
      \`saber_beam\${f}\`,
      '  rotate: false',
      \`  xy: \${f * BEAM_W}, 0\`,
      \`  size: \${BEAM_W}, \${sheetH}\`,
      \`  orig: \${BEAM_W}, \${sheetH}\`,
      '  offset: 0, 0',
      \`  index: \${f}\`,
    );
  }
  return lines.join('\\n');
}

// ─── main export ─────────────────────────────────────────────────────────────

export async function exportSaberToSpine(
  pathPoints3D: Array<{x:number; y:number; z:number}>,
  opts: SaberSpineExportOpts = {}
): Promise<Blob> {
  if (pathPoints3D.length < 2) throw new Error('Need at least 2 path points');

  const name     = opts.name          ?? 'saber';
  const glowHex  = opts.glowColor     ?? '#0088ff';
  const coreHex  = opts.coreColor     ?? '#ffffff';
  const glowW    = opts.glowWidth     ?? 40;
  const falloff  = opts.glowFalloff   ?? 1.2;
  const animated = opts.noiseAnimated ?? true;
  const noiseSpd = opts.noiseSpeed    ?? 1.0;
  const animDur  = opts.animDuration  ?? 2.0;
  const fps      = opts.fps           ?? 30;
  const maxBones = opts.maxBones      ?? 20;
  const seqF     = opts.seqFrames     ?? 8;

  const pts3  = pathPoints3D.map(p => new THREE.Vector3(p.x, p.y, 0));
  const curve = new THREE.CatmullRomCurve3(pts3, false, 'catmullrom', 0.5);
  const spts  = adaptiveSample(curve, maxBones);
  const numSegs = spts.length - 1;

  // ── Bone chain ─────────────────────────────────────────────────────────────
  // root (index 0) → b0 (index 1) → b1 (index 2) → … → b{N-1} (index N)
  // Each bone's local-space origin IS the left joint of its segment.
  // The bone length = segment length, so its tail is the right joint.
  type BE = {name:string; parent:string; x:number; y:number; rotation:number; length:number};
  const bones: BE[] = [{name:'root', parent:'', x:0, y:0, rotation:0, length:0}];
  const worldAngles: number[] = [];
  const segLengths: number[]  = [];

  for (let i = 0; i < numSegs; i++) {
    const p0 = spts[i], p1 = spts[i+1];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const segLen   = Math.sqrt(dx*dx + dy*dy) || 0.01;
    const worldAng = Math.atan2(dy, dx) * (180 / Math.PI);
    worldAngles.push(worldAng);
    segLengths.push(segLen);

    if (i === 0) {
      bones.push({ name:\`b\${i}\`, parent:'root',
        x: r3(p0.x), y: r3(p0.y),
        rotation: r3(worldAng), length: r3(segLen) });
    } else {
      const localRot  = worldAng - worldAngles[i-1];
      const parentLen = segLengths[i-1];
      bones.push({ name:\`b\${i}\`, parent:\`b\${i-1}\`,
        x: r3(parentLen), y: 0,
        rotation: r3(localRot), length: r3(segLen) });
    }
  }

  // ── Sprite sheet texture ──────────────────────────────────────────────────
  const { dataUrl, sheetW, sheetH } = renderSheet(seqF, glowHex, coreHex, falloff);
  const sheetB64 = dataUrl.replace(/^data:image\\/png;base64,/, '');

  // ── Slots + skin (region attachments) ────────────────────────────────────
  // Each slot lives on b{i}.  The region attachment is placed at the bone's
  // local midpoint (segLen/2, 0) so it stretches along the whole bone.
  // Width = segLen + glowW*0.5 (slight overlap to hide seams at joints).
  const slots:    any[] = [];
  const skinAtts: any   = {};

  for (let i = 0; i < numSegs; i++) {
    const segLen   = segLengths[i];
    const overlap  = glowW * 0.5;
    const attWidth = r3(segLen + overlap);
    const attH     = r3(glowW);
    const slotName = \`seg_\${i}\`;

    slots.push({
      name: slotName,
      bone: \`b\${i}\`,
      attachment: 'saber_beam',
      blend: 'additive',
    });

    // Region attachment: positioned at midpoint of bone (local space)
    skinAtts[slotName] = {
      saber_beam: {
        // no 'type' needed – region is the default
        path: 'saber_beam',
        x: r3(segLen / 2),      // midpoint along bone local-X
        y: 0,
        width:  attWidth,
        height: attH,
        sequence: { start: 0, count: seqF, mode: 'loop', delay: 0.12 },
      },
    };
  }

  // ── Animation: ripple RGBA keyframes ─────────────────────────────────────
  const animSlots: any = {};
  if (animated) {
    const keyEvery   = Math.max(1, Math.round(fps / 8));
    const frameCount = Math.ceil(animDur * fps);
    for (let i = 0; i < numSegs; i++) {
      const phase = (i / numSegs) * Math.PI * 4;
      const keys: any[] = [];
      for (let f = 0; f <= frameCount; f += keyEvery) {
        const t     = f / fps;
        const v     = Math.sin(t * noiseSpd * Math.PI * 2 + phase) * 0.5 + 0.5;
        const alpha = Math.max(0.2, 0.4 + v * 0.6);
        keys.push({ time: r3(t), color: toSpineHex(glowHex, alpha) });
      }
      animSlots[\`seg_\${i}\`] = { rgba: keys };
    }
  }

  // ── Bounding box ──────────────────────────────────────────────────────────
  let mnX=Infinity, mxX=-Infinity, mnY=Infinity, mxY=-Infinity;
  spts.forEach(p => {
    mnX=Math.min(mnX,p.x-glowW); mxX=Math.max(mxX,p.x+glowW);
    mnY=Math.min(mnY,p.y-glowW); mxY=Math.max(mxY,p.y+glowW);
  });

  // ── Spine JSON ────────────────────────────────────────────────────────────
  const spineJson: any = {
    skeleton: {
      hash: name, spine: '4.2.43',
      x: Math.round(mnX), y: Math.round(mnY),
      width:  Math.round(mxX-mnX), height: Math.round(mxY-mnY),
      fps, images: 'images/', audio: '',
    },
    bones: bones.map(b => {
      if (!b.parent) return { name: b.name };
      const o: any = { name: b.name, parent: b.parent };
      if (b.x        !== 0) o.x        = b.x;
      if (b.y        !== 0) o.y        = b.y;
      if (b.rotation !== 0) o.rotation = b.rotation;
      if (b.length   >  0)  o.length   = b.length;
      return o;
    }),
    slots,
    skins:      [{ name: 'default', attachments: skinAtts }],
    animations: { idle: { slots: animSlots } },
  };

  // ── Atlas ─────────────────────────────────────────────────────────────────
  const atlas = buildAtlas(seqF, sheetW, sheetH);

  // ── Zip ───────────────────────────────────────────────────────────────────
  const zip = new JSZip();
  zip.file(\`\${name}.json\`,  JSON.stringify(spineJson, null, 2));
  zip.file(\`\${name}.atlas\`, atlas);
  zip.folder('images')!.file('saber_beam.png', sheetB64, { base64: true });

  return zip.generateAsync({ type: 'blob' });
}
`;
fs.writeFileSync('src/SaberExporter.ts', content, 'utf8');
console.log('Written', content.split('\n').length, 'lines');
