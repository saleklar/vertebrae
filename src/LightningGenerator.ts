// ─── LightningGenerator.ts ──────────────────────────────────────────────────
// Pure canvas-based lightning bolt rendering and PNG sequence generation.
// No React dependencies — safe to import anywhere.

export type LightningPt = { x: number; y: number; z?: number };

export interface LightningGenOptions {
  /** Core bolt color (bright center line) */
  coreColor: string;
  /** Core line width in canvas pixels */
  coreWidth: number;
  /** Glow color (blurred halo around bolt) */
  glowColor: string;
  /** Glow blur radius in canvas pixels */
  glowWidth: number;
  /** Midpoint-displacement complexity per segment (1–4) */
  segmentDepth: number;
  /** Arc bend amount -2..2 (0 = straight, positive/negative bows opposite sides) */
  bend: number;
  /** Glow stamp density 0.5–4 (higher = smoother, less visible circles) */
  density: number;
  /** Lateral displacement strength 0–1 */
  roughness: number;
  /** Number of equal segments the main arc is split into (1–12) */
  numSegments: number;
  /** Probability 0–1 that a branch spawns at each inner junction */
  branchProbability: number;
  /** Number of segments per branch arc */
  subBranchSegments: number;
  /** Branch length as fraction of main bolt length 0.1–0.9 */
  branchDecay: number;
  /** Legacy: number of branches for the simple (non-hierarchy) preview */
  branchCount: number;
  /** Number of recursive sub-branching levels (1 = only direct branches, 2 = branches + sub-branches, 3 = three levels) */
  branchLevels: number;
  /** High-frequency turbulence noise on top of coarse midpoint displacement 0–1 */
  turbulence: number;
  /** Fractal glow-noise intensity 0–1 (0 = off). Modulates sprite radius along bolt. */
  glowNoiseIntensity?: number;
  /** Spatial frequency of glow noise 0.5–12 */
  glowNoiseScale?: number;
  /** Animation speed of glow noise in loop-cycles per second */
  glowNoiseSpeed?: number;
  /** 'strike' = bolt grows start→end over frames; 'loop' = arc jitters each frame; 'loop-strike' = auto-cycling strike with fade */
    /** Branch spread half-angle in degrees (0 = straight, 180 = any direction). Default 90. */
    branchAngle?: number;
  mode: 'strike' | 'loop' | 'loop-strike';
  /** Total frames in the exported PNG sequence */
  frameCount: number;
  /** Playback fps (written to Spine sequence attachment) */
  fps: number;
  /** Output canvas width in pixels */
  canvasWidth: number;
  /** Output canvas height in pixels */
  canvasHeight: number;
  /**
   * 'sequence' = every segment/branch gets its own N-frame PNG sequence (attachment cycles).
   * 'bone-anim' = one static PNG per segment/branch; jitter is driven by bone rotation keyframes.
   * 'viewport-sequence' = full-frame PNG sequence captured from the live viewport renderer.
   */
  exportMode: 'sequence' | 'bone-anim' | 'viewport-sequence';
  flareShape?: string;
}

export const defaultLightningOpts = (): LightningGenOptions => ({
  coreColor:         '#ffffff',
  coreWidth:         1,
  glowColor:         '#0008ff',
  glowWidth:         4,
  segmentDepth:      2,
  bend:              0,
  density:           1.6,
  roughness:         0.45,
  numSegments:       4,
  branchProbability: 0.5,
  subBranchSegments: 2,
  branchDecay:       0.50,
  branchCount:       2, // legacy
  branchLevels:      2,
  turbulence:        0.35,
  glowNoiseIntensity: 0,
  glowNoiseScale:     3.0,
  glowNoiseSpeed:     1.0,
  branchAngle:        90,
  mode:              'loop-strike',
  frameCount:        10,
  fps:               12,
  canvasWidth:       512,
  canvasHeight:      256,
  exportMode:        'sequence',
});

function getAdaptiveLightningSegments(baseSegments: number, bend: number): number {
  const base = Math.max(1, Math.round(baseSegments));
  const bendBoost = Math.ceil(Math.abs(bend || 0) * 3);
  return Math.max(base, Math.min(24, base + bendBoost));
}

// ─── Seeded pseudo-RNG (LCG, deterministic per-frame) ───────────────────────
function makePrng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 0) / 0xffffffff);
  };
}

// ─── Midpoint displacement — returns ordered polyline ───────────────────────
function displace(
  pts: LightningPt[],
  depth: number,
  roughness: number,
  rng: () => number,
): LightningPt[] {
  if (depth <= 0 || pts.length < 2) return pts;
  const result: LightningPt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Unit perpendicular
    const nx = -dy / len, ny = dx / len;
    const disp = (rng() - 0.5) * roughness * len * 0.6;
    result.push(a, { x: mx + nx * disp, y: my + ny * disp });
  }
  result.push(pts[pts.length - 1]);
  return displace(result, depth - 1, roughness * 0.55, rng);
}

function buildBolt(
  start: LightningPt,
  end: LightningPt,
  depth: number,
  roughness: number,
  rng: () => number,
  bend = 0,
  arcSegments = 8,
): LightningPt[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const steps = Math.max(2, arcSegments);
  const basePts: LightningPt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    basePts.push({
      x: start.x + dx * t,
      y: start.y + dy * t,
    });
  }

  const displaced = displace(basePts, depth, roughness, rng);
  const clampedBend = Math.max(-2, Math.min(2, bend));
  if (Math.abs(clampedBend) <= 1e-6) {
    return displaced;
  }

  const nx = -dy / len;
  const ny = dx / len;
  const arcHeight = clampedBend * len * 0.22;
  const dirX = dx / len;
  const dirY = dy / len;

  return displaced.map((pt) => {
    const vx = pt.x - start.x;
    const vy = pt.y - start.y;
    const t = Math.max(0, Math.min(1, (vx * dirX + vy * dirY) / len));
    const bulge = 4 * t * (1 - t) * arcHeight;
    return {
      x: pt.x + nx * bulge,
      y: pt.y + ny * bulge,
      z: pt.z,
    };
  });
}

/**
 * 3-D midpoint displacement — like displace() but also perturbs the Z axis.
 * Used for branch paths so they spread into all three dimensions.
 */
function displace3D(
  pts: LightningPt[],
  depth: number,
  roughness: number,
  rng: () => number,
): LightningPt[] {
  if (depth <= 0 || pts.length < 2) return pts;
  const result: LightningPt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const az = a.z ?? 0, bz = b.z ?? 0;
    const dx = b.x - a.x, dy = b.y - a.y, dz = bz - az;
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    const mz = (az  + bz)  * 0.5;
    // First perpendicular: rotate direction in XY plane
    const len2D = Math.sqrt(dx*dx + dy*dy) || 1e-9;
    const p1x = -dy / len2D, p1y = dx / len2D; // p1z = 0
    // Second perpendicular: cross(normalised_dir, p1)
    const dirX = dx/len, dirY = dy/len, dirZ = dz/len;
    const p2x =  dirY * 0 - dirZ * p1y;
    const p2y =  dirZ * p1x - dirX * 0;
    const p2z =  dirX * p1y - dirY * p1x;
    const d1 = (rng() - 0.5) * roughness * len * 0.6;
    const d2 = (rng() - 0.5) * roughness * len * 0.5;
    result.push(a, {
      x: mx + p1x*d1 + p2x*d2,
      y: my + p1y*d1 + p2y*d2,
      z: mz +          p2z*d2,
    });
  }
  result.push(pts[pts.length - 1]);
  return displace3D(result, depth - 1, roughness * 0.55, rng);
}

// ─── Canvas rendering ────────────────────────────────────────────────────────

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

/** Parse "#rrggbb" or "#rgb" → [r, g, b] (0-255 each) */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Sample points evenly along a 2D polyline at `spacing` intervals.
 * Each point also carries `frac` (0–1) = how far along the total path it is.
 */
function samplePolyline2D(
  pts: LightningPt[],
  spacing: number,
): { x: number; y: number; frac: number }[] {
  if (pts.length < 2) return [{ x: pts[0].x, y: pts[0].y, frac: 0 }];
  let totalLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    totalLen += Math.sqrt(dx * dx + dy * dy);
  }
  const out: { x: number; y: number; frac: number }[] = [{ x: pts[0].x, y: pts[0].y, frac: 0 }];
  let accumulated = 0;
  let traveled = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen < 1e-6) continue;
    let d = spacing - accumulated;
    while (d <= segLen) {
      const t = d / segLen;
      const frac = totalLen > 0 ? (traveled + d) / totalLen : 0;
      out.push({ x: pts[i - 1].x + dx * t, y: pts[i - 1].y + dy * t, frac });
      d += spacing;
    }
    accumulated = segLen - (d - spacing);
    traveled += segLen;
  }
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, frac: 1 });
  return out;
}

