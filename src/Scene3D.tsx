import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
const flippedTextureCache = new WeakMap<THREE.Texture, THREE.Texture>();

import Stats from 'three/examples/jsm/libs/stats.module.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { SceneObject, EmitterObject, SnapSettings, PhysicsForce } from './App';

// --- Simple 3D Noise for Turbulence ---
const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;
const pNoise = new Uint8Array(256);
for (let i = 0; i < 256; i++) pNoise[i] = Math.floor(Math.random() * 256);
const p = new Uint8Array(512);
for (let i = 0; i < 512; i++) p[i] = pNoise[i & 255];
function dot(g: number[], x: number, y: number, z: number) { return g[0]*x + g[1]*y + g[2]*z; }
const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
function simplex3(xin: number, yin: number, zin: number) {
  let n0, n1, n2, n3;
  const s = (xin+yin+zin)*F3;
  const i = Math.floor(xin+s); const j = Math.floor(yin+s); const k = Math.floor(zin+s);
  const t = (i+j+k)*G3;
  const X0 = i-t; const Y0 = j-t; const Z0 = k-t;
  const x0 = xin-X0; const y0 = yin-Y0; const z0 = zin-Z0;
  let i1, j1, k1, i2, j2, k2;
  if(x0>=y0) { if(y0>=z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; } else if(x0>=z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; } else { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; } }
  else { if(y0<z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; } else if(x0<z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; } else { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; } }
  const x1 = x0 - i1 + G3; const y1 = y0 - j1 + G3; const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2.0*G3; const y2 = y0 - j2 + 2.0*G3; const z2 = z0 - k2 + 2.0*G3;
  const x3 = x0 - 1.0 + 3.0*G3; const y3 = y0 - 1.0 + 3.0*G3; const z3 = z0 - 1.0 + 3.0*G3;
  const ii = i & 255; const jj = j & 255; const kk = k & 255;
  const gi0 = p[ii+p[jj+p[kk]]] % 12;
  const gi1 = p[ii+i1+p[jj+j1+p[kk+k1]]] % 12;
  const gi2 = p[ii+i2+p[jj+j2+p[kk+k2]]] % 12;
  const gi3 = p[ii+1+p[jj+1+p[kk+1]]] % 12;
  let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0; if(t0<0) n0 = 0.0; else { t0 *= t0; n0 = t0 * t0 * dot(grad3[gi0], x0, y0, z0); }
  let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1; if(t1<0) n1 = 0.0; else { t1 *= t1; n1 = t1 * t1 * dot(grad3[gi1], x1, y1, z1); }
  let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2; if(t2<0) n2 = 0.0; else { t2 *= t2; n2 = t2 * t2 * dot(grad3[gi2], x2, y2, z2); }
  let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3; if(t3<0) n3 = 0.0; else { t3 *= t3; n3 = t3 * t3 * dot(grad3[gi3], x3, y3, z3); }
  return 32.0*(n0 + n1 + n2 + n3);
}

function curlNoise(x: number, y: number, z: number, scale: number) {
  const e = 0.1;
  const dx = new THREE.Vector3(e, 0.0, 0.0);
  const dy = new THREE.Vector3(0.0, e, 0.0);
  const dz = new THREE.Vector3(0.0, 0.0, e);

  const n_x = simplex3(x/scale, y/scale, z/scale);
  
  // Fake quick curl using simplex offsets
  const x0 = simplex3((x-e)/scale, y/scale, z/scale);
  const x1 = simplex3((x+e)/scale, y/scale, z/scale);
  const y0 = simplex3(x/scale, (y-e)/scale, z/scale);
  const y1 = simplex3(x/scale, (y+e)/scale, z/scale);
  const z0 = simplex3(x/scale, y/scale, (z-e)/scale);
  const z1 = simplex3(x/scale, y/scale, (z+e)/scale);

  const cx = ((y1 - y0) - (z1 - z0)) / (2.0 * e);
  const cy = ((z1 - z0) - (x1 - x0)) / (2.0 * e);
  const cz = ((x1 - x0) - (y1 - y0)) / (2.0 * e);

  return new THREE.Vector3(cx, cy, cz).normalize();
}
// ----------------------------------------


type SceneSize = {
  x: number;
  y: number;
  z: number;
};

type SceneSettings = {
  particleType?: string;
  customGlow?: boolean;
  backgroundColor: string;
  gridOpacity: number;
  zoomSpeed: number;
  particlePreviewMode: 'real' | 'white-dots';
  particlePreviewSize: number;
  particleBudget: number;
  adaptiveEmission?: boolean;
  particleLivePreview?: boolean;
  particleSequenceBudget?: number;
  particleSequenceBudgetLoop?: boolean;
  exportProjectionMode?: 'orthographic' | 'perspective';
  cameraOrbitSpeed?: number;
  referenceImage?: string | null;
  referenceOpacity?: number;
  showGrid?: boolean;
  showObjects?: boolean;
  showParticles?: boolean;
};

const DEFAULT_THETA = Math.PI / 4;
const DEFAULT_PHI = Math.PI / 4;
const DEFAULT_EMISSION_AXIS = new THREE.Vector3(0, 1, 0);

export type SpineAttachmentInfo = {
  id: string;
  slotName: string;
  boneObjectId: string;
  imageDataUrl: string;
  localX: number;
  localY: number;
  localRotationDeg: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  /** Pre-resolved data URLs for each frame of a sequence attachment */
  sequenceFrames?: string[];
  /** Slot order index (0 = back, higher = front) */
  slotIndex: number;
  /** Spine blend mode: 'normal' | 'additive' | 'multiply' | 'screen' */
  blendMode?: string;
  /** Slot base color as RGBA hex string e.g. 'ffffffff' */
  color?: string;
};

/** Per-frame override: visibility + optional sequence frame index + optional animated alpha */
export type SpineFrameOverrides = Record<string, { visible: boolean; seqFrame?: number; alpha?: number; tintR?: number; tintG?: number; tintB?: number }>;

type Scene3DProps = {
  sceneSize: SceneSize;
  sceneSettings: SceneSettings;
  snapSettings: SnapSettings;
  viewMode: 'perspective' | 'x' | 'y' | 'z';
  drawMode?: boolean;
  onDrawComplete?: (points: {x:number, y:number, z:number}[]) => void;
  onViewModeChange: (mode: 'perspective' | 'x' | 'y' | 'z') => void;
  sceneObjects: SceneObject[];
  currentFrame: number;
  isPlaying: boolean;
  isCaching: boolean;
  timelineIn: number;
  timelineOut: number;
  physicsForces: PhysicsForce[];
  selectedObjectId: string | null;
  selectedForceId?: string | null;
  onObjectSelect: (objectId: string | null) => void;
  onForceSelect?: (forceId: string | null) => void;
  onObjectTransform?: (objectId: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }) => void;
  onForceTransform?: (forceId: string, position: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }) => void;
  handleScale?: number;
  onCacheFrameCountChange?: (count: number) => void;
  cacheResetToken?: number;
  onUpdateSceneSettings?: (settings: Partial<SceneSettings>) => void;
  onCameraChange?: (cameraState: { position: THREE.Vector3, quaternion: THREE.Quaternion }) => void;
  drawBezierCurveMode?: boolean;
  onFinishDrawBezierCurve?: (points?: {x:number, y:number, z:number}[]) => void;
  spineAttachments?: SpineAttachmentInfo[];
  spineFrameOverrides?: SpineFrameOverrides;
  spineLayerSpread?: number;
  quadViewport?: boolean;
};

type CachedParticleState = {
  emitterId: string;
  trackId: number; // For Spine bone pooling
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  lifetime: number;
  age: number;
  opacity: number;
  rotation: number;
  size: number;
};

type ParticleVisualType = 'dots' | 'stars' | 'circles' | 'glow-circles' | 'sparkle' | 'glitter' | 'sprites' | '3d-model' | 'volumetric-fire';

export interface Scene3DRef {
  exportSpineData: (options?: any) => any;
  getParticleTextureBlob: () => Promise<Blob | null>;
  getExportAssets: () => Promise<Array<{ name: string, blob: Blob }>>;
}


const resampleSequence = (urls: string[], budget: number | undefined) => {
  if (!budget || budget <= 0 || urls.length <= budget) return urls;
  const step = urls.length / budget;
  const resampled = [];
  for(let i=0; i<budget; i++) {
      resampled.push(urls[Math.floor(i * step)]);
  }
  return resampled;
};

const getResampledSequenceProps = (props: any, budget?: number, loop?: boolean) => {
    let urls = Array.isArray(props?.particleSpriteSequenceDataUrls) ? props.particleSpriteSequenceDataUrls : [];
    let fps = Number(props?.particleSpriteSequenceFps ?? 12);
    const originalLength = urls.length;
    const resampledUrls = resampleSequence(urls, budget);
    if (!loop && originalLength > resampledUrls.length && resampledUrls.length > 0) {
        fps = fps * (resampledUrls.length / originalLength);
    }
    return { urls: resampledUrls, fps };
};


function evaluateCurve(curveJson: string | undefined, t: number, defaultValue: number = 1): number {
  if (!curveJson) return defaultValue;
  try {
    const points = JSON.parse(curveJson);
    if (!Array.isArray(points) || points.length === 0) return defaultValue;
    if (points.length === 1) return points[0].y;
    
    // assume pre-sorted but let's be safe
    const sortedPoints = [...points].sort((a: any, b: any) => a.x - b.x);

    if (t <= sortedPoints[0].x) return sortedPoints[0].y;
    if (t >= sortedPoints[sortedPoints.length - 1].x) return sortedPoints[sortedPoints.length - 1].y;

    for (let i = 0; i < sortedPoints.length - 1; i++) {
       const p1 = sortedPoints[i];
       const p2 = sortedPoints[i+1];
       if (t >= p1.x && t <= p2.x) {
         if (p1.rx !== undefined || p2.lx !== undefined) {
             const cp1x = p1.rx !== undefined ? p1.rx : p1.x + (p2.x - p1.x) / 3;
             const cp1y = p1.ry !== undefined ? p1.ry : p1.y + (p2.y - p1.y) / 3;
             const cp2x = p2.lx !== undefined ? p2.lx : p2.x - (p2.x - p1.x) / 3;
             const cp2y = p2.ly !== undefined ? p2.ly : p2.y - (p2.y - p1.y) / 3;
             
             let lower = 0;
             let upper = 1;
             let u = 0.5;
             for (let iter = 0; iter < 15; iter++) {
                 const invU = 1 - u;
                 const currentX = invU*invU*invU*p1.x + 3*invU*invU*u*cp1x + 3*invU*u*u*cp2x + u*u*u*p2.x;
                 if (currentX < t) lower = u;
                 else upper = u;
                 u = (lower + upper) / 2;
             }
             const invU = 1 - u;
             return invU*invU*invU*p1.y + 3*invU*invU*u*cp1y + 3*invU*u*u*cp2y + u*u*u*p2.y;
         } else {
             const segmentT = (t - p1.x) / (p2.x - p1.x);
             return p1.y + (p2.y - p1.y) * segmentT;
         }
       }
    }
  } catch(e) {
  }
  return defaultValue;
}

export const Scene3D = forwardRef<Scene3DRef, Scene3DProps>(({ drawMode, onDrawComplete, sceneSize, sceneSettings, onCameraChange, snapSettings, viewMode, onViewModeChange, sceneObjects, currentFrame, isPlaying, isCaching, timelineIn, timelineOut, physicsForces, selectedObjectId, selectedForceId, onObjectSelect, onForceSelect, onObjectTransform, onForceTransform, handleScale = 1.0, onCacheFrameCountChange, cacheResetToken = 0, onUpdateSceneSettings, drawBezierCurveMode = false, onFinishDrawBezierCurve, spineAttachments = [], spineFrameOverrides, spineLayerSpread = 0, quadViewport = false }, ref) => {
    // State for Bezier curve drawing
    const [bezierCurvePoints, setBezierCurvePoints] = useState<{x: number, y: number, z: number}[]>([]);
    const bezierCurveMeshRef = useRef<THREE.Line | null>(null);

    // Helper: convert screen (client) coordinates to 3D world position on XZ plane (y=0)
    function screenToWorld(x: number, y: number): THREE.Vector3 | null {
      if (!rendererRef.current || !currentCameraRef.current) return null;
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      const ndcX = ((x - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((y - rect.top) / rect.height) * 2 + 1;
      const ndc = new THREE.Vector3(ndcX, ndcY, 0.5);
      ndc.unproject(currentCameraRef.current);
      // Project onto y=0 plane
      const camera = currentCameraRef.current;
      const camPos = camera.position.clone();
      const dir = ndc.clone().sub(camPos).normalize();
      const t = -camPos.y / dir.y;
      if (!isFinite(t)) return null;
      return camPos.clone().add(dir.multiplyScalar(t));
    }

    // Mouse click handler for Bezier curve drawing
    useEffect(() => {
      if (!drawBezierCurveMode) return;
      const handleClick = (event: MouseEvent) => {
        if (event.button !== 0) return; // Only LMB
        if (!rendererRef.current) return;
        const pos = screenToWorld(event.clientX, event.clientY);
        if (pos) {
          setBezierCurvePoints(prev => [...prev, { x: pos.x, y: pos.y, z: pos.z }]);
        }
      };
      window.addEventListener('mousedown', handleClick);
      return () => window.removeEventListener('mousedown', handleClick);
    }, [drawBezierCurveMode]);

    // Render/update the Bezier curve as points are added
    useEffect(() => {
      if (!sceneRef.current) return;
      // Remove previous curve
      if (bezierCurveMeshRef.current) {
        sceneRef.current.remove(bezierCurveMeshRef.current);
        bezierCurveMeshRef.current.geometry.dispose();
        bezierCurveMeshRef.current = null;
      }
      if (bezierCurvePoints.length < 2) return;
      // Create a simple Bezier curve (CatmullRom for now, can upgrade to true Bezier)
      const curve = new THREE.CatmullRomCurve3(bezierCurvePoints.map(p => new THREE.Vector3(p.x, p.y, p.z)));
      const curveGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(100));
      const curveMaterial = new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 2 });
      const curveLine = new THREE.Line(curveGeometry, curveMaterial);
      sceneRef.current.add(curveLine);
      bezierCurveMeshRef.current = curveLine;
    }, [bezierCurvePoints]);

    // Finish drawing (double-click or ESC to complete)
    useEffect(() => {
      if (!drawBezierCurveMode) return;
      const handleFinish = (event: KeyboardEvent | MouseEvent) => {
        if ((event instanceof KeyboardEvent && event.key === 'Escape') || (event instanceof MouseEvent && event.detail === 2)) {
          if (bezierCurvePoints.length >= 2) {
            // TODO: Add curve to scene objects or call onDrawComplete/onFinishDrawBezierCurve
          }
          setBezierCurvePoints([]);
          if (onFinishDrawBezierCurve) onFinishDrawBezierCurve(bezierCurvePoints);
        }
      };
      window.addEventListener('keydown', handleFinish);
      window.addEventListener('dblclick', handleFinish);
      return () => {
        window.removeEventListener('keydown', handleFinish);
        window.removeEventListener('dblclick', handleFinish);
      };
    }, [drawBezierCurveMode, bezierCurvePoints, onFinishDrawBezierCurve]);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const gridHelpersRef = useRef<THREE.GridHelper[]>([]);
  const perspectiveCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const currentCameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null);

  // Mouse control state
  const mouseStateRef = useRef({
    isDown: false,
    button: -1,
    x: 0,
    y: 0,
    deltaX: 0,
    deltaY: 0,
    altKey: false,
    shiftKey: false,
  });

  const cameraStateRef = useRef({
    theta: DEFAULT_THETA,
    phi: DEFAULT_PHI,
    radius: 1500,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    viewOffsetX: 0,
    viewOffsetY: 0,
    viewOffsetZ: 0,
    orthoZoom: 1,
    targetTheta: DEFAULT_THETA,
    targetPhi: DEFAULT_PHI,
    isAnimating: false,
  });

  const selectedObjectRef = useRef<THREE.Object3D | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const isOrthoRef = useRef(false);
  const gizmoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gizmoSceneRef = useRef<THREE.Scene | null>(null);
  const gizmoRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const gizmoAxisObjectsRef = useRef<{ x: THREE.Object3D; y: THREE.Object3D; z: THREE.Object3D } | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  
  // Scene objects tracking
  const sceneObjectMeshesRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const spineAttachmentMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const spineLayerSpreadRef = useRef(0);
  const spineAttachPixelDataRef = useRef<Map<string, { data: Uint8ClampedArray; w: number; h: number } | null>>(new Map());
  const quadViewportRef = useRef(false);
  const quadCamerasRef = useRef<{ front: THREE.OrthographicCamera; top: THREE.OrthographicCamera; side: THREE.OrthographicCamera } | null>(null);
  const sceneExtentRef = useRef(500);
  const physicsForceGizmosRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const particleSystemsRef = useRef<Map<string, {
    particles: Array<{
      trackId: number; // Persistent ID for bone reuse
      mesh: THREE.Points | THREE.Sprite;
      velocity: THREE.Vector3; 
      lifetime: number; 
      age: number;
      baseColor?: string;
      baseOpacity?: number;
      baseSize?: number;
      sizeMultiplier?: number;
        flipX?: boolean;
      particleType?: ParticleVisualType;
      customGlow?: boolean;
      rotation?: number;
      rotationOffset?: number;
      rotationVariation?: number;
      rotationSpeed?: number;
      rotationSpeedMultiplier?: number;
      rotationSpeedVariation?: number;
      spriteImageDataUrl?: string;
      spriteSequenceDataUrls?: string[];
      opacityOverLife?: boolean;
      colorOverLife?: boolean;
      colorOverLifeTarget?: string;
      sizeOverLife?: string;
      positionHistory?: THREE.Vector3[];
    }>;
    lastEmit: number;
  }>>(new Map());
  
  // Refs for animation loop to access latest values
  const sceneObjectsRef = useRef<SceneObject[]>(sceneObjects);
  const sceneSettingsRef = useRef<SceneSettings>(sceneSettings);
  const snapSettingsRef = useRef<SnapSettings>(snapSettings);
  const isPlayingRef = useRef(isPlaying);
  const isCachingRef = useRef(isCaching);
  const timelineInRef = useRef(timelineIn);
