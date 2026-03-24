/**
 * Photoshop ABR brush file parser.
 * Supports version 1, 2 (legacy) and version 6, 7 (CS2+).
 * Only extracts sampled brush tips (type=2); computed round brushes are skipped.
 */

export interface AbrBrush {
  name: string;
  width: number;
  height: number;
  /** Grayscale alpha mask: 0 = full paint, 255 = transparent (Photoshop convention) */
  pixels: Uint8Array;
  /** 64×64 preview data URL — white brush strokes on dark background */
  thumbnail: string;
}

// ─── PackBits (RLE) decompressor ─────────────────────────────────────────────

function unpackBits(src: Uint8Array, expectedSize: number): Uint8Array {
  const out = new Uint8Array(expectedSize);
  let si = 0;
  let di = 0;
  while (di < expectedSize && si < src.length) {
    const header = src[si++];
    if (header === 128) {
      // no-op
    } else if (header > 128) {
      const count = 256 - header + 1;
      const val = src[si++];
      for (let k = 0; k < count && di < expectedSize; k++) out[di++] = val;
    } else {
      const count = header + 1;
      for (let k = 0; k < count && di < expectedSize; k++) out[di++] = src[si++];
    }
  }
  return out;
}

// ─── Thumbnail generator ─────────────────────────────────────────────────────

function makeThumb(pixels: Uint8Array, w: number, h: number): string {
  const SZ = 64;
  // source canvas
  const srcC = document.createElement('canvas');
  srcC.width = w; srcC.height = h;
  const sCtx = srcC.getContext('2d')!;
  const id = sCtx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    // invert: 0=paint → alpha 255; 255=transparent → alpha 0
    const alpha = 255 - pixels[i];
    id.data[i * 4]     = 255;
    id.data[i * 4 + 1] = 255;
    id.data[i * 4 + 2] = 255;
    id.data[i * 4 + 3] = alpha;
  }
  sCtx.putImageData(id, 0, 0);

  // thumb canvas
  const c = document.createElement('canvas');
  c.width = c.height = SZ;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#18182c';
  ctx.fillRect(0, 0, SZ, SZ);
  ctx.drawImage(srcC, 0, 0, SZ, SZ);
  return c.toDataURL('image/png');
}

// ─── Pascal string reader ─────────────────────────────────────────────────────

function readPascal(view: DataView, pos: number): { str: string; len: number } {
  const nameLen = view.getUint8(pos);
  let str = '';
  for (let i = 0; i < nameLen; i++) str += String.fromCharCode(view.getUint8(pos + 1 + i));
  // Pad the total (1 length byte + nameLen content bytes) to an even number
  const total = 1 + nameLen;
  const paddedTotal = total % 2 === 0 ? total : total + 1;
  return { str, len: paddedTotal };
}

// ─── Version 6/7 parser ───────────────────────────────────────────────────────

function parseSampledV6(view: DataView, start: number, blockEnd: number): Omit<AbrBrush, 'thumbnail'> | null {
  let p = start;
  try {
    p += 4; // misc (int32)
    p += 2; // spacing (int16)

    // Name — Pascal string
    const { str: name, len: nameBytes } = readPascal(view, p);
    p += nameBytes;

    p += 1; // antialiasing

    // Short bounds: top, left, bottom, right (4 × int16)
    const top    = view.getInt16(p); p += 2;
    const left   = view.getInt16(p); p += 2;
    const bottom = view.getInt16(p); p += 2;
    const right  = view.getInt16(p); p += 2;

    // Long bounds: top, left, bottom, right (4 × int32)
    const lTop    = view.getInt32(p); p += 4;
    const lLeft   = view.getInt32(p); p += 4;
    const lBottom = view.getInt32(p); p += 4;
    const lRight  = view.getInt32(p); p += 4;

    const w = (lRight - lLeft) || (right - left);
    const h = (lBottom - lTop) || (bottom - top);

    if (w <= 0 || h <= 0 || w > 4096 || h > 4096) return null;

    const depth = view.getInt16(p); p += 2;
    if (depth !== 8 && depth !== 16) return null;

    const compression = view.getUint8(p); p += 1;
    const pixCount = w * h;
    let pixels: Uint8Array;

    if (compression === 0) {
      // Raw bytes
      pixels = new Uint8Array(view.buffer, view.byteOffset + p, pixCount);
    } else if (compression === 1) {
      // PackBits: row byte-counts array (int16 × h), then compressed data
      let totalComp = 0;
      const rowCounts: number[] = [];
      for (let row = 0; row < h; row++) {
        const rc = view.getUint16(p); p += 2;
        rowCounts.push(rc);
        totalComp += rc;
      }
      const compData = new Uint8Array(view.buffer, view.byteOffset + p, Math.min(totalComp, view.byteLength - p));
      pixels = unpackBits(compData, pixCount);
    } else {
      return null;
    }

    // Down-sample 16→8 bit
    if (depth === 16) {
      const p8 = new Uint8Array(pixCount);
      for (let i = 0; i < pixCount; i++) p8[i] = pixels[i * 2];
      pixels = p8;
    }

    return { name: name.trim() || 'Brush', width: w, height: h, pixels: new Uint8Array(pixels) };
  } catch (e) {
    console.warn('[ABR] parseSampledV6 failed', e);
    return null;
  }
}

