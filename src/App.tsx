import { generateFireSequenceHeadless, defaultTorchParams, defaultCampfireParams } from './FireHeadless';
import * as THREE from 'three';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Scene3D, Scene3DRef } from './Scene3D';
import { Animator3D } from './Animator3D';
import { CurveEditor } from './CurveEditor';

type SceneSize = {
  x: number;
  y: number;
  z: number;
};

type SceneSettings = {
  particleType?: string;
  glowEnabled?: boolean;
  backgroundColor: string;
  gridOpacity: number;
  zoomSpeed: number;
  particlePreviewMode: 'real' | 'white-dots';
  particlePreviewSize: number;
  particleBudget: number;
  adaptiveEmission?: boolean;
  particleSequenceBudget: number;
  particleSequenceBudgetLoop: boolean;
  exportProjectionMode: 'orthographic' | 'perspective';
  exportFireBlendMode?: boolean;
  cameraOrbitSpeed?: number;
};

export type SnapSettings = {
  snapX: boolean;
  snapY: boolean;
  snapZ: boolean;
  snapTarget: 'vertices' | 'lines' | 'both';
};

export type PhysicsForceType = 'gravity' | 'wind' | 'tornado' | 'drag' | 'damping' | 'attractor' | 'repulsor' | 'collider' | 'flow-curve' | 'vortex' | 'turbulence' | 'thermal-updraft';

export type PhysicsForce = {
  id: string;
  name: string;
  type: PhysicsForceType;
  position: { x: number; y: number; z: number };
  strength: number;
  radius?: number; // For attractor, repulsor, tornado, vortex
  direction?: { x: number; y: number; z: number }; // For wind
  curveId?: string; // For flow-curve: references a curve object
  targetShapeId?: string; // For attractor/repulsor/collider: target shape to pull/push towards or collide with
  affectedEmitterIds: string[]; // Which emitters this force affects
  enabled: boolean;
};

export type SceneObject = {
  id: string;
  name?: string;
  type: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  parentId?: string | null;
  properties?: any;
};

export type EmitterShapeType = 'point' | 'circle' | 'square' | 'cube' | 'ball' | 'curve' | 'layer';

export type EmitterShapeProperties = {
  emitterType: EmitterShapeType;
  emissionMode: 'surface' | 'volume' | 'edge';
  layerImageDataUrl?: string;
  useFractalNoiseMap?: boolean;
  fractalNoiseScale?: number;
  fractalNoiseDetail?: number;
  fractalNoiseSpeed?: number;
  fractalNoiseThreshold?: number;
};

export type EmitterShapeObject = SceneObject & {
  type: 'EmitterShape';
  properties: EmitterShapeProperties;
};

export type EmitterObject = SceneObject & {
  type: 'Emitter';
  properties: {
    emissionRate: number;
    emitterType?: EmitterShapeType;
    emissionMode?: 'surface' | 'volume' | 'edge';
    layerImageDataUrl?: string;
    particleLifetime: number;
    particleSpeed: number;
    particleColor: string;
    particleSize: number;
    particleOpacity: number;
    particleType: "dots" | "stars" | "circles" | "glow-circles" | "sprites" | "3d-model" | "volumetric-fire";
    particleGlow: boolean;
    particleBlendMode?: string;
    particleRotation: number;
    particleRotationVariation: number;
    particleRotationSpeed: number;
    particleRotationSpeedVariation: number;
    particleAlignToVelocity?: boolean;
  particleHorizontalFlipChance?: number;
  particlePivotX?: number;
  particlePivotY?: number;
  particleStretch?: boolean;
  particleStretchAmount?: number;
    particleSpriteImageDataUrl?: string;
    particleSpriteImageName?: string;
    particleSpriteSequenceDataUrls?: string[];
    particleSpriteSequenceFirstName?: string;
    particleSpriteSequenceFps?: number;
      particleSpriteSequenceMode?: 'loop' | 'match-life' | 'random-static';
    particleSpreadAngle?: number;
    particleSpeedVariation: number;
    particleLifetimeVariation: number;
    particleSizeVariation: number;
    particleColorVariation: number;
    particleOpacityOverLife: boolean;
    particleColorOverLife: boolean;
    particleColorOverLifeTarget: string;
    particleSizeOverLife: string;
    particleSizeOverLifeCurve?: string;
    particleOpacityOverLifeCurve?: string;
    particleRotationOverLife: boolean;
    particleRotationOverLifeCurve?: string;
      particleSeed?: number;
    showPathCurves?: boolean;
    pathCurveKeyCount?: number;
  };
};

type ObjectKeyframes = Record<string, Record<number, SceneObject>>;

type RecentFileEntry = {
  name: string;
  payload: string;
};

const DEFAULT_SCENE_SIZE: SceneSize = {
  x: 500,
  y: 500,
  z: 500,
};

const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  backgroundColor: '#1a1a1a',
  gridOpacity: 1,
  zoomSpeed: 12,
  particlePreviewMode: 'real',
  particlePreviewSize: 1.2,
  particleBudget: 500,
  adaptiveEmission: true,
  particleSequenceBudget: 30,
  particleSequenceBudgetLoop: true,
  exportProjectionMode: 'orthographic',
  exportFireBlendMode: true,
  cameraOrbitSpeed: 0,
};

const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  snapX: false,
  snapY: false,
  snapZ: false,
  snapTarget: 'both',
};

const RECENT_FILES_STORAGE_KEY = 'vertebrae_recent_files';

const cloneSceneObjects = (objects: SceneObject[]): SceneObject[] => {
  return objects.map((obj) => ({
    ...obj,
    position: { ...obj.position },
    rotation: { ...obj.rotation },
    scale: { ...obj.scale },
    properties: obj.properties ? JSON.parse(JSON.stringify(obj.properties)) : undefined,
  }));
};

const lerpNumber = (a: number, b: number, t: number) => a + (b - a) * t;

const interpolateSceneObject = (from: SceneObject, to: SceneObject, t: number): SceneObject => {
  const clampedT = Math.max(0, Math.min(1, t));

  const nextProperties: Record<string, any> = {};
  const fromProps = (from.properties ?? {}) as Record<string, any>;
  const toProps = (to.properties ?? {}) as Record<string, any>;
  const propKeys = new Set([...Object.keys(fromProps), ...Object.keys(toProps)]);

  propKeys.forEach((key) => {
    const fromValue = fromProps[key];
    const toValue = toProps[key];

    if (typeof fromValue === 'number' && typeof toValue === 'number') {
      nextProperties[key] = lerpNumber(fromValue, toValue, clampedT);
    } else if (toValue !== undefined) {
      nextProperties[key] = clampedT < 0.5 ? fromValue : toValue;
    } else {
      nextProperties[key] = fromValue;
    }
  });

  return {
    ...from,
    id: from.id,
    type: from.type,
    position: {
      x: lerpNumber(from.position.x, to.position.x, clampedT),
      y: lerpNumber(from.position.y, to.position.y, clampedT),
      z: lerpNumber(from.position.z, to.position.z, clampedT),
    },
    rotation: {
      x: lerpNumber(from.rotation.x, to.rotation.x, clampedT),
      y: lerpNumber(from.rotation.y, to.rotation.y, clampedT),
      z: lerpNumber(from.rotation.z, to.rotation.z, clampedT),
    },
    scale: {
      x: lerpNumber(from.scale.x, to.scale.x, clampedT),
      y: lerpNumber(from.scale.y, to.scale.y, clampedT),
      z: lerpNumber(from.scale.z, to.scale.z, clampedT),
    },
    properties: nextProperties,
  };
};