const timelineOutRef = useRef(timelineOut);
  const physicsForceRef = useRef<PhysicsForce[]>(physicsForces);
  const currentFrameRef = useRef(currentFrame);
  const lastTimelineFrameRef = useRef(currentFrame);
  const particleFrameCacheRef = useRef<Map<number, CachedParticleState[]>>(new Map());
  const pathAnimTimesRef = useRef<Map<string, number>>(new Map());
  const pathAnimFreeStateRef = useRef<Map<string, { pos: THREE.Vector3; vel: THREE.Vector3 }>>(new Map());
  const lastFrameTimeRef = useRef<number>(Date.now());
  const cacheCountRef = useRef(0);
  const selectedObjectIdRef = useRef<string | null>(selectedObjectId);
  const selectedForceIdRef = useRef<string | null>(selectedForceId ?? null);
  const isDraggingTransformRef = useRef(false);
    const isDrawingRef = useRef(false);
  // Tracks last-seen sprite key per emitter to detect changes and flush stale particles
  const emitterSpriteKeyRef = useRef<Map<string, string>>(new Map());
    const drawnPointsRef = useRef<THREE.Vector3[]>([]);
    const drawnLineRef = useRef<THREE.Line | null>(null);
    const drawModeRef = useRef(drawMode);
    useEffect(() => {
      drawModeRef.current = drawMode; 
    }, [drawMode]);

  const [isMarqueeSelectMode, setIsMarqueeSelectMode] = useState(false);
  const isMarqueeSelectModeRef = useRef(false);
  useEffect(() => {
    isMarqueeSelectModeRef.current = isMarqueeSelectMode;
  }, [isMarqueeSelectMode]);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);

  const dragOrbitTargetRef = useRef<THREE.Vector3 | null>(null);
  const handlesRef = useRef<{ xArrow: THREE.Mesh; yArrow: THREE.Mesh; zArrow: THREE.Mesh } | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    axis: 'x' | 'y' | 'z' | 'free' | 'free-rotate' | null;
    startX: number;
    startY: number;
    startPos: THREE.Vector3;
    startRot: THREE.Euler;
    startScale: THREE.Vector3;
    dragPlanePoint?: THREE.Vector3;
    dragPlaneNormal?: THREE.Vector3;
  }>(
    {
      active: false,
      axis: null,
      startX: 0,
      startY: 0,
      startPos: new THREE.Vector3(),
      startRot: new THREE.Euler(),
      startScale: new THREE.Vector3(1, 1, 1),
    }
  );
  const [manipulatorMode, setManipulatorMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const manipulatorModeRef = useRef<'translate' | 'rotate' | 'scale'>('translate');


  const createStandardObjectMesh = (objectType: string) => {
    const meshMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a8a8a,
      roughness: 0.62,
      metalness: 0.08,
    });
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x8a8a8a });

    if (objectType === 'Cube') {
      return new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), meshMaterial);
    }
    if (objectType === 'Sphere') {
      return new THREE.Mesh(new THREE.SphereGeometry(18, 24, 16), meshMaterial);
    }
    if (objectType === 'Cylinder') {
      return new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 34, 20), meshMaterial);
    }
    if (objectType === 'Cone') {
      return new THREE.Mesh(new THREE.ConeGeometry(14, 34, 20), meshMaterial);
    }
    if (objectType === 'Plane') {
      return new THREE.Mesh(new THREE.PlaneGeometry(40, 40), meshMaterial);
    }
    if (objectType === 'Torus') {
      return new THREE.Mesh(new THREE.TorusGeometry(18, 5, 14, 28), meshMaterial);
    }
    if (objectType === 'Circle') {
      const circleGeometry = new THREE.CircleGeometry(18, 28);
      return new THREE.Mesh(circleGeometry, meshMaterial);
    }
    if (objectType === 'Rectangle') {
      return new THREE.Mesh(new THREE.PlaneGeometry(36, 20), meshMaterial);
    }
    if (objectType === 'Triangle') {
      const triangleShape = new THREE.Shape();
      triangleShape.moveTo(0, 18);
      triangleShape.lineTo(-18, -14);
      triangleShape.lineTo(18, -14);
      triangleShape.lineTo(0, 18);
      return new THREE.Mesh(new THREE.ShapeGeometry(triangleShape), meshMaterial);
    }
    if (objectType === 'Line') {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-20, 0, 0, 20, 0, 0]), 3));
      return new THREE.Line(geometry, lineMaterial);
    }
    if (objectType === 'Arc') {
      const points: number[] = [];
      const radius = 20;
      const start = -Math.PI * 0.7;
      const end = Math.PI * 0.7;
      const steps = 32;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = start + (end - start) * t;
        points.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
      return new THREE.Line(geometry, lineMaterial);
    }
    if (objectType === 'Polygon') {
      const radius = 18;
      const sides = 6;
      const points: number[] = [];
      for (let i = 0; i <= sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        points.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
      return new THREE.Line(geometry, lineMaterial);
    }

    return new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), meshMaterial);
  };
  
  // Update refs when props change
  useEffect(() => {
    sceneObjectsRef.current = sceneObjects;
  }, [sceneObjects]);

  useEffect(() => {
    sceneSettingsRef.current = sceneSettings;
  }, [sceneSettings]);

  useEffect(() => {
    snapSettingsRef.current = snapSettings;
  }, [snapSettings]);
  
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isCachingRef.current = isCaching;
    }, [isCaching]);

    useEffect(() => {
      timelineInRef.current = timelineIn;
    }, [timelineIn]);

    useEffect(() => {
      timelineOutRef.current = timelineOut;
    }, [timelineOut]);

  useEffect(() => {
    physicsForceRef.current = physicsForces;
  }, [physicsForces]);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    onCacheFrameCountChange?.(particleFrameCacheRef.current.size);
  }, [onCacheFrameCountChange]);

  useEffect(() => {
    selectedObjectIdRef.current = selectedObjectId;
  }, [selectedObjectId]);

  useEffect(() => {
    selectedForceIdRef.current = selectedForceId ?? null;
  }, [selectedForceId]);

  useEffect(() => {
    manipulatorModeRef.current = manipulatorMode;
  }, [manipulatorMode]);

  useEffect(() => {
    if (!containerRef.current) return;

    const sceneSizeX = Math.max(100, sceneSize.x || 0);
    const sceneSizeY = Math.max(100, sceneSize.y || 0);
    const sceneSizeZ = Math.max(100, sceneSize.z || 0);
    const sceneExtent = Math.max(sceneSizeX, sceneSizeY, sceneSizeZ);
    sceneExtentRef.current = sceneExtent;

    const raycaster = new THREE.Raycaster();
    const mouseNdc = new THREE.Vector2();
    const orbitTarget = new THREE.Vector3();
    const panRight = new THREE.Vector3();
    const panUp = new THREE.Vector3();
    const panDelta = new THREE.Vector3();
    const selectionBounds = new THREE.Box3();
    const selectionSphere = new THREE.Sphere();

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(sceneSettingsRef.current.backgroundColor);
    sceneRef.current = scene;

    // Camera setup
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, sceneExtent * 20);
    camera.position.set(sceneExtent * 0.35, sceneExtent * 0.35, sceneExtent * 0.35);
    camera.lookAt(0, 0, 0);
    perspectiveCameraRef.current = camera;
    currentCameraRef.current = camera;

    // Ensure the whole default system is visible on initial load
    const cubeBoundingRadius = Math.sqrt(
      (sceneSizeX / 2) * (sceneSizeX / 2) +
      (sceneSizeY / 2) * (sceneSizeY / 2) +
      (sceneSizeZ / 2) * (sceneSizeZ / 2)
    );
    const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
    const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
    const fitRadius = cubeBoundingRadius / Math.sin(limitingHalfFov);
    cameraStateRef.current.radius = fitRadius * 0.8;
    const defaultRadius = cameraStateRef.current.radius;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    renderer.setScissorTest(true);

    // Quad-viewport cameras (front/top/side orthographic)
    const _qAspect = width / height;
    const _qExtent = sceneExtent * 0.75;
    const _qD = sceneExtent * 8;
    const _mkOrtho = (aspect: number) =>
      new THREE.OrthographicCamera(-_qExtent * aspect, _qExtent * aspect, _qExtent, -_qExtent, -_qD, _qD);
    const _frontCam = _mkOrtho(_qAspect);
    _frontCam.position.set(0, 0, _qD * 0.5);
    _frontCam.up.set(0, 1, 0);
    _frontCam.lookAt(0, 0, 0);
    const _topCam = _mkOrtho(_qAspect);
    _topCam.position.set(0, _qD * 0.5, 0);
    _topCam.up.set(0, 0, -1);
    _topCam.lookAt(0, 0, 0);
    const _sideCam = _mkOrtho(_qAspect);
    _sideCam.position.set(_qD * 0.5, 0, 0);
    _sideCam.up.set(0, 1, 0);
    _sideCam.lookAt(0, 0, 0);
    quadCamerasRef.current = { front: _frontCam, top: _topCam, side: _sideCam };

          const stats = new Stats();

      const statsDisplay = document.createElement('div');
      statsDisplay.style.position = 'absolute';
      statsDisplay.style.top = '10px';
      statsDisplay.style.right = '10px';
      statsDisplay.style.color = 'rgba(255, 255, 255, 0.6)';
      statsDisplay.style.backgroundColor = 'transparent';
      statsDisplay.style.fontFamily = 'monospace';
      statsDisplay.style.fontSize = '12px';
      statsDisplay.style.pointerEvents = 'none';
      statsDisplay.style.zIndex = '1000';
      statsDisplay.style.textShadow = '1px 1px 1px #000, -1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000';
      statsDisplay.innerText = 'Particles: 0 | Emitters: 0';
      containerRef.current.appendChild(statsDisplay);

    // Transform controls setup
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.setSpace('world');
    transformControls.setSize(1.2);
    transformControlsRef.current = transformControls;
    
    // Listen for transform changes
    transformControls.addEventListener('dragging-changed', (event: any) => {
      // Disable camera controls while dragging
      isDraggingTransformRef.current = event.value;
      if (event.value) {
        mouseStateRef.current.isDown = false;
      }
    });

    transformControls.addEventListener('objectChange', () => {
      // Update object position/rotation in scene objects
      const attachedObject = transformControls.object;
      
      // Update selection outline to follow the object
      if (attachedObject && sceneRef.current) {
        const outline = sceneRef.current.getObjectByName('selection-outline') as THREE.Mesh;
        if (outline) {
          outline.position.copy(attachedObject.position);
          outline.rotation.copy(attachedObject.rotation);
          outline.scale.copy(attachedObject.scale).multiplyScalar(1.05);
        }
        
        // Update transform handles to follow the object
        const handles = sceneRef.current.getObjectByName('transform-handles') as THREE.Group;
        if (handles) {
          handles.position.copy(attachedObject.position);
          handles.rotation.copy(attachedObject.rotation);
        }
      }
      
      if (attachedObject && onObjectTransform) {
        // Find the object ID
        let objectId: string | null = null;
        for (const [id, mesh] of sceneObjectMeshesRef.current.entries()) {
          if (mesh === attachedObject) {
            objectId = id;
            break;
          }
        }
        if (objectId) {
          onObjectTransform(
            objectId,
            { x: attachedObject.position.x, y: attachedObject.position.y, z: attachedObject.position.z },
            { x: attachedObject.rotation.x, y: attachedObject.rotation.y, z: attachedObject.rotation.z },
            { x: attachedObject.scale.x, y: attachedObject.scale.y, z: attachedObject.scale.z }
          );
        }
      }
    });

    // Create grid planes (xy, xz, yz)
    const gridSize = sceneExtent;
    const gridDivisions = Math.max(10, Math.round(sceneExtent / 50));
    const gridStep = gridSize / gridDivisions;

    // XY Grid (z = 0)
    const gridXY = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x222222);
    gridXY.position.z = 0;
    if (gridXY.material instanceof THREE.Material) {
      gridXY.material.opacity = sceneSettingsRef.current.gridOpacity;
      gridXY.material.transparent = true;
    }
    scene.add(gridXY);

    // XZ Grid (y = 0)
    const gridXZ = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x222222);
    gridXZ.rotation.x = Math.PI / 2;
    gridXZ.position.y = 0;
    if (gridXZ.material instanceof THREE.Material) {
      gridXZ.material.opacity = sceneSettingsRef.current.gridOpacity;
      gridXZ.material.transparent = true;
    }
    scene.add(gridXZ);

    // YZ Grid (x = 0)
    const gridYZ = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x222222);
    gridYZ.rotation.z = Math.PI / 2;
    gridYZ.position.x = 0;
    if (gridYZ.material instanceof THREE.Material) {
      gridYZ.material.opacity = sceneSettingsRef.current.gridOpacity;
      gridYZ.material.transparent = true;
    }
    scene.add(gridYZ);
    gridHelpersRef.current = [gridXY, gridXZ, gridYZ];

    // Add axis helpers for better visualization
    const axesHelper = new THREE.AxesHelper(60);
    scene.add(axesHelper);

    // Neutral viewport lighting so shaded meshes are visible and readable
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
    keyLight.position.set(sceneExtent * 0.7, sceneExtent, sceneExtent * 0.6);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-sceneExtent * 0.6, sceneExtent * 0.45, -sceneExtent * 0.5);
    scene.add(fillLight);

    // Add colored lines for axes
    const axisLength = sceneExtent / 2;
    
    // X axis (red)
    const xGeometry = new THREE.BufferGeometry();
    xGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, axisLength, 0, 0]),
      3
    ));
    const xLine = new THREE.Line(xGeometry, new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 3 }));
    scene.add(xLine);

    // Y axis (green)
    const yGeometry = new THREE.BufferGeometry();
    yGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 0, axisLength, 0]),
      3
    ));
    const yLine = new THREE.Line(yGeometry, new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3 }));
    scene.add(yLine);

    // Z axis (blue)
    const zGeometry = new THREE.BufferGeometry();
    zGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 0, 0, axisLength]),
      3
    ));
    const zLine = new THREE.Line(zGeometry, new THREE.LineBasicMaterial({ color: 0x0000ff, linewidth: 3 }));
    scene.add(zLine);

    // Create raycaster for handle detection
    const raycasterHandles = new THREE.Raycaster();
    const mouseNdcHandles = new THREE.Vector2();

    const getSnappedPosition = (position: THREE.Vector3) => {
      const snap = snapSettingsRef.current;
      const enabledPlanes: Array<'x' | 'y' | 'z'> = [];
      if (snap.snapX) enabledPlanes.push('x');
      if (snap.snapY) enabledPlanes.push('y');
      if (snap.snapZ) enabledPlanes.push('z');

      if (enabledPlanes.length === 0) {
        return position.clone();
      }

      const snapAxis = (value: number) => Math.round(value / gridStep) * gridStep;
      const getPlaneAxes = (plane: 'x' | 'y' | 'z'): Array<'x' | 'y' | 'z'> => {
        if (plane === 'x') return ['y', 'z'];
        if (plane === 'y') return ['x', 'z'];
        return ['x', 'y'];
      };

      const candidates: THREE.Vector3[] = [];
      enabledPlanes.forEach((plane) => {
        const planeAxes = getPlaneAxes(plane);
        const [axisA, axisB] = planeAxes;

        const vertexCandidate = position.clone();
        vertexCandidate[plane] = 0;
        vertexCandidate[axisA] = snapAxis(vertexCandidate[axisA]);
        vertexCandidate[axisB] = snapAxis(vertexCandidate[axisB]);

        if (snap.snapTarget === 'vertices') {
          candidates.push(vertexCandidate);
          return;
        }

        const lineCandidateA = position.clone();
        lineCandidateA[plane] = 0;
        lineCandidateA[axisA] = snapAxis(lineCandidateA[axisA]);

        const lineCandidateB = position.clone();
        lineCandidateB[plane] = 0;
        lineCandidateB[axisB] = snapAxis(lineCandidateB[axisB]);

        if (snap.snapTarget === 'lines') {
          candidates.push(lineCandidateA, lineCandidateB);
          return;
        }

        candidates.push(vertexCandidate, lineCandidateA, lineCandidateB);
      });

      if (candidates.length === 0) {
        return position.clone();
      }

      return candidates.reduce((best, candidate) => (
        candidate.distanceTo(position) < best.distanceTo(position) ? candidate : best
      ), candidates[0]);
    };

    // Mouse event handlers
    const onMouseDown = (event: MouseEvent) => {
        if (drawModeRef.current) {
          isDrawingRef.current = true;
          drawnPointsRef.current = [];
          if (drawnLineRef.current) {
            scene.remove(drawnLineRef.current);
            drawnLineRef.current.geometry.dispose();
            (drawnLineRef.current.material as THREE.Material).dispose();
            drawnLineRef.current = null;
          }
          return;
        }
        if (drawModeRef.current) {
          isDrawingRef.current = true;
          drawnPointsRef.current = [];
          if (drawnLineRef.current) {
            scene.remove(drawnLineRef.current);
            drawnLineRef.current.geometry.dispose();
            (drawnLineRef.current.material as THREE.Material).dispose();
            drawnLineRef.current = null;
          }
          return;
        }
      containerRef.current?.focus();

      if (isMarqueeSelectModeRef.current && event.button === 0 && !event.altKey && !event.shiftKey) {
        const rect = renderer.domElement.getBoundingClientRect();
        marqueeStartRef.current = { x: event.clientX, y: event.clientY };
        
        if (marqueeRef.current) {
          marqueeRef.current.style.display = 'block';
          marqueeRef.current.style.left = `${event.clientX - rect.left}px`;
          marqueeRef.current.style.top = `${event.clientY - rect.top}px`;
          marqueeRef.current.style.width = '0px';
          marqueeRef.current.style.height = '0px';
        }
        return;
      }

      // Check if clicking on transform handles (only if Alt is not pressed for camera rotation)
      if (!event.altKey && handlesRef.current && selectedObjectIdRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouseNdcHandles.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseNdcHandles.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        raycasterHandles.setFromCamera(mouseNdcHandles, camera);
        const handleObjects = [handlesRef.current.xArrow, handlesRef.current.yArrow, handlesRef.current.zArrow];
        const hits = raycasterHandles.intersectObjects(handleObjects);
        
        if (hits.length > 0) {
          const hitObject = hits[0].object;
          
          // Start drag
          dragStateRef.current.active = true;
          dragStateRef.current.startX = event.clientX;
          dragStateRef.current.startY = event.clientY;
          isDraggingTransformRef.current = true;
          
          if (hitObject.name === 'x-arrow') dragStateRef.current.axis = 'x';
          else if (hitObject.name === 'y-arrow') dragStateRef.current.axis = 'y';
          else if (hitObject.name === 'z-arrow') dragStateRef.current.axis = 'z';
          
          // Store object initial position
          const selectedMesh = sceneObjectMeshesRef.current.get(selectedObjectIdRef.current);
          if (selectedMesh) {
            dragStateRef.current.startPos.copy(selectedMesh.position);
            dragStateRef.current.startRot.copy(selectedMesh.rotation);
            dragStateRef.current.startScale.copy(selectedMesh.scale);

            // Lock camera orbit to current view target to prevent jumping
            const cameraState = cameraStateRef.current;
            dragOrbitTargetRef.current = new THREE.Vector3(
              cameraState.viewOffsetX,
              cameraState.viewOffsetY,
              cameraState.viewOffsetZ
            );
          }
          
          event.preventDefault();
          return;
        }
        
        // Check if clicking on any object to select and start drag
        if (!event.altKey && event.button === 0) {
          const rect = renderer.domElement.getBoundingClientRect();
          mouseNdcHandles.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          mouseNdcHandles.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

          raycasterHandles.setFromCamera(mouseNdcHandles, camera);
          
          let clickedObjectId: string | null = null;
          let selectedMesh: THREE.Object3D | null = null;
          let hitPoint: THREE.Vector3 | null = null;

          const selectableObjects: THREE.Object3D[] = [];
          sceneObjectMeshesRef.current.forEach(mesh => selectableObjects.push(mesh));
          const objectHits = raycasterHandles.intersectObjects(selectableObjects, true);

          if (objectHits.length > 0) {
            for (const [id, mesh] of sceneObjectMeshesRef.current.entries()) {
              let obj: THREE.Object3D | null = objectHits[0].object;
              while (obj) {
                if (obj === mesh) {
                  clickedObjectId = id;
                  break;
                }
                obj = obj.parent;
              }
              if (clickedObjectId) {
                selectedMesh = mesh;
                hitPoint = objectHits[0].point;
                break;
              }
            }
          }

          if (clickedObjectId && selectedMesh && hitPoint) {
            if (clickedObjectId !== selectedObjectIdRef.current) {
              onObjectSelect(clickedObjectId);
              selectedObjectIdRef.current = clickedObjectId;
              selectedObjectRef.current = selectedMesh;
            }
            const objectHits = [{ point: hitPoint }]; // Mock structure for underlying logic
            if (true) {              const mode = manipulatorModeRef.current;
              
              // Rotate mode: free-rotate with mouse. Scale: closest axis. Translate: free drag.
              if (mode === 'rotate') {
                // Free rotation — no axis constraint
                dragStateRef.current.active = true;
                dragStateRef.current.axis = 'free-rotate';
                dragStateRef.current.startX = event.clientX;
                dragStateRef.current.startY = event.clientY;
                dragStateRef.current.startPos.copy(selectedMesh.position);
                dragStateRef.current.startRot.copy(selectedMesh.rotation);
                dragStateRef.current.startScale.copy(selectedMesh.scale);
                isDraggingTransformRef.current = true;
                const cameraState0 = cameraStateRef.current;
                dragOrbitTargetRef.current = new THREE.Vector3(
                  cameraState0.viewOffsetX,
                  cameraState0.viewOffsetY,
                  cameraState0.viewOffsetZ
                );
              } else if (mode === 'scale') {
                // Get mouse position in 3D
                const hitPoint = objectHits[0].point;
                const objPos = selectedMesh.position;
                
                // Calculate distance from hit point to each handle
                const handlePositions = {
                  x: new THREE.Vector3(120 * handleScale, 0, 0).add(objPos),
                  y: new THREE.Vector3(0, 120 * handleScale, 0).add(objPos),
                  z: new THREE.Vector3(0, 0, 120 * handleScale).add(objPos)
                };
                
                const distances = {
                  x: hitPoint.distanceTo(handlePositions.x),
                  y: hitPoint.distanceTo(handlePositions.y),
                  z: hitPoint.distanceTo(handlePositions.z)
                };
                
                // Find closest axis
                let closestAxis: 'x' | 'y' | 'z' = 'x';
                let minDist = distances.x;
                if (distances.y < minDist) {
                  closestAxis = 'y';
                  minDist = distances.y;
                }
                if (distances.z < minDist) {
                  closestAxis = 'z';
                }
                
                // Start constrained drag with closest axis
                dragStateRef.current.active = true;
                dragStateRef.current.axis = closestAxis;
                dragStateRef.current.startX = event.clientX;
                dragStateRef.current.startY = event.clientY;
                dragStateRef.current.startPos.copy(selectedMesh.position);
                dragStateRef.current.startRot.copy(selectedMesh.rotation);
                dragStateRef.current.startScale.copy(selectedMesh.scale);
                isDraggingTransformRef.current = true;
                
                // Lock camera orbit
                const cameraState = cameraStateRef.current;
                dragOrbitTargetRef.current = new THREE.Vector3(
                  cameraState.viewOffsetX,
                  cameraState.viewOffsetY,
                  cameraState.viewOffsetZ
                );
              } else {
                // For translate mode, use free drag
                dragStateRef.current.active = true;
                dragStateRef.current.axis = 'free';
                dragStateRef.current.startX = event.clientX;
                dragStateRef.current.startY = event.clientY;
                dragStateRef.current.startPos.copy(selectedMesh.position);
                dragStateRef.current.startRot.copy(selectedMesh.rotation);
                dragStateRef.current.startScale.copy(selectedMesh.scale);
                isDraggingTransformRef.current = true;
                
                // Create drag plane perpendicular to camera view
                const cameraDirection = new THREE.Vector3();
                camera.getWorldDirection(cameraDirection);
                dragStateRef.current.dragPlaneNormal = cameraDirection.normalize();
                dragStateRef.current.dragPlanePoint = selectedMesh.position.clone();
                
                // Lock camera orbit
                const cameraState = cameraStateRef.current;
                dragOrbitTargetRef.current = new THREE.Vector3(
                  cameraState.viewOffsetX,
                  cameraState.viewOffsetY,
                  cameraState.viewOffsetZ
                );
              }
              
              event.preventDefault();
              return;
            }
          }
        }
      }

      const isRotateStart = event.altKey && event.button === 0;
      const isPanStart = event.altKey && event.button === 2;
      const isSelectStart = !event.altKey && !event.shiftKey && event.button === 0;

      if (!isRotateStart && !isPanStart && !isSelectStart) return;
      
      // Only preventDefault for camera controls, not for selection
      if (isRotateStart || isPanStart) {
        event.preventDefault();
      }
      
      mouseStateRef.current.isDown = true;
      mouseStateRef.current.button = event.button;
      mouseStateRef.current.x = event.clientX;
      mouseStateRef.current.y = event.clientY;
      mouseStateRef.current.deltaX = 0;
      mouseStateRef.current.deltaY = 0;
      mouseStateRef.current.altKey = event.altKey;
      mouseStateRef.current.shiftKey = event.shiftKey;
    };

    const onMouseMove = (event: MouseEvent) => {
        if (drawModeRef.current && isDrawingRef.current) {
          const rect = renderer.domElement.getBoundingClientRect();
          const mouseNd = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
          raycasterHandles.setFromCamera(mouseNd, camera);
          const planeNormal = new THREE.Vector3();
          camera.getWorldDirection(planeNormal);
          planeNormal.negate();
          const target = dragOrbitTargetRef.current || new THREE.Vector3(0, 0, 0);
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, target);
          const intersectPoint = new THREE.Vector3();
          raycasterHandles.ray.intersectPlane(plane, intersectPoint);
          if (intersectPoint) {
            drawnPointsRef.current.push(intersectPoint.clone());
            if (!drawnLineRef.current) {
              const geo = new THREE.BufferGeometry().setFromPoints(drawnPointsRef.current);
              const mat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
              const line = new THREE.Line(geo, mat);
              drawnLineRef.current = line;
              scene.add(line);
            } else {
              drawnLineRef.current.geometry.setFromPoints(drawnPointsRef.current);
            }
          }
          return;
        }
        if (drawModeRef.current && isDrawingRef.current) {
          const rect = renderer.domElement.getBoundingClientRect();
          const mouseNd = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
          raycasterHandles.setFromCamera(mouseNd, camera);
          const planeNormal = new THREE.Vector3();
          camera.getWorldDirection(planeNormal);
          planeNormal.negate();
          const target = dragOrbitTargetRef.current || new THREE.Vector3(0, 0, 0);
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, target);
          const intersectPoint = new THREE.Vector3();
          raycasterHandles.ray.intersectPlane(plane, intersectPoint);
          if (intersectPoint) {
            drawnPointsRef.current.push(intersectPoint.clone());
            if (!drawnLineRef.current) {
              const geo = new THREE.BufferGeometry().setFromPoints(drawnPointsRef.current);
              const mat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
              const line = new THREE.Line(geo, mat);
              drawnLineRef.current = line;
              scene.add(line);
            } else {
              drawnLineRef.current.geometry.setFromPoints(drawnPointsRef.current);
            }
          }
          return;
        }

      if (isMarqueeSelectModeRef.current && marqueeStartRef.current && mouseStateRef.current.isDown && mouseStateRef.current.button === 0) {
        if (marqueeRef.current) {
          const rect = renderer.domElement.getBoundingClientRect();
          const startX = marqueeStartRef.current.x - rect.left;
          const startY = marqueeStartRef.current.y - rect.top;
          const currentX = event.clientX - rect.left;
          const currentY = event.clientY - rect.top;
          
          const left = Math.min(startX, currentX);
          const top = Math.min(startY, currentY);
          const width = Math.abs(currentX - startX);
          const height = Math.abs(currentY - startY);
          
          marqueeRef.current.style.left = `${left}px`;
          marqueeRef.current.style.top = `${top}px`;
          marqueeRef.current.style.width = `${width}px`;
          marqueeRef.current.style.height = `${height}px`;
        }
        return;
      }

      // Handle free dragging
      if (dragStateRef.current.active && dragStateRef.current.axis === 'free' && selectedObjectIdRef.current) {
        const selectedMesh = sceneObjectMeshesRef.current.get(selectedObjectIdRef.current);
        if (selectedMesh && dragStateRef.current.dragPlaneNormal && dragStateRef.current.dragPlanePoint) {
          const rect = renderer.domElement.getBoundingClientRect();
          const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          
          // Create ray from camera through mouse position
          raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
          
          // Intersect with drag plane
          const plane = new THREE.Plane();
          plane.setFromNormalAndCoplanarPoint(
            dragStateRef.current.dragPlaneNormal,
            dragStateRef.current.dragPlanePoint
          );
          
          const intersection = new THREE.Vector3();
          raycaster.ray.intersectPlane(plane, intersection);
          
          if (intersection) {
            selectedMesh.position.copy(getSnappedPosition(intersection));
            dragStateRef.current.dragPlanePoint = intersection.clone();
            
            // Update outline and handles
            if (sceneRef.current) {
              const outline = sceneRef.current.getObjectByName('selection-outline');
              if (outline) {
                outline.position.copy(selectedMesh.position);
                outline.rotation.copy(selectedMesh.rotation);
                outline.scale.copy(selectedMesh.scale);
                outline.scale.multiplyScalar(1.05);
              }
              const handles = sceneRef.current.getObjectByName('transform-handles');
              if (handles) {
                handles.position.copy(selectedMesh.position);
                handles.rotation.copy(selectedMesh.rotation);
              }
            }
          }
        }
        return;
      }
      
      // Handle free rotation (rotate mode, no axis handle)
      if (dragStateRef.current.active && dragStateRef.current.axis === 'free-rotate' && selectedObjectIdRef.current) {
        const selectedMesh = sceneObjectMeshesRef.current.get(selectedObjectIdRef.current);
        if (selectedMesh) {
          const dx = event.clientX - dragStateRef.current.startX;
          const dy = event.clientY - dragStateRef.current.startY;
          const sensitivity = 0.007;

          // Yaw: mouse X → rotate around world Y axis
          const yawQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), -dx * sensitivity
          );
          // Pitch: mouse Y → rotate around camera's right axis
          const cameraForward = new THREE.Vector3();
          camera.getWorldDirection(cameraForward);
          const cameraRight = new THREE.Vector3().crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();
          const pitchQuat = new THREE.Quaternion().setFromAxisAngle(cameraRight, -dy * sensitivity);

          // Apply incremental world-space rotation
          const deltaQuat = new THREE.Quaternion().multiplyQuaternions(pitchQuat, yawQuat);
          selectedMesh.quaternion.multiplyQuaternions(deltaQuat, selectedMesh.quaternion);
          selectedMesh.rotation.setFromQuaternion(selectedMesh.quaternion);

          // Update outline and handles
          if (sceneRef.current) {
            const outline = sceneRef.current.getObjectByName('selection-outline');
            if (outline) {
              outline.rotation.copy(selectedMesh.rotation);
            }
            const handles = sceneRef.current.getObjectByName('transform-handles');
            if (handles) {
              handles.rotation.copy(selectedMesh.rotation);
            }
          }

          dragStateRef.current.startX = event.clientX;
          dragStateRef.current.startY = event.clientY;
        }
        return;
      }

      // Handle arrow dragging
      if (dragStateRef.current.active && dragStateRef.current.axis && selectedObjectIdRef.current) {
        const selectedMesh = sceneObjectMeshesRef.current.get(selectedObjectIdRef.current);
        if (selectedMesh) {
          const deltaX = event.clientX - dragStateRef.current.startX;
          const deltaY = event.clientY - dragStateRef.current.startY;
          const mode = manipulatorModeRef.current;
          const axis = dragStateRef.current.axis as 'x' | 'y' | 'z';

          const axisLocal =
            axis === 'x'
              ? new THREE.Vector3(1, 0, 0)
              : axis === 'y'
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, 1);
          const axisWorld = axisLocal.clone().applyQuaternion(selectedMesh.quaternion).normalize();

          const objectWorldPos = new THREE.Vector3();
          selectedMesh.getWorldPosition(objectWorldPos);
          const axisTipWorld = objectWorldPos.clone().add(axisWorld);

          const objectScreen = objectWorldPos.clone().project(camera);
          const tipScreen = axisTipWorld.clone().project(camera);
          const axisScreen = new THREE.Vector2(tipScreen.x - objectScreen.x, tipScreen.y - objectScreen.y);
          const mouseDeltaScreen = new THREE.Vector2(
            (deltaX / renderer.domElement.clientWidth) * 2,
            (-deltaY / renderer.domElement.clientHeight) * 2
          );

          let axisDragDelta = 0;
          const axisScreenLength = axisScreen.length();
          if (axisScreenLength > 0.000001) {
            axisScreen.divideScalar(axisScreenLength);
            axisDragDelta = mouseDeltaScreen.dot(axisScreen);
          } else {
            axisDragDelta = (deltaX - deltaY) * 0.001;
          }

          if (mode === 'translate') {
            const newPos = dragStateRef.current.startPos.clone();
            const moveDistance = axisDragDelta * sceneExtent * 0.75;

            if (axis === 'x') {
              newPos.x += moveDistance;
            } else if (axis === 'y') {
              newPos.y += moveDistance;
            } else if (axis === 'z') {
              newPos.z += moveDistance;
            }

            selectedMesh.position.copy(getSnappedPosition(newPos));
            dragStateRef.current.startPos.copy(selectedMesh.position);
          } else if (mode === 'rotate') {
            const rotateAmount = axisDragDelta * Math.PI;
            const newRot = dragStateRef.current.startRot.clone();

            if (axis === 'x') {
              newRot.x += rotateAmount;
            } else if (axis === 'y') {
              newRot.y += rotateAmount;
            } else if (axis === 'z') {
              newRot.z += rotateAmount;
            }

            selectedMesh.rotation.copy(newRot);
            dragStateRef.current.startRot.copy(newRot);
          } else {
            const scaleAmount = 1 + axisDragDelta * 2;
            const safeScaleAmount = Math.max(0.05, scaleAmount);
            const newScale = dragStateRef.current.startScale.clone();

            if (axis === 'x') {
              newScale.x = Math.max(0.05, newScale.x * safeScaleAmount);
            } else if (axis === 'y') {
              newScale.y = Math.max(0.05, newScale.y * safeScaleAmount);
            } else if (axis === 'z') {
              newScale.z = Math.max(0.05, newScale.z * safeScaleAmount);
            }

            selectedMesh.scale.copy(newScale);
            dragStateRef.current.startScale.copy(newScale);
          }
          
          // Update outline and handles
          if (sceneRef.current) {
            const outline = sceneRef.current.getObjectByName('selection-outline');
            if (outline) {
              outline.position.copy(selectedMesh.position);
              outline.rotation.copy(selectedMesh.rotation);
              outline.scale.copy(selectedMesh.scale);
              outline.scale.multiplyScalar(1.05);
            }
            const handles = sceneRef.current.getObjectByName('transform-handles');
            if (handles) {
              handles.position.copy(selectedMesh.position);
              handles.rotation.copy(selectedMesh.rotation);
            }
          }
          
          // Store cursor baseline for incremental drag
          dragStateRef.current.startX = event.clientX;
          dragStateRef.current.startY = event.clientY;
        }
        return;
      }

      // If dragging the custom handles, don't handle camera movement
      if (isDraggingTransformRef.current) {
        return;
      }

      if (!mouseStateRef.current.isDown) return;

      const deltaX = event.clientX - mouseStateRef.current.x;
      const deltaY = event.clientY - mouseStateRef.current.y;
      mouseStateRef.current.deltaX += Math.abs(deltaX);
      mouseStateRef.current.deltaY += Math.abs(deltaY);

      const cameraState = cameraStateRef.current;
      const sensitivity = 0.01;

      if (mouseStateRef.current.altKey && mouseStateRef.current.button === 0) {
        // Rotate with alt+lmb (only in perspective mode)
        if (!isOrthoRef.current) {
          cameraState.isAnimating = false;
          cameraState.theta -= deltaX * sensitivity;
          cameraState.phi -= deltaY * sensitivity;
          cameraState.phi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraState.phi));
          cameraState.targetTheta = cameraState.theta;
          cameraState.targetPhi = cameraState.phi;
        }
      } else if (mouseStateRef.current.altKey && mouseStateRef.current.button === 2) {
        // Pan with alt+rmb
        const panSpeed = Math.max(0.01, cameraState.radius * 0.002);

        camera.updateMatrixWorld();
        panRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        panUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
        panDelta
          .copy(panRight)
          .multiplyScalar(-deltaX * panSpeed)
          .addScaledVector(panUp, deltaY * panSpeed);

        cameraState.viewOffsetX += panDelta.x;
        cameraState.viewOffsetY += panDelta.y;
        cameraState.viewOffsetZ += panDelta.z;
      }

      mouseStateRef.current.x = event.clientX;
      mouseStateRef.current.y = event.clientY;
    };

    const onMouseUp = (event: MouseEvent) => {
        if (drawModeRef.current && isDrawingRef.current) {
          isDrawingRef.current = false;
          if (drawnPointsRef.current.length > 2 && onDrawComplete) {
            onDrawComplete(drawnPointsRef.current.map(p => ({ x: p.x, y: p.y, z: p.z })));
          }
          if (drawnLineRef.current) {
            scene.remove(drawnLineRef.current);
            drawnLineRef.current.geometry.dispose();
            (drawnLineRef.current.material as THREE.Material).dispose();
            drawnLineRef.current = null;
          }
          drawnPointsRef.current = [];
          return;
        }

        if (marqueeStartRef.current && isMarqueeSelectModeRef.current) {
          if (marqueeRef.current) marqueeRef.current.style.display = 'none';
          const endX = event.clientX;
          const endY = event.clientY;
          const startX = marqueeStartRef.current.x;
          const startY = marqueeStartRef.current.y;
          
          if (Math.abs(endX - startX) > 5 || Math.abs(endY - startY) > 5) {
             const rect = renderer.domElement.getBoundingClientRect();
             const minX = Math.min(startX, endX) - rect.left;
             const maxX = Math.max(startX, endX) - rect.left;
             const minY = Math.min(startY, endY) - rect.top;
             const maxY = Math.max(startY, endY) - rect.top;
             
             let selectedId: string | null = null;
             // project objects
             for (const [id, mesh] of sceneObjectMeshesRef.current.entries()) {
               const pos = new THREE.Vector3();
               mesh.getWorldPosition(pos);
               pos.project(camera);
               // POS is in NDC (-1 to +1)
               const screenX = (pos.x * 0.5 + 0.5) * rect.width;
               const screenY = (-(pos.y) * 0.5 + 0.5) * rect.height;
               
               if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) {
                 selectedId = id;
                 break; // Single select behavior for marquee box
               }
             }
             if (selectedId) {
                onObjectSelect(selectedId);
                selectedObjectRef.current = sceneObjectMeshesRef.current.get(selectedId) || null;
             } else {
                onObjectSelect(null);
                selectedObjectRef.current = null;
             }
             
             marqueeStartRef.current = null;
             mouseStateRef.current.isDown = false;
             mouseStateRef.current.button = -1;
             return;
          } else {
             marqueeStartRef.current = null; // Too small to be a marquee drag, fall through to click select
          }
        }
      // End arrow drag
      if (dragStateRef.current.active) {
        // Update state when drag ends
        if (selectedObjectIdRef.current && onObjectTransform) {
          const selectedMesh = sceneObjectMeshesRef.current.get(selectedObjectIdRef.current);
          if (selectedMesh) {
            onObjectTransform(
              selectedObjectIdRef.current,
              { x: selectedMesh.position.x, y: selectedMesh.position.y, z: selectedMesh.position.z },
              { x: selectedMesh.rotation.x, y: selectedMesh.rotation.y, z: selectedMesh.rotation.z },
              { x: selectedMesh.scale.x, y: selectedMesh.scale.y, z: selectedMesh.scale.z }
            );
          }
        }
        
        dragStateRef.current.active = false;
        dragStateRef.current.axis = null;
        isDraggingTransformRef.current = false;
        dragOrbitTargetRef.current = null;
        return;
      }

      if (event.button !== mouseStateRef.current.button) return;

      // If custom handles were being used, skip selection
      if (isDraggingTransformRef.current) {
        mouseStateRef.current.isDown = false;
        mouseStateRef.current.button = -1;
        return;
      }

      const wasClick = mouseStateRef.current.deltaX + mouseStateRef.current.deltaY < 4;
      const isModifierAction = mouseStateRef.current.altKey || mouseStateRef.current.shiftKey;

      // Only handle selection if it was a click, not during transform dragging, and no modifiers
      if (wasClick && !isModifierAction && !isDraggingTransformRef.current && containerRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouseNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouseNdc, camera);

        // Filter to only scene object meshes (recursive to check children of groups)
        const selectableObjects: THREE.Object3D[] = [];
        sceneObjectMeshesRef.current.forEach(mesh => selectableObjects.push(mesh));
        const hits = raycaster.intersectObjects(selectableObjects, true);

        if (hits.length > 0) {
          // Find the object ID for the clicked mesh (or its parent group)
          let clickedObjectId: string | null = null;
          for (const [id, mesh] of sceneObjectMeshesRef.current.entries()) {
            // Traverse up the parent chain to find the root mesh
            let obj: THREE.Object3D | null = hits[0].object;
            while (obj) {
              if (obj === mesh) {
                clickedObjectId = id;
                break;
              }
              obj = obj.parent;
            }
            if (clickedObjectId) break;
          }
          onObjectSelect(clickedObjectId);
          selectedObjectRef.current = hits[0].object;
        } else {
          onObjectSelect(null);
          selectedObjectRef.current = null;
        }
      }

      mouseStateRef.current.isDown = false;
      mouseStateRef.current.button = -1;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraStateRef.current.radius += event.deltaY * sceneSettingsRef.current.zoomSpeed / 100;
      cameraStateRef.current.radius = Math.max(10, Math.min(sceneExtent * 10, cameraStateRef.current.radius));
    };

    const applyFocusSceneCenter = () => {
      const cameraState = cameraStateRef.current;
      cameraState.theta = DEFAULT_THETA;
      cameraState.phi = DEFAULT_PHI;
      cameraState.radius = defaultRadius;
      cameraState.viewOffsetX = 0;
      cameraState.viewOffsetY = 0;
      cameraState.viewOffsetZ = 0;
    };

    const applyFocusSelectedObject = () => {
      const cameraState = cameraStateRef.current;
      const selectedMesh = selectedObjectIdRef.current
        ? sceneObjectMeshesRef.current.get(selectedObjectIdRef.current)
        : null;

      if (selectedMesh) {
        selectedMesh.getWorldPosition(orbitTarget);
        cameraState.viewOffsetX = orbitTarget.x;
        cameraState.viewOffsetY = orbitTarget.y;
        cameraState.viewOffsetZ = orbitTarget.z;

        selectionBounds.setFromObject(selectedMesh);
        if (!selectionBounds.isEmpty()) {
          selectionBounds.getBoundingSphere(selectionSphere);
          const minRadius = Math.max(1, selectionSphere.radius * 2.4);
          cameraState.radius = Math.max(10, Math.min(sceneExtent * 10, minRadius));
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const isAKey = event.code === 'KeyA' || event.key.toLowerCase() === 'a';
      const isFKey = event.code === 'KeyF' || event.key.toLowerCase() === 'f';
      const isWKey = event.code === 'KeyW' || event.key.toLowerCase() === 'w';
      const isEKey = event.code === 'KeyE' || event.key.toLowerCase() === 'e';
      const isRKey = event.code === 'KeyR' || event.key.toLowerCase() === 'r';

      if (isAKey) {
        event.preventDefault();
        applyFocusSceneCenter();
        return;
      }

      if (isFKey) {
        event.preventDefault();
        applyFocusSelectedObject();
        return;
      }

      // Transform controls mode switching
      if (transformControlsRef.current && selectedObjectIdRef.current) {
        if (isWKey) {
          event.preventDefault();
          transformControlsRef.current.setMode('translate');
          manipulatorModeRef.current = 'translate';
          setManipulatorMode('translate');
        } else if (isEKey) {
          event.preventDefault();
          transformControlsRef.current.setMode('rotate');
          manipulatorModeRef.current = 'rotate';
          setManipulatorMode('rotate');
        } else if (isRKey) {
          event.preventDefault();
          transformControlsRef.current.setMode('scale');
          manipulatorModeRef.current = 'scale';
          setManipulatorMode('scale');
        }
      }
    };

    if (containerRef.current) {
      containerRef.current.addEventListener('mousedown', onMouseDown);
      containerRef.current.addEventListener('contextmenu', (e) => e.preventDefault());
      containerRef.current.addEventListener('wheel', onWheel, { passive: false });
    }
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    const particleTextureCache = new Map<string, THREE.CanvasTexture>();
    const spriteTextureCache = new Map<string, THREE.Texture>();
    const textureLoader = new THREE.TextureLoader();

    // Animation loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const activeCamera = currentCameraRef.current;
      if (!activeCamera) return;

      if (onCameraChange && activeCamera) {
        // Track changes
        if (!(activeCamera as any)._lastQ) { (activeCamera as any)._lastQ = new THREE.Quaternion(); (activeCamera as any)._lastP = new THREE.Vector3(); }
        if (!(activeCamera as any)._lastQ.equals(activeCamera.quaternion) || !(activeCamera as any)._lastP.equals(activeCamera.position)) {
          (activeCamera as any)._lastQ.copy(activeCamera.quaternion);
          (activeCamera as any)._lastP.copy(activeCamera.position);
          onCameraChange({ position: activeCamera.position.clone(), quaternion: activeCamera.quaternion.clone() });
        }
      }
      stats.update();

      const cameraState = cameraStateRef.current;

      // Animate camera angles if needed
      if (cameraState.isAnimating) {
        const lerpSpeed = 0.1;
        const thetaDiff = cameraState.targetTheta - cameraState.theta;
        const phiDiff = cameraState.targetPhi - cameraState.phi;
        
        cameraState.theta += thetaDiff * lerpSpeed;
        cameraState.phi += phiDiff * lerpSpeed;
        
        // Stop animating when close enough
        if (Math.abs(thetaDiff) < 0.001 && Math.abs(phiDiff) < 0.001) {
          cameraState.theta = cameraState.targetTheta;
          cameraState.phi = cameraState.targetPhi;
          cameraState.isAnimating = false;
        }
      }

      // Update camera position based on type
      if (activeCamera instanceof THREE.PerspectiveCamera) {
        // Update perspective camera position based on spherical coordinates
        const sin_phi = Math.sin(cameraState.phi);
        const cos_phi = Math.cos(cameraState.phi);
        const orbitOffset = (sceneSettingsRef.current.cameraOrbitSpeed || 0) * (currentFrameRef.current / 24) * (Math.PI / 180);
        const effectiveTheta = cameraState.theta + orbitOffset;
        const sin_theta = Math.sin(effectiveTheta);
        const cos_theta = Math.cos(effectiveTheta);

        orbitTarget.set(0, 0, 0);
        if (isDraggingTransformRef.current && dragOrbitTargetRef.current) {
          orbitTarget.copy(dragOrbitTargetRef.current);
        } else {
          orbitTarget.x += cameraState.viewOffsetX;
          orbitTarget.y += cameraState.viewOffsetY;
          orbitTarget.z += cameraState.viewOffsetZ;
        }

        activeCamera.position.x = orbitTarget.x + cameraState.radius * sin_phi * sin_theta;
        activeCamera.position.y = orbitTarget.y + cameraState.radius * cos_phi;
        activeCamera.position.z = orbitTarget.z + cameraState.radius * sin_phi * cos_theta;

        activeCamera.lookAt(orbitTarget.x, orbitTarget.y, orbitTarget.z);
      } else if (activeCamera instanceof THREE.OrthographicCamera) {
        // Update orthographic camera - apply pan offsets
        const basePos = new THREE.Vector3();
        const lookAtPos = new THREE.Vector3();
        
        // Get base position and direction based on view mode
        if (viewMode === 'x') {
          basePos.set(sceneExtent * 0.75, 0, 0);
        } else if (viewMode === 'y') {
          basePos.set(0, sceneExtent * 0.75, 0);
        } else if (viewMode === 'z') {
          basePos.set(0, 0, sceneExtent * 0.75);
        }
        
        // Apply pan offsets
        const offsetX = cameraState.viewOffsetX;
        const offsetY = cameraState.viewOffsetY;
        const offsetZ = cameraState.viewOffsetZ;
        
        basePos.x += offsetX;
        basePos.y += offsetY;
        basePos.z += offsetZ;
        
        lookAtPos.set(offsetX, offsetY, offsetZ);
        
        activeCamera.position.copy(basePos);
        activeCamera.lookAt(lookAtPos);
      }

      const getParticleTexture = (particleType: ParticleVisualType, customGlow: boolean) => {
        const textureType = particleType === 'dots' && !customGlow ? 'circles' : particleType;
        const key = `${textureType}:${customGlow ? '1' : '0'}`;
        const cached = particleTextureCache.get(key);
        if (cached) return cached;

        // High-res for glow types, standard for simple shapes
        const isGlowType = textureType === 'glow-circles' || textureType === 'stars' || textureType === 'sparkle' || textureType === 'glitter';
        const size = isGlowType ? 256 : 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        ctx.clearRect(0, 0, size, size);
        const C = size / 2; // center
        const R = size * 0.45; // max radius

        // ── Shared helpers ────────────────────────────────────────────────
        const radGrad = (r0: number, r1: number, stops: [number, string][]) => {
          const g = ctx.createRadialGradient(C, C, r0, C, C, r1);
          stops.forEach(([t, c]) => g.addColorStop(t, c));
          return g;
        };
        const fillSpike = (angleRad: number, widthScale: number, lengthScale: number) => {
          // Draw a very narrow spike rotated to angleRad
          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, R * lengthScale);
          grad.addColorStop(0,   'rgba(255,255,255,1.0)');
          grad.addColorStop(0.12,'rgba(255,255,255,0.98)');
          grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
          grad.addColorStop(0.8, 'rgba(255,255,255,0.12)');
          grad.addColorStop(1,   'rgba(255,255,255,0)');
          ctx.save();
          ctx.translate(C, C);
          ctx.rotate(angleRad);
          ctx.scale(widthScale, lengthScale);
          ctx.beginPath();
          ctx.arc(0, 0, R, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.restore();
        };

        if (textureType === 'glow-circles') {
          // ── Premium Bloom bokeh circle: 3 concentric gradient layers ──────────
          // Layer 1 – super wide, very soft halo for deep bloom
          ctx.fillStyle = radGrad(0, R, [
            [0,    'rgba(255,255,255,1.0)'],
            [0.15, 'rgba(255,255,255,0.85)'],
            [0.35, 'rgba(255,255,255,0.45)'],
            [0.65, 'rgba(255,255,255,0.15)'],
            [1.0,  'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);
          // Layer 2 – bright mid corona (additive blend)
          if (customGlow) ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = radGrad(0, R * 0.45, [
            [0,   'rgba(255,255,255,1.0)'],
            [0.4, 'rgba(255,255,255,0.7)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);
          // Layer 3 – intense hot white core
          ctx.fillStyle = radGrad(0, R * 0.15, [
            [0,   'rgba(255,255,255,1.0)'],
            [0.6, 'rgba(255,255,255,0.95)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else if (textureType === 'stars') {
          // ── 4-point starburst lens flare (enhanced) ──────────────────────────────
          // Background bloom halo
          ctx.fillStyle = radGrad(0, R, [
            [0,   'rgba(255,255,255,0.80)'],
            [0.2, 'rgba(255,255,255,0.45)'],
            [0.55, 'rgba(255,255,255,0.15)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);
          if (customGlow) ctx.globalCompositeOperation = 'lighter';
          // 4 primary cross spikes – slightly thicker & longer
          fillSpike(0,           0.065, 1.7);
          fillSpike(Math.PI / 2, 0.065, 1.7);
          // 4 diagonal secondary spikes – shorter
          fillSpike(Math.PI / 4,       0.035, 1.15);
          fillSpike(Math.PI * 3 / 4,   0.035, 1.15);
          // Bright, sharp core
          ctx.fillStyle = radGrad(0, R * 0.18, [
            [0,   'rgba(255,255,255,1.0)'],
            [0.5, 'rgba(255,255,255,0.9)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else if (textureType === 'sparkle') {
          // ── 8-point lens-flare sparkle (enhanced dynamic range) ────────────
          // Massive bloom aura
          ctx.fillStyle = radGrad(0, R, [
            [0,    'rgba(255,255,255,0.9)'],
            [0.15, 'rgba(255,255,255,0.65)'],
            [0.4,  'rgba(255,255,255,0.25)'],
            [0.75, 'rgba(255,255,255,0.08)'],
            [1.0,  'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);
          ctx.globalCompositeOperation = 'lighter';
          // 4 extra-long primary spikes
          fillSpike(0,              0.040, 2.0);
          fillSpike(Math.PI / 2,    0.040, 2.0);
          // 4 medium diagonal spikes
          fillSpike(Math.PI / 4,         0.028, 1.35);
          fillSpike(Math.PI * 3 / 4,     0.028, 1.35);
          // 4 short tertiary spikes
          fillSpike(Math.PI / 8,         0.018, 0.85);
          fillSpike(Math.PI * 3 / 8,     0.018, 0.85);
          fillSpike(Math.PI * 5 / 8,     0.018, 0.85);
          fillSpike(Math.PI * 7 / 8,     0.018, 0.85);
          // Chromatic inner halo
          ctx.fillStyle = radGrad(0, R * 0.35, [
            [0,   'rgba(255,255,255,1.0)'],
            [0.4, 'rgba(255,255,255,0.8)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);
          // Blinding PIN/core
          ctx.fillStyle = radGrad(0, R * 0.08, [
            [0,   'rgba(255,255,255,1.0)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else if (textureType === 'sprites' || textureType === '3d-model' || textureType === 'volumetric-fire') {
          ctx.fillStyle = radGrad(0, R * 1.1, [
            [0,    'rgba(255,255,255,1.0)'],
            [0.25, 'rgba(255,255,255,0.98)'],
            [0.6,  'rgba(255,255,255,0.6)'],
            [1,    'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else if (customGlow) {
          // simple dots / circles with glow enabled → dense bloom version
          ctx.fillStyle = radGrad(0, R, [
            [0,    'rgba(255,255,255,1.0)'],
            [0.2,  'rgba(255,255,255,0.85)'],
            [0.5,  'rgba(255,255,255,0.4)'],
            [0.8,  'rgba(255,255,255,0.1)'],
            [1,    'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, size, size);

        } else {
          // plain crisp dot, softened edge for AA
          ctx.beginPath();
          ctx.arc(C, C, R * 0.82, 0, Math.PI * 2);
          ctx.fillStyle = radGrad(0, R * 0.82, [
            [0,   'rgba(255,255,255,1.0)'],
            [0.85, 'rgba(255,255,255,0.98)'],
            [1,   'rgba(255,255,255,0)'],
          ]);
          ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        particleTextureCache.set(key, texture);
        return texture;
      };

      const setParticleSize = (mesh: THREE.Points | THREE.Sprite, size: number, flipX: boolean = false) => {
        if (mesh instanceof THREE.Points) {
          const material = mesh.material as THREE.PointsMaterial;
          material.size = size;
        } else {
          const spriteScale = Math.max(0.05, size * 4);
          mesh.scale.set(flipX ? -spriteScale : spriteScale, spriteScale, spriteScale);
        }
      };

      const getParticleMaterial = (mesh: THREE.Points | THREE.Sprite) => {
        if (mesh instanceof THREE.Points) {
          return mesh.material as THREE.PointsMaterial;
        }
        return mesh.material as THREE.SpriteMaterial;
      };

      const getParticleRotation = (mesh: THREE.Points | THREE.Sprite) => {
        if (mesh instanceof THREE.Sprite) {
          return (mesh.material as THREE.SpriteMaterial).rotation;
        }
        return mesh.rotation.z;
      };

      const getParticleSize = (mesh: THREE.Points | THREE.Sprite) => {
        if (mesh instanceof THREE.Points) {
          return (mesh.material as THREE.PointsMaterial).size;
        }
        return Math.abs(mesh.scale.x) / 4;
      };

      const setParticleRotation = (mesh: THREE.Points | THREE.Sprite, rotation: number) => {
        if (mesh instanceof THREE.Sprite) {
          (mesh.material as THREE.SpriteMaterial).rotation = rotation;
        } else {
          mesh.rotation.z = rotation;
        }
      };

      const getPreviewedParticleType = (particleType: ParticleVisualType): ParticleVisualType => {
        const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
        return isWhiteDotPreview ? 'dots' : particleType;
      };

      const getPreviewedParticleColor = (color: string) => {
        const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
        return isWhiteDotPreview ? '#ffffff' : color;
      };

      const getPreviewedParticleSize = (size: number) => {
        const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
        const previewDotSize = Math.max(0.2, Number(sceneSettingsRef.current.particlePreviewSize ?? 1.2));
        return isWhiteDotPreview ? previewDotSize : size;
      };

      const getPreviewedGlow = (customGlow: boolean) => {
        const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
        return isWhiteDotPreview ? false : customGlow;
      };

      const getExternalSpriteTexture = (dataUrl: string) => {
        const cached = spriteTextureCache.get(dataUrl);
        if (cached) {
          return cached;
        }

        const texture = textureLoader.load(dataUrl);
        texture.colorSpace = THREE.SRGBColorSpace;
        spriteTextureCache.set(dataUrl, texture);
        return texture;
      };

      const resolveSpriteTexture = (imageDataUrl: string, sequenceDataUrls: string[], age: number, fps: number = 12, mode: string = 'loop', particleLifetime: number = 1, trackId: number = 0) => {
          const validSequence = Array.isArray(sequenceDataUrls)
            ? sequenceDataUrls.filter((url) => typeof url === 'string' && url.length > 0)
            : [];

          if (validSequence.length > 0) {
            let frameIndex = 0;
            if (mode === 'random-static') {
               frameIndex = Math.abs(trackId * 2654435761) % validSequence.length;
            } else if (mode === 'match-life') {
               let progress = Math.max(0, age) / Math.max(0.001, particleLifetime);
               if (progress > 0.999) progress = 0.999;
               frameIndex = Math.floor(progress * validSequence.length);
            } else {
               const sequenceFps = fps;
               frameIndex = Math.floor(Math.max(0, age) * sequenceFps) % validSequence.length;
            }
            return getExternalSpriteTexture(validSequence[frameIndex]);
          }

          if (imageDataUrl && imageDataUrl.length > 0) {
            return getExternalSpriteTexture(imageDataUrl);
          }

          return undefined;
        };

      const createParticleMesh = (
          position: THREE.Vector3,
          color = '#ffffff',
          size = 3,
          opacity = 1,
          particleType: ParticleVisualType = 'dots',
          customGlow = false,
          rotation = 0,
          spriteTexture?: THREE.Texture,
          pivotX: number = 0.5,
          pivotY: number = 0.5,
          flipX: boolean = false,
          blendMode: string = 'normal'
      ) => {
        const resolvedParticleType = (particleType ?? 'dots') as ParticleVisualType;
        const shouldUseSprite = resolvedParticleType === 'circles' || resolvedParticleType === 'glow-circles' || resolvedParticleType === 'sparkle' || resolvedParticleType === 'glitter' || resolvedParticleType === 'sprites' || resolvedParticleType === '3d-model' || resolvedParticleType === 'stars' || resolvedParticleType === 'volumetric-fire';
        const texture = getParticleTexture(resolvedParticleType, customGlow);

        if (shouldUseSprite) {
          let baseMap = (resolvedParticleType === 'sprites' || resolvedParticleType === '3d-model' || resolvedParticleType === 'volumetric-fire') && spriteTexture ? spriteTexture : texture;
          if (baseMap && flipX) {
            baseMap = baseMap.clone();
            baseMap.repeat.x = -1;
            baseMap.offset.x = 1;
            baseMap.needsUpdate = true;
          }

          const spriteMaterial = new THREE.SpriteMaterial({
            color: new THREE.Color(color),
            map: baseMap,
            transparent: true,
            opacity,
            depthWrite: !customGlow,
            blending: blendMode === 'lighter' || blendMode === 'screen' ? THREE.AdditiveBlending : (customGlow ? THREE.AdditiveBlending : THREE.NormalBlending),
          });
          const sprite = new THREE.Sprite(spriteMaterial);
          sprite.position.copy(position);
          sprite.center.set(flipX ? 1.0 - pivotX : pivotX, pivotY);
          setParticleSize(sprite, size, flipX);
          setParticleRotation(sprite, rotation);
          sprite.visible = sceneSettingsRef.current.showParticles ?? true;
          return sprite;
        }

        const particlesGeometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([0, 0, 0]);
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

        const particlesMaterial = new THREE.PointsMaterial({
          color: new THREE.Color(color),
          size,
          map: texture,
          alphaTest: texture ? 0.01 : 0,
          transparent: true,
          opacity,
          depthWrite: !customGlow,
          blending: blendMode === 'lighter' || blendMode === 'screen' ? THREE.AdditiveBlending : (customGlow ? THREE.AdditiveBlending : THREE.NormalBlending),
        });

        const particleMesh = new THREE.Points(particlesGeometry, particlesMaterial);
        particleMesh.position.copy(position);
        setParticleRotation(particleMesh, rotation);
        particleMesh.visible = sceneSettingsRef.current.showParticles ?? true;
        return particleMesh;
      };

      const reportCacheCount = () => {
        const next = particleFrameCacheRef.current.size;
        if (next !== cacheCountRef.current) {
          cacheCountRef.current = next;
          onCacheFrameCountChange?.(next);
        }
      };

      const captureParticleFrame = (frame: number) => {
        const snapshot: CachedParticleState[] = [];

        particleSystemsRef.current.forEach((particleSystem, emitterId) => {
          particleSystem.particles.forEach((particle) => {
            const material = getParticleMaterial(particle.mesh);
            snapshot.push({
              emitterId,
              trackId: particle.trackId,
              position: {
                x: particle.mesh.position.x,
                y: particle.mesh.position.y,
                z: particle.mesh.position.z,
              },
              velocity: {
                x: particle.velocity.x,
                y: particle.velocity.y,
                z: particle.velocity.z,
              },
              lifetime: particle.lifetime,
              age: particle.age,
              opacity: material.opacity,
              rotation: getParticleRotation(particle.mesh),
              size: particle.baseSize ?? getParticleSize(particle.mesh),
            });
          });
        });

        particleFrameCacheRef.current.set(frame, snapshot);
        reportCacheCount();
      };

      const clearAllParticles = () => {
        particleSystemsRef.current.forEach((particleSystem) => {
          particleSystem.particles.forEach((particle) => scene.remove(particle.mesh));
          particleSystem.particles = [];
        });
      };

      const restoreParticleFrame = (frame: number) => {
        const snapshot = particleFrameCacheRef.current.get(frame);
        if (!snapshot) return false;

        clearAllParticles();

        snapshot.forEach((cached) => {
          const particleSystem = particleSystemsRef.current.get(cached.emitterId);
          if (!particleSystem) return;

          // Look up emitter to get current particle properties
          const emitter = sceneObjectsRef.current.find(obj => obj.id === cached.emitterId);
          const emitterProps = emitter && emitter.type === 'Emitter' ? ((emitter.properties ?? {}) as Record<string, any>) : {};
          const emitterColor = emitter && emitter.type === 'Emitter' ? emitterProps.particleColor ?? '#ffffff' : '#ffffff';
          const emitterSize = emitter && emitter.type === 'Emitter' ? emitterProps.particleSize ?? 0.8 : 0.8;
          const emitterOpacity = emitter && emitter.type === 'Emitter' ? emitterProps.particleOpacity ?? 1 : cached.opacity;
          const restoredSize = Number(cached.size ?? emitterSize);
          const emitterParticleType = emitter && emitter.type === 'Emitter'
            ? (emitterProps.particleType ?? 'dots') as ParticleVisualType
            : 'dots';
          const emitterGlow = emitter && emitter.type === 'Emitter'
            ? Boolean(emitterProps.particleGlow ?? false)
            : false;
          const emitterRotationSpeed = emitter && emitter.type === 'Emitter'
            ? Number(emitterProps.particleRotationSpeed ?? 0)
            : 0;
          const emitterRotationSpeedVariation = emitter && emitter.type === 'Emitter'
            ? Number(emitterProps.particleRotationSpeedVariation ?? 0)
            : 0;
          const emitterSpriteImageDataUrl = emitter && emitter.type === 'Emitter'
            ? String(emitterProps.particleSpriteImageDataUrl ?? '')
            : '';
          const seqProps = emitter && emitter.type === 'Emitter' ? getResampledSequenceProps(emitterProps, sceneSettingsRef.current.particleSequenceBudget, sceneSettingsRef.current.particleSequenceBudgetLoop) : { urls: [], fps: 12 };
          const emitterSpriteSequenceDataUrls = seqProps.urls;
          const emitterSpriteSequenceFps = seqProps.fps;
          const restoredSpeedMultiplier = 1 - emitterRotationSpeedVariation * 0.5 + Math.random() * emitterRotationSpeedVariation;
          const restoredSpriteTexture = (emitterParticleType === 'sprites' || emitterParticleType === '3d-model' || emitterParticleType === 'volumetric-fire')
            ? resolveSpriteTexture(emitterSpriteImageDataUrl, emitterSpriteSequenceDataUrls, cached.age, emitterSpriteSequenceFps, String(emitterProps.particleSpriteSequenceMode ?? 'loop'), Number(emitterProps.particleLifetime ?? 3), cached.trackId)
            : undefined;
          const previewedType = getPreviewedParticleType(emitterParticleType);
          const previewedColor = getPreviewedParticleColor(emitterColor);
          const previewedSize = getPreviewedParticleSize(restoredSize);
          const previewedGlow = getPreviewedGlow(emitterGlow);

          const particleBlendMode = emitterProps.particleBlendMode || 'normal';
          const particleMesh = createParticleMesh(
            new THREE.Vector3(cached.position.x, cached.position.y, cached.position.z),
            previewedColor,
            previewedSize,
            emitterOpacity,
            previewedType,
            previewedGlow,
            cached.rotation,
            (previewedType === 'sprites' || previewedType === '3d-model') ? restoredSpriteTexture : undefined,
            0.5,
            0.5,
            false,
            particleBlendMode
          );

          const particleFlipXChance = Number(emitterProps.particleHorizontalFlipChance ?? 0);
                const flipX = Math.random() < particleFlipXChance;
                scene.add(particleMesh);
                particleSystem.particles.push({
            trackId: cached.trackId ?? 0, // Restore the bone/track ID for Spine export
            mesh: particleMesh,
            velocity: new THREE.Vector3(cached.velocity.x, cached.velocity.y, cached.velocity.z),
            lifetime: cached.lifetime,
            age: cached.age,
            particleType: emitterParticleType,
            customGlow: emitterGlow,
            rotation: cached.rotation,
            rotationOffset: 0,
            rotationVariation: 0,
            rotationSpeed: emitterRotationSpeed * restoredSpeedMultiplier,
            rotationSpeedMultiplier: restoredSpeedMultiplier,
            rotationSpeedVariation: emitterRotationSpeedVariation,
            baseSize: restoredSize,
            sizeMultiplier: emitterSize > 0 ? (restoredSize / emitterSize) : 1,
            spriteImageDataUrl: emitterSpriteImageDataUrl,
            spriteSequenceDataUrls: emitterSpriteSequenceDataUrls,
            positionHistory: [new THREE.Vector3(cached.position.x, cached.position.y, cached.position.z)],
          });
        });

        particleSystemsRef.current.forEach((particleSystem) => {
          particleSystem.lastEmit = Date.now();
        });

        return true;
      };

      const now = Date.now();
      const frameDeltaTime = Math.min((now - lastFrameTimeRef.current) / 1000, 0.1);
      lastFrameTimeRef.current = now;

      // ── Path Animation ──────────────────────────────────────────────────────
      if (isPlayingRef.current) {
        sceneObjectsRef.current.forEach(obj => {
          const props = (obj.properties ?? {}) as Record<string, any>;
          const pathId = props.pathAnimPathId as string | undefined;
          if (!pathId) return;
          const mesh = sceneObjectMeshesRef.current.get(obj.id);
          if (!mesh) return;

          const speed = Number(props.pathAnimSpeed ?? 0.1);
          const loop = props.pathAnimLoop !== false; // default: loop
          const orient = !!props.pathAnimOrient;
          const alignUp = !!props.pathAnimAlignUp;
          const twistDeg = Number(props.pathAnimTwist ?? 0);
          const falloffStart = Math.min(0.9999, Number(props.pathAnimFalloff ?? 100) / 100);
          // falloffStart = 1.0 means no falloff (slider at 100%)

          // Build CatmullRom curve from the path's PathPoint children
          const pathPointObjs = sceneObjectsRef.current.filter(
            o => o.type === 'PathPoint' && o.parentId === pathId
          );
          if (pathPointObjs.length < 2) return;
          const pts = pathPointObjs.map(p => {
            const pm = sceneObjectMeshesRef.current.get(p.id);
            return pm
              ? pm.position.clone()
              : new THREE.Vector3(p.position.x, p.position.y, p.position.z);
          });

          const curve = new THREE.CatmullRomCurve3(pts, loop);

          // Advance normalised parameter t
          let t = pathAnimTimesRef.current.get(obj.id) ?? 0;
          t += speed * frameDeltaTime;
          if (loop) {
            t = t % 1;
            if (t < 0) t = 1 + t;
          } else {
            t = Math.min(t, 0.9999);
          }
          pathAnimTimesRef.current.set(obj.id, t);

          // When loop resets clear free-state so momentum restarts cleanly
          const prevT = pathAnimTimesRef.current.get(obj.id + '_prev') ?? t;
          pathAnimTimesRef.current.set(obj.id + '_prev', t);
          if (t < prevT) pathAnimFreeStateRef.current.delete(obj.id);

          const pathPos = curve.getPointAt(t);

          // ── Falloff: after falloffStart, object leaves path with momentum ──
          let adherence = 1.0;
          if (falloffStart < 0.9999) {
            if (t <= falloffStart) {
              adherence = 1.0;
              // Keep free-state in sync with path so release is smooth
              const seg0 = curve.getPointAt(Math.max(0, t - 0.001));
              const seg1 = curve.getPointAt(Math.min(0.9999, t + 0.001));
              const pathVel = seg1.clone().sub(seg0).normalize().multiplyScalar(
                speed * (curve.getLength() / Math.max(0.0001, 0.002))
              );
              pathAnimFreeStateRef.current.set(obj.id, { pos: pathPos.clone(), vel: pathVel });
            } else {
              adherence = 1 - (t - falloffStart) / (1 - falloffStart);
              const free = pathAnimFreeStateRef.current.get(obj.id);
              if (!free) {
                const seg0 = curve.getPointAt(Math.max(0, falloffStart - 0.001));
                const seg1 = curve.getPointAt(Math.min(0.9999, falloffStart + 0.001));
                const pathVel = seg1.clone().sub(seg0).normalize().multiplyScalar(
                  speed * (curve.getLength() / Math.max(0.0001, 0.002))
                );
                pathAnimFreeStateRef.current.set(obj.id, { pos: pathPos.clone(), vel: pathVel });
              } else {
                free.pos.addScaledVector(free.vel, frameDeltaTime);
              }
              const freePos = pathAnimFreeStateRef.current.get(obj.id)!.pos;
              pathPos.lerp(freePos, 1 - adherence);
            }
          }

          const pos = pathPos;
          mesh.position.copy(pos);

          if (orient) {
            const tangent = curve.getTangentAt(t).normalize();
            if (alignUp) {
              // Full free-roll: align Z-forward to tangent, derive up from path curvature
              const p0 = curve.getPointAt(Math.max(0, t - 0.001));
              const p2 = curve.getPointAt(Math.min(0.9999, t + 0.01));
              const curveUp = new THREE.Vector3().subVectors(p2, p0).normalize();
              const right = new THREE.Vector3().crossVectors(curveUp, tangent).normalize();
              const up2 = new THREE.Vector3().crossVectors(tangent, right).normalize();
              const m = new THREE.Matrix4().makeBasis(right, up2, tangent);
              mesh.quaternion.setFromRotationMatrix(m);
            } else {
              // Keep world-Y up, only yaw to face tangent direction
              const worldUp = new THREE.Vector3(0, 1, 0);
              const right = new THREE.Vector3().crossVectors(worldUp, tangent);
              if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
              right.normalize();
              const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
              const m = new THREE.Matrix4().makeBasis(right, up, tangent);
              mesh.quaternion.setFromRotationMatrix(m);
            }
            // Apply twist: rotate around tangent (forward) axis by twistDeg * t
            if (twistDeg !== 0) {
              const tangent2 = curve.getTangentAt(t).normalize();
              const twistQuat = new THREE.Quaternion().setFromAxisAngle(
                tangent2,
                (twistDeg * t * Math.PI) / 180
              );
              mesh.quaternion.premultiply(twistQuat);
            }
            mesh.rotation.setFromQuaternion(mesh.quaternion);
          } else if (twistDeg !== 0) {
            // Orient not enabled but twist still applies — rotate around tangent from current orientation
            const tangent2 = curve.getTangentAt(t).normalize();
            const twistQuat = new THREE.Quaternion().setFromAxisAngle(
              tangent2,
              (twistDeg * t * Math.PI) / 180
            );
            mesh.quaternion.premultiply(twistQuat);
            mesh.rotation.setFromQuaternion(mesh.quaternion);
          }

          // Keep selection outline + handles in sync
          if (selectedObjectIdRef.current === obj.id && sceneRef.current) {
            const outline = sceneRef.current.getObjectByName('selection-outline');
            if (outline) outline.position.copy(pos);
            const handles = sceneRef.current.getObjectByName('transform-handles');
            if (handles) handles.position.copy(pos);
          }
        });
      }
      // ── End Path Animation ──────────────────────────────────────────────────
      const timelineFrame = Math.max(0, Math.floor(currentFrameRef.current));
      const previousTimelineFrame = lastTimelineFrameRef.current;
      const frameChanged = timelineFrame !== previousTimelineFrame;
      const restoredFromCache = frameChanged && restoreParticleFrame(timelineFrame);

      if (!restoredFromCache) {
        let globalActiveParticles = 0;
        particleSystemsRef.current.forEach((system) => {
          globalActiveParticles += system.particles.length;
        });
        const particleBudget = sceneSettingsRef.current.particleBudget ?? 500;

        sceneObjectsRef.current.forEach(obj => {
          if (obj.type === 'Emitter') {
            const emitter = obj as EmitterObject;
            const particleSystem = particleSystemsRef.current.get(obj.id);
            const emitterMesh = sceneObjectMeshesRef.current.get(obj.id);
            
            if (particleSystem && emitterMesh) {
              const emitterProps = (emitter.properties ?? {}) as Record<string, any>;
              const timeSinceLastEmit = now - particleSystem.lastEmit;
              const emissionRate = Number(emitterProps.emissionRate ?? 100);
              const rawSafeEmissionRate = Number.isFinite(emissionRate) && emissionRate > 0 ? emissionRate : 100;
              
              const totalEmitters = Array.from(sceneObjectsRef.current.values()).filter(o => o.type === 'Emitter').length || 1;
              const isAdaptive = sceneSettingsRef.current.adaptiveEmission !== false;
              
              const emitterLifetimeBase = Number(emitterProps.particleLifetime ?? 3);
              const maxContinuousEmission = (particleBudget / totalEmitters) / Math.max(0.1, emitterLifetimeBase);
              const safeEmissionRate = isAdaptive ? Math.min(rawSafeEmissionRate, maxContinuousEmission) : rawSafeEmissionRate;
              const emissionInterval = 1000 / safeEmissionRate;

              // Use connected shapes as emission sources if available, otherwise just use the emitter itself
              const childShapes = Array.from(sceneObjectsRef.current.values()).filter(o =>
                  o.parentId === obj.id && o.type !== 'PathPoint' && o.type !== 'Emitter' && o.type !== 'Force'
                );
              const activeSources = childShapes.length > 0 ? childShapes : [obj];
              // Dynamic sourceExtent placeholder — computed per-source below

              // Emit new particles when playing or actively caching
              const isUnderBudget = globalActiveParticles < particleBudget;

              if (isUnderBudget && (isPlayingRef.current || isCachingRef.current || sceneSettingsRef.current.particleLivePreview) && timeSinceLastEmit >= emissionInterval && activeSources.length > 0 && (timelineFrame >= timelineInRef.current || sceneSettingsRef.current.particleLivePreview)) {
                // Keep budget tracked correctly if multiple particles spawn across different emitters in the same frame
                globalActiveParticles++;
                
                const sourceNode = activeSources[Math.floor(Math.random() * activeSources.length)];
                const sourceProps = (sourceNode.properties ?? {}) as Record<string, any>;
                  let emitterType = sourceNode.id === obj.id
                    ? (sourceProps.emitterType ?? 'point')   // standalone emitter: use its own setting
                    : 'mesh_bounds';                          // child shape fallback: bounding box
                  if (sourceNode.type === 'Path') emitterType = 'curve';
                  else if (sourceNode.type === 'Cube' || sourceNode.type === 'Box') emitterType = 'cube';
                  else if (sourceNode.type === 'Sphere' || sourceNode.type === 'Torus') emitterType = 'ball';
                  else if (sourceNode.type === 'Cylinder' || sourceNode.type === 'Cone') emitterType = 'ball';
                  else if (sourceNode.type === 'Plane' || sourceNode.type === 'Rectangle') emitterType = 'square';
                  else if (sourceNode.type === 'Circle') emitterType = 'circle';
                  else if (sourceNode.id === obj.id) emitterType = sourceProps.emitterType ?? 'point'; // own emitter type
                const emissionMode = sourceProps.emissionMode ?? emitterProps.emissionMode ?? 'volume';
                const isSurfaceMode = emissionMode === 'surface';
                const isEdgeMode = emissionMode === 'edge';
                const sourceMesh = sceneObjectMeshesRef.current.get(sourceNode.id) ?? emitterMesh;
                const localOffset = new THREE.Vector3(0, 0, 0);
                const localNormal = new THREE.Vector3(0, 1, 0);

                // Compute local-space half-extents from the source mesh geometry
                let seX = 25, seY = 25, seZ = 25;
                if (sourceNode.id !== obj.id) {
                  const geom = (sourceMesh as THREE.Mesh)?.geometry;
                  if (geom) {
                    if (!geom.boundingBox) geom.computeBoundingBox();
                    const bb = geom.boundingBox;
                    if (bb) {
                      const ex = (bb.max.x - bb.min.x) / 2;
                      const ey = (bb.max.y - bb.min.y) / 2;
                      const ez = (bb.max.z - bb.min.z) / 2;
                      // Only use computed extents if non-zero; keep default otherwise
                      if (ex > 0) seX = ex;
                      if (ey > 0) seY = ey;
                      if (ez > 0) seZ = ez;
                    }
                  }
                }
                const sourceExtent = Math.max(seX, seY, seZ);

                if (emitterType === 'circle') {
                  const angle = Math.random() * Math.PI * 2;
                  if (isEdgeMode) {
                    localOffset.set(Math.cos(angle) * sourceExtent, 0, Math.sin(angle) * sourceExtent);
                  } else if (isSurfaceMode) {
                    // Emit uniformly across full disk area
                    const radius = Math.sqrt(Math.random()) * sourceExtent;
                    localOffset.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
                  } else {
                    // Emit from entire disk
                    const radius = Math.sqrt(Math.random()) * sourceExtent;
                    localOffset.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
                  }
                  localNormal.set(0, 1, 0);
                } else if (emitterType === 'square') {
                  if (isEdgeMode) {
                    const side = Math.floor(Math.random() * 4);
                    const t = (Math.random() * 2 - 1) * sourceExtent;
                    if (side === 0) localOffset.set(t, 0, sourceExtent);
                    else if (side === 1) localOffset.set(t, 0, -sourceExtent);
                    else if (side === 2) localOffset.set(sourceExtent, 0, t);
                    else localOffset.set(-sourceExtent, 0, t);
                  } else if (isSurfaceMode) {
                    // Emit uniformly across full square area
                    localOffset.set(
                      (Math.random() * 2 - 1) * sourceExtent,
                      0,
                      (Math.random() * 2 - 1) * sourceExtent
                    );
                  } else {
                    // Emit from entire square
                    localOffset.set(
                      (Math.random() * 2 - 1) * sourceExtent,
                      0,
                      (Math.random() * 2 - 1) * sourceExtent
                    );
                  }
                  localNormal.set(0, 1, 0);
                } else if (emitterType === 'cube') {
                    if (isEdgeMode) {
                      // 12 edges of the bounding box
                      const edge = Math.floor(Math.random() * 12);
                      const tx = (Math.random() * 2 - 1) * seX;
                      const ty = (Math.random() * 2 - 1) * seY;
                      const tz = (Math.random() * 2 - 1) * seZ;
                      const signs = [
                        [seY, seZ], [seY, -seZ], [-seY, seZ], [-seY, -seZ]
                      ];
                      const sgn = signs[edge % 4];
                      if (edge < 4) { // X-axis parallel edges
                        localOffset.set(tx, sgn[0], sgn[1]);
                      } else if (edge < 8) { // Y-axis parallel edges
                        localOffset.set(sgn[0], ty, sgn[1]);
                      } else { // Z-axis parallel edges
                        localOffset.set(sgn[0], sgn[1], tz);
                      }
                      localNormal.copy(localOffset).normalize();
                    } else if (isSurfaceMode) {
                      // Weight faces by actual face area (seY*seZ for ±X, etc.)
                      const areaX = seY * seZ;
                      const areaY = seX * seZ;
                      const areaZ = seX * seY;
                      const totalArea = 2 * (areaX + areaY + areaZ);
                      const pick = Math.random() * totalArea;
                      const sign = Math.random() < 0.5 ? -1 : 1;
                      if (pick < 2 * areaX) {
                        localOffset.set(sign * seX, (Math.random() * 2 - 1) * seY, (Math.random() * 2 - 1) * seZ);
                        localNormal.set(sign, 0, 0);
                      } else if (pick < 2 * (areaX + areaY)) {
                        localOffset.set((Math.random() * 2 - 1) * seX, sign * seY, (Math.random() * 2 - 1) * seZ);
                        localNormal.set(0, sign, 0);
                      } else {
                        localOffset.set((Math.random() * 2 - 1) * seX, (Math.random() * 2 - 1) * seY, sign * seZ);
                        localNormal.set(0, 0, sign);
                      }
                  } else {
                    // Emit from entire volume
                    localOffset.set(
                      (Math.random() * 2 - 1) * seX,
                      (Math.random() * 2 - 1) * seY,
                      (Math.random() * 2 - 1) * seZ
                    );
                    if (localOffset.lengthSq() > 1e-6) {
                      localNormal.copy(localOffset).normalize();
                    }
                  }
                } else if (emitterType === 'ball') {
                  if (isSurfaceMode || isEdgeMode) {
                    // Emit uniformly across sphere surface
                    const thetaSurface = Math.random() * Math.PI * 2;
                    const zSurface = Math.random() * 2 - 1;
                    const radialSurface = Math.sqrt(Math.max(0, 1 - zSurface * zSurface));
                    localOffset.set(
                      radialSurface * Math.cos(thetaSurface) * sourceExtent,
                      zSurface * sourceExtent,
                      radialSurface * Math.sin(thetaSurface) * sourceExtent
                    );
                    localNormal.copy(localOffset).normalize();
                  } else {
                    // Emit from entire volume
                    let point = new THREE.Vector3();
                    do {
                      point.set(
                        Math.random() * 2 - 1,
                        Math.random() * 2 - 1,
                        Math.random() * 2 - 1
                      );
                    } while (point.lengthSq() > 1);
                    localOffset.copy(point.multiplyScalar(sourceExtent));
                    if (localOffset.lengthSq() > 1e-6) {
                      localNormal.copy(localOffset).normalize();
                    }
                  }
                } else if (emitterType === 'mesh_bounds') {
                  sourceMesh.updateMatrixWorld(true);
                  let lx = 0, ly = 0, lz = 0;
                  const globalBox = new THREE.Box3().setFromObject(sourceMesh);
                  if (!globalBox.isEmpty()) {
                    const size = new THREE.Vector3();
                    globalBox.getSize(size);
                    const worldX = globalBox.min.x + Math.random() * size.x;
                    const worldY = globalBox.min.y + Math.random() * size.y;
                    const worldZ = globalBox.min.z + Math.random() * size.z;
                    let worldPos = new THREE.Vector3(worldX, worldY, worldZ);
                    if (isEdgeMode || isSurfaceMode) {
                      const c = new THREE.Vector3();
                      globalBox.getCenter(c);
                      const dx = worldX - c.x;
                      const dy = worldY - c.y;
                      const dz = worldZ - c.z;
                      const nx = Math.abs(dx) / (size.x / 2);
                      const ny = Math.abs(dy) / (size.y / 2);
                      const nz = Math.abs(dz) / (size.z / 2);
                      const m = Math.max(nx, ny, nz);
                      if (m === nx) worldPos.x = c.x + Math.sign(dx) * size.x / 2;
                      else if (m === ny) worldPos.y = c.y + Math.sign(dy) * size.y / 2;
                      else worldPos.z = c.z + Math.sign(dz) * size.z / 2;
                    }
                    const smWorldPos = new THREE.Vector3();
                    sourceMesh.getWorldPosition(smWorldPos);
                    const diff = worldPos.clone().sub(smWorldPos);
                    diff.applyEuler(new THREE.Euler(-sourceMesh.rotation.x, -sourceMesh.rotation.y, -sourceMesh.rotation.z));
                    diff.set(diff.x / sourceMesh.scale.x, diff.y / sourceMesh.scale.y, diff.z / sourceMesh.scale.z);
                    lx = diff.x; ly = diff.y; lz = diff.z;
                  }
                  localOffset.set(lx, ly, lz);
                  localNormal.set(0, 1, 0);
                } else if (emitterType === 'point') {
                  localNormal.set(0, -0.5, 1).normalize();
                } else if (emitterType === 'curve' || sourceNode.type === 'Path') {
                  let pts: THREE.Vector3[] = [];
                  if (sourceNode.type === 'Path') {
                    const pathPoints = sceneObjectsRef.current.filter(o => o.type === 'PathPoint' && o.parentId === sourceNode.id);
                    pts = pathPoints.map(p => {
                      const pm = sceneObjectMeshesRef.current.get(p.id);
                      return pm ? pm.position.clone() : new THREE.Vector3(p.position.x, p.position.y, p.position.z);
                    });
                  } else if (sourceProps.points) {
                    pts = sourceProps.points.map((p: any) => new THREE.Vector3(p.x, p.y, p.z));
                  }
                  if (pts.length > 1) {
                    const t = Math.random();
                    const cur = new THREE.CatmullRomCurve3(pts);
                    const pt = cur.getPoint(t);
                    const tang = cur.getTangent(t).normalize();
                    const normal = new THREE.Vector3();
                    if (Math.abs(tang.y) > 0.99) {
                      normal.set(1, 0, 0);
                    } else {
                      normal.set(0, 1, 0);
                    }
                    normal.cross(tang).normalize();
                    localNormal.copy(normal);
                    const smWorldPos = new THREE.Vector3();
                    sourceMesh.getWorldPosition(smWorldPos);
                    const diff = pt.clone().sub(smWorldPos);
                    diff.applyEuler(new THREE.Euler(-sourceMesh.rotation.x, -sourceMesh.rotation.y, -sourceMesh.rotation.z));
                    diff.set(diff.x / sourceMesh.scale.x, diff.y / sourceMesh.scale.y, diff.z / sourceMesh.scale.z);
                    localOffset.set(diff.x, diff.y, diff.z);
                  }
                } else if (emitterType === 'layer') {
                  if (isEdgeMode) {
                    const side = Math.floor(Math.random() * 4);
                    const t = (Math.random() * 2 - 1) * sourceExtent;
                    if (side === 0) localOffset.set(t, 0, sourceExtent);
                    else if (side === 1) localOffset.set(t, 0, -sourceExtent);
                    else if (side === 2) localOffset.set(sourceExtent, 0, t);
                    else localOffset.set(-sourceExtent, 0, t);
                  } else {
                    localOffset.set(
                      (Math.random() * 2 - 1) * sourceExtent,
                      0,
                      (Math.random() * 2 - 1) * sourceExtent
                    );
                  }
                  localNormal.set(0, 1, 0);
                }

                // Determine spawn position.
                // When emitFromSpineAttachmentId is set, sample a random opaque pixel
                // from that attachment's alpha map. If the attachment is not selected,
                // not yet loaded, or all sampled pixels are transparent, fall back to
                // the emitter's own world position so it always emits.
                const _spineEmitId = (emitterProps.emitFromSpineAttachmentId as string | undefined) || '';
                let spawnPosition: THREE.Vector3;
                if (_spineEmitId) {
                  const attMesh = spineAttachmentMeshesRef.current.get(_spineEmitId);
                  const pixData = spineAttachPixelDataRef.current.get(_spineEmitId);
                  let foundSpinePos: THREE.Vector3 | null = null;
                  if (attMesh && pixData) {
                    const { data, w, h } = pixData;
                    for (let _t = 0; _t < 32; _t++) {
                      const su = Math.random(), sv = Math.random();
                      const px = Math.min(Math.floor(su * w), w - 1);
                      const py = Math.min(Math.floor(sv * h), h - 1);
                      if (data[(py * w + px) * 4 + 3] > 10) {
                        const geom = attMesh.geometry as THREE.PlaneGeometry;
                        foundSpinePos = attMesh.localToWorld(
                          new THREE.Vector3(
                            (su - 0.5) * geom.parameters.width,
                            (0.5 - sv) * geom.parameters.height,
                            0
                          )
                        );
                        break;
                      }
                    }
                  }
                  // Fall back to emitter position if attachment not ready / all transparent
                  spawnPosition = foundSpinePos ?? sourceMesh.localToWorld(localOffset.clone());
                } else {
                  // No spine attachment selected — always use original emitter position
                  spawnPosition = sourceMesh.localToWorld(localOffset.clone());
                }

                // Get particle properties from emitter
                const emitterColor = emitterProps.particleColor ?? '#ffffff';
                const emitterSize = emitterProps.particleSize ?? 0.8;
                const emitterOpacity = emitterProps.particleOpacity ?? 1;
                const emitterParticleType = (emitterProps.particleType ?? 'dots') as ParticleVisualType;
                const emitterGlow = Boolean(emitterProps.particleGlow ?? false);
                const emitterRotation = Number(emitterProps.particleRotation ?? 0);
                const emitterRotationVariation = Number(emitterProps.particleRotationVariation ?? 0);
                const emitterRotationSpeed = Number(emitterProps.particleRotationSpeed ?? 0);
                const emitterRotationSpeedVariation = Number(emitterProps.particleRotationSpeedVariation ?? 0);
                const emitterSpriteImageDataUrl = String(emitterProps.particleSpriteImageDataUrl ?? '');
                const seqProps = getResampledSequenceProps(emitterProps, sceneSettingsRef.current.particleSequenceBudget, sceneSettingsRef.current.particleSequenceBudgetLoop);
                const emitterSpriteSequenceDataUrls = seqProps.urls;
                const emitterSpriteSequenceFps = seqProps.fps;
                const emitterColorVariation = emitterProps.particleColorVariation ?? 0;
                const emitterSizeVariation = emitterProps.particleSizeVariation ?? 0;
                
                // Apply variations to color (randomize hue)
                  let particleColor = emitterColor;
                  if (emitterColorVariation > 0) {
                    const c3 = new THREE.Color(emitterColor);
                    const hsl = { h: 0, s: 0, l: 0 };
                    c3.getHSL(hsl);
                    hsl.h = (hsl.h + (Math.random() * 2 - 1) * emitterColorVariation + 1.0) % 1.0;
                    c3.setHSL(hsl.h, hsl.s, hsl.l);
                    particleColor = '#' + c3.getHexString();
                  }
                
                // Apply size variation
                const particleSize = emitterSize * (1 - emitterSizeVariation * 0.5 + Math.random() * emitterSizeVariation);
                const particleRotationOffset = (Math.random() * 2 - 1) * emitterRotationVariation;
                const particleRotation = emitterRotation + particleRotationOffset;
                const particleRotationSpeedMultiplier = 1 - emitterRotationSpeedVariation * 0.5 + Math.random() * emitterRotationSpeedVariation;
                const particleRotationSpeed = emitterRotationSpeed * particleRotationSpeedMultiplier;
                
                // Find lowest available track ID for pooling/Spine export bone reuse
                const activeTracks = new Set<number>();
                particleSystem.particles.forEach(p => activeTracks.add(p.trackId));
                let spawnTrackId = 0;
                while (activeTracks.has(spawnTrackId)) {
                  spawnTrackId++;
                }

                const spawnSpriteTexture = (emitterParticleType === 'sprites' || emitterParticleType === '3d-model')
                  ? resolveSpriteTexture(emitterSpriteImageDataUrl, emitterSpriteSequenceDataUrls, 0, emitterSpriteSequenceFps, String(emitterProps.particleSpriteSequenceMode ?? 'loop'), Number(emitterProps.particleLifetime ?? 3), spawnTrackId)
                  : undefined;
                const previewedType = getPreviewedParticleType(emitterParticleType);
                const previewedColor = getPreviewedParticleColor(particleColor);
                const previewedSize = getPreviewedParticleSize(particleSize);
                const previewedGlow = getPreviewedGlow(emitterGlow);
                
                const particleBlendMode = emitterProps.particleBlendMode || 'normal';
                const particleMesh = createParticleMesh(
                  spawnPosition,
                  previewedColor,
                  previewedSize,
                  emitterOpacity,
                  previewedType,
                  previewedGlow,
                  particleRotation,
                  (previewedType === 'sprites' || previewedType === '3d-model') ? spawnSpriteTexture : undefined,
                  0.5,
                  0.5,
                  false,
                  particleBlendMode
                );
                
                const emitterSpeed = emitterProps.particleSpeed ?? 50;
                const emitterSpeedVariation = emitterProps.particleSpeedVariation ?? 0.2;
                const speed = emitterSpeed * (1 - emitterSpeedVariation * 0.5 + Math.random() * emitterSpeedVariation);
                const configuredSpread = emitterProps.particleSpreadAngle !== undefined ? (emitterProps.particleSpreadAngle / 180) * Math.PI : undefined;
                  const maxSpreadAngle = configuredSpread !== undefined ? configuredSpread : (emitterType === 'point' ? Math.PI : Math.PI * 0.2);

                  const theta = Math.random() * Math.PI * 2;
                  let phi;
                  if (maxSpreadAngle >= Math.PI) {
                    phi = Math.acos(Math.random() * 2 - 1);
                  } else {
                    const cosPhi = 1 - Math.random() * (1 - Math.cos(maxSpreadAngle));
                    phi = Math.acos(cosPhi);
                  }

                const emitterWorldQuaternion = sourceMesh.getWorldQuaternion(new THREE.Quaternion());
                const actualNormal = localNormal.lengthSq() > 1e-6 ? localNormal : DEFAULT_EMISSION_AXIS;
                
                const baseDirection = actualNormal
                  .clone()
                  .applyQuaternion(emitterWorldQuaternion)
                  .normalize();

                const perpVector = new THREE.Vector3(1, 0, 0);
                if (Math.abs(baseDirection.dot(perpVector)) > 0.9) {
                  perpVector.set(0, 1, 0);
                }
                const right = new THREE.Vector3().crossVectors(baseDirection, perpVector).normalize();
                const up = new THREE.Vector3().crossVectors(right, baseDirection).normalize();

                const baseVelocity = new THREE.Vector3()
                  .copy(baseDirection)
                  .multiplyScalar(Math.cos(phi))
                  .addScaledVector(right, Math.sin(phi) * Math.cos(theta))
                  .addScaledVector(up, Math.sin(phi) * Math.sin(theta))
                  .normalize()
                  .multiplyScalar(speed);
                
                const velocity = baseVelocity;

                // Apply lifetime variation
                const emitterLifetime = emitterProps.particleLifetime ?? 3;
                const emitterLifetimeVariation = emitterProps.particleLifetimeVariation ?? 0;
                const particleLifetime = emitterLifetime * (1 - emitterLifetimeVariation * 0.5 + Math.random() * emitterLifetimeVariation);



                const particleFlipXChance = Number(emitterProps.particleHorizontalFlipChance ?? 0);
                const flipX = Math.random() < particleFlipXChance;
                scene.add(particleMesh);
                particleSystem.particles.push({
                  trackId: spawnTrackId,
                  mesh: particleMesh,
                  velocity,
                  lifetime: particleLifetime,
                  age: 0,
                  baseColor: particleColor,
                  baseOpacity: emitterOpacity,
                  baseSize: particleSize,
                  sizeMultiplier: emitterSize > 0 ? (particleSize / emitterSize) : 1,
                  particleType: emitterParticleType,
                  customGlow: emitterGlow,
                  rotation: particleRotation,
                  rotationOffset: particleRotationOffset,
                  rotationVariation: emitterRotationVariation,
                  rotationSpeed: particleRotationSpeed,
                  rotationSpeedMultiplier: particleRotationSpeedMultiplier,
                  rotationSpeedVariation: emitterRotationSpeedVariation,
                  spriteImageDataUrl: emitterSpriteImageDataUrl,
                  spriteSequenceDataUrls: emitterSpriteSequenceDataUrls,
                  opacityOverLife: emitterProps.particleOpacityOverLife ?? false,
                  colorOverLife: emitterProps.particleColorOverLife ?? false,
                  colorOverLifeTarget: emitterProps.particleColorOverLifeTarget ?? '#000000',
                  sizeOverLife: emitterProps.particleSizeOverLife ?? 'none',
                    flipX,
                  positionHistory: [new THREE.Vector3(particleMesh.position.x, particleMesh.position.y, particleMesh.position.z)],
                });
                
                particleSystem.lastEmit = now;
              }
              
              // Flush stale particles when the sprite asset changes so fresh ones spawn with the new texture
              const _newSpriteKey =
                String(emitterProps.particleSpriteImageDataUrl ?? '') +
                (Array.isArray(emitterProps.particleSpriteSequenceDataUrls) && emitterProps.particleSpriteSequenceDataUrls.length > 0
                  ? (emitterProps.particleSpriteSequenceDataUrls[0] ?? '').slice(-32)
                  : '');
              const _prevSpriteKey = emitterSpriteKeyRef.current.get(obj.id) ?? '';
              if (_prevSpriteKey !== '' && _prevSpriteKey !== _newSpriteKey) {
                for (const _p of particleSystem.particles) {
                  scene.remove(_p.mesh);
                  const _pl = _p.mesh.userData.pathLine as THREE.Line;
                  const _pp = _p.mesh.userData.pathPoints as THREE.Group;
                  if (_pl) scene.remove(_pl);
                  if (_pp) scene.remove(_pp);
                }
                particleSystem.particles = [];
              }
              emitterSpriteKeyRef.current.set(obj.id, _newSpriteKey);

              // Update existing particles; movement/lifetime only advance while playing or caching.
              const deltaTime = 0.016; // Approximate 60fps
              for (let i = particleSystem.particles.length - 1; i >= 0; i--) {
                const particle = particleSystem.particles[i];

                if (isPlayingRef.current || isCachingRef.current || sceneSettingsRef.current.particleLivePreview) {
                  particle.age += deltaTime;

                  // Remove dead particles
                  if (particle.age >= particle.lifetime) {
                    scene.remove(particle.mesh);
                    // Clean up path visualization
                    const pathLine = particle.mesh.userData.pathLine as THREE.Line;
                    const pathPoints = particle.mesh.userData.pathPoints as THREE.Group;
                    if (pathLine) scene.remove(pathLine);
                    if (pathPoints) scene.remove(pathPoints);
                    particleSystem.particles.splice(i, 1);
                    continue;
                  }

                  // Apply physics forces
                  const emitterId = obj.id;
                  const affectingForces = physicsForceRef.current.filter(f => f.affectedEmitterIds.includes(emitterId) && f.enabled);
                  
                  if (affectingForces.length > 0) {
                    const particlePos = new THREE.Vector3(particle.mesh.position.x, particle.mesh.position.y, particle.mesh.position.z);
                    
                    affectingForces.forEach(force => {
                      let forcePos = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
                      
                      // For attractor/repulsor, use target shape position if specified
                      if ((force.type === 'attractor' || force.type === 'repulsor') && force.targetShapeId) {
                        const targetShape = sceneObjectsRef.current.find(obj => obj.id === force.targetShapeId);
                        if (targetShape) {
                          forcePos.set(targetShape.position.x, targetShape.position.y, targetShape.position.z);
                        }
                      }
                      
                      const directionToParticle = new THREE.Vector3().subVectors(particlePos, forcePos);
                      const distanceToParticle = directionToParticle.length();
                      
                      switch (force.type) {
                        case 'gravity':
                          particle.velocity.y -= force.strength * 9.8 * deltaTime;
                          break;
                          
                        case 'wind':
                          if (force.direction) {
                            const windDir = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                            particle.velocity.addScaledVector(windDir, force.strength * deltaTime);
                          }
                          break;
                          
                        case 'tornado':
                          if (force.direction) {
                            const tornadoAxis = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                            const radiusFromAxis = new THREE.Vector3().crossVectors(tornadoAxis, directionToParticle);
                            const radius = radiusFromAxis.length();
                            if (radius > 0.1) {
                              radiusFromAxis.normalize();
                              const tangentialVel = radiusFromAxis.clone().multiplyScalar(force.strength * (1 - Math.min(radius / (force.radius || 100), 1)));
                              particle.velocity.add(tangentialVel.multiplyScalar(deltaTime));
                              // Also pull upward
                              particle.velocity.y += force.strength * 0.5 * deltaTime;
                            }
                          }
                          break;
                          
                        case 'vortex':
                          if (force.direction && distanceToParticle > 0.1) {
                            const vortexAxis = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                            const radiusVec = new THREE.Vector3().crossVectors(vortexAxis, directionToParticle);
                            const radius = radiusVec.length();
                            if (radius > 0.1) {
                              radiusVec.normalize();
                              const tangent = new THREE.Vector3().crossVectors(vortexAxis, radiusVec);
                              particle.velocity.addScaledVector(tangent, force.strength * deltaTime);
                            }
                          }
                          break;
                          
                        case 'attractor':
                          if (distanceToParticle > 0.1) {
                            const attractorForce = directionToParticle.clone().normalize().multiplyScalar(-force.strength);
                            particle.velocity.addScaledVector(attractorForce, deltaTime);
                          }
                          break;
                          
                        case 'repulsor':
                          if (distanceToParticle > 0.1) {
                            const repulsorForce = directionToParticle.clone().normalize().multiplyScalar(force.strength);
                            particle.velocity.addScaledVector(repulsorForce, deltaTime);
                          }
                          break;
                          
                        case 'collider':
                          // Bounce particles off target shape surface
                          if (force.targetShapeId) {
                            const targetShape = sceneObjectsRef.current.find(obj => obj.id === force.targetShapeId);
                            if (targetShape) {
                              const colliderPos = new THREE.Vector3(targetShape.position.x, targetShape.position.y, targetShape.position.z);
                              const scale = new THREE.Vector3(targetShape.scale?.x || 50, targetShape.scale?.y || 50, targetShape.scale?.z || 50);
                              
                              // Calculate closest point on the shape's surface (treating as a box)
                              const localParticlePos = new THREE.Vector3(
                                particlePos.x - colliderPos.x,
                                particlePos.y - colliderPos.y,
                                particlePos.z - colliderPos.z
                              );
                              
                              // Clamp particle position to box surface
                              const closestPoint = new THREE.Vector3(
                                Math.max(-scale.x, Math.min(scale.x, localParticlePos.x)),
                                Math.max(-scale.y, Math.min(scale.y, localParticlePos.y)),
                                Math.max(-scale.z, Math.min(scale.z, localParticlePos.z))
                              );
                              
                              // Calculate distance to surface
                              const surfaceVec = new THREE.Vector3().subVectors(localParticlePos, closestPoint);
                              const distToSurface = surfaceVec.length();
                              const collisionThreshold = 5; // How close particles need to be to collide
                              
                              if (distToSurface < collisionThreshold && distToSurface > 0.1) {
                                // Particle is colliding with surface - bounce it away
                                const surfaceNormal = surfaceVec.normalize();
                                const currentSpeed = particle.velocity.length();
                                particle.velocity.copy(surfaceNormal.multiplyScalar(currentSpeed * force.strength));
                              }
                            }
                          }
                          break;
                          
                        case 'drag':
                          particle.velocity.multiplyScalar(1 - force.strength * 0.1 * deltaTime);
                          break;
                          
                        case 'damping':
                          const dampingFactor = Math.pow(1 - force.strength * 0.05, deltaTime);
                          particle.velocity.multiplyScalar(dampingFactor);
                          break;
                          
                        case 'turbulence': {
                            const noiseScale = force.radius || 20.0;
                            const timeDrift = Date.now() * 0.001 * 0.5;
                            const curl = curlNoise(
                                particlePos.x,
                                particlePos.y + timeDrift * 10,
                                particlePos.z,
                                noiseScale
                            );
                            particle.velocity.addScaledVector(curl, force.strength * deltaTime);
                            break;
                          }

                          case 'thermal-updraft': {
                            const lifeRatio = 1.0 - (particle.age / (particle.lifetime || 1.0));
                            const heatMultiplier = Math.max(0.1, lifeRatio);
                            particle.velocity.y += force.strength * heatMultiplier * deltaTime;

                            const d = directionToParticle.clone();
                            d.y = 0;
                            if (d.lengthSq() > 0.01) {
                                particle.velocity.addScaledVector(d.normalize(), force.strength * 0.1 * heatMultiplier * deltaTime);
                            }
                            break;
                          }
                          
                                                case 'flow-curve':
                          if (force.curveId) {
                            const pathMesh = sceneObjectMeshesRef.current.get(force.curveId) as any;
                            if (pathMesh && pathMesh.pathCurve) {
                               const curve = pathMesh.pathCurve;
                               let closestT = 0;
                               let minDist = Infinity;
                               
                               for (let i = 0; i <= 20; i++) {
                                   const t = i / 20;
                                   const p = curve.getPointAt(t);
                                   const distSq = p.distanceToSquared(particle.mesh.position);
                                   if (distSq < minDist) {
                                       minDist = distSq;
                                       closestT = t;
                                   }
                               }
                               
                               let tangent = curve.getTangentAt(closestT);
                               if (force.reverseFlow) {
                                   tangent.negate();
                               }

                               // Falloff: reduce pull/steer after falloffStart % of path
                               const falloffStart = Math.min(0.9999, (force.falloff ?? 100) / 100);
                               const falloffFactor = closestT <= falloffStart
                                 ? 1.0
                                 : 1.0 - (closestT - falloffStart) / (1.0 - falloffStart + 0.0001);

                               // Twist: rotate desiredVel around tangent by twist angle at closestT
                               const twistDeg = force.twist ?? 0;
                               
                               // Calculate desired speed forward along path
                               let desiredSpeed = force.strength * 2.0; 
                               let desiredVel = tangent.clone().multiplyScalar(desiredSpeed);

                               if (twistDeg !== 0) {
                                 // Build a perpendicular to tangent
                                 const anyUp = Math.abs(tangent.y) < 0.9
                                   ? new THREE.Vector3(0, 1, 0)
                                   : new THREE.Vector3(1, 0, 0);
                                 const perp = new THREE.Vector3()
                                   .crossVectors(tangent.clone().normalize(), anyUp)
                                   .normalize();
                                 // Rotate the perp around the tangent by the accumulated angle at closestT
                                 const twistAngle = (twistDeg * closestT * Math.PI) / 180;
                                 const twistQ = new THREE.Quaternion().setFromAxisAngle(
                                   tangent.clone().normalize(), twistAngle
                                 );
                                 perp.applyQuaternion(twistQ);
                                 // Blend forward + sideways keeping total magnitude = desiredSpeed
                                 // revPerLoop controls how tight the helix is, NOT the speed
                                 const revPerLoop = Math.abs(twistDeg) / 360;
                                 const sideRatio = Math.tanh(revPerLoop); // approaches 1 asymptotically
                                 const fwdRatio = Math.sqrt(Math.max(0, 1 - sideRatio * sideRatio));
                                 desiredVel = new THREE.Vector3()
                                   .copy(tangent.clone().normalize()).multiplyScalar(fwdRatio)
                                   .addScaledVector(perp, sideRatio * Math.sign(twistDeg))
                                   .normalize()
                                   .multiplyScalar(desiredSpeed);
                               }
                               
                               // Pull force toward path core
                               const nearestPoint = curve.getPointAt(closestT);
                               const toCurve = new THREE.Vector3().subVectors(nearestPoint, particle.mesh.position);
                               const distToCurveSq = toCurve.lengthSq();
                               
                               // Determine the "tube" radius
                               const maxRadius = force.radius !== undefined ? Math.max(0.1, force.radius) : 50;
                               
                               let responsiveness = 5.0; // Base responsiveness
                               
                               if (distToCurveSq > 0.01) {
                                   const distToCurve = Math.sqrt(distToCurveSq);
                                   const normalizedDist = Math.max(0, distToCurve / maxRadius);
                                   
                                   // Inside the tube (normalizedDist < 1), we let the particle drift more, 
                                   // applying a very weak pull. Once it hits or exceeds the radius, the pull heavily ramps up.
                                   let pullStrength = Math.abs(force.strength) * 2.5 * Math.pow(normalizedDist, 4.0);
                                   
                                   // Cap the pull so it doesn't instantly snap back and jitter if it gets too far
                                   pullStrength = Math.min(pullStrength, Math.abs(force.strength) * 10.0);
                                   // Apply falloff to pull strength
                                   pullStrength *= falloffFactor;
                                   
                                   desiredVel.add(toCurve.normalize().multiplyScalar(pullStrength));
                                   
                                   // If we're freely floating inside the radius, loosen the steering responsiveness 
                                   // so particles can retain their own organic inertia and noise. 
                                   // If drifting too far out, steering gets tight again.
                                   responsiveness = Math.max(0.5, Math.min(5.0, 5.0 * Math.pow(normalizedDist, 2.0)));
                               }
                               
                               // Apply correction steering (damping existing outward velocity)
                               let steer = desiredVel.clone().sub(particle.velocity);
                               particle.velocity.add(steer.multiplyScalar(Math.min(1.0, responsiveness * falloffFactor * deltaTime)));
                            }
                          } else if (force.direction) {
                            const flowDir = new THREE.Vector3(force.direction.x, force.direction.y, force.direction.z).normalize();
                            particle.velocity.addScaledVector(flowDir, force.strength * deltaTime);
                          }
                          break;
                      }
                    });
                  }

                  // Update position
                  particle.mesh.position.x += particle.velocity.x * deltaTime;
                  particle.mesh.position.y += particle.velocity.y * deltaTime;
                  particle.mesh.position.z += particle.velocity.z * deltaTime;

                  // Track position history for path visualization
                  const emitterShowPaths = emitterProps.showPathCurves ?? false;
                  const pathKeyCount = emitterProps.pathCurveKeyCount ?? 5;
                  if (emitterShowPaths && particle.positionHistory) {
                    particle.positionHistory.push(new THREE.Vector3(particle.mesh.position.x, particle.mesh.position.y, particle.mesh.position.z));
                    // Keep only the most recent positions to match keyCount
                    if (particle.positionHistory.length > pathKeyCount) {
                      particle.positionHistory = particle.positionHistory.slice(-pathKeyCount);
                    }
                  }
                }

                // Sync emitter properties so viewport updates immediately when values change.
                const emitterColor = emitterProps.particleColor ?? '#ffffff';
                const emitterSize = emitterProps.particleSize ?? 0.8;
                const emitterOpacity = emitterProps.particleOpacity ?? 1;
                const emitterParticleType = (emitterProps.particleType ?? 'dots') as ParticleVisualType;
                const emitterGlow = Boolean(emitterProps.particleGlow ?? false);
                const emitterRotation = Number(emitterProps.particleRotation ?? 0);
                const emitterRotationVariation = Number(emitterProps.particleRotationVariation ?? 0);
                const emitterRotationSpeed = Number(emitterProps.particleRotationSpeed ?? 0);
                const emitterRotationSpeedVariation = Number(emitterProps.particleRotationSpeedVariation ?? 0);
                const emitterSpriteImageDataUrl = String(emitterProps.particleSpriteImageDataUrl ?? '');
                const seqProps = getResampledSequenceProps(emitterProps, sceneSettingsRef.current.particleSequenceBudget, sceneSettingsRef.current.particleSequenceBudgetLoop);
                const emitterSpriteSequenceDataUrls = seqProps.urls;
                particle.baseColor = emitterColor;
                particle.baseOpacity = emitterOpacity;
                particle.particleType = emitterParticleType;
                particle.customGlow = emitterGlow;
                particle.rotationVariation = emitterRotationVariation;
                particle.rotationSpeedVariation = emitterRotationSpeedVariation;
                particle.spriteImageDataUrl = emitterSpriteImageDataUrl;
                particle.spriteSequenceDataUrls = emitterSpriteSequenceDataUrls;
                particle.opacityOverLife = emitterProps.particleOpacityOverLife ?? false;
                particle.colorOverLife = emitterProps.particleColorOverLife ?? false;
                particle.colorOverLifeTarget = emitterProps.particleColorOverLifeTarget ?? '#000000';
                particle.sizeOverLife = emitterProps.particleSizeOverLife ?? 'none';
                const sizeMultiplier = particle.sizeMultiplier ?? 1;
                particle.baseSize = emitterSize * sizeMultiplier;
                if (particle.rotationOffset === undefined) {
                  particle.rotationOffset = 0;
                }
                if (particle.rotationSpeedMultiplier === undefined) {
                  particle.rotationSpeedMultiplier = 1;
                }
                particle.rotationSpeed = emitterRotationSpeed * (particle.rotationSpeedMultiplier ?? 1);
                particle.rotation = emitterRotation + (particle.rotationOffset ?? 0) + particle.rotationSpeed * particle.age;

                const effectiveParticleType = getPreviewedParticleType(emitterParticleType);
                const expectedSprite = effectiveParticleType === 'circles' || effectiveParticleType === 'glow-circles' || effectiveParticleType === 'sparkle' || effectiveParticleType === 'glitter' || effectiveParticleType === 'sprites' || effectiveParticleType === '3d-model' || effectiveParticleType === 'stars' || effectiveParticleType === 'volumetric-fire';
                const needsMeshSwap = expectedSprite !== (particle.mesh instanceof THREE.Sprite);
                const currentEmitterFps = getResampledSequenceProps(emitterProps, sceneSettingsRef.current.particleSequenceBudget, sceneSettingsRef.current.particleSequenceBudgetLoop).fps;
                if (needsMeshSwap) {
                  const existingMaterial = getParticleMaterial(particle.mesh);
                  const replacementSpriteTexture = (emitterParticleType === 'sprites' || emitterParticleType === '3d-model')
                    ? resolveSpriteTexture(particle.spriteImageDataUrl ?? '', particle.spriteSequenceDataUrls ?? [], particle.age, currentEmitterFps, String(emitterProps.particleSpriteSequenceMode ?? 'loop'), particle.lifetime, particle.trackId)
                    : undefined;
                  const replacementMesh = createParticleMesh(
                    particle.mesh.position.clone(),
                    getPreviewedParticleColor(particle.baseColor ?? '#ffffff'),
                    getPreviewedParticleSize(particle.baseSize ?? 3),
                    existingMaterial.opacity,
                    effectiveParticleType,
                    getPreviewedGlow(emitterGlow),
                    particle.rotation ?? getParticleRotation(particle.mesh),
                    (effectiveParticleType === 'sprites' || effectiveParticleType === '3d-model') ? replacementSpriteTexture : undefined
                  );
                  scene.remove(particle.mesh);
                  scene.add(replacementMesh);
                  particle.mesh = replacementMesh;
                    setParticleSize(particle.mesh, getPreviewedParticleSize(particle.baseSize ?? 3), particle.flipX);
                  }

                // Apply particle appearance updates based on lifetime and current emitter settings
                const material = getParticleMaterial(particle.mesh);
                const progress = particle.lifetime > 0
                  ? Math.min(1, Math.max(0, particle.age / particle.lifetime))
                  : 1;

                const nextBlending = emitterGlow ? THREE.AdditiveBlending : THREE.NormalBlending;
                if (material.blending !== nextBlending || material.depthWrite !== !emitterGlow) {
                  material.blending = nextBlending;
                  material.depthWrite = !emitterGlow;
                  material.needsUpdate = true;
                }

                if (emitterProps.particleOpacityOverLifeCurve && !particle.opacityOverLife) {
                    const curveValue = evaluateCurve(emitterProps.particleOpacityOverLifeCurve, progress, 1);
                    material.opacity = (particle.baseOpacity ?? 0.8) * curveValue;
                  } else if (emitterProps.particleOpacityOverLifeCurve && !particle.opacityOverLife) {
                    const curveValue = evaluateCurve(emitterProps.particleOpacityOverLifeCurve, progress, 1);
                    material.opacity = (particle.baseOpacity ?? 0.8) * curveValue;
                  } else if (particle.opacityOverLife) {
                    material.opacity = (particle.baseOpacity ?? 0.8) * (1 - progress);
                  } else {
                    material.opacity = particle.baseOpacity ?? 0.8;
                  }

                if ((effectiveParticleType === 'sprites' || effectiveParticleType === '3d-model')) {
                  let spriteTexture = resolveSpriteTexture(particle.spriteImageDataUrl ?? '', particle.spriteSequenceDataUrls ?? [], particle.age, currentEmitterFps, String(emitterProps.particleSpriteSequenceMode ?? 'loop'), particle.lifetime);
                  
                  if (particle.flipX && spriteTexture) {
                    let flipped = flippedTextureCache.get(spriteTexture);
                    if (!flipped) {
                        flipped = spriteTexture.clone();
                        flipped.repeat.x = -1;
                        flipped.offset.x = 1;
                        flippedTextureCache.set(spriteTexture, flipped);
                    }
                    spriteTexture = flipped;
                  }

                  if (material.map !== (spriteTexture ?? null)) {
                    material.map = spriteTexture ?? null;
                    material.needsUpdate = true;
                  }
                }

                setParticleRotation(particle.mesh, particle.rotation);

                if (particle.colorOverLife) {
                  const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
                  if (isWhiteDotPreview) {
                    material.color.copy(new THREE.Color('#ffffff'));
                  } else {
                    const startColor = new THREE.Color(particle.baseColor ?? '#ffffff');
                    const targetColor = new THREE.Color(particle.colorOverLifeTarget ?? '#000000');
                    material.color.lerpColors(startColor, targetColor, progress);
                  }
                } else {
                  material.color.copy(new THREE.Color(getPreviewedParticleColor(particle.baseColor ?? '#ffffff')));
                }

                const sizeOverLife = particle.sizeOverLife ?? 'none';
                const baseSize = particle.baseSize ?? 3;
                const isWhiteDotPreview = (sceneSettingsRef.current.particlePreviewMode ?? 'real') === 'white-dots';
                const previewDotSize = Math.max(0.2, Number(sceneSettingsRef.current.particlePreviewSize ?? 1.2));
                if (isWhiteDotPreview) {
                  setParticleSize(particle.mesh, previewDotSize, particle.flipX);
                } else if (sizeOverLife === 'curve') {
                    const curveValue = evaluateCurve(emitterProps?.particleSizeOverLifeCurve, progress, 1);
                    setParticleSize(particle.mesh, baseSize * curveValue, particle.flipX);
                  } else if (sizeOverLife === 'curve') {
                    const curveValue = evaluateCurve(emitterProps?.particleSizeOverLifeCurve, progress, 1);
                    setParticleSize(particle.mesh, baseSize * curveValue, particle.flipX);
                  } else if (sizeOverLife === 'shrink') {
                    setParticleSize(particle.mesh, baseSize * (1 - progress), particle.flipX);
                  } else if (sizeOverLife === 'grow') {
                    setParticleSize(particle.mesh, baseSize * (0.5 + progress * 0.5), particle.flipX);
                  } else {
                    setParticleSize(particle.mesh, baseSize, particle.flipX);
                  }
              }
            }
          }
        });

        // Draw particle paths as exact Bezier control points for Spine export
        particleSystemsRef.current.forEach((particleSystem, emitterId) => {
          const emitterObj = sceneObjectsRef.current.find(obj => obj.id === emitterId);
          if (!emitterObj || !emitterObj.properties) return;
          
          const emitterProps = emitterObj.properties as unknown as { showPathCurves?: boolean; pathCurveKeyCount?: number };
          const showPaths = emitterProps.showPathCurves ?? false;
          
          if (showPaths) {
            particleSystem.particles.forEach(particle => {
              if (particle.positionHistory && particle.positionHistory.length >= 2) {
                const oldLine = particle.mesh.userData.pathLine as THREE.Line;
                const oldPoints = particle.mesh.userData.pathPoints as THREE.Group;
                if (oldLine) scene.remove(oldLine);
                if (oldPoints) scene.remove(oldPoints);

                const pathPointsGroup = new THREE.Group();

                const historyLength = particle.positionHistory.length;
                const keysCount = Math.max(2, Math.min(emitterProps.pathCurveKeyCount ?? 5, historyLength));
                const sampledPoints: THREE.Vector3[] = [];
                for (let i = 0; i < keysCount; i++) {
                    const idx = Math.floor(i * (historyLength - 1) / (keysCount - 1));
                    sampledPoints.push(particle.positionHistory[idx]);
                }

                const controlPointGeometry = new THREE.SphereGeometry(2, 8, 8);
                const controlPointMaterial = new THREE.MeshBasicMaterial({ color: 0xff6600 });
                
                sampledPoints.forEach((pos) => {
                  const controlPoint = new THREE.Mesh(controlPointGeometry, controlPointMaterial.clone());
                  controlPoint.position.copy(pos);
                  pathPointsGroup.add(controlPoint);
                });

                const curve = new THREE.CatmullRomCurve3(sampledPoints, false, 'catmullrom', 0.5);
                const curvePoints = curve.getPoints(50);

                const lineGeometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
                const lineMaterial = new THREE.LineBasicMaterial({
                  color: 0x00ff99,
                  transparent: true,
                  opacity: 0.7
                });
                const controlLine = new THREE.Line(lineGeometry, lineMaterial);
                pathPointsGroup.add(controlLine);

                particle.mesh.userData.pathLine = controlLine;
                particle.mesh.userData.pathPoints = pathPointsGroup;
                scene.add(pathPointsGroup);
              }
            });
          }
        });

        if (isCachingRef.current && frameChanged && timelineFrame >= timelineInRef.current && timelineFrame <= timelineOutRef.current) {
          captureParticleFrame(timelineFrame);
        }
      }

      lastTimelineFrameRef.current = timelineFrame;

      // Update particle stats every few frames
      if (Math.random() < 0.1) {
        let totalParticles = 0;
        let numEmitters = 0;
        particleSystemsRef.current.forEach((system) => {
          totalParticles += system.particles.length;
          numEmitters++;
        });
        statsDisplay.innerText = `Particles: ${totalParticles}
Emitters: ${numEmitters}`;
      }

      // ── Spine layer Z spread + renderOrder (zero matrix traversal) ──
      // All spine bone positions have z=0, so world Z of each plane = 1 + slotIndex * spread.
      // renderOrder is flipped when the camera is behind the rig (camera.z < 1).
      const _spineMap = spineAttachmentMeshesRef.current;
      const spread = spineLayerSpreadRef.current;
      const camBehind = activeCamera.position.z < 1;
      if (_spineMap.size > 0) {
        _spineMap.forEach((mesh) => {
          const si: number = mesh.userData.slotIndex ?? 0;
          mesh.position.z = 1 + si * spread;
          mesh.renderOrder = camBehind ? -si : si;
        });
      }

      // ── Particle renderOrder: slot into spine layer Z space ──────────
      // When spread > 0, each particle's world Z maps to a fractional spine slot.
      // This allows particles to appear between — or in front of / behind — individual
      // spine layers rather than all landing behind or all on top.
      if (spread > 0.0001) {
        const invSpread = 1 / spread;
        particleSystemsRef.current.forEach((system) => {
          system.particles.forEach((p) => {
            const slot = (p.mesh.position.z - 1) * invSpread;
            p.mesh.renderOrder = camBehind ? -slot : slot;
          });
        });
      }

      if (quadViewportRef.current && quadCamerasRef.current) {
        // ── Quad viewport (Maya-style) ───────────────────────────────
        const rW = renderer.domElement.clientWidth;
        const rH = renderer.domElement.clientHeight;
        const qW = Math.floor(rW / 2);
        const qH = Math.floor(rH / 2);
        const { front, top, side } = quadCamerasRef.current;
        // Top-left: overhead (top) view
        renderer.setScissor(0, rH - qH, qW, qH);
        renderer.setViewport(0, rH - qH, qW, qH);
        renderer.render(scene, top);
        // Top-right: front view
        renderer.setScissor(rW - qW, rH - qH, qW, qH);
        renderer.setViewport(rW - qW, rH - qH, qW, qH);
        renderer.render(scene, front);
        // Bottom-left: side view
        renderer.setScissor(0, 0, qW, qH);
        renderer.setViewport(0, 0, qW, qH);
        renderer.render(scene, side);
        // Bottom-right: perspective
        renderer.setScissor(rW - qW, 0, qW, qH);
        renderer.setViewport(rW - qW, 0, qW, qH);
        renderer.render(scene, activeCamera);
        // Restore full viewport
        renderer.setScissor(0, 0, rW, rH);
        renderer.setViewport(0, 0, rW, rH);
      } else {
        const rW = renderer.domElement.clientWidth;
        const rH = renderer.domElement.clientHeight;
        renderer.setScissor(0, 0, rW, rH);
        renderer.setViewport(0, 0, rW, rH);
        renderer.render(scene, activeCamera);
      }
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;
      
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
      }
      
      // Update quad ortho cameras aspect
      if (quadCamerasRef.current) {
        const newAspect = newWidth / newHeight;
        const se = sceneExtentRef.current;
        const ext = se * 0.75;
        const updateOrtho = (cam: THREE.OrthographicCamera) => {
          cam.left = -ext * newAspect;
          cam.right = ext * newAspect;
          cam.top = ext;
          cam.bottom = -ext;
          cam.updateProjectionMatrix();
        };
        updateOrtho(quadCamerasRef.current.front);
        updateOrtho(quadCamerasRef.current.top);
        updateOrtho(quadCamerasRef.current.side);
      }

      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousedown', onMouseDown);
        containerRef.current.removeEventListener('wheel', onWheel);
      }
      document.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      gridHelpersRef.current = [];
      if (containerRef.current) {
        if (renderer.domElement.parentNode === containerRef.current) {
          containerRef.current.removeChild(renderer.domElement);
        }
        if (stats.dom.parentNode === containerRef.current) {
          containerRef.current.removeChild(stats.dom);
        }
        if (statsDisplay.parentNode === containerRef.current) {
          containerRef.current.removeChild(statsDisplay);
        }
      }
    };
  }, [sceneSize.x, sceneSize.y, sceneSize.z]);

  useEffect(() => {
    if (!sceneRef.current) return;
    if (sceneSettings.referenceImage) {
      sceneRef.current.background = null;
    } else {
      sceneRef.current.background = new THREE.Color(sceneSettings.backgroundColor);
    }
  }, [sceneSettings.backgroundColor, sceneSettings.referenceImage]);

  useEffect(() => {
    const opacity = Math.max(0, Math.min(1, Number(sceneSettings.gridOpacity ?? 0.2)));
    gridHelpersRef.current.forEach((grid) => {
      grid.visible = sceneSettings.showGrid ?? true;
      const material = grid.material;
      if (Array.isArray(material)) {
        material.forEach((m) => {
          m.opacity = opacity;
          m.transparent = true;
        });
      } else if (material instanceof THREE.Material) {
        material.opacity = opacity;
        material.transparent = true;
      }
    });
  }, [sceneSettings.gridOpacity, sceneSettings.showGrid]);

  
  useEffect(() => {
    sceneObjectMeshesRef.current.forEach((mesh) => {
      mesh.visible = sceneSettings.showObjects ?? true;
    });
  }, [sceneSettings.showObjects, sceneObjects]);

  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.particles.forEach(p => {
        if (p.mesh) p.mesh.visible = sceneSettings.showParticles ?? true;
      });
    });
  }, [sceneSettings.showParticles]);

  // Handle view mode changes
  useEffect(() => {
    if (!perspectiveCameraRef.current || !sceneRef.current) return;

    const sceneSizeX = Math.max(100, sceneSize.x || 0);
    const sceneSizeY = Math.max(100, sceneSize.y || 0);
    const sceneSizeZ = Math.max(100, sceneSize.z || 0);
    const sceneExtent = Math.max(sceneSizeX, sceneSizeY, sceneSizeZ);

    // Always use perspective camera, just change the viewing angle
    isOrthoRef.current = false;
    currentCameraRef.current = perspectiveCameraRef.current;

    const cameraState = cameraStateRef.current;
    
    if (viewMode === 'perspective') {
      // Default perspective view
      cameraState.targetTheta = DEFAULT_THETA;
      cameraState.targetPhi = DEFAULT_PHI;
      cameraState.radius = sceneExtent * 0.6;
      cameraState.isAnimating = true;
    } else if (viewMode === 'x') {
      // View along X axis (from +X looking at origin)
      cameraState.targetTheta = 0;
      cameraState.targetPhi = Math.PI / 2;
      cameraState.radius = sceneExtent * 0.6;
      cameraState.isAnimating = true;
    } else if (viewMode === 'y') {
      // View along Y axis (from +Y looking down)
      cameraState.targetTheta = 0;
      cameraState.targetPhi = 0.01;
      cameraState.radius = sceneExtent * 0.6;
      cameraState.isAnimating = true;
    } else if (viewMode === 'z') {
      // View along Z axis (from +Z looking at origin)
      cameraState.targetTheta = Math.PI / 2;
      cameraState.targetPhi = Math.PI / 2;
      cameraState.radius = sceneExtent * 0.6;
      cameraState.isAnimating = true;
    }
  }, [viewMode, sceneSize]);

  // Sync quadViewport prop into ref (read by render loop without causing re-renders)
  useEffect(() => {
    quadViewportRef.current = quadViewport;
  }, [quadViewport]);

  // Clear particles when stopped (frame reset to 0)
  useEffect(() => {
    if (!sceneRef.current || currentFrame !== 0 || isPlaying) return;
    
    const scene = sceneRef.current;
    
    // Clear all particles from all emitters
    particleSystemsRef.current.forEach((particleSystem) => {
      particleSystem.particles.forEach(p => scene.remove(p.mesh));
      particleSystem.particles = [];
      particleSystem.lastEmit = Date.now();
    });
    particleFrameCacheRef.current.clear();
    cacheCountRef.current = 0;
    onCacheFrameCountChange?.(0);
    lastTimelineFrameRef.current = 0;
  }, [currentFrame, isPlaying, onCacheFrameCountChange]);

  // Explicit cache reset trigger (used by fast rewind)
  useEffect(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    particleSystemsRef.current.forEach((particleSystem) => {
      particleSystem.particles.forEach((particle) => scene.remove(particle.mesh));
      particleSystem.particles = [];
      particleSystem.lastEmit = Date.now();
    });
    particleFrameCacheRef.current.clear();
    cacheCountRef.current = 0;
    onCacheFrameCountChange?.(0);
    lastTimelineFrameRef.current = Math.max(0, Math.floor(currentFrameRef.current));
  }, [cacheResetToken, onCacheFrameCountChange]);

  // Handle scene objects (emitters, shapes, etc.)
  useEffect(() => {
    if (!sceneRef.current) return;
    
    const scene = sceneRef.current;
    const currentIds = new Set(sceneObjects.map(obj => obj.id));
    
    // Remove deleted objects
    sceneObjectMeshesRef.current.forEach((mesh, id) => {
      if (!currentIds.has(id)) {
        scene.remove(mesh);
        sceneObjectMeshesRef.current.delete(id);
        
        // Clean up particle system if it's an emitter
        const particleSystem = particleSystemsRef.current.get(id);
        if (particleSystem) {
          particleSystem.particles.forEach(p => scene.remove(p.mesh));
          particleSystemsRef.current.delete(id);
        }
      }
    });
    
    // Add new objects and update existing ones
    sceneObjects.forEach(obj => {
      if (!sceneObjectMeshesRef.current.has(obj.id)) {
        let mesh: THREE.Object3D | null = null;

        if (obj.type === 'Path') {
          mesh = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 }));
          (mesh as any).isPathRender = true;
          scene.add(mesh);
        } else if (obj.type === 'PathPoint') {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.8 }));
          (mesh as any).isPathPointRender = true;
          scene.add(mesh);
        } else if (obj.type === 'EmitterShape') {
          // EmitterShape is a data-only child node — no 3D visual representation needed
          mesh = null;
        } else if (obj.type === 'Emitter') {
          // Render Emitter as a 3D crosshair only
          const crosshairGroup = new THREE.Group();
          const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 });
          const size = 18;
          const crossGeometry = new THREE.BufferGeometry();
          crossGeometry.setAttribute('position', new THREE.BufferAttribute(
            new Float32Array([
              -size, 0, 0, size, 0, 0,
              0, -size, 0, 0, size, 0,
              0, 0, -size, 0, 0, size,
            ]),
            3
          ));
          crosshairGroup.add(new THREE.LineSegments(crossGeometry, lineMaterial));
          mesh = crosshairGroup;
          // Ensure a particle system exists for this emitter
          if (!particleSystemsRef.current.has(obj.id)) {
            particleSystemsRef.current.set(obj.id, { particles: [], lastEmit: Date.now() });
          }
        } else if (obj.type === 'Bone') {
          // Render bone as a small yellow diamond (octahedron) with thin bone-spine line toward parent
          const boneGroup = new THREE.Group();
          const diamondGeo = new THREE.OctahedronGeometry(7, 0);
          const diamondMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, depthTest: false });
          boneGroup.add(new THREE.Mesh(diamondGeo, diamondMat));
          // Wireframe overlay for crisp edge visibility
          const wireframeMat = new THREE.LineBasicMaterial({ color: 0xffd700, transparent: true, opacity: 1, depthTest: false });
          boneGroup.add(new THREE.LineSegments(new THREE.WireframeGeometry(diamondGeo), wireframeMat));
          mesh = boneGroup;
        } else {
          mesh = createStandardObjectMesh(obj.type);
        }

        if (mesh) {
          mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
          mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          mesh.scale.set(obj.scale.x, obj.scale.y, obj.scale.z);
          scene.add(mesh);
          sceneObjectMeshesRef.current.set(obj.id, mesh);
        }
      } else {
        // Check if emitter type changed, if so rebuild the mesh
        const mesh = sceneObjectMeshesRef.current.get(obj.id);
        if (obj.type === 'Emitter' && mesh) {
          // Remove all legacy emitterType visualizations. Only render crosshair for emitters.
          scene.remove(mesh);
          sceneObjectMeshesRef.current.delete(obj.id);
          // Add crosshair only
          const crosshairGroup = new THREE.Group();
          const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 });
          const size = 18;
          const crossGeometry = new THREE.BufferGeometry();
          crossGeometry.setAttribute('position', new THREE.BufferAttribute(
            new Float32Array([
              -size, 0, 0, size, 0, 0,
              0, -size, 0, 0, size, 0,
              0, 0, -size, 0, 0, size,
            ]),
            3
          ));
          crosshairGroup.add(new THREE.LineSegments(crossGeometry, lineMaterial));
          crosshairGroup.position.set(obj.position.x, obj.position.y, obj.position.z);
          crosshairGroup.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          crosshairGroup.scale.set(obj.scale.x, obj.scale.y, obj.scale.z);
          scene.add(crosshairGroup);
          sceneObjectMeshesRef.current.set(obj.id, crosshairGroup);
          return;
        }
        
      
      // Update Path visuals
      if (obj.type === 'Path' && mesh && (mesh as any).isPathRender) {
         const points = sceneObjects.filter(o => o.type === 'PathPoint' && o.parentId === obj.id);
         if (points.length >= 2) {
             const curvePoints = points.map(p => {
                 const pMesh = sceneObjectMeshesRef.current.get(p.id);
                 return pMesh ? pMesh.position.clone() : new THREE.Vector3(p.position.x, p.position.y, p.position.z);
             });
             const curve = new THREE.CatmullRomCurve3(curvePoints, (obj.properties as any)?.closed || false, 'catmullrom', (obj.properties as any)?.tension ?? 0.5);
             const segments = Math.max((points.length - 1) * 20, 50);
             const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(segments));
             (mesh as THREE.Line).geometry.dispose();
             (mesh as THREE.Line).geometry = geometry;
             (mesh as any).pathCurve = curve;
             
             // Move the mesh itself to origin so its vertices match world coords
             mesh.position.set(0,0,0);
             mesh.rotation.set(0,0,0);
             mesh.scale.set(1,1,1);
             return;
         }
      }
        // Update existing object transforms (but not while dragging with transform controls)
        if (mesh && (!transformControlsRef.current || transformControlsRef.current.object !== mesh || !(transformControlsRef.current as any).dragging)) {
          mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
          mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          mesh.scale.set(obj.scale.x, obj.scale.y, obj.scale.z);
        }
      }
    });
  }, [sceneObjects]);

  // ── Spine attachment planes: textured quads parented to bone meshes ──
  useEffect(() => {
    // Remove old attachment meshes
    spineAttachmentMeshesRef.current.forEach((mesh) => {
      if (mesh.parent) mesh.parent.remove(mesh);
      (mesh.geometry as THREE.BufferGeometry).dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
      // Dispose preloaded sequence textures
      if (mesh.userData.seqTextures) {
        for (const t of mesh.userData.seqTextures) { if (t) t.dispose(); }
        mesh.userData.seqTextures = undefined;
      }
    });
    spineAttachmentMeshesRef.current.clear();

    for (const att of spineAttachments) {
      const boneMesh = sceneObjectMeshesRef.current.get(att.boneObjectId);
      if (!boneMesh) continue;
      const geo = new THREE.PlaneGeometry(att.width * att.scaleX, att.height * att.scaleY);

      // Parse slot color tint (RGBA hex 'rrggbbaa')
      let tintColor = 0xffffff;
      let tintOpacity = 1.0;
      if (att.color && att.color.length >= 8) {
        tintColor = parseInt(att.color.substring(0, 6), 16);
        tintOpacity = parseInt(att.color.substring(6, 8), 16) / 255;
      }

      // Blend mode
      let blending: THREE.Blending = THREE.NormalBlending;
      if (att.blendMode === 'additive') blending = THREE.AdditiveBlending;
      else if (att.blendMode === 'multiply') blending = THREE.MultiplyBlending;
      else if (att.blendMode === 'screen') {
        blending = THREE.CustomBlending;
      }

      let texture: THREE.Texture | null = null;
      if (att.imageDataUrl) {
        texture = new THREE.TextureLoader().load(att.imageDataUrl);
        texture.colorSpace = THREE.SRGBColorSpace;
      }
      const mat = new THREE.MeshBasicMaterial({
        map: texture ?? undefined,
        color: texture ? tintColor : 0x7799bb,
        transparent: true,
        opacity: texture ? tintOpacity : 0.45,
        side: THREE.DoubleSide,
        blending,
        depthTest: false,
        depthWrite: false,
      });
      // Store base opacity so per-frame alpha can blend with it
      mat.userData = { baseOpacity: texture ? tintOpacity : 0.45 };
      // Screen blending: ONE / ONE_MINUS_SRC_COLOR
      if (att.blendMode === 'screen') {
        mat.blendEquation = THREE.AddEquation;
        mat.blendSrc = THREE.OneFactor;
        mat.blendDst = THREE.OneMinusSrcColorFactor;
      }
      const planeMesh = new THREE.Mesh(geo, mat);
      planeMesh.userData.localX = att.localX;
      planeMesh.userData.localY = att.localY;
      planeMesh.userData.slotIndex = att.slotIndex;
      planeMesh.position.set(att.localX, att.localY, 1);
      planeMesh.rotation.z = (att.localRotationDeg * Math.PI) / 180;
      planeMesh.renderOrder = att.slotIndex;
      planeMesh.name = `spine-att-${att.id}`;
      // Preload sequence textures so per-frame swaps don’t stall
      if (att.sequenceFrames && att.sequenceFrames.length > 0) {
        planeMesh.userData.seqTextures = att.sequenceFrames.map((url) => {
          if (!url) return null;
          const t = new THREE.TextureLoader().load(url);
          t.colorSpace = THREE.SRGBColorSpace;
          return t;
        });
      }
      boneMesh.add(planeMesh);
      spineAttachmentMeshesRef.current.set(att.id, planeMesh);
    }
  }, [spineAttachments]);

  // Pre-cache each attachment's image as raw pixel data for alpha-based spawn sampling
  useEffect(() => {
    spineAttachPixelDataRef.current.clear();
    for (const att of spineAttachments) {
      if (!att.imageDataUrl) continue;
      const attId = att.id;
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          spineAttachPixelDataRef.current.set(attId, { data, w: canvas.width, h: canvas.height });
        } catch (_e) { /* cross-origin or decode error — leave entry absent */ }
      };
      img.src = att.imageDataUrl;
    }
  }, [spineAttachments]);

  // Sync spineLayerSpread into ref so the render loop can access it without stale closure
  useEffect(() => { spineLayerSpreadRef.current = spineLayerSpread; }, [spineLayerSpread]);

  // ── Fast per-frame: toggle visibility + swap sequence textures + apply animated alpha/tint ──
  useEffect(() => {
    if (!spineFrameOverrides) return;
    spineAttachmentMeshesRef.current.forEach((mesh, id) => {
      const ov = spineFrameOverrides[id];
      if (!ov) { mesh.visible = false; return; }
      mesh.visible = ov.visible;
      if (!ov.visible) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      // Animated alpha: multiply with base setup-pose opacity
      if (ov.alpha !== undefined) {
        const base: number = mat.userData?.baseOpacity ?? 1.0;
        mat.opacity = base * ov.alpha;
        mat.needsUpdate = true;
      }
      // Animated tint color
      if (ov.tintR !== undefined && ov.tintG !== undefined && ov.tintB !== undefined) {
        mat.color.setRGB(ov.tintR, ov.tintG, ov.tintB);
        mat.needsUpdate = true;
      }
      // Sequence texture swap
      if (ov.seqFrame !== undefined && mesh.userData.seqTextures) {
        const tex = mesh.userData.seqTextures[ov.seqFrame];
        if (tex && mat.map !== tex) {
          mat.map = tex;
          mat.needsUpdate = true;
        }
      }
    });
  }, [spineFrameOverrides]);

  // Update object materials based on selection
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove any existing outline
    const existingOutline = scene.getObjectByName('selection-outline');
    if (existingOutline) {
      scene.remove(existingOutline);
    }

    sceneObjectMeshesRef.current.forEach((mesh, objectId) => {
      const obj = sceneObjects.find(o => o.id === objectId);
      if (!obj) return;
      
      if (obj.type === 'Emitter') {
        // Emitter is a Group containing another Group with Line objects
        const emitterGroup = mesh.children[0] as THREE.Group;
        if (!emitterGroup) return;
        
        if (objectId === selectedObjectId) {
          // Highlight selected emitter with brighter color
          emitterGroup.children.forEach(child => {
            if (child instanceof THREE.Line) {
              const material = child.material as THREE.LineBasicMaterial;
              material.color.setHex(0xffcc33);
              material.opacity = 1.0;
            }
          });
        } else {
          // Normal emitter appearance
          emitterGroup.children.forEach(child => {
            if (child instanceof THREE.Line) {
              const material = child.material as THREE.LineBasicMaterial;
              material.color.setHex(0xff6600);
              material.opacity = 0.8;
            }
          });
        }
      }
    });
  }, [selectedObjectId, sceneObjects]);

  // Handle physics force gizmos
  useEffect(() => {
    if (!sceneRef.current) return;
    
    const scene = sceneRef.current;
    const currentForceIds = new Set(physicsForces.map(f => f.id));
    
    // Remove deleted force gizmos
    physicsForceGizmosRef.current.forEach((gizmo, id) => {
      if (!currentForceIds.has(id)) {
        scene.remove(gizmo);
        physicsForceGizmosRef.current.delete(id);
      }
    });
    
    // Add or update force gizmos
    physicsForces.forEach(force => {
      const forcePos = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
      
      // Determine direction based on force type
      let direction = new THREE.Vector3(0, -1, 0); // Default downward
      let length = 100;
      let color = 0xff6600; // Default orange
      
      switch (force.type) {
        case 'gravity':
          direction.set(0, -1, 0);
          color = 0x0099ff; // Blue for gravity (down)
          break;
        case 'wind':
          if (force.direction) {
            direction.set(force.direction.x, force.direction.y, force.direction.z);
          }
          color = 0x00ff99; // Cyan for wind
          break;
        case 'tornado':
          if (force.direction) {
            direction.set(force.direction.x, force.direction.y, force.direction.z);
          }
          color = 0xff9900; // Orange for tornado
          break;
        case 'vortex':
          if (force.direction) {
            direction.set(force.direction.x, force.direction.y, force.direction.z);
          }
          color = 0xff00ff; // Magenta for vortex
          break;
        case 'attractor':
          // Attractor pulls inward - show as sphere indicator instead of arrow
          color = 0xff0000; // Red for attractor
          break;
        case 'repulsor':
          // Repulsor pushes outward - show as sphere indicator instead of arrow
          color = 0x00ff00; // Green for repulsor
          break;
        case 'collider':
          // Collider bounces particles
          color = 0xffaa00; // Orange for collider
          break;
        case 'flow-curve':
          if (force.direction) {
            direction.set(force.direction.x, force.direction.y, force.direction.z);
          }
          color = 0xffff00; // Yellow for curve flow
          break;
        case 'drag':
          // Drag is multi-directional, use neutral indicator
          direction.set(0, 0, 1);
          color = 0x9900ff; // Purple for drag
          break;
        case 'damping':
          // Damping is multi-directional, use neutral indicator
          direction.set(0, 0, 1);
          color = 0x999999; // Gray for damping
          break;
        case 'turbulence':
          // Turbulence is chaotic, use neutral indicator
          direction.set(1, 0, 0);
          color = 0x8800ff; // Purple for turbulence
          break;
        case 'thermal-updraft':
          direction.set(0, 1, 0); // Always up
          color = 0xff3300; // Deep Orange for heat
          break;
      }
      
      // Normalize direction and apply strength scaling
      if (direction.lengthSq() > 0) {
        direction.normalize();
        length = 80 + Math.min(force.strength * 2, 150); // Scale by strength
      }
      
      // Remove existing gizmo
      if (physicsForceGizmosRef.current.has(force.id)) {
        const oldGizmo = physicsForceGizmosRef.current.get(force.id);
        if (oldGizmo) {
          scene.remove(oldGizmo);
        }
      }
      
      // Create appropriate gizmo based on force type
      let gizmo: THREE.Object3D;
      let gizmoPosition = forcePos.clone();
      
      // For attractor/repulsor/collider with target shape, position gizmo at the shape
      if ((force.type === 'attractor' || force.type === 'repulsor' || force.type === 'collider') && force.targetShapeId) {
        const targetShape = sceneObjectsRef.current.find(obj => obj.id === force.targetShapeId);
        if (targetShape) {
          gizmoPosition.set(targetShape.position.x, targetShape.position.y, targetShape.position.z);
        }
      }
      
      if (force.type === 'attractor' || force.type === 'repulsor' || force.type === 'collider') {
        // Create text label for attractor/repulsor/collider
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Determine background color based on force type
          let bgColor = 'rgba(255, 0, 0, 0.4)'; // Default red for attractor
          if (force.type === 'repulsor') {
            bgColor = 'rgba(0, 255, 0, 0.4)'; // Green for repulsor
          } else if (force.type === 'collider') {
            bgColor = 'rgba(255, 170, 0, 0.4)'; // Orange for collider
          }
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Draw text
          ctx.fillStyle = 'white';
          ctx.font = 'bold 120px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          let label = 'AT'; // attractor
          if (force.type === 'repulsor') label = 'RP';
          else if (force.type === 'collider') label = 'CO';
          ctx.fillText(label, canvas.width / 2, canvas.height / 2);
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: true });
        gizmo = new THREE.Sprite(spriteMat);
        gizmo.scale.set(30, 30, 1);
        gizmo.position.copy(gizmoPosition);
      } else if (force.type === 'tornado' || force.type === 'vortex') {
        // Create curved arrow gizmo to show rotation
        const group = new THREE.Group();
        const axis = new THREE.Vector3(force.direction?.x ?? 0, force.direction?.y ?? 1, force.direction?.z ?? 0).normalize();
        
        // Create torus to show the circular motion plane
        const torusGeo = new THREE.TorusGeometry(60, 8, 8, 32);
        const torusMat = new THREE.MeshBasicMaterial({ 
          color, 
          transparent: true, 
          opacity: 0.15,
          wireframe: false
        });
        const torus = new THREE.Mesh(torusGeo, torusMat);
        group.add(torus);
        
        // Add curved arrow indicators (multiple arrows around the torus)
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2;
          const arrowPos = new THREE.Vector3(
            Math.cos(angle) * 60,
            0,
            Math.sin(angle) * 60
          );
          
          // Perpendicular direction to show rotation
          const nextAngle = angle + Math.PI * 0.3;
          const nextPos = new THREE.Vector3(
            Math.cos(nextAngle) * 60,
            0,
            Math.sin(nextAngle) * 60
          );
          const arrowDir = new THREE.Vector3().subVectors(nextPos, arrowPos).normalize();
          
          const arrow = new THREE.ArrowHelper(arrowDir, arrowPos, 20, color, 8, 6);
          group.add(arrow);
        }
        
        // Rotate group based on axis direction
        const up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(axis.dot(up)) < 0.9) {
          const rotAxis = new THREE.Vector3().crossVectors(up, axis).normalize();
          const angle = Math.acos(axis.dot(up));
          group.quaternion.setFromAxisAngle(rotAxis, angle);
        }
        
        group.position.copy(forcePos);
        gizmo = group;
      } else if (force.type === 'flow-curve') {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'rgba(0, 150, 255, 0.4)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 16;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          
          // Draw sine waves
          for (let i = 0; i < 3; i++) {
            const y = 70 + i * 58;
            ctx.beginPath();
            for (let x = 40; x <= 216; x += 4) {
              const dx = (x - 40) / 176;
              const waveY = y + Math.sin(dx * Math.PI * 2 * 1.5) * 18;
              if (x === 40) ctx.moveTo(x, waveY);
              else ctx.lineTo(x, waveY);
            }
            ctx.stroke();
          }
        }
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: true });
        gizmo = new THREE.Sprite(spriteMat);
        gizmo.scale.set(30, 30, 1);
        gizmo.position.copy(gizmoPosition);
      } else {
        // Create arrow for directional forces
        gizmo = new THREE.ArrowHelper(direction, forcePos, length, color, 30, 20);
      }
      
      gizmo.name = `force-gizmo-${force.id}`;
      scene.add(gizmo);
      physicsForceGizmosRef.current.set(force.id, gizmo);
    });
  }, [physicsForces]);

  // Attach transform controls to selected object and create visual handles
  useEffect(() => {
    if (!transformControlsRef.current || !sceneRef.current) return;

    const transformControls = transformControlsRef.current;
    const scene = sceneRef.current;
    
    // Remove old handles
    const oldHandles = scene.getObjectByName('transform-handles');
    if (oldHandles) {
      scene.remove(oldHandles);
    }
    
    if (selectedObjectId) {
      const selectedMesh = sceneObjectMeshesRef.current.get(selectedObjectId);
      if (selectedMesh) {
        transformControls.attach(selectedMesh);
        transformControls.enabled = false; // Disabled: using custom visual handles instead
        transformControls.setMode(manipulatorMode);
        
        // Create visual handles by mode (translate/rotate/scale)
        const handlesGroup = new THREE.Group();
        handlesGroup.name = 'transform-handles';
        handlesGroup.position.copy(selectedMesh.position);
        handlesGroup.rotation.copy(selectedMesh.rotation);

        let xArrow: THREE.Mesh;
        let yArrow: THREE.Mesh;
        let zArrow: THREE.Mesh;

        if (manipulatorMode === 'translate') {
          const xArrowGeom = new THREE.ConeGeometry(4 * handleScale, 16 * handleScale, 8);
          const yArrowGeom = new THREE.ConeGeometry(4 * handleScale, 16 * handleScale, 8);
          const zArrowGeom = new THREE.ConeGeometry(4 * handleScale, 16 * handleScale, 8);

          xArrow = new THREE.Mesh(xArrowGeom, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
          yArrow = new THREE.Mesh(yArrowGeom, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
          zArrow = new THREE.Mesh(zArrowGeom, new THREE.MeshBasicMaterial({ color: 0x0000ff }));

          xArrow.rotation.z = -Math.PI / 2;
          xArrow.position.x = 40 * handleScale;
          yArrow.position.y = 40 * handleScale;
          zArrow.rotation.x = Math.PI / 2;
          zArrow.position.z = 40 * handleScale;
        } else if (manipulatorMode === 'rotate') {
          const xRingGeom = new THREE.TorusGeometry(40 * handleScale, 1 * handleScale, 8, 64);
          const yRingGeom = new THREE.TorusGeometry(40 * handleScale, 1 * handleScale, 8, 64);
          const zRingGeom = new THREE.TorusGeometry(40 * handleScale, 1 * handleScale, 8, 64);

          xArrow = new THREE.Mesh(xRingGeom, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
          yArrow = new THREE.Mesh(yRingGeom, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
          zArrow = new THREE.Mesh(zRingGeom, new THREE.MeshBasicMaterial({ color: 0x0000ff }));

          xArrow.rotation.y = Math.PI / 2;
          yArrow.rotation.x = Math.PI / 2;
        } else {
          const xBoxGeom = new THREE.BoxGeometry(8 * handleScale, 8 * handleScale, 8 * handleScale);
          const yBoxGeom = new THREE.BoxGeometry(8 * handleScale, 8 * handleScale, 8 * handleScale);
          const zBoxGeom = new THREE.BoxGeometry(8 * handleScale, 8 * handleScale, 8 * handleScale);

          xArrow = new THREE.Mesh(xBoxGeom, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
          yArrow = new THREE.Mesh(yBoxGeom, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
          zArrow = new THREE.Mesh(zBoxGeom, new THREE.MeshBasicMaterial({ color: 0x0000ff }));

          xArrow.position.x = 40 * handleScale;
          yArrow.position.y = 40 * handleScale;
          zArrow.position.z = 40 * handleScale;
        }

        xArrow.name = 'x-arrow';
        yArrow.name = 'y-arrow';
        zArrow.name = 'z-arrow';
        handlesGroup.add(xArrow, yArrow, zArrow);
        
        scene.add(handlesGroup);
        handlesRef.current = { xArrow, yArrow, zArrow };
      } else {
        // Could not find mesh for selectedObjectId
      }
    } else {
      transformControls.detach();
      transformControls.enabled = false;
      handlesRef.current = null;
      dragStateRef.current.active = false;
    }
  }, [selectedObjectId, manipulatorMode, handleScale]);

  // Keep visual helpers in sync when object transforms are changed from property sliders
  useEffect(() => {
    if (!sceneRef.current || !selectedObjectId) return;

    const scene = sceneRef.current;
    const selectedMesh = sceneObjectMeshesRef.current.get(selectedObjectId);
    if (!selectedMesh) return;

    const handles = scene.getObjectByName('transform-handles');
    if (handles) {
      handles.position.copy(selectedMesh.position);
      handles.rotation.copy(selectedMesh.rotation);
    }

    const outline = scene.getObjectByName('selection-outline');
    if (outline) {
      outline.position.copy(selectedMesh.position);
      outline.rotation.copy(selectedMesh.rotation);
      outline.scale.copy(selectedMesh.scale);
      outline.scale.multiplyScalar(1.05);
    }
  }, [sceneObjects, selectedObjectId]);

  // Setup gizmo renderer
  useEffect(() => {
    if (!containerRef.current || !rendererRef.current) return;

    const gizmoSize = 120;
    const gizmoCanvas = document.createElement('canvas');
    gizmoCanvas.width = gizmoSize;
    gizmoCanvas.height = gizmoSize;
    gizmoCanvas.className = 'gizmo-canvas';
    gizmoCanvasRef.current = gizmoCanvas;

    const gizmoScene = new THREE.Scene();
    gizmoScene.background = null;
    gizmoSceneRef.current = gizmoScene;

    const gizmoCamera = new THREE.OrthographicCamera(-60, 60, 60, -60, 0.1, 1000);
    gizmoCamera.position.set(50, 50, 50);
    gizmoCamera.lookAt(0, 0, 0);

    const gizmoRenderer = new THREE.WebGLRenderer({ canvas: gizmoCanvas, antialias: true, alpha: true });
    gizmoRenderer.setSize(gizmoSize, gizmoSize);
    gizmoRenderer.setPixelRatio(window.devicePixelRatio);
    gizmoRendererRef.current = gizmoRenderer;

    // Create a group to hold and rotate the axes
    const gizmoAxesGroup = new THREE.Group();
    gizmoScene.add(gizmoAxesGroup);

    // Create axis arrows
    const arrowLength = 40;
    const arrowHeadLength = 12;

    // X axis (red)
    const xArrow = new THREE.Group();
    const xCone = new THREE.Mesh(
      new THREE.ConeGeometry(5, arrowHeadLength, 8),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    xCone.position.set(arrowLength - arrowHeadLength / 2, 0, 0);
    xCone.rotation.z = -Math.PI / 2;
    const xLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, arrowLength - arrowHeadLength * 0.5, 0, 0]), 3)
      ),
      new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 })
    );
    xArrow.add(xLine, xCone);
    xArrow.userData.axis = 'x';
    gizmoAxesGroup.add(xArrow);

    // Y axis (green)
    const yArrow = new THREE.Group();
    const yCone = new THREE.Mesh(
      new THREE.ConeGeometry(5, arrowHeadLength, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    yCone.position.set(0, arrowLength - arrowHeadLength / 2, 0);
    const yLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, arrowLength - arrowHeadLength * 0.5, 0]), 3)
      ),
      new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 })
    );
    yArrow.add(yLine, yCone);
    yArrow.userData.axis = 'y';
    gizmoAxesGroup.add(yArrow);

    // Z axis (blue)
    const zArrow = new THREE.Group();
    const zCone = new THREE.Mesh(
      new THREE.ConeGeometry(5, arrowHeadLength, 8),
      new THREE.MeshBasicMaterial({ color: 0x0000ff })
    );
    zCone.position.set(0, 0, arrowLength - arrowHeadLength / 2);
    zCone.rotation.x = Math.PI / 2;
    const zLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, arrowLength - arrowHeadLength * 0.5]), 3)
      ),
      new THREE.LineBasicMaterial({ color: 0x0000ff, linewidth: 2 })
    );
    zArrow.add(zLine, zCone);
    zArrow.userData.axis = 'z';
    gizmoAxesGroup.add(zArrow);

    // Center cube for perspective view
    const centerCube = new THREE.Mesh(
      new THREE.BoxGeometry(8, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x888888 })
    );
    centerCube.userData.axis = 'perspective';
    gizmoAxesGroup.add(centerCube);

    gizmoAxisObjectsRef.current = { x: xArrow, y: yArrow, z: zArrow };

    // Add to DOM
    containerRef.current.appendChild(gizmoCanvas);

    // Track hovered object for hover effect
    let hoveredAxisGroup: THREE.Object3D | null = null;

    // Handle gizmo hover
    const onGizmoMove = (event: MouseEvent) => {
      const rect = gizmoCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      mouse.x = (x / gizmoSize) * 2 - 1;
      mouse.y = -(y / gizmoSize) * 2 + 1;

      raycaster.setFromCamera(mouse, gizmoCamera);
      const intersects = raycaster.intersectObjects(gizmoScene.children, true);

      let newHoveredGroup: THREE.Object3D | null = null;

      if (intersects.length > 0) {
        // Find the axis group
        for (let obj = intersects[0].object as any; obj; obj = obj.parent) {
          if (obj.userData.axis) {
            newHoveredGroup = obj;
            break;
          }
        }
      }

      // Reset previous hover
      if (hoveredAxisGroup && hoveredAxisGroup !== newHoveredGroup) {
        hoveredAxisGroup.scale.set(1, 1, 1);
      }

      // Apply hover effect
      if (newHoveredGroup && newHoveredGroup !== hoveredAxisGroup) {
        newHoveredGroup.scale.set(1.2, 1.2, 1.2);
        gizmoCanvas.style.cursor = 'pointer';
      } else if (!newHoveredGroup) {
        gizmoCanvas.style.cursor = 'default';
      }

      hoveredAxisGroup = newHoveredGroup;
    };

    // Handle gizmo clicks
    const onGizmoClick = (event: MouseEvent) => {
      const rect = gizmoCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      mouse.x = (x / gizmoSize) * 2 - 1;
      mouse.y = -(y / gizmoSize) * 2 + 1;

      raycaster.setFromCamera(mouse, gizmoCamera);
      const intersects = raycaster.intersectObjects(gizmoScene.children, true);

      if (intersects.length > 0) {
        let axis = null;
        for (let obj = intersects[0].object as any; obj; obj = obj.parent) {
          if (obj.userData.axis) {
            axis = obj.userData.axis;
            break;
          }
        }

        if (axis) {
          onViewModeChange(axis as 'perspective' | 'x' | 'y' | 'z');
        }
      }
    };

    gizmoCanvas.addEventListener('mousemove', onGizmoMove);
    gizmoCanvas.addEventListener('click', onGizmoClick);

    // Animation loop for gizmo
    let gizmoAnimationId: number;
    const animateGizmo = () => {
      gizmoAnimationId = requestAnimationFrame(animateGizmo);
      
      // Synchronize gizmo camera rotation with main camera
      const perspectiveCamera = perspectiveCameraRef.current;
      if (perspectiveCamera) {
        // Get the camera's world quaternion
        const quat = new THREE.Quaternion();
        perspectiveCamera.getWorldQuaternion(quat);
        // Apply it to the gizmo camera so it's oriented the same way
        gizmoCamera.quaternion.copy(quat);
        
        // Position the camera at a fixed distance from origin along its viewing direction
        const distance = 100;
        gizmoCamera.position.set(0, 0, distance);
        gizmoCamera.position.applyQuaternion(quat);
        
        // Update the camera matrix
        gizmoCamera.updateMatrixWorld();
      }
      
      gizmoRenderer.render(gizmoScene, gizmoCamera);
    };
    animateGizmo();

    return () => {
      gizmoCanvas.removeEventListener('mousemove', onGizmoMove);
      gizmoCanvas.removeEventListener('click', onGizmoClick);
      cancelAnimationFrame(gizmoAnimationId);
      gizmoRenderer.dispose();
      if (containerRef.current && gizmoCanvas.parentNode === containerRef.current) {
        containerRef.current.removeChild(gizmoCanvas);
      }
    };
  }, [onViewModeChange]);

  useImperativeHandle(ref, () => ({
    getParticleTextureBlob: async () => {
        const particleType = sceneSettings.particleType ?? 'dots';
        const customGlow = sceneSettings.customGlow ?? false;
        
        return new Promise<Blob | null>((resolve) => {
            const textureType = particleType === 'dots' && !customGlow ? 'circles' : particleType;
            const size = 64;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(null);

            ctx.clearRect(0, 0, size, size);
            const center = size / 2;
            const radius = size * 0.4;

            const makeGlowGradient = () => {
              const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius * 1.15);
              gradient.addColorStop(0, 'rgba(255,255,255,1)');
              gradient.addColorStop(0.45, 'rgba(255,255,255,0.85)');
              gradient.addColorStop(1, 'rgba(255,255,255,0)');
              return gradient;
            };

            if (textureType === 'stars') {
              const makeFlare = () => {
                const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
                grad.addColorStop(0, 'rgba(255,255,255,1)');
                grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
                grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
                grad.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(0, 0, radius, 0, Math.PI * 2);
                ctx.fill();
              };

              ctx.save();
              if (customGlow) ctx.globalCompositeOperation = 'lighter';

              // Vertical flare
              ctx.save();
              ctx.translate(center, center);
              ctx.scale(0.15, 1.0);
              makeFlare();
              ctx.restore();

              // Horizontal flare
              ctx.save();
              ctx.translate(center, center);
              ctx.scale(1.0, 0.15);
              makeFlare();
              ctx.restore();

              // Core
              ctx.save();
              ctx.translate(center, center);
              ctx.beginPath();
              ctx.arc(0, 0, radius * 0.25, 0, Math.PI * 2);
              const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.25);
              coreGrad.addColorStop(0, 'rgba(255,255,255,1)');
              coreGrad.addColorStop(1, 'rgba(255,255,255,0)');
              ctx.fillStyle = coreGrad;
              ctx.fill();
              ctx.restore();
              
              ctx.restore();
            } else if ((textureType === 'sprites' || textureType === '3d-model')) {
              const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius * 1.2);
              gradient.addColorStop(0, 'rgba(255,255,255,1)');
              gradient.addColorStop(0.25, 'rgba(255,255,255,0.95)');
              gradient.addColorStop(0.6, 'rgba(255,255,255,0.5)');
              gradient.addColorStop(1, 'rgba(255,255,255,0)');
              ctx.fillStyle = gradient;
              ctx.fillRect(0, 0, size, size);
            } else if (textureType === 'glow-circles') {
              ctx.beginPath();
              ctx.arc(center, center, radius, 0, Math.PI * 2);
              ctx.closePath();
              ctx.fillStyle = makeGlowGradient();
              ctx.fill();
            } else {
              if (customGlow) {
                ctx.beginPath();
                ctx.arc(center, center, radius, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fillStyle = makeGlowGradient();
                ctx.fill();
              } else {
                ctx.beginPath();
                ctx.arc(center, center, radius * 0.5, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fillStyle = 'rgba(255,255,255,1)';
                ctx.fill();
              }
            }

            canvas.toBlob((blob) => {
                resolve(blob);
            }, 'image/png');
        });
    },
    getExportAssets: async () => {
        const assets: Array<{name: string, blob: Blob}> = [];
        let pUrls: string[] = [];
        let singleUrl: string = '';
        let hasCustomSequence = false;
        let hasSingleImage = false;
        let customParticleType = sceneSettings.particleType ?? 'dots';
        let customGlow = sceneSettings.customGlow ?? false;
        
        for (const obj of sceneObjectsRef.current) {
            if (obj.type === 'Emitter') {
                const props = obj.properties as any;
                if (props?.particleSpriteSequenceDataUrls?.length > 0) {
                    pUrls = resampleSequence(props.particleSpriteSequenceDataUrls, sceneSettings.particleSequenceBudget);
                    hasCustomSequence = true;
                    break;
                } else if (props?.particleSpriteImageDataUrl) {
                    singleUrl = props.particleSpriteImageDataUrl;
                    hasSingleImage = true;
                    break;
                }
                if (props?.particleType) {
                    customParticleType = props.particleType;
                    customGlow = props.particleGlow ?? false;
                }
            }
        }
        
        if (hasCustomSequence && pUrls.length > 0) {
            for (let i=0; i<pUrls.length; i++) {
                try {
                    const res = await fetch(pUrls[i]);
                    const blob = await (await fetch(pUrls[i])).blob();
                    const frameName = String(i).padStart(2, '0');
                    assets.push({ name: `images/particles/png/particle_${frameName}.png`, blob });
                } catch (e) {
                    console.error("Error fetching blob for sequence frame", i, e);
                }
            }
            return assets;
        }

        if (hasSingleImage && singleUrl) {
            try {
                const res = await fetch(singleUrl);
                const blob = await res.blob();
                assets.push({ name: 'images/particles/png/particle.png', blob });
                return assets;
            } catch(e) {
                console.error("Error fetching single image blob", e);
            }
        }

        // Add standard static texture
        const textureType = customParticleType === 'dots' && !customGlow ? 'circles' : customParticleType;
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return [];

        ctx.clearRect(0, 0, size, size);
        const center = size / 2;
        const radius = size * 0.4;

        const makeGlowGradient = () => {
            const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius * 1.15);
            gradient.addColorStop(0, 'rgba(255,255,255,1)');
            gradient.addColorStop(0.45, 'rgba(255,255,255,0.85)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            return gradient;
        };

        if (textureType === 'stars') {
            const makeFlare = () => {
              const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
              grad.addColorStop(0, 'rgba(255,255,255,1)');
              grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
              grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
              grad.addColorStop(1, 'rgba(255,255,255,0)');
              ctx.fillStyle = grad;
              ctx.beginPath();
              ctx.arc(0, 0, radius, 0, Math.PI * 2);
              ctx.fill();
            };

            ctx.save();
            if (customGlow) ctx.globalCompositeOperation = 'lighter';

            // Vertical flare
            ctx.save();
            ctx.translate(center, center);
            ctx.scale(0.15, 1.0);
            makeFlare();
            ctx.restore();

            // Horizontal flare
            ctx.save();
            ctx.translate(center, center);
            ctx.scale(1.0, 0.15);
            makeFlare();
            ctx.restore();

            // Core
            ctx.save();
            ctx.translate(center, center);
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.25, 0, Math.PI * 2);
            const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.25);
            coreGrad.addColorStop(0, 'rgba(255,255,255,1)');
            coreGrad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = coreGrad;
            ctx.fill();
            ctx.restore();
            
            ctx.restore();
        } else if ((textureType === 'sprites' || textureType === '3d-model')) {
            const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius * 1.2);
            gradient.addColorStop(0, 'rgba(255,255,255,1)');
            gradient.addColorStop(0.25, 'rgba(255,255,255,0.95)');
            gradient.addColorStop(0.6, 'rgba(255,255,255,0.5)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);
        } else if (textureType === 'glow-circles') {
            ctx.beginPath();
            ctx.arc(center, center, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fillStyle = makeGlowGradient();
            ctx.fill();
        } else {
            if (customGlow) {
                ctx.beginPath();
                ctx.arc(center, center, radius, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fillStyle = makeGlowGradient();
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(center, center, radius * 0.5, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fillStyle = 'rgba(255,255,255,1)';
                ctx.fill();
            }
        }

        return new Promise<Array<{name: string, blob: Blob}>>((resolve) => {
            canvas.toBlob((blob) => {
                if (blob) assets.push({ name: 'images/particles/png/particle.png', blob });
                resolve(assets);
            }, 'image/png');
        });
    },
    exportSpineData: (options?: any) => {
      // Gather data across all cached frames
      const spineData = {
        skeleton: {
          hash: "particle-export",
          spine: "4.2.43",
          x: -sceneSize.x / 2,
          y: -sceneSize.y / 2,
          width: sceneSize.x,
          height: sceneSize.y,
          fps: 24,
        },
        bones: [] as any[],
        slots: [] as any[],
        skins: [{ name: "default", attachments: {} }] as any[],
        animations: { animation: { slots: {} as any, bones: {} as any, attachments: {"default": {}} as any } } as any
      };
      
      if (options?.sequenceMode) {
          spineData.animations["intro"] = { slots: {}, bones: {}, attachments: {"default": {}} };
          spineData.animations["loop"] = { slots: {}, bones: {}, attachments: {"default": {}} };
          spineData.animations["outro"] = { slots: {}, bones: {}, attachments: {"default": {}} };
      }
      

      const frames = Array.from(particleFrameCacheRef.current.entries())
        .sort((a, b) => a[0] - b[0]);
      
      if (frames.length === 0) return null;

      const trackData = new Map<string, { frame: number, state: CachedParticleState }[]>();

      // Group states by trackId
      for (const [frameObj, states] of frames) {
        for (const state of states) {
          const uniqueId = `${state.emitterId}_${state.trackId}`;
          if (!trackData.has(uniqueId)) trackData.set(uniqueId, []);
          
          let pushedState = state;
          if (sceneSettings.exportProjectionMode === 'perspective' && perspectiveCameraRef.current) {
            let cam = perspectiveCameraRef.current;
            
            if (sceneSettings.cameraOrbitSpeed) {
                cam = cam.clone();
                const orbitOffset = (sceneSettings.cameraOrbitSpeed || 0) * (frameObj / 24) * (Math.PI / 180);
                const cameraState = cameraStateRef.current;
                const effectiveTheta = cameraState.theta + orbitOffset;
                const sin_phi = Math.sin(cameraState.phi);
                const cos_phi = Math.cos(cameraState.phi);
                const sin_theta = Math.sin(effectiveTheta);
                const cos_theta = Math.cos(effectiveTheta);
                const oTargetX = cameraState.viewOffsetX;
                const oTargetY = cameraState.viewOffsetY;
                const oTargetZ = cameraState.viewOffsetZ;
                cam.position.x = oTargetX + cameraState.radius * sin_phi * sin_theta;
                cam.position.y = oTargetY + cameraState.radius * cos_phi;
                cam.position.z = oTargetZ + cameraState.radius * sin_phi * cos_theta;
                cam.lookAt(oTargetX, oTargetY, oTargetZ);
                cam.updateMatrixWorld();
            }

            const particlePos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
            const particleVel = new THREE.Vector3(state.position.x + state.velocity.x, state.position.y + state.velocity.y, state.position.z + state.velocity.z);
            
            const dist = cam.position.length();
            const fov = cam.fov;
            const aspect = cam.aspect;
            const scaleY = Math.tan(fov * Math.PI / 360) * dist;
            const scaleX = scaleY * aspect;
            
            particlePos.project(cam);
            particleVel.project(cam);
            
            const pDist = cam.position.distanceTo(new THREE.Vector3(state.position.x, state.position.y, state.position.z));
            const distRatio = pDist > 0 ? (dist / pDist) : 1;

            pushedState = {
              ...state,
              position: {
                x: particlePos.x * scaleX,
                y: particlePos.y * scaleY,
                z: state.position.z
              },
              velocity: {
                x: (particleVel.x - particlePos.x) * scaleX,
                y: (particleVel.y - particlePos.y) * scaleY,
                z: state.velocity.z
              },
              size: state.size * distRatio
            };
          }

          trackData.get(uniqueId)!.push({ frame: frameObj, state: pushedState });
        }
      }

      // Root bone
      spineData.bones.push({ name: "root" });

      // Cache emitter sequence info
      const emitterSequences = new Map<string, { count: number, fps: number }>();
      sceneObjectsRef.current.forEach(obj => {
          if (obj.type === 'Emitter') {
              const props = obj.properties as any;
              const seqProps = getResampledSequenceProps(props, sceneSettings.particleSequenceBudget, sceneSettings.particleSequenceBudgetLoop);
              const urls = seqProps.urls;
              if (urls.length > 0) {
                  emitterSequences.set(obj.id, {
                      count: urls.length,
                      fps: seqProps.fps
                  });
              }
          }
      });

      trackData.forEach((history, trackId) => {
        const boneName = `track_${trackId}`;

        const slotName = 'slot_' + trackId;
        
        spineData.bones.push({ name: boneName, parent: "root" });
        spineData.slots.push({ name: slotName, bone: boneName, attachment: null });

        const firstState = history[0]?.state;
        const seqInfo = firstState ? emitterSequences.get(firstState.emitterId) : undefined;

        const skinAttachments = spineData.skins[0].attachments as any;
        if (seqInfo && seqInfo.count > 0) {
            skinAttachments[slotName] = { 
                "particle": { type: "region", name: "particles/png/particle", width: 64, height: 64, sequence: { count: seqInfo.count, start: 0, digits: 2 } }
            };
        } else {
            skinAttachments[slotName] = { "particle": { type: "region", name: "particles/png/particle", width: 64, height: 64 } };
        }
        const boneAnim = { translate: [] as any[], scale: [] as any[], rotate: [] as any[] };
        const slotAnim: any = { rgba: [] as any[], attachment: [] as any[] };
        let sequenceAnim: any = null;
        if (seqInfo && seqInfo.count > 0) {
            sequenceAnim = [] as any[];
            if (!spineData.animations.animation.attachments["default"][slotName]) {
                spineData.animations.animation.attachments["default"][slotName] = {};
            }
            spineData.animations.animation.attachments["default"][slotName]["particle"] = { sequence: sequenceAnim };
        }

        // Chunk history into contiguous life segments
        if (history.length > 0 && history[0].frame > 0) {
            slotAnim.attachment.push({ time: 0, name: null });
            slotAnim.rgba.push({ time: 0, color: "ffffff00", curve: "stepped" });
            boneAnim.scale.push({ time: 0, x: 0, y: 0, curve: "stepped" });
            boneAnim.rotate.push({ time: 0, value: 0, curve: "stepped" });
        }
          const lifespans: {frame: number, state: CachedParticleState}[][] = [];
          let currentLifespan: {frame: number, state: CachedParticleState}[] = [];
          let lastFrame = -2;
          let lastAge = -1;

          for (const item of history) {
            if ((item.frame > lastFrame + 1 || item.state.age < lastAge) && lastFrame !== -2) {
              lifespans.push(currentLifespan);
              currentLifespan = [];
            }
            currentLifespan.push(item);
            lastFrame = item.frame;
            lastAge = item.state.age;
          }
          if (currentLifespan.length > 0) lifespans.push(currentLifespan);

          // Process each lifespan segment, downsampling to exactly 4 keys
          for (let i = 0; i < lifespans.length; i++) {
            const life = lifespans[i];
            if (life.length === 0) continue;

            // Rebirth gap invisible frame handling
            if (i > 0 || life[0].frame > 0) {
              slotAnim.rgba.push({ time: Math.max(0, (life[0].frame - 1)) / 24, color: 'ffffff00', curve: "stepped" });
              boneAnim.scale.push({ time: Math.max(0, (life[0].frame - 1)) / 24, x: 0, y: 0, curve: "stepped" });
              boneAnim.rotate.push({ time: Math.max(0, (life[0].frame - 1)) / 24, value: 0, curve: "stepped" });
            }
            
            slotAnim.attachment.push({ time: life[0].frame / 24, name: "particles/png/particle" });

            if (seqInfo && seqInfo.count > 0) {
                sequenceAnim!.push({
                   time: life[0].frame / 24,
                   mode: "loop",
                   index: 0,
                   delay: 1 / seqInfo.fps
                });
            }

            // 3 keys (start, mid, end) — cubic bezier covers the full motion accurately
            const maxKeys = 3;
            const bakedKeys: {frame: number, state: CachedParticleState}[] = [];
            if (life.length <= maxKeys) {
                bakedKeys.push(...life);
            } else {
                for (let j = 0; j < maxKeys; j++) {
                    const idx = Math.floor(j * (life.length - 1) / (maxKeys - 1));
                    bakedKeys.push(life[idx]);
                }
            }

            // Catmull-Rom tangent helpers — returns the slope at index k for a
            // uniformly-sampled scalar sequence, clamped at the endpoints.
            type BakedKey = {frame: number, state: CachedParticleState};
            const crTangent = (keys: BakedKey[], k: number, getValue: (s: BakedKey) => number): number => {
                if (keys.length < 2) return 0;
                const prev = keys[Math.max(0, k - 1)];
                const next = keys[Math.min(keys.length - 1, k + 1)];
                const prevTime = prev.frame / 24;
                const nextTime = next.frame / 24;
                const dt = nextTime - prevTime;
                return dt > 0 ? (getValue(next) - getValue(prev)) / dt : 0;
            };

            // Build a single-value bezier curve definition [cx1,cy1,cx2,cy2].
            const makeBezier1 = (
                t0: number, v0: number, tan0: number,
                t1: number, v1: number, tan1: number,
                clampMin?: number
            ): number[] => {
                const dt = t1 - t0;
                const third = dt / 3;
                const cp0v = clampMin !== undefined ? Math.max(clampMin, v0 + tan0 * third) : v0 + tan0 * third;
                const cp1v = clampMin !== undefined ? Math.max(clampMin, v1 - tan1 * third) : v1 - tan1 * third;
                return [t0 + third, cp0v, t1 - third, cp1v];
            };

            for (let k = 0; k < bakedKeys.length; k++) {
              const { frame, state } = bakedKeys[k];
              const time = frame / 24;

              // Used real opacity from material instead of forcing fade
              const finalAlpha = Math.floor(Math.max(0, Math.min(1, state.opacity)) * 255).toString(16).padStart(2, '0');
              
              const isLastKey = k === bakedKeys.length - 1;
              const steppedDef = { curve: "stepped" };

              // ── Translate bezier (Catmull-Rom tangents from position data) ──
              let translateCurveDefinition: any = steppedDef;
              if (!isLastKey) {
                  const nextObj = bakedKeys[k + 1];
                  const nextTime = nextObj.frame / 24;
                  const getX = (bk: BakedKey) => bk.state.position.x * 10;
                  const getY = (bk: BakedKey) => bk.state.position.y * 10;
                  const tanX0 = crTangent(bakedKeys, k,     getX) * 10;
                  const tanX1 = crTangent(bakedKeys, k + 1, getX) * 10;
                  const tanY0 = crTangent(bakedKeys, k,     getY) * 10;
                  const tanY1 = crTangent(bakedKeys, k + 1, getY) * 10;
                  const bx = makeBezier1(time, getX(bakedKeys[k]), tanX0, nextTime, getX(nextObj), tanX1);
                  const by = makeBezier1(time, getY(bakedKeys[k]), tanY0, nextTime, getY(nextObj), tanY1);
                  translateCurveDefinition = { curve: [...bx, ...by] };
              }

              // ── RGBA bezier on alpha channel (smooth fade) ──
              let rgbaCurveDefinition: any = steppedDef;
              if (!isLastKey) {
                  const nextObj = bakedKeys[k + 1];
                  const nextTime = nextObj.frame / 24;
                  const getA = (bk: BakedKey) => Math.max(0, Math.min(1, bk.state.opacity));
                  const tanA0 = crTangent(bakedKeys, k,     getA);
                  const tanA1 = crTangent(bakedKeys, k + 1, getA);
                  // rgba curve = [r0..3, g4..7, b8..11, a12..15]; r/g/b are constant 1→1 so use linear ctrl pts
                  const linearChannel = [time, 1, nextTime, 1];
                  const ba = makeBezier1(time, getA(bakedKeys[k]), tanA0, nextTime, getA(nextObj), tanA1, 0);
                  rgbaCurveDefinition = { curve: [...linearChannel, ...linearChannel, ...linearChannel, ...ba] };
              }

              slotAnim.rgba.push({ time, color: `ffffff${finalAlpha}`, ...rgbaCurveDefinition });

              boneAnim.translate.push({
                 time,
                 x: state.position.x * 10,
                 y: state.position.y * 10,
                 ...translateCurveDefinition
              });

              // ── Scale bezier (Catmull-Rom tangents) ──
              const sizeScale = Math.max(0.05, state.size * (sceneSettings.exportProjectionMode === "orthographic" ? 10 : 4)) / 64;
              let scaleCurveDefinition: any = steppedDef;
              if (!isLastKey) {
                  const nextObj = bakedKeys[k + 1];
                  const nextTime = nextObj.frame / 24;
                  const scaleOf = (bk: BakedKey) => Math.max(0.01, Math.max(0.05, bk.state.size * (sceneSettings.exportProjectionMode === "orthographic" ? 10 : 4)) / 64);
                  const tan0 = crTangent(bakedKeys, k,     scaleOf);
                  const tan1 = crTangent(bakedKeys, k + 1, scaleOf);
                  const bs = makeBezier1(time, scaleOf(bakedKeys[k]), tan0, nextTime, scaleOf(nextObj), tan1, 0.01);
                  // x and y are identical — duplicate the same bezier
                  scaleCurveDefinition = { curve: [...bs, ...bs] };
              }

              boneAnim.scale.push({
                 time,
                 x: sizeScale,
                 y: sizeScale,
                 ...scaleCurveDefinition
              });

              // ── Rotate bezier (Catmull-Rom tangents) ──
              let rotateCurveDefinition: any = steppedDef;
              if (!isLastKey) {
                  const nextObj = bakedKeys[k + 1];
                  const nextTime = nextObj.frame / 24;
                  const getRot = (bk: BakedKey) => bk.state.rotation * -(180 / Math.PI);
                  const tanR0 = crTangent(bakedKeys, k,     getRot);
                  const tanR1 = crTangent(bakedKeys, k + 1, getRot);
                  const br = makeBezier1(time, getRot(bakedKeys[k]), tanR0, nextTime, getRot(nextObj), tanR1);
                  rotateCurveDefinition = { curve: br };
              }

              boneAnim.rotate.push({
                 time,
                 value: state.rotation * -(180 / Math.PI),
                 ...rotateCurveDefinition
              });
            }

            // Death invisible frame toggle visibility
            const deathFrame = life[life.length - 1].frame;
            slotAnim.rgba.push({ time: (deathFrame + 1) / 24, color: 'ffffff00', curve: "stepped" });
            boneAnim.scale.push({ time: (deathFrame + 1) / 24, x: 0, y: 0, curve: "stepped" });
            boneAnim.rotate.push({ time: (deathFrame + 1) / 24, value: 0, curve: "stepped" });
            slotAnim.attachment.push({ time: (deathFrame + 1) / 24, name: null });
          }

          
          if (options?.sequenceMode) {
            const seqIn = options.timelineIn || 0;
            const seqLoopStart = options.loopStart || 60;
            const seqLoopEnd = options.loopEnd || 180;
            const seqOut = options.timelineOut || 240;

            const sliceAnim = (anim: any, startFrame: number, endFrame: number) => {
                const startTime = startFrame / 24;
                const endTime = endFrame / 24;
                const filterCurve = (arr: any[]) => {
                    const filtered = arr.filter(k => k.time >= startTime && k.time <= endTime);
                    return filtered.map(k => {
                        const newK = { ...k, time: k.time - startTime };
                        return newK;
                    });
                };
                return {
                    translate: filterCurve(anim.translate || []),
                    scale: filterCurve(anim.scale || []),
                    rotate: filterCurve(anim.rotate || [])
                };
            };
            const sliceSlot = (anim: any, startFrame: number, endFrame: number) => {
                const startTime = startFrame / 24;
                const endTime = endFrame / 24;
                const filterCurve = (arr: any[]) => {
                    const filtered = arr.filter(k => k.time >= startTime && k.time <= endTime);
                    return filtered.map(k => ({ ...k, time: k.time - startTime }));
                };
                const res: any = {
                    rgba: filterCurve(anim.rgba || []),
                    attachment: filterCurve(anim.attachment || [])
                };
                if (anim.particle && anim.particle.sequence) {
                    res.particle = { sequence: filterCurve(anim.particle.sequence) };
                }
                return res;
            };

            spineData.animations["intro"].bones[boneName] = sliceAnim(boneAnim, seqIn, seqLoopStart);
            spineData.animations["intro"].slots[slotName] = sliceSlot(slotAnim, seqIn, seqLoopStart);
            if (sequenceAnim) {
                if (!spineData.animations["intro"].attachments["default"][slotName]) spineData.animations["intro"].attachments["default"][slotName] = {};
                spineData.animations["intro"].attachments["default"][slotName]["particle"] = { sequence: sliceSlot({particle: {sequence: sequenceAnim}}, seqIn, seqLoopStart).particle?.sequence || [] };
            }

            spineData.animations["loop"].bones[boneName] = sliceAnim(boneAnim, seqLoopStart, seqLoopEnd);
            spineData.animations["loop"].slots[slotName] = sliceSlot(slotAnim, seqLoopStart, seqLoopEnd);
            if (sequenceAnim) {
                if (!spineData.animations["loop"].attachments["default"][slotName]) spineData.animations["loop"].attachments["default"][slotName] = {};
                spineData.animations["loop"].attachments["default"][slotName]["particle"] = { sequence: sliceSlot({particle: {sequence: sequenceAnim}}, seqLoopStart, seqLoopEnd).particle?.sequence || [] };
            }

            // outro start time should match seqLoopEnd start to seqOut end.
            spineData.animations["outro"].bones[boneName] = sliceAnim(boneAnim, seqLoopEnd, seqOut);
            spineData.animations["outro"].slots[slotName] = sliceSlot(slotAnim, seqLoopEnd, seqOut);
            if (sequenceAnim) {
                if (!spineData.animations["outro"].attachments["default"][slotName]) spineData.animations["outro"].attachments["default"][slotName] = {};
                spineData.animations["outro"].attachments["default"][slotName]["particle"] = { sequence: sliceSlot({particle: {sequence: sequenceAnim}}, seqLoopEnd, seqOut).particle?.sequence || [] };
            }
          } else {
             spineData.animations.animation.bones[boneName] = boneAnim;
             spineData.animations.animation.slots[slotName] = slotAnim;
          }

      });

      return spineData;
    }
  }));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: sceneSettings.backgroundColor }}>
      {sceneSettings.referenceImage && (
        <img
          src={sceneSettings.referenceImage}
          alt="Reference Background"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: sceneSettings.referenceOpacity ?? 0.5,
            zIndex: 0,
            pointerEvents: 'none'
          }}
        />
      )}
      <div className="scene-canvas" ref={containerRef} tabIndex={0} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'auto' }} />
      <div
        ref={marqueeRef}
        style={{
          display: 'none',
          position: 'absolute',
          border: '1px dashed #ffffff',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          pointerEvents: 'none',
          zIndex: 3,
        }}
      />
      <div
        className="viewport-shelf"
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 2,
          display: 'flex',
          gap: '15px',
          background: 'rgba(30, 30, 30, 0.8)',
          padding: '10px 15px',
          borderRadius: '8px',
          color: 'white',
          alignItems: 'center',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          pointerEvents: 'auto'
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
          <input
            type="checkbox"
            checked={sceneSettings.showGrid ?? true}
            onChange={(e) => onUpdateSceneSettings?.({ showGrid: e.target.checked })}
          /> Grid
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
          <input
            type="checkbox"
            checked={sceneSettings.showObjects ?? true}
            onChange={(e) => onUpdateSceneSettings?.({ showObjects: e.target.checked })}
          /> Objects
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
          <input
            type="checkbox"
            checked={sceneSettings.showParticles ?? true}
            onChange={(e) => onUpdateSceneSettings?.({ showParticles: e.target.checked })}
          /> Particles
        </label>

        <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.2)' }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', cursor: 'pointer' }}>
          Ref Img:
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = (re) => onUpdateSceneSettings?.({ referenceImage: re.target?.result as string });
                reader.readAsDataURL(file);
              } else {
                onUpdateSceneSettings?.({ referenceImage: null });
              }
            }}
          />
          <span style={{ background: '#444', padding: '2px 6px', borderRadius: '4px' }}>Browse</span>
        </label>

        {sceneSettings.referenceImage && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
            Opacity:
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={sceneSettings.referenceOpacity ?? 0.5}
              onChange={(e) => onUpdateSceneSettings?.({ referenceOpacity: parseFloat(e.target.value) })}
              style={{ width: '60px' }}
            />
          </label>
        )}
      </div>
    </div>
  );
});


