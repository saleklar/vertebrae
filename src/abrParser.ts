import { readAbr } from 'ag-psd';

export interface AbrBrush {
  name: string;
  width: number;
  height: number;
  /** Grayscale alpha mask: 255 = transparent, 0 = full paint (we will normalize ag-psd to this) */
  pixels: Uint8Array;
  /** 64x64 preview data URL */
  thumbnail: string;
}

function makeThumb(pixels: Uint8Array, w: number, h: number): string {
  const SZ = 64;
  const srcC = document.createElement('canvas');
  srcC.width = w;
  srcC.height = h;
  const sCtx = srcC.getContext('2d')!;
  const id = sCtx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    // We will normalize our "pixels" array to match the old Photoshop standard (0 = paint, 255 = transparent)
    // CustomParticlePainter expects it this way when parsing inverted alpha.
    const alpha = 255 - pixels[i];
    id.data[i * 4]     = 255;
    id.data[i * 4 + 1] = 255;
    id.data[i * 4 + 2] = 255;
    id.data[i * 4 + 3] = alpha;
  }
  sCtx.putImageData(id, 0, 0);

  const c = document.createElement('canvas');
  c.width = c.height = SZ;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#18182c';
  ctx.fillRect(0, 0, SZ, SZ);
  ctx.drawImage(srcC, 0, 0, Math.max(1, w), Math.max(1, h), 0, 0, SZ, SZ);
  return c.toDataURL('image/png');
}

export function parseAbr(buffer: ArrayBuffer): AbrBrush[] {
  try {
    const abr = readAbr(new Uint8Array(buffer));
    const results: AbrBrush[] = [];

    // 'samples' corresponds to actual brush bitmap data
    if (abr.samples && abr.samples.length > 0) {
      for (let i = 0; i < abr.samples.length; i++) {
        const sample = abr.samples[i];
        
        // Sometimes valid names are stored in brushes[] based on sample id
        // but 'id' is standard. ag-psd stores alpha where 255 is opaque, 0 is transparent!
        // The old custom particle painter expects 0 to be opaque and 255 transparent.
        // Let's invert ag-psd's alpha map so it matches `CustomParticlePainter.tsx`
        const w = sample.bounds.w;
        const h = sample.bounds.h;
        
        if (w <= 0 || h <= 0) continue;

        // ag-psd returns standard alpha mask where 255 = paint, 0 = transparent.
        // CustomParticlePainter expects it inverted: 0 = paint, 255 = transparent.
        const pixels = new Uint8Array(w * h);
        for(let p = 0; p < w * h; p++) {
          pixels[p] = 255 - sample.alpha[p];
        }

        let name = sample.id || 'Untitled Brush';
        
        // Find the actual brush name from the brushes array if possible
        if (abr.brushes) {
          const matchedBrush = abr.brushes.find(b => b.shape?.type === 'sampled' && b.shape.sampledData === sample.id);
          if (matchedBrush && matchedBrush.name) {
            name = matchedBrush.name;
          }
        }

        results.push({
          name: name.trim() || 'Brush',
          width: w,
          height: h,
          pixels,
          thumbnail: makeThumb(pixels, w, h),
        });
      }
    }

    console.log(`[ABR] ag-psd parsed → ${results.length} sampled brushes`);
    return results;
  } catch (err) {
    console.error('[ABR] failed to parse using ag-psd:', err);
    return [];
  }
}
