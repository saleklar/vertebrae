import React, { useState, useRef, useEffect } from 'react';
import { Scene3DAnimator } from './Scene3DAnimator';
import { RegionSelector } from './RegionSelector';
import JSZip from 'jszip';
import * as THREE from 'three';
import {
  AnimatorProject,
  AnimatorObject,
  AnimatorLightSettings,
  AnimatorAnimationSettings,
  AnimatorRenderSettings,
  AnimatorEffectsSettings,
  AnimatorGeometryType,
  RenderProgress,
} from './Animator3DTypes';
import {
  generateCoinRidgePattern,
  generateCylinderBodyRidges,
  generateCoinBevelPattern,
  generateNormalMapFromHeight,
  imageDataToDataURL,
  COIN_PRESETS,
  CoinPreset,
} from './TextureGenerator';

/**
 * Analyzes cylinder geometry and returns optimal UV mapping values
 */
function autoFitCylinderUVs(object: AnimatorObject): {
  capUvScaleX: number;
  capUvScaleY: number;
  sideUvScaleX: number;
  sideUvScaleY: number;
} {
  const geomParams = object.geometryParams;
  const isCoin = object.geometry === 'coin';
  const radiusTop = geomParams.radiusTop || 50;
  const radiusBottom = isCoin ? radiusTop : (geomParams.radiusBottom || 50);
  const height = isCoin ? (geomParams.coinFrameHeight || 20) : (geomParams.height || 100);

  // For caps: always 1:1 (circular faces should fit in 0-1 range)
  const capUvScale = 1.0;

  // For side: scale UV horizontally based on circumference vs height
  // Default assumption: texture is roughly square, so we want aspect-matched tiling
  const avgRadius = (radiusTop + radiusBottom) / 2;
  const circumference = 2 * Math.PI * avgRadius;
  
  // Key insight: if circumference >> height, we need more horizontal wraps
  // Ratio of circumference to height directly determines U scale
  // For a 50-radius, 100-height cylinder:
  //   circumference = 314, height = 100, ratio = 3.14 (good starting point)
  let sideUvScaleX = circumference / height;
  
  // Don't clamp too tightly - allow reasonable range for various aspect ratios
  sideUvScaleX = Math.max(0.25, Math.min(8, sideUvScaleX));
  
  const sideUvScaleY = 1.0;

  return {
    capUvScaleX: capUvScale,
    capUvScaleY: capUvScale,
    sideUvScaleX: parseFloat(sideUvScaleX.toFixed(2)),
    sideUvScaleY: sideUvScaleY,
  };
}

