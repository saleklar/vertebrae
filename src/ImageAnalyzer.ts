// Image analysis and region detection for coin textures

export type DetectedRegion = {
  id: string;
  name: string;
  pixels: Set<number>; // Pixel indices
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  averageBrightness: number;
  area: number;
  centroid: { x: number; y: number };
  isBackground: boolean;
};

export type RegionElevationSettings = {
  regionId: string;
  elevation: number; // 0-1, where 0.5 is flat, >0.5 is raised, <0.5 is lowered
  smoothing: number; // Edge smoothing factor
};

export class CoinImageAnalyzer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData | null = null;
  private originalImageData: ImageData | null = null;
  private width: number = 0;
  private height: number = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    this.ctx = ctx;
  }

  async loadImage(imageSrc: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.width = img.width;
        this.height = img.height;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        
        this.ctx.drawImage(img, 0, 0);
        const data = this.ctx.getImageData(0, 0, this.width, this.height);
        this.originalImageData = new ImageData(
          new Uint8ClampedArray(data.data),
          data.width,
          data.height
        );
        this.imageData = new ImageData(
          new Uint8ClampedArray(data.data),
          data.width,
          data.height
        );
        resolve();
      };
      img.onerror = reject;
      img.src = imageSrc;
    });
  }

  restoreOriginal(): void {
    if (!this.originalImageData) throw new Error('No original image stored');
    this.imageData = new ImageData(
      new Uint8ClampedArray(this.originalImageData.data),
      this.originalImageData.width,
      this.originalImageData.height
    );
  }

  normalizeColors(saturationReduction: number = 0.7, contrastEnhance: number = 1.2): void {
    if (!this.imageData) throw new Error('No image loaded');

    const data = this.imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      let l = (max + min) / 2;

      let s = 0;
      if (max !== min) {
        s = l < 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min);
      }
      s = s * (1 - saturationReduction);

      let h = 0;
      if (max !== min) {
        if (max === r / 255) {
          h = (((g - b) / 255) / (max - min) + (g < b ? 6 : 0)) / 6;
        } else if (max === g / 255) {
          h = (((b - r) / 255) / (max - min) + 2) / 6;
        } else {
          h = (((r - g) / 255) / (max - min) + 4) / 6;
        }
      }

      l = ((l - 0.5) * contrastEnhance) + 0.5;
      l = Math.max(0, Math.min(1, l));

      const newColor = this.hslToRgb(h, s, l);
      data[i] = newColor.r;
      data[i + 1] = newColor.g;
      data[i + 2] = newColor.b;
    }
  }

  equalizeHistogram(): void {
    if (!this.imageData) throw new Error('No image loaded');

    const data = this.imageData.data;
    const width = this.width;
    const height = this.height;

    const histogram = new Array(256).fill(0);
    const grayData = new Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      grayData[i / 4] = gray;
      histogram[gray]++;
    }

    const cdf = new Array(256);
    let sum = 0;
    const numPixels = width * height;
    for (let i = 0; i < 256; i++) {
      sum += histogram[i];
      cdf[i] = Math.round((sum / numPixels) * 255);
    }

    for (let i = 0; i < grayData.length; i++) {
      const oldValue = grayData[i];
      const newValue = cdf[oldValue];
      const idx = i * 4;
      data[idx] = newValue;
      data[idx + 1] = newValue;
      data[idx + 2] = newValue;
    }
  }

  detectRegions(
    sensitivity: number = 30,
    minRegionSize: number = 100,
    lineStrength: number = 0.65
  ): DetectedRegion[] {
    if (!this.imageData) throw new Error('No image loaded');

    const visited = new Array(this.width * this.height).fill(false);
    const regions: DetectedRegion[] = [];

    const luminance = this.buildLuminanceMap();
    const smoothedLuminance = this.boxBlur(luminance, 2);
    const boundaryMask = this.detectBoundaryMask(smoothedLuminance, sensitivity, lineStrength);

    let regionId = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        if (visited[idx]) continue;
        if (boundaryMask[idx] === 1) {
          visited[idx] = true;
          continue;
        }

        const region = this.floodFillByBoundaries(x, y, boundaryMask, visited);
        if (!region || region.pixels.size < minRegionSize) continue;

        region.id = `region-${regionId++}`;
        region.name = this.guessRegionName(region);
        regions.push(region);
      }
    }

    regions.sort((a, b) => b.area - a.area);

    if (regions.length > 0) {
      regions[0].isBackground = true;
      regions[0].name = 'Background/Field';
    }

    return regions;
  }

  private buildLuminanceMap(): Uint8Array {
    if (!this.imageData) throw new Error('No image loaded');
    const data = this.imageData.data;
    const luminance = new Uint8Array(this.width * this.height);

    for (let i = 0; i < data.length; i += 4) {
      const idx = i / 4;
      luminance[idx] = Math.round(
        data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      );
    }

    return luminance;
  }

  private boxBlur(input: Uint8Array, radius: number): Uint8Array {
    if (radius <= 0) return input;

    const output = new Uint8Array(this.width * this.height);
    const diameter = radius * 2 + 1;
    const kernelArea = diameter * diameter;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let sum = 0;

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = Math.max(0, Math.min(this.width - 1, x + dx));
            const ny = Math.max(0, Math.min(this.height - 1, y + dy));
            sum += input[ny * this.width + nx];
          }
        }

        output[y * this.width + x] = Math.round(sum / kernelArea);
      }
    }

    return output;
  }

  private detectBoundaryMask(
    luminance: Uint8Array,
    sensitivity: number,
    lineStrength: number
  ): Uint8Array {
    const mask = new Uint8Array(this.width * this.height);
    const normalized = Math.max(0, Math.min(1, (sensitivity - 10) / 90));
    const lineBias = Math.max(0, Math.min(1, lineStrength));

    // Lower sensitivity => stricter boundaries (more split)
    // Higher sensitivity => fewer boundaries (more merged regions)
    const darkPercentile = 0.36 - normalized * 0.14 - lineBias * 0.16;
    const gradientThreshold = 10 + normalized * 30 - lineBias * 10;

    const sorted = Array.from(luminance).sort((a, b) => a - b);
    const percentileIndex = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * darkPercentile)));
    const darkThreshold = sorted[percentileIndex];

    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        const idx = y * this.width + x;
        const lum = luminance[idx];

        const gx =
          -luminance[(y - 1) * this.width + (x - 1)] + luminance[(y - 1) * this.width + (x + 1)] +
          -2 * luminance[y * this.width + (x - 1)] + 2 * luminance[y * this.width + (x + 1)] +
          -luminance[(y + 1) * this.width + (x - 1)] + luminance[(y + 1) * this.width + (x + 1)];

        const gy =
          -luminance[(y - 1) * this.width + (x - 1)] - 2 * luminance[(y - 1) * this.width + x] - luminance[(y - 1) * this.width + (x + 1)] +
          luminance[(y + 1) * this.width + (x - 1)] + 2 * luminance[(y + 1) * this.width + x] + luminance[(y + 1) * this.width + (x + 1)];

        const gradientMagnitude = Math.sqrt(gx * gx + gy * gy) / 8;
        const isDarkBoundary = lum <= darkThreshold;
        const isStrongEdge = gradientMagnitude >= gradientThreshold;

        mask[idx] = isDarkBoundary || isStrongEdge ? 1 : 0;
      }
    }

    const expandRadius = normalized < 0.4 || lineBias > 0.75 ? 1 : 0;
    return this.expandMask(mask, expandRadius);
  }

  private expandMask(mask: Uint8Array, radius: number): Uint8Array {
    if (radius <= 0) return mask;

    const expanded = new Uint8Array(mask.length);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        if (mask[idx] === 1) {
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
              expanded[ny * this.width + nx] = 1;
            }
          }
        }
      }
    }

    return expanded;
  }

  private floodFillByBoundaries(
    startX: number,
    startY: number,
    boundaryMask: Uint8Array,
    visited: boolean[]
  ): DetectedRegion | null {
    if (!this.imageData) throw new Error('No image loaded');

    const startIdx = startY * this.width + startX;
    if (boundaryMask[startIdx] === 1) return null;

    const data = this.imageData.data;
    const queue: [number, number][] = [[startX, startY]];
    const pixels = new Set<number>();

    let minX = startX;
    let maxX = startX;
    let minY = startY;
    let maxY = startY;
    let totalBrightness = 0;
    let sumX = 0;
    let sumY = 0;

    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;

      const idx = y * this.width + x;
      if (visited[idx]) continue;
      visited[idx] = true;

      if (boundaryMask[idx] === 1) continue;

      pixels.add(idx);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      const brightness = (data[idx * 4] + data[idx * 4 + 1] + data[idx * 4 + 2]) / 3;
      totalBrightness += brightness;
      sumX += x;
      sumY += y;

      queue.push([x + 1, y]);
      queue.push([x - 1, y]);
      queue.push([x, y + 1]);
      queue.push([x, y - 1]);
    }

    if (pixels.size === 0) return null;

    return {
      id: '',
      name: '',
      pixels,
      bounds: { minX, minY, maxX, maxY },
      averageBrightness: totalBrightness / pixels.size,
      area: pixels.size,
      centroid: { x: sumX / pixels.size, y: sumY / pixels.size },
      isBackground: false,
    };
  }

  private guessRegionName(region: DetectedRegion): string {
    const width = region.bounds.maxX - region.bounds.minX;
    const height = region.bounds.maxY - region.bounds.minY;
    const aspectRatio = width / height;
    
    // Try to identify what this region might be
    if (aspectRatio > 2 || aspectRatio < 0.5) {
      return 'Text/Number';
    } else if (region.area < 1000) {
      return 'Detail';
    } else if (region.averageBrightness > 200) {
      return 'Highlight';
    } else if (region.averageBrightness < 50) {
      return 'Shadow/Engraving';
    } else {
      return 'Symbol/Design';
    }
  }

  // Generate height map from region selections
  generateHeightMap(
    regions: DetectedRegion[],
    elevationSettings: RegionElevationSettings[]
  ): ImageData {
    if (!this.imageData) throw new Error('No image loaded');

    const heightMap = new ImageData(this.width, this.height);
    const heightData = heightMap.data;
    
    // Initialize all pixels to middle gray (flat surface)
    for (let i = 0; i < heightData.length; i += 4) {
      heightData[i] = 128;
      heightData[i + 1] = 128;
      heightData[i + 2] = 128;
      heightData[i + 3] = 255;
    }

    // Apply elevation settings to each region
    for (const setting of elevationSettings) {
      const region = regions.find(r => r.id === setting.regionId);
      if (!region) continue;

      const targetHeight = setting.elevation * 255;
      
      // Apply height to all pixels in region
      for (const pixelIdx of region.pixels) {
        const dataIdx = pixelIdx * 4;
        heightData[dataIdx] = targetHeight;
        heightData[dataIdx + 1] = targetHeight;
        heightData[dataIdx + 2] = targetHeight;
      }
    }

    // Apply smoothing
    const smoothed = this.smoothHeightMap(heightMap, elevationSettings);
    
    return smoothed;
  }

  private smoothHeightMap(heightMap: ImageData, settings: RegionElevationSettings[]): ImageData {
    const result = new ImageData(this.width, this.height);
    const input = heightMap.data;
    const output = result.data;
    
    const maxSmoothing = Math.max(...settings.map(s => s.smoothing), 1);
    const kernelSize = Math.ceil(maxSmoothing * 5);
    
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = (y * this.width + x) * 4;
        
        let sum = 0;
        let count = 0;
        
        // Gaussian-like smoothing
        for (let dy = -kernelSize; dy <= kernelSize; dy++) {
          for (let dx = -kernelSize; dx <= kernelSize; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            
            if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
            
            const nidx = (ny * this.width + nx) * 4;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const weight = Math.exp(-(dist * dist) / (2 * maxSmoothing * maxSmoothing));
            
            sum += input[nidx] * weight;
            count += weight;
          }
        }
        
        const smoothed = sum / count;
        output[idx] = smoothed;
        output[idx + 1] = smoothed;
        output[idx + 2] = smoothed;
        output[idx + 3] = 255;
      }
    }
    
    return result;
  }

  // Get preview of regions with colors
  getRegionPreview(regions: DetectedRegion[], highlightedRegionId?: string): ImageData {
    if (!this.imageData) throw new Error('No image loaded');

    const preview = new ImageData(this.width, this.height);
    const previewData = preview.data;
    const originalData = this.imageData.data;
    
    // Copy original image
    for (let i = 0; i < originalData.length; i++) {
      previewData[i] = originalData[i];
    }
    
    // Overlay region colors
    const colors = this.generateRegionColors(regions.length);
    
    regions.forEach((region, index) => {
      const color = colors[index];
      const alpha = region.id === highlightedRegionId ? 0.85 : 0.4;
      
      for (const pixelIdx of region.pixels) {
        const dataIdx = pixelIdx * 4;
        previewData[dataIdx] = previewData[dataIdx] * (1 - alpha) + color.r * alpha;
        previewData[dataIdx + 1] = previewData[dataIdx + 1] * (1 - alpha) + color.g * alpha;
        previewData[dataIdx + 2] = previewData[dataIdx + 2] * (1 - alpha) + color.b * alpha;
      }
    });

    const regionByPixel = new Int32Array(this.width * this.height).fill(-1);
    regions.forEach((region, regionIndex) => {
      for (const pixelIdx of region.pixels) {
        regionByPixel[pixelIdx] = regionIndex;
      }
    });

    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        const idx = y * this.width + x;
        const regionIndex = regionByPixel[idx];
        if (regionIndex < 0) continue;

        const currentRegion = regions[regionIndex];
        const n1 = regionByPixel[idx - 1];
        const n2 = regionByPixel[idx + 1];
        const n3 = regionByPixel[idx - this.width];
        const n4 = regionByPixel[idx + this.width];

        const isBoundary = n1 !== regionIndex || n2 !== regionIndex || n3 !== regionIndex || n4 !== regionIndex;
        if (!isBoundary) continue;

        const dataIdx = idx * 4;
        const highlighted = currentRegion.id === highlightedRegionId;
        const outlineColor = highlighted
          ? { r: 255, g: 255, b: 255 }
          : { r: 20, g: 20, b: 20 };

        previewData[dataIdx] = outlineColor.r;
        previewData[dataIdx + 1] = outlineColor.g;
        previewData[dataIdx + 2] = outlineColor.b;
        previewData[dataIdx + 3] = 255;
      }
    }
    
    return preview;
  }

  private generateRegionColors(count: number): Array<{ r: number; g: number; b: number }> {
    const colors: Array<{ r: number; g: number; b: number }> = [];
    
    for (let i = 0; i < count; i++) {
      const hue = (i * 360 / count) % 360;
      const rgb = this.hslToRgb(hue / 360, 0.7, 0.5);
      colors.push(rgb);
    }
    
    return colors;
  }

  private hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }
}