type BoltRenderStyle = {
  haloSizeMul: number;
  glowSizeMul: number;
  coreSizeMul: number;
  haloOpacity: number;
  glowOpacity: number;
  coreOpacity: number;
};

const MAIN_BOLT_RENDER_STYLE: BoltRenderStyle = {
  haloSizeMul: 1.0,
  glowSizeMul: 1.0,
  coreSizeMul: 1.0,
  haloOpacity: 0.12,
  glowOpacity: 0.35,
  coreOpacity: 0.75,
};

function makeBranchBoltRenderStyle(generation = 0): BoltRenderStyle {
  const genScale = Math.pow(0.75, Math.max(0, generation));
  return {
    haloSizeMul: 0.7,
    glowSizeMul: 0.8,
    coreSizeMul: 0.9,
    haloOpacity: 0.10 * genScale,
    glowOpacity: 0.28 * genScale,
    coreOpacity: 0.55 * genScale,
  };
}

function polylineLength(pts: LightningPt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const dz = (pts[i].z ?? 0) - (pts[i - 1].z ?? 0);
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total;
}

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  pts: LightningPt[],
  subset = 1,   // 0–1: draw only the first fraction of the bolt (for strike grow)
) {
  const n = Math.max(2, Math.round(pts.length * subset));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/**
 * Sprite-based glow renderer — mirrors the THREE.js viewport's 3-pass
 * addGlowChain() approach exactly:
 *   Pass 1 – outer atmospheric halo  (large, dim)
 *   Pass 2 – coloured glow body      (medium)
 *   Pass 3 – bright core             (tight, bright)
 * Each pass stamps overlapping additive radial-gradient circles along the path.
 * Scale factors and opacities match the viewport constants directly.
 */
function renderBoltToCtx(
  ctx: CanvasRenderingContext2D,
  pts: LightningPt[],
  opts: LightningGenOptions,
  subset = 1,
  alphaScale = 1,
  widthMul = 1,
  tipTaper = 1.0,   // normalised path position where taper begins (1.0 = no taper)
  renderStyle: BoltRenderStyle = MAIN_BOLT_RENDER_STYLE,
  noisePhase = 0,   // 0–1, loopable; drives fractal glow-noise position in time
) {
  const n = Math.max(2, Math.round(pts.length * subset));
  const activePts = pts.slice(0, n);

  const [gr, gg, gb] = hexToRgb(opts.glowColor);
  const [cr, cg, cb] = hexToRgb(opts.coreColor);

  const glowW = opts.glowWidth  * widthMul;
  const coreW = opts.coreWidth  * widthMul;
  const density = Math.max(0.5, Math.min(4, opts.density ?? 1));

  // Radii = half of the viewport sprite diameters
  //   viewport: haloD = glowW*5.0, glowD = glowW*2.4, coreD = coreW*2.2
  const haloR = glowW * 2.5 * renderStyle.haloSizeMul;
  const glowR = glowW * 1.2 * renderStyle.glowSizeMul;
  const coreR = coreW * 1.1 * renderStyle.coreSizeMul;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  /**
   * Stamp a pass along activePts.
   * `radius`      – base sprite radius (pixels)
   * `passOpacity` – per-pass base opacity (matches viewport chain opacity)
   * `taperStart`  – normalised path position where taper begins (0.65 = main, 0.40 = branches)
   */
  const stampPass = (
    radius:      number,
    passOpacity: number,
    taperStart:  number,
  ) => {
    if (radius < 0.3) return;
    // Same dense spacing as viewport: 0.30 × sprite diameter
    const spacing = Math.max(0.5, (radius * 2 * 0.30) / density);
    const sampled  = samplePolyline2D(activePts, spacing);
    const N        = sampled.length;

    ctx.globalAlpha = (passOpacity * alphaScale) / Math.sqrt(density);

    sampled.forEach(({ x, y }, i) => {
      const t = N > 1 ? i / (N - 1) : 0;
      // Viewport taper: sqrt falloff from taperStart → 0.04 at tip
      const taperScale = t <= taperStart
        ? 1.0
        : Math.sqrt(Math.max(0, 1.0 - (t - taperStart) / (1.0 - taperStart + 1e-9))) * 0.96 + 0.04;
      const noiseI = opts.glowNoiseIntensity ?? 0;
      const noiseMul = noiseI > 0.001
        ? Math.max(0.1, 1.0 - noiseI * 0.65 + lightningLoopNoise(t, noisePhase, opts.glowNoiseScale ?? 3.0) * noiseI * 1.3)
        : 1.0;
      const r = radius * taperScale * noiseMul;
      if (r < 0.3) return;

      // Same gradient shape as buildLightningGlowTex in Scene3D
      const shape = opts.flareShape || 'circle';
      if (shape === 'diamond') {
        const dx = r; const dy = r;
        const imgData = ctx.createImageData(Math.ceil(r*2), Math.ceil(r*2));
        for (let py = 0; py < imgData.height; py++) {
          for (let px = 0; px < imgData.width; px++) {
            const ndx = Math.abs(px - r) / r;
            const ndy = Math.abs(py - r) / r;
            const d = ndx + ndy;
            const a = d < 1.0 ? Math.pow(1.0 - d, 2.0) : 0;
            
            let clr: [number, number, number];
            if (d < 0.10) { clr = [255, 255, 255]; }
            else if (d < 0.22) { clr = [cr, cg, cb]; }
            else { clr = [gr, gg, gb]; }
            
            const idx = (py * imgData.width + px) * 4;
            imgData.data[idx] = clr[0]; imgData.data[idx+1] = clr[1]; imgData.data[idx+2] = clr[2];
            imgData.data[idx+3] = a * 255;
          }
        }
        
        const tempCv = document.createElement('canvas'); tempCv.width = imgData.width; tempCv.height = imgData.height;
        tempCv.getContext('2d')!.putImageData(imgData, 0, 0);
        ctx.drawImage(tempCv, x - r, y - r);

      } else if (shape === 'star') {
        const dx = r; const dy = r;
        const imgData = ctx.createImageData(Math.ceil(r*2), Math.ceil(r*2));
        for (let py = 0; py < imgData.height; py++) {
          for (let px = 0; px < imgData.width; px++) {
            const ndx = Math.abs(px - r) / r;
            const ndy = Math.abs(py - r) / r;
            const d = Math.sqrt(ndx) + Math.sqrt(ndy);
            const a = d < 1.0 ? Math.pow(1.0 - d, 2.5) : 0;
            
            let clr: [number, number, number];
            if (d < 0.20) { clr = [255, 255, 255]; }
            else if (d < 0.3) { clr = [cr, cg, cb]; }
            else { clr = [gr, gg, gb]; }
            
            const idx = (py * imgData.width + px) * 4;
            imgData.data[idx] = clr[0]; imgData.data[idx+1] = clr[1]; imgData.data[idx+2] = clr[2];
            imgData.data[idx+3] = a * 255;
          }
        }
        
        const tempCv = document.createElement('canvas'); tempCv.width = imgData.width; tempCv.height = imgData.height;
        tempCv.getContext('2d')!.putImageData(imgData, 0, 0);
        ctx.drawImage(tempCv, x - r, y - r);
      } else if (shape === 'sharp') {
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0.00, `rgba(255,255,255,1.00)`);
        grad.addColorStop(0.02, `rgba(255,255,255,0.95)`);
        grad.addColorStop(0.06, `rgba(${cr},${cg},${cb},0.90)`);
        grad.addColorStop(0.12, `rgba(${gr},${gg},${gb},0.60)`);
        grad.addColorStop(0.25, `rgba(${gr},${gg},${gb},0.15)`);
        grad.addColorStop(1.00, `rgba(${gr},${gg},${gb},0.00)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0.00, `rgba(255,255,255,1.00)`);
        grad.addColorStop(0.10, `rgba(255,255,255,0.95)`);
        grad.addColorStop(0.22, `rgba(${cr},${cg},${cb},0.90)`);
        grad.addColorStop(0.42, `rgba(${gr},${gg},${gb},0.80)`);
        grad.addColorStop(0.65, `rgba(${gr},${gg},${gb},0.35)`);
        grad.addColorStop(0.85, `rgba(${gr},${gg},${gb},0.08)`);
        grad.addColorStop(1.00, `rgba(${gr},${gg},${gb},0.00)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  };

  // Three passes matching viewport's addGlowChain() call order & opacities
  stampPass(haloR, renderStyle.haloOpacity, tipTaper);  // outer atmospheric halo
  stampPass(glowR, renderStyle.glowOpacity, tipTaper);  // coloured glow body
  stampPass(coreR, renderStyle.coreOpacity, tipTaper);  // bright core sprites

  // ── Sharp bright core line on top (source-over) ───────────────────────────
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alphaScale;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.shadowBlur  = coreW * 6;
  ctx.shadowColor = opts.coreColor;
  ctx.strokeStyle = opts.coreColor;
  ctx.lineWidth   = coreW * 1.5;
  strokePolyline(ctx, activePts, 1);

  ctx.restore();
}

// ─── Build branches from main bolt points ────────────────────────────────────
function buildBranches(
  main: LightningPt[],
  start: LightningPt,
  end: LightningPt,
  opts: LightningGenOptions,
  rng: () => number,
): LightningPt[][] {
  const branches: LightningPt[][] = [];
  // Only pick from interior points (not start=0 or end=last)
  const pickable = main.slice(1, main.length - 2);
  if (pickable.length === 0) return branches;

  const mainLen = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
  const mainAngle = Math.atan2(end.y - start.y, end.x - start.x);
  // Branch segment depth is always at least 1 and strictly less than main depth
  const branchDepth = Math.max(1, (opts.segmentDepth ?? 3) - 1);

  for (let b = 0; b < opts.branchCount; b++) {
    const bp = pickable[Math.floor(rng() * pickable.length)];
    // Branch length: vary between 30%–100% of branchDecay × mainLen
    const bLen = mainLen * opts.branchDecay * (0.3 + rng() * 0.7);
    // Branch angle: spread controlled by opts.branchAngle (degrees half-angle)
    const halfRad = ((opts.branchAngle ?? 90) * Math.PI / 180);
    const angle = mainAngle + (rng() - 0.5) * 2 * halfRad;
    const bEnd: LightningPt = {
      x: bp.x + Math.cos(angle) * bLen,
      y: bp.y + Math.sin(angle) * bLen,
    };
    branches.push(buildBolt(
      bp, bEnd,
      branchDepth,
      opts.roughness * 0.75,
      rng,
    ));
  }
  return branches;
}

// ─── Main export: generate a sequence of PNG frames ──────────────────────────
/**
 * Generates `opts.frameCount` canvas frames and returns them as an array of
 * data-URL strings (PNG).  Bolt is drawn horizontally, centred vertically.
 * Start is at (pad, height/2), end is at (width-pad, height/2).
 */
export function generateLightningFrames(opts: LightningGenOptions): string[] {
  const effectiveSegments = getAdaptiveLightningSegments(opts.numSegments ?? 4, opts.bend ?? 0);
  const pad   = Math.max(opts.glowWidth * 2, 30);
  const start: LightningPt = { x: pad,                   y: opts.canvasHeight / 2 };
  const end:   LightningPt = { x: opts.canvasWidth - pad, y: opts.canvasHeight / 2 };

  const frames: string[] = [];

  for (let f = 0; f < opts.frameCount; f++) {
    const canvas = document.createElement('canvas');
    canvas.width  = opts.canvasWidth;
    canvas.height = opts.canvasHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Each frame gets a unique but deterministic seed
    const rng    = makePrng(f * 31337 + 9973);
    const subset = opts.mode === 'strike' ? (f + 1) / opts.frameCount : 1.0;

    const main = buildBolt(
      start,
      end,
      opts.segmentDepth,
      opts.roughness,
      rng,
      opts.bend ?? 0,
      Math.max(4, effectiveSegments * 2),
    );

    // Only show branches when bolt is fully extended (strike) or in loop mode
    const branches = (subset >= 0.99 || opts.mode === 'loop')
      ? buildBranches(main, start, end, opts, rng)
      : [];

    // Loopable noise phase: frame f / frameCount makes frame 0 == frame N (perfect loop)
    const noisePhase = opts.mode === 'loop' ? f / opts.frameCount : 0;

    // Render branches first (dimmer, 55% alpha, 55% width)
    branches.forEach(b => renderBoltToCtx(ctx, b, opts, 1, 1, 1, 0.40, makeBranchBoltRenderStyle(0), noisePhase));

    // Render main bolt on top
    renderBoltToCtx(ctx, main, opts, subset, 1, 1, 0.65, MAIN_BOLT_RENDER_STYLE, noisePhase);

    frames.push(canvas.toDataURL('image/png'));
  }

  return frames;
}

// ─── Hierarchical Spine 4.2 export ───────────────────────────────────────────

export interface LightningHierarchyExport {
  /** Spine 4.2 JSON skeleton */
  spineJson: object;
  /**
   * All rendered PNG sequences keyed by segment identifier.
   * Keys: 'seg0'..'segN', 'br0_seg0', 'br1_seg0', etc.
   * Values: array of PNG data-URL strings, one per frame.
   */
  allSegmentFrames: Record<string, string[]>;
  /** Summary for debugging */
  summary: { mainSegments: number; branches: number; totalBones: number; pixelScale: number };
}

const SPINE_SCALE_H = 10; // scene units → Spine world units

/**
 * Exports lightning as a Spine 4.2 skeleton with hierarchical bones.
 *
 * Bone chain (main arc example with 3 segments):
 *   root
 *   └─ {name}              ← bolt root at startX,startY, rotated to bolt angle
 *      └─ {name}_seg0_end  ← bone at end of seg 0 (offset segLen along local X)
 *         ├─ [slot: seg0 PNG centered on segment midpoint]
 *         ├─ {name}_br0    ← OPTIONAL branch at junction 0
 *         │   └─ {name}_br0_seg0_end
 *         │      └─ [slot: br0_seg0 PNG] ...
 *         └─ {name}_seg1_end
 *            └─ ...
 */
export function exportLightningHierarchyToSpine(
  startX: number, startY: number,
  endX:   number, endY:   number,
  opts: LightningGenOptions,
  name = 'lightning',
): LightningHierarchyExport {
  const numSeg       = getAdaptiveLightningSegments(opts.numSegments ?? 4, opts.bend ?? 0);
  const bend         = opts.bend ?? 0;

  const ddx          = endX - startX, ddy = endY - startY;
  const straightLen  = Math.sqrt(ddx * ddx + ddy * ddy) || 1;

  const startPt: LightningPt = { x: startX, y: startY };
  const endPt: LightningPt = { x: endX, y: endY };
  const preview = buildLightningPreview(
    startX,
    startY,
    endX,
    endY,
    opts.segmentDepth,
    opts.roughness,
    opts.branchCount,
    opts.branchDecay,
    0,
    opts.numSegments,
    opts.branchProbability,
    opts.subBranchSegments,
    opts.turbulence,
    opts.branchLevels,
    opts.bend,
    opts.branchAngle,
  );
  const mainWaypoints = preview.waypoints.length >= 2
    ? preview.waypoints
    : buildBolt(startPt, endPt, 0, 0, makePrng(0), bend, numSeg);

  const segLens: number[] = [];
  const segAnglesDeg: number[] = [];
  for (let i = 0; i < numSeg; i++) {
    const a = mainWaypoints[i];
    const b = mainWaypoints[i + 1];
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    segLens.push(Math.sqrt(sx * sx + sy * sy) || 1e-6);
    segAnglesDeg.push(Math.atan2(sy, sx) * (180 / Math.PI));
  }
  const arcLen = segLens.reduce((sum, value) => sum + value, 0) || straightLen;
  const rootAngleDeg = segAnglesDeg[0] ?? 0;

  // ── Glow-aware padding:  compute a rough pixel scale first so we know the
  //    scaled halo radius (glowWidth * S * 2.5) and can set padding ≥ that
  //    (avoiding glow clipping at tile edges).
  const roughScale  = Math.max(1, (opts.canvasWidth - 40) / Math.max(1, arcLen));
  const glowPad     = Math.max(Math.ceil(opts.glowWidth * roughScale * 2.5 * 1.2), 20);
  // pixelScale: scene units → pixels (content area of the canvas maps to bolt length)
  const pixelScale   = (opts.canvasWidth - 2 * glowPad) / Math.max(1, arcLen);
  // S: scene units → Spine world units.  We use pixelScale so that
  // 1 Spine world unit = 1 canvas pixel, making attachment width/height
  // directly equal to the pixel dimensions of the PNG images.
  const S = pixelScale;

  const structRng    = makePrng(0xABCD1234); // deterministic branch layout

  const bonesArr:         any[]                       = [{ name: 'root' }];
  const slotsArr:         any[]                       = [];
  const skinAtts:         any                         = {};
  const animSlots:        any                         = {};
  const animBones:        any                         = {};
  const allSegmentFrames: Record<string, string[]>    = {};
  // Spine 4.2 sequence mode:
  //   PNG sequence — 'hold' for strike/loop-strike (play growth frames once, freeze at full bolt)
  //                  'loop' for loop (arc jitter loops continuously)
  //   bone-anim   — always 'loop' (overridden in addSlot)
  const seqMode = opts.mode === 'loop' ? 'loop' : 'hold';
  const isBoneAnim = (opts.exportMode ?? 'sequence') === 'bone-anim';
  /**
   * For strike/loop-strike: tracks when each slot should start and finish revealing.
   * t0/t1 are normalised [0..1] fractions of the total animation duration.
   */
  const slotReveal: Map<string, { t0: number; t1: number; boneName: string }> = new Map();

  // ── Render PNG sequence for a straight horizontal bolt of given world length ──
  const renderBoltFrames = (
    worldLen:   number,
    seedOffset: number,
    alphaScale: number,
    widthScale: number,
    numFrames?: number,
    tipTaper = 1.0,   // path-fraction where taper begins (1.0 = uniform, 0.4 = taper last 60%)
    renderStyle: BoltRenderStyle = MAIN_BOLT_RENDER_STYLE,
  ): { frames: string[]; cW: number; cH: number } => {
    const cW = Math.max(64, Math.ceil(worldLen * pixelScale + 2 * glowPad));
    // Scale glow/core widths from world units → canvas pixels to match viewport sprite sizes:
    //   viewport: haloD = glowWidth * 5.0 world-unit diameter
    //   canvas:   haloR = glowWidth * pixelScale * 2.5 canvas-pixel radius  ✓
    const scaledOpts = {
      ...opts,
      glowWidth: opts.glowWidth * pixelScale * widthScale,
      coreWidth: opts.coreWidth * pixelScale * widthScale,
    };
    // Canvas height: enough for the scaled halo radius + worst-case Y arc wander per segment
    const scaledHaloR = scaledOpts.glowWidth * 2.5;   // = glowWidth * pixelScale * widthScale * 2.5
    const arcYWander  = opts.roughness * worldLen * pixelScale * 0.30;
    const cH = Math.max(64, Math.ceil((scaledHaloR + arcYWander) * 2 * 2.4 + glowPad));
    const frames: string[] = [];
    const count = numFrames ?? opts.frameCount;
    for (let f = 0; f < count; f++) {
      const rng    = makePrng(f * 31337 + seedOffset + 9973);
      // bone-anim: bones handle reveal → render full bolt every frame (arc jitter only).
      // PNG sequence, loop: full bolt every frame (jitter loops).
      // PNG sequence, strike/loop-strike: frames encode bolt growing 0→1 so the sequence IS the reveal.
      const subset = (!isBoneAnim && opts.mode !== 'loop') ? (f + 1) / count : 1.0;
      const canvas = document.createElement('canvas');
      canvas.width  = cW;
      canvas.height = cH;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, cW, cH);
      const sp: LightningPt = { x: glowPad,                             y: cH / 2 };
      const ep: LightningPt = { x: glowPad + worldLen * pixelScale,     y: cH / 2 };
      let pts = displace([sp, ep], opts.segmentDepth, opts.roughness, rng);
      const turb = opts.turbulence ?? 0;
      if (turb > 0.01) {
        pts = displace(pts, 2, turb * 1.4, makePrng(f * 12973 + seedOffset * 7 + 0xCAFEBABE));
      }
      const noisePhase = opts.mode === 'loop' ? f / count : 0;
      // Pass scaledOpts so glow radius is in canvas pixels matching viewport world proportions.
      // widthScale is already baked into scaledOpts.glowWidth/coreWidth above.
      renderBoltToCtx(ctx, pts, scaledOpts, subset, alphaScale, 1.0 /* widthScale baked */, tipTaper, renderStyle, noisePhase);
      frames.push(canvas.toDataURL('image/png'));
    }
    return { frames, cW, cH };
  };

  /**
   * Register one slot + skin attachment + Spine 4.2 animation timeline.
   *
   * In bone-anim mode the slot uses a short looping jitter sequence
   * (JITTER_FRAMES frames) so the arc twitches via PNG frames rather than
   * bone keyframes.  Both bolt endpoints are always at (glowPad, cH/2) in
   * every frame, so adjacent segment images match perfectly at the seams.
   *
   * `attachXOffset`: Spine world-unit offset from boneName origin to image centre.
   */
  const JITTER_FRAMES = Math.max(2, Math.min(8, opts.frameCount));

  const addSlot = (
    slotName:      string,
    boneName:      string,
    attName:       string,
    worldLen:      number,
    cW:            number,
    cH:            number,
    attachXOffset: number,
    revealT0 = 0,
    revealT1 = 1,
    scaleBoneName: string = boneName,
  ) => {
    slotsArr.push({ name: slotName, bone: boneName, attachment: attName });

    // Sequence count: strike/loop-strike use opts.frameCount for the growing bolt;
    // bone-anim uses JITTER_FRAMES for the looping arc twitch.
    const seqCount = isBoneAnim ? JITTER_FRAMES : opts.frameCount;
    const att: any = {
      x:        attachXOffset,
      y:        0,
      rotation: 0,
      width:    cW,
      height:   cH,
    };
    if (seqCount > 1) {
      att.sequence = {
        count:  seqCount,
        start:  0,
        digits: 4,
        fps:    opts.fps,
        mode:   isBoneAnim ? 'loop' : seqMode,
      };
    }
    skinAtts[slotName] = { [attName]: att };

    animSlots[slotName] = {
      attachment: [{ time: 0, name: attName }],
    };
    slotReveal.set(slotName, { t0: revealT0, t1: revealT1, boneName: scaleBoneName });
  };

  // ── Bolt root bone ────────────────────────────────────────────────────────
  bonesArr.push({
    name:     name,
    parent:   'root',
    x:        startX * S,
    y:        startY * S,
    rotation: rootAngleDeg,
  });

  // ── Main arc ──────────────────────────────────────
  //   Each segment gets TWO bones:
  //     seg_i_ctrl  – at junction (scale pivot for strike growth, scaleX 0→1)
  //     seg_i_end   – child at x=segLen*S (advances the chain)
  //   Jitter: each slot uses a short looping PNG sequence (JITTER_FRAMES).
  //   Both bolt endpoints are always rendered at y=cH/2 so adjacent frames
  //   and adjacent segment canvases connect seamlessly at the seams.
  const mainJunctions: string[] = [];
  const mainCtrls:     string[] = [];
  const mainJunctionFracs: number[] = [];
  let prevMain = name;
  let traveled = 0;

  for (let i = 0; i < numSeg; i++) {
    const ctrlBone = `${name}_seg${i}_ctrl`;
    const jBone    = `${name}_seg${i}_end`;
    const prevSegAngle = i === 0 ? rootAngleDeg : segAnglesDeg[i - 1];
    const segAngle = segAnglesDeg[i] ?? prevSegAngle;
    const localDelta = i === 0 ? 0 : segAngle - prevSegAngle;
    const segLen = segLens[i] ?? (arcLen / numSeg);
    const segStartT = traveled / arcLen;
    const segEndT = (traveled + segLen) / arcLen;

    // ctrlBone inherits parent transform normally so world rotation = accumulated chain angle.
    // jBone uses noScaleOrReflection: inherits rotation (correct position along segment direction)
    // but NOT scale — prevents bone-anim's scaleX:0→1 from collapsing the rest of the chain.
    bonesArr.push({ name: ctrlBone, parent: prevMain, x: 0, y: 0, rotation: localDelta });
    mainCtrls.push(ctrlBone);
    bonesArr.push({ name: jBone, parent: ctrlBone, x: segLen * S, y: 0, rotation: 0, transform: 'noScaleOrReflection' });
    mainJunctions.push(jBone);
    mainJunctionFracs.push(segEndT);
    prevMain = jBone;
    traveled += segLen;

    const segKey    = `seg${i}`;
    const segGlobalT  = numSeg > 1 ? i / (numSeg - 1) : 0;
    const segWidthMul = 1.0 - segGlobalT * 0.80;             // 1.0 → 0.20
    const segTipTaper = (i === numSeg - 1) ? 0.35 : 1.0;
    // bone-anim: render JITTER_FRAMES looping frames; sequence: full frameCount
    const numFrames = isBoneAnim ? JITTER_FRAMES : opts.frameCount;
    const { frames, cW, cH } = renderBoltFrames(segLen, i * 997, 1.0, segWidthMul, numFrames, segTipTaper, MAIN_BOLT_RENDER_STYLE);
    allSegmentFrames[segKey] = frames;
    addSlot(
      `slot_${name}_${segKey}`, ctrlBone, `${name}/${segKey}`,
      segLen, cW, cH,
      +(segLen / 2) * S,   // image centre is at segLen/2 from ctrlBone origin
      segStartT,
      segEndT,
      ctrlBone,
    );
  }

  // ── Branches: ctrl + image at junction, no end bone needed ───────────────
  const branchEntries = preview.branches.map((pts, index) => ({
    pts,
    parentT: preview.branchParentTs[index] ?? 0,
    generation: preview.branchGenerations[index] ?? 0,
  }));

  let branchIdx = 0;

  for (const branch of branchEntries) {
    if (!branch.pts || branch.pts.length < 2) continue;

    const junctionIndex = Math.max(0, Math.min(numSeg - 1, Math.round(branch.parentT * numSeg) - 1));
    const junctionBone = mainJunctions[junctionIndex] ?? mainJunctions[mainJunctions.length - 1] ?? name;
    const parentAngleDeg = segAnglesDeg[junctionIndex] ?? rootAngleDeg;

    let tangent = branch.pts[1];
    for (let i = 1; i < branch.pts.length; i++) {
      const dx = branch.pts[i].x - branch.pts[0].x;
      const dy = branch.pts[i].y - branch.pts[0].y;
      if (Math.abs(dx) + Math.abs(dy) > 1e-6) {
        tangent = branch.pts[i];
        break;
      }
    }

    const globalAngleDeg = Math.atan2(tangent.y - branch.pts[0].y, tangent.x - branch.pts[0].x) * (180 / Math.PI);
    const brLocalAngle = globalAngleDeg - parentAngleDeg;

    const brCtrlBone = `${name}_br${branchIdx}_ctrl`;
    bonesArr.push({ name: brCtrlBone, parent: junctionBone, x: 0, y: 0, rotation: brLocalAngle });

    const brKey = `br${branchIdx}`;
    const seedOff = branchIdx * 1009 + 31337 + branch.generation * 5003;
    const numFrames = isBoneAnim ? JITTER_FRAMES : opts.frameCount;
    const brLen = Math.max(1, polylineLength(branch.pts));
    const brStyle = makeBranchBoltRenderStyle(branch.generation);
    const { frames, cW, cH } = renderBoltFrames(brLen, seedOff, 1.0, 1.0, numFrames, 0.40, brStyle);
    allSegmentFrames[brKey] = frames;
    const brRevealT0 = Math.max(0, Math.min(1, branch.parentT));
    const brRevealSpan = Math.min(0.42, Math.max(0.08, (brLen / Math.max(arcLen, 1e-6)) * 0.55));
    const brRevealT1 = Math.min(1, brRevealT0 + brRevealSpan);
    addSlot(
      `slot_${name}_${brKey}`, brCtrlBone, `${name}/${brKey}`,
      brLen, cW, cH,
      (brLen / 2) * S,
      brRevealT0,
      brRevealT1,
      brCtrlBone,
    );

    branchIdx++;
  }

  // ── Strike growth: RGBA fade + scaleX grow per ctrl bone ─────────────────
  const isStrikeType = opts.mode === 'strike' || opts.mode === 'loop-strike';
  if (isStrikeType) {
    // Timing mirrors the viewport's loop-strike state machine exactly:
    //   grow  : 0 → strikeDur    (bolt draws out segment by segment)
    //   hold  : strikeDur → holdEnd  (bolt fully visible)
    //   fade  : holdEnd → totalDur   (flicker-decay to transparent)
    const strikeDur  = opts.frameCount / opts.fps;
    const holdDur    = opts.mode === 'loop-strike' ? 0.26 : 0;
    const fadeDur    = opts.mode === 'loop-strike' ? strikeDur * 0.55 : 0;
    const holdEnd    = strikeDur + holdDur;
    const totalDur   = holdEnd + fadeDur;
    const spf        = 1 / opts.fps;
    const easeStrike = (t: number) => Math.pow(Math.max(0, Math.min(1, t)), 2.35);

    /**
     * Build RGBA keys for the fade phase (holdEnd → totalDur).
     * Uses the viewport's exact flicker formula, baked at every frame.
     * `tFullyVisible` is the time this particular slot reaches full opacity.
     */
    const buildFadeKeys = (tFullyVisible: number): any[] => {
      const keys: any[] = [
        { time: tFullyVisible, color: 'ffffffff' },
        { time: holdEnd,       color: 'ffffffff' },
      ];
      if (fadeDur <= 0) return keys;
      const fadeFrames = Math.max(2, Math.round(fadeDur * opts.fps));
      for (let ff = 0; ff <= fadeFrames; ff++) {
        const tLocal    = ff / fadeFrames;                   // 0→1 through the fade
        const tAbs      = holdEnd + tLocal * fadeDur;        // absolute animation time
        const baseDecay = Math.max(0, 1 - tLocal);           // 1→0
        const flickerAmt = Math.min(1, tLocal * 5.0);        // ramps in over first 20%
        // Deterministic version of the viewport real-time flicker:
        const f1      = Math.abs(Math.sin(tAbs * 38.0));
        const f2      = Math.abs(Math.sin(tAbs * 13.7 + 1.1));
        const flicker = Math.pow(Math.max(0, f1 * f2), 0.4); // 0..1, spiky
        const alpha   = baseDecay * (1.0 - flickerAmt * 0.82 + flicker * flickerAmt * 0.82);
        const a255    = Math.min(255, Math.max(0, Math.round(alpha * 255)));
        keys.push({ time: tAbs, color: `ffffff${a255.toString(16).padStart(2, '0')}`, curve: 'stepped' });
      }
      // Guarantee fully transparent at cycle end (clean loop)
      keys.push({ time: totalDur, color: 'ffffff00', curve: 'stepped' });
      return keys;
    };

    slotReveal.forEach(({ t0, t1, boneName }, slotName) => {
      const tStart = easeStrike(t0) * strikeDur;
      const tEnd   = easeStrike(t1) * strikeDur;

      if (isBoneAnim) {
        // ── BONE-ANIM: staggered per-segment reveal via scaleX + RGBA ─────────
        // RGBA: transparent → opaque at tStart, shimmer hold, flicker-fade out
        const rgbaKeys: any[] = [{ time: 0, color: 'ffffff00' }];
        if (tStart > spf) {
          rgbaKeys.push({ time: Math.max(0, tStart - spf), color: 'ffffff00' });
        }
        rgbaKeys.push({ time: tStart, color: 'ffffff00' });
        rgbaKeys.push({ time: tEnd,   color: 'ffffffff' });

        if (opts.mode === 'loop-strike' && holdEnd > tEnd + 1e-6) {
          const shimmerFrames = Math.max(2, Math.round((holdEnd - tEnd) * opts.fps));
          for (let hh = 1; hh <= shimmerFrames; hh++) {
            const u = hh / shimmerFrames;
            const ts = tEnd + (holdEnd - tEnd) * u;
            const shimmer = 0.90
              + 0.07 * Math.abs(Math.sin(ts * 32.0))
              + 0.03 * Math.abs(Math.sin(ts * 11.2 + 0.8));
            const a = Math.min(255, Math.max(0, Math.round(Math.min(1, shimmer) * 255)));
            rgbaKeys.push({ time: ts, color: `ffffff${a.toString(16).padStart(2, '0')}`, curve: 'stepped' });
          }
        }
        const fadeKeys = buildFadeKeys(tEnd);
        for (const fk of fadeKeys) {
          if (fk.time > tEnd) rgbaKeys.push(fk);
        }
        animSlots[slotName] = { ...animSlots[slotName], rgba: rgbaKeys };

        // ScaleX: bone grows 0→1 at its tStart–tEnd window; holds at 1; resets invisibly at cycle end
        const existingBone = animBones[boneName] ?? {};
        const scaleKeys: any[] = [
          { time: 0,      x: 0.001, y: 1, curve: 'linear' },
          { time: tStart, x: 0.001, y: 1, curve: 'linear' },
          { time: tEnd,   x: 1,     y: 1, curve: 'linear' },
        ];
        if (opts.mode === 'loop-strike') {
          scaleKeys.push({ time: totalDur - spf, x: 1,     y: 1, curve: 'linear' });
          scaleKeys.push({ time: totalDur,       x: 0.001, y: 1, curve: 'stepped' });
        }
        animBones[boneName] = { ...existingBone, scale: scaleKeys };

      } else {
        // ── PNG SEQUENCE: frames encode the bolt growth; NO bone scaleX ───────
        // The attachment's own PNG sequence plays through frames 0→N showing the
        // bolt drawing in (subset 0→1), mode='hold' freezes it at the last frame.
        // Bones stay at scaleX=1 always.
        //
        // For loop-strike: add shimmer hold + flicker-fade RGBA so the fully-drawn
        // bolt fades out naturally before the next cycle starts.
        // For plain strike: no RGBA needed — sequence plays once and holds.
        if (opts.mode === 'loop-strike' && fadeDur > 0) {
          const rgbaKeys: any[] = [{ time: 0, color: 'ffffffff' }];

          // Shimmer during the hold phase
          if (holdDur > 0) {
            const shimmerFrames = Math.max(2, Math.round(holdDur * opts.fps));
            for (let hh = 1; hh <= shimmerFrames; hh++) {
              const u = hh / shimmerFrames;
              const ts = strikeDur + holdDur * u;
              const shimmer = 0.90
                + 0.07 * Math.abs(Math.sin(ts * 32.0))
                + 0.03 * Math.abs(Math.sin(ts * 11.2 + 0.8));
              const a = Math.min(255, Math.max(0, Math.round(Math.min(1, shimmer) * 255)));
              rgbaKeys.push({ time: ts, color: `ffffff${a.toString(16).padStart(2, '0')}`, curve: 'stepped' });
            }
          }

          // Flicker-fade out
          const fadeFrames = Math.max(2, Math.round(fadeDur * opts.fps));
          for (let ff = 0; ff <= fadeFrames; ff++) {
            const tLocal    = ff / fadeFrames;
            const tAbs      = holdEnd + tLocal * fadeDur;
            const baseDecay = Math.max(0, 1 - tLocal);
            const flickerAmt = Math.min(1, tLocal * 5.0);
            const f1      = Math.abs(Math.sin(tAbs * 38.0));
            const f2      = Math.abs(Math.sin(tAbs * 13.7 + 1.1));
            const flicker = Math.pow(Math.max(0, f1 * f2), 0.4);
            const alpha   = baseDecay * (1.0 - flickerAmt * 0.82 + flicker * flickerAmt * 0.82);
            const a255    = Math.min(255, Math.max(0, Math.round(alpha * 255)));
            rgbaKeys.push({ time: tAbs, color: `ffffff${a255.toString(16).padStart(2, '0')}`, curve: 'stepped' });
          }
          rgbaKeys.push({ time: totalDur, color: 'ffffff00', curve: 'stepped' });

          animSlots[slotName] = { ...animSlots[slotName], rgba: rgbaKeys };
        }
        // No animBones entry — sequence mode never touches bone scale
      }
    });
  }

  // ── Per-slot animation duration guarantee ──────────────────────────────────
  // For loop mode and plain-strike PNG-sequence mode, no timeline keys extend
  // past time 0, leaving animation duration = 0 → Spine never advances the animation.
  // Add explicit opaque rgba keys to bracket the natural cycle length.
  if (!isStrikeType) {
    // loop mode: one cycle = frameCount / fps
    const cycleDur = opts.frameCount / Math.max(1, opts.fps);
    slotReveal.forEach((_reveal, slotName) => {
      if (!animSlots[slotName]?.rgba) {
        animSlots[slotName] = {
          ...animSlots[slotName],
          rgba: [
            { time: 0,        color: 'ffffffff' },
            { time: cycleDur, color: 'ffffffff' },
          ],
        };
      }
    });
  } else if (!isBoneAnim && opts.mode === 'strike') {
    // Plain-strike PNG sequence: growth encoded in frames; animation holds at full bolt.
    // Need at least a key at strikeDur so Spine knows the animation is that long.
    const strikeDurKey = opts.frameCount / Math.max(1, opts.fps);
    slotReveal.forEach((_reveal, slotName) => {
      if (!animSlots[slotName]?.rgba) {
        animSlots[slotName] = {
          ...animSlots[slotName],
          rgba: [
            { time: 0,            color: 'ffffffff' },
            { time: strikeDurKey, color: 'ffffffff' },
          ],
        };
      }
    });
  }
  const spineJson = {
    skeleton: {
      hash:   `${name}-hierarchy-export`,
      spine:  '4.2.43',
      x:      0,
      y:      0,
      width:  opts.canvasWidth,
      height: opts.canvasHeight,
    },
    bones: bonesArr,
    slots: slotsArr,
    skins: [{ name: 'default', attachments: skinAtts }],
    animations: {
      animation: {
        ...(Object.keys(animBones).length > 0 ? { bones: animBones } : {}),
        slots: animSlots,
      },
    },
  };

  return {
    spineJson,
    allSegmentFrames,
    summary: { mainSegments: numSeg, branches: branchIdx, totalBones: bonesArr.length, pixelScale },
  };
}

// ─── Legacy Spine 4.2 export (backward compat) ────────────────────────────────

export interface LightningSpineExport {
  /** Spine 4.2 JSON skeleton (pass through JSON.stringify) */
  spineJson: object;
  /** PNG data-URLs for the main bolt, one per frame */
  mainFrames: string[];
  /**
   * PNG data-URLs for each branch, indexed [branchIndex][frame].
   * Each branch is drawn on its own (smaller) canvas and gets its own bone.
   */
  branchFrames: string[][];
}

const SPINE_SCALE = 10; // scene units → Spine world units

/** @deprecated Use exportLightningHierarchyToSpine instead. */
export function exportLightningToSpine(
  startX: number, startY: number,
  endX:   number, endY:   number,
  opts: LightningGenOptions,
  name = 'lightning',
): LightningSpineExport {
  const pad      = Math.max(opts.glowWidth * 2, 30);
  const boltDX   = endX - startX;
  const boltDY   = endY - startY;
  const boltLen  = Math.sqrt(boltDX ** 2 + boltDY ** 2) || 1;
  const midX     = (startX + endX) / 2;
  const midY     = (startY + endY) / 2;
  const angle    = Math.atan2(boltDY, boltDX); // bolt world direction, radians
  const angleDeg = angle * (180 / Math.PI);

  // One bolt-local unit → canvas pixels (main bolt fills canvas width minus padding)
  const pixelScale = (opts.canvasWidth - 2 * pad) / boltLen;

  const effectiveSegments = getAdaptiveLightningSegments(opts.numSegments ?? 4, opts.bend ?? 0);

  // ── Generate geometry for every frame (bolt-local coords: start=(0,0) end=(boltLen,0)) ──
  interface FrameGeo {
    main:     LightningPt[];
    branches: { root: LightningPt; end: LightningPt; pts: LightningPt[] }[];
  }
  const allFrames: FrameGeo[] = [];
  for (let f = 0; f < opts.frameCount; f++) {
    const rng  = makePrng(f * 31337 + 9973);
    const spt  = { x: 0,        y: 0 } as LightningPt;
    const ept  = { x: boltLen,  y: 0 } as LightningPt;
    const main = buildBolt(
      spt,
      ept,
      opts.segmentDepth,
      opts.roughness,
      rng,
      opts.bend ?? 0,
      Math.max(4, effectiveSegments * 2),
    );
    const raw  = buildBranches(main, spt, ept, opts, rng);
    allFrames.push({
      main,
      branches: raw.map(b => ({ root: b[0], end: b[b.length - 1], pts: b })),
    });
  }

  // Canonical branches come from frame 0; they define bone positions.
  const canonBranches = allFrames[0].branches;
  const numBranches   = canonBranches.length;

  // Per-branch canvas metadata derived from canonical frame-0 geometry
  const branchMeta = canonBranches.map(cb => {
    const dx  = cb.end.x - cb.root.x;
    const dy  = cb.end.y - cb.root.y;
    const len = Math.sqrt(dx ** 2 + dy ** 2) || 1;
    const ang = Math.atan2(dy, dx); // bolt-local direction of this branch
    // Canvas sized to contain the branch at the same pixel density as the main bolt
    const cW  = Math.max(64,  Math.ceil(len * pixelScale + 4 * pad));
    const cH  = Math.max(32,  Math.ceil(cW * 0.55));
    return { bLen: len, angle: ang, canvasW: cW, canvasH: cH };
  });

  // ── Helper: bolt-local → main canvas pixel coords (y-flipped for y-up rendering) ──
  const toMainCanvas = (p: LightningPt): LightningPt => ({
    x: pad + p.x * pixelScale,
    y: opts.canvasHeight / 2 - p.y * pixelScale, // y-up: positive y → upward in canvas
  });

  // ── Render main bolt frames ───────────────────────────────────────────────
  const mainFrames: string[] = allFrames.map((fd, f) => {
    const canvas = document.createElement('canvas');
    canvas.width  = opts.canvasWidth;
    canvas.height = opts.canvasHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const subset = opts.mode === 'strike' ? (f + 1) / opts.frameCount : 1.0;
    const noisePhase = opts.mode === 'loop' ? f / opts.frameCount : 0;
    renderBoltToCtx(ctx, fd.main.map(toMainCanvas), opts, subset, 1, 1, 1, MAIN_BOLT_RENDER_STYLE, noisePhase);
    return canvas.toDataURL('image/png');
  });

  // ── Render branch frames ──────────────────────────────────────────────────
  const branchFrames: string[][] = Array.from({ length: numBranches }, () => []);

  for (let b = 0; b < numBranches; b++) {
    const meta = branchMeta[b];
    const cb   = canonBranches[b];          // canonical branch (frame 0)
    const cosA = Math.cos(-meta.angle);     // pre-compute rotation to align horizontally
    const sinA = Math.sin(-meta.angle);

    // Map branch pts in bolt-local space → branch canvas pixels.
    // Centred on the CANONICAL root so the bone is always at the same canvas location;
    // frame-to-frame jitter of the actual root shows up as subtle image drift.
    const toBranchCanvas = (p: LightningPt): LightningPt => {
      const dx = p.x - cb.root.x; // relative to canonical root
      const dy = p.y - cb.root.y;
      const rx = dx * cosA - dy * sinA; // rotate to align branch horizontally
      const ry = dx * sinA + dy * cosA;
      return {
        x: pad + rx * pixelScale,
        y: meta.canvasH / 2 - ry * pixelScale, // y-up
      };
    };

    for (let f = 0; f < opts.frameCount; f++) {
      const canvas = document.createElement('canvas');
      canvas.width  = meta.canvasW;
      canvas.height = meta.canvasH;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fd = allFrames[f];
      if (fd.branches[b]) {
        const noisePhase = opts.mode === 'loop' ? f / opts.frameCount : 0;
        renderBoltToCtx(ctx, fd.branches[b].pts.map(toBranchCanvas), opts, 1, 0.55, 0.55, 1.0, makeBranchBoltRenderStyle(0), noisePhase);
      }
      branchFrames[b].push(canvas.toDataURL('image/png'));
    }
  }

  // ── Build Spine 4.2 JSON ──────────────────────────────────────────────────
  const skinAttachments: any  = {};
  const slotsArr: any[]       = [];
  const seqMode = opts.mode === 'strike' ? 'first' : 'loop';

  const addSlot = (
    slotName: string, boneName: string,
    attName: string, cW: number, cH: number,
    mode: string,
  ) => {
    slotsArr.push({ name: slotName, bone: boneName, attachment: attName });
    skinAttachments[slotName] = {
      [attName]: {
        type: 'region', name: attName, x: 0, y: 0,
        width: cW, height: cH,
        ...(opts.frameCount > 1
          ? { sequence: { count: opts.frameCount, start: 0, digits: 4, fps: opts.fps, mode } }
          : {}),
      },
    };
    // sequence attachment is self-animating via mode/fps — no animation timeline needed
  };

  // Bone array — parent bone holds the midpoint + bolt rotation
  const bonesArr: any[] = [
    { name: 'root' },
    {
      name:     name,
      parent:   'root',
      x:        midX * SPINE_SCALE,
      y:        midY * SPINE_SCALE,
      rotation: angleDeg,
    },
    { name: `${name}_main`, parent: name }, // at (0,0) relative to parent = bolt midpoint
  ];

  addSlot(`slot_${name}_main`, `${name}_main`,
    `${name}/main`, opts.canvasWidth, opts.canvasHeight, seqMode);

  for (let b = 0; b < numBranches; b++) {
    const meta = branchMeta[b];
    const cb   = canonBranches[b];
    const bBoneName = `${name}_branch_${b}`;

    // Child bone position is in parent-local space (= bolt-local, offset by half-bolt so parent sits at mid)
    bonesArr.push({
      name:     bBoneName,
      parent:   name,
      x:        (cb.root.x - boltLen / 2) * SPINE_SCALE,  // shift: parent is at mid (boltLen/2)
      y:         cb.root.y               * SPINE_SCALE,    // bolt-local y = Spine y-up ✓
      rotation:  meta.angle * (180 / Math.PI),             // branch direction relative to bolt axis
    });

    addSlot(`slot_${name}_branch_${b}`, bBoneName,
      `${name}/branch_${b}`, meta.canvasW, meta.canvasH, 'loop');
  }

  const spineJson = {
    skeleton: {
      hash:  `${name}-lightning-export`,
      spine: '4.2.43',
      width: opts.canvasWidth,
      height: opts.canvasHeight,
      fps:   opts.fps,
    },
    bones: bonesArr,
    slots: slotsArr,
    skins: [{ name: 'default', attachments: skinAttachments }],
    animations: {
      animation: {
        slots: Object.fromEntries(
          slotsArr.map(s => [s.name, { rgba: [{ time: 0, color: 'ffffffff' }] }]),
        ),
        bones: {},
      },
    },
  };

  return { spineJson, mainFrames, branchFrames };
}

// ─── Preview helper: {x,y} polylines for THREE.js 3D viewport ────────────────

/**
 * Recursively grows sub-branches off an already-displaced parent polyline.
 * Results are appended to the flat out-arrays (same index across arrays).
 *
 * @param parentMainT  Normalised T on the MAIN arc where the top-level parent begins
 *                     (used by Scene3D strike-mode to know when to start revealing this branch)
 */
function growSubBranches(
  parentPts:     LightningPt[],
  parentMainT:   number,
  generation:    number,
  maxGeneration: number,
  branchProb:    number,
  subBrSeg:      number,
  segDepth:      number,
  roughness:     number,
  boltLen:       number,
  branchDecay:   number,
  structRng:     () => number,
  seed:          number,
  seedBase:      number,
  turb:          number,
  outPts:        LightningPt[][],
  outParentTs:   number[],
  outGenerations: number[],
): void {
  if (generation >= maxGeneration || parentPts.length < 2) return;

  // Total arc length of parent, for junction sampling
  let totalLen = 0;
  for (let i = 1; i < parentPts.length; i++) {
    const ax = parentPts[i-1], bx = parentPts[i];
    const dz = (bx.z ?? 0) - (ax.z ?? 0);
    totalLen += Math.sqrt((bx.x-ax.x)**2 + (bx.y-ax.y)**2 + dz*dz);
  }
  const parentAngle = Math.atan2(
    parentPts[parentPts.length-1].y - parentPts[0].y,
    parentPts[parentPts.length-1].x - parentPts[0].x,
  );
  const numJunctions = Math.max(2, subBrSeg);

  for (let k = 0; k < numJunctions - 1; k++) {
    // Probability tapers at each deeper generation
    if (structRng() > branchProb * Math.pow(0.55, generation)) continue;

    // Interpolate junction point along parent polyline
    const targetLen = totalLen * (k + 1) / numJunctions;
    let acc = 0;
    let jPt: LightningPt = parentPts[parentPts.length - 1];
    for (let i = 1; i < parentPts.length; i++) {
      const ax = parentPts[i-1], bx = parentPts[i];
      const dz = (bx.z ?? 0) - (ax.z ?? 0);
      const seg = Math.sqrt((bx.x-ax.x)**2 + (bx.y-ax.y)**2 + dz*dz);
      if (acc + seg >= targetLen) {
        const t = (targetLen - acc) / Math.max(seg, 1e-9);
        jPt = { x: ax.x+(bx.x-ax.x)*t, y: ax.y+(bx.y-ax.y)*t, z: (ax.z??0)+dz*t };
        break;
      }
      acc += seg;
    }

    const spread    = (structRng() - 0.5) * Math.PI * 0.9;
    const elevation = (structRng() - 0.5) * Math.PI * 0.75;
    const brAngle   = parentAngle + spread;
    const cosEl     = Math.cos(elevation);
    const sinEl     = Math.sin(elevation);
    // Older branches (lower parentMainT) are longer; younger branches are shorter.
    const ageScale  = 0.6 + (1.0 - Math.max(0, Math.min(1, parentMainT))) * 0.4;
    // Each generation is 55% the length of the previous, then age-scaled.
    const brLen     = boltLen * branchDecay * Math.pow(0.55, generation + 1) * ageScale;
    const brSegLen  = brLen / Math.max(1, subBrSeg);
    const jz        = jPt.z ?? 0;

    const brWpts: LightningPt[] = [jPt];
    for (let j = 1; j <= subBrSeg; j++) {
      brWpts.push({
        x: jPt.x + Math.cos(brAngle) * cosEl * brSegLen * j,
        y: jPt.y + Math.sin(brAngle) * cosEl * brSegLen * j,
        z: jz + sinEl * brSegLen * j,
      });
    }

    const brParts: LightningPt[][] = [];
    for (let j = 0; j < subBrSeg; j++) {
      const brRng = makePrng(seed + seedBase + k * 773 + j * 331 + generation * 5003);
      const pts = displace3D(
        [brWpts[j], brWpts[j+1]],
        Math.max(1, segDepth - generation),
        roughness * Math.pow(0.75, generation),
        brRng,
      );
      brParts.push(j === 0 ? pts : pts.slice(1));
    }
    let brPts = ([] as LightningPt[]).concat(...brParts);

    // Turbulence
    if (turb > 0.01) {
      const tr = makePrng(seed * 7919 + seedBase + k * 997 + generation * 3001 + 0xCAFEBABE);
      brPts = displace3D(brPts, 2, turb * 1.2 * Math.pow(0.75, generation), tr);
    }

    outPts.push(brPts);
    outParentTs.push(parentMainT);
    outGenerations.push(generation);

    growSubBranches(
      brPts, parentMainT, generation + 1, maxGeneration,
      branchProb, subBrSeg, segDepth, roughness, boltLen, branchDecay,
      structRng, seed, seedBase + k * 7919, turb,
      outPts, outParentTs, outGenerations,
    );
  }
}

/**
 * Returns the main bolt and branch polylines in world space, plus canonical
 * waypoint positions that visualise where the Spine bones sit.
 */
export function buildLightningPreview(
  startX: number, startY: number,
  endX:   number, endY:   number,
  segmentDepth: number,
  roughness:    number,
  branchCount:  number,
  branchDecay:  number,
  seed:         number,
  numSegments?:       number,
  branchProbability?: number,
  subBranchSegments?: number,
  turbulence?:        number,
  branchLevels?:      number,
  bend?:              number,
  branchAngle?:       number,
): {
  main:              LightningPt[];
  branches:          LightningPt[][];
  /** Normalised T on main arc at which each branch should start growing (strike mode) */
  branchParentTs:    number[];
  /** Generation index: 0 = direct from main arc, 1 = sub-branch, etc. */
  branchGenerations: number[];
  waypoints:         LightningPt[];
  branchWaypoints:   LightningPt[][];
} {
  const numSeg     = getAdaptiveLightningSegments(numSegments ?? 4, bend ?? 0);
  const branchProb = Math.max(0, Math.min(1, branchProbability ?? 0.5));
    const brHalfRad  = ((branchAngle ?? 90) * Math.PI / 180);
  const subBrSeg   = Math.max(1, subBranchSegments ?? 2);
  const maxLevels  = Math.max(1, branchLevels ?? 2);
  const turb       = Math.max(0, turbulence ?? 0);
  const bendAmount = bend ?? 0;

  const ddx       = endX - startX, ddy = endY - startY;
  const boltLen   = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
  const boltAngle = Math.atan2(ddy, ddx);

  // Canonical (undisplaced) junction waypoints, optionally arced
  const waypoints: LightningPt[] = buildBolt(
    { x: startX, y: startY },
    { x: endX, y: endY },
    0,
    0,
    makePrng(0),
    bendAmount,
    numSeg,
  );

  // Per-segment displaced bolts joined into one main polyline
  const mainParts: LightningPt[][] = [];
  for (let i = 0; i < numSeg; i++) {
    const sp = waypoints[i], ep = waypoints[i + 1];
    const rng = makePrng(seed + i * 997);
    const pts = displace([sp, ep], segmentDepth, roughness, rng);
    mainParts.push(i === 0 ? pts : pts.slice(1));
  }
  const main: LightningPt[] = ([] as LightningPt[]).concat(...mainParts);

  // structRng drives WHICH junctions get branches and their angles/elevations.
  // Mixing `seed` in here means each loop-strike cycle produces a completely different
  // branch layout (junction selection + spread direction) in addition to a different shape.
  const structRng       = makePrng((0xABCD1234 + seed * 31337) | 0);
  const branches:        LightningPt[][] = [];
  const branchParentTs:  number[]        = [];
  const branchGenerations: number[]      = [];
  const branchWaypoints: LightningPt[][] = [];

  for (let k = 0; k < numSeg - 1; k++) {
    if (structRng() > branchProb) continue;

    const jPt      = waypoints[k + 1];
    const spread    = (structRng() - 0.5) * 2 * brHalfRad;
    const elevation = (structRng() - 0.5) * 2 * brHalfRad;
    const segA      = waypoints[k];
    const segB      = waypoints[Math.min(k + 1, waypoints.length - 1)];
    const localAngle = Math.atan2(segB.y - segA.y, segB.x - segA.x);
    const brAngle   = localAngle + spread;
    const cosEl     = Math.cos(elevation);
    const sinEl     = Math.sin(elevation);
    const junctionT = numSeg > 1 ? (k + 1) / numSeg : 0;
    const ageScale  = 0.6 + (1.0 - Math.max(0, Math.min(1, junctionT))) * 0.4;
    const brSegLen  = (boltLen * branchDecay * ageScale) / subBrSeg;
    const jz        = jPt.z ?? 0;

    const brWpts: LightningPt[] = [jPt];
    for (let j = 1; j <= subBrSeg; j++) {
      brWpts.push({
        x: jPt.x + Math.cos(brAngle) * cosEl * brSegLen * j,
        y: jPt.y + Math.sin(brAngle) * cosEl * brSegLen * j,
        z: jz      + sinEl * brSegLen * j,
      });
    }
    branchWaypoints.push(brWpts);

    const brParts: LightningPt[][] = [];
    for (let j = 0; j < subBrSeg; j++) {
      const brRng = makePrng(seed + k * 773 + j * 331);
      // Use 3D displacement so branch segments also wobble in Z
      const pts = displace3D([brWpts[j], brWpts[j + 1]], Math.max(1, segmentDepth - 1), roughness * 0.7, brRng);
      brParts.push(j === 0 ? pts : pts.slice(1));
    }
    const level0Pts = ([] as LightningPt[]).concat(...brParts);
    branches.push(level0Pts);
    branchParentTs.push(junctionT);
    branchGenerations.push(0);

    // Recursively grow sub-branches off this branch
    if (maxLevels > 1) {
      growSubBranches(
        level0Pts, junctionT, 1, maxLevels,
        branchProb, subBrSeg, segmentDepth, roughness, boltLen, branchDecay,
        structRng, seed, k * 8191, turb,
        branches, branchParentTs, branchGenerations,
      );
    }
  }

  // Secondary high-frequency turbulence pass
  const applyTurb2D = (pts: LightningPt[], offset: number): LightningPt[] => {
    if (turb < 0.01) return pts;
    return displace(pts, 2, turb * 1.4, makePrng(seed * 7919 + offset + 0xCAFEBABE));
  };
  const applyTurb3D = (pts: LightningPt[], offset: number): LightningPt[] => {
    if (turb < 0.01) return pts;
    return displace3D(pts, 2, turb * 1.4, makePrng(seed * 7919 + offset + 0xCAFEBABE));
  };

  // Level-0 branches had turbulence applied inside growSubBranches loop;
  // only the first `branchWaypoints.length` entries are level-0 and need turb here.
  const numLevel0 = branchWaypoints.length;
  return {
    main:              applyTurb2D(main, 0),
    branches:          branches.map((b, i) => i < numLevel0 ? applyTurb3D(b, (i+1)*997) : b),
    branchParentTs,
    branchGenerations,
    waypoints,
    branchWaypoints,
  };
}