function parseV6(view: DataView, offset: number): AbrBrush[] {
  const results: AbrBrush[] = [];
  const end = view.byteLength;
  let pos = offset;

  while (pos + 6 <= end) {
    // V6 block header: type = int16 (2 bytes), size = int32 (4 bytes)
    const brushType = view.getInt16(pos); pos += 2;
    const blockSize = view.getInt32(pos); pos += 4;
    const blockEnd  = pos + blockSize;

    if (blockSize <= 0 || blockEnd > end) break;

    if (brushType === 2) { // 2 = sampled tip
      const b = parseSampledV6(view, pos, blockEnd);
      if (b) results.push({ ...b, thumbnail: makeThumb(b.pixels, b.width, b.height) });
    }

    pos = blockEnd;
  }

  return results;
}

// ─── Version 1/2 parser ───────────────────────────────────────────────────────

function parseSampledV1V2(view: DataView, pos: number, version: number, blockEnd: number): Omit<AbrBrush, 'thumbnail'> | null {
  let p = pos;
  try {
    p += 4; // misc (int32)
    p += 2; // spacing (int16)

    const { str: name, len: nameBytes } = readPascal(view, p);
    p += nameBytes;

    p += 1; // antialiasing

    // Bounds: top, left, bottom, right (4 × int16)
    const top    = view.getInt16(p); p += 2;
    const left   = view.getInt16(p); p += 2;
    const bottom = view.getInt16(p); p += 2;
    const right  = view.getInt16(p); p += 2;

    const w = right - left;
    const h = bottom - top;

    p += 4; // uniqueId (int32)

    if (version === 2) {
      const uLen = view.getUint16(p); p += 2;
      p += uLen * 2; // unicode name (int16 chars)
    }

    p += 1; // isObsolete
    p += 1; // is默认Calculated
    p += 1; // hasBlob
    p += 1; // isCustom
    p += 2; // padding

    const depth = view.getInt16(p); p += 2;
    if (depth !== 8) return null;

    const compression = view.getUint8(p); p += 1;

    if (w <= 0 || h <= 0 || w > 4096 || h > 4096) return null;

    const pixCount = w * h;
    let pixels: Uint8Array;

    if (compression === 0) {
      pixels = new Uint8Array(view.buffer, view.byteOffset + p, pixCount);
    } else if (compression === 1) {
      const rowCounts: number[] = [];
      let totalComp = 0;
      for (let row = 0; row < h; row++) {
        const rc = view.getUint16(p); p += 2;
        rowCounts.push(rc);
        totalComp += rc;
      }
      const avail = Math.min(totalComp, view.byteLength - p);
      const compData = new Uint8Array(view.buffer, view.byteOffset + p, avail);
      pixels = unpackBits(compData, pixCount);
    } else {
      return null;
    }

    return { name: name.trim() || 'Brush', width: w, height: h, pixels: new Uint8Array(pixels) };
  } catch (e) {
    console.warn('[ABR] parseSampledV1V2 failed', e);
    return null;
  }
}

function parseV1V2(view: DataView, offset: number, version: number): AbrBrush[] {
  const results: AbrBrush[] = [];
  const end = view.byteLength;
  if (offset + 2 > end) return results;

  const count = view.getUint16(offset);
  let pos = offset + 2;

  for (let i = 0; i < count && pos < end - 6; i++) {
    const brushType = view.getUint16(pos); pos += 2;
    const dataSize  = view.getUint32(pos); pos += 4;
    const blockEnd  = pos + dataSize;

    if (blockEnd > end) break;

    if (brushType === 2) { // 2 = sampled, 1 = computed round
      const b = parseSampledV1V2(view, pos, version, blockEnd);
      if (b) results.push({ ...b, thumbnail: makeThumb(b.pixels, b.width, b.height) });
    }

    pos = blockEnd;
  }

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a Photoshop .abr file and return all brush tip images.
 * Call in a FileReader `onload` callback: `parseAbr(reader.result as ArrayBuffer)`.
 */
export function parseAbr(buffer: ArrayBuffer): AbrBrush[] {
  const view = new DataView(buffer);
  if (view.byteLength < 4) return [];

  const version = view.getInt16(0);
  let results: AbrBrush[] = [];

  if (version === 6 || version === 7) {
    results = parseV6(view, 4);
  } else if (version === 1 || version === 2) {
    results = parseV1V2(view, 4, version);
  } else {
    console.warn('[ABR] Unrecognised version:', version);
  }

  console.log(`[ABR] v${version} → ${results.length} sampled brushes`);
  return results;
}
