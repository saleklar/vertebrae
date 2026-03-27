const fs = require('fs');
const content = `/**
 * SaberExporter.ts – Spine 4.2.x bone-chain + weighted-mesh export
 *
 * Architecture:
 *  - Curvature-adaptive bones: oversampled Catmull-Rom, keep highest-curvature
 *    points up to maxBones. Straight runs = fewer bones, tight bends = more.
 *  - Weighted mesh attachments: each segment is a 4-vert rectangle. Left edge
 *    100% on bone[i], right edge 100% on bone[i+1] → Spine bends it live.
 *  - Tapered end caps: first and last segments are triangles (tip → full width).
 *  - PNG sequence: 8 beam frames packed into one sprite sheet. All segments
 *    share the same sequence while per-slot RGBA keys add a ripple wave.
 *
 * pathPoints3D must be already in screen-space 2D (projected by caller).
 */

import * as THREE from 'three';
import JSZip from 'jszip';

// ─── public API ──────────────────────────────────────────────────────────────

export interface SaberSpineExportOpts {
  name?: string;
  coreColor?: string;
  glowColor?: string;
  glowWidth?: number;      // beam height in screen px (from projection)
  glowFalloff?: number;    // 0.5 = wide soft … 2.0 = tight (default 1.2)
  noiseAnimated?: boolean;
  noiseSpeed?: number;
  animDuration?: number;   // seconds (default 2)
  fps?: number;            // default 30
  maxBones?: number;       // hard cap, default 20
  seqFrames?: number;      // PNG sequence frames, default 8
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const m = /^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex);
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : { r: 255, g: 255, b: 255 };
}

function toSpineHex(hex: string, alpha = 1.0) {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return [r, g, b, a].map(v => v.toString(16).padStart(2, '0')).join('');
}

function r3(n: number) { return Math.round(n * 1000) / 1000; }

// ─── curvature-adaptive sampling ─────────────────────────────────────────────

function adaptiveSample(curve: THREE.CatmullRomCurve3, maxSegs: number): THREE.Vector3[] {
  const oversample = Math.min(300, maxSegs * 8);
  const all = curve.getSpacedPoints(oversample);

  const importance = new Float64Array(all.length).fill(1.0);
  for (let i = 1; i < all.length - 1; i++) {
    const a1 = Math.atan2(all[i].y - all[i - 1].y, all[i].x - all[i - 1].x);
    const a2 = Math.atan2(all[i + 1].y - all[i].y, all[i + 1].x - all[i].x);
    let da = Math.abs(a2 - a1);
    if (da > Math.PI) da = 2 * Math.PI - da;
    importance[i] = 1.0 + da * 8.0;
  }

  const selected = new Set([0, all.length - 1]);
  const candidates = Array.from({ length: all.length - 2 }, (_, i) => i + 1);
  candidates.sort((a, b) => importance[b] - importance[a]);
  for (const idx of candidates) {
    if (selected.size >= maxSegs + 1) break;
    selected.add(idx);
  }

  return Array.from(selected)
    .sort((a, b) => a - b)
    .map(i => all[i]);
}

// ─── texture ─────────────────────────────────────────────────────────────────

const BEAM_W = 256;
const BEAM_H = 64;

function renderBeamSheet(numFrames: number, glowHex: string, coreHex: string, falloff: number) {
  const sheetW = BEAM_W * numFrames;
  const canvas = document.createElement('canvas');
  canvas.width = sheetW;
  canvas.height = BEAM_H;
  const ctx = canvas.getContext('2d')!;
  const { r: gr, g: gg, b: gb } = hexToRgb(glowHex);
  const { r: cr, g: cg, b: cb } = hexToRgb(coreHex);
  const cy = BEAM_H / 2;

  for (let f = 0; f < numFrames; f++) {
    const phase = (f / numFrames) * Math.PI * 2;
    const img = ctx.createImageData(BEAM_W, BEAM_H);
    const d = img.data;

    for (let y = 0; y < BEAM_H; y++) {
      const t = Math.abs(y - cy) / cy;
      const baseA = Math.pow(Math.max(0, 1 - t), falloff * 1.4);
      const cm = Math.pow(Math.max(0, 1 - t * 3), 2);
      const pr = Math.round(cr * cm + gr * (1 - cm));
      const pg = Math.round(cg * cm + gg * (1 - cm));
      const pb = Math.round(cb * cm + gb * (1 - cm));

      for (let x = 0; x < BEAM_W; x++) {
        const shimmer = 0.82 + 0.18 * Math.sin(x * 0.12 + phase) * Math.cos(x * 0.05 - phase * 1.5);
        const idx = (y * BEAM_W + x) * 4;
        d[idx]     = pr;
        d[idx + 1] = pg;
        d[idx + 2] = pb;
        d[idx + 3] = Math.round(baseA * shimmer * 255);
      }
    }
    ctx.putImageData(img, f * BEAM_W, 0);
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    sheetW,
    sheetH: BEAM_H,
  };
}

// ─── mesh attachment builders ─────────────────────────────────────────────────

// Spine 4.x weighted vertex: boneCount, (boneIdx, localX, localY, weight)×n
function wv(boneIdx: number, lx: number, ly: number): number[] {
  return [1, boneIdx, r3(lx), r3(ly), 1.0];
}

const SEQ = (count: number) => ({ mode: 'loop', delay: 0.1, start: 0, count });

function buildMidMesh(i: number, j: number, halfH: number, nf: number) {
  return {
    type: 'mesh', path: 'saber_beam',
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 2, 3, 0],
    vertices: [
      ...wv(i,  0,  halfH),
      ...wv(j,  0,  halfH),
      ...wv(j,  0, -halfH),
      ...wv(i,  0, -halfH),
    ],
    hull: 4,
    sequence: SEQ(nf),
  };
}

function buildStartCap(i: number, j: number, halfH: number, nf: number) {
  return {
    type: 'mesh', path: 'saber_beam',
    uvs: [0, 0.5, 1, 0, 1, 1],
    triangles: [0, 1, 2],
    vertices: [
      ...wv(i,  0,   0),
      ...wv(j,  0,  halfH),
      ...wv(j,  0, -halfH),
    ],
    hull: 3,
    sequence: SEQ(nf),
  };
}

function buildEndCap(i: number, j: number, halfH: number, nf: number) {
  return {
    type: 'mesh', path: 'saber_beam',
    uvs: [0, 0, 0, 1, 1, 0.5],
    triangles: [0, 1, 2],
    vertices: [
      ...wv(i,  0,  halfH),
      ...wv(i,  0, -halfH),
      ...wv(j,  0,   0),
    ],
    hull: 3,
    sequence: SEQ(nf),
  };
}

// ─── atlas ───────────────────────────────────────────────────────────────────

function buildAtlas(sheetW: number, sheetH: number, numFrames: number) {
  const lines = [
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

// ─── main ─────────────────────────────────────────────────────────────────────

export async function exportSaberToSpine(
  pathPoints3D: Array<{ x: number; y: number; z: number }>,
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
  type BE = { name: string; parent: string; x: number; y: number; rotation: number; length: number };
  const bones: BE[] = [{ name: 'root', parent: '', x: 0, y: 0, rotation: 0, length: 0 }];
  const worldAngles: number[] = [];

  for (let i = 0; i < numSegs; i++) {
    const p0 = spts[i], p1 = spts[i + 1];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const segLen   = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const worldAng = Math.atan2(dy, dx) * (180 / Math.PI);
    worldAngles.push(worldAng);

    if (i === 0) {
      bones.push({ name: \`b\${i}\`, parent: 'root', x: r3(p0.x), y: r3(p0.y), rotation: r3(worldAng), length: r3(segLen) });
    } else {
      const localRot  = worldAng - worldAngles[i - 1];
      const parentLen = bones[bones.length - 1].length;
      bones.push({ name: \`b\${i}\`, parent: \`b\${i - 1}\`, x: r3(parentLen), y: 0, rotation: r3(localRot), length: r3(segLen) });
    }
  }

  // ── Texture ────────────────────────────────────────────────────────────────
  const { dataUrl, sheetW, sheetH } = renderBeamSheet(seqF, glowHex, coreHex, falloff);
  const sheetB64 = dataUrl.replace(/^data:image\\/png;base64,/, '');

  // ── Slots + skin ───────────────────────────────────────────────────────────
  const slots: any[]  = [];
  const skinAtts: any = {};
  const halfH = glowW / 2;

  for (let i = 0; i < numSegs; i++) {
    const bi = i + 1, bj = i + 2;
    const slotName = \`seg_\${i}\`;
    let att: any;
    if      (i === 0)          att = buildStartCap(bi, bj, halfH, seqF);
    else if (i === numSegs-1)  att = buildEndCap  (bi, bj, halfH, seqF);
    else                       att = buildMidMesh  (bi, bj, halfH, seqF);

    slots.push({ name: slotName, bone: \`b\${i}\`, attachment: 'saber_beam', blend: 'additive' });
    skinAtts[slotName] = { saber_beam: att };
  }

  // ── Animation ─────────────────────────────────────────────────────────────
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
        const alpha = Math.max(0.25, 0.45 + v * 0.55);
        keys.push({ time: r3(t), color: toSpineHex(glowHex, alpha) });
      }
      animSlots[\`seg_\${i}\`] = { rgba: keys };
    }
  }

  // ── Bounding box ──────────────────────────────────────────────────────────
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  spts.forEach(p => {
    minX = Math.min(minX, p.x - glowW); maxX = Math.max(maxX, p.x + glowW);
    minY = Math.min(minY, p.y - glowW); maxY = Math.max(maxY, p.y + glowW);
  });

  // ── Spine JSON ────────────────────────────────────────────────────────────
  const spineJson: any = {
    skeleton: {
      hash: name, spine: '4.2.43',
      x: Math.round(minX), y: Math.round(minY),
      width: Math.round(maxX - minX), height: Math.round(maxY - minY),
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
  const atlas = buildAtlas(sheetW, sheetH, seqF);

  // ── Zip ───────────────────────────────────────────────────────────────────
  const zip = new JSZip();
  zip.file(\`\${name}.json\`,  JSON.stringify(spineJson, null, 2));
  zip.file(\`\${name}.atlas\`, atlas);
  zip.folder('images')!.file('saber_beam.png', sheetB64, { base64: true });

  return zip.generateAsync({ type: 'blob' });
}
`;
fs.writeFileSync('src/SaberExporter.ts', content, 'utf8');
console.log('SaberExporter.ts written, lines:', content.split('\n').length);
