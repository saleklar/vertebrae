// Utility functions for generating procedural textures and maps

// Generate ridges for cylinder body (vertical grooves around the circumference)
// X = angle around cylinder, Y = height
export function generateCylinderBodyRidges(
  width: number,
  height: number,
  ridgeCount: number = 12,
  ridgeHeight: number = 0.3
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // Fill with base gray
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;

      // X normalized to 0-1 (wraps around cylinder)
      // Y normalized to 0-1 (from bottom to top of cylinder)
      const normalizedX = x / width; // Angle around cylinder
      const normalizedY = y / height; // Height along cylinder

      // Vertical grooves: vary by angle (X), remain continuous along height (Y)
      const ridgePhase = normalizedX * ridgeCount * Math.PI * 2;
      const ridgeWave = Math.sin(ridgePhase);

      // Fade ridges in/out at top and bottom (last 15% of height)
      const verticalFade = Math.sin(Math.max(0, Math.min(1, normalizedY) * Math.PI)) * 0.85 + 0.15;

      // Base height + ridge variation
      const baseHeight = 128;
      const heightVariation = ridgeWave * ridgeHeight * 255 * verticalFade;
      const heightValue = Math.max(0, Math.min(255, baseHeight + heightVariation));

      data[index] = heightValue;
      data[index + 1] = heightValue;
      data[index + 2] = heightValue;
      data[index + 3] = 255;
    }
  }

  return imageData;
}

export function generateCoinRidgePattern(
  width: number,
  height: number,
  ridgeCount: number = 100,
  ridgeDepth: number = 0.3
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // Fill with base gray
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      const index = (y * width + x) * 4;

      // Create ridges only on the outer edge
      const edgeStart = maxRadius * 0.85; // Ridges start at 85% of radius
      
      if (distance >= edgeStart && distance <= maxRadius) {
        // Calculate ridge pattern based on angle
        const ridgePhase = (angle + Math.PI) / (2 * Math.PI); // 0 to 1
        const ridgeValue = Math.sin(ridgePhase * ridgeCount * Math.PI * 2);
        
        // Fade ridges based on distance from edge
        const edgePosition = (distance - edgeStart) / (maxRadius - edgeStart);
        const edgeFade = Math.sin(edgePosition * Math.PI); // 0 at start/end, 1 in middle
        
        // Calculate height value
        const baseHeight = 128; // Middle gray
        const heightVariation = ridgeValue * ridgeDepth * 255 * edgeFade;
        const heightValue = Math.max(0, Math.min(255, baseHeight + heightVariation));

        data[index] = heightValue;
        data[index + 1] = heightValue;
        data[index + 2] = heightValue;
        data[index + 3] = 255;
      } else if (distance > maxRadius) {
        // Outside circle - transparent/black
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 0;
      } else {
        // Inside main coin area - smooth surface with slight variation
        const variation = Math.sin(distance * 0.1) * 10;
        const value = 128 + variation;
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
        data[index + 3] = 255;
      }
    }
  }

  return imageData;
}

export function generateCoinBevelPattern(
  width: number,
  height: number,
  bevelWidth: number = 0.05
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const normalizedDist = distance / maxRadius;

      const index = (y * width + x) * 4;

      if (distance > maxRadius) {
        // Outside circle
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 0;
      } else {
        let heightValue = 128;

        // Create bevel at edge
        if (normalizedDist > (1 - bevelWidth)) {
          const bevelPos = (normalizedDist - (1 - bevelWidth)) / bevelWidth;
          const bevelHeight = Math.cos(bevelPos * Math.PI / 2);
          heightValue = 128 + bevelHeight * 80;
        } else if (normalizedDist < bevelWidth) {
          // Optional: slight rise in center
          const centerPos = normalizedDist / bevelWidth;
          const centerHeight = Math.sin(centerPos * Math.PI / 2);
          heightValue = 128 + centerHeight * 20;
        }

        data[index] = heightValue;
        data[index + 1] = heightValue;
        data[index + 2] = heightValue;
        data[index + 3] = 255;
      }
    }
  }

  return imageData;
}

export function generateNormalMapFromHeight(
  heightData: ImageData,
  strength: number = 10
): ImageData {
  const width = heightData.width;
  const height = heightData.height;
  const data = heightData.data;
  const normalData = new ImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;

      const getHeight = (px: number, py: number) => {
        px = Math.max(0, Math.min(width - 1, px));
        py = Math.max(0, Math.min(height - 1, py));
        const idx = (py * width + px) * 4;
        return data[idx] / 255;
      };

      const left = getHeight(x - 1, y);
      const right = getHeight(x + 1, y);
      const up = getHeight(x, y - 1);
      const down = getHeight(x, y + 1);

      const dx = (right - left) * strength;
      const dy = (down - up) * strength;
      const dz = 1;

      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const nx = dx / length;
      const ny = dy / length;
      const nz = dz / length;

      normalData.data[index] = ((nx + 1) * 0.5 * 255) | 0;
      normalData.data[index + 1] = ((ny + 1) * 0.5 * 255) | 0;
      normalData.data[index + 2] = ((nz + 1) * 0.5 * 255) | 0;
      normalData.data[index + 3] = 255;
    }
  }

  return normalData;
}

export function imageDataToDataURL(imageData: ImageData, format: 'png' | 'jpg' = 'png'): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL(`image/${format}`);
}

export function generateEmbossedText(
  width: number,
  height: number,
  text: string,
  fontSize: number = 40
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // Base gray
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, width, height);

  // Draw text
  ctx.fillStyle = '#a0a0a0';
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);

  return ctx.getImageData(0, 0, width, height);
}

export type CoinPreset = {
  name: string;
  ridgeCount: number;
  ridgeDepth: number;
  bevelWidth: number;
  metalness: number;
  roughness: number;
  color: string;
};

export const COIN_PRESETS: Record<string, CoinPreset> = {
  gold: {
    name: 'Gold Coin',
    ridgeCount: 100,
    ridgeDepth: 0.3,
    bevelWidth: 0.05,
    metalness: 1.0,
    roughness: 0.2,
    color: '#ffd700',
  },
  silver: {
    name: 'Silver Coin',
    ridgeCount: 120,
    ridgeDepth: 0.25,
    bevelWidth: 0.04,
    metalness: 1.0,
    roughness: 0.15,
    color: '#c0c0c0',
  },
  bronze: {
    name: 'Bronze Coin',
    ridgeCount: 80,
    ridgeDepth: 0.35,
    bevelWidth: 0.06,
    metalness: 0.9,
    roughness: 0.3,
    color: '#cd7f32',
  },
  copper: {
    name: 'Copper Coin',
    ridgeCount: 90,
    ridgeDepth: 0.3,
    bevelWidth: 0.05,
    metalness: 0.95,
    roughness: 0.25,
    color: '#b87333',
  },
  ancient: {
    name: 'Ancient Coin',
    ridgeCount: 60,
    ridgeDepth: 0.2,
    bevelWidth: 0.08,
    metalness: 0.7,
    roughness: 0.5,
    color: '#8b8378',
  },
};