const DEFAULT_ANIMATOR_OBJECT: AnimatorObject = {
  id: 'obj-1',
  name: 'Cylinder',
  geometry: 'cylinder',
  geometryParams: {
    radiusTop: 50,
    radiusBottom: 50,
    height: 20,
    radialSegments: 64,
    edgeBevel: 0.06,
  },
  material: {
    useSeparateSideMaterial: true,
    sideColor: '#b8860b',
    sideBumpScale: 0.8,
    sideRidgeCount: 120,
    sideRidgeDepth: 0.35,
    sideUvScaleX: 1,
    sideUvScaleY: 1,
    sideUvOffsetX: 0,
    sideUvOffsetY: 0,
    sideUvRotation: 0,
    uvScaleX: 1,
    uvScaleY: 1,
    uvOffsetX: 0,
    uvOffsetY: 0,
    uvRotation: 0,
    bumpScale: 1,
    metalness: 0.8,
    roughness: 0.2,
    reflectionIntensity: 1,
    color: '#ffd700',
    emissive: '#000000',
    emissiveIntensity: 0,
  },
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

const DEFAULT_LIGHTING: AnimatorLightSettings = {
  ambientColor: '#404040',
  ambientIntensity: 1.2,
  directionalLights: [
    {
      id: 'dir-1',
      color: '#ffffff',
      intensity: 2.5,
      position: { x: 150, y: 300, z: 150 },
      castShadow: true,
    },
  ],
  pointLights: [],
};

const DEFAULT_ANIMATION: AnimatorAnimationSettings = {
  duration: 60,
  fps: 30,
  rotation: { x: 0, y: 6, z: 0 }, // 6 degrees per frame = full rotation in 60 frames
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  cameraPath: 'static',
  cameraOrbitSpeed: 0,
  cameraStartAngle: 0,
};

const DEFAULT_RENDER_SETTINGS: AnimatorRenderSettings = {
  width: 512,
  height: 512,
  backgroundColor: '#1a1a1a',
  transparent: true,
  antialias: true,
  shadows: true,
  outputFormat: 'png',
  outputQuality: 0.95,
};

const DEFAULT_EFFECTS: AnimatorEffectsSettings = {
  ambientOcclusion: {
    enabled: true,
    radius: 16,
    intensity: 1.0,
  },
  bloom: {
    enabled: true,
    intensity: 0.8,
    threshold: 0.35,
    radius: 0.45,
  },
  lens: {
    enabled: false,
    amount: 0.0012,
  },
  sparkles: {
    enabled: false,
    count: 140,
    size: 2.2,
    intensity: 0.8,
    speed: 1.2,
    shinyGlints: true,
    glintThreshold: 0.72,
    glintCenterThreshold: 0.68,
    glintSpread: 0.9,
    glintRayLength: 1.0,
    glintRayBoost: 1.0,
    glintHorizontalBlur: 1.0,
    glintVerticalBlur: 1.0,
    glowBlur: 3.0,
  },
  colorCorrection: {
    enabled: false,
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    hue: 0.0,
  },
};

const DEFAULT_PROJECT: AnimatorProject = {
  object: DEFAULT_ANIMATOR_OBJECT,
  lighting: DEFAULT_LIGHTING,
  environment: 'studio',
  animation: DEFAULT_ANIMATION,
  renderSettings: DEFAULT_RENDER_SETTINGS,
  effects: DEFAULT_EFFECTS,
  backgroundColor: '#1a1a1a',
};

const mergeProjectWithDefaults = (project: Partial<AnimatorProject> | null | undefined): AnimatorProject => {
  if (!project) return DEFAULT_PROJECT;

  return {
    ...DEFAULT_PROJECT,
    ...project,
    object: {
      ...DEFAULT_PROJECT.object,
      ...project.object,
      geometryParams: {
        ...DEFAULT_PROJECT.object.geometryParams,
        ...(project.object?.geometryParams ?? {}),
      },
      material: {
        ...DEFAULT_PROJECT.object.material,
        ...(project.object?.material ?? {}),
      },
      position: {
        ...DEFAULT_PROJECT.object.position,
        ...(project.object?.position ?? {}),
      },
      rotation: {
        ...DEFAULT_PROJECT.object.rotation,
        ...(project.object?.rotation ?? {}),
      },
      scale: {
        ...DEFAULT_PROJECT.object.scale,
        ...(project.object?.scale ?? {}),
      },
    },
    lighting: {
      ...DEFAULT_PROJECT.lighting,
      ...project.lighting,
      directionalLights: project.lighting?.directionalLights ?? DEFAULT_PROJECT.lighting.directionalLights,
      pointLights: project.lighting?.pointLights ?? DEFAULT_PROJECT.lighting.pointLights,
    },
    animation: {
      ...DEFAULT_PROJECT.animation,
      ...project.animation,
      rotation: {
        ...DEFAULT_PROJECT.animation.rotation,
        ...(project.animation?.rotation ?? {}),
      },
      position: {
        ...DEFAULT_PROJECT.animation.position,
        ...(project.animation?.position ?? {}),
      },
      scale: {
        ...DEFAULT_PROJECT.animation.scale,
        ...(project.animation?.scale ?? {}),
      },
    },
    renderSettings: {
      ...DEFAULT_PROJECT.renderSettings,
      ...(project.renderSettings ?? {}),
    },
    effects: {
      ...DEFAULT_EFFECTS,
      ...(project.effects ?? {}),
      ambientOcclusion: {
        ...(DEFAULT_EFFECTS.ambientOcclusion || { enabled: true, radius: 16, intensity: 1.0 }),
        ...(project.effects?.ambientOcclusion ?? {}),
      },
      bloom: {
        ...DEFAULT_EFFECTS.bloom,
        ...(project.effects?.bloom ?? {}),
      },
      lens: {
        ...DEFAULT_EFFECTS.lens,
        ...(project.effects?.lens ?? {}),
      },
      sparkles: {
        ...DEFAULT_EFFECTS.sparkles,
        ...(project.effects?.sparkles ?? {}),
      },
      colorCorrection: {
        ...DEFAULT_EFFECTS.colorCorrection,
        ...(project.effects?.colorCorrection ?? {}),
      },
    },
  };
};

interface Animator3DProps {
  autoRenderOnChange?: boolean;
  onExportToParticleSystem?: (dataUrls: string[], fps?: number) => void;
  embeddedUI?: boolean;
}

export function Animator3D({ onExportToParticleSystem, autoRenderOnChange, embeddedUI }: Animator3DProps = {}) {
  const loadProjectFromStorage = (): AnimatorProject => {
    try {
      const saved = localStorage.getItem('vertebrae_project');
      if (saved) {
        return mergeProjectWithDefaults(JSON.parse(saved) as Partial<AnimatorProject>);
      }
    } catch (error) {
      console.error('Failed to load project from localStorage:', error);
    }
    return DEFAULT_PROJECT;
  };

  const [project, setProject] = useState<AnimatorProject>(loadProjectFromStorage);

  const [activePanel, setActivePanel] = useState<'object' | 'material' | 'lighting' | 'effects' | 'animation' | 'render'>('object');
  const [isRendering, setIsRendering] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewResetToken, setPreviewResetToken] = useState(0);
  const [renderProgress, setRenderProgress] = useState<RenderProgress>({
    currentFrame: 0,
    totalFrames: 0,
    isRendering: false,
    renderedFrames: [],
  });
  const [snapshotFeedback, setSnapshotFeedback] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string>('gold');
  const [ridgeCount, setRidgeCount] = useState(100);
  const [ridgeDepth, setRidgeDepth] = useState(0.3);
  const [showCoinPresets, setShowCoinPresets] = useState(false);
  const [exportFormat, setExportFormat] = useState<'individual' | 'zip' | 'particle_system'>(autoRenderOnChange ? 'particle_system' : 'zip');
  const [showRegionSelector, setShowRegionSelector] = useState(false);
  const [bevelEnabled, setBevelEnabled] = useState(true);
  const [bevelWidth, setBevelWidth] = useState(0.05);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const renderQueuedRef = useRef(false);

  // Save project to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('vertebrae_project', JSON.stringify(project));
    } catch (error) {
      console.error('Failed to save project to localStorage:', error);
    }
  }, [project]);

  useEffect(() => {
    if (autoRenderOnChange && onExportToParticleSystem) {
      if (isRendering) {
        renderQueuedRef.current = true;
        return;
      }
      
      const timer = setTimeout(() => {
        handleRenderStart();
      }, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, autoRenderOnChange]);

  const handleGeometryChange = (geometry: AnimatorGeometryType) => {
    let defaultParams = {};
    switch (geometry) {
      case 'cylinder':
        defaultParams = { radiusTop: 50, radiusBottom: 50, height: 20, radialSegments: 64, edgeBevel: 0.06 };
        break;
      case 'sphere':
        defaultParams = { radius: 50, widthSegments: 32, heightSegments: 32 };
        break;
      case 'cube':
        defaultParams = { width: 100, height: 100, depth: 100 };
        break;
      case 'plane':
        defaultParams = { width: 100, height: 100 };
        break;
      case 'torus':
        defaultParams = { radius: 50, tubeRadius: 20, radialSegments: 16, tubularSegments: 100 };
        break;
    }

    setProject(prev => ({
      ...prev,
      object: {
        ...prev.object,
        geometry,
        geometryParams: defaultParams,
      },
    }));
  };

  const handleTextureUpload = (type: 'base' | 'normal' | 'bump') => {
    if (fileInputRef.current) {
      fileInputRef.current.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const dataUrl = event.target?.result as string;

            if (type === 'base') {
              const autoFit = await computeAutoCapUvProjection(dataUrl);
              setProject(prev => ({
                ...prev,
                object: {
                  ...prev.object,
                  material: {
                    ...prev.object.material,
                    baseTextureDataUrl: dataUrl,
                    baseTextureName: file.name,
                    uvScaleX: autoFit.scaleX,
                    uvScaleY: autoFit.scaleY,
                    uvOffsetX: autoFit.offsetX,
                    uvOffsetY: autoFit.offsetY,
                    uvRotation: 0,
                  },
                },
              }));
              return;
            }

            setProject(prev => ({
              ...prev,
              object: {
                ...prev.object,
                material: {
                  ...prev.object.material,
                  ...(type === 'normal' && { 
                    normalMapDataUrl: dataUrl,
                    normalMapName: file.name 
                  }),
                  ...(type === 'bump' && { 
                    bumpMapDataUrl: dataUrl,
                    bumpMapName: file.name 
                  }),
                },
              },
            }));
          };
          reader.readAsDataURL(file);
        }
      };
      fileInputRef.current.click();
    }
  };

  const computeAutoCapUvProjection = async (imageSrc: string): Promise<{
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height).data;

        let minX = img.width;
        let minY = img.height;
        let maxX = -1;
        let maxY = -1;
        let found = false;

        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            const idx = (y * img.width + x) * 4;
            const alpha = imageData[idx + 3];
            if (alpha > 12) {
              found = true;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
        }

        if (!found) {
          const cornerSamples = [
            [0, 0],
            [img.width - 1, 0],
            [0, img.height - 1],
            [img.width - 1, img.height - 1],
          ] as const;

          let bgR = 0;
          let bgG = 0;
          let bgB = 0;
          for (const [cx, cy] of cornerSamples) {
            const idx = (cy * img.width + cx) * 4;
            bgR += imageData[idx];
            bgG += imageData[idx + 1];
            bgB += imageData[idx + 2];
          }
          bgR /= cornerSamples.length;
          bgG /= cornerSamples.length;
          bgB /= cornerSamples.length;

          for (let y = 0; y < img.height; y++) {
            for (let x = 0; x < img.width; x++) {
              const idx = (y * img.width + x) * 4;
              const dr = imageData[idx] - bgR;
              const dg = imageData[idx + 1] - bgG;
              const db = imageData[idx + 2] - bgB;
              const dist = Math.sqrt(dr * dr + dg * dg + db * db);

              if (dist > 18) {
                found = true;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
              }
            }
          }
        }

        if (!found) {
          resolve({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
          return;
        }

        const pad = 1;
        minX = Math.max(0, minX - pad);
        minY = Math.max(0, minY - pad);
        maxX = Math.min(img.width - 1, maxX + pad);
        maxY = Math.min(img.height - 1, maxY + pad);

        const boxW = Math.max(1, maxX - minX + 1);
        const boxH = Math.max(1, maxY - minY + 1);

        resolve({
          scaleX: Math.max(0.05, Math.min(1, boxW / img.width)),
          scaleY: Math.max(0.05, Math.min(1, boxH / img.height)),
          offsetX: minX / img.width,
          offsetY: minY / img.height,
        });
      };

      img.onerror = () => {
        resolve({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
      };

      img.src = imageSrc;
    });
  };

  const handleApplyCoinSideFitPreset = () => {
    if (project.object.geometry !== 'cylinder') return;

    const radiusTop = project.object.geometryParams.radiusTop ?? 50;
    const radiusBottom = project.object.geometryParams.radiusBottom ?? 50;
    const height = Math.max(1, project.object.geometryParams.height ?? 20);
    const averageRadius = (radiusTop + radiusBottom) / 2;
    const circumference = 2 * Math.PI * averageRadius;

    const recommendedUScale = Math.max(1, Math.min(12, circumference / height));

    setProject(prev => ({
      ...prev,
      object: {
        ...prev.object,
        material: {
          ...prev.object.material,
          sideUvScaleX: recommendedUScale,
          sideUvScaleY: 1,
          sideUvOffsetX: 0,
          sideUvOffsetY: 0,
          sideUvRotation: 0,
        }
      }
    }));
  };

  const handleAutoFitCaps = async () => {
    const baseTexture = project.object.material.baseTextureDataUrl;
    if (!baseTexture) return;

    const autoFit = await computeAutoCapUvProjection(baseTexture);
    setProject(prev => ({
      ...prev,
      object: {
        ...prev.object,
        material: {
          ...prev.object.material,
          uvScaleX: autoFit.scaleX,
          uvScaleY: autoFit.scaleY,
          uvOffsetX: autoFit.offsetX,
          uvOffsetY: autoFit.offsetY,
          uvRotation: 0,
        }
      }
    }));
  };

  const hslToHex = (h: number, s: number, l: number): string => {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    let r: number;
    let g: number;
    let b: number;

    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    const toHex = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const handleAutoGenerateSideColor = async () => {
    const faceTexture = project.object.material.baseTextureDataUrl;
    if (!faceTexture) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height).data;

      const hueBins = new Array(24).fill(0);
      let satSum = 0;
      let lightSum = 0;
      let validCount = 0;

      for (let i = 0; i < imageData.length; i += 4) {
        const a = imageData[i + 3];
        if (a < 100) continue;

        const r = imageData[i] / 255;
        const g = imageData[i + 1] / 255;
        const b = imageData[i + 2] / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        const l = (max + min) / 2;

        if (l < 0.12) continue;

        let h = 0;
        let s = 0;
        if (delta > 0) {
          s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
          if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
          else if (max === g) h = ((b - r) / delta + 2) / 6;
          else h = ((r - g) / delta + 4) / 6;
        }

        if (s < 0.08) continue;

        const bin = Math.max(0, Math.min(23, Math.floor(h * 24)));
        const weight = s * (0.5 + l);
        hueBins[bin] += weight;
        satSum += s;
        lightSum += l;
        validCount++;
      }

      if (validCount === 0) return;

      let dominantBin = 0;
      for (let i = 1; i < hueBins.length; i++) {
        if (hueBins[i] > hueBins[dominantBin]) dominantBin = i;
      }

      const dominantHue = (dominantBin + 0.5) / 24;
      const avgSat = satSum / validCount;
      const avgLight = lightSum / validCount;

      const sideColor = hslToHex(
        dominantHue,
        Math.max(0.35, Math.min(0.75, avgSat * 0.8)),
        Math.max(0.22, Math.min(0.58, avgLight * 0.72))
      );

      setProject(prev => ({
        ...prev,
        object: {
          ...prev.object,
          material: {
            ...prev.object.material,
            useSeparateSideMaterial: true,
            sideColor,
          }
        }
      }));
    };
    img.src = faceTexture;
  };

  const handleGenerateSideRidges = () => {
    const size = 512;
    const sideHeight = generateCylinderBodyRidges(
      size,
      size,
      project.object.material.sideRidgeCount,
      project.object.material.sideRidgeDepth
    );
    const sideNormal = generateNormalMapFromHeight(sideHeight, 10);

    setProject(prev => ({
      ...prev,
      object: {
        ...prev.object,
        material: {
          ...prev.object.material,
          useSeparateSideMaterial: true,
          sideNormalMapDataUrl: imageDataToDataURL(sideNormal),
          sideNormalMapName: 'Side Ridges Normal',
          sideBumpMapDataUrl: imageDataToDataURL(sideHeight),
          sideBumpMapName: 'Side Ridges Bump',
        }
      }
    }));
  };

  const handleRenderStart = () => {
    setIsPreviewPlaying(false);
    setIsRendering(true);
    setRenderProgress({
      currentFrame: 0,
      totalFrames: project.animation.duration,
      isRendering: true,
      renderedFrames: [],
    });
  };

  const handleRenderProgress = (progress: RenderProgress) => {
    setRenderProgress(progress);
  };

  const handleRenderComplete = async (frames: Blob[]) => {
    setIsRendering(false);
    
    if (exportFormat === 'particle_system' && onExportToParticleSystem) {
      // Convert blobs to base64 Data URLs so they can be sent into the particle system
      const urls = await Promise.all(frames.map(blob => new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      })));
      onExportToParticleSystem(urls, project.animation?.fps || 30);
      
      if (renderQueuedRef.current) {
        renderQueuedRef.current = false;
        setTimeout(() => handleRenderStart(), 100);
      }
      return;
    }

    if (exportFormat === 'zip') {
      // Create ZIP file
      const zip = new JSZip();
      const folderName = `animation_${Date.now()}`;
      const folder = zip.folder(folderName);
      
      if (folder) {
        for (let i = 0; i < frames.length; i++) {
          const fileName = `frame_${String(i + 1).padStart(4, '0')}.${project.renderSettings.outputFormat}`;
          folder.file(fileName, frames[i]);
        }
      }
      
      // Generate and download ZIP
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      // Download individual files
      for (let i = 0; i < frames.length; i++) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(frames[i]);
        link.download = `frame_${String(i + 1).padStart(4, '0')}.${project.renderSettings.outputFormat}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Small delay between downloads
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  };

  const handleSnapshot = () => {
    if (typeof window !== 'undefined' && (window as any).__captureSnapshot) {
      (window as any).__captureSnapshot();
    }
  };

  const handleSnapshotReady = (blob: Blob) => {
    // Copy to clipboard
    const item = new ClipboardItem({ 'image/png': blob });
    navigator.clipboard.write([item]).then(() => {
      setSnapshotFeedback('✓ Copied to clipboard');
      setTimeout(() => setSnapshotFeedback(''), 2000);
    }).catch(() => {
      // Fallback: download if clipboard fails
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snapshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSnapshotFeedback('Downloaded (clipboard unavailable)');
      setTimeout(() => setSnapshotFeedback(''), 2000);
    });
  };

  const handleApplyCoinPreset = (presetKey: string) => {
    const preset = COIN_PRESETS[presetKey];
    if (!preset) return;

    // Generate maps
    const size = 512;
    let heightData = generateCoinRidgePattern(size, size, preset.ridgeCount, preset.ridgeDepth);
    
    // Apply bevel if enabled
    if (bevelEnabled) {
      heightData = applyBevelToHeightMap(heightData, bevelWidth);
    }
    
    const normalData = generateNormalMapFromHeight(heightData, 10);
    const sideHeightData = generateCylinderBodyRidges(size, size, preset.ridgeCount, preset.ridgeDepth);
    const sideNormalData = generateNormalMapFromHeight(sideHeightData, 10);
    
    const heightDataUrl = imageDataToDataURL(heightData);
    const normalDataUrl = imageDataToDataURL(normalData);
    const bumpDataUrl = heightDataUrl;

    // Apply to project
    setProject(prev => ({
      ...prev,
      object: {
        ...prev.object,
        material: {
          ...prev.object.material,
          normalMapDataUrl: normalDataUrl,
          normalMapName: `${preset.name} Normal`,
          bumpMapDataUrl: bumpDataUrl,
          bumpMapName: `${preset.name} Bump`,
          useSeparateSideMaterial: true,
          sideColor: preset.color,
          sideRidgeCount: preset.ridgeCount,
          sideRidgeDepth: preset.ridgeDepth,
          sideNormalMapDataUrl: imageDataToDataURL(sideNormalData),
          sideNormalMapName: `${preset.name} Side Normal`,
          sideBumpMapDataUrl: imageDataToDataURL(sideHeightData),
          sideBumpMapName: `${preset.name} Side Bump`,
          metalness: preset.metalness,
          roughness: preset.roughness,
          color: preset.color,
        },
      },
    }));

    setSelectedPreset(presetKey);
    setRidgeCount(preset.ridgeCount);
    setRidgeDepth(preset.ridgeDepth);
    setShowCoinPresets(false);
  };

  const handleRegionAnalysisMaps = (
    heightDataUrl: string,
    normalDataUrl: string,
    bumpDataUrl: string,
    baseTextureDataUrl?: string,
    baseTextureName?: string,
    capProjection?: { scaleX: number; scaleY: number; offsetX: number; offsetY: number; rotation: number },
    sideProjection?: { scaleX: number; scaleY: number; offsetX: number; offsetY: number; rotation: number }
  ) => {
    const applyMaps = (autoFit?: { scaleX: number; scaleY: number; offsetX: number; offsetY: number }) => {
      setProject(prev => ({
        ...prev,
        object: {
          ...prev.object,
          material: {
            ...prev.object.material,
            ...(baseTextureDataUrl
              ? {
                  baseTextureDataUrl,
                  baseTextureName: baseTextureName ?? 'AI Source Texture',
                  ...(capProjection
                    ? {
                        uvScaleX: capProjection.scaleX,
                        uvScaleY: capProjection.scaleY,
                        uvOffsetX: capProjection.offsetX,
                        uvOffsetY: capProjection.offsetY,
                        uvRotation: capProjection.rotation,
                      }
                    : autoFit
                    ? {
                        uvScaleX: autoFit.scaleX,
                        uvScaleY: autoFit.scaleY,
                        uvOffsetX: autoFit.offsetX,
                        uvOffsetY: autoFit.offsetY,
                        uvRotation: 0,
                      }
                    : {}),
                  ...(sideProjection
                    ? {
                        sideUvScaleX: sideProjection.scaleX,
                        sideUvScaleY: sideProjection.scaleY,
                        sideUvOffsetX: sideProjection.offsetX,
                        sideUvOffsetY: sideProjection.offsetY,
                        sideUvRotation: sideProjection.rotation,
                      }
                    : {}),
                }
              : {}),
            normalMapDataUrl: normalDataUrl,
            normalMapName: 'AI Analyzed Normal',
            bumpMapDataUrl: bumpDataUrl,
            bumpMapName: 'AI Analyzed Bump',
          },
        },
      }));
    };

    if (baseTextureDataUrl) {
      computeAutoCapUvProjection(baseTextureDataUrl).then((autoFit) => applyMaps(autoFit));
    } else {
      applyMaps();
    }

    setShowRegionSelector(false);
  };

  const handleGenerateCustomRidges = () => {
    const size = 512;
    let heightData = generateCoinRidgePattern(size, size, ridgeCount, ridgeDepth);
    
    // Apply bevel if enabled
    if (bevelEnabled) {
      heightData = applyBevelToHeightMap(heightData, bevelWidth);
    }
    
    const normalData = generateNormalMapFromHeight(heightData, 10);
    
    const heightDataUrl = imageDataToDataURL(heightData);
    const normalDataUrl = imageDataToDataURL(normalData);
    const bumpDataUrl = heightDataUrl;

    const sideHeightData = generateCylinderBodyRidges(size, size, ridgeCount, ridgeDepth);
    const sideNormalData = generateNormalMapFromHeight(sideHeightData, 10);

    setProject(prev => ({
      ...prev,
      object: {
        ...prev.object,
        material: {
          ...prev.object.material,
          ...(prev.object.geometry === 'cylinder'
            ? {
                useSeparateSideMaterial: true,
                sideRidgeCount: ridgeCount,
                sideRidgeDepth: ridgeDepth,
                sideNormalMapDataUrl: imageDataToDataURL(sideNormalData),
                sideNormalMapName: 'Custom Side Ridges Normal',
                sideBumpMapDataUrl: imageDataToDataURL(sideHeightData),
                sideBumpMapName: 'Custom Side Ridges Bump',
              }
            : {
                normalMapDataUrl: normalDataUrl,
                normalMapName: 'Custom Ridges Normal',
                bumpMapDataUrl: bumpDataUrl,
                bumpMapName: 'Custom Ridges Bump',
              }),
        },
      },
    }));
  };

  const applyBevelToHeightMap = (heightData: ImageData, bevelWidth: number): ImageData => {
    const width = heightData.width;
    const height = heightData.height;
    const data = heightData.data;
    const result = new ImageData(width, height);
    const resultData = result.data;

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) / 2;
    const bevelStartRadius = maxRadius * (1 - bevelWidth);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Copy original data
        let value = data[idx];

        // Apply bevel to edge
        if (distance >= bevelStartRadius && distance <= maxRadius) {
          const bevelPosition = (distance - bevelStartRadius) / (maxRadius - bevelStartRadius);
          const bevelFactor = Math.cos(bevelPosition * Math.PI / 2); // Smooth falloff
          value = value * bevelFactor;
        } else if (distance > maxRadius) {
          value = 0; // Outside coin
        }

        resultData[idx] = value;
        resultData[idx + 1] = value;
        resultData[idx + 2] = value;
        resultData[idx + 3] = 255;
      }
    }

    return result;
  };

  return (
    <div style={embeddedUI ? { display: 'flex', flexDirection: 'column', width: '100%', backgroundColor: 'transparent', color: 'inherit' } : { display: 'flex', width: '100%', height: '100vh', backgroundColor: '#2a2a2a' }}>
      {/* Left Panel - Controls */}
      <div style={embeddedUI ? {
        width: '100%', 
        display: 'flex',
        flexDirection: 'column',
      } : { 
        width: '320px', 
        backgroundColor: '#1e1e1e', 
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #333',
      }}>
        {!embeddedUI && (
          <div style={{ padding: '12px', borderBottom: '1px solid #333' }}>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>3D Asset Creator</h2>
          </div>
        )}

        {!embeddedUI && (
          <>
          {/* Panel Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
          {(['object', 'material', 'lighting', 'effects', 'animation', 'render'] as const).map(panel => (
            <button
              key={panel}
              onClick={() => setActivePanel(panel)}
              style={{
                flex: 1,
                padding: '8px 4px',
                backgroundColor: activePanel === panel ? '#333' : 'transparent',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontSize: '11px',
                textTransform: 'capitalize',
              }}
            >
              {panel}
            </button>
          ))}
        </div>

        {/* Reset Button */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
          <button
            onClick={() => {
              if (window.confirm('Reset all settings to defaults? This cannot be undone.')) {
                setProject(DEFAULT_PROJECT);
              }
            }}
            style={{
              width: '100%',
              padding: '8px',
              backgroundColor: '#c41e1e',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 600,
              borderRadius: '2px',
            }}
          >
            ↺ Reset All Settings
          </button>
        </div>
          </>
        )}

        {/* Panel Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {(embeddedUI || activePanel === 'object') && (
            <div style={{ marginBottom: embeddedUI ? '24px' : '0' }}>
              {embeddedUI && <h3 style={{ margin: '0 0 12px 0', paddingBottom: '8px', borderBottom: '1px solid #333', fontSize: '14px', color: '#a9b5ca' }}>Object</h3>}
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>Geometry</label>
              <select
                value={project.object.geometry}
                onChange={(e) => handleGeometryChange(e.target.value as AnimatorGeometryType)}
                style={{ width: '100%', padding: '6px', marginBottom: '12px' }}
              >
                <option value="cylinder">Cylinder</option>
                <option value="coin">Coin (Parametric)</option>
                <option value="sphere">Sphere</option>
                <option value="cube">Cube</option>
                <option value="plane">Plane</option>
                <option value="torus">Torus</option>
              </select>

              {project.object.geometry === 'cylinder' && (
                <>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Radius Top</label>
                  <input
                    type="number"
                    value={project.object.geometryParams.radiusTop ?? 50}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        geometryParams: { ...prev.object.geometryParams, radiusTop: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Radius Bottom</label>
                  <input
                    type="number"
                    value={project.object.geometryParams.radiusBottom ?? 50}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        geometryParams: { ...prev.object.geometryParams, radiusBottom: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Height</label>
                  <input
                    type="number"
                    value={project.object.geometryParams.height ?? 100}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        geometryParams: { ...prev.object.geometryParams, height: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Segments</label>
                  <input
                    type="number"
                    value={project.object.geometryParams.radialSegments ?? 32}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        geometryParams: { ...prev.object.geometryParams, radialSegments: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Scene Edge Bevel
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={((project.object.geometryParams.edgeBevel ?? 0) * 100).toFixed(0)}
                              onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        geometryParams: { ...prev.object.geometryParams, edgeBevel: Number(e.target.value) }
                      }
                    }))}
                              step={0.005}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            /> <span style={{ fontSize: '11px', color: '#aaaaaa' }}>%</span>
                          </div>
                        </div>
                        <input
                    type="range"
                    min="0"
                    max="0.2"
                    step="0.005"
                    value={project.object.geometryParams.edgeBevel ?? 0.06}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        geometryParams: { ...prev.object.geometryParams, edgeBevel: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', marginBottom: '10px' }}
                  />
                  <div style={{ fontSize: '10px', opacity: 0.75, marginBottom: '8px' }}>
                    Realtime geometry bevel in viewport (independent from AI texture bevel).
                  </div>
                </>
              )}
              
              
              {project.object.geometry === 'coin' && (
                <>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Total Radius</label>
                  <input
                    type="number"
                    value={project.object.geometryParams.radiusTop ?? 50}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, radiusTop: Number(e.target.value) } }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Rim Thickness</label>
                  <input
                    type="number"
                    value={project.object.geometryParams.coinFrameWidth ?? 10}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinFrameWidth: Number(e.target.value) } }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Coin Depth</label>
                  <input
                    type="number"
                    value={project.object.geometryParams.coinFrameHeight ?? 20}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinFrameHeight: Number(e.target.value) } }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Inner Shape Pattern</label>
                  <select
                    value={project.object.geometryParams.coinInnerShapePattern ?? 'star'}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinInnerShapePattern: e.target.value as any } }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  >
                    <option value="none">None</option>
                    <option value="circle">Circle</option>
                    <option value="polygon">Polygon</option>
                    <option value="star">Star</option>
                  </select>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Inner Shape Size</label>
                  <input
                    type="number"
                    value={project.object.geometryParams.coinInnerShapeSize ?? 20}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinInnerShapeSize: Number(e.target.value) } }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Inner Shape Depth</label>
                  <input
                    type="number"
                    value={project.object.geometryParams.coinInnerShapeDepth ?? 10}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinInnerShapeDepth: Number(e.target.value) } }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Inner Shape Points</label>
                  <input
                    type="number"
                    value={project.object.geometryParams.coinInnerShapePoints ?? 5}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinInnerShapePoints: Number(e.target.value) } }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Inner Shape Roundness
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={((project.object.geometryParams.coinInnerShapeRoundness ?? 0) * 100).toFixed(0)}
                              onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinInnerShapeRoundness: Number(e.target.value) } }
                    }))}
                              step={0.05}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            /> <span style={{ fontSize: '11px', color: '#aaaaaa' }}>%</span>
                          </div>
                        </div>
                        <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={project.object.geometryParams.coinInnerShapeRoundness ?? 0}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinInnerShapeRoundness: Number(e.target.value) } }
                    }))}
                    style={{ width: '100%', marginBottom: '10px' }}
                  />

                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>
                    Coin Ridges (Count)
                  </label>
                  <input
                    type="number"
                    value={project.object.geometryParams.coinRidgeCount ?? 0}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinRidgeCount: Number(e.target.value) } }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Coin Ridges Depth
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={((project.object.geometryParams.coinRidgeDepth ?? 1.0) * 100).toFixed(0)}
                              onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinRidgeDepth: Number(e.target.value) } }
                    }))}
                              step={0.1}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            /> <span style={{ fontSize: '11px', color: '#aaaaaa' }}>%</span>
                          </div>
                        </div>
                        <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.1"
                    value={project.object.geometryParams.coinRidgeDepth ?? 1.0}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, coinRidgeDepth: Number(e.target.value) } }
                    }))}
                    style={{ width: '100%', marginBottom: '10px' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Scene Edge Bevel
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={((project.object.geometryParams.edgeBevel ?? 0) * 100).toFixed(0)}
                              onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, edgeBevel: Number(e.target.value) } }
                    }))}
                              step={0.005}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            /> <span style={{ fontSize: '11px', color: '#aaaaaa' }}>%</span>
                          </div>
                        </div>
                        <input
                    type="range"
                    min="0"
                    max="0.2"
                    step="0.005"
                    value={project.object.geometryParams.edgeBevel ?? 0.06}
                    onChange={(e) => setProject(prev => ({
                      ...prev, object: { ...prev.object, geometryParams: { ...prev.object.geometryParams, edgeBevel: Number(e.target.value) } }
                    }))}
                    style={{ width: '100%', marginBottom: '10px' }}
                  />
                </>
              )}

              {/* Add similar controls for other geometry types */}
            </div>
          )}

          {(embeddedUI || activePanel === 'material') && (
            <div style={{ marginBottom: embeddedUI ? '24px' : '0' }}>
              {embeddedUI && <h3 style={{ margin: '0 0 12px 0', paddingBottom: '8px', borderBottom: '1px solid #333', fontSize: '14px', color: '#a9b5ca' }}>Material</h3>}
              {/* Coin Presets Section */}
              {project.object.geometry === 'cylinder' && (
                <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#252525', borderRadius: '4px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>🪙 Coin Tools</label>
                  
                  <button
                    onClick={() => setShowRegionSelector(true)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      marginBottom: '12px',
                      backgroundColor: '#2a7f2a',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '4px',
                    }}
                  >
                    🔍 AI Region Analysis
                  </button>
                  
                  <button
                    onClick={() => setShowCoinPresets(!showCoinPresets)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginBottom: '8px',
                      backgroundColor: '#0066cc',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    {showCoinPresets ? 'Hide' : 'Show'} Coin Presets
                  </button>

                  {showCoinPresets && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {Object.entries(COIN_PRESETS).map(([key, preset]) => (
                        <button
                          key={key}
                          onClick={() => handleApplyCoinPreset(key)}
                          style={{
                            padding: '8px',
                            backgroundColor: selectedPreset === key ? '#0066cc' : '#333',
                            color: '#fff',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '11px',
                            textAlign: 'left',
                          }}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Ridge Count
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={ridgeCount}
                              onChange={(e) => setRidgeCount(Number(e.target.value))}
                              step={"1"}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                      type="range"
                      min="20"
                      max="200"
                      value={ridgeCount}
                      onChange={(e) => setRidgeCount(Number(e.target.value))}
                      style={{ width: '100%', marginBottom: '8px' }}
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Ridge Depth
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={ridgeDepth.toFixed(2)}
                              onChange={(e) => setRidgeDepth(Number(e.target.value))}
                              step={0.05}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={ridgeDepth}
                      onChange={(e) => setRidgeDepth(Number(e.target.value))}
                      style={{ width: '100%', marginBottom: '8px' }}
                    />

                    <button
                      onClick={handleGenerateCustomRidges}
                      style={{
                        width: '100%',
                        padding: '8px',
                        backgroundColor: '#2a7f2a',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '11px',
                      }}
                    >
                      Generate Custom Ridges
                    </button>
                  </div>

                  {/* Bevel Controls */}
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #333' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '12px', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={bevelEnabled}
                        onChange={(e) => setBevelEnabled(e.target.checked)}
                      />
                      🔘 Apply Edge Bevel
                    </label>

                    {bevelEnabled && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Bevel Width
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={(bevelWidth * 100).toFixed(0)}
                              onChange={(e) => setBevelWidth(Number(e.target.value))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            /> <span style={{ fontSize: '11px', color: '#aaaaaa' }}>%</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min="0.02"
                          max="0.15"
                          step="0.01"
                          value={bevelWidth}
                          onChange={(e) => setBevelWidth(Number(e.target.value))}
                          style={{ width: '100%', marginBottom: '8px' }}
                        />
                        <div style={{ 
                          fontSize: '10px', 
                          opacity: 0.8, 
                          backgroundColor: '#1a1a1a',
                          padding: '6px',
                          borderRadius: '3px',
                          marginTop: '4px'
                        }}>
                          💡 Creates smooth, rounded edges like real coins. Higher = wider bevel.
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>Base Texture</label>
              <button
                onClick={() => handleTextureUpload('base')}
                style={{ 
                  width: '100%', 
                  padding: '8px', 
                  marginBottom: '4px',
                  backgroundColor: '#333',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {project.object.material.baseTextureName || 'Upload Texture'}
              </button>
              {project.object.material.baseTextureDataUrl && (
                <button
                  onClick={() => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, baseTextureDataUrl: undefined, baseTextureName: undefined }
                    }
                  }))}
                  style={{ 
                    width: '100%', 
                    padding: '4px', 
                    marginBottom: '12px',
                    backgroundColor: '#500',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  Clear
                </button>
              )}

              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', marginTop: '12px' }}>Normal Map</label>
              <button
                onClick={() => handleTextureUpload('normal')}
                style={{ 
                  width: '100%', 
                  padding: '8px', 
                  marginBottom: '4px',
                  backgroundColor: '#333',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {project.object.material.normalMapName || 'Upload Normal Map'}
              </button>
              {project.object.material.normalMapDataUrl && (
                <button
                  onClick={() => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, normalMapDataUrl: undefined, normalMapName: undefined }
                    }
                  }))}
                  style={{ 
                    width: '100%', 
                    padding: '4px', 
                    marginBottom: '12px',
                    backgroundColor: '#500',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  Clear Normal Map
                </button>
              )}

              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', marginTop: '12px' }}>Bump Map</label>
              <button
                onClick={() => handleTextureUpload('bump')}
                style={{ 
                  width: '100%', 
                  padding: '8px', 
                  marginBottom: '4px',
                  backgroundColor: '#333',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {project.object.material.bumpMapName || 'Upload Bump Map'}
              </button>
              {project.object.material.bumpMapDataUrl && (
                <button
                  onClick={() => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, bumpMapDataUrl: undefined, bumpMapName: undefined }
                    }
                  }))}
                  style={{ 
                    width: '100%', 
                    padding: '4px', 
                    marginBottom: '12px',
                    backgroundColor: '#500',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  Clear Bump Map
                </button>
              )}

              {(project.object.geometry === 'cylinder' || project.object.geometry === 'coin') && (
                <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#252525', borderRadius: '4px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '12px', fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={project.object.material.useSeparateSideMaterial}
                      onChange={(e) => setProject(prev => ({
                        ...prev,
                        object: {
                          ...prev.object,
                          material: { ...prev.object.material, useSeparateSideMaterial: e.target.checked }
                        }
                      }))}
                    />
                    Separate Side Material
                  </label>

                  <button
                    onClick={handleAutoGenerateSideColor}
                    disabled={!project.object.material.baseTextureDataUrl}
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginBottom: '8px',
                      backgroundColor: project.object.material.baseTextureDataUrl ? '#2a7f2a' : '#555',
                      color: '#fff',
                      border: 'none',
                      cursor: project.object.material.baseTextureDataUrl ? 'pointer' : 'not-allowed',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    🤖 Auto Pick Side Color from Face
                  </button>

                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px' }}>
                    Side Color
                  </label>
                  <input
                    type="color"
                    value={project.object.material.sideColor}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideColor: e.target.value }
                      }
                    }))}
                    style={{ width: '100%', height: '28px', marginBottom: '8px' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Side Ridge Count
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.sideRidgeCount}
                              onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideRidgeCount: Number(e.target.value) }
                      }
                    }))}
                              step={"1"}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                    type="range"
                    min="30"
                    max="240"
                    value={project.object.material.sideRidgeCount}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideRidgeCount: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', marginBottom: '8px' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Side Ridge Depth
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.sideRidgeDepth.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideRidgeDepth: Number(e.target.value) }
                      }
                    }))}
                              step={0.05}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={project.object.material.sideRidgeDepth}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideRidgeDepth: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', marginBottom: '8px' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Side Bump Scale
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.sideBumpScale.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideBumpScale: Number(e.target.value) }
                      }
                    }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.01"
                    value={project.object.material.sideBumpScale}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideBumpScale: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', marginBottom: '8px' }}
                  />

                  <button
                    onClick={() => {
                      const uvFit = autoFitCylinderUVs(project.object);
                      setProject(prev => ({
                        ...prev,
                        object: {
                          ...prev.object,
                          material: {
                            ...prev.object.material,
                            sideUvScaleX: uvFit.sideUvScaleX,
                            sideUvScaleY: uvFit.sideUvScaleY,
                            uvScaleX: uvFit.capUvScaleX,
                            uvScaleY: uvFit.capUvScaleY,
                          }
                        }
                      }));
                    }}
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginBottom: '12px',
                      backgroundColor: '#4a90e2',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    📐 Auto-Fit UV Mapping
                  </button>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Side U Scale
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.sideUvScaleX.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideUvScaleX: Number(e.target.value) }
                      }
                    }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                    type="range"
                    min="0.1"
                    max="12"
                    step="0.01"
                    value={project.object.material.sideUvScaleX}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideUvScaleX: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', marginBottom: '8px' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Side V Scale
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.sideUvScaleY.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideUvScaleY: Number(e.target.value) }
                      }
                    }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                    type="range"
                    min="0.1"
                    max="12"
                    step="0.01"
                    value={project.object.material.sideUvScaleY}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideUvScaleY: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', marginBottom: '8px' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Side UV Rotation
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.sideUvRotation.toFixed(0)}
                              onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideUvRotation: Number(e.target.value) }
                      }
                    }))}
                              step={"1"}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            /> <span style={{ fontSize: '11px', color: '#aaaaaa' }}>°</span>
                          </div>
                        </div>
                        <input
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={project.object.material.sideUvRotation}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, sideUvRotation: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', marginBottom: '8px' }}
                  />

                  <button
                    onClick={handleGenerateSideRidges}
                    style={{
                      width: '100%',
                      padding: '8px',
                      backgroundColor: '#0066cc',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                      marginBottom: '8px',
                    }}
                  >
                    🛠️ Generate Side Ridges
                  </button>

                  {(project.object.material.sideBumpMapDataUrl || project.object.material.sideNormalMapDataUrl) && (
                    <button
                      onClick={() => setProject(prev => ({
                        ...prev,
                        object: {
                          ...prev.object,
                          material: {
                            ...prev.object.material,
                            sideBumpMapDataUrl: undefined,
                            sideBumpMapName: undefined,
                            sideNormalMapDataUrl: undefined,
                            sideNormalMapName: undefined,
                          }
                        }
                      }))}
                      style={{
                        width: '100%',
                        padding: '4px',
                        backgroundColor: '#500',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '11px',
                      }}
                    >
                      Clear Side Maps
                    </button>
                  )}
                </div>
              )}

              <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#252525', borderRadius: '4px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>
                  UV Projection
                </label>

                {(project.object.geometry === 'cylinder' || project.object.geometry === 'coin') && (
                  <button
                    onClick={handleApplyCoinSideFitPreset}
                    style={{
                      width: '100%',
                      padding: '6px',
                      marginBottom: '8px',
                      backgroundColor: '#2a7f2a',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    Apply Coin Side Fit (Side UV)
                  </button>
                )}

                <button
                  onClick={handleAutoFitCaps}
                  disabled={!project.object.material.baseTextureDataUrl}
                  style={{
                    width: '100%',
                    padding: '6px',
                    marginBottom: '8px',
                    backgroundColor: project.object.material.baseTextureDataUrl ? '#0066cc' : '#555',
                    color: '#fff',
                    border: 'none',
                    cursor: project.object.material.baseTextureDataUrl ? 'pointer' : 'not-allowed',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  Auto Fit Caps (Face UV)
                </button>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            U Scale
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.uvScaleX.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, uvScaleX: Number(e.target.value) }
                    }
                  }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                  type="range"
                  min="0.1"
                  max="12"
                  step="0.01"
                  value={project.object.material.uvScaleX}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, uvScaleX: Number(e.target.value) }
                    }
                  }))}
                  style={{ width: '100%', marginBottom: '8px' }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            V Scale
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.uvScaleY.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, uvScaleY: Number(e.target.value) }
                    }
                  }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                  type="range"
                  min="0.1"
                  max="12"
                  step="0.01"
                  value={project.object.material.uvScaleY}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, uvScaleY: Number(e.target.value) }
                    }
                  }))}
                  style={{ width: '100%', marginBottom: '8px' }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            U Offset
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.uvOffsetX.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, uvOffsetX: Number(e.target.value) }
                    }
                  }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={project.object.material.uvOffsetX}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, uvOffsetX: Number(e.target.value) }
                    }
                  }))}
                  style={{ width: '100%', marginBottom: '8px' }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            V Offset
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.uvOffsetY.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, uvOffsetY: Number(e.target.value) }
                    }
                  }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={project.object.material.uvOffsetY}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, uvOffsetY: Number(e.target.value) }
                    }
                  }))}
                  style={{ width: '100%', marginBottom: '8px' }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            UV Rotation
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.uvRotation.toFixed(0)}
                              onChange={(e) => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, uvRotation: Number(e.target.value) }
                    }
                  }))}
                              step={"1"}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            /> <span style={{ fontSize: '11px', color: '#aaaaaa' }}>°</span>
                          </div>
                        </div>
                        <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={project.object.material.uvRotation}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: { ...prev.object.material, uvRotation: Number(e.target.value) }
                    }
                  }))}
                  style={{ width: '100%', marginBottom: '8px' }}
                />

                <button
                  onClick={() => setProject(prev => ({
                    ...prev,
                    object: {
                      ...prev.object,
                      material: {
                        ...prev.object.material,
                        uvScaleX: 1,
                        uvScaleY: 1,
                        uvOffsetX: 0,
                        uvOffsetY: 0,
                        uvRotation: 0,
                      }
                    }
                  }))}
                  style={{
                    width: '100%',
                    padding: '6px',
                    marginTop: '4px',
                    backgroundColor: '#333',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  Reset UV Projection
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Metalness
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.metalness.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  object: {
                    ...prev.object,
                    material: { ...prev.object.material, metalness: Number(e.target.value) }
                  }
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={project.object.material.metalness}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  object: {
                    ...prev.object,
                    material: { ...prev.object.material, metalness: Number(e.target.value) }
                  }
                }))}
                style={{ width: '100%', marginBottom: '12px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Roughness
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.roughness.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  object: {
                    ...prev.object,
                    material: { ...prev.object.material, roughness: Number(e.target.value) }
                  }
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={project.object.material.roughness}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  object: {
                    ...prev.object,
                    material: { ...prev.object.material, roughness: Number(e.target.value) }
                  }
                }))}
                style={{ width: '100%', marginBottom: '12px' }}
              />

              {project.object.material.bumpMapDataUrl && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Cap Bump Scale
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.object.material.bumpScale?.toFixed(2) ?? '1.00'}
                              onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, bumpScale: Number(e.target.value) }
                      }
                    }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.01"
                    value={project.object.material.bumpScale ?? 1}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      object: {
                        ...prev.object,
                        material: { ...prev.object.material, bumpScale: Number(e.target.value) }
                      }
                    }))}
                    style={{ width: '100%', marginBottom: '12px' }}
                  />
                </>
              )}

              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Base Color</label>
              <input
                type="color"
                value={project.object.material.color}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  object: {
                    ...prev.object,
                    material: { ...prev.object.material, color: e.target.value }
                  }
                }))}
                style={{ width: '100%', height: '32px', marginBottom: '12px' }}
              />
            </div>
          )}

          {(embeddedUI || activePanel === 'animation') && (
            <div style={{ marginBottom: embeddedUI ? '24px' : '0' }}>
              {embeddedUI && <h3 style={{ margin: '0 0 12px 0', paddingBottom: '8px', borderBottom: '1px solid #333', fontSize: '14px', color: '#a9b5ca' }}>Animation</h3>}
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '12px',
              }}>
                <button
                  onClick={() => setIsPreviewPlaying(prev => !prev)}
                  disabled={isRendering}
                  style={{
                    flex: 1,
                    padding: '8px',
                    backgroundColor: isRendering ? '#555' : '#2a7f2a',
                    color: '#fff',
                    border: 'none',
                    cursor: isRendering ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  {isPreviewPlaying ? 'Pause Preview' : 'Play Preview'}
                </button>
                <button
                  onClick={() => {
                    setIsPreviewPlaying(false);
                    setPreviewResetToken(prev => prev + 1);
                  }}
                  style={{
                    flex: 1,
                    padding: '8px',
                    backgroundColor: '#333',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  Reset Preview
                </button>
              </div>

              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Duration (frames)</label>
              <input
                type="number"
                value={project.animation.duration}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  animation: { ...prev.animation, duration: Number(e.target.value) }
                }))}
                style={{ width: '100%', padding: '6px', marginBottom: '12px' }}
              />

              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>X Rotation (deg/frame)</label>
              <input
                type="number"
                step="0.1"
                value={project.animation.rotation.x}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  animation: {
                    ...prev.animation,
                    rotation: { ...prev.animation.rotation, x: Number(e.target.value) }
                  }
                }))}
                style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
              />

              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Y Rotation (deg/frame)</label>
              <input
                type="number"
                step="0.1"
                value={project.animation.rotation.y}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  animation: {
                    ...prev.animation,
                    rotation: { ...prev.animation.rotation, y: Number(e.target.value) }
                  }
                }))}
                style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
              />

              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Z Rotation (deg/frame)</label>
              <input
                type="number"
                step="0.1"
                value={project.animation.rotation.z}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  animation: {
                    ...prev.animation,
                    rotation: { ...prev.animation.rotation, z: Number(e.target.value) }
                  }
                }))}
                style={{ width: '100%', padding: '6px', marginBottom: '12px' }}
              />

              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Camera Path</label>
              <select
                value={project.animation.cameraPath}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  animation: { ...prev.animation, cameraPath: e.target.value as any }
                }))}
                style={{ width: '100%', padding: '6px', marginBottom: '12px' }}
              >
                <option value="static">Static</option>
                <option value="orbit">Orbit</option>
              </select>

              {project.animation.cameraPath === 'orbit' && (
                <>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Orbit Speed (deg/frame)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={project.animation.cameraOrbitSpeed}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      animation: { ...prev.animation, cameraOrbitSpeed: Number(e.target.value) }
                    }))}
                    style={{ width: '100%', padding: '6px', marginBottom: '12px' }}
                  />
                </>
              )}
            </div>
          )}

          {(embeddedUI || activePanel === 'effects') && (
            <div style={{ marginBottom: embeddedUI ? '24px' : '0' }}>
              {embeddedUI && <h3 style={{ margin: '0 0 12px 0', paddingBottom: '8px', borderBottom: '1px solid #333', fontSize: '14px', color: '#a9b5ca' }}>Effects</h3>}
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Ambient Occlusion</label>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={project.effects.ambientOcclusion?.enabled ?? true}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    effects: {
                      ...prev.effects,
                      ambientOcclusion: { ...(prev.effects.ambientOcclusion || { radius: 16, intensity: 1.0 }), enabled: e.target.checked },
                    },
                  }))}
                  style={{ marginRight: '8px' }}
                />
                Enable Ambient Occlusion
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Radius
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.ambientOcclusion?.radius?.toFixed(1) ?? '16.0'}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    ambientOcclusion: { ...(prev.effects.ambientOcclusion || { enabled: true, intensity: 1.0 }), radius: Number(e.target.value) },
                  },
                }))}
                              step={0.5}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="32"
                step="0.5"
                value={project.effects.ambientOcclusion?.radius ?? 16}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    ambientOcclusion: { ...(prev.effects.ambientOcclusion || { enabled: true, intensity: 1.0 }), radius: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Intensity
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.ambientOcclusion?.intensity?.toFixed(2) ?? '1.00'}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    ambientOcclusion: { ...(prev.effects.ambientOcclusion || { enabled: true, radius: 16 }), intensity: Number(e.target.value) },
                  },
                }))}
                              step={0.1}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={project.effects.ambientOcclusion?.intensity ?? 1.0}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    ambientOcclusion: { ...(prev.effects.ambientOcclusion || { enabled: true, radius: 16 }), intensity: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '16px' }}
              />

              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Bloom / Glow</label>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={project.effects.bloom.enabled}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    effects: {
                      ...prev.effects,
                      bloom: { ...prev.effects.bloom, enabled: e.target.checked },
                    },
                  }))}
                  style={{ marginRight: '8px' }}
                />
                Enable Bloom
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Intensity
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.bloom.intensity.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    bloom: { ...prev.effects.bloom, intensity: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={project.effects.bloom.intensity}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    bloom: { ...prev.effects.bloom, intensity: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Threshold
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.bloom.threshold.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    bloom: { ...prev.effects.bloom, threshold: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={project.effects.bloom.threshold}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    bloom: { ...prev.effects.bloom, threshold: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Radius
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.bloom.radius.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    bloom: { ...prev.effects.bloom, radius: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={project.effects.bloom.radius}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    bloom: { ...prev.effects.bloom, radius: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '16px' }}
              />

              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Lens Effect</label>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={project.effects.lens.enabled}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    effects: {
                      ...prev.effects,
                      lens: { ...prev.effects.lens, enabled: e.target.checked },
                    },
                  }))}
                  style={{ marginRight: '8px' }}
                />
                Enable RGB Shift
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Amount
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.lens.amount.toFixed(4)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    lens: { ...prev.effects.lens, amount: Number(e.target.value) },
                  },
                }))}
                              step={0.0001}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="0.01"
                step="0.0001"
                value={project.effects.lens.amount}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    lens: { ...prev.effects.lens, amount: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '16px' }}
              />

              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Sparkles</label>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={project.effects.sparkles.enabled}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    effects: {
                      ...prev.effects,
                      sparkles: { ...prev.effects.sparkles, enabled: e.target.checked },
                    },
                  }))}
                  style={{ marginRight: '8px' }}
                />
                Enable Sparkles
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Count
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={Math.round(project.effects.sparkles.count)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, count: Number(e.target.value) },
                  },
                }))}
                              step={"1"}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="10"
                max="500"
                step="1"
                value={project.effects.sparkles.count}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, count: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Size
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.size.toFixed(1)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, size: Number(e.target.value) },
                  },
                }))}
                              step={0.1}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0.5"
                max="8"
                step="0.1"
                value={project.effects.sparkles.size}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, size: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Intensity
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.intensity.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, intensity: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={project.effects.sparkles.intensity}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, intensity: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Speed
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.speed.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, speed: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="5"
                step="0.01"
                value={project.effects.sparkles.speed}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, speed: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '8px' }}
              />

              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={project.effects.sparkles.shinyGlints}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    effects: {
                      ...prev.effects,
                      sparkles: { ...prev.effects.sparkles, shinyGlints: e.target.checked },
                    },
                  }))}
                  style={{ marginRight: '8px' }}
                />
                Star Glints On Shiny Areas
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Glint Threshold
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.glintThreshold.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintThreshold: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0.3"
                max="0.98"
                step="0.01"
                value={project.effects.sparkles.glintThreshold}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintThreshold: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Glint Spread
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.glintSpread.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintSpread: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0.2"
                max="2"
                step="0.01"
                value={project.effects.sparkles.glintSpread}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintSpread: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Center Threshold
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.glintCenterThreshold.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintCenterThreshold: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0.2"
                max="0.98"
                step="0.01"
                value={project.effects.sparkles.glintCenterThreshold}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintCenterThreshold: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Ray Length
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.glintRayLength.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintRayLength: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0.5"
                max="3"
                step="0.01"
                value={project.effects.sparkles.glintRayLength}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintRayLength: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Ray Boost
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.glintRayBoost.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintRayBoost: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0.5"
                max="3"
                step="0.01"
                value={project.effects.sparkles.glintRayBoost}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintRayBoost: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Horizontal Blur
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.glintHorizontalBlur.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintHorizontalBlur: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={project.effects.sparkles.glintHorizontalBlur}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintHorizontalBlur: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Vertical Blur
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.glintVerticalBlur.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintVerticalBlur: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={project.effects.sparkles.glintVerticalBlur}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glintVerticalBlur: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '8px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Glow Blur
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.sparkles.glowBlur.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glowBlur: Number(e.target.value) },
                  },
                }))}
                              step={0.1}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="10"
                step="0.1"
                value={project.effects.sparkles.glowBlur}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    sparkles: { ...prev.effects.sparkles, glowBlur: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '16px' }}
              />
              
              <div style={{ paddingBottom: '8px', borderBottom: '1px solid #333', marginBottom: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={project.effects.colorCorrection.enabled}
                    onChange={(e) => setProject(prev => ({
                      ...prev,
                      effects: {
                        ...prev.effects,
                        colorCorrection: { ...prev.effects.colorCorrection, enabled: e.target.checked }
                      }
                    }))}
                  />
                  Color Correction
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Brightness
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.colorCorrection.brightness.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    colorCorrection: { ...prev.effects.colorCorrection, brightness: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={project.effects.colorCorrection.brightness}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    colorCorrection: { ...prev.effects.colorCorrection, brightness: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
                disabled={!project.effects.colorCorrection.enabled}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Contrast
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.colorCorrection.contrast.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    colorCorrection: { ...prev.effects.colorCorrection, contrast: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={project.effects.colorCorrection.contrast}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    colorCorrection: { ...prev.effects.colorCorrection, contrast: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
                disabled={!project.effects.colorCorrection.enabled}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Saturation
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.colorCorrection.saturation.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    colorCorrection: { ...prev.effects.colorCorrection, saturation: Number(e.target.value) },
                  },
                }))}
                              step={0.01}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={project.effects.colorCorrection.saturation}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    colorCorrection: { ...prev.effects.colorCorrection, saturation: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '10px' }}
                disabled={!project.effects.colorCorrection.enabled}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Hue (Degrees)
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.effects.colorCorrection.hue.toFixed(0)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    colorCorrection: { ...prev.effects.colorCorrection, hue: Number(e.target.value) },
                  },
                }))}
                              step={"1"}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            /> <span style={{ fontSize: '11px', color: '#aaaaaa' }}>°</span>
                          </div>
                        </div>
                        <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={project.effects.colorCorrection.hue}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  effects: {
                    ...prev.effects,
                    colorCorrection: { ...prev.effects.colorCorrection, hue: Number(e.target.value) },
                  },
                }))}
                style={{ width: '100%', marginBottom: '8px' }}
                disabled={!project.effects.colorCorrection.enabled}
              />
            </div>
          )}

          {(embeddedUI || activePanel === 'lighting') && (
            <div style={{ marginBottom: embeddedUI ? '24px' : '0' }}>
              {embeddedUI && <h3 style={{ margin: '0 0 12px 0', paddingBottom: '8px', borderBottom: '1px solid #333', fontSize: '14px', color: '#a9b5ca' }}>Lighting</h3>}
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Environment Preset</label>
              <select
                value={project.environment}
                onChange={(e) => {
                  const env = e.target.value as 'studio' | 'outdoor' | 'dark' | 'custom';
                  
                  // Apply environment lighting presets
                  let newLighting: AnimatorLightSettings;
                  switch (env) {
                    case 'studio':
                      newLighting = {
                        ambientColor: '#404040',
                        ambientIntensity: 1.2,
                        directionalLights: [
                          { id: 'dir-1', color: '#ffffff', intensity: 2.5, position: { x: 150, y: 300, z: 150 }, castShadow: true },
                        ],
                        pointLights: [],
                      };
                      break;
                    case 'outdoor':
                      newLighting = {
                        ambientColor: '#87ceeb',
                        ambientIntensity: 1.4,
                        directionalLights: [
                          { id: 'dir-1', color: '#fffaf0', intensity: 2.8, position: { x: 200, y: 350, z: 150 }, castShadow: true },
                        ],
                        pointLights: [],
                      };
                      break;
                    case 'dark':
                      newLighting = {
                        ambientColor: '#1a1a1a',
                        ambientIntensity: 0.6,
                        directionalLights: [
                          { id: 'dir-1', color: '#ffffff', intensity: 2.0, position: { x: 100, y: 200, z: 100 }, castShadow: true },
                        ],
                        pointLights: [
                          { id: 'point-1', color: '#ff9933', intensity: 2.5, position: { x: -150, y: 100, z: 150 }, distance: 800, castShadow: false },
                        ],
                      };
                      break;
                    default:
                      newLighting = project.lighting;
                  }
                  
                  setProject(prev => ({ ...prev, environment: env, lighting: newLighting }));
                }}
                style={{ width: '100%', padding: '8px', marginBottom: '16px' }}
              >
                <option value="studio">Studio (Neutral)</option>
                <option value="outdoor">Outdoor (Bright)</option>
                <option value="dark">Dark (Dramatic)</option>
                <option value="custom">Custom</option>
              </select>

              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Ambient Light</label>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px' }}>Color</label>
              <input
                type="color"
                value={project.lighting.ambientColor}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  lighting: { ...prev.lighting, ambientColor: e.target.value }
                }))}
                style={{ width: '100%', height: '32px', marginBottom: '8px' }}
              />
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Intensity
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.lighting.ambientIntensity.toFixed(2)}
                              onChange={(e) => setProject(prev => ({
                  ...prev,
                  lighting: { ...prev.lighting, ambientIntensity: Number(e.target.value) }
                }))}
                              step={0.1}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={project.lighting.ambientIntensity}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  lighting: { ...prev.lighting, ambientIntensity: Number(e.target.value) }
                }))}
                style={{ width: '100%', marginBottom: '16px' }}
              />

              {project.lighting.directionalLights.length > 0 && (
                <>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Directional Light</label>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px' }}>Color</label>
                  <input
                    type="color"
                    value={project.lighting.directionalLights[0].color}
                    onChange={(e) => {
                      const newLights = [...project.lighting.directionalLights];
                      newLights[0] = { ...newLights[0], color: e.target.value };
                      setProject(prev => ({
                        ...prev,
                        lighting: { ...prev.lighting, directionalLights: newLights }
                      }));
                    }}
                    style={{ width: '100%', height: '32px', marginBottom: '8px' }}
                  />
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Intensity
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.lighting.directionalLights[0].intensity.toFixed(2)}
                              onChange={(e) => {
                      const newLights = [...project.lighting.directionalLights];
                      newLights[0] = { ...newLights[0], intensity: Number(e.target.value) };
                      setProject(prev => ({
                        ...prev,
                        lighting: { ...prev.lighting, directionalLights: newLights }
                      }));
                    }}
                              step={0.1}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.1"
                    value={project.lighting.directionalLights[0].intensity}
                    onChange={(e) => {
                      const newLights = [...project.lighting.directionalLights];
                      newLights[0] = { ...newLights[0], intensity: Number(e.target.value) };
                      setProject(prev => ({
                        ...prev,
                        lighting: { ...prev.lighting, directionalLights: newLights }
                      }));
                    }}
                    style={{ width: '100%', marginBottom: '16px' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Position X
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.lighting.directionalLights[0].position.x.toFixed(0)}
                              onChange={(e) => {
                      const newLights = [...project.lighting.directionalLights];
                      newLights[0] = { ...newLights[0], position: { ...newLights[0].position, x: Number(e.target.value) } };
                      setProject(prev => ({
                        ...prev,
                        lighting: { ...prev.lighting, directionalLights: newLights }
                      }));
                    }}
                              step={10}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                    type="range"
                    min="-500"
                    max="500"
                    step="10"
                    value={project.lighting.directionalLights[0].position.x}
                    onChange={(e) => {
                      const newLights = [...project.lighting.directionalLights];
                      newLights[0] = { ...newLights[0], position: { ...newLights[0].position, x: Number(e.target.value) } };
                      setProject(prev => ({
                        ...prev,
                        lighting: { ...prev.lighting, directionalLights: newLights }
                      }));
                    }}
                    style={{ width: '100%', marginBottom: '12px' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Position Y
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.lighting.directionalLights[0].position.y.toFixed(0)}
                              onChange={(e) => {
                      const newLights = [...project.lighting.directionalLights];
                      newLights[0] = { ...newLights[0], position: { ...newLights[0].position, y: Number(e.target.value) } };
                      setProject(prev => ({
                        ...prev,
                        lighting: { ...prev.lighting, directionalLights: newLights }
                      }));
                    }}
                              step={10}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                    type="range"
                    min="-500"
                    max="500"
                    step="10"
                    value={project.lighting.directionalLights[0].position.y}
                    onChange={(e) => {
                      const newLights = [...project.lighting.directionalLights];
                      newLights[0] = { ...newLights[0], position: { ...newLights[0].position, y: Number(e.target.value) } };
                      setProject(prev => ({
                        ...prev,
                        lighting: { ...prev.lighting, directionalLights: newLights }
                      }));
                    }}
                    style={{ width: '100%', marginBottom: '12px' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', paddingRight: '4px' }}>
                          <label style={{ margin: 0, fontSize: '12px' }}>
                            Position Z
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              value={project.lighting.directionalLights[0].position.z.toFixed(0)}
                              onChange={(e) => {
                      const newLights = [...project.lighting.directionalLights];
                      newLights[0] = { ...newLights[0], position: { ...newLights[0].position, z: Number(e.target.value) } };
                      setProject(prev => ({
                        ...prev,
                        lighting: { ...prev.lighting, directionalLights: newLights }
                      }));
                    }}
                              step={10}
                              style={{ width: '60px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '3px', textAlign: 'right', padding: '2px 4px', fontSize: '11px', MozAppearance: 'textfield' }}
                            />
                          </div>
                        </div>
                        <input
                    type="range"
                    min="-500"
                    max="500"
                    step="10"
                    value={project.lighting.directionalLights[0].position.z}
                    onChange={(e) => {
                      const newLights = [...project.lighting.directionalLights];
                      newLights[0] = { ...newLights[0], position: { ...newLights[0].position, z: Number(e.target.value) } };
                      setProject(prev => ({
                        ...prev,
                        lighting: { ...prev.lighting, directionalLights: newLights }
                      }));
                    }}
                    style={{ width: '100%', marginBottom: '8px' }}
                  />
                </>
              )}
            </div>
          )}

          {(embeddedUI || activePanel === 'render') && (
            <div style={{ marginBottom: embeddedUI ? '24px' : '0' }}>
              {embeddedUI && <h3 style={{ margin: '0 0 12px 0', paddingBottom: '8px', borderBottom: '1px solid #333', fontSize: '14px', color: '#a9b5ca' }}>Render</h3>}
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Output Size</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="number"
                  value={project.renderSettings.width}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    renderSettings: { ...prev.renderSettings, width: Number(e.target.value) }
                  }))}
                  style={{ flex: 1, padding: '6px' }}
                  placeholder="Width"
                />
                <input
                  type="number"
                  value={project.renderSettings.height}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    renderSettings: { ...prev.renderSettings, height: Number(e.target.value) }
                  }))}
                  style={{ flex: 1, padding: '6px' }}
                  placeholder="Height"
                />
              </div>

              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Format</label>
              <select
                value={project.renderSettings.outputFormat}
                onChange={(e) => setProject(prev => ({
                  ...prev,
                  renderSettings: { ...prev.renderSettings, outputFormat: e.target.value as 'png' | 'jpg' }
                }))}
                style={{ width: '100%', padding: '6px', marginBottom: '12px' }}
              >
                <option value="png">PNG</option>
                <option value="jpg">JPEG</option>
              </select>

              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={project.renderSettings.transparent}
                  onChange={(e) => setProject(prev => ({
                    ...prev,
                    renderSettings: { ...prev.renderSettings, transparent: e.target.checked }
                  }))}
                  style={{ marginRight: '8px' }}
                />
                Transparent Background
              </label>

              {onExportToParticleSystem && (
                <button
                  onClick={() => {
                    setExportFormat('particle_system');
                    setTimeout(handleRenderStart, 0);
                  }}
                  disabled={isRendering}
                  style={{
                    width: '100%',
                    padding: '12px',
                    marginTop: '10px',
                    backgroundColor: isRendering ? '#555' : '#eeb868',
                    color: '#1a1a1a',
                    border: 'none',
                    cursor: isRendering ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    borderRadius: '4px'
                  }}
                >
                  {isRendering && exportFormat === 'particle_system' ? 'Rendering...' : 'Send Directly to Particle System'}
                </button>
              )}

              <div style={{ marginTop: '15px', color: '#888', fontSize: '12px', textAlign: 'center', fontWeight: 'bold' }}>OR</div>

              <button
                onClick={() => {
                  setExportFormat('zip');
                  setTimeout(handleRenderStart, 0);
                }}
                disabled={isRendering}
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '15px',
                  backgroundColor: isRendering ? '#555' : '#0066cc',
                  color: '#fff',
                  border: 'none',
                  cursor: isRendering ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                  borderRadius: '4px'
                }}
              >
                {isRendering && exportFormat === 'zip' ? 'Rendering...' : 'Render to ZIP Archive'}
              </button>

              <button
                onClick={() => {
                  setExportFormat('individual');
                  setTimeout(handleRenderStart, 0);
                }}
                disabled={isRendering}
                style={{
                  width: '100%',
                  padding: '8px',
                  marginTop: '10px',
                  backgroundColor: isRendering ? '#333' : '#444',
                  color: '#ccc',
                  border: 'none',
                  cursor: isRendering ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  borderRadius: '4px'
                }}
              >
                {isRendering && exportFormat === 'individual' ? 'Rendering...' : 'Download Individual Files'}
              </button>

              {isRendering && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                    Frame {renderProgress.currentFrame} / {renderProgress.totalFrames}
                  </div>
                  <div style={{ 
                    width: '100%', 
                    height: '4px', 
                    backgroundColor: '#333',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${(renderProgress.currentFrame / renderProgress.totalFrames) * 100}%`,
                      height: '100%',
                      backgroundColor: '#0066cc',
                      transition: 'width 0.2s',
                    }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - 3D View */}
      <div style={embeddedUI ? {
        position: 'absolute',
        top: -9999,
        left: -9999,
        width: 800,
        height: 600,
        opacity: 0,
        pointerEvents: 'none',
      } : { flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* Top bar with snapshot button */}
        <div style={{
          padding: '8px 12px',
          backgroundColor: '#252525',
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
          alignItems: 'center',
        }}>
          {snapshotFeedback && (
            <div style={{
              fontSize: '12px',
              color: '#4CAF50',
              fontWeight: 500,
            }}>
              {snapshotFeedback}
            </div>
          )}
          <button
            onClick={handleSnapshot}
            disabled={isRendering}
            style={{
              padding: '8px 16px',
              backgroundColor: '#4CAF50',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: isRendering ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 500,
              opacity: isRendering ? 0.6 : 1,
            }}
          >
            📸 Snapshot
          </button>
        </div>

        {/* 3D Viewer */}
        <div style={{ flex: 1 }}>
          <Scene3DAnimator
            animatorObject={project.object}
            lighting={project.lighting}
            animation={project.animation}
            renderSettings={project.renderSettings}
            effects={project.effects}
            backgroundColor={project.backgroundColor}
            isRendering={isRendering}
            isPreviewPlaying={isPreviewPlaying}
            previewResetToken={previewResetToken}
            onRenderProgress={handleRenderProgress}
            onRenderComplete={handleRenderComplete}
            onSnapshotReady={handleSnapshotReady}
          />
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
      />

      {/* Region Selector Modal */}
      {showRegionSelector && (
        <RegionSelector
          onMapsGenerated={handleRegionAnalysisMaps}
          onClose={() => setShowRegionSelector(false)}
        />
      )}
    </div>
  );
}