export function App() {
  const [showFireModal, setShowFireModal] = useState(false);
  const [appMode, setAppMode] = useState<'particle-system' | '3d-animator'>('particle-system');
  const [showScenePropertiesPanel, setShowScenePropertiesPanel] = useState(true);
  const [leftPanelTab, setLeftPanelTab] = useState<'scene' | 'hierarchy'>('hierarchy');
  const [renamingObjectId, setRenamingObjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showPresetsMenu, setShowPresetsMenu] = useState(false);
  const [showCreateSubmenu, setShowCreateSubmenu] = useState<'3D' | '2D' | 'Presets' | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [draftSize, setDraftSize] = useState<SceneSize>(DEFAULT_SCENE_SIZE);
  const [particleCameraState, setParticleCameraState] = useState<{position: THREE.Vector3, quaternion: THREE.Quaternion} | null>(null);
    const [drawMode, setDrawMode] = useState(false);
  const handleExportSpine = async () => {
    if (!scene3DRef.current) return;
    const spineData = scene3DRef.current.exportSpineData();
    if (!spineData) {
      alert("No particle cache data available. Please play the animation to cache frames first.");
      return;
    }

    try {
      const jsonString = JSON.stringify(spineData, null, 2);

      const assets = await scene3DRef.current.getExportAssets();
      const exportAssets = [];
      
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file('particle_export_spine.json', jsonString);

      if (assets && assets.length > 0) {
        for (const asset of assets) {
          zip.file(asset.name, asset.blob);
          exportAssets.push({ name: asset.name, data: await asset.blob.arrayBuffer() });
        }
      } else {
        const imageBlob = await scene3DRef.current.getParticleTextureBlob();    
        if (imageBlob) {
          zip.file('images/particles/png/particle.png', imageBlob);
          exportAssets.push({ name: 'images/particles/png/particle.png', data: await imageBlob.arrayBuffer() });
        }
      }

      if ((window as any).vertebrae?.isElectron && (window as any).vertebrae?.saveSpineExport) {
        const res = await (window as any).vertebrae.saveSpineExport({ jsonString, assets: exportAssets, projectName: 'particles' });
        if (!res.success && res.error !== 'Cancelled') {
           alert("Error saving: " + res.error);
        }
        return;
      }

      // Generate trigger download
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spine_particles_export.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error creating zip export:", err);
      // Fallback
      alert("Error creating zip file. Check console.");
    }
  };
  const [sceneSize, setSceneSize] = useState<SceneSize>(DEFAULT_SCENE_SIZE);
  const [sceneSettings, setSceneSettings] = useState<SceneSettings>(DEFAULT_SCENE_SETTINGS);
  const [snapSettings, setSnapSettings] = useState<SnapSettings>(DEFAULT_SNAP_SETTINGS);
  const [viewMode, setViewMode] = useState<'perspective' | 'x' | 'y' | 'z'>('perspective');
  const [sceneObjects, setSceneObjects] = useState<SceneObject[]>([]);
  const [undoStack, setUndoStack] = useState<SceneObject[][]>([]);
  const [redoStack, setRedoStack] = useState<SceneObject[][]>([]);
  const isHistoryActionRef = useRef(false);
  const previousSceneObjectsRef = useRef<SceneObject[]>([]);
  const scene3DRef = useRef<Scene3DRef>(null);
  
  // Timeline state
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCaching, setIsCaching] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [playReverse, setPlayReverse] = useState(false);
  const [fps] = useState(24);
  const [timelineIn, setTimelineIn] = useState(0);
  const [timelineOut, setTimelineOut] = useState(240);
  const [autoKeyEnabled, setAutoKeyEnabled] = useState(false);
  const [keyframes, setKeyframes] = useState<ObjectKeyframes>({});
  const [cachedFrameCount, setCachedFrameCount] = useState(0);
  const [cacheResetToken, setCacheResetToken] = useState(0);
  const [selectedKeyframeFrame, setSelectedKeyframeFrame] = useState<number | null>(null);
  const [showEmitterProperties, setShowEmitterProperties] = useState(true);
  const [showParticleProperties, setShowParticleProperties] = useState(true);
  const [showTransformPosition, setShowTransformPosition] = useState(true);
  const [showTransformRotation, setShowTransformRotation] = useState(true);
  const [showTransformScale, setShowTransformScale] = useState(true);
  const [showParentEmitter, setShowParentEmitter] = useState(true);
  const [physicsForces, setPhysicsForces] = useState<PhysicsForce[]>([]);
  const [showPhysicsPanel, setShowPhysicsPanel] = useState(false);
  const [selectedForceId, setSelectedForceId] = useState<string | null>(null);
  const [draggingForceId, setDraggingForceId] = useState<string | null>(null);
  const [dragCursorPos, setDragCursorPos] = useState<{ x: number; y: number } | null>(null);
  const hierarchyTreeRef = useRef<HTMLDivElement>(null);
  const hierarchyNodeRefsRef = useRef<Map<string, { element: HTMLElement; type: 'emitter' | 'force' }>>(new Map());
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_FILES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const upgraded = parsed
        .map((entry) => {
          if (typeof entry === 'string') {
            return { name: entry, payload: '' } as RecentFileEntry;
          }
          if (entry && typeof entry.name === 'string' && typeof entry.payload === 'string') {
            return { name: entry.name, payload: entry.payload } as RecentFileEntry;
          }
          return null;
        })
        .filter((entry): entry is RecentFileEntry => !!entry)
        .slice(0, 12);

      return upgraded;
    } catch {
      return [];
    }
  });
  const isApplyingKeyframeRef = useRef(false);
  const previousSelectedSerializedRef = useRef<string | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const keyframeDragRef = useRef<{
    active: boolean;
    objectId: string | null;
    frame: number;
  }>({
    active: false,
    objectId: null,
    frame: 0,
  });
  
  // Handle scale state
  const [handleScale, setHandleScale] = useState(1.0);

  const updateDraft = (axis: keyof SceneSize, value: string) => {
    const nextValue = Number.parseInt(value, 10);
    if (Number.isNaN(nextValue)) {
      setDraftSize((current) => ({ ...current, [axis]: 0 }));
      return;
    }

    setDraftSize((current) => ({ ...current, [axis]: nextValue }));
  };

  const addRecentFileEntry = useCallback((name: string, payload: string) => {
    const safeName = name.trim();
    if (!safeName) return;

    const safePayload = payload.trim();
    if (!safePayload) return;

    setRecentFiles((prev) => {
      const next = [
        { name: safeName, payload: safePayload },
        ...prev.filter((item) => !(item.name === safeName && item.payload === safePayload)),
      ].slice(0, 12);
      try {
        window.localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors silently
      }
      return next;
    });
  }, []);

  const applySceneSize = () => {
    setSceneSize({
      x: Math.max(100, draftSize.x || 0),
      y: Math.max(100, draftSize.y || 0),
      z: Math.max(100, draftSize.z || 0),
    });
  };

    const handleDrawComplete = useCallback((points: {x:number, y:number, z:number}[]) => {
      setDrawMode(false);
      
      const threshold = 1.0; // Distance threshold in 3D units
      const simplifiedPoints: {x:number, y:number, z:number}[] = [];
      if (points.length > 0) {
        simplifiedPoints.push(points[0]);
        let lastPt = points[0];
        for(let i=1; i<points.length; i++) {
            const pt = points[i];
            const dist = Math.sqrt(Math.pow(pt.x - lastPt.x, 2) + Math.pow(pt.y - lastPt.y, 2) + Math.pow(pt.z - lastPt.z, 2));
            if (dist > threshold) {
                simplifiedPoints.push(pt);
                lastPt = pt;
            }
        }
      }

      if (simplifiedPoints.length < 2) simplifiedPoints.push(points[points.length-1] || {x:0,y:1,z:0});

      const pathId = 'drawn_line_' + Date.now();
      const pathObject: SceneObject = {
        id: pathId,
        name: 'Bezier Path',
        type: 'Path',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: null,
        properties: { emitterType: 'curve' }
      };

      const emitterId = 'emitter_' + Date.now();
      const newEmitter: SceneObject = {
        id: emitterId,
        name: 'Bezier Emitter',
        type: 'Emitter',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: null,
        properties: {
          emissionRate: 100,
          particleSpeed: 10,
          particleLifetime: 3,
          particleSize: 5,
          particleColor: '#ffffff',
          shape_emitterType: 'curve'
        }
      };

      pathObject.parentId = emitterId;

      const pointObjects: SceneObject[] = simplifiedPoints.map((pt, i) => ({
        id: 'path_pt_' + Date.now() + '_' + i,
        name: 'Point ' + i,
        type: 'PathPoint',
        position: { x: pt.x, y: pt.y, z: pt.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: pathId,
        properties: {}
      }));

      setSceneObjects(prev => [...prev, newEmitter, pathObject, ...pointObjects]);
      setSelectedObjectId(newEmitter.id);
    }, []);


  const createEmitterShapeNode = useCallback((emitterId: string, baseObject?: SceneObject): EmitterShapeObject => {
    const now = Date.now();
    const shapeId = `emitter_shape_${now}_${Math.floor(Math.random() * 1000)}`;
    return {
      id: shapeId,
      name: `shape_${now}`,
      type: 'EmitterShape',
      parentId: emitterId,
      position: baseObject ? { ...baseObject.position } : { x: 0, y: 0, z: 0 },
      rotation: baseObject ? { ...baseObject.rotation } : { x: 0, y: 0, z: 0 },
      scale: baseObject ? { ...baseObject.scale } : { x: 1, y: 1, z: 1 },
      properties: {
        emitterType: 'point',
        emissionMode: 'volume',
        layerImageDataUrl: '',
      },
    };
  }, []);

  const inferEmitterShapeTypeFromObjectType = useCallback((objectType: string): EmitterShapeProperties['emitterType'] => {
    if (objectType === 'Cube') return 'cube';
    if (objectType === 'Sphere') return 'ball';
    if (objectType === 'Circle') return 'circle';
    if (objectType === 'Rectangle' || objectType === 'Triangle' || objectType === 'Polygon' || objectType === 'Plane') return 'square';
    if (objectType === 'Line' || objectType === 'Arc') return 'curve';
    if (objectType === 'Cylinder' || objectType === 'Cone' || objectType === 'Torus') return 'ball';
    return 'point';
  }, []);

  const handleUpdateEmitterProperty = useCallback((property: string, value: number | string | boolean | string[]) => {
    if (!selectedObjectId) return;
    setSceneObjects(prev => prev.map(obj => {
      if (obj.id === selectedObjectId && obj.type === 'Emitter') {
        return {
          ...obj,
          properties: {
            ...(obj as EmitterObject).properties,
            [property]: value
          }
        };
      }
      return obj;
    }));
  }, [selectedObjectId]);

  const handleUpdateEmitterShapeProperty = useCallback((property: string, value: number | string | boolean | string[]) => {
    if (!selectedObjectId) return;
    setSceneObjects((prev) => prev.map((obj) => {
      const isEmitterShapeNode = obj.type === 'EmitterShape';
      const isChildOfEmitter = !!obj.parentId && prev.some((parent) => parent.id === obj.parentId && parent.type === 'Emitter');
      if (obj.id === selectedObjectId && (isEmitterShapeNode || (obj.type !== 'Emitter' && isChildOfEmitter))) {
        return {
          ...obj,
          properties: {
            ...(obj.properties ?? {}),
            [property]: value,
          },
        };
      }
      return obj;
    }));
  }, [selectedObjectId]);

  const handleLayerImageUpload = useCallback((file: File | null) => {
    if (!selectedObjectId || !file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      handleUpdateEmitterProperty('layerImageDataUrl', dataUrl);
    };
    reader.readAsDataURL(file);
  }, [selectedObjectId, handleUpdateEmitterProperty]);

  const handleEmitterShapeLayerImageUpload = useCallback((file: File | null) => {
    if (!selectedObjectId || !file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      handleUpdateEmitterShapeProperty('layerImageDataUrl', dataUrl);
    };
    reader.readAsDataURL(file);
  }, [selectedObjectId, handleUpdateEmitterShapeProperty]);

  const readFileAsDataUrl = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!dataUrl) {
          reject(new Error('Unable to read file as data URL'));
          return;
        }
        resolve(dataUrl);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const handleParticleSpriteImageUpload = useCallback(async (file: File | null) => {
    if (!selectedObjectId || !file) return;
    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    if (!isPng) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      handleUpdateEmitterProperty('particleSpriteImageDataUrl', dataUrl);
      handleUpdateEmitterProperty('particleSpriteImageName', file.name);
      handleUpdateEmitterProperty('particleSpriteSequenceDataUrls', []);
      handleUpdateEmitterProperty('particleSpriteSequenceFirstName', '');
    } catch {
      // Ignore read errors to keep UI responsive
    }
  }, [selectedObjectId, readFileAsDataUrl, handleUpdateEmitterProperty]);

  const handleParticleSpriteSequenceUpload = useCallback(async (fileList: FileList | null) => {
    if (!selectedObjectId || !fileList || fileList.length === 0) return;

    const files = Array.from(fileList).filter((file) => file.type === 'image/png' || file.name.toLowerCase().endsWith('.png'));
    if (files.length === 0) return;

    try {
      const dataUrls = await Promise.all(files.map((file) => readFileAsDataUrl(file)));
      handleUpdateEmitterProperty('particleSpriteSequenceDataUrls', dataUrls);
      handleUpdateEmitterProperty('particleSpriteSequenceFirstName', files[0].name);
      
      // Keep existing FPS or initialize default
      const currentProps = sceneObjects.find(obj => obj.id === selectedObjectId)?.properties as EmitterObject['properties'] | undefined;
      if (!currentProps?.particleSpriteSequenceFps) {
        handleUpdateEmitterProperty('particleSpriteSequenceFps', 12);
      }
      
      handleUpdateEmitterProperty('particleSpriteImageDataUrl', '');
      handleUpdateEmitterProperty('particleSpriteImageName', '');
    } catch {
      // Ignore read errors to keep UI responsive
    }
  }, [selectedObjectId, sceneObjects, readFileAsDataUrl, handleUpdateEmitterProperty]);

  const handleObjectTransform = useCallback((
    objectId: string, 
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number },
    scale: { x: number; y: number; z: number }
  ) => {
    setSceneObjects(prev => prev.map(obj => {
      if (obj.id === objectId) {
        return {
          ...obj,
          position,
          rotation,
          scale
        };
      }
      return obj;
    }));
  }, []);

  const handleUpdateSelectedObjectTransform = useCallback((
    section: 'position' | 'rotation' | 'scale',
    axis: 'x' | 'y' | 'z',
    value: number
  ) => {
    if (!selectedObjectId || Number.isNaN(value)) return;

    const sceneExtent = Math.max(Math.max(100, sceneSize.x || 0), Math.max(100, sceneSize.y || 0), Math.max(100, sceneSize.z || 0));
    const gridDivisions = Math.max(10, Math.round(sceneExtent / 50));
    const gridStep = sceneExtent / gridDivisions;
    const shouldSnapAxis =
      (axis === 'x' && snapSettings.snapX) ||
      (axis === 'y' && snapSettings.snapY) ||
      (axis === 'z' && snapSettings.snapZ);
    const nextValue = section === 'position' && shouldSnapAxis
      ? Math.round(value / gridStep) * gridStep
      : value;

    setSceneObjects((prev) => prev.map((obj) => {
      if (obj.id !== selectedObjectId) return obj;
      return {
        ...obj,
        [section]: {
          ...obj[section],
          [axis]: nextValue,
        },
      };
    }));
  }, [selectedObjectId, sceneSize.x, sceneSize.y, sceneSize.z, snapSettings.snapX, snapSettings.snapY, snapSettings.snapZ]);

  const selectedObject = (() => {
    const direct = sceneObjects.find((obj) => obj.id === selectedObjectId);
    if (direct) return direct;
    if (!selectedObjectId) return undefined;

    const objectFrames = keyframes[selectedObjectId];
    if (!objectFrames) return undefined;

    const frameKeys = Object.keys(objectFrames)
      .map((frame) => Number.parseInt(frame, 10))
      .filter((frame) => !Number.isNaN(frame))
      .sort((a, b) => a - b);

    if (frameKeys.length === 0) return undefined;

    const previousFrame = frameKeys.reduce((last, frame) => (frame <= currentFrame ? frame : last), -1);
    const fallbackFrame = previousFrame >= 0 ? previousFrame : frameKeys[0];
    const snapshot = objectFrames[fallbackFrame];
    return snapshot ? (JSON.parse(JSON.stringify(snapshot)) as SceneObject) : undefined;
  })();

  const normalizeObjectName = useCallback((value: string) => {
    return value
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '');
  }, []);

  const getObjectDisplayName = useCallback((obj: SceneObject) => {
    return obj.name && obj.name.trim().length > 0 ? obj.name : obj.id;
  }, []);

  const startRenameObject = useCallback((target: SceneObject | string) => {
    const objectId = typeof target === 'string' ? target : target.id;
    const fallbackObject = typeof target === 'string' ? null : target;
    const latestObject = sceneObjects.find((obj) => obj.id === objectId) ?? fallbackObject;
    if (!latestObject) return;

    setRenamingObjectId(latestObject.id);
    setRenameDraft(normalizeObjectName(getObjectDisplayName(latestObject)));
  }, [sceneObjects, getObjectDisplayName, normalizeObjectName]);

  const commitRenameObject = useCallback((objectId: string) => {
    const nextName = normalizeObjectName(renameDraft);
    if (nextName.length > 0) {
      setSceneObjects((prev) => prev.map((obj) => (
        obj.id === objectId
          ? { ...obj, name: nextName }
          : obj
      )));

      setKeyframes((prev) => {
        const objectFrames = prev[objectId];
        if (!objectFrames) return prev;

        const updatedObjectFrames: Record<number, SceneObject> = {};
        Object.keys(objectFrames).forEach((frameKey) => {
          const frame = Number.parseInt(frameKey, 10);
          const snapshot = objectFrames[frame];
          if (snapshot) {
            updatedObjectFrames[frame] = {
              ...snapshot,
              name: nextName,
            };
          }
        });

        return {
          ...prev,
          [objectId]: updatedObjectFrames,
        };
      });
    }
    setRenamingObjectId(null);
    setRenameDraft('');
  }, [normalizeObjectName, renameDraft]);

  const cancelRenameObject = useCallback(() => {
    setRenamingObjectId(null);
    setRenameDraft('');
  }, []);

  useEffect(() => {
    if (!renamingObjectId) return;
    const exists = sceneObjects.some((obj) => obj.id === renamingObjectId);
    if (!exists) {
      cancelRenameObject();
    }
  }, [renamingObjectId, sceneObjects, cancelRenameObject]);

  const selectedEmitterProperties = selectedObject?.type === 'Emitter'
    ? {
      emissionRate: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.emissionRate ?? 100),
      emitterType: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.emitterType ?? 'point') as EmitterObject['properties']['emitterType'],
      emissionMode: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.emissionMode ?? 'volume') as EmitterObject['properties']['emissionMode'],
      layerImageDataUrl: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.layerImageDataUrl ?? ''),
      particleLifetime: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleLifetime ?? 3),
      particleSpeed: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSpeed ?? 50),
      particleColor: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleColor ?? '#ffffff'),
      particleSize: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSize ?? 0.8),
      particleOpacity: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleOpacity ?? 1),
      particleType: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleType ?? 'dots') as EmitterObject['properties']['particleType'],
      particleGlow: Boolean((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleGlow ?? false),
      particleBlendMode: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleBlendMode ?? 'normal'),
      particleRotation: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleRotation ?? 0),
      particleRotationVariation: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleRotationVariation ?? 0),
      particleRotationSpeed: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleRotationSpeed ?? 0),
      particleRotationSpeedVariation: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleRotationSpeedVariation ?? 0),
      particleAlignToVelocity: Boolean((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleAlignToVelocity ?? false),
      particleHorizontalFlipChance: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleHorizontalFlipChance ?? 0),
        particlePivotX: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particlePivotX ?? 0.5),
        particlePivotY: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particlePivotY ?? 0.5),
      particleStretch: Boolean((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleStretch ?? false),
      particleStretchAmount: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleStretchAmount ?? 0.05),
      particleSpriteImageDataUrl: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSpriteImageDataUrl ?? ''),
      particleSpriteImageName: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSpriteImageName ?? ''),
      particleSpriteSequenceDataUrls: Array.isArray((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSpriteSequenceDataUrls)
        ? ((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSpriteSequenceDataUrls as string[])
        : [],
      particleSpriteSequenceFirstName: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSpriteSequenceFirstName ?? ''),
      particleSpriteSequenceMode: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSpriteSequenceMode ?? 'loop'),
        particleSpriteSequenceFps: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSpriteSequenceFps ?? 12),
      particleSpeedVariation: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSpeedVariation ?? 0.2),
      particleSpreadAngle: (selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSpreadAngle,
      particleLifetimeVariation: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleLifetimeVariation ?? 0),
      particleSizeVariation: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSizeVariation ?? 0),
      particleColorVariation: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleColorVariation ?? 0),
      particleOpacityOverLife: Boolean((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleOpacityOverLife ?? false),
      particleColorOverLife: Boolean((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleColorOverLife ?? false),
      particleColorOverLifeTarget: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleColorOverLifeTarget ?? '#000000'),
      particleSizeOverLife: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSizeOverLife ?? 'none'),
        particleSizeOverLifeCurve: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSizeOverLifeCurve ?? ''),
        particleOpacityOverLifeCurve: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleOpacityOverLifeCurve ?? ''),
        particleSeed: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSeed ?? 0),
      showPathCurves: Boolean((selectedObject.properties as EmitterObject['properties'] | undefined)?.showPathCurves ?? false),
      pathCurveKeyCount: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.pathCurveKeyCount ?? 5),
    }
    : null;

  const selectedObjectIsEmitterChild = !!selectedObject?.parentId && sceneObjects.some((obj) => (
    obj.id === selectedObject.parentId && obj.type === 'Emitter'
  ));

  const selectedActsAsEmitterSource = !!selectedObject && selectedObject.type !== 'Emitter' && selectedObjectIsEmitterChild;

  const selectedEmitterShapeProperties = selectedActsAsEmitterSource
    ? {
      emitterType: String((selectedObject.properties as EmitterShapeProperties | undefined)?.emitterType ?? inferEmitterShapeTypeFromObjectType(selectedObject.type)) as EmitterShapeProperties['emitterType'],
      emissionMode: String((selectedObject.properties as EmitterShapeProperties | undefined)?.emissionMode ?? 'volume') as EmitterShapeProperties['emissionMode'],
      layerImageDataUrl: String((selectedObject.properties as EmitterShapeProperties | undefined)?.layerImageDataUrl ?? ''),
      useFractalNoiseMap: Boolean((selectedObject.properties as EmitterShapeProperties | undefined)?.useFractalNoiseMap ?? false),
      fractalNoiseScale: Number((selectedObject.properties as EmitterShapeProperties | undefined)?.fractalNoiseScale ?? 1),
      fractalNoiseDetail: Number((selectedObject.properties as EmitterShapeProperties | undefined)?.fractalNoiseDetail ?? 3),
      fractalNoiseSpeed: Number((selectedObject.properties as EmitterShapeProperties | undefined)?.fractalNoiseSpeed ?? 1),
      fractalNoiseThreshold: Number((selectedObject.properties as EmitterShapeProperties | undefined)?.fractalNoiseThreshold ?? 0.5),
    }
    : null;

  const getEmissionModeOptions = useCallback((shapeType: EmitterShapeProperties['emitterType']) => {
    if (shapeType === 'cube' || shapeType === 'ball') {
      return [
        { value: 'volume', label: 'Volume/Inside' },
        { value: 'surface', label: 'Surface' },
      ] as const;
    }

    if (shapeType === 'circle' || shapeType === 'square' || shapeType === 'layer') {
      return [
        { value: 'surface', label: 'Surface' },
        { value: 'edge', label: 'Edge' },
      ] as const;
    }

    if (shapeType === 'curve') {
      return [
        { value: 'edge', label: 'Curve' },
      ] as const;
    }

    return [
      { value: 'volume', label: 'Volume' },
      { value: 'surface', label: 'Surface' },
    ] as const;
  }, []);

  const normalizeEmissionModeForShape = useCallback((
    shapeType: EmitterShapeProperties['emitterType'],
    mode: EmitterShapeProperties['emissionMode']
  ): EmitterShapeProperties['emissionMode'] => {
    const options = getEmissionModeOptions(shapeType).map((option) => option.value);
    if (options.includes(mode)) {
      return mode;
    }
    return options[0] as EmitterShapeProperties['emissionMode'];
  }, [getEmissionModeOptions]);

  const clampFrame = useCallback((value: number) => {
    const minFrame = Math.max(0, timelineIn);
    const maxFrame = Math.max(minFrame, timelineOut);
    return Math.max(minFrame, Math.min(maxFrame, value));
  }, [timelineIn, timelineOut]);

  const upsertKeyframe = useCallback((objectId: string, frame: number, snapshot: SceneObject) => {
    const safeFrame = Math.max(0, frame);
    setKeyframes((prev) => ({
      ...prev,
      [objectId]: {
        ...(prev[objectId] || {}),
        [safeFrame]: JSON.parse(JSON.stringify(snapshot)),
      },
    }));
  }, []);

  const deleteKeyframeAtFrame = useCallback((objectId: string, frame: number) => {
    setKeyframes((prev) => {
      const objectFrames = prev[objectId];
      if (!objectFrames || objectFrames[frame] === undefined) return prev;

      const updatedFrames = { ...objectFrames };
      delete updatedFrames[frame];

      const next = { ...prev };
      if (Object.keys(updatedFrames).length === 0) {
        delete next[objectId];
      } else {
        next[objectId] = updatedFrames;
      }
      return next;
    });
  }, []);

  const moveKeyframe = useCallback((objectId: string, fromFrame: number, toFrame: number) => {
    if (fromFrame === toFrame) return;

    setKeyframes((prev) => {
      const objectFrames = prev[objectId];
      if (!objectFrames || objectFrames[fromFrame] === undefined) return prev;

      const updatedFrames = { ...objectFrames };
      const snapshot = updatedFrames[fromFrame];
      delete updatedFrames[fromFrame];
      updatedFrames[toFrame] = JSON.parse(JSON.stringify(snapshot));

      return {
        ...prev,
        [objectId]: updatedFrames,
      };
    });
  }, []);

  useEffect(() => {
    if (isHistoryActionRef.current) {
      isHistoryActionRef.current = false;
      previousSceneObjectsRef.current = cloneSceneObjects(sceneObjects);
      return;
    }

    const previousSnapshot = previousSceneObjectsRef.current;
    if (previousSnapshot !== sceneObjects) {
      setUndoStack((prev) => [cloneSceneObjects(previousSnapshot), ...prev].slice(0, 100));
      setRedoStack([]);
    }

    previousSceneObjectsRef.current = cloneSceneObjects(sceneObjects);
  }, [sceneObjects]);

  const handleUndo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;

      const [previousSnapshot, ...remainingUndo] = prevUndo;
      setRedoStack((prevRedo) => [cloneSceneObjects(sceneObjects), ...prevRedo].slice(0, 100));
      isHistoryActionRef.current = true;
      setSceneObjects(cloneSceneObjects(previousSnapshot));
      return remainingUndo;
    });
  }, [sceneObjects]);

  const handleRedo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;

      const [nextSnapshot, ...remainingRedo] = prevRedo;
      setUndoStack((prevUndo) => [cloneSceneObjects(sceneObjects), ...prevUndo].slice(0, 100));
      isHistoryActionRef.current = true;
      setSceneObjects(cloneSceneObjects(nextSnapshot));
      return remainingRedo;
    });
  }, [sceneObjects]);

  const buildSceneData = useCallback(() => {
    return {
      sceneSize,
      sceneSettings,
      viewMode,
      sceneObjects,
      timeline: {
        in: timelineIn,
        out: timelineOut,
        currentFrame,
      },
      keyframes,
      physicsForces,
    };
  }, [sceneSize, sceneSettings, viewMode, sceneObjects, timelineIn, timelineOut, currentFrame, keyframes, physicsForces]);

  const applySceneData = useCallback((data: any) => {
    if (data.sceneSize) {
      setSceneSize(data.sceneSize);
      setDraftSize(data.sceneSize);
    }
    if (data.sceneSettings) {
      setSceneSettings({
        ...DEFAULT_SCENE_SETTINGS,
        ...data.sceneSettings,
      });
    }
    if (data.viewMode) {
      setViewMode(data.viewMode);
    }
    if (data.sceneObjects) {
      setSceneObjects(data.sceneObjects);
    }
    if (data.timeline) {
      const nextIn = Number.parseInt(String(data.timeline.in ?? 0), 10);
      const nextOut = Number.parseInt(String(data.timeline.out ?? 240), 10);
      const nextCurrent = Number.parseInt(String(data.timeline.currentFrame ?? 0), 10);
      const safeIn = Number.isNaN(nextIn) ? 0 : Math.max(0, nextIn);
      const safeOutCandidate = Number.isNaN(nextOut) ? 240 : Math.max(0, nextOut);
      const safeOut = Math.max(safeIn, safeOutCandidate);
      const safeCurrent = Number.isNaN(nextCurrent)
        ? safeIn
        : Math.max(safeIn, Math.min(safeOut, nextCurrent));

      setTimelineIn(safeIn);
      setTimelineOut(safeOut);
      setCurrentFrame(safeCurrent);
    }
    if (data.keyframes) {
      setKeyframes(data.keyframes as ObjectKeyframes);
    }
    if (data.physicsForces && Array.isArray(data.physicsForces)) {
      setPhysicsForces(data.physicsForces as PhysicsForce[]);
    }
  }, []);

  const handleOpenRecentFile = useCallback((entry: RecentFileEntry) => {
    if (!entry.payload) return;
    try {
      const data = JSON.parse(entry.payload);
      applySceneData(data);
      setShowFileMenu(false);
    } catch {
      setRecentFiles((prev) => {
        const next = prev.filter((item) => !(item.name === entry.name && item.payload === entry.payload));
        try {
          window.localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Ignore storage errors silently
        }
        return next;
      });
    }
  }, [applySceneData]);

  const handleSave = useCallback(() => {
    const sceneData = buildSceneData();
    const json = JSON.stringify(sceneData, null, 2);
    const compactPayload = JSON.stringify(sceneData);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scene.json';
    a.click();
    URL.revokeObjectURL(url);
    addRecentFileEntry('scene.json', compactPayload);
    setShowFileMenu(false);
  }, [buildSceneData, addRecentFileEntry]);

  const handleSaveAs = useCallback(() => {
    // For now, same as Save (will prompt for download location)
    handleSave();
  }, [handleSave]);

  const handleNewScene = useCallback(() => {
    if (window.confirm('Are you sure you want to start a new scene? All unsaved changes will be lost.')) {
      setSceneObjects([]);
      setPhysicsForces([]);
      setKeyframes({});
      setUndoStack([]);
      setRedoStack([]);
      setCurrentFrame(0);
      setTimelineIn(0);
      setTimelineOut(240);
      setSelectedObjectId(null);
      setSelectedForceId(null);
      setIsPlaying(false);
      setIsCaching(false);
      setCacheResetToken(Date.now());
      setSceneSize(DEFAULT_SCENE_SIZE);
      setDraftSize(DEFAULT_SCENE_SIZE);
      setSceneSettings(DEFAULT_SCENE_SETTINGS);
      setViewMode('perspective');
      setShowFileMenu(false);
    }
  }, []);

  const handleOpen = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = event.target?.result as string;
          const data = JSON.parse(json);
          applySceneData(data);
          addRecentFileEntry(file.name, json);
        } catch (error) {
          console.error('Error loading scene:', error);
          alert('Error loading scene file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
    setShowFileMenu(false);
  }, [addRecentFileEntry, applySceneData]);

  const handleExportToParticleSystemNoSwitch = useCallback((dataUrls: string[]) => {
    let targetId = selectedObjectId;
    let target = sceneObjects.find(obj => obj.id === targetId && obj.type === 'Emitter');
    if (!target) {
      target = sceneObjects.find(obj => obj.type === 'Emitter');
      if (target) { targetId = target.id; }
    }

    if (targetId && target) {
      setSceneObjects(prev => prev.map(obj => {
        if (obj.id === target?.id) {
          return {
            ...obj,
            properties: {
              ...(obj.properties as any),
              particleType: 'sprites',
              particleSpriteSequenceDataUrls: dataUrls,
              particleSpriteSequenceFirstName: 'Rendered Animation',
              particleSpriteSequenceFps: (obj.properties as any).particleSpriteSequenceFps || 24,
              particleSpriteSequenceWaitFrames: 0,
            }
          };
        }
        return obj;
      }));
      setSelectedObjectId(targetId);
    } else {
      const newObject: any = { id: `Emitter_${Date.now()}`, name: 'Animated Sprite Emitter', type: 'Emitter', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, parentId: null };
      newObject.properties = { emissionRate: 5, emitterType: 'point', emissionMode: 'volume', layerImageDataUrl: '', particleLifetime: 3, particleSpeed: 50, particleSpeedVariation: 0.2, particleSize: 5, particleSizeVariation: 0.2, particleColor: '#ffffff', particleColorVariation: 0.1, particleOpacity: 1, particleType: 'sprites', particleGlow: false, particleRotation: 0, particleRotationVariation: 0, particleRotationSpeed: 0, particleRotationSpeedVariation: 0,
      particleAlignToVelocity: false, particleStretch: false, particleStretchAmount: 0.05, particleTextureUrl: '', particleTextureName: '', particleSpriteImageDataUrl: '', particleSpriteImageName: '', particleOpacityOverLifeCurve: '', particleRotationOverLife: false, particleRotationOverLifeCurve: '', particleSizeOverLifeCurve: '', particleOpacityOverLife: false, particleColorOverLife: false, particleColorOverLifeTarget: '#000000', particleSizeOverLife: 'none', particleSpriteSequenceDataUrls: dataUrls, particleSpriteSequenceFirstName: 'Rendered Animation', particleSpriteSequenceFps: 24, particleSpriteSequenceMode: 'loop'};
      setSceneObjects(prev => [...prev, newObject]);
      setSelectedObjectId(newObject.id);
    }
  }, [sceneObjects, selectedObjectId]);

  const handleExportToParticleSystem = useCallback((dataUrls: string[]) => {
    setAppMode('particle-system');
    handleExportToParticleSystemNoSwitch(dataUrls);
  }, [handleExportToParticleSystemNoSwitch]);

  const handleCreateObject = useCallback((objectType: string) => {
    const newObject: SceneObject = {
      id: `${objectType.toLowerCase()}_${Date.now()}`,
      name: objectType.toLowerCase(),
      type: objectType,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      parentId: null,
    };

    if (objectType === 'Emitter') {
      (newObject as EmitterObject).properties = {
        emissionRate: 100,
        emitterType: 'point',
        emissionMode: 'volume',
        layerImageDataUrl: '',
        particleLifetime: 3,
        particleSpeed: 50,
          particleSpreadAngle: 36,
          particleColor: '#ffffff',
        particleSize: 0.8,
        particleOpacity: 1,
        particleType: 'dots',
        particleGlow: false,
        particleRotation: 0,
        particleRotationVariation: 0,
        particleRotationSpeed: 0,
        particleRotationSpeedVariation: 0, particleStretch: false, particleStretchAmount: 0.05,
        particleSpriteImageDataUrl: '',
        particleSpriteImageName: '',
        particleSpriteSequenceDataUrls: [],
        particleSpriteSequenceFirstName: '',
        particleSpeedVariation: 0.2,
        particleLifetimeVariation: 0,
        particleSizeVariation: 0,
        particleColorVariation: 0,
        particleOpacityOverLife: true,
        particleColorOverLife: false,
        particleColorOverLifeTarget: '#000000',
        particleSizeOverLife: 'none',
          particleSeed: Math.floor(Math.random() * 1000000),
        showPathCurves: false,
        pathCurveKeyCount: 5,
      };

      const emitterShapeNode = createEmitterShapeNode(newObject.id, newObject);
      setSceneObjects((prev) => [...prev, newObject, emitterShapeNode]);
      setSelectedObjectId(newObject.id);
      setShowCreateMenu(false);
          setShowPresetsMenu(false);
      return;
    }

    setSceneObjects((prev) => [...prev, newObject]);
    setShowCreateMenu(false);
  }, [createEmitterShapeNode]);

    const [customPresets, setCustomPresets] = useState<Record<string, Record<string, any>>>(() => { try { const saved = localStorage.getItem('customEmitterPresets'); return saved ? JSON.parse(saved) : {}; } catch (e) { return {}; } });
  const handleSaveCustomPreset = useCallback(() => { const selectedObj = sceneObjects.find(obj => obj.id === selectedObjectId); if (!selectedObj || selectedObj.type !== 'Emitter') { alert('Please select an Emitter object to save its preset.'); return; } const presetName = prompt('Enter a name for the custom emitter preset (must be unique):'); if (!presetName || presetName.trim() === '') return; const savedProps = JSON.parse(JSON.stringify(selectedObj.properties)); setCustomPresets(prev => { const next = { ...prev, [presetName.trim()]: savedProps }; localStorage.setItem('customEmitterPresets', JSON.stringify(next)); return next; }); alert('Preset saved!'); }, [sceneObjects, selectedObjectId]);
  const handleLoadCustomPreset = useCallback((presetName: string) => { const props = customPresets[presetName]; if (!props) return; const newEmitter: SceneObject = { id: 'emitter_' + Date.now(), name: presetName, type: 'Emitter', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, parentId: null, properties: JSON.parse(JSON.stringify(props)) }; const emitterShapeNode = createEmitterShapeNode(newEmitter.id, newEmitter); setSceneObjects((prev) => [...prev, newEmitter, emitterShapeNode]); setSelectedObjectId(newEmitter.id); }, [customPresets, createEmitterShapeNode]);

  const handleCreateFirePreset = useCallback(async (presetType: 'campfire' | 'torch') => {
    let dataUrls: string[] = [];
    if (presetType === 'torch') {
      try {
        dataUrls = await generateFireSequenceHeadless(defaultTorchParams);
      } catch(e) { console.error(e) }
    } else if (presetType === 'campfire') {
      try {
        dataUrls = await generateFireSequenceHeadless(defaultCampfireParams);
      } catch(e) { console.error(e) }
    }
    const emitterId = `emitter_${Date.now()}`;
    const newEmitter: SceneObject = {
      id: emitterId,
      name: presetType === 'campfire' ? 'Campfire Emitter' : 'Torch Emitter',
      type: 'Emitter',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      parentId: null,
      properties: {
        emissionRate: presetType === 'campfire' ? 80 : 150,
        emitterType: 'circle',
        emissionMode: 'volume',
        layerImageDataUrl: '',
        particleLifetime: presetType === 'campfire' ? 2 : 1.5,
        particleSpeed: presetType === 'campfire' ? 10 : 25,
        particleColor: '#ffffff',
        particleSize: dataUrls.length > 0 ? (presetType === 'campfire' ? 12.0 : 8.0) : 5.0,
        particleOpacity: 0.8,
        particleType: dataUrls.length > 0 ? 'sprites' : 'dots',
        particleGlow: true,
        particleRotation: 0,
        particleRotationVariation: 180,
        particleRotationSpeed: 2,
        particleRotationSpeedVariation: 1,
        particleStretch: false,
        particleStretchAmount: 0.05,
        particleSpriteImageDataUrl: '',
        particleSpriteImageName: '',
        particleSpriteSequenceDataUrls: dataUrls,
        particleSpriteSequenceFps: dataUrls.length > 0 ? (presetType === 'campfire' ? defaultCampfireParams.fps : defaultTorchParams.fps) : 30,
        particleSpriteSequenceFirstName: '',
        particleSpeedVariation: 0.3,
        particleLifetimeVariation: 0.2,
        particleSizeVariation: 0.4,
        particleColorVariation: 0,
        particleOpacityOverLife: true,
        particleColorOverLife: true,
        particleColorOverLifeTarget: '#ffbb00', // fade to orange instead of pure black/white
        particleSizeOverLife: 'shrink',
        particleSeed: Math.floor(Math.random() * 1000000),
        showPathCurves: false,
        pathCurveKeyCount: 5,
      }
    };

    // Adjust scale for shape based on preset
    const shapeScaleX = presetType === 'campfire' ? 1.5 : 0.5;
    const shapeScaleZ = presetType === 'campfire' ? 1.5 : 0.5;

    const baseShapeNode = createEmitterShapeNode(emitterId, newEmitter);
    const emitterShapeNode = {
      ...baseShapeNode,
      scale: { x: shapeScaleX, y: 1, z: shapeScaleZ }
    };

    // Physics forces
    const windForceId = `force-${Date.now()}-wind`;
    const windForce: PhysicsForce = {
      id: windForceId,
      name: 'Fire Wind',
      type: 'wind',
      position: { x: 0, y: 0, z: 0 },
      strength: presetType === 'campfire' ? 8 : 15, // move particles up
      radius: 100,
      direction: { x: 0, y: 1, z: 0 },
      affectedEmitterIds: [emitterId],
      enabled: true,
    };

    const turbulenceForceId = `force-${Date.now()}-turb`;
    const turbulenceForce: PhysicsForce = {
      id: turbulenceForceId,
      name: 'Fire Turbulence',
      type: 'turbulence',
      position: { x: 0, y: 50, z: 0 },
      strength: presetType === 'campfire' ? 10 : 5,
      radius: 200,
      direction: { x: 0, y: 1, z: 0 },
      affectedEmitterIds: [emitterId],
      enabled: true,
    };

    setSceneObjects((prev) => [...prev, newEmitter, emitterShapeNode]);
    setPhysicsForces((prev) => [...prev, windForce, turbulenceForce]);
    setSelectedObjectId(newEmitter.id);
    setShowCreateMenu(false);
    setShowCreateSubmenu(null);
  }, [createEmitterShapeNode]);


  const handleCreateClassicPreset = useCallback((presetType: 'sparks' | 'smoke' | 'fire' | 'fireflies') => {
    // Generate simple dot texture
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (presetType === 'smoke') {
         const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
         grad.addColorStop(0, 'rgba(200, 200, 200, 1)');
         grad.addColorStop(1, 'rgba(200, 200, 200, 0)');
         ctx.fillStyle = grad;
         ctx.fillRect(0, 0, 64, 64);
      } else {
         const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
         grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
         grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
         grad.addColorStop(0.5, 'rgba(255, 200, 100, 0.5)');
         grad.addColorStop(1, 'rgba(255, 100, 0, 0)');
         ctx.fillStyle = grad;
         ctx.fillRect(0, 0, 64, 64);
      }
    }
    const dotUrl = canvas.toDataURL();

    let props: any = {
      emissionRate: 200,
      particleType: 'sprites',
      particleSpriteImageDataUrl: dotUrl,
      particleLifetime: 3,
      particleSpeed: 25,
      particleSize: 5,
      particleOpacity: 1,
      particleColor: '#ffffff'
    };

    let shapeProps: any = { emitterType: 'point', emissionMode: 'volume' };
    let shapeScale = { x: 1, y: 1, z: 1 };
    
    let turbStrength = 0;
    let turbRadius = 30;
    let updraftStrength = 0;
    let updraftRadius = 200;

    if (presetType === 'sparks') {
      props = {
        ...props,
        emissionRate: 150,
        particleLifetime: 1.5,
        particleSpeed: 25,
        particleSpeedVariation: 0.6,
        particleSize: 5,
        particleColor: '#ffffff',
        particleColorOverLifeTarget: '#0000ff',
        particleColorOverLifeSpeed: 1.5,
        particleSizeOverLifeCurve: [ { t: 0, v: 1.0 }, { t: 0.5, v: 0.8 }, { t: 1, v: 0.0 } ],
        particleBlendMode: 'lighter',
      };
      shapeProps = { emitterType: 'point', emissionMode: 'volume' };
      shapeScale = { x: 1, y: 1, z: 1 };
      turbStrength = 15;
      turbRadius = 30;
      updraftStrength = -20; // gravity down
    } else if (presetType === 'smoke') {
      props = {
        ...props,
        emissionRate: 60,
        particleLifetime: 4.0,
        particleSpeed: 5,
        particleSpeedVariation: 2,
        particleSize: 15,
        particleColor: '#999999',
        particleColorOverLifeTarget: '#222222',
        particleColorOverLifeSpeed: 0.5,
        particleSizeOverLifeCurve: [ { t: 0, v: 0.2 }, { t: 0.5, v: 1.0 }, { t: 1, v: 2.5 } ],
        particleSizeVariation: 0.5,
        particleBlendMode: 'normal'
      };
      shapeProps = { emitterType: 'circle', emissionMode: 'surface' };
      shapeScale = { x: 2, y: 1, z: 2 };
      turbStrength = 10;
      turbRadius = 30;
      updraftStrength = 15;
    } else if (presetType === 'fire') {
      props = {
         ...props,
         emissionRate: 800,
         particleLifetime: 1.2,
         particleSpeed: 15,
         particleSpeedVariation: 0.8, // 80% speed variance
         particleSize: 12.0,
         particleSizeVariation: 0.8, // size variance
         particleColor: '#ff8800',
         particleColorVariation: 0.1, // hue variance
         particleColorOverLifeTarget: '#ff0000',
         particleColorOverLifeSpeed: 3.0,
         particleOpacityOverLife: true,
         particleSizeOverLifeCurve: [ { t: 0, v: 0.5 }, { t: 0.2, v: 1.0 }, { t: 1, v: 0.0 } ],
         particleBlendMode: 'lighter' // additive blend
      };
      shapeProps = { emitterType: 'circle', emissionMode: 'surface' };
      shapeScale = { x: 2, y: 1, z: 2 };
      turbStrength = 10; // wind turbulence
      turbRadius = 30;
      updraftStrength = 20;
    } else if (presetType === 'fireflies') {
      props = {
         ...props,
         emissionRate: 40,
         particleLifetime: 5,
         particleSpeed: 2,
         particleSize: 2,
         particleColor: '#aaff00',
         particleSizeOverLifeCurve: [ { t: 0, v: 0 }, { t: 0.2, v: 1 }, { t: 0.8, v: 1 }, { t: 1, v: 0 } ],
         particleBlendMode: 'lighter'
      };
      shapeProps = { emitterType: 'cube', emissionMode: 'volume' };
      shapeScale = { x: 8, y: 4, z: 8 };
      turbStrength = 10;
      turbRadius = 30;
      updraftStrength = 2;
    }

    const emitterId = 'emitter_' + Date.now();
    const newEmitter: SceneObject = {
      id: emitterId,
      name: presetType.charAt(0).toUpperCase() + presetType.slice(1) + ' Emitter',
      type: 'Emitter',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      parentId: null,
      properties: props
    };

    const emitterShapeNode = createEmitterShapeNode? createEmitterShapeNode(emitterId, newEmitter) : null;
    if (emitterShapeNode) {
      emitterShapeNode.properties = { ...emitterShapeNode.properties, ...shapeProps };
      emitterShapeNode.scale = shapeScale;
      emitterShapeNode.name = presetType.charAt(0).toUpperCase() + presetType.slice(1) + ' Shape';
    }

    const forceId = 'force_' + Date.now();
    const newForce: PhysicsForce = {
      id: forceId,
      name: presetType.charAt(0).toUpperCase() + presetType.slice(1) + ' Turbulence',
      type: 'turbulence',
      position: { x: 0, y: 0, z: 0 },
      strength: turbStrength,
      radius: turbRadius,
      affectedEmitterIds: [emitterId],
      enabled: true
    };

    const forceId2 = 'force2_' + Date.now();
    const newForce2: PhysicsForce = {
      id: forceId2,
      name: presetType.charAt(0).toUpperCase() + presetType.slice(1) + ' Updraft',
      type: 'thermal-updraft',
      position: { x: 0, y: 0, z: 0 },
      strength: updraftStrength,
      radius: updraftRadius,
      affectedEmitterIds: [emitterId],
      enabled: true
    };

    const els: any[] = [newEmitter];

    if (presetType === 'fire') {
       // Sparks setup
       const sparkId = 'emitter_' + Date.now() + '_sparks';
       const sparkEmitter: SceneObject = {
         id: sparkId,
         name: 'Sparks Emitter',
         type: 'Emitter',
         position: { x: 0, y: 10, z: 0 },
         rotation: { x: 0, y: 0, z: 0 },
         scale: { x: 1, y: 1, z: 1 },
         parentId: null,
         properties: {
             ...props,
             emissionRate: 15,
             particleLifetime: 0.8,
             particleSpeed: 30,
             particleSpeedVariation: 0.8,
             particleSize: 3,
             particleSizeVariation: 0.2,
             particleColor: '#ffcc55',
             particleColorOverLifeTarget: '#ffbb00',
             particleBlendMode: 'lighter'
         }
       };
       els.push(sparkEmitter);
       newForce.affectedEmitterIds.push(sparkId);
       newForce2.affectedEmitterIds.push(sparkId);
    }
    if (emitterShapeNode) els.push(emitterShapeNode);
    setSceneObjects(prev => [...prev, ...els]);

    const newForces: PhysicsForce[] = [];
    if (turbStrength !== 0) newForces.push(newForce);
    if (updraftStrength !== 0) newForces.push(newForce2);
    if (newForces.length > 0) {
      setPhysicsForces(prev => [...prev, ...newForces]);
    }
    setSelectedObjectId(newEmitter.id);
    setShowPresetsMenu(false);
  }, [createEmitterShapeNode]);



  // Timeline playback
  useEffect(() => {
    if (!isPlaying) return;

    const startFrame = Math.max(0, timelineIn);
    const endFrame = Math.max(startFrame, timelineOut);

    const interval = setInterval(() => {
      setCurrentFrame((prev) => {
        const next = playReverse ? prev - 1 : prev + 1;

        if (next < startFrame) {
          if (isLooping) return endFrame;
          setIsPlaying(false);
          return startFrame;
        }

        if (next > endFrame) {
          if (isLooping) return startFrame;
          setIsPlaying(false);
          return endFrame;
        }

        return next;
      });
    }, 1000 / fps);

    return () => clearInterval(interval);
  }, [isPlaying, isLooping, playReverse, fps, timelineIn, timelineOut]);

  useEffect(() => {
    setCurrentFrame((prev) => clampFrame(prev));
  }, [timelineIn, timelineOut, clampFrame]);

  useEffect(() => {
    setSelectedKeyframeFrame(null);
  }, [selectedObjectId]);

  useEffect(() => {
    if (selectedObject?.type === 'Emitter') {
      setShowEmitterProperties(true);
      setShowParticleProperties(true);
    }
  }, [selectedObject?.id, selectedObject?.type]);

  useEffect(() => {
    if (!selectedObjectId) {
      previousSelectedSerializedRef.current = null;
      return;
    }

    const selected = sceneObjects.find((obj) => obj.id === selectedObjectId);
    if (!selected) {
      previousSelectedSerializedRef.current = null;
      return;
    }

    const serialized = JSON.stringify(selected);
    if (previousSelectedSerializedRef.current === null) {
      previousSelectedSerializedRef.current = serialized;
      return;
    }

    const hasChanged = serialized !== previousSelectedSerializedRef.current;
    if (
      hasChanged &&
      autoKeyEnabled &&
      !isPlaying &&
      !isApplyingKeyframeRef.current
    ) {
      upsertKeyframe(selectedObjectId, currentFrame, selected);
    }

    previousSelectedSerializedRef.current = serialized;
  }, [sceneObjects, selectedObjectId, currentFrame, autoKeyEnabled, isPlaying, upsertKeyframe]);

  useEffect(() => {
    setSceneObjects((prev) => {
      let changed = false;
      const nextObjects = prev.map((obj) => {
        const objectFrames = keyframes[obj.id];
        if (!objectFrames) return obj;

        const frameKeys = Object.keys(objectFrames)
          .map((frame) => Number.parseInt(frame, 10))
          .filter((frame) => !Number.isNaN(frame))
          .sort((a, b) => a - b);

        if (frameKeys.length === 0) return obj;

        const previousFrame = frameKeys.reduce((last, frame) => (frame <= currentFrame ? frame : last), -1);
        const nextFrame = frameKeys.find((frame) => frame >= currentFrame) ?? -1;

        if (previousFrame < 0 && nextFrame < 0) return obj;

        let nextObj: SceneObject;
        if (previousFrame < 0 && nextFrame >= 0) {
          nextObj = JSON.parse(JSON.stringify(objectFrames[nextFrame])) as SceneObject;
        } else if (nextFrame < 0 && previousFrame >= 0) {
          nextObj = JSON.parse(JSON.stringify(objectFrames[previousFrame])) as SceneObject;
        } else if (previousFrame === nextFrame) {
          nextObj = JSON.parse(JSON.stringify(objectFrames[previousFrame])) as SceneObject;
        } else {
          const fromSnapshot = objectFrames[previousFrame] as SceneObject;
          const toSnapshot = objectFrames[nextFrame] as SceneObject;
          const t = (currentFrame - previousFrame) / Math.max(1, nextFrame - previousFrame);
          nextObj = interpolateSceneObject(fromSnapshot, toSnapshot, t);
        }

        if (JSON.stringify(nextObj) !== JSON.stringify(obj)) {
          changed = true;
          return nextObj;
        }
        return obj;
      });

      if (!changed) return prev;
      isApplyingKeyframeRef.current = true;
      return nextObjects;
    });

    queueMicrotask(() => {
      isApplyingKeyframeRef.current = false;
    });
  }, [currentFrame, keyframes]);

  const handlePlayToggle = () => {
    setPlayReverse(false);
    setIsPlaying(!isPlaying);
  };

  const handleStop = () => {
    setIsPlaying(false);
    setCurrentFrame(clampFrame(0));
  };

  const handleFastRewind = () => {
    setIsPlaying(false);
    setCurrentFrame(Math.max(0, timelineIn));
    setCacheResetToken((prev) => prev + 1);
  };

  const handlePlayReverse = () => {
    setPlayReverse(true);
    setIsPlaying(true);
  };

  const handleLoopToggle = () => {
    setIsLooping(!isLooping);
  };

  const handleCacheToggle = () => {
    setIsCaching(!isCaching);
  };

  const handleAddPhysicsForce = useCallback((forceType: PhysicsForceType) => {
    const newForce: PhysicsForce = {
      id: `force-${Date.now()}-${Math.random()}`,
      name: `${forceType.charAt(0).toUpperCase()}${forceType.slice(1)}`,
      type: forceType,
      position: { x: 0, y: 0, z: 0 },
      strength: 10,
      radius: 50,
      direction: { x: 0, y: -1, z: 0 },
      affectedEmitterIds: [],
      enabled: true,
    };
    setPhysicsForces((prev) => [...prev, newForce]);
    setSelectedForceId(newForce.id);
  }, []);

  const handleUpdatePhysicsForce = useCallback((forceId: string, updates: Partial<PhysicsForce>) => {
    setPhysicsForces((prev) =>
      prev.map((force) => (force.id === forceId ? { ...force, ...updates } : force))
    );
  }, []);

  const handleDeletePhysicsForce = useCallback((forceId: string) => {
    setPhysicsForces((prev) => prev.filter((f) => f.id !== forceId));
    if (selectedForceId === forceId) {
      setSelectedForceId(null);
    }
  }, [selectedForceId]);

  const handleStartDragConnection = useCallback((forceId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setDraggingForceId(forceId);
    setDragCursorPos({ x: event.clientX, y: event.clientY });
  }, []);

  const handleDragMove = useCallback((event: React.MouseEvent) => {
    if (draggingForceId && hierarchyTreeRef.current) {
      setDragCursorPos({ x: event.clientX, y: event.clientY });
    }
  }, [draggingForceId]);

  const handleDropConnection = useCallback((emitterId: string) => {
    if (draggingForceId) {
      const force = physicsForces.find((f) => f.id === draggingForceId);
      if (force) {
        const newIds = force.affectedEmitterIds.includes(emitterId)
          ? force.affectedEmitterIds.filter((id) => id !== emitterId)
          : [...force.affectedEmitterIds, emitterId];
        handleUpdatePhysicsForce(draggingForceId, { affectedEmitterIds: newIds });
      }
      setDraggingForceId(null);
      setDragCursorPos(null);
    }
  }, [draggingForceId, physicsForces, handleUpdatePhysicsForce]);

  useEffect(() => {
    if (draggingForceId) {
      const handleMouseMove = (event: MouseEvent) => {
        setDragCursorPos({ x: event.clientX, y: event.clientY });
      };

      const handleMouseUp = () => {
        setDraggingForceId(null);
        setDragCursorPos(null);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggingForceId]);

  const handleSetCurrentFrame = (frameValue: number) => {
    if (Number.isNaN(frameValue)) return;
    setCurrentFrame(clampFrame(frameValue));
  };

  const handleTimelineInChange = (value: number) => {
    if (Number.isNaN(value)) return;
    const nextIn = Math.max(0, value);
    setTimelineIn(nextIn);
    setTimelineOut((prevOut) => Math.max(nextIn, prevOut));
  };

  const handleTimelineOutChange = (value: number) => {
    if (Number.isNaN(value)) return;
    const nextOut = Math.max(0, value);
    setTimelineOut(Math.max(timelineIn, nextOut));
  };

  const getFrameFromClientX = useCallback((clientX: number) => {
    const track = timelineTrackRef.current;
    if (!track) return clampFrame(currentFrame);

    const rect = track.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / width));
    const frame = Math.round(timelineIn + ratio * Math.max(1, timelineOut - timelineIn));
    return clampFrame(frame);
  }, [timelineIn, timelineOut, clampFrame, currentFrame]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const dragState = keyframeDragRef.current;
      if (!dragState.active || !dragState.objectId) return;

      const nextFrame = getFrameFromClientX(event.clientX);
      if (nextFrame === dragState.frame) return;

      moveKeyframe(dragState.objectId, dragState.frame, nextFrame);
      dragState.frame = nextFrame;
      setSelectedKeyframeFrame(nextFrame);
      setCurrentFrame(nextFrame);
    };

    const onMouseUp = () => {
      if (!keyframeDragRef.current.active) return;
      keyframeDragRef.current.active = false;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [getFrameFromClientX, moveKeyframe]);

  const handleKeyframeMouseDown = (frame: number, event: React.MouseEvent<HTMLSpanElement>) => {
    if (!selectedObjectId) return;

    event.preventDefault();
    event.stopPropagation();
    setSelectedKeyframeFrame(frame);
    setCurrentFrame(frame);
    keyframeDragRef.current = {
      active: true,
      objectId: selectedObjectId,
      frame,
    };
  };

  const visibleKeyframes = (() => {
    const frameSet = new Set<number>();
    if (selectedObjectId && keyframes[selectedObjectId]) {
      Object.keys(keyframes[selectedObjectId]).forEach((frame) => {
        const parsed = Number.parseInt(frame, 10);
        if (!Number.isNaN(parsed)) frameSet.add(parsed);
      });
    } else {
      Object.values(keyframes).forEach((objectFrames) => {
        Object.keys(objectFrames).forEach((frame) => {
          const parsed = Number.parseInt(frame, 10);
          if (!Number.isNaN(parsed)) frameSet.add(parsed);
        });
      });
    }
    return Array.from(frameSet).sort((a, b) => a - b);
  })();

  const timelineRangeLength = Math.max(1, timelineOut - timelineIn + 1);
  const cachedRatio = Math.max(0, Math.min(1, cachedFrameCount / timelineRangeLength));

  const handleDuplicateObject = useCallback(() => {
    if (!selectedObjectId) return;
    
    setUndoStack((prevUndo) => [cloneSceneObjects(sceneObjects), ...prevUndo].slice(0, 100));
    setRedoStack([]);

    setSceneObjects((prevObjects) => {
      const sourceObject = prevObjects.find(obj => obj.id === selectedObjectId);
      if (!sourceObject) return prevObjects;

      // Generate a new ID
      const newId = `${sourceObject.type}-${Date.now()}`;
      
      // Clone the object, assigning the new ID, moving slightly to avoid overlap
      const clonedObject = {
        ...sourceObject,
        id: newId,
        name: `${sourceObject.name} (Copy)`,
        position: {
          x: sourceObject.position.x + 0.5,
          y: sourceObject.position.y + 0.5,
          z: sourceObject.position.z + 0.5
        }
      };

      // Set the newly cloned object as selected immediately
      setTimeout(() => setSelectedObjectId(newId), 0);

      return [...prevObjects, clonedObject];
    });
  }, [selectedObjectId, sceneObjects]);

  const handleDeleteObject = useCallback(() => {
    if (!selectedObjectId) return;
    
    // Push current state to undo stack before deleting
    setUndoStack((prevUndo) => [cloneSceneObjects(sceneObjects), ...prevUndo].slice(0, 100));
    setRedoStack([]);
    isHistoryActionRef.current = true;
    
    setSceneObjects((prev) => {
      const toDelete = new Set<string>([selectedObjectId]);
      let changed = true;
      while (changed) {
        changed = false;
        prev.forEach((obj) => {
          if (obj.parentId && toDelete.has(obj.parentId) && !toDelete.has(obj.id)) {
            toDelete.add(obj.id);
            changed = true;
          }
        });
      }
      return prev.filter((obj) => !toDelete.has(obj.id));
    });

    setKeyframes((prev) => {
      const next = { ...prev };
      delete next[selectedObjectId];
      return next;
    });
    
    // Clear selection
    setSelectedObjectId(null);
  }, [selectedObjectId, sceneObjects]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const targetElement = event.target as HTMLElement | null;
      const isTypingInInput =
        !!targetElement &&
        (targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA' || targetElement.isContentEditable);

      if (isTypingInInput) {
        return;
      }

      const key = event.key.toLowerCase();
      const isModKey = event.ctrlKey || event.metaKey;

      // Ctrl/Cmd+Z: Undo
      if (isModKey && !event.shiftKey && key === 'z') {
        event.preventDefault();
        handleUndo();
        return;
      }

      // Ctrl/Cmd+Y: Redo
      if (isModKey && ((event.shiftKey && key === 'z') || key === 'y')) {
        event.preventDefault();
        handleRedo();
        return;
      }

      // Ctrl/Cmd+N: New Scene
      if (isModKey && !event.shiftKey && key === 'n') {
        event.preventDefault();
        handleNewScene();
        return;
      }

      // Ctrl/Cmd+D: Duplicate
      if (isModKey && key === 'd') {
        event.preventDefault();
        handleDuplicateObject();
        return;
      }

      // Alt+S: Save
      if (event.altKey && !event.shiftKey && key === 's') {
        event.preventDefault();
        handleSave();
        return;
      }

      // Alt+Shift+S: Save As
      if (event.altKey && event.shiftKey && key === 's') {
        event.preventDefault();
        handleSaveAs();
        return;
      }

      // Alt+O: Open
      if (event.altKey && !event.shiftKey && key === 'o') {
        event.preventDefault();
        handleOpen();
        return;
      }

      // Backward compatibility: Alt+Z / Alt+Shift+Z
      if (event.altKey && !event.shiftKey && key === 'z') {
        event.preventDefault();
        handleUndo();
        return;
      }

      if (event.altKey && event.shiftKey && key === 'z') {
        event.preventDefault();
        handleRedo();
        return;
      }

      // Delete or Backspace: Delete selected keyframe
      if ((key === 'delete' || key === 'backspace') && selectedObjectId && selectedKeyframeFrame !== null) {
        event.preventDefault();
        deleteKeyframeAtFrame(selectedObjectId, selectedKeyframeFrame);
        setSelectedKeyframeFrame(null);
        return;
      }

      // Delete or Backspace: Delete selected object
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        handleDeleteObject();
        return;
      }

      // F2: Rename selected object
      if (event.key === 'F2' && selectedObjectId) {
        event.preventDefault();
        const targetObject = sceneObjects.find((obj) => obj.id === selectedObjectId);
        if (targetObject) {
          startRenameObject(targetObject);
        }
        return;
      }
      
      // [ with Shift (produces {): Decrease handle size
      if (event.shiftKey && (event.key === '{' || event.key === '[')) {
        event.preventDefault();
        setHandleScale(prev => Math.max(0.2, prev - 0.1));
        return;
      }
      
      // ] with Shift (produces }): Increase handle size
      if (event.shiftKey && (event.key === '}' || event.key === ']')) {
        event.preventDefault();
        setHandleScale(prev => Math.min(3.0, prev + 0.1));
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleSaveAs, handleOpen, handleUndo, handleRedo, handleDuplicateObject, handleDeleteObject, selectedObjectId, selectedKeyframeFrame, deleteKeyframeAtFrame, sceneObjects, startRenameObject]);

  const hierarchyChildrenByParent = sceneObjects.reduce((acc, obj) => {
    const validParent = obj.parentId && sceneObjects.some((candidate) => candidate.id === obj.parentId)
      ? obj.parentId
      : null;
    const list = acc.get(validParent) ?? [];
    list.push(obj);
    acc.set(validParent, list);
    return acc;
  }, new Map<string | null, SceneObject[]>());

  hierarchyChildrenByParent.forEach((items) => {
    items.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  });

  const isDescendantOf = useCallback((nodeId: string, potentialAncestorId: string) => {
    let current = sceneObjects.find((obj) => obj.id === nodeId);
    const visited = new Set<string>();

    while (current?.parentId) {
      if (current.parentId === potentialAncestorId) {
        return true;
      }
      if (visited.has(current.parentId)) {
        break;
      }
      visited.add(current.parentId);
      current = sceneObjects.find((obj) => obj.id === current?.parentId);
    }

    return false;
  }, [sceneObjects]);

  const handleReparentObject = useCallback((objectId: string, nextParentId: string | null) => {
    setSceneObjects((prev) => prev.map((obj) => (
      obj.id === objectId
        ? { ...obj, parentId: nextParentId }
        : obj
    )));
  }, []);

  const renderHierarchyNode = (obj: SceneObject, depth = 0): React.ReactNode => {
    const children = hierarchyChildrenByParent.get(obj.id) ?? [];
    const isSelected = selectedObjectId === obj.id;
    const isRenaming = renamingObjectId === obj.id;
    const typeLabel = obj.type === 'EmitterShape' ? 'Shape' : obj.type;
    const parentObject = obj.parentId ? sceneObjects.find((candidate) => candidate.id === obj.parentId) : undefined;
    const parentCandidates = sceneObjects.filter((candidate) => (
      candidate.id !== obj.id && !isDescendantOf(candidate.id, obj.id)
    ));

    return (
      <React.Fragment key={obj.id}>
        {isRenaming ? (
          <div
            className={`hierarchy-item ${isSelected ? 'selected' : ''}`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            title={obj.id}
          >
            {depth > 0 && <span className="hierarchy-connector">↳</span>}
            <span className="hierarchy-item-type">{typeLabel}</span>
            <input
              className="hierarchy-rename-input"
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(normalizeObjectName(event.target.value))}
              onBlur={() => commitRenameObject(obj.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRenameObject(obj.id);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelRenameObject();
                }
              }}
            />
            {children.length > 0 && <span className="hierarchy-item-children">({children.length})</span>}
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            className={`hierarchy-item ${isSelected ? 'selected' : ''}`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => setSelectedObjectId(obj.id)}
            onDoubleClick={(event) => {
              event.preventDefault();
              startRenameObject(obj);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSelectedObjectId(obj.id);
              }
            }}
            title={obj.id}
          >
            {depth > 0 && <span className="hierarchy-connector">↳</span>}
            <span className="hierarchy-item-type">{typeLabel}</span>
            <span
              className="hierarchy-item-name"
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                startRenameObject(obj);
              }}
              title="Double-click to rename"
            >
              {getObjectDisplayName(obj)}
            </span>
            <span className="hierarchy-item-link" title={parentObject ? `Parent: ${getObjectDisplayName(parentObject)}` : 'No parent'}>
              {parentObject ? `← ${getObjectDisplayName(parentObject)}` : '← root'}
            </span>
            <button
              type="button"
              className="rename-icon-btn"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                startRenameObject(obj);
              }}
              title="Rename"
              aria-label="Rename object"
            >
              ✎
            </button>
            <button
              type="button"
              className="link-icon-btn"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!selectedObjectId || selectedObjectId === obj.id || isDescendantOf(selectedObjectId, obj.id)) return;
                handleReparentObject(obj.id, selectedObjectId);
              }}
              disabled={!selectedObjectId || selectedObjectId === obj.id || isDescendantOf(selectedObjectId, obj.id)}
              title="Link this node under selected node"
              aria-label="Link node"
            >
              ⛓
            </button>
            <button
              type="button"
              className="link-icon-btn"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handleReparentObject(obj.id, null);
              }}
              disabled={!obj.parentId}
              title="Break link (set parent to root)"
              aria-label="Unlink node"
            >
              ⛓✕
            </button>
            <select
              className="hierarchy-parent-select"
              value={obj.parentId ?? ''}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                event.stopPropagation();
                const nextValue = event.target.value;
                handleReparentObject(obj.id, nextValue || null);
              }}
              title="Parent node"
            >
              <option value="">root</option>
              {parentCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {getObjectDisplayName(candidate)}
                </option>
              ))}
            </select>
            {children.length > 0 && <span className="hierarchy-item-children">({children.length})</span>}
          </div>
        )}
        {children.map((child) => renderHierarchyNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  // Render 3D Animator mode
  if (appMode === '3d-animator') {
    return (
      <div className="workspace">
        <div className="menu-bar">
          <div className="menu-item">
            <button
              className="menu-button"
              onClick={() => setAppMode('particle-system')}
              type="button"
              style={{ backgroundColor: '#0066cc', color: '#fff' }}
            >
              ← Particle System
            </button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '14px' }}>
            3D Asset Creator Mode
          </div>
        </div>
        <div className="main-content">
          <Animator3D onExportToParticleSystem={handleExportToParticleSystem} />
        </div>
      </div>
    );
  }

  // Render Particle System mode
  return (
    <div className="workspace">
      <div className="menu-bar">
        <div className="menu-item">
          <button
            className="menu-button"
            onClick={() => {
              setShowFileMenu(!showFileMenu);
            }}
            type="button"
          >
            File
          </button>
          {showFileMenu && (
            <div className="menu-dropdown">
              <button
                className="menu-option"
                onClick={handleNewScene}
                type="button"
              >
                <span>New Scene</span>
                <span className="shortcut">Ctrl+N</span>
              </button>
              <button
                className="menu-option"
                onClick={handleOpen}
                type="button"
              >
                <span>Open</span>
                <span className="shortcut">Alt+O</span>
              </button>
              <button
                className="menu-option"
                onClick={handleSave}
                type="button"
              >
                <span>Save</span>
                <span className="shortcut">Alt+S</span>
              </button>
              <button
                className="menu-option"
                onClick={handleSaveAs}
                type="button"
              >
                <span>Save As</span>
                <span className="shortcut">Alt+Shift+S</span>
              </button>
              <div className="menu-separator"></div>
              {recentFiles.length === 0 ? (
                <button className="menu-option disabled" type="button" disabled>
                  <span>No recent files</span>
                </button>
              ) : (
                recentFiles.map((entry, index) => (
                  <button
                    key={`${entry.name}-${entry.payload.length}-${index}`}
                    className={`menu-option ${entry.payload ? '' : 'disabled'}`.trim()}
                    onClick={() => handleOpenRecentFile(entry)}
                    type="button"
                    disabled={!entry.payload}
                    title={entry.name}
                  >
                    <span>{entry.payload ? entry.name : `${entry.name} (unavailable)`}</span>
                  </button>
                ))
              )}
              <div className="menu-separator"></div>
              <button
                className="menu-option"
                onClick={() => {
                  setShowScenePropertiesPanel(!showScenePropertiesPanel);
                  setShowFileMenu(false);
                }}
                type="button"
              >
                Scene Properties
              </button>
              <div className="menu-separator"></div>
              <button
                className="menu-option"
                onClick={() => {
                  setShowFileMenu(false);
                }}
                type="button"
              >
                Exit
              </button>
            </div>
          )}
        </div>
        <div className="menu-item">
          <button
            className="menu-button"
            onClick={() => setAppMode('3d-animator')}
            type="button"
            style={{ backgroundColor: '#eeb868', color: '#1a1a1a', fontWeight: 'bold' }}
          >
            3D Asset Creator
          </button>
        </div>
        <div className="menu-item">
          <button
            className="menu-button"
            style={drawMode ? {background: '#4a90e2'} : {}}
            onClick={() => setDrawMode(!drawMode)}
            type="button"
          >
            ✑ Draw Path
          </button>
          <button
            className="menu-button"
            onClick={() => setShowCreateMenu(!showCreateMenu)}
            type="button"
          >
            Create
          </button>
          {showCreateMenu && (
            <div className="menu-dropdown">
              <button
                className="menu-option menu-option-submenu"
                onMouseEnter={() => setShowCreateSubmenu('3D')}
                type="button"
              >
                <span>3D</span>
                <span className="submenu-indicator">▶</span>
              </button>
              {showCreateSubmenu === '3D' && (
                <div className="menu-submenu">
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Cube');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Cube</span>
                  </button>
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Sphere');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Sphere</span>
                  </button>
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Cylinder');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Cylinder</span>
                  </button>
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Cone');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Cone</span>
                  </button>
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Plane');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Plane</span>
                  </button>
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Torus');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Torus</span>
                  </button>
                </div>
              )}
              <button
                className="menu-option menu-option-submenu"
                onMouseEnter={() => setShowCreateSubmenu('2D')}
                type="button"
              >
                <span>2D</span>
                <span className="submenu-indicator">▶</span>
              </button>
              {showCreateSubmenu === '2D' && (
                <div className="menu-submenu">
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Circle');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Circle</span>
                  </button>
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Rectangle');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Rectangle</span>
                  </button>
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Triangle');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Triangle</span>
                  </button>
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Line');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Line</span>
                  </button>
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Arc');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Arc</span>
                  </button>
                  <button
                    className="menu-option"
                    onClick={() => {
                      handleCreateObject('Polygon');
                      setShowCreateMenu(false);
                      setShowCreateSubmenu(null);
                    }}
                    type="button"
                  >
                    <span>Polygon</span>
                  </button>
                </div>
              )}
              <div className="menu-separator"></div>
              <button
                className="menu-option"
                onClick={() => {
                  handleCreateObject('Emitter');
                  setShowCreateMenu(false);
                  setShowCreateSubmenu(null);
                }}
                onMouseEnter={() => setShowCreateSubmenu(null)}
                type="button"
              >
                <span>Emitter</span>
              </button>
              
            </div>
          )}
        </div>

        
        <div className="menu-item">
          <button
            className="menu-button"
            onClick={() => setShowPresetsMenu(!showPresetsMenu)}
            type="button"
            style={{ backgroundColor: '#2a9d8f', color: '#fff', fontWeight: 'bold' }}
          >
            Presets
          </button>
          {showPresetsMenu && (
            <div className="menu-dropdown">
              <button
                className="menu-option"
                onClick={() => {
                  handleCreateFirePreset('campfire');
                  setShowPresetsMenu(false);
                }}
                type="button"
              >
                <span>Campfire</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleCreateFirePreset('torch');
                  setShowPresetsMenu(false);
                }}
                type="button"
              >
                <span>Torch</span></button>

            <div style={{ padding: '8px 12px', background: '#333', fontSize: '11px', fontWeight: 'bold', color: '#999' }}>Classic Native FX</div>
            <button className="menu-option" onClick={() => { handleCreateClassicPreset('sparks'); setShowPresetsMenu(false); }} type="button">
                <span>🪄 Magic Sparks</span>
            </button>
            <button className="menu-option" onClick={() => { handleCreateClassicPreset('fire'); setShowPresetsMenu(false); }} type="button">
                <span>🔥 Stylized Fire</span>
            </button>
            <button className="menu-option" onClick={() => { handleCreateClassicPreset('smoke'); setShowPresetsMenu(false); }} type="button">
                <span>💨 Soft Smoke</span>
            </button>
            <button className="menu-option" onClick={() => { handleCreateClassicPreset('fireflies'); setShowPresetsMenu(false); }} type="button">
                <span>✨ Fireflies</span>
            </button>

<div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
<button className="menu-option" onClick={() => { handleSaveCustomPreset(); setShowPresetsMenu(false); }} type="button">
<span style={{ color: '#4cc9f0' }}>+ Save Selected Emitter</span>
</button>
{Object.keys(customPresets).map((presetName) => (
<button key={presetName} className="menu-option" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => { handleLoadCustomPreset(presetName); setShowPresetsMenu(false); }} type="button" title="Load Preset">
<span>{presetName}</span>
<span style={{ color: '#e76f51', marginLeft: '10px', fontSize: '0.8em', padding: '2px 6px', borderRadius: '4px', background: 'rgba(231, 111, 81, 0.1)' }} onClick={(e) => { e.stopPropagation(); if (confirm('Delete reset: ' + presetName + '?')) { setCustomPresets(prev => { const next = { ...prev }; delete next[presetName]; localStorage.setItem('customEmitterPresets', JSON.stringify(next)); return next; }); } }} title="Delete Preset">✕</span>
</button>
))}
</div>
          )}
        </div>

        <div className="menu-item">
          <button
            className="menu-button"
            onClick={() => setShowPhysicsPanel(!showPhysicsPanel)}
            type="button"
          >
            Physics
          </button>
          {showPhysicsPanel && (
            <div className="menu-dropdown physics-menu">
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('gravity');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Gravity</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('wind');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Wind</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('tornado');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Tornado</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('drag');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Drag</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('damping');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Damping</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('attractor');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Attractor</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('repulsor');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Repulsor</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('collider');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Collider</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('flow-curve');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Flow Along Curve</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('vortex');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Vortex</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('turbulence');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Turbulence</span>
              </button>
              <button
                className="menu-option"
                onClick={() => {
                  handleAddPhysicsForce('thermal-updraft');
                  setShowPhysicsPanel(false);
                }}
                type="button"
              >
                <span>Add Thermal Updraft</span>
              </button>
            </div>
          )}
        </div>

        <div className="menu-item">
          <button
            className="menu-button"
            onClick={handleExportSpine}
            style={{ 
              backgroundColor: '#eeb868', 
              color: '#1a1a1a', 
              fontWeight: 'bold', 
              whiteSpace: 'nowrap'
            }}
          >
            Export Cached Animation
          </button>
        </div>
        <div className="snap-toolbar" title="Grid snapping options">
          <span className="snap-title">Snap</span>
          <label className="snap-axis snap-axis-x"><input type="checkbox" checked={snapSettings.snapX} onChange={(event) => setSnapSettings((prev) => ({ ...prev, snapX: event.target.checked }))} />X</label>
          <label className="snap-axis snap-axis-y"><input type="checkbox" checked={snapSettings.snapY} onChange={(event) => setSnapSettings((prev) => ({ ...prev, snapY: event.target.checked }))} />Y</label>
          <label className="snap-axis snap-axis-z"><input type="checkbox" checked={snapSettings.snapZ} onChange={(event) => setSnapSettings((prev) => ({ ...prev, snapZ: event.target.checked }))} />Z</label>
          <select
            value={snapSettings.snapTarget}
            onChange={(event) => setSnapSettings((prev) => ({
              ...prev,
              snapTarget: event.target.value as SnapSettings['snapTarget'],
            }))}
          >
            <option value="vertices">Vertices</option>
            <option value="lines">Lines</option>
            <option value="both">Both</option>
          </select>
        </div>
      </div>

      <div className="workspace-content">
        {showScenePropertiesPanel && (
          <aside className="file-panel panel-left">
            <div className="panel-header">
              <h3>{leftPanelTab === 'scene' ? 'Scene Properties' : 'Hierarchy & Physics'}</h3>
              <button
                className="close-button"
                onClick={() => setShowScenePropertiesPanel(false)}
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="panel-content">
              <div className="property-tabs">
                <button
                  type="button"
                  className={leftPanelTab === 'scene' ? 'active' : ''}
                  onClick={() => setLeftPanelTab('scene')}
                >
                  Scene
                </button>
                <button
                  type="button"
                  className={leftPanelTab === 'hierarchy' ? 'active' : ''}
                  onClick={() => setLeftPanelTab('hierarchy')}
                >
                  Hierarchy
                </button>
              </div>

              {leftPanelTab === 'scene' && (
                <div className="property-form">
                  <label htmlFor="scene-size-x">Scene Size X: {draftSize.x}</label>
                  <input
                    id="scene-size-x"
                    min={100}
                    max={5000}
                    onChange={(event) => updateDraft('x', event.target.value)}
                    type="number"
                    value={draftSize.x}
                  />
                  <input
                    id="scene-size-x-slider"
                    min={100}
                    max={5000}
                    step={10}
                    onChange={(event) => updateDraft('x', event.target.value)}
                    type="range"
                    value={draftSize.x}
                  />

                  <label htmlFor="scene-size-y">Scene Size Y: {draftSize.y}</label>
                  <input
                    id="scene-size-y"
                    min={100}
                    max={5000}
                    onChange={(event) => updateDraft('y', event.target.value)}
                    type="number"
                    value={draftSize.y}
                  />
                  <input
                    id="scene-size-y-slider"
                    min={100}
                    max={5000}
                    step={10}
                    onChange={(event) => updateDraft('y', event.target.value)}
                    type="range"
                    value={draftSize.y}
                  />

                  <label htmlFor="scene-size-z">Scene Size Z: {draftSize.z}</label>
                  <input
                    id="scene-size-z"
                    min={100}
                    max={5000}
                    onChange={(event) => updateDraft('z', event.target.value)}
                    type="number"
                    value={draftSize.z}
                  />
                  <input
                    id="scene-size-z-slider"
                    min={100}
                    max={5000}
                    step={10}
                    onChange={(event) => updateDraft('z', event.target.value)}
                    type="range"
                    value={draftSize.z}
                  />

                  <button className="apply-button" onClick={applySceneSize} type="button">
                    Apply
                  </button>

                  <hr className="form-divider" />

                  <label htmlFor="bg-color">Background Color</label>
                  <div className="color-input-group">
                    <input
                      id="bg-color"
                      onChange={(event) => setSceneSettings((prev) => ({ ...prev, backgroundColor: event.target.value }))}
                      type="color"
                      value={sceneSettings.backgroundColor}
                    />
                    <span className="color-label">{sceneSettings.backgroundColor}</span>
                  </div>

                  <label htmlFor="grid-opacity">
                    Grid Opacity: {Math.round(sceneSettings.gridOpacity * 100)}%
                  </label>
                  <input
                    id="grid-opacity"
                    max={1}
                    min={0}
                    onChange={(event) => setSceneSettings((prev) => ({ ...prev, gridOpacity: Number.parseFloat(event.target.value) }))}
                    step={0.05}
                    type="range"
                    value={sceneSettings.gridOpacity}
                  />

                  <label htmlFor="zoom-speed">
                    Zoom Speed: {sceneSettings.zoomSpeed.toFixed(1)}x
                  </label>
                  <input
                    id="zoom-speed"
                    max={30}
                    min={1}
                    onChange={(event) => setSceneSettings((prev) => ({ ...prev, zoomSpeed: Number.parseFloat(event.target.value) }))}
                    step={0.5}
                    type="range"
                    value={sceneSettings.zoomSpeed}
                  />

                  <label htmlFor="particle-preview-mode">Particle Preview Type</label>
                  <select
                    id="particle-preview-mode"
                    value={sceneSettings.particlePreviewMode}
                    onChange={(event) => setSceneSettings((prev) => ({
                      ...prev,
                      particlePreviewMode: event.target.value as SceneSettings['particlePreviewMode'],
                    }))}
                  >
                    <option value="real">Real Particles</option>
                    <option value="white-dots">White Dots</option>
                  </select>

                  <label htmlFor="particle-preview-size">
                    Preview Dot Size: {sceneSettings.particlePreviewSize.toFixed(1)}
                  </label>
                  <input
                    id="particle-preview-size"
                    max={6}
                    min={0.2}
                    onChange={(event) => setSceneSettings((prev) => ({
                      ...prev,
                      particlePreviewSize: Number.parseFloat(event.target.value),
                    }))}
                    step={0.1}
                    type="range"
                    value={sceneSettings.particlePreviewSize}
                  />

                  <label htmlFor="particle-budget" style={{ marginTop: '10px' }} title="Limits total concurrent particles. Use lower budgets and larger particle sizes for efficient Spine animations.">
                    Global Particle Budget: {sceneSettings.particleBudget} <small style={{ color: '#888' }}>(Max per frame)</small>
                  </label>
                  <input
                    id="particle-budget"
                    max={2000}
                    min={10}
                    onChange={(event) => setSceneSettings((prev) => ({
                      ...prev,
                      particleBudget: Number.parseInt(event.target.value, 10),
                    }))}
                    step={10}
                    type="range"
                    value={sceneSettings.particleBudget}
                  />

                  <label htmlFor="particle-sequence-budget" style={{ marginTop: '10px' }} title="Limits max number of frames for a particle sequence animation. It resamples the frames to loop within this budget.">
                    Particle Sequence Budget (Max Frames): {sceneSettings.particleSequenceBudget}
                  </label>
                  <input
                    id="particle-sequence-budget"
                    max={120}
                    min={1}
                    onChange={(event) => setSceneSettings((prev) => ({
                      ...prev,
                      particleSequenceBudget: Number.parseInt(event.target.value, 10),
                    }))}
                    step={1}
                    type="range"
                    value={sceneSettings.particleSequenceBudget}
                  />

                  <label className="checkbox-label" style={{ marginTop: '10px' }} title="If checked, the animation loop speed is adjusted to fit within the frame budget. If unchecked, the original animation speed is kept, potentially cutting off the end.">
                    <input
                      type="checkbox"
                      checked={sceneSettings.particleSequenceBudgetLoop ?? true}
                      onChange={(e) => setSceneSettings((prev) => ({
                        ...prev,
                        particleSequenceBudgetLoop: e.target.checked
                      }))}
                    />
                    Loop Animation to Fit Budget
                  </label>

                  <label className="settings-label" style={{ marginTop: '10px' }} title="How particles are projected during Spine export. Orthographic is flat XY plane. Perspective uses the viewer camera.">
                    Spine Export Projection Mode
                  </label>
                  <select
                    className="settings-select"
                    value={sceneSettings.exportProjectionMode ?? 'orthographic'}
                    onChange={(event) => setSceneSettings((prev) => ({
                      ...prev,
                      exportProjectionMode: event.target.value as 'orthographic' | 'perspective',
                    }))}
                  >
                    <option value="orthographic">Orthographic (Flat XY)</option>
                    <option value="perspective">Perspective (Camera View)</option>
                  </select>
                  
                  <label className="settings-label" style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }} title="Whether to apply additive/screen blend modes to fire/glow particles in the Spine export">
                    <input
                      type="checkbox"
                      checked={sceneSettings.exportFireBlendMode ?? true}
                      onChange={(e) => setSceneSettings((prev) => ({
                        ...prev,
                        exportFireBlendMode: e.target.checked
                      }))}
                    />
                    Export Blend Modes to Spine
                  </label>

                  {sceneSettings.exportProjectionMode === 'perspective' && (
                    <>
                      <label className="settings-label" style={{ marginTop: '10px' }} title="Orbit speed of camera around origin during animation (degrees/sec)">
                        Camera Orbit Speed (deg/sec)
                      </label>
                      <input
                        type="number"
                        className="settings-input"
                        value={sceneSettings.cameraOrbitSpeed ?? 0}
                        onChange={(event) => setSceneSettings((prev) => ({
                          ...prev,
                          cameraOrbitSpeed: parseFloat(event.target.value) || 0,
                        }))}
                        step="5"
                      />
                    </>
                  )}

                </div>
              )}

              {leftPanelTab === 'hierarchy' && (
                <div 
                  className="hierarchy-tree" 
                  role="tree" 
                  aria-label="Scene hierarchy"
                  ref={hierarchyTreeRef}
                  onMouseMove={handleDragMove}
                  style={{ position: 'relative' }}
                >
                  {/* Connection visualization SVG */}
                  {draggingForceId && dragCursorPos && (
                    <svg
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                        zIndex: 10,
                      }}
                    >
                      {hierarchyTreeRef.current &&
                        Array.from(hierarchyNodeRefsRef.current.entries())
                          .filter(([id, ref]) => ref.type === 'force' && id === draggingForceId)
                          .map(([, ref]) => {
                            const sourceRect = ref.element.getBoundingClientRect();
                            const containerRect = hierarchyTreeRef.current?.getBoundingClientRect();
                            if (!containerRect) return null;
                            
                            const x1 = sourceRect.right - containerRect.left + 6;
                            const y1 = sourceRect.top + sourceRect.height / 2 - containerRect.top;
                            const x2 = dragCursorPos.x - containerRect.left;
                            const y2 = dragCursorPos.y - containerRect.top;
                            
                            return (
                              <line
                                key={`drag-line-${draggingForceId}`}
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke="#f39c12"
                                strokeWidth="2"
                                strokeDasharray="5,5"
                              />
                            );
                          })}
                    </svg>
                  )}

                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ paddingBottom: '0.5rem', fontSize: '0.75rem', color: '#a9b5ca', fontWeight: 'bold' }}>
                      OBJECTS
                    </div>
                    {(hierarchyChildrenByParent.get(null) ?? []).length === 0 ? (
                      <div className="hierarchy-empty">No objects in scene</div>
                    ) : (
                      (hierarchyChildrenByParent.get(null) ?? [])
                        .filter((obj) => obj.type === 'Emitter')
                        .map((obj) => {
                          const affectingForces = physicsForces.filter((f) => f.affectedEmitterIds.includes(obj.id));
                          return (
                            <div key={obj.id} style={{ position: 'relative' }}>
                              <div
                                ref={(el) => {
                                  if (el) {
                                    hierarchyNodeRefsRef.current.set(obj.id, { element: el, type: 'emitter' });
                                  } else {
                                    hierarchyNodeRefsRef.current.delete(obj.id);
                                  }
                                }}
                                className={`hierarchy-row ${selectedObjectId === obj.id ? 'selected' : ''} ${draggingForceId ? 'drag-target' : ''}`}
                                onClick={() => setSelectedObjectId(obj.id)}
                                onMouseEnter={
                                  draggingForceId
                                    ? (e) => {
                                        const target = e.currentTarget;
                                        target.style.backgroundColor = '#5a4a3a';
                                        target.style.borderColor = '#f39c12';
                                      }
                                    : undefined
                                }
                                onMouseLeave={
                                  draggingForceId
                                    ? (e) => {
                                        const target = e.currentTarget;
                                        target.style.backgroundColor = '';
                                        target.style.borderColor = '';
                                      }
                                    : undefined
                                }
                                onDrop={
                                  draggingForceId
                                    ? (e) => {
                                        e.preventDefault();
                                        handleDropConnection(obj.id);
                                      }
                                    : undefined
                                }
                                onDragOver={(e) => draggingForceId && e.preventDefault()}
                                role="treeitem"
                                aria-selected={selectedObjectId === obj.id}
                                style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '0.5rem',
                                  background: selectedObjectId === obj.id ? '#166bbb' : '#3a4a5a',
                                  borderLeft: '3px solid #5a9fd4'
                                }}
                              >
                                <span className="hierarchy-item-type" style={{ color: '#5a9fd4' }}>
                                  EMITTER
                                </span>
                                <span className="hierarchy-item-name">{getObjectDisplayName(obj)}</span>
                                {affectingForces.length > 0 && (
                                  <span style={{ fontSize: '0.6rem', color: '#f39c12' }}>
                                    ({affectingForces.length} force{affectingForces.length !== 1 ? 's' : ''})
                                  </span>
                                )}
                                {/* Anchor dot for dropping forces */}
                                <div
                                  style={{
                                    marginLeft: 'auto',
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    backgroundColor: affectingForces.length > 0 ? '#f39c12' : '#3b455c',
                                    cursor: draggingForceId ? 'copy' : 'default',
                                  }}
                                />
                              </div>
                            </div>
                          );
                        }))
                    }
                  </div>
                  {(hierarchyChildrenByParent.get(null) ?? []).filter((obj) => obj.type !== 'Emitter').length > 0 && (
                    <div style={{ marginBottom: '1rem', borderTop: '1px solid #3b455c', paddingTop: '0.75rem' }}>
                      <div style={{ paddingBottom: '0.5rem', fontSize: '0.75rem', color: '#a9b5ca', fontWeight: 'bold' }}>
                        SHAPES & GEOMETRY
                      </div>
                      {(hierarchyChildrenByParent.get(null) ?? [])
                        .filter((obj) => obj.type !== 'Emitter')
                        .map((obj) => (
                          <div key={obj.id}>
                            <div
                              className={`hierarchy-row ${selectedObjectId === obj.id ? 'selected' : ''}`}
                              onClick={() => setSelectedObjectId(obj.id)}
                              role="treeitem"
                              aria-selected={selectedObjectId === obj.id}
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.5rem',
                                background: selectedObjectId === obj.id ? '#188618' : '#3a5a3a',
                                borderLeft: '3px solid #7dd37d'
                              }}
                            >
                              <span className="hierarchy-item-type" style={{ color: '#7dd37d' }}>
                                {obj.type}
                              </span>
                              <span className="hierarchy-item-name">{getObjectDisplayName(obj)}</span>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #3b455c', paddingTop: '0.75rem' }}>
                    <div style={{ paddingBottom: '0.5rem', fontSize: '0.75rem', color: '#a9b5ca', fontWeight: 'bold' }}>
                      PHYSICS FORCES
                    </div>
                    {physicsForces.length === 0 ? (
                      <div className="hierarchy-empty">No physics forces</div>
                    ) : (
                      physicsForces.map((force) => (
                        <div
                          key={force.id}
                          ref={(el) => {
                            if (el) {
                              hierarchyNodeRefsRef.current.set(force.id, { element: el, type: 'force' });
                            } else {
                              hierarchyNodeRefsRef.current.delete(force.id);
                            }
                          }}
                          className={`hierarchy-row ${selectedForceId === force.id ? 'selected' : ''}`}
                          onClick={() => setSelectedForceId(force.id)}
                          role="treeitem"
                          aria-selected={selectedForceId === force.id}
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.5rem',
                            background: selectedForceId === force.id ? '#a31111' : '#5a3a3a',
                            borderLeft: '3px solid #ff6b6b'
                          }}
                        >
                          <span className="hierarchy-item-type" style={{ color: '#ff6b6b' }}>
                            {force.type.substring(0, 1).toUpperCase() + force.type.substring(1)}
                          </span>
                          <span className="hierarchy-item-name">{force.name}</span>
                          {force.affectedEmitterIds.length > 0 && (
                            <span style={{ fontSize: '0.6rem', color: '#5a9fd4' }}>
                              ({force.affectedEmitterIds.length})
                            </span>
                          )}
                          <button
                            className="hierarchy-delete-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDeletePhysicsForce(force.id);
                            }}
                            type="button"
                            title="Delete force"
                          >
                            🗑
                          </button>
                          {/* Anchor dot for dragging connections */}
                          <div
                            onMouseDown={(e) => handleStartDragConnection(force.id, e)}
                            style={{
                              marginLeft: 'auto',
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              backgroundColor: '#ff6b6b',
                              cursor: 'grab',
                              border: '2px solid #fff',
                            }}
                            title="Drag to emitter to connect"
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

        <main 
          className="scene-view"
          onClick={() => {
            setShowFileMenu(false);
            setShowCreateMenu(false);
            setShowCreateSubmenu(null);
          }}
        >
          <Scene3D
              ref={scene3DRef}
              onCameraChange={(s) => { console.log('CAMERA MOVED'); setParticleCameraState(s); }}
              sceneSize={sceneSize} 
            sceneSettings={sceneSettings} 
            snapSettings={snapSettings}
            viewMode={viewMode} 
            onViewModeChange={setViewMode}
            sceneObjects={sceneObjects}
            currentFrame={currentFrame}
            isPlaying={isPlaying}
            isCaching={isCaching}
              timelineIn={timelineIn}
              timelineOut={timelineOut}
              drawMode={drawMode}
              onDrawComplete={handleDrawComplete}
            physicsForces={physicsForces}
            selectedObjectId={selectedObjectId}
            selectedForceId={selectedForceId}
            onObjectSelect={setSelectedObjectId}
            onForceSelect={setSelectedForceId}
            onObjectTransform={handleObjectTransform}
            handleScale={handleScale}
            onCacheFrameCountChange={setCachedFrameCount}
            cacheResetToken={cacheResetToken}
            onUpdateSceneSettings={(updates) => setSceneSettings(prev => ({ ...prev, ...updates }))}
          />
        </main>

        {/* Debug: Show selection status */}
        {process.env.NODE_ENV === 'development' && (
          <div style={{ 
            position: 'fixed', 
            bottom: '120px', 
            right: '10px', 
            background: 'rgba(0,0,0,0.7)', 
            color: '#fff', 
            padding: '8px 12px', 
            borderRadius: '4px',
            fontSize: '11px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 1000
          }}>
            Selected: {selectedObjectId ? `${selectedObject?.type} (${selectedObjectId})` : 'None'}
          </div>
        )}

        <aside className="file-panel panel-right">
          {selectedForceId && physicsForces.find((f) => f.id === selectedForceId) ? (
            <>
              <div className="panel-header">
                <h3>Physics Force Properties</h3>
                <button
                  className="close-button"
                  onClick={() => setSelectedForceId(null)}
                  type="button"
                >
                  ✕
                </button>
              </div>
              <div className="panel-content">
                <div className="property-form">
                  {physicsForces
                    .filter((f) => f.id === selectedForceId)
                    .map((force) => (
                      <div key={force.id}>
                        <label htmlFor="force-name">
                          Name
                        </label>
                        <input
                          id="force-name"
                          type="text"
                          value={force.name}
                          onChange={(event) => handleUpdatePhysicsForce(force.id, { name: event.target.value })}
                        />

                        <label htmlFor="force-type">
                          Type
                        </label>
                        <select
                          id="force-type"
                          value={force.type}
                          onChange={(event) => handleUpdatePhysicsForce(force.id, { type: event.target.value as PhysicsForceType })}
                        >
                          <option value="gravity">Gravity</option>
                          <option value="wind">Wind</option>
                          <option value="tornado">Tornado</option>
                          <option value="drag">Drag</option>
                          <option value="damping">Damping</option>
                          <option value="attractor">Attractor</option>
                          <option value="repulsor">Repulsor</option>
                          <option value="collider">Collider</option>
                          <option value="flow-curve">Flow Along Curve</option>
                          <option value="vortex">Vortex</option>
                          <option value="turbulence">Turbulence</option>
                          <option value="thermal-updraft">Thermal Updraft</option>
                        </select>

                        <label htmlFor="force-enabled">
                          <input
                            id="force-enabled"
                            type="checkbox"
                            checked={force.enabled}
                            onChange={(event) => handleUpdatePhysicsForce(force.id, { enabled: event.target.checked })}
                            style={{ marginRight: '8px' }}
                          />
                          Enabled
                        </label>

                        <label htmlFor="force-strength">
                          Strength: {force.strength.toFixed(1)}
                        </label>
                        <input
                          id="force-strength"
                          type="range"
                          min={-100}
                          max={100}
                          step={0.5}
                          value={force.strength}
                          onChange={(event) => handleUpdatePhysicsForce(force.id, { strength: Number.parseFloat(event.target.value) })}
                        />

                        {(force.type === 'attractor' || force.type === 'repulsor' || force.type === 'tornado' || force.type === 'vortex' || force.type === 'turbulence') && (
                          <>
                            <label htmlFor="force-radius">
                              {force.type === 'turbulence' ? 'Size (Deformation Map)' : 'Radius'}: {force.radius?.toFixed(1) ?? 50}
                            </label>
                            <input
                              id="force-radius"
                              type="range"
                              min={1}
                              max={500}
                              step={1}
                              value={force.radius ?? 50}
                              onChange={(event) => handleUpdatePhysicsForce(force.id, { radius: Number.parseFloat(event.target.value) })}
                            />
                          </>
                        )}

                        {(force.type === 'wind' || force.type === 'tornado' || force.type === 'vortex' || force.type === 'turbulence') && (
                          <>
                            <label>Direction</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                              <div>
                                <label htmlFor="force-dir-x">X: {force.direction?.x.toFixed(2) ?? (force.type === 'wind' ? 0 : 0)}</label>
                                <input
                                  id="force-dir-x"
                                  type="range"
                                  min={-1}
                                  max={1}
                                  step={0.01}
                                  value={force.direction?.x ?? (force.type === 'wind' ? 0 : 0)}
                                  onChange={(event) => handleUpdatePhysicsForce(force.id, { direction: { x: Number.parseFloat(event.target.value), y: force.direction?.y ?? (force.type === 'wind' ? -1 : 0), z: force.direction?.z ?? 0 } })}
                                />
                              </div>
                              <div>
                                <label htmlFor="force-dir-y">Y: {force.direction?.y.toFixed(2) ?? (force.type === 'wind' ? -1 : 1)}</label>
                                <input
                                  id="force-dir-y"
                                  type="range"
                                  min={-1}
                                  max={1}
                                  step={0.01}
                                  value={force.direction?.y ?? (force.type === 'wind' ? -1 : 1)}
                                  onChange={(event) => handleUpdatePhysicsForce(force.id, { direction: { x: force.direction?.x ?? 0, y: Number.parseFloat(event.target.value), z: force.direction?.z ?? 0 } })}
                                />
                              </div>
                              <div>
                                <label htmlFor="force-dir-z">Z: {force.direction?.z.toFixed(2) ?? 0}</label>
                                <input
                                  id="force-dir-z"
                                  type="range"
                                  min={-1}
                                  max={1}
                                  step={0.01}
                                  value={force.direction?.z ?? 0}
                                  onChange={(event) => handleUpdatePhysicsForce(force.id, { direction: { x: force.direction?.x ?? 0, y: force.direction?.y ?? (force.type === 'wind' ? -1 : 1), z: Number.parseFloat(event.target.value) } })}
                                />
                              </div>
                            </div>
                          </>
                        )}

                        <hr className="form-divider" />
                        <label>Position</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                          <div>
                            <label htmlFor="force-pos-x">X: {force.position.x.toFixed(1)}</label>
                            <input
                              id="force-pos-x"
                              type="range"
                              min={-500}
                              max={500}
                              step={1}
                              value={force.position.x}
                              onChange={(event) => handleUpdatePhysicsForce(force.id, { position: { ...force.position, x: Number.parseFloat(event.target.value) } })}
                            />
                          </div>
                          <div>
                            <label htmlFor="force-pos-y">Y: {force.position.y.toFixed(1)}</label>
                            <input
                              id="force-pos-y"
                              type="range"
                              min={-500}
                              max={500}
                              step={1}
                              value={force.position.y}
                              onChange={(event) => handleUpdatePhysicsForce(force.id, { position: { ...force.position, y: Number.parseFloat(event.target.value) } })}
                            />
                          </div>
                          <div>
                            <label htmlFor="force-pos-z">Z: {force.position.z.toFixed(1)}</label>
                            <input
                              id="force-pos-z"
                              type="range"
                              min={-500}
                              max={500}
                              step={1}
                              value={force.position.z}
                              onChange={(event) => handleUpdatePhysicsForce(force.id, { position: { ...force.position, z: Number.parseFloat(event.target.value) } })}
                            />
                          </div>
                        </div>

                        <hr className="form-divider" />

                        {(force.type === 'attractor' || force.type === 'repulsor' || force.type === 'collider') && (
                          <>
                            <label>Target Shape</label>
                            <select
                              value={force.targetShapeId || ''}
                              onChange={(event) => {
                                const newTargetId = event.target.value || undefined;
                                handleUpdatePhysicsForce(force.id, { targetShapeId: newTargetId });
                              }}
                            >
                              <option value="">None (Keep at position)</option>
                              {sceneObjects
                                .filter((obj) => obj.type !== 'Emitter')
                                .map((shape) => (
                                  <option key={shape.id} value={shape.id}>
                                    {shape.name || shape.id}
                                  </option>
                                ))}
                            </select>
                            <p style={{ fontSize: '0.85rem', color: '#8a93a2', marginTop: '0.5rem' }}>
                              {force.type === 'collider'
                                ? (force.targetShapeId ? 'Particles will bounce off the selected shape' : 'Particles will bounce at its position')
                                : (force.targetShapeId ? 'Force will move towards/away from the selected shape' : 'Force stays at its current position')}
                            </p>

                            {force.type === 'collider' && (
                              <>
                                <label htmlFor="collider-bounce">
                                  Bounce Strength: {force.strength.toFixed(2)}
                                </label>
                                <input
                                  id="collider-bounce"
                                  type="range"
                                  min={0}
                                  max={2}
                                  step={0.1}
                                  value={force.strength}
                                  onChange={(event) => handleUpdatePhysicsForce(force.id, { strength: Number.parseFloat(event.target.value) })}
                                />
                                <p style={{ fontSize: '0.8rem', color: '#8a93a2' }}>
                                  0 = stick to surface, 1 = perfect bounce, 2 = super bounce
                                </p>
                              </>
                            )}

                            <hr className="form-divider" />
                          </>
                        )}

                        <label>Affected Emitters</label>
                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #3b455c', borderRadius: '4px', padding: '8px' }}>
                          {sceneObjects
                            .filter((obj) => obj.type === 'Emitter')
                            .map((emitter) => (
                              <label key={emitter.id} style={{ display: 'block', marginBottom: '4px', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={force.affectedEmitterIds.includes(emitter.id)}
                                  onChange={(event) => {
                                    const newIds = event.target.checked
                                      ? [...force.affectedEmitterIds, emitter.id]
                                      : force.affectedEmitterIds.filter((id) => id !== emitter.id);
                                    handleUpdatePhysicsForce(force.id, { affectedEmitterIds: newIds });
                                  }}
                                  style={{ marginRight: '8px' }}
                                />
                                {emitter.name || emitter.id}
                              </label>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </>
          ) : selectedObject ? (
            <>
            <div className="panel-header">
              <h3
                onDoubleClick={() => startRenameObject(selectedObject)}
                title="Double-click to rename"
              >
                {renamingObjectId === selectedObject.id ? (
                  <input
                    className="header-rename-input"
                    autoFocus
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(normalizeObjectName(event.target.value))}
                    onBlur={() => commitRenameObject(selectedObject.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitRenameObject(selectedObject.id);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelRenameObject();
                      }
                    }}
                  />
                ) : (
                  <span
                    className="header-object-name"
                    onDoubleClick={() => startRenameObject(selectedObject)}
                    title="Double-click to rename"
                  >
                    {getObjectDisplayName(selectedObject)}
                  </span>
                )}{' '}
                <span>{selectedObject.type} Properties</span>
              </h3>
              <button
                className="rename-icon-btn"
                onClick={() => startRenameObject(selectedObject)}
                type="button"
                title="Rename"
                aria-label="Rename selected object"
              >
                ✎
              </button>
              <button
                className="close-button"
                onClick={() => setSelectedObjectId(null)}
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="panel-content">
              <div className="property-form">
                {selectedObject.type === 'Emitter' && selectedEmitterProperties && (
                  <>
                    <button
                      type="button"
                      className="collapsible-section"
                      onClick={() => setShowEmitterProperties((prev) => !prev)}
                    >
                      <span>Emitter Properties</span>
                      <span>{showEmitterProperties ? '▾' : '▸'}</span>
                    </button>

                    {showEmitterProperties && (
                      <div className="subpanel-content">
                        <button
                          type="button"
                          className="apply-button"
                          onClick={() => {
                            if (!selectedObject || selectedObject.type !== 'Emitter') return;
                            const newShape = createEmitterShapeNode(selectedObject.id, selectedObject);
                            setSceneObjects((prev) => [...prev, newShape]);
                            setSelectedObjectId(newShape.id);
                          }}
                        >
                          Add Shape Node
                        </button>

                        <label htmlFor="emission-rate">
                          Emission Rate: {selectedEmitterProperties.emissionRate} particles/sec
                        </label>
                        <input
                          id="emission-rate"
                          max={500}
                          min={1}
                          onChange={(event) => handleUpdateEmitterProperty('emissionRate', Number.parseFloat(event.target.value))}
                          step={1}
                          type="range"
                          value={selectedEmitterProperties.emissionRate}
                        />

                        <hr style={{ margin: '0.8rem 0', borderColor: '#3b455c' }} />

                        <div className={`transform-slots ${selectedObject.type === 'Emitter' ? 'compact-emitter' : ''}`}>

                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Parent Emitter Section for non-Emitter objects */}
                {selectedObject.type !== 'Emitter' && (
                  <>
                    <button
                      type="button"
                      className="collapsible-section"
                      onClick={() => setShowParentEmitter((prev) => !prev)}
                    >
                      <span>Emission Source</span>
                      <span>{showParentEmitter ? '▾' : '▸'}</span>
                    </button>

                    {showParentEmitter && (
                      <div className="subpanel-content">
                        <label htmlFor="parent-emitter">
                          Connect to Emitter
                        </label>
                        <select
                          id="parent-emitter"
                          value={selectedObject.parentId || ''}
                          onChange={(event) => {
                            const newParentId = event.target.value || null;
                            if (selectedObjectId) {
                              handleReparentObject(selectedObjectId, newParentId);
                            }
                          }}
                        >
                          <option value="">None (Standalone Shape)</option>
                          {sceneObjects
                            .filter((obj) => obj.type === 'Emitter')
                            .map((emitter) => (
                              <option key={emitter.id} value={emitter.id}>
                                {emitter.name || emitter.id}
                              </option>
                            ))}
                        </select>
                        <p style={{ fontSize: '0.8rem', color: '#8a93a2', marginTop: '0.5rem' }}>
                          {selectedObject.parentId 
                            ? 'This shape is connected to an emitter and will be used as an emission source.' 
                            : 'Select an emitter to use this shape as an emission source.'}
                        </p>
                      </div>
                    )}

                    <hr style={{ margin: '0.8rem 0', borderColor: '#3b455c' }} />
                  </>
                )}

                {/* Position Transform Section */}
                <button
                  type="button"
                  className="collapsible-section"
                  onClick={() => setShowTransformPosition((prev) => !prev)}
                >
                  <span>Transform: Position</span>
                  <span>{showTransformPosition ? '▾' : '▸'}</span>
                </button>

                {showTransformPosition && (
                  <div className="subpanel-content">
                    <label htmlFor="position-x">Position X: {selectedObject.position.x.toFixed(1)}</label>
                            <input
                              id="position-x"
                              type="number"
                              step={1}
                              value={selectedObject.position.x}
                              onChange={(event) => handleUpdateSelectedObjectTransform('position', 'x', Number.parseFloat(event.target.value))}
                            />
                            <input
                              id="position-x-slider"
                              type="range"
                              min={-sceneSize.x}
                              max={sceneSize.x}
                              step={1}
                              value={selectedObject.position.x}
                              onChange={(event) => handleUpdateSelectedObjectTransform('position', 'x', Number.parseFloat(event.target.value))}
                            />

                            <label htmlFor="position-y">Position Y: {selectedObject.position.y.toFixed(1)}</label>
                            <input
                              id="position-y"
                              type="number"
                              step={1}
                              value={selectedObject.position.y}
                              onChange={(event) => handleUpdateSelectedObjectTransform('position', 'y', Number.parseFloat(event.target.value))}
                            />
                            <input
                              id="position-y-slider"
                              type="range"
                              min={-sceneSize.y}
                              max={sceneSize.y}
                              step={1}
                              value={selectedObject.position.y}
                              onChange={(event) => handleUpdateSelectedObjectTransform('position', 'y', Number.parseFloat(event.target.value))}
                            />

                            <label htmlFor="position-z">Position Z: {selectedObject.position.z.toFixed(1)}</label>
                            <input
                              id="position-z"
                              type="number"
                              step={1}
                              value={selectedObject.position.z}
                              onChange={(event) => handleUpdateSelectedObjectTransform('position', 'z', Number.parseFloat(event.target.value))}
                            />
                            <input
                              id="position-z-slider"
                              type="range"
                              min={-sceneSize.z}
                              max={sceneSize.z}
                              step={1}
                              value={selectedObject.position.z}
                              onChange={(event) => handleUpdateSelectedObjectTransform('position', 'z', Number.parseFloat(event.target.value))}
                            />
                  </div>
                )}

                {/* Rotation Transform Section */}
                <button
                  type="button"
                  className="collapsible-section"
                  onClick={() => setShowTransformRotation((prev) => !prev)}
                >
                  <span>Transform: Rotation</span>
                  <span>{showTransformRotation ? '▾' : '▸'}</span>
                </button>

                {showTransformRotation && (
                  <div className="subpanel-content">
                    <label htmlFor="rotation-x">Rotation X (rad): {selectedObject.rotation.x.toFixed(2)}</label>
                            <input
                              id="rotation-x"
                              type="number"
                              step={0.01}
                              value={selectedObject.rotation.x}
                              onChange={(event) => handleUpdateSelectedObjectTransform('rotation', 'x', Number.parseFloat(event.target.value))}
                            />
                            <input
                              id="rotation-x-slider"
                              type="range"
                              min={-6.28}
                              max={6.28}
                              step={0.01}
                              value={selectedObject.rotation.x}
                              onChange={(event) => handleUpdateSelectedObjectTransform('rotation', 'x', Number.parseFloat(event.target.value))}
                            />

                            <label htmlFor="rotation-y">Rotation Y (rad): {selectedObject.rotation.y.toFixed(2)}</label>
                            <input
                              id="rotation-y"
                              type="number"
                              step={0.01}
                              value={selectedObject.rotation.y}
                              onChange={(event) => handleUpdateSelectedObjectTransform('rotation', 'y', Number.parseFloat(event.target.value))}
                            />
                            <input
                              id="rotation-y-slider"
                              type="range"
                              min={-6.28}
                              max={6.28}
                              step={0.01}
                              value={selectedObject.rotation.y}
                              onChange={(event) => handleUpdateSelectedObjectTransform('rotation', 'y', Number.parseFloat(event.target.value))}
                            />

                            <label htmlFor="rotation-z">Rotation Z (rad): {selectedObject.rotation.z.toFixed(2)}</label>
                            <input
                              id="rotation-z"
                              type="number"
                              step={0.01}
                              value={selectedObject.rotation.z}
                              onChange={(event) => handleUpdateSelectedObjectTransform('rotation', 'z', Number.parseFloat(event.target.value))}
                            />
                            <input
                              id="rotation-z-slider"
                              type="range"
                              min={-6.28}
                              max={6.28}
                              step={0.01}
                              value={selectedObject.rotation.z}
                              onChange={(event) => handleUpdateSelectedObjectTransform('rotation', 'z', Number.parseFloat(event.target.value))}
                            />
                  </div>
                )}

                {/* Scale Transform Section */}
                <button
                  type="button"
                  className="collapsible-section"
                  onClick={() => setShowTransformScale((prev) => !prev)}
                >
                  <span>Transform: Scale</span>
                  <span>{showTransformScale ? '▾' : '▸'}</span>
                </button>

                {showTransformScale && (
                  <div className="subpanel-content">
                    <label htmlFor="scale-x">Scale X: {selectedObject.scale.x.toFixed(2)}</label>
                            <input
                              id="scale-x"
                              type="number"
                              min={0.05}
                              max={10}
                              step={0.05}
                              value={selectedObject.scale.x}
                              onChange={(event) => handleUpdateSelectedObjectTransform('scale', 'x', Math.max(0.05, Number.parseFloat(event.target.value)))}
                            />
                            <input
                              id="scale-x-slider"
                              type="range"
                              min={0.05}
                              max={10}
                              step={0.05}
                              value={selectedObject.scale.x}
                              onChange={(event) => handleUpdateSelectedObjectTransform('scale', 'x', Math.max(0.05, Number.parseFloat(event.target.value)))}
                            />

                            <label htmlFor="scale-y">Scale Y: {selectedObject.scale.y.toFixed(2)}</label>
                            <input
                              id="scale-y"
                              type="number"
                              min={0.05}
                              max={10}
                              step={0.05}
                              value={selectedObject.scale.y}
                              onChange={(event) => handleUpdateSelectedObjectTransform('scale', 'y', Math.max(0.05, Number.parseFloat(event.target.value)))}
                            />
                            <input
                              id="scale-y-slider"
                              type="range"
                              min={0.05}
                              max={10}
                              step={0.05}
                              value={selectedObject.scale.y}
                              onChange={(event) => handleUpdateSelectedObjectTransform('scale', 'y', Math.max(0.05, Number.parseFloat(event.target.value)))}
                            />

                            <label htmlFor="scale-z">Scale Z: {selectedObject.scale.z.toFixed(2)}</label>
                            <input
                              id="scale-z"
                              type="number"
                              min={0.05}
                              max={10}
                              step={0.05}
                              value={selectedObject.scale.z}
                              onChange={(event) => handleUpdateSelectedObjectTransform('scale', 'z', Math.max(0.05, Number.parseFloat(event.target.value)))}
                            />
                            <input
                              id="scale-z-slider"
                              type="range"
                              min={0.05}
                              max={10}
                              step={0.05}
                              value={selectedObject.scale.z}
                              onChange={(event) => handleUpdateSelectedObjectTransform('scale', 'z', Math.max(0.05, Number.parseFloat(event.target.value)))}
                            />
                  </div>
                )}

                <hr style={{ margin: '0.8rem 0', borderColor: '#3b455c' }} />

                {selectedActsAsEmitterSource && selectedEmitterShapeProperties && (
                  <>
                    <button
                      type="button"
                      className="collapsible-section"
                      onClick={() => setShowEmitterProperties((prev) => !prev)}
                    >
                      <span>Shape Source</span>
                      <span>{showEmitterProperties ? '▾' : '▸'}</span>
                    </button>

                    {showEmitterProperties && (
                      <div className="subpanel-content">
                        <label htmlFor="shape-emitter-type">Shape Type</label>
                        <select
                          id="shape-emitter-type"
                          value={selectedEmitterShapeProperties.emitterType}
                          onChange={(event) => {
                            const nextType = event.target.value as EmitterShapeProperties['emitterType'];
                            const nextMode = normalizeEmissionModeForShape(nextType, selectedEmitterShapeProperties.emissionMode);
                            handleUpdateEmitterShapeProperty('emitterType', nextType);
                            handleUpdateEmitterShapeProperty('emissionMode', nextMode);
                          }}
                        >
                          <option value="point">Point</option>
                          <option value="circle">Circle</option>
                          <option value="square">Square</option>
                          <option value="cube">Cube</option>
                          <option value="ball">Ball</option>
                          <option value="curve">Curve</option>
                          <option value="layer">Layer</option>
                        </select>

                        <label htmlFor="shape-emission-mode">Emission Mode</label>
                        <select
                          id="shape-emission-mode"
                          value={normalizeEmissionModeForShape(selectedEmitterShapeProperties.emitterType, selectedEmitterShapeProperties.emissionMode)}
                          onChange={(event) => handleUpdateEmitterShapeProperty('emissionMode', event.target.value)}
                        >
                          {getEmissionModeOptions(selectedEmitterShapeProperties.emitterType).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>

                        {selectedEmitterShapeProperties.emitterType === 'layer' && (
                          <>
                            <label htmlFor="shape-layer-image">Layer Image</label>
                            <input
                              id="shape-layer-image"
                              type="file"
                              accept="image/*"
                              onChange={(event) => handleEmitterShapeLayerImageUpload(event.target.files?.[0] ?? null)}
                            />
                            {selectedEmitterShapeProperties.layerImageDataUrl && (
                              <button
                                type="button"
                                className="apply-button"
                                onClick={() => handleUpdateEmitterShapeProperty('layerImageDataUrl', '')}
                              >
                                Clear Layer Image
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}

                {selectedObject.type === 'Emitter' && selectedEmitterProperties && (
                  <>
                    <button
                      type="button"
                      className="collapsible-section"
                      onClick={() => setShowParticleProperties((prev) => !prev)}
                    >
                      <span>Particle Properties</span>
                      <span>{showParticleProperties ? '▾' : '▸'}</span>
                    </button>

                    {showParticleProperties && (
                      <div className="subpanel-content">
                        <label htmlFor="particle-type">
                          Particle Type
                        </label>
                        <select
                          id="particle-type"
                          value={selectedEmitterProperties.particleType}
                          onChange={(event) => handleUpdateEmitterProperty('particleType', event.target.value)}
                        >
                          <option value="dots">Dots</option>
                          <option value="stars">Stars</option>
                          <option value="circles">Circles</option>
                          <option value="glow-circles">Glow Circles</option>
                          <option value="sprites">Sprites</option>
                          <option value="3d-model">Live 3D Model</option>
                        </select>

                                                <label htmlFor="particle-blend-mode">
                          Particle Blend Mode
                        </label>
                        <select
                          id="particle-blend-mode"
                          value={selectedEmitterProperties.particleBlendMode || 'normal'}
                          onChange={(event) => handleUpdateEmitterProperty('particleBlendMode', event.target.value)}
                        >
                          <option value="normal">Normal (Alpha Blend)</option>
                          <option value="lighter">Additive (Lighter)</option>
                          <option value="screen">Screen</option>
                        </select>

                        <label htmlFor="particle-stretch">
                          <input
                            id="particle-stretch"
                            type="checkbox"
                            checked={selectedEmitterProperties.particleStretch || false}
                            onChange={(event) => handleUpdateEmitterProperty('particleStretch', event.target.checked)}
                            style={{ marginRight: '8px' }}
                          />
                          Velocity Stretch
                        </label>

                        {selectedEmitterProperties.particleStretch && (
                          <>
                            <label htmlFor="particle-stretch-amount">
                              Stretch Amount: {selectedEmitterProperties.particleStretchAmount ?? 0.05}
                            </label>
                            <input
                              id="particle-stretch-amount"
                              type="range"
                              min="0.01"
                              max="0.2"
                              step="0.01"
                              value={selectedEmitterProperties.particleStretchAmount ?? 0.05}
                              onChange={(event) => handleUpdateEmitterProperty('particleStretchAmount', Number.parseFloat(event.target.value))}
                            />
                          </>
                        )}

                        <label htmlFor="particle-glow">
                          <input
                            id="particle-glow"
                            type="checkbox"
                            checked={selectedEmitterProperties.particleGlow}
                            onChange={(event) => handleUpdateEmitterProperty('particleGlow', event.target.checked)}
                            style={{ marginRight: '8px' }}
                          />
                          Enable Glow
                        </label>

                        {selectedEmitterProperties.particleType === 'sprites' && (
                          <>
                            <label htmlFor="particle-sprite-image">Sprite PNG</label>
                            <input
                              id="particle-sprite-image"
                              type="file"
                              accept=".png,image/png"
                              onChange={(event) => handleParticleSpriteImageUpload(event.target.files?.[0] ?? null)}
                            />

                            <label htmlFor="particle-sprite-sequence">Sprite PNG Sequence</label>
                            <input
                              id="particle-sprite-sequence"
                              type="file"
                              accept=".png,image/png"
                              multiple
                              onChange={(event) => handleParticleSpriteSequenceUpload(event.target.files)}
                            />

                            {selectedEmitterProperties.particleSpriteSequenceDataUrls.length > 0 && (
                              <>
                                <label>
                                  Sprite: {selectedEmitterProperties.particleSpriteSequenceFirstName || 'sequence.png'} (sequence used)
                                </label>
                                
                                <label style={{marginTop: '10px'}}>
                                  Sequence Mode
                                </label>
                                <select
                                  value={selectedEmitterProperties.particleSpriteSequenceMode ?? 'loop'}
                                  onChange={(e) => handleUpdateEmitterProperty('particleSpriteSequenceMode', e.target.value)}
                                  className="property-input"
                                >
                                  <option value="loop">Loop</option>
                                  <option value="match-life">Match Life</option>
                                  <option value="random-static">Random Frame (Static)</option>
                                </select>
<label htmlFor="particle-sprite-sequence-fps">
                                  Sequence FPS: {selectedEmitterProperties.particleSpriteSequenceFps ?? 12}
                                </label>
                                <input
                                  id="particle-sprite-sequence-fps"
                                  type="range"
                                  min="1"
                                  max="60"
                                  step="1"
                                  value={selectedEmitterProperties.particleSpriteSequenceFps ?? 12}
                                  onChange={(e) => handleUpdateEmitterProperty('particleSpriteSequenceFps', Number(e.target.value))}
                                />
                              </>
                            )}

                            {selectedEmitterProperties.particleSpriteSequenceDataUrls.length === 0 && selectedEmitterProperties.particleSpriteImageName && (
                              <label>
                                Sprite: {selectedEmitterProperties.particleSpriteImageName}
                              </label>
                            )}

                            {(selectedEmitterProperties.particleSpriteSequenceDataUrls.length > 0 || selectedEmitterProperties.particleSpriteImageDataUrl) && (
                              <button
                                type="button"
                                className="apply-button"
                                onClick={() => {
                                  handleUpdateEmitterProperty('particleSpriteImageDataUrl', '');
                                  handleUpdateEmitterProperty('particleSpriteImageName', '');
                                  handleUpdateEmitterProperty('particleSpriteSequenceDataUrls', []);
                                  handleUpdateEmitterProperty('particleSpriteSequenceFirstName', '');
                                }}
                              >
                                Clear Sprite Asset
                              </button>
                            )}
                          </>
                        )}

                        {selectedEmitterProperties.particleType === '3d-model' && (
                          <div className="live-3d-model-container" style={{ border: '1px solid #333', padding: '8px', marginTop: '12px', marginBottom: '12px', borderRadius: '4px', backgroundColor: '#1e1e1e' }}>
                            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#eeb868' }}>Live 3D Model Settings</h4>
                            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                              <Animator3D
                                embeddedUI={true}
                                autoRenderOnChange={true}
                                onExportToParticleSystem={(dataUrls: string[], fps?: number) => {
                                  // Update sprite sequence for emission
                                  handleUpdateEmitterProperty('particleSpriteSequenceDataUrls', dataUrls);
                                  handleUpdateEmitterProperty('particleSpriteSequenceFirstName', 'live-3d.png');
                                  handleUpdateEmitterProperty('particleSpriteSequenceFps', fps ?? 24);
                                }}
                              />
                            </div>
                          </div>
                        )}


                        <label htmlFor="particle-speed">
                          Speed: {selectedEmitterProperties.particleSpeed.toFixed(0)} units/sec
                        </label>
                        <input
                          id="particle-speed"
                          max={200}
                          min={5}
                          onChange={(event) => handleUpdateEmitterProperty('particleSpeed', Number.parseFloat(event.target.value))}
                          step={1}
                          type="range"
                          value={selectedEmitterProperties.particleSpeed}
                        />

                        <label htmlFor="particle-speed-variation">
                            Speed Variation: {(selectedEmitterProperties.particleSpeedVariation * 100).toFixed(0)}%
                          </label>
                          <input
                            id="particle-speed-variation"
                            max={1}
                            min={0}
                            onChange={(event) => handleUpdateEmitterProperty('particleSpeedVariation', Number.parseFloat(event.target.value))}
                            step={0.05}
                            type="range"
                            value={selectedEmitterProperties.particleSpeedVariation}
                          />

                          <label htmlFor="particle-spread-angle">
                            Spread Angle: {selectedEmitterProperties.particleSpreadAngle ?? 36}°
                          </label>
                          <input
                            id="particle-spread-angle"
                            max={180}
                            min={0}
                            onChange={(event) => handleUpdateEmitterProperty('particleSpreadAngle', Number.parseFloat(event.target.value))}
                            step={1}
                            type="range"
                            value={selectedEmitterProperties.particleSpreadAngle ?? 36}
                          />

                        <label htmlFor="particle-lifetime">
                          Lifetime: {selectedEmitterProperties.particleLifetime.toFixed(1)} sec
                        </label>
                        <input
                          id="particle-lifetime"
                          max={10}
                          min={0.1}
                          onChange={(event) => handleUpdateEmitterProperty('particleLifetime', Number.parseFloat(event.target.value))}
                          step={0.1}
                          type="range"
                          value={selectedEmitterProperties.particleLifetime}
                        />

                        <label htmlFor="particle-lifetime-variation">
                          Lifetime Variation: {(selectedEmitterProperties.particleLifetimeVariation * 100).toFixed(0)}%
                        </label>
                        <input
                          id="particle-lifetime-variation"
                          max={1}
                          min={0}
                          onChange={(event) => handleUpdateEmitterProperty('particleLifetimeVariation', Number.parseFloat(event.target.value))}
                          step={0.05}
                          type="range"
                          value={selectedEmitterProperties.particleLifetimeVariation}
                        />

                        <label htmlFor="particle-size">
                          Size: {selectedEmitterProperties.particleSize.toFixed(2)}
                        </label>
                        <input
                          id="particle-size"
                          max={500}
                          min={0.1}
                          onChange={(event) => handleUpdateEmitterProperty('particleSize', Number.parseFloat(event.target.value))}
                          step={0.5}
                          type="range"
                          value={selectedEmitterProperties.particleSize}
                        />

                        <label htmlFor="particle-size-variation">
                          Size Variation: {(selectedEmitterProperties.particleSizeVariation * 100).toFixed(0)}%
                        </label>
                        <input
                          id="particle-size-variation"
                          max={1}
                          min={0}
                          onChange={(event) => handleUpdateEmitterProperty('particleSizeVariation', Number.parseFloat(event.target.value))}
                          step={0.05}
                          type="range"
                          value={selectedEmitterProperties.particleSizeVariation}
                        />

                        <label htmlFor="particle-color">
                          Color
                        </label>
                        <input
                          id="particle-color"
                          type="color"
                          onChange={(event) => handleUpdateEmitterProperty('particleColor', event.target.value)}
                          value={selectedEmitterProperties.particleColor}
                        />

                        <label htmlFor="particle-color-variation">
                          Color Variation: {(selectedEmitterProperties.particleColorVariation * 100).toFixed(0)}%
                        </label>
                        <input
                          id="particle-color-variation"
                          max={1}
                          min={0}
                          onChange={(event) => handleUpdateEmitterProperty('particleColorVariation', Number.parseFloat(event.target.value))}
                          step={0.05}
                          type="range"
                          value={selectedEmitterProperties.particleColorVariation}
                        />

                        <label htmlFor="particle-opacity">
                          Opacity: {(selectedEmitterProperties.particleOpacity * 100).toFixed(0)}%
                        </label>
                        <input
                          id="particle-opacity"
                          max={1}
                          min={0}
                          onChange={(event) => handleUpdateEmitterProperty('particleOpacity', Number.parseFloat(event.target.value))}
                          step={0.05}
                          type="range"
                          value={selectedEmitterProperties.particleOpacity}
                        />

                        <label htmlFor="particle-rotation">
                          Rotation: {selectedEmitterProperties.particleRotation.toFixed(2)} rad
                        </label>
                        <input
                          id="particle-rotation"
                          max={6.28}
                          min={-6.28}
                          onChange={(event) => handleUpdateEmitterProperty('particleRotation', Number.parseFloat(event.target.value))}
                          step={0.01}
                          type="range"
                          value={selectedEmitterProperties.particleRotation}
                        />

                        <label htmlFor="particle-rotation-variation">
                          Rotation Variation: {selectedEmitterProperties.particleRotationVariation.toFixed(2)} rad
                        </label>
                        <input
                          id="particle-rotation-variation"
                          max={3.14}
                          min={0}
                          onChange={(event) => handleUpdateEmitterProperty('particleRotationVariation', Number.parseFloat(event.target.value))}
                          step={0.01}
                          type="range"
                          value={selectedEmitterProperties.particleRotationVariation}
                        />

                        <label htmlFor="particle-rotation-speed">
                          Rotation Speed: {selectedEmitterProperties.particleRotationSpeed.toFixed(2)} rad/sec
                        </label>
                        <input
                          id="particle-rotation-speed"
                          max={10}
                          min={-10}
                          onChange={(event) => handleUpdateEmitterProperty('particleRotationSpeed', Number.parseFloat(event.target.value))}
                          step={0.1}
                          type="range"
                          value={selectedEmitterProperties.particleRotationSpeed}
                        />

                        <label htmlFor="particle-rotation-speed-variation">
                          Rotation Speed Variation: {(selectedEmitterProperties.particleRotationSpeedVariation * 100).toFixed(0)}%
                        </label>
                        <input
                          id="particle-rotation-speed-variation"
                          max={1}
                          min={0}
                          onChange={(event) => handleUpdateEmitterProperty('particleRotationSpeedVariation', Number.parseFloat(event.target.value))}
                          step={0.05}
                          type="range"
                          value={selectedEmitterProperties.particleRotationSpeedVariation}
                        />

                        <label htmlFor="particle-horizontal-flip-chance">
                          Horizontal Flip Chance: {(selectedEmitterProperties.particleHorizontalFlipChance ?? 0) * 100}%
                        </label>
                        <input
                          id="particle-horizontal-flip-chance"
                          max={1}
                          min={0}
                          onChange={(event) => handleUpdateEmitterProperty('particleHorizontalFlipChance', Number.parseFloat(event.target.value))}
                          step={0.05}
                          type="range"
                          value={selectedEmitterProperties.particleHorizontalFlipChance ?? 0}
                        />

                        <label htmlFor="particle-pivot-x">Pivot X (0-1): {selectedEmitterProperties.particlePivotX ?? 0.5}</label>
<input id="particle-pivot-x" max={1} min={0} onChange={(event) => handleUpdateEmitterProperty('particlePivotX', Number.parseFloat(event.target.value))} step={0.05} type="range" value={selectedEmitterProperties.particlePivotX ?? 0.5} />
<label htmlFor="particle-pivot-y">Pivot Y (0-1): {selectedEmitterProperties.particlePivotY ?? 0.5}</label>
<input id="particle-pivot-y" max={1} min={0} onChange={(event) => handleUpdateEmitterProperty('particlePivotY', Number.parseFloat(event.target.value))} step={0.05} type="range" value={selectedEmitterProperties.particlePivotY ?? 0.5} />
<hr style={{ margin: '0.5rem 0', borderColor: '#3b455c' }} />

                        <label htmlFor="particle-opacity-over-life">
                          <input
                              id="particle-opacity-over-life"
                              type="checkbox"
                              checked={selectedEmitterProperties.particleOpacityOverLife}
                              onChange={(event) => {
                                handleUpdateEmitterProperty('particleOpacityOverLife', event.target.checked);
                                if (event.target.checked) handleUpdateEmitterProperty('particleOpacityOverLifeCurve', '');
                              }}
                              style={{ marginRight: '8px' }}
                            />
                            Fade to Transparent
                          </label>
                          <label htmlFor="particle-opacity-use-curve" style={{ marginTop: '0.5rem' }}>
                            <input
                              id="particle-opacity-use-curve"
                              type="checkbox"
                              checked={selectedEmitterProperties.particleOpacityOverLifeCurve !== undefined && selectedEmitterProperties.particleOpacityOverLifeCurve !== ''}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  handleUpdateEmitterProperty('particleOpacityOverLifeCurve', '[{"x":0,"y":1},{"x":1,"y":0}]');
                                  handleUpdateEmitterProperty('particleOpacityOverLife', false);
                                } else {
                                  handleUpdateEmitterProperty('particleOpacityOverLifeCurve', '');
                                }
                              }}
                              style={{ marginRight: '8px' }}
                            />
                            Use Opacity Curve
                        </label>

                        {(selectedEmitterProperties.particleOpacityOverLifeCurve !== undefined && selectedEmitterProperties.particleOpacityOverLifeCurve !== '') && (
                            <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                              <label style={{ display: 'block', marginBottom: '5px', color: '#8a93a2', fontSize: '0.8rem' }}>Opacity Curve Target</label>
                              <CurveEditor 
                                value={selectedEmitterProperties.particleOpacityOverLifeCurve || '[{"x":0,"y":1},{"x":1,"y":0}]'}
                                onChange={(val) => handleUpdateEmitterProperty('particleOpacityOverLifeCurve', val)}
                              />
                            </div>
                          )}
                          <label htmlFor="particle-color-over-life">
                          <input
                            id="particle-color-over-life"
                            type="checkbox"
                            checked={selectedEmitterProperties.particleColorOverLife}
                            onChange={(event) => handleUpdateEmitterProperty('particleColorOverLife', event.target.checked)}
                            style={{ marginRight: '8px' }}
                          />
                          Fade to Color
                        </label>

                        {selectedEmitterProperties.particleColorOverLife && (
                          <>
                            <label htmlFor="particle-color-over-life-target">
                              Target Color
                            </label>
                            <input
                              id="particle-color-over-life-target"
                              type="color"
                              onChange={(event) => handleUpdateEmitterProperty('particleColorOverLifeTarget', event.target.value)}
                              value={selectedEmitterProperties.particleColorOverLifeTarget}
                            />
                          </>
                        )}

                        <label htmlFor="particle-size-over-life">
                          Size Over Life
                        </label>
                        <select
                            id="particle-size-over-life"
                            value={selectedEmitterProperties.particleSizeOverLife}
                            onChange={(event) => handleUpdateEmitterProperty('particleSizeOverLife', event.target.value)}
                          >
                            <option value="none">None</option>
                            <option value="shrink">Shrink</option>
                            <option value="grow">Grow</option>
                            <option value="curve">Curve</option>
                          </select>
                          
                          {selectedEmitterProperties.particleSizeOverLife === 'curve' && (
                            <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                              <label style={{ display: 'block', marginBottom: '5px', color: '#8a93a2', fontSize: '0.8rem' }}>Size Curve Multiplier</label>
                              <CurveEditor 
                                value={selectedEmitterProperties.particleSizeOverLifeCurve || '[{"x":0,"y":1},{"x":1,"y":0}]'}
                                onChange={(val) => handleUpdateEmitterProperty('particleSizeOverLifeCurve', val)}
                              />
                            </div>
                          )}

                          <label htmlFor="particle-seed">
                            Random Seed: {selectedEmitterProperties.particleSeed ?? 0}
                          </label>
                          <input
                            id="particle-seed"
                            type="range"
                            min="0"
                            max="1000000"
                            step="1"
                            value={selectedEmitterProperties.particleSeed ?? 0}
                            onChange={(event) => handleUpdateEmitterProperty('particleSeed', Number(event.target.value))}
                          />

                        <hr className="form-divider" />

                        <label htmlFor="show-path-curves">
                          <input
                            id="show-path-curves"
                            type="checkbox"
                            checked={selectedEmitterProperties.showPathCurves ?? false}
                            onChange={(event) => handleUpdateEmitterProperty('showPathCurves', event.target.checked)}
                            style={{ marginRight: '8px' }}
                          />
                          Show Particle Paths for Spine Export
                        </label>
                        
                        {(selectedEmitterProperties.showPathCurves) && (
                          <>
                            <label htmlFor="path-curve-keys">
                              Spine Keyframe Count: {selectedEmitterProperties.pathCurveKeyCount ?? 5}
                            </label>
                            <input
                              id="path-curve-keys"
                              type="range"
                              min={3}
                              max={20}
                              step={1}
                              value={selectedEmitterProperties.pathCurveKeyCount ?? 5}
                              onChange={(event) => handleUpdateEmitterProperty('pathCurveKeyCount', Number.parseInt(event.target.value))}
                            />
                            <p style={{ fontSize: '0.8rem', color: '#8a93a2', marginTop: '0.5rem' }}>
                              Orange dots = keyframe control points (exact Spine export). Cyan line = path connection. More keyframes = smoother animation.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
                <hr className="form-divider" />

                <label htmlFor="handle-scale">Handle Size: {handleScale.toFixed(1)}x</label>
                <input
                  id="handle-scale"
                  max={3}
                  min={0.2}
                  step={0.1}
                  type="range"
                  value={handleScale}
                  onChange={(event) => setHandleScale(Number.parseFloat(event.target.value))}
                />

              
              </div>
            </div>
            </>
          ) : (
            <>
              <div className="panel-header">
                <h3>Properties</h3>
              </div>
              <div className="panel-content">
                <div className="property-form">
                  <div className="hierarchy-empty">Select an object or force in the hierarchy to edit properties.</div>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Timeline */}
      <div className="timeline-container">
        <div className="timeline-controls">
          <button 
            className="timeline-btn" 
            onClick={handlePlayReverse}
            title="Play Reverse"
            type="button"
          >
            ◄◄
          </button>
          <button
            className="timeline-btn"
            onClick={handleFastRewind}
            title="Fast Rewind"
            type="button"
          >
            ⏮
          </button>
          <button 
            className="timeline-btn" 
            onClick={handlePlayToggle}
            title={isPlaying ? "Pause" : "Play"}
            type="button"
          >
            {isPlaying ? '❚❚' : '►'}
          </button>
          <button 
            className="timeline-btn" 
            onClick={handleStop}
            title="Stop"
            type="button"
          >
            ■
          </button>
          <button 
            className={`timeline-btn ${isLooping ? 'active' : ''}`}
            onClick={handleLoopToggle}
            title="Loop"
            type="button"
          >
            ⟳
          </button>
          <button 
            className={`timeline-btn ${isCaching ? 'active' : ''}`}
            onClick={handleCacheToggle}
            title="Cache Simulation"
            type="button"
          >
            💾
          </button>
          <button
            className={`timeline-btn timeline-autokey-btn ${autoKeyEnabled ? 'active' : ''}`}
            onClick={() => setAutoKeyEnabled((prev) => !prev)}
            title="Auto Key"
            aria-label="Auto Key"
            type="button"
          >
            🔑
          </button>
          <label className="timeline-input-group" htmlFor="timeline-in">
            In
            <input
              id="timeline-in"
              type="number"
              min={0}
              value={timelineIn}
              onChange={(e) => handleTimelineInChange(Number.parseInt(e.target.value, 10))}
            />
          </label>
          <label className="timeline-input-group" htmlFor="timeline-out">
            Out
            <input
              id="timeline-out"
              type="number"
              min={0}
              value={timelineOut}
              onChange={(e) => handleTimelineOutChange(Number.parseInt(e.target.value, 10))}
            />
          </label>
          <label className="timeline-input-group" htmlFor="timeline-current">
            Frame
            <input
              id="timeline-current"
              type="number"
              min={timelineIn}
              max={timelineOut}
              value={currentFrame}
              onChange={(e) => handleSetCurrentFrame(Number.parseInt(e.target.value, 10))}
            />
          </label>
          <span className="timeline-frame-display">
            Range: {timelineIn} - {timelineOut}
          </span>
        </div>
        <div className="timeline-cache-bar" title={`Cached ${cachedFrameCount} frame${cachedFrameCount === 1 ? '' : 's'}`}>
          <div className="timeline-cache-fill" style={{ width: `${cachedRatio * 100}%` }} />
        </div>
        <div
          className="timeline-track"
          ref={timelineTrackRef}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedKeyframeFrame(null);
            }
          }}
        >
          <div className="timeline-keyframes">
            {visibleKeyframes
              .filter((frame) => frame >= timelineIn && frame <= timelineOut)
              .map((frame) => {
                const range = Math.max(1, timelineOut - timelineIn);
                const leftPercent = ((frame - timelineIn) / range) * 100;
                const isSelectedKeyframe = selectedObjectId !== null && selectedKeyframeFrame === frame;
                return (
                  <span
                    key={`kf-${frame}`}
                    className={`timeline-keyframe ${frame === currentFrame ? 'active' : ''} ${isSelectedKeyframe ? 'selected' : ''}`}
                    style={{ left: `${leftPercent}%` }}
                    title={`Keyframe ${frame}`}
                    onMouseDown={(event) => handleKeyframeMouseDown(frame, event)}
                  />
                );
              })}
          </div>
          <input
            type="range"
            min={timelineIn}
            max={timelineOut}
            value={currentFrame}
            onChange={(e) => handleSetCurrentFrame(Number.parseInt(e.target.value, 10))}
            className="timeline-scrubber"
          />
          <div className="timeline-ruler">
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i} className="timeline-marker">
                {Math.round(timelineIn + ((timelineOut - timelineIn) * i) / 10)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}




