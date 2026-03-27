/**
 * SaberExporter.ts – Spine 4.2.x bone-chain + MESH attachment export
 *
 * Each bone covers one curve segment.  A MESH attachment (quad) sits on
 * each bone.  Vertices are in bone-local space:
 *
 *   v0 (-ov, +h)  ----------  v1 (len+ov, +h)
 *        |                           |
 *   v3 (-ov, -h)  ----------  v2 (len+ov, -h)
 *
 * where len = segment length, h = halfGlowWidth, ov = small overlap.
 *
 * The UV origin for ALL quads maps to the same single glow-bar texture,
 * so every segment looks identical (same colour / glow profile) but each
 * follows its own bone's rotation.  Per-slot RGBA keyframes add a travelling
 * ripple wave.
 *
 * pathPoints3D must be in screen-space 2-D (projected by the caller).
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
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
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
  const cands = Array.from({length: all.length-2}, (_: unknown,i: number)=>i+1);
  cands.sort((a: number,b: number) => imp[b]-imp[a]);
  for (const idx of cands) {
    if (sel.size >= maxSegs+1) break;
    sel.add(idx);
  }
  return Array.from(sel).sort((a: number,b: number)=>a-b).map((i: number)=>all[i]);
}

// ─── glow-bar texture ────────────────────────────────────────────────────────
// 64 × 256 px tileable horizontal strip.
// IMPORTANT: NO horizontal variation – the texture is a pure vertical gradient
// so it tiles/stretches along any bone length with zero seam.

const BEAM_W = 64;   // width doesn't matter, texture is horizontally uniform
const BEAM_H = 256;  // taller = smoother gradient

function renderBeam(glowHex: string, coreHex: string, falloff: number) {
  const canvas = document.createElement('canvas');
  canvas.width  = BEAM_W;
  canvas.height = BEAM_H;
  const ctx = canvas.getContext('2d')!;
  const {r:gr,g:gg,b:gb} = hexToRgb(glowHex);
  const {r:cr,g:cg,b:cb} = hexToRgb(coreHex);
  const cy = BEAM_H / 2;
  const img = ctx.createImageData(BEAM_W, BEAM_H);
  const d   = img.data;

  for (let y = 0; y < BEAM_H; y++) {
    // t = 0 at centre, 1 at edge
    const t  = Math.abs(y - cy) / cy;
    // outer glow – soft power curve
    const ga = Math.pow(Math.max(0, 1 - t), falloff);
    // inner core – tighter, brighter
    const cm = Math.pow(Math.max(0, 1 - t * 2.5), 3);
    const pr = Math.min(255, Math.round(cr * cm + gr * (1 - cm) * ga + gr * cm * 0.4));
    const pg = Math.min(255, Math.round(cg * cm + gg * (1 - cm) * ga + gg * cm * 0.4));
    const pb = Math.min(255, Math.round(cb * cm + gb * (1 - cm) * ga + gb * cm * 0.4));
    const pa = Math.round(Math.min(1, ga + cm * 0.6) * 255);
    // Identical value for all x – texture tiles seamlessly along bone axis
    for (let x = 0; x < BEAM_W; x++) {
      const idx = (y * BEAM_W + x) * 4;
      d[idx] = pr; d[idx+1] = pg; d[idx+2] = pb; d[idx+3] = pa;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

// ─── atlas (single region covering the whole image) ─────────────────────────

function buildAtlas() {
  return [
    'saber_beam.png',
    `size: ${BEAM_W}, ${BEAM_H}`,
    'format: RGBA8888',
    'filter: Linear, Linear',
    'repeat: none',
    'pma: false',
    '',
    'saber_beam',
    '  rotate: false',
    `  bounds: 0, 0, ${BEAM_W}, ${BEAM_H}`,
    `  offsets: 0, 0, ${BEAM_W}, ${BEAM_H}`,
  ].join('\n');
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

  const pts3  = pathPoints3D.map(p => new THREE.Vector3(p.x, p.y, 0));
  const curve = new THREE.CatmullRomCurve3(pts3, false, 'catmullrom', 0.5);
  const spts  = adaptiveSample(curve, maxBones);
  const numSegs = spts.length - 1;

  // ── Bone chain ─────────────────────────────────────────────────────────────
  // root → b0 → b1 → … → b{N-1}
  // b0 is positioned at the world coords of the first path point.
  // All subsequent bones are positioned at the end of their parent (local x=parentLen).
  type BE = { name:string; parent:string; x:number; y:number; rotation:number; length:number };
  const bones: BE[] = [{ name:'root', parent:'', x:0, y:0, rotation:0, length:0 }];
  const worldAngles: number[] = [];
  const segLengths:  number[] = [];

  for (let i = 0; i < numSegs; i++) {
    const p0 = spts[i], p1 = spts[i+1];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const segLen   = Math.sqrt(dx*dx + dy*dy) || 0.01;
    const worldAng = Math.atan2(dy, dx) * (180 / Math.PI);
    worldAngles.push(worldAng);
    segLengths.push(segLen);

    if (i === 0) {
      bones.push({ name:`b${i}`, parent:'root',
        x: r3(p0.x), y: r3(p0.y),
        rotation: r3(worldAng), length: r3(segLen) });
    } else {
      const localRot  = worldAng - worldAngles[i-1];
      const parentLen = segLengths[i-1];
      bones.push({ name:`b${i}`, parent:`b${i-1}`,
        x: r3(parentLen), y: 0,
        rotation: r3(localRot), length: r3(segLen) });
    }
  }

  // ── Render glow texture ───────────────────────────────────────────────────
  const dataUrl  = renderBeam(glowHex, coreHex, falloff);
  const b64      = dataUrl.replace(/^data:image\/png;base64,/, '');

  // ── Slots + skin (mesh attachments) ──────────────────────────────────────
  // Each slot/bone gets one mesh quad.
  // Vertices in bone-local space (x = along bone, y = perpendicular):
  //
  //  v0(-ov, +h)──v1(len+ov, +h)
  //     |                 |
  //  v3(-ov, -h)──v2(len+ov, -h)
  //
  // UVs follow the texture rectangle: v0→(0,0) v1→(1,0) v2→(1,1) v3→(0,1)
  // Triangles: [0,3,2, 0,2,1]  (two CCW triangles)
  const slots:    any[] = [];
  const skinAtts: any   = {};
  const halfH = glowW / 2;
  // Large overlap – bones must overlap generously so additive blend fills
  // the joint gap completely.  Especially critical for short bones where
  // the segment length is less than the glow diameter.
  const ov    = glowW * 0.8;

  for (let i = 0; i < numSegs; i++) {
    const sl  = segLengths[i];
    const sn  = `seg_${i}`;

    slots.push({
      name: sn,
      bone: `b${i}`,
      attachment: 'saber_beam',
      blend: 'additive',
    });

    // Mesh vertices (bone-local, flat x/y pairs – no weighting)
    const verts = [
      r3(-ov),      r3(halfH),    // v0  top-left
      r3(sl + ov),  r3(halfH),    // v1  top-right
      r3(sl + ov),  r3(-halfH),   // v2  bottom-right
      r3(-ov),      r3(-halfH),   // v3  bottom-left
    ];

    skinAtts[sn] = {
      saber_beam: {
        type: 'mesh',
        path: 'saber_beam',
        uvs:       [0, 0,  1, 0,  1, 1,  0, 1],
        triangles: [0, 3, 2,  0, 2, 1],
        vertices:  verts,
        hull:      4,
        width:     BEAM_W,
        height:    BEAM_H,
      },
    };
  }

  // ── RGBA ripple animation ─────────────────────────────────────────────────
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
      animSlots[`seg_${i}`] = { rgba: keys };
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
      fps, images: './', audio: '',
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

  // ── Atlas + zip ───────────────────────────────────────────────────────────
  const zip = new JSZip();
  zip.file(`${name}.json`,  JSON.stringify(spineJson, null, 2));
  zip.file(`${name}.atlas`, buildAtlas());
  // Image sits at ZIP root, next to the .atlas, matching the atlas page name.
  zip.file('saber_beam.png', b64, { base64: true });

  return zip.generateAsync({ type: 'blob' });
}
