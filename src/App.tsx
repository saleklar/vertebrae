import { generateFireSequenceHeadless, defaultTorchParams, defaultCampfireParams } from './FireHeadless';
import { defaultLightningOpts, LightningGenOptions, exportLightningHierarchyToSpine } from './LightningGenerator';
import { exportSaberToSpine } from './SaberExporter';
import JSZip from 'jszip';
import * as THREE from 'three';
import { loadImagesFromDB, saveImageToDB, deleteImageFromDB, StoredImage } from './imageStorage';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Scene3D, Scene3DRef, SpineAttachmentInfo, SpineFrameOverrides, TintStop } from './Scene3D';
import { MarkingMenu, MarkingMenuItem } from './MarkingMenu';
import { Animator3D } from './Animator3D';
import { CurveEditor } from './CurveEditor';
import { ParticleCreator } from './ParticleCreator';

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
  particleLivePreview?: boolean;
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
  snapTo3DObject?: boolean;
  snap3DTarget?: 'face' | 'vertex';
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
  reverseFlow?: boolean; // For flow-curve: reverse path direction
  twist?: number; // For flow-curve: spiral rotation of particles around path tangent (degrees per loop)
  falloff?: number; // For flow-curve: % of path length after which force weakens (0–100)
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


export type EmitterObject = SceneObject & {
  type: 'Emitter';
  properties: {
    emissionRate: number;
    emissionMode?: 'surface' | 'volume' | 'edge';
    layerImageDataUrl?: string;
    particleLifetime: number;
    particleSpeed: number;
    particleColor: string;
    particleSize: number;
    particleOpacity: number;
    particleType: "dots" | "stars" | "circles" | "glow-circles" | "sparkle" | "glitter" | "sprites" | "3d-model" | "volumetric-fire";
    particleGlow: boolean;
    particleBlendMode?: string;
    particleRotation: number;
    particleRotationVariation: number;
    particleRotationSpeed: number;
    particleRotationSpeedVariation: number;
    particleRotationDrift?: number;
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
    particleTintGradient?: TintStop[];
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
  particleLivePreview: true,
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
  snapTo3DObject: false,
  snap3DTarget: 'face',
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

// ─── Spine import helpers ────────────────────────────────────────────────────

/** Cubic bezier solver (Newton-Raphson, 8 iterations). Control points in normalized 0-1 space. */
function solveBezierModule(cx1: number, cy1: number, cx2: number, cy2: number, x: number): number {
  let t = x;
  for (let i = 0; i < 8; i++) {
    const mt = 1 - t;
    const bx = 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t * t * t;
    const dbx = 3 * mt * mt * cx1 + 6 * mt * t * (cx2 - cx1) + 3 * t * t * (1 - cx2);
    if (Math.abs(dbx) < 1e-6) break;
    t -= (bx - x) / dbx;
    t = Math.max(0, Math.min(1, t));
  }
  const mt = 1 - t;
  return 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t;
}

/**
 * CurveTimeline1 (single-axis: translatex/y, rotate, scaleX/Y):
 * cy values are RAW property values, not normalized.
 * Bezier is parametric: P0=(0,fromVal) P1=(cx1,cy1) P2=(cx2,cy2) P3=(1,toVal).
 * Find parameter s such that Px(s)=rawT, return Py(s).
 */
function evalCurveTimeline1(cx1: number, cy1: number, cx2: number, cy2: number, rawT: number, fromVal: number, toVal: number): number {
  let s = rawT;
  for (let i = 0; i < 8; i++) {
    const sm = 1 - s;
    const px = 3 * sm * sm * s * cx1 + 3 * sm * s * s * cx2 + s * s * s;
    const dpx = 3 * sm * sm * cx1 + 6 * sm * s * (cx2 - cx1) + 3 * s * s * (1 - cx2);
    if (Math.abs(dpx) < 1e-6) break;
    s -= (px - rawT) / dpx;
    s = Math.max(0, Math.min(1, s));
  }
  const sm = 1 - s;
  return sm * sm * sm * fromVal + 3 * sm * sm * s * cy1 + 3 * sm * s * s * cy2 + s * s * s * toVal;
}

/** Apply Spine CurveTimeline2 curve to a raw linear t value (cy values ARE normalized 0-1). */
function applySpineCurve(curve: any, rawT: number): number {
  if (!curve || curve === 'linear') return rawT;
  if (curve === 'stepped') return 0;
  if (Array.isArray(curve) && curve.length >= 4)
    return solveBezierModule(curve[0], curve[1], curve[2], curve[3], rawT);
  return rawT;
}

/** Interpolate a single-value Spine CurveTimeline1 (rotate / translatex / translatey / scaleX / scaleY). */
function spineInterpolateSingle(timeline: any[], time: number, defaultVal: number, valueKey = 'value'): number {
  if (!timeline || timeline.length === 0) return defaultVal;
  if (time <= (timeline[0].time ?? 0)) return timeline[0][valueKey] ?? defaultVal;
  const last = timeline[timeline.length - 1];
  if (time >= (last.time ?? 0)) return last[valueKey] ?? defaultVal;
  for (let i = 0; i < timeline.length - 1; i++) {
    const a = timeline[i], b = timeline[i + 1];
    if (time >= (a.time ?? 0) && time < (b.time ?? 0)) {
      const fromVal = a[valueKey] ?? defaultVal;
      const toVal = b[valueKey] ?? defaultVal;
      if (a.curve === 'stepped') return fromVal;
      const rawT = (time - (a.time ?? 0)) / ((b.time ?? 0) - (a.time ?? 0));
      if (Array.isArray(a.curve) && a.curve.length >= 4) {
        // CurveTimeline1: cy values are raw property values, use 2D parametric bezier
        return evalCurveTimeline1(a.curve[0], a.curve[1], a.curve[2], a.curve[3], rawT, fromVal, toVal);
      }
      return fromVal + (toVal - fromVal) * rawT;
    }
  }
  return last[valueKey] ?? defaultVal;
}

function spineInterpolateTranslate(timeline: any[], time: number): { x: number; y: number } {
  if (!timeline || timeline.length === 0) return { x: 0, y: 0 };
  if (time <= (timeline[0].time ?? 0)) return { x: timeline[0].x ?? 0, y: timeline[0].y ?? 0 };
  const last = timeline[timeline.length - 1];
  if (time >= (last.time ?? 0)) return { x: last.x ?? 0, y: last.y ?? 0 };
  for (let i = 0; i < timeline.length - 1; i++) {
    const a = timeline[i], b = timeline[i + 1];
    if (time >= (a.time ?? 0) && time < (b.time ?? 0)) {
      const ax = a.x ?? 0, bx = b.x ?? 0, ay = a.y ?? 0, by = b.y ?? 0;
      if (a.curve === 'stepped') return { x: ax, y: ay };
      const rawT = (time - (a.time ?? 0)) / ((b.time ?? 0) - (a.time ?? 0));
      if (Array.isArray(a.curve) && a.curve.length >= 8) {
        // CurveTimeline2: 8 values, cy are raw property values, separate bezier per axis
        return {
          x: evalCurveTimeline1(a.curve[0], a.curve[1], a.curve[2], a.curve[3], rawT, ax, bx),
          y: evalCurveTimeline1(a.curve[4], a.curve[5], a.curve[6], a.curve[7], rawT, ay, by),
        };
      } else if (Array.isArray(a.curve) && a.curve.length >= 4) {
        return {
          x: evalCurveTimeline1(a.curve[0], a.curve[1], a.curve[2], a.curve[3], rawT, ax, bx),
          y: evalCurveTimeline1(a.curve[0], a.curve[1], a.curve[2], a.curve[3], rawT, ay, by),
        };
      }
      return { x: ax + (bx - ax) * rawT, y: ay + (by - ay) * rawT };
    }
  }
  return { x: last.x ?? 0, y: last.y ?? 0 };
}

function spineInterpolateRotate(timeline: any[], time: number): number {
  return spineInterpolateSingle(timeline, time, 0, 'value');
}

function spineInterpolateScale(timeline: any[], time: number): { x: number; y: number } {
  if (!timeline || timeline.length === 0) return { x: 1, y: 1 };
  if (time <= (timeline[0].time ?? 0)) return { x: timeline[0].x ?? 1, y: timeline[0].y ?? 1 };
  const last = timeline[timeline.length - 1];
  if (time >= (last.time ?? 0)) return { x: last.x ?? 1, y: last.y ?? 1 };
  for (let i = 0; i < timeline.length - 1; i++) {
    const a = timeline[i], b = timeline[i + 1];
    if (time >= (a.time ?? 0) && time < (b.time ?? 0)) {
      const ax = a.x ?? 1, bx = b.x ?? 1, ay = a.y ?? 1, by = b.y ?? 1;
      if (a.curve === 'stepped') return { x: ax, y: ay };
      const rawT = (time - (a.time ?? 0)) / ((b.time ?? 0) - (a.time ?? 0));
      if (Array.isArray(a.curve) && a.curve.length >= 8) {
        // CurveTimeline2: 8 values, cy are raw property values, separate bezier per axis
        return {
          x: evalCurveTimeline1(a.curve[0], a.curve[1], a.curve[2], a.curve[3], rawT, ax, bx),
          y: evalCurveTimeline1(a.curve[4], a.curve[5], a.curve[6], a.curve[7], rawT, ay, by),
        };
      } else if (Array.isArray(a.curve) && a.curve.length >= 4) {
        return {
          x: evalCurveTimeline1(a.curve[0], a.curve[1], a.curve[2], a.curve[3], rawT, ax, bx),
          y: evalCurveTimeline1(a.curve[0], a.curve[1], a.curve[2], a.curve[3], rawT, ay, by),
        };
      }
      return { x: ax + (bx - ax) * rawT, y: ay + (by - ay) * rawT };
    }
  }
  return { x: last.x ?? 1, y: last.y ?? 1 };
}

function spineBoneWorldTransform(
  boneName: string,
  boneMap: Map<string, any>,
  animBones: Record<string, any>,
  time: number,
  cache?: Map<string, { wx: number; wy: number; wRot: number; wSX: number; wSY: number }>
): { wx: number; wy: number; wRot: number; wSX: number; wSY: number } {
  const cacheKey = boneName;
  if (cache?.has(cacheKey)) return cache.get(cacheKey)!;

  const boneDef = boneMap.get(boneName);
  if (!boneDef) return { wx: 0, wy: 0, wRot: 0, wSX: 1, wSY: 1 };

  // Guard against cyclic bone hierarchy — insert sentinel before recursing
  const SENTINEL = { wx: 0, wy: 0, wRot: 0, wSX: 1, wSY: 1 };
  cache?.set(cacheKey, SENTINEL);

  const animBone = animBones?.[boneName];

  // Spine 4.x separate-axis translate timelines: key names are lowercase "translatex" / "translatey"
  // Also allow "x"/"y" and "translateX"/"translateY" for other format variants
  let trans: { x: number; y: number };
  const hasTranslate = (animBone?.translate?.length ?? 0) > 0;
  const sepTX = animBone?.translatex ?? animBone?.translateX ?? animBone?.x;
  const sepTY = animBone?.translatey ?? animBone?.translateY ?? animBone?.y;
  const hasSepX = (sepTX?.length ?? 0) > 0;
  const hasSepY = (sepTY?.length ?? 0) > 0;
  if (hasSepX || hasSepY) {
    const baseXY = hasTranslate ? spineInterpolateTranslate(animBone.translate, time) : { x: 0, y: 0 };
    trans = {
      x: hasSepX ? spineInterpolateSingle(sepTX, time, 0, 'value') : baseXY.x,
      y: hasSepY ? spineInterpolateSingle(sepTY, time, 0, 'value') : baseXY.y,
    };
  } else {
    trans = hasTranslate ? spineInterpolateTranslate(animBone.translate, time) : { x: 0, y: 0 };
  }

  const rot = spineInterpolateRotate(animBone?.rotate ?? [], time);

  // Spine 4.x separate-axis scale timelines use key "scaleX" / "scaleY" (capitalized)
  let scl: { x: number; y: number };
  const hasScale = (animBone?.scale?.length ?? 0) > 0;
  const sepSX = animBone?.scaleX;
  const sepSY = animBone?.scaleY;
  const hasSepSX = (sepSX?.length ?? 0) > 0;
  const hasSepSY = (sepSY?.length ?? 0) > 0;
  if (hasSepSX || hasSepSY) {
    const baseXY = hasScale ? spineInterpolateScale(animBone.scale, time) : { x: 1, y: 1 };
    scl = {
      x: hasSepSX ? spineInterpolateSingle(sepSX, time, 1, 'value') : baseXY.x,
      y: hasSepSY ? spineInterpolateSingle(sepSY, time, 1, 'value') : baseXY.y,
    };
  } else {
    scl = hasScale ? spineInterpolateScale(animBone.scale, time) : { x: 1, y: 1 };
  }

  const localX = (boneDef.x ?? 0) + trans.x;
  const localY = (boneDef.y ?? 0) + trans.y;
  const localRot = (boneDef.rotation ?? 0) + rot;
  const localSX = (boneDef.scaleX ?? 1) * scl.x;
  const localSY = (boneDef.scaleY ?? 1) * scl.y;

  let result: { wx: number; wy: number; wRot: number; wSX: number; wSY: number };

  if (!boneDef.parent) {
    result = { wx: localX, wy: localY, wRot: localRot, wSX: localSX, wSY: localSY };
  } else {
    const parent = spineBoneWorldTransform(boneDef.parent, boneMap, animBones, time, cache);
    const pRad = parent.wRot * Math.PI / 180;
    const cos = Math.cos(pRad), sin = Math.sin(pRad);
    result = {
      wx: parent.wx + (localX * cos - localY * sin) * parent.wSX,
      wy: parent.wy + (localX * sin + localY * cos) * parent.wSY,
      wRot: parent.wRot + localRot,
      wSX: parent.wSX * localSX,
      wSY: parent.wSY * localSY,
    };
  }

  cache?.set(cacheKey, result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────

function SpiralPropertiesPanel({
  objectId,
  initialTurns,
  initialDiameter,
  initialCW,
  onRegenerate,
}: {
  objectId: string;
  initialTurns: number;
  initialDiameter: number;
  initialCW: boolean;
  onRegenerate: (id: string, turns: number, diameter: number, cw: boolean) => void;
}) {
  const [turns,    setTurns]    = React.useState(initialTurns);
  const [diameter, setDiameter] = React.useState(initialDiameter);
  const [cw,       setCW]       = React.useState(initialCW);
  React.useEffect(() => {
    setTurns(initialTurns);
    setDiameter(initialDiameter);
    setCW(initialCW);
  }, [objectId]);
  return (
    <>
      <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '6px', color: '#7ab8f5' }}>🌀 Spiral Parameters</div>
      <label>Turns: {turns}</label>
      <input type="range" min={0.5} max={20} step={0.5} value={turns}
        onChange={e => setTurns(Number(e.target.value))} />
      <input type="number" min={0.5} max={20} step={0.5} value={turns}
        onChange={e => setTurns(Math.max(0.5, Number(e.target.value)))}
        style={{ width: '70px', marginBottom: '6px' }} />
      <label>Diameter: {diameter}</label>
      <input type="range" min={10} max={2000} step={10} value={diameter}
        onChange={e => setDiameter(Number(e.target.value))} />
      <input type="number" min={10} max={2000} step={10} value={diameter}
        onChange={e => setDiameter(Math.max(10, Number(e.target.value)))}
        style={{ width: '70px', marginBottom: '6px' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400 }}>
        <input type="checkbox" checked={cw} onChange={e => setCW(e.target.checked)} />
        Clockwise
      </label>
      <button type="button"
        onClick={() => onRegenerate(objectId, turns, diameter, cw)}
        style={{ marginTop: '6px', padding: '4px 12px', background: '#3e7de8', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600, width: '100%' }}>
        Regenerate
      </button>
    </>
  );
}

export function App() {
  const [spriteLibrary, setSpriteLibrary] = useState<StoredImage[]>([]);
  const [customFlamePresets, setCustomFlamePresets] = useState<{label: string; emoji: string; tendrilDensity: number; props: any}[]>(() => {
    try { return JSON.parse(localStorage.getItem('v_customFlamePresets') || '[]'); } catch(e) { return []; }
  });
  useEffect(() => {
    loadImagesFromDB().then((imgs) => setSpriteLibrary(imgs));
  }, []);
    // Add state for Bezier curve drawing mode
    const [drawBezierCurveMode, setDrawBezierCurveMode] = useState(false);
    const [bezierSurfaceObjectId, setBezierSurfaceObjectId] = useState<string | null>(null);
    // Vine generator state
    const [showVinePanel, setShowVinePanel] = useState(false);
    const [vineNumPoints, setVineNumPoints] = useState(9);
    const [vineLength, setVineLength] = useState(120);
    const [vineCurliness, setVineCurliness] = useState(0.55);
  const [appMode, setAppMode] = useState<'particle-system' | '3d-animator'>('particle-system');
  const [showScenePropertiesPanel, setShowScenePropertiesPanel] = useState(true);
  const [leftPanelTab, setLeftPanelTab] = useState<'scene' | 'hierarchy' | 'spine'>('hierarchy');

  // Spine import state
  type ImportedSpineSource = {
    json: any;
    images: Record<string, string>; // basename-no-ext → data URL
    boneIdMap: Record<string, string>; // bone name → scene obj id
    fileName: string;
  };
  const [importedSpineSource, setImportedSpineSource] = useState<ImportedSpineSource | null>(null);
  const [activeSpineAnimation, setActiveSpineAnimation] = useState<string | null>(null);
  const [activeSpineSkin, setActiveSpineSkin] = useState<string | null>(null);
  const [spineLayerSpread, setSpineLayerSpread] = useState(0);
  const [renamingObjectId, setRenamingObjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [collapsedHierarchyIds, setCollapsedHierarchyIds] = useState<Set<string>>(new Set);
  const [hierarchyHiddenTypes, setHierarchyHiddenTypes] = useState<Set<string>>(new Set<string>());
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showPresetsMenu, setShowPresetsMenu] = useState(false);
  const [showCreateSubmenu, setShowCreateSubmenu] = useState<'Shapes' | 'Modifiers' | 'Presets' | null>(null);
  const [activeShelfTab, setActiveShelfTab] = useState<'Objects' | '3D' | '2D' | 'Curves' | 'Modifiers' | 'Particle Systems' | 'FX' | null>('Objects');
  const [spiralDialog, setSpiralDialog] = useState<{ turns: number; diameter: number; cw: boolean } | null>(null);
  const [viewportSeqDialog, setViewportSeqDialog] = useState<{
    lightningId: string;
    name: string;
    width: number;
    height: number;
    frameCount: number;
    fps: number;
    mode: string;
    rendering: boolean;
  } | null>(null);
  const [renderFramePreview, setRenderFramePreview] = useState<{
    width: number; height: number; frameCount: number; fps: number;
  } | null>(null);
  const [showPrefsSubmenu, setShowPrefsSubmenu] = useState(false);
  const [guiScale, setGuiScaleState] = useState<number>(() => {
    try { const v = localStorage.getItem('vertebrae_gui_scale'); return v ? parseFloat(v) : 1.0; } catch { return 1.0; }
  });
  const setGuiScale = (v: number) => { setGuiScaleState(v); try { localStorage.setItem('vertebrae_gui_scale', String(v)); } catch {} };
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [draftSize, setDraftSize] = useState<SceneSize>(DEFAULT_SCENE_SIZE);
  const [particleCameraState, setParticleCameraState] = useState<{position: THREE.Vector3, quaternion: THREE.Quaternion} | null>(null);
  const [drawMode, setDrawMode] = useState(false);

  // Handler to enable Bezier curve drawing mode
  const importModelInputRef = useRef<HTMLInputElement>(null);
  const importCurveInputRef = useRef<HTMLInputElement>(null);

  const buildSpiralPts = useCallback((
    turns: number,
    diameter: number,
    cw: boolean,
  ): { x: number; y: number; z: number }[] => {
    const R = diameter / 2;
    const steps = Math.max(24, Math.round(turns * 24));
    const dir = cw ? 1 : -1;
    return Array.from({ length: steps }, (_, i) => {
      const t = (i / (steps - 1)) * turns * Math.PI * 2 * dir;
      const r = (i / (steps - 1)) * R;
      return { x: Math.cos(t - Math.PI / 2) * r, y: 0, z: Math.sin(t - Math.PI / 2) * r };
    });
  }, []);

  const handleCreateSpiral = useCallback((
    turns: number,
    diameter: number,
    cw: boolean,
  ) => {
    const pts = buildSpiralPts(turns, diameter, cw);
    const pathId = 'spiral_' + Date.now();
    const pathObject: SceneObject = {
      id: pathId,
      name: 'Spiral Path',
      type: 'Path',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      parentId: null,
      properties: { spiralShape: true, spiralTurns: turns, spiralDiameter: diameter, spiralCW: cw },
    };
    const pointObjects: SceneObject[] = pts.map((pt, i) => ({
      id: 'spiralpt_' + Date.now() + '_' + i,
      name: 'Point ' + i,
      type: 'PathPoint',
      position: { x: pt.x, y: pt.y, z: pt.z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      parentId: pathId,
      properties: {},
    }));
    setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);
    setSelectedObjectId(pathId);
    setShowScenePropertiesPanel(true);
    setSpiralDialog(null);
  }, [buildSpiralPts]);

  const handleRegenerateSpiral = useCallback((
    pathId: string,
    turns: number,
    diameter: number,
    cw: boolean,
  ) => {
    const pts = buildSpiralPts(turns, diameter, cw);
    setSceneObjects(prev => {
      // remove old PathPoints belonging to this path
      const filtered = prev.filter(o => !(o.type === 'PathPoint' && o.parentId === pathId));
      // update spiral properties on the Path node
      const withProps = filtered.map(o =>
        o.id === pathId
          ? { ...o, properties: { ...(o.properties as any), spiralShape: true, spiralTurns: turns, spiralDiameter: diameter, spiralCW: cw } }
          : o
      );
      // insert new points right after the path in the list
      const pathIdx = withProps.findIndex(o => o.id === pathId);
      const newPoints: SceneObject[] = pts.map((pt, i) => ({
        id: 'spiralpt_' + Date.now() + '_' + i,
        name: 'Point ' + i,
        type: 'PathPoint',
        position: { x: pt.x, y: pt.y, z: pt.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: pathId,
        properties: {},
      }));
      return pathIdx >= 0
        ? [...withProps.slice(0, pathIdx + 1), ...newPoints, ...withProps.slice(pathIdx + 1)]
        : [...withProps, ...newPoints];
    });
  }, [buildSpiralPts]);
  const handleImportModelFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['obj','fbx','gltf','glb'].includes(ext)) { alert('Supported formats: OBJ, FBX, GLTF, GLB'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const id = 'model_' + Date.now();
      setSceneObjects(prev => [...prev, {
        id,
        name: file.name.replace(/\.[^.]+$/, ''),
        type: 'ImportedModel',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: null,
        properties: { importedModelDataUrl: dataUrl, importedModelFormat: ext },
      }]);
      setSelectedObjectId(id);
      setShowScenePropertiesPanel(true);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const handleImportCurveFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['svg', 'ai'].includes(ext)) { alert('Supported formats: SVG, AI (SVG-based)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      let svgText = text;
      // AI files are often SVG with a different extension
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const pathEls = Array.from(doc.querySelectorAll('path'));
      if (pathEls.length === 0) { alert('No path elements found in the file.'); return; }

      // Tokenise an SVG path 'd' attribute into flat points (polyline approximation)
      const parseSvgPathToPoints = (d: string): { x: number; z: number }[] => {
        const pts: { x: number; z: number }[] = [];
        const nums = (s: string) => s.trim().split(/[\s,]+/).map(Number);
        // Split into commands
        const cmds = d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) ?? [];
        let cx = 0, cy = 0;
        for (const cmd of cmds) {
          const type = cmd[0];
          const args = nums(cmd.slice(1));
          switch (type) {
            case 'M': for (let i = 0; i < args.length; i += 2) { cx = args[i]; cy = args[i+1]; pts.push({ x: cx, z: cy }); } break;
            case 'm': for (let i = 0; i < args.length; i += 2) { cx += args[i]; cy += args[i+1]; pts.push({ x: cx, z: cy }); } break;
            case 'L': for (let i = 0; i < args.length; i += 2) { cx = args[i]; cy = args[i+1]; pts.push({ x: cx, z: cy }); } break;
            case 'l': for (let i = 0; i < args.length; i += 2) { cx += args[i]; cy += args[i+1]; pts.push({ x: cx, z: cy }); } break;
            case 'H': for (let i = 0; i < args.length; i++) { cx = args[i]; pts.push({ x: cx, z: cy }); } break;
            case 'h': for (let i = 0; i < args.length; i++) { cx += args[i]; pts.push({ x: cx, z: cy }); } break;
            case 'V': for (let i = 0; i < args.length; i++) { cy = args[i]; pts.push({ x: cx, z: cy }); } break;
            case 'v': for (let i = 0; i < args.length; i++) { cy += args[i]; pts.push({ x: cx, z: cy }); } break;
            case 'C': for (let i = 0; i < args.length; i += 6) { cx = args[i+4]; cy = args[i+5]; pts.push({ x: cx, z: cy }); } break;
            case 'c': for (let i = 0; i < args.length; i += 6) { cx += args[i+4]; cy += args[i+5]; pts.push({ x: cx, z: cy }); } break;
            case 'S': case 'Q': for (let i = 0; i < args.length; i += 4) { cx = args[i+2]; cy = args[i+3]; pts.push({ x: cx, z: cy }); } break;
            case 's': case 'q': for (let i = 0; i < args.length; i += 4) { cx += args[i+2]; cy += args[i+3]; pts.push({ x: cx, z: cy }); } break;
            case 'T': for (let i = 0; i < args.length; i += 2) { cx = args[i]; cy = args[i+1]; pts.push({ x: cx, z: cy }); } break;
            case 't': for (let i = 0; i < args.length; i += 2) { cx += args[i]; cy += args[i+1]; pts.push({ x: cx, z: cy }); } break;
            case 'Z': case 'z': if (pts.length > 0) pts.push({ ...pts[0] }); break;
          }
        }
        return pts;
      };

      const svgViewBox = doc.querySelector('svg')?.getAttribute('viewBox');
      const vb = svgViewBox ? svgViewBox.split(/[\s,]+/).map(Number) : null;
      const vbW = vb ? vb[2] : 500;
      const vbH = vb ? vb[3] : 500;
      const scale = 160 / Math.max(vbW, vbH);

      pathEls.forEach((pathEl, pi) => {
        const d = pathEl.getAttribute('d') ?? '';
        if (!d.trim()) return;
        const raw = parseSvgPathToPoints(d);
        if (raw.length < 2) return;
        // Centre + scale
        const xs = raw.map(p => p.x), zs = raw.map(p => p.z);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minZ = Math.min(...zs), maxZ = Math.max(...zs);
        const cxC = (minX + maxX) / 2, czC = (minZ + maxZ) / 2;
        const pts3d = raw.map(p => ({
          x: (p.x - cxC) * scale,
          y: 0,
          z: (p.z - czC) * scale,
        }));
        const pathId = 'svgpath_' + Date.now() + '_' + pi;
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const pathObject: SceneObject = {
          id: pathId,
          name: pathEls.length > 1 ? `${baseName} Path ${pi + 1}` : `${baseName} Path`,
          type: 'Path',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          parentId: null,
          properties: {},
        };
        const pointObjects: SceneObject[] = pts3d.map((pt, i) => ({
          id: 'svgpt_' + Date.now() + '_' + pi + '_' + i,
          name: 'Point ' + i,
          type: 'PathPoint',
          position: { x: pt.x, y: pt.y, z: pt.z },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          parentId: pathId,
          properties: {},
        }));
        setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);
        setSelectedObjectId(pathId);
        setShowScenePropertiesPanel(true);
      });
    };
    reader.readAsText(file);
  }, []);

  const handleStartDrawBezierCurve = useCallback(() => {
    setDrawBezierCurveMode(true);
  }, []);

  // Handler to exit Bezier curve drawing mode (could be called from Scene3D or UI)
    const handleFinishDrawBezierCurve = useCallback((points?: {x:number, y:number, z:number}[]) => {
      setDrawBezierCurveMode(false);
      setBezierSurfaceObjectId(null);
      if (!points || points.length < 2) return;
      
      const pathId = 'drawn_bezier_' + Date.now();
      const pathObject: SceneObject = {
        id: pathId,
        name: 'Manual Bezier Path',
        type: 'Path',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: null,
        properties: { }
        };

        const pointObjects: SceneObject[] = points.map((pt, i) => ({
        id: 'bezier_pt_' + Date.now() + '_' + i,
        name: 'Point ' + i,
        type: 'PathPoint',
        position: { x: pt.x, y: pt.y, z: pt.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: pathId,
        properties: {}
      }));
      
      setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);
    }, []);

  /** Generate a closed or open bezier path from a named 2-D shape preset */
  const handleCreateBezierShape = useCallback((shape: string) => {
    const R = 80; // base radius / half-size in world units
    let pts: { x: number; y: number; z: number }[] = [];
    const ring = (n: number, rx: number, rz: number, startAngle = -Math.PI / 2) =>
      Array.from({ length: n }, (_, i) => {
        const a = startAngle + (i / n) * Math.PI * 2;
        return { x: Math.cos(a) * rx, y: 0, z: Math.sin(a) * rz };
      });

    switch (shape) {
      case 'BZ Circle':
        pts = ring(24, R, R);
        break;
      case 'BZ Ellipse':
        pts = ring(24, R * 1.5, R * 0.65);
        break;
      case 'BZ Square': {
        const h = R * 0.9;
        pts = [
          { x: -h, y: 0, z: -h }, { x:  h, y: 0, z: -h },
          { x:  h, y: 0, z:  h }, { x: -h, y: 0, z:  h },
        ];
        break;
      }
      case 'BZ Rectangle': {
        const w = R * 1.4, d = R * 0.7;
        pts = [
          { x: -w, y: 0, z: -d }, { x:  w, y: 0, z: -d },
          { x:  w, y: 0, z:  d }, { x: -w, y: 0, z:  d },
        ];
        break;
      }
      case 'BZ Triangle':
        pts = ring(3, R, R);
        break;
      case 'BZ Diamond':
        pts = ring(4, R, R, 0);
        break;
      case 'BZ Pentagon':
        pts = ring(5, R, R);
        break;
      case 'BZ Hexagon':
        pts = ring(6, R, R, 0);
        break;
      case 'BZ Octagon':
        pts = ring(8, R, R, -Math.PI / 8);
        break;
      case 'BZ Star': {
        const n = 5, inner = R * 0.4;
        pts = Array.from({ length: n * 2 }, (_, i) => {
          const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
          const r = i % 2 === 0 ? R : inner;
          return { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r };
        });
        break;
      }
      case 'BZ Star 6': {
        const n = 6, inner = R * 0.45;
        pts = Array.from({ length: n * 2 }, (_, i) => {
          const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
          const r = i % 2 === 0 ? R : inner;
          return { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r };
        });
        break;
      }
      case 'BZ Cross': {
        const a = R * 0.35, b = R;
        pts = [
          { x: -a, y: 0, z: -b }, { x:  a, y: 0, z: -b },
          { x:  a, y: 0, z: -a }, { x:  b, y: 0, z: -a },
          { x:  b, y: 0, z:  a }, { x:  a, y: 0, z:  a },
          { x:  a, y: 0, z:  b }, { x: -a, y: 0, z:  b },
          { x: -a, y: 0, z:  a }, { x: -b, y: 0, z:  a },
          { x: -b, y: 0, z: -a }, { x: -a, y: 0, z: -a },
        ];
        break;
      }
      case 'BZ Arrow': {
        pts = [
          { x:  0,        y: 0, z: -R       },
          { x:  R * 0.6,  y: 0, z: -R * 0.2 },
          { x:  R * 0.25, y: 0, z: -R * 0.2 },
          { x:  R * 0.25, y: 0, z:  R * 0.5 },
          { x: -R * 0.25, y: 0, z:  R * 0.5 },
          { x: -R * 0.25, y: 0, z: -R * 0.2 },
          { x: -R * 0.6,  y: 0, z: -R * 0.2 },
        ];
        break;
      }
      case 'BZ Heart': {
        const steps = 32;
        pts = Array.from({ length: steps }, (_, i) => {
          const t = (i / steps) * Math.PI * 2 - Math.PI / 2;
          const hx = R * 0.7 * Math.pow(Math.sin(t), 3);
          const hy = -R * 0.7 * (0.8125 * Math.cos(t) - 0.3125 * Math.cos(2 * t) - 0.125 * Math.cos(3 * t) - 0.0625 * Math.cos(4 * t));
          return { x: hx, y: 0, z: hy };
        });
        break;
      }
      case 'BZ Spiral': {
        const turns = 3, steps = 48;
        pts = Array.from({ length: steps }, (_, i) => {
          const t = (i / (steps - 1)) * turns * Math.PI * 2;
          const r = (i / (steps - 1)) * R;
          return { x: Math.cos(t - Math.PI / 2) * r, y: 0, z: Math.sin(t - Math.PI / 2) * r };
        });
        break;
      }
      case 'BZ Wave': {
        const steps = 32;
        pts = Array.from({ length: steps }, (_, i) => {
          const tx = (i / (steps - 1)) * R * 2 - R;
          const tz = Math.sin((i / (steps - 1)) * Math.PI * 4) * R * 0.4;
          return { x: tx, y: 0, z: tz };
        });
        break;
      }
      default:
        return;
    }

    if (pts.length < 2) return;

    // Close loops for closed shapes (everything except spiral, wave, arrow)
    const openShapes = ['BZ Spiral', 'BZ Wave', 'BZ Arrow'];
    if (!openShapes.includes(shape)) pts.push({ ...pts[0] }); // close loop

    // Straight-sided shapes should render as sharp polylines, not smooth splines
    const linearShapes = ['BZ Square', 'BZ Rectangle', 'BZ Triangle', 'BZ Diamond',
      'BZ Pentagon', 'BZ Hexagon', 'BZ Octagon', 'BZ Star', 'BZ Star 6', 'BZ Cross', 'BZ Arrow'];
    const isLinear = linearShapes.includes(shape);

    const pathId = 'bzshape_' + shape.replace(/\s/g, '_') + '_' + Date.now();
    const pathObject: SceneObject = {
      id: pathId,
      name: shape.replace('BZ ', '') + ' Path',
      type: 'Path',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      parentId: null,
      properties: isLinear ? { linear: true } : {},
    };
    const pointObjects: SceneObject[] = pts.map((pt, i) => ({
      id: 'bzpt_' + Date.now() + '_' + i,
      name: 'Point ' + i,
      type: 'PathPoint',
      position: { x: pt.x, y: pt.y, z: pt.z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      parentId: pathId,
      properties: {},
    }));
    setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);
    setSelectedObjectId(pathId);
    setShowScenePropertiesPanel(true);
  }, []);
  const applySpineJson = useCallback((
    spineJson: any,
    fileName: string,
    images: Record<string, string> = {},
    existingBoneIdMap?: Record<string, string>,
    animOverride?: string
  ): Record<string, string> | null => {
    try {
    if (!spineJson.bones || !Array.isArray(spineJson.bones)) {
      if (!spineJson.skeleton && !spineJson.slots && !spineJson.skins) {
        alert('Invalid Spine JSON: no "bones", "slots", or "skins" found. Make sure to select your Spine project folder.');
        return null;
      }
      // bones may be absent in some exports — default to empty
      spineJson.bones = spineJson.bones ?? [];
    }
    const fps: number = Math.max(1, Math.min(120, spineJson.skeleton?.fps ?? 24));
    const boneMap = new Map<string, any>();
    for (const bone of spineJson.bones) boneMap.set(bone.name, bone);

    const animEntries = spineJson.animations ? Object.entries(spineJson.animations) : [];
    const animName: string | null = animOverride ?? (animEntries.length > 0 ? (animEntries[0][0] as string) : null);
    const animData: any = animName ? ((spineJson.animations as any)[animName] ?? null) : null;
    const animBones: Record<string, any> = animData?.bones ?? {};

    let maxTime = 0;
    for (const ba of Object.values(animBones) as any[]) {
      // Include all possible timeline keys — combined and separate-axis (Spine 4.x uses lowercase "translatex"/"translatey")
      for (const tl of [
        ba.translate, ba.translatex, ba.translatey, ba.translateX, ba.translateY, ba.x, ba.y,
        ba.rotate, ba.scale, ba.scaleX, ba.scaleY, ba.shearX, ba.shearY,
      ] as any[][]) {
        if (Array.isArray(tl) && tl.length > 0) {
          const t = tl[tl.length - 1].time ?? 0;
          if (Number.isFinite(t)) maxTime = Math.max(maxTime, t);
        }
      }
    }
    // Also scan slot timelines (attachment, rgba) so totalFrames isn't clipped short
    const animSlotData: Record<string, any> = animData?.slots ?? {};
    for (const sa of Object.values(animSlotData) as any[]) {
      for (const tl of [sa.attachment, sa.rgba, sa.color] as any[][]) {
        if (Array.isArray(tl) && tl.length > 0) {
          const t = tl[tl.length - 1].time ?? 0;
          if (Number.isFinite(t)) maxTime = Math.max(maxTime, t);
        }
      }
    }
    // Hard cap: never bake more than 3600 frames (~2.5 min @ 24fps) to prevent OOM / hangs on bad data
    const totalFrames = maxTime > 0 ? Math.min(Math.ceil(maxTime * fps), 3600) : 0;

    const now = Date.now();
    const boneIdMapLocal: Record<string, string> = existingBoneIdMap ? { ...existingBoneIdMap } : {};
    if (!existingBoneIdMap) {
      for (const bone of spineJson.bones) {
        boneIdMapLocal[bone.name] = `bone_${bone.name.replace(/\W+/g, '_')}_${now}`;
      }
    }
    const switchingAnim = !!existingBoneIdMap;

    const newObjects: SceneObject[] = [];
    if (!switchingAnim) {
      for (const bone of spineJson.bones) {
        const id = boneIdMapLocal[bone.name];
        const parentId = bone.parent ? (boneIdMapLocal[bone.parent] ?? null) : null;
        const w = spineBoneWorldTransform(bone.name, boneMap, {}, 0, new Map());
        newObjects.push({
          id, name: bone.name, type: 'Bone',
          position: { x: w.wx, y: w.wy, z: 0 },
          rotation: { x: 0, y: 0, z: (w.wRot * Math.PI) / 180 },
          scale: { x: w.wSX, y: w.wSY, z: 1 },
          parentId, properties: {},
        });
      }
    }

    const newKeyframes: ObjectKeyframes = {};
    if (animName && totalFrames > 0) {
      for (const bone of spineJson.bones) {
        if (!animBones[bone.name]) continue;
        const id = boneIdMapLocal[bone.name];
        const w0 = spineBoneWorldTransform(bone.name, boneMap, {}, 0, new Map());
        const baseObj: SceneObject = switchingAnim
          ? { id, name: bone.name, type: 'Bone', position: { x: w0.wx, y: w0.wy, z: 0 }, rotation: { x: 0, y: 0, z: (w0.wRot * Math.PI) / 180 }, scale: { x: w0.wSX, y: w0.wSY, z: 1 }, parentId: null, properties: {} }
          : newObjects.find((o) => o.id === id)!;
        newKeyframes[id] = {};
        for (let f = 0; f <= totalFrames; f++) {
          const t = f / fps;
          const w = spineBoneWorldTransform(bone.name, boneMap, animBones, t, new Map());
          newKeyframes[id][f] = {
            ...baseObj,
            position: { x: w.wx, y: w.wy, z: 0 },
            rotation: { x: 0, y: 0, z: (w.wRot * Math.PI) / 180 },
            scale: { x: w.wSX, y: w.wSY, z: 1 },
          };
        }
      }
    }

    if (!switchingAnim) {
      setSceneObjects((prev) => [...prev.filter((o) => o.type !== 'Bone'), ...newObjects]);
    }
    if (Object.keys(newKeyframes).length > 0) {
      if (switchingAnim) {
        setKeyframes((prev) => {
          const next = { ...prev };
          for (const id of Object.values(boneIdMapLocal)) delete next[id];
          return { ...next, ...newKeyframes };
        });
      } else {
        setKeyframes((prev) => ({ ...prev, ...newKeyframes }));
      }
      setTimelineOut((prev) => Math.max(prev, totalFrames));
    }

    setImportedSpineSource({ json: spineJson, images, boneIdMap: boneIdMapLocal, fileName });
    setActiveSpineAnimation(animName);
    if (!existingBoneIdMap) setActiveSpineSkin(null); // reset skin on fresh import
    setLeftPanelTab('spine');
    setShowScenePropertiesPanel(true);
    setShowFileMenu(false);

    if (!switchingAnim) {
      const kfCount = Object.keys(newKeyframes).length;
      alert(
        `Imported ${newObjects.length} bone${newObjects.length !== 1 ? 's' : ''} from "${fileName}"` +
        (animName ? ` (animation: "${animName}", ${totalFrames} frames, ${kfCount} animated bones)` : '') + '.'
      );
    }
    return boneIdMapLocal;
    } catch (err: any) {
      console.error('[applySpineJson] crash:', err);
      alert('Spine import crashed:\n' + (err?.stack ?? err?.message ?? String(err)));
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImportSpine = useCallback(async () => {
    // ── Electron path ──
    if ((window as any).vertebrae?.importSpineFile) {
      const result = await (window as any).vertebrae.importSpineFile();
      if (!result.success) {
        if (result.error !== 'Cancelled') alert('Spine import error: ' + result.error);
        return;
      }
      try {
        applySpineJson(JSON.parse(result.jsonString), result.fileName ?? 'spine export', result.images ?? {});
      } catch (err: any) {
        console.error('[handleImportSpine] crash:', err);
        alert('Error parsing exported Spine JSON:\n' + (err?.stack ?? err?.message ?? String(err)));
      }
      return;
    }

    // ── Browser fallback: Spine CLI is required; only works in Electron ──
    alert('Importing .spine files requires the Electron desktop app.\nPlease run Vertebrae as the desktop application, not in a plain browser.');
  }, [applySpineJson]);

  const switchSpineAnimation = useCallback((animName: string) => {
    if (!importedSpineSource) return;
    const { json, images, boneIdMap, fileName } = importedSpineSource;
    applySpineJson(json, fileName, images, boneIdMap, animName);
  }, [importedSpineSource, applySpineJson]);

  // ── Derive list of skin names from imported Spine source ──
  const spineSkinNames = useMemo((): string[] => {
    if (!importedSpineSource) return [];
    const rawSkins = importedSpineSource.json.skins;
    if (Array.isArray(rawSkins)) return rawSkins.map((s: any) => s.name).filter(Boolean);
    if (rawSkins && typeof rawSkins === 'object') return Object.keys(rawSkins);
    return [];
  }, [importedSpineSource]);

  const handleExportSpine = async () => {
    if (!scene3DRef.current) return;
    const spineData = scene3DRef.current.exportSpineData({ excludeIds: [...spineExcludedObjectIds] });
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
  const [quadViewport, setQuadViewport] = useState(false);
  const [manipulatorMode, setManipulatorMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [lookThroughCamera, setLookThroughCamera] = useState(false);
  const [showCaptureOverlay, setShowCaptureOverlay] = useState(false);
  const [capturePadding, setCapturePadding] = useState(0.3);
  const [manualCropRect, setManualCropRect] = useState<{left:number;top:number;width:number;height:number}|null>(null);
  const [markingMenu, setMarkingMenu] = useState<null | { x: number; y: number; type: 'tool' | 'context'; panel?: 'top' | 'front' | 'side' | 'perspective' }>(null);
  const [quadPanelViews, setQuadPanelViews] = useState<{ top: 'perspective'|'x'|'y'|'z'; front: 'perspective'|'x'|'y'|'z'; side: 'perspective'|'x'|'y'|'z'; perspective: 'perspective'|'x'|'y'|'z' }>({ top: 'y', front: 'z', side: 'x', perspective: 'perspective' });
  const markingMenuHoveredRef = useRef<MarkingMenuItem | null>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const spaceHoldRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; menuShown: boolean }>({ timer: null, menuShown: false });
  const [sceneObjects, setSceneObjects] = useState<SceneObject[]>([]);
  const [undoStack, setUndoStack] = useState<SceneObject[][]>([]);
  const [redoStack, setRedoStack] = useState<SceneObject[][]>([]);
  const isHistoryActionRef = useRef(false);
  const previousSceneObjectsRef = useRef<SceneObject[]>([]);
  const scene3DRef = useRef<Scene3DRef>(null);
  const spineInputRef = useRef<HTMLInputElement>(null);

  const handleExportLightningToSpine = useCallback(async () => {
    if (!selectedObjectId) return;
    const lObj = sceneObjects.find(o => o.id === selectedObjectId && o.type === 'Lightning');
    if (!lObj) return;
    const lp = (lObj.properties ?? {}) as any;
    const name = (lObj.name || 'lightning').replace(/\s+/g, '_').toLowerCase();
    const opts = { ...defaultLightningOpts(), ...lp };

    // ── Viewport PNG sequence — open settings dialog before rendering ─────────
    if ((lp.exportMode ?? 'sequence') === 'viewport-sequence') {
      setViewportSeqDialog({
        lightningId: lObj.id,
        name,
        width:       lp.viewportExportWidth  ?? 512,
        height:      lp.viewportExportHeight ?? 512,
        frameCount:  opts.frameCount,
        fps:         opts.fps,
        mode:        opts.mode ?? 'loop-strike',
        rendering:   false,
      });
      return;
    }

    // ── Spine hierarchy export ───────────────────────────────────────────────
    const children = sceneObjects.filter(o => o.parentId === lObj.id && o.type === 'LightningPoint');
    const startPt = children.find(o => (o.properties as any)?.role === 'start');
    const endPt   = children.find(o => (o.properties as any)?.role === 'end');
    if (!startPt || !endPt) { alert('Lightning is missing Start or End points.'); return; }

    let result: ReturnType<typeof exportLightningHierarchyToSpine> | null = null;
    try {
      result = exportLightningHierarchyToSpine(
        startPt.position.x, startPt.position.y,
        endPt.position.x,   endPt.position.y,
        opts,
        name,
      );
    } catch (err: any) {
      console.error('Lightning export failed:', err);
      alert('Export failed: ' + (err?.message ?? String(err)));
      return;
    }

    const { spineJson, allSegmentFrames } = result;
    const jsonString = JSON.stringify(spineJson, null, 2);

    // Build asset list: JSON + one PNG per frame per segment
    const assets: { name: string; data: string; isText: boolean }[] = [
      { name: `${name}.json`, data: jsonString, isText: true },
    ];
    for (const [segKey, frames] of Object.entries(allSegmentFrames)) {
      frames.forEach((dataUrl, fi) => {
        const base64 = dataUrl.split(',')[1] ?? '';
        const fileName = `images/${name}/${segKey}${fi.toString().padStart(4, '0')}.png`;
        assets.push({ name: fileName, data: base64, isText: false });
      });
    }

    // Electron path
    if ((window as any).vertebrae?.isElectron && (window as any).vertebrae?.saveLightningExport) {
      const res = await (window as any).vertebrae.saveLightningExport({ assets, projectName: name });
      if (!res.success && res.error !== 'Cancelled') alert('Error saving: ' + res.error);
      return;
    }

    // Browser fallback — download zip
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const asset of assets) {
        if (asset.isText) {
          zip.file(asset.name, asset.data);
        } else {
          zip.file(asset.name, asset.data, { base64: true });
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}_spine_export.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('zip error:', err);
      alert('Error creating zip: ' + (err?.message ?? String(err)));
    }
  }, [selectedObjectId, sceneObjects]);

  const doViewportSeqExport = useCallback(async (
    lightningId: string,
    name: string,
    width: number,
    height: number,
    frameCount: number,
    fps: number,
    mode: string,
  ) => {
    setViewportSeqDialog(prev => prev ? { ...prev, rendering: true } : prev);
    let frames: string[] = [];
    try {
      if (!scene3DRef.current) throw new Error('Scene not ready.');
      frames = await scene3DRef.current.exportLightningSequenceFromViewport({
        lightningId,
        frameCount: Math.max(1, frameCount),
        fps,
        width,
        height,
        mode: mode as any,
      });
    } catch (err: any) {
      console.error('Viewport export failed:', err);
      alert('Viewport export failed: ' + (err?.message ?? String(err)));
      setViewportSeqDialog(prev => prev ? { ...prev, rendering: false } : prev);
      return;
    }
    setViewportSeqDialog(null);
    if (!frames.length) { alert('No frames captured.'); return; }

    const assets: { name: string; data: string; isText: boolean }[] = [];
    frames.forEach((dataUrl, fi) => {
      const base64 = dataUrl.split(',')[1] ?? '';
      assets.push({ name: `${name}${fi.toString().padStart(4, '0')}.png`, data: base64, isText: false });
    });

    if ((window as any).vertebrae?.isElectron && (window as any).vertebrae?.saveLightningExport) {
      const res = await (window as any).vertebrae.saveLightningExport({ assets, projectName: name });
      if (!res.success && res.error !== 'Cancelled') alert('Error saving: ' + res.error);
      return;
    }
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const asset of assets) zip.file(asset.name, asset.data, { base64: true });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}_viewport_sequence.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Error creating zip: ' + (err?.message ?? String(err)));
    }
  }, []);

  // Vine generator: auto-grow a bezier path on a surface
  const handleGenerateVine = useCallback(() => {
    if (!selectedObjectId) return;
    const pts = scene3DRef.current?.generateVineOnSurface(
      selectedObjectId,
      vineNumPoints,
      vineLength,
      vineCurliness,
    );
    if (!pts || pts.length < 2) return;
    setShowVinePanel(false);
    // Directly create bezier path objects (same logic as handleFinishDrawBezierCurve)
    const pathId = 'vine_bezier_' + Date.now();
    const pathObject: SceneObject = {
      id: pathId,
      name: 'Vine Path',
      type: 'Path',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      parentId: null,
      properties: {},
    };
    const pointObjects: SceneObject[] = pts.map((pt, i) => ({
      id: 'vine_pt_' + Date.now() + '_' + i,
      name: 'Point ' + i,
      type: 'PathPoint',
      position: { x: pt.x, y: pt.y, z: pt.z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      parentId: pathId,
      properties: {},
    }));
    setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);
    setSelectedObjectId(pathId);
  }, [selectedObjectId, vineNumPoints, vineLength, vineCurliness, setSceneObjects, setSelectedObjectId]);
  
  // Timeline state
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCaching, setIsCaching] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [playReverse, setPlayReverse] = useState(false);
  const [fps, setFps] = useState(24);
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
  const [showPathAnimation, setShowPathAnimation] = useState(false);
  const [showParticleCreator, setShowParticleCreator] = useState(false);
  const [physicsForces, setPhysicsForces] = useState<PhysicsForce[]>([]);
  const [showPhysicsPanel, setShowPhysicsPanel] = useState(false);
  const [selectedForceId, setSelectedForceId] = useState<string | null>(null);
  const [draggingForceId, setDraggingForceId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ sourceId: string; targetId: string; x: number; y: number } | null>(null);
  // IDs explicitly excluded from Spine animation export (all included by default)
  const [spineExcludedObjectIds, setSpineExcludedObjectIds] = useState<Set<string>>(new Set());
  const toggleSpineExclude = useCallback((id: string) => {
    setSpineExcludedObjectIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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

  // ── Derive stable set of attachment planes (no currentFrame dep → meshes created once) ──
  const spineAllAttachments = useMemo((): SpineAttachmentInfo[] => {
    try {
    if (!importedSpineSource) return [];
    const { json, images, boneIdMap } = importedSpineSource;
    const slots: any[] = json.slots ?? [];
    const rawImagesDir: string = json.skeleton?.images ?? '';
    const imagesDir = rawImagesDir.replace(/^\.\//,  '').replace(/\/$/, '');

    // Resolve skin attachments
    let skinAttachments: Record<string, Record<string, any>> = {};
    const rawSkins = json.skins;
    if (Array.isArray(rawSkins)) {
      const targetSkin = (activeSpineSkin ? rawSkins.find((s: any) => s.name === activeSpineSkin) : null)
        ?? rawSkins.find((s: any) => s.name === 'default')
        ?? rawSkins[0];
      const raw = targetSkin?.attachments;
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          const slotName = entry.slot ?? entry.name;
          const attName = entry.name ?? slotName;
          if (!skinAttachments[slotName]) skinAttachments[slotName] = {};
          skinAttachments[slotName][attName] = entry;
        }
      } else { skinAttachments = raw ?? {}; }
    } else if (rawSkins && typeof rawSkins === 'object') {
      const key = (activeSpineSkin && (rawSkins as any)[activeSpineSkin]) ? activeSpineSkin : 'default';
      skinAttachments = (rawSkins as any)[key] ?? Object.values(rawSkins as any)[0] ?? {};
    }

    const animData: any = activeSpineAnimation
      ? (json.animations?.[activeSpineAnimation] ?? null)
      : null;
    const animSlots: Record<string, any> = animData?.slots ?? {};

    const resolveImage = (attName: string, attPath?: string): string => {
      const candidates: string[] = [];
      const add = (p: string) => {
        candidates.push(p);
        if (imagesDir) candidates.push(`${imagesDir}/${p}`);
        candidates.push(p.replace(/\//g, '-'));
        candidates.push(p.split('/').pop() ?? p);
      };
      if (attPath) add(attPath);
      add(attName);
      const k = candidates.find((c) => c && images[c] !== undefined);
      return k ? images[k] : '';
    };

    const result: SpineAttachmentInfo[] = [];
    for (const [slotIndex, slot] of slots.entries()) {
      const slotSkinData = skinAttachments[slot.name];
      const boneObjectId: string | undefined = boneIdMap[slot.bone];
      if (!boneObjectId) continue;

      // When animation active, only include slots that appear in its attachment timelines
      let repAttName: string | undefined;
      if (animData) {
        const attachmentTL: any[] = animSlots[slot.name]?.attachment ?? [];
        if (!attachmentTL.length) continue;
        repAttName = attachmentTL.find((kf: any) => kf.name != null)?.name ?? undefined;
        if (!repAttName) continue; // all keyframes are null → slot is fully hidden this animation
      } else {
        repAttName = slot.attachment ?? (slotSkinData ? Object.keys(slotSkinData)[0] : undefined);
        if (!repAttName) continue;
      }

      const attachData: any = slotSkinData?.[repAttName] ?? {};
      const attType: string = attachData.type ?? 'region';
      if (attType !== 'region' && attType !== 'mesh' && attType !== 'sequence') continue;

      // Detect sequence attachment
      let seq: any = attachData.sequence;
      if (!seq && repAttName.endsWith('_') && slotSkinData) {
        const seqEntry = Object.values(slotSkinData).find((e: any) => e.sequence) as any;
        if (seqEntry) seq = seqEntry.sequence;
      }

      let sequenceFrames: string[] | undefined;
      let imageDataUrl: string;
      if (seq) {
        const { count = 1, start = 0, digits = 2 } = seq;
        sequenceFrames = [];
        const baseName = repAttName.endsWith('_') ? repAttName.slice(0, -1) : repAttName;
        for (let i = start; i < start + count; i++) {
          const frameNum = String(i).padStart(digits, '0');
          const frameName = `${baseName}_${frameNum}`;
          sequenceFrames.push(resolveImage(frameName));
        }
        imageDataUrl = sequenceFrames[0] ?? '';
      } else {
        imageDataUrl = resolveImage(repAttName, attachData.path);
      }

      result.push({
        id: `att_${slot.name}`,
        slotName: slot.name,
        boneObjectId,
        imageDataUrl,
        localX: attachData.x ?? 0,
        localY: attachData.y ?? 0,
        localRotationDeg: attachData.rotation ?? 0,
        width: attachData.width ?? 100,
        height: attachData.height ?? 100,
        scaleX: attachData.scaleX ?? 1,
        scaleY: attachData.scaleY ?? 1,
        sequenceFrames,
        slotIndex,
        blendMode: slot.blend ?? 'normal',
        color: slot.color ?? 'ffffffff',
      });
    }
    return result;
    } catch (err: any) {
      console.error('[spineAllAttachments] crash:', err);
      return [];
    }
  }, [importedSpineSource, activeSpineSkin, activeSpineAnimation]);

  // ── Spine keyframe interpolation helpers ──

  /** Solve cubic bezier for x → return y. cx1,cy1,cx2,cy2 are the two control points (0-1 space). */
  function solveBezier(cx1: number, cy1: number, cx2: number, cy2: number, x: number): number {
    // Newton-Raphson to find t given x, then compute y(t)
    let t = x;
    for (let i = 0; i < 8; i++) {
      const t2 = t * t; const t3 = t2 * t;
      const mt = 1 - t; const mt2 = mt * mt; const mt3 = mt2 * mt;
      const bx = 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t3;
      const dbx = 3 * mt2 * cx1 + 6 * mt * t * (cx2 - cx1) + 3 * t2 * (1 - cx2);
      if (Math.abs(dbx) < 1e-6) break;
      t -= (bx - x) / dbx;
      t = Math.max(0, Math.min(1, t));
    }
    const t2 = t * t; const t3 = t2 * t; const mt = 1 - t; const mt2 = mt * mt; const mt3 = mt2 * mt;
    return 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t3;
  }

  /** Get interpolation alpha [0..1] between two Spine keyframes at currentTimeSec. */
  function spineKfAlpha(kf: any, nextKf: any, currentTimeSec: number): number {
    const t0 = kf.time ?? 0;
    const t1 = nextKf.time ?? 0;
    if (t1 <= t0) return 1;
    const raw = Math.max(0, Math.min(1, (currentTimeSec - t0) / (t1 - t0)));
    const curve = kf.curve;
    if (!curve || curve === 'linear') return raw;
    if (curve === 'stepped') return 0;
    if (Array.isArray(curve) && curve.length === 4) {
      return solveBezier(curve[0], curve[1], curve[2], curve[3], raw);
    }
    return raw;
  }

  /** Interpolate two Spine RGBA hex strings ('rrggbbaa') using alpha t. */
  function lerpColor(a: string, b: string, t: number): [number, number, number, number] {
    const parse = (s: string, off: number) => parseInt(s.substring(off, off + 2), 16) / 255;
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return [
      lerp(parse(a, 0), parse(b, 0)),
      lerp(parse(a, 2), parse(b, 2)),
      lerp(parse(a, 4), parse(b, 4)),
      lerp(parse(a, 6), parse(b, 6)),
    ];
  }

  // ── Per-frame overrides: visibility + sequence frame index (fast, no mesh rebuilding) ──
  const spineFrameOverrides = useMemo((): SpineFrameOverrides => {
    try {
    if (!importedSpineSource || !spineAllAttachments.length) return {};
    const { json } = importedSpineSource;
    const animData: any = activeSpineAnimation
      ? (json.animations?.[activeSpineAnimation] ?? null)
      : null;
    if (!animData) {
      const result: SpineFrameOverrides = {};
      for (const att of spineAllAttachments) result[att.id] = { visible: true };
      return result;
    }
    const spineFps: number = json.skeleton?.fps ?? 24;
    const currentTimeSec = currentFrame / spineFps;
    const animSlots: Record<string, any> = animData.slots ?? {};
    const result: SpineFrameOverrides = {};
    for (const att of spineAllAttachments) {
      const attachmentTL: any[] = animSlots[att.slotName]?.attachment ?? [];
      if (!attachmentTL.length) { result[att.id] = { visible: false }; continue; }
      let activeName: string | null | undefined = undefined;
      let activeKfTime = 0;
      for (const kf of attachmentTL) {
        if ((kf.time ?? 0) <= currentTimeSec + 0.0001) {
          activeName = kf.name ?? null;
          activeKfTime = kf.time ?? 0;
        } else { break; }
      }
      if (activeName === undefined || activeName === null) {
        result[att.id] = { visible: false };
        continue;
      }
      let seqFrame: number | undefined;
      if (att.sequenceFrames && att.sequenceFrames.length > 0) {
        const elapsed = Math.max(0, currentTimeSec - activeKfTime);
        seqFrame = Math.floor(elapsed * spineFps) % att.sequenceFrames.length;
      }
      // Read per-frame slot color/alpha from rgba or color animation timeline with proper interpolation
      let alpha: number | undefined;
      let tintR: number | undefined;
      let tintG: number | undefined;
      let tintB: number | undefined;
      const rgbaTL: any[] = animSlots[att.slotName]?.rgba ?? animSlots[att.slotName]?.color ?? [];
      if (rgbaTL.length > 0) {
        let kfIdx = -1;
        for (let i = 0; i < rgbaTL.length; i++) {
          if ((rgbaTL[i].time ?? 0) <= currentTimeSec + 0.0001) kfIdx = i;
          else break;
        }
        if (kfIdx >= 0) {
          const kf = rgbaTL[kfIdx];
          const colorA: string = kf.color ?? 'ffffffff';
          let r: number, g: number, b: number, a: number;
          const nextKf = rgbaTL[kfIdx + 1];
          if (nextKf && kf.curve !== 'stepped' && colorA.length >= 8 && nextKf.color?.length >= 8) {
            const t = spineKfAlpha(kf, nextKf, currentTimeSec);
            [r, g, b, a] = lerpColor(colorA, nextKf.color, t);
          } else {
            r = parseInt(colorA.substring(0, 2), 16) / 255;
            g = parseInt(colorA.substring(2, 4), 16) / 255;
            b = parseInt(colorA.substring(4, 6), 16) / 255;
            a = parseInt(colorA.substring(6, 8), 16) / 255;
          }
          tintR = r; tintG = g; tintB = b; alpha = a;
        }
      }
      result[att.id] = { visible: true, seqFrame, alpha, tintR, tintG, tintB };
    }
    return result;
    } catch (err: any) {
      console.error('[spineFrameOverrides] crash:', err);
      return {};
    }
  }, [importedSpineSource, activeSpineSkin, activeSpineAnimation, currentFrame, spineAllAttachments]);

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
        properties: { }
        };

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

      setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);
      setSelectedObjectId(pathObject.id);
    }, []);




  const handleUpdateEmitterProperty = useCallback((property: string, value: number | string | boolean | string[]) => {
    if (!selectedObjectId) return;
    setSceneObjects(prev => prev.map(obj => {
      if (obj.id === selectedObjectId) {
          return {
            ...obj,
            properties: {
              ...(obj.properties || {}),
              [property]: value
            }
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
    if (!value) return '';
    return value
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }, []);

  useEffect(() => {
    let changed = false;
    const namesSeen = new Set<string>();
    
    const newForces = physicsForces.map(f => {
      let freshName = normalizeObjectName(f.name || '');
      if (!freshName) freshName = normalizeObjectName(f.type) || 'force';
      
      let newName = freshName;
      let counter = 1;
      const match = newName.match(/^(.*?)_([0-9]+)$/);
      let stem = newName;
      if (match) {
        stem = match[1];
        counter = parseInt(match[2], 10);
      }
      
      while (namesSeen.has(newName)) {
        newName = `${stem}_${counter}`;
        counter++;
      }
      namesSeen.add(newName);
      
      if (newName !== f.name) {
        changed = true;
        return { ...f, name: newName };
      }
      return f;
    });

    const newObjects = sceneObjects.map(o => {
      let freshName = normalizeObjectName(o.name || '');
      if (!freshName) freshName = normalizeObjectName(o.type) || 'object';
      
      let newName = freshName;
      let counter = 1;
      const match = newName.match(/^(.*?)_([0-9]+)$/);
      let stem = newName;
      if (match) {
        stem = match[1];
        counter = parseInt(match[2], 10);
      }
      
      while (namesSeen.has(newName)) {
        newName = `${stem}_${counter}`;
        counter++;
      }
      namesSeen.add(newName);
      
      if (newName !== o.name) {
        changed = true;
        return { ...o, name: newName };
      }
      return o;
    });

    if (changed) {
      setPhysicsForces(newForces);
      setSceneObjects(newObjects);
    }
  }, [sceneObjects, physicsForces, normalizeObjectName]);  const getObjectDisplayName = useCallback((obj: SceneObject) => {
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
      particleRotationDrift: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleRotationDrift ?? 0),
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
      particleTintGradient: (selectedObject.properties as EmitterObject['properties'] | undefined)?.particleTintGradient ?? undefined,
      particleSizeOverLife: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSizeOverLife ?? 'none'),
        particleSizeOverLifeCurve: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSizeOverLifeCurve ?? ''),
        particleOpacityOverLifeCurve: String((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleOpacityOverLifeCurve ?? ''),
        particleSeed: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.particleSeed ?? 0),
      showPathCurves: Boolean((selectedObject.properties as EmitterObject['properties'] | undefined)?.showPathCurves ?? false),
      pathCurveKeyCount: Number((selectedObject.properties as EmitterObject['properties'] | undefined)?.pathCurveKeyCount ?? 5),
      emitFromSpineAttachmentId: String((selectedObject.properties as any)?.emitFromSpineAttachmentId ?? ''),
    }
    : null;

  const selectedObjectIsEmitterChild = !!selectedObject?.parentId && sceneObjects.some((obj) => (
    obj.id === selectedObject.parentId && obj.type === 'Emitter'
  ));

  const selectedActsAsEmitterSource = !!selectedObject && selectedObject.type !== 'Emitter' && selectedObjectIsEmitterChild;



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
      position: objectType === 'Camera' ? { x: 0, y: 150, z: 400 } : { x: 0, y: 0, z: 0 },
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
        particleRotationSpeedVariation: 0,
        particleStretch: false,
        particleStretchAmount: 0.05,
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

      setSceneObjects((prev) => [...prev, newObject]);
      setSelectedObjectId(newObject.id);
      setShowCreateMenu(false);
      setShowPresetsMenu(false);
      return;
    }

    if (objectType === 'Camera') {
      newObject.properties = { fov: 75 };
      // Auto-create a movable CameraTarget child at the origin
      const targetObj: SceneObject = {
        id: `cameratarget_${Date.now() + 1}`,
        name: 'camera target',
        type: 'CameraTarget',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        parentId: newObject.id,
      };
      setSceneObjects((prev) => [...prev, newObject, targetObj]);
      setSelectedObjectId(newObject.id);
      setShowCreateMenu(false);
      return;
    }

    setSceneObjects((prev) => [...prev, newObject]);
    setSelectedObjectId(newObject.id);
    setShowCreateMenu(false);
  }, []);

    const [customPresets, setCustomPresets] = useState<Record<string, Record<string, any>>>(() => { try { const saved = localStorage.getItem('customEmitterPresets'); return saved ? JSON.parse(saved) : {}; } catch (e) { return {}; } });
  const handleSaveCustomPreset = useCallback(() => { const selectedObj = sceneObjects.find(obj => obj.id === selectedObjectId); if (!selectedObj || selectedObj.type !== 'Emitter') { alert('Please select an Emitter object to save its preset.'); return; } const presetName = prompt('Enter a name for the custom emitter preset (must be unique):'); if (!presetName || presetName.trim() === '') return; const savedProps = JSON.parse(JSON.stringify(selectedObj.properties)); setCustomPresets(prev => { const next = { ...prev, [presetName.trim()]: savedProps }; localStorage.setItem('customEmitterPresets', JSON.stringify(next)); return next; }); alert('Preset saved!'); }, [sceneObjects, selectedObjectId]);
  const handleLoadCustomPreset = useCallback((presetName: string) => { const props = customPresets[presetName]; if (!props) return; const newEmitter: SceneObject = { id: 'emitter_' + Date.now(), name: presetName, type: 'Emitter', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, parentId: null, properties: JSON.parse(JSON.stringify(props)) }; setSceneObjects((prev) => [...prev, newEmitter]); setSelectedObjectId(newEmitter.id); }, [customPresets]);

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

    // No EmitterShape creation

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

    setSceneObjects((prev) => [...prev, newEmitter]);
    setPhysicsForces((prev) => [...prev, windForce, turbulenceForce]);
    setSelectedObjectId(newEmitter.id);
    setShowCreateMenu(false);
    setShowCreateSubmenu(null);
  }, []);


  const handleCreateClassicPreset = useCallback((presetType: 'sparks' | 'smoke' | 'fire') => {
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

    // No EmitterShape creation

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
    // No EmitterShape added
    setSceneObjects(prev => [...prev, ...els]);

    const newForces: PhysicsForce[] = [];
    if (turbStrength !== 0) newForces.push(newForce);
    if (updraftStrength !== 0) newForces.push(newForce2);
    if (newForces.length > 0) {
      setPhysicsForces(prev => [...prev, ...newForces]);
    }
    setSelectedObjectId(newEmitter.id);
    setShowPresetsMenu(false);
  }, []);

  const handleCreateParticlePreset = useCallback((
    presetType: 'rain' | 'snow' | 'explosion' | 'confetti' | 'magic-dust' | 'bubbles' | 'fireflies' | 'embers' | 'galaxy' | 'mist'
  ) => {
    const mkCanvas = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const ctx = c.getContext('2d'); if (ctx) draw(ctx); return c.toDataURL();
    };
    const softSprite = (r: string, g: string, b: string) => mkCanvas(ctx => {
      const gr = ctx.createRadialGradient(32,32,0,32,32,32);
      gr.addColorStop(0,`rgba(${r},${g},${b},1)`); gr.addColorStop(1,`rgba(${r},${g},${b},0)`);
      ctx.fillStyle=gr; ctx.fillRect(0,0,64,64);
    });

    const emId = 'emitter_' + Date.now();
    let emProps: any = {};
    const forces: PhysicsForce[] = [];
    let name = '';

    if (presetType === 'rain') {
      name = 'Rain';
      emProps = {
        emissionRate: 500, particleType: 'sprites', particleSpriteImageDataUrl: softSprite('160','190','255'),
        particleLifetime: 1.8, particleLifetimeVariation: 0.4,
        particleSpeed: 8, particleSpeedVariation: 0.3,
        particleSize: 1.8, particleSizeVariation: 0.3,
        particleColor: '#b0d0ff', particleOpacity: 0.65, particleOpacityOverLife: true,
        particleSpreadAngle: 6, particleGlow: false, particleBlendMode: 'normal',
        particleStretch: true, particleStretchAmount: 0.4,
      };
      forces.push({ id:'f1_'+Date.now(), name:'Rain Gravity', type:'gravity', position:{x:0,y:0,z:0}, strength:4, radius:2000, affectedEmitterIds:[emId], enabled:true });
    } else if (presetType === 'snow') {
      name = 'Snow';
      emProps = {
        emissionRate: 60, particleType: 'glow-circles',
        particleLifetime: 5.0, particleLifetimeVariation: 0.5,
        particleSpeed: 6, particleSpeedVariation: 0.6,
        particleSize: 4, particleSizeVariation: 0.5,
        particleColor: '#ddefff', particleOpacity: 0.75, particleOpacityOverLife: true,
        particleSpreadAngle: 180, particleGlow: true, particleBlendMode: 'normal',
        particleRotationSpeed: 0.3, particleRotationVariation: 360,
      };
      forces.push({ id:'f1_'+Date.now(), name:'Snow Gravity', type:'gravity', position:{x:0,y:0,z:0}, strength:0.3, radius:2000, affectedEmitterIds:[emId], enabled:true });
      forces.push({ id:'f2_'+Date.now(), name:'Snow Drift', type:'turbulence', position:{x:0,y:0,z:0}, strength:2, radius:400, affectedEmitterIds:[emId], enabled:true });
    } else if (presetType === 'explosion') {
      name = 'Explosion';
      emProps = {
        emissionRate: 1200, particleType: 'sprites', particleSpriteImageDataUrl: softSprite('255','160','40'),
        particleLifetime: 0.9, particleLifetimeVariation: 0.5,
        particleSpeed: 140, particleSpeedVariation: 0.7,
        particleSize: 9, particleSizeVariation: 0.5,
        particleColor: '#ff8822', particleOpacity: 1.0, particleOpacityOverLife: true,
        particleColorOverLife: true, particleColorOverLifeTarget: '#440000',
        particleSizeOverLife: 'shrink', particleSpreadAngle: 180,
        particleGlow: true, particleBlendMode: 'lighter',
      };
      forces.push({ id:'f1_'+Date.now(), name:'Explosion Drag', type:'drag', position:{x:0,y:0,z:0}, strength:3, radius:2000, affectedEmitterIds:[emId], enabled:true });
    } else if (presetType === 'confetti') {
      name = 'Confetti';
      emProps = {
        emissionRate: 80, particleType: 'circles',
        particleLifetime: 4.0, particleLifetimeVariation: 0.6,
        particleSpeed: 20, particleSpeedVariation: 0.7,
        particleSize: 6, particleSizeVariation: 0.6,
        particleColor: '#ff66cc', particleColorVariation: 0.9,
        particleOpacity: 0.9, particleOpacityOverLife: true,
        particleSpreadAngle: 180, particleGlow: false, particleBlendMode: 'normal',
        particleRotationSpeed: 4, particleRotationVariation: 360, particleRotationSpeedVariation: 3,
      };
      forces.push({ id:'f1_'+Date.now(), name:'Confetti Gravity', type:'gravity', position:{x:0,y:0,z:0}, strength:0.6, radius:2000, affectedEmitterIds:[emId], enabled:true });
      forces.push({ id:'f2_'+Date.now(), name:'Confetti Drift', type:'turbulence', position:{x:0,y:0,z:0}, strength:4, radius:400, affectedEmitterIds:[emId], enabled:true });
    } else if (presetType === 'magic-dust') {
      name = 'Magic Dust';
      emProps = {
        emissionRate: 120, particleType: 'sparkle',
        particleLifetime: 2.2, particleLifetimeVariation: 0.5,
        particleSpeed: 14, particleSpeedVariation: 0.6,
        particleSize: 5, particleSizeVariation: 0.5,
        particleColor: '#aaddff', particleColorVariation: 0.7,
        particleOpacity: 0.9, particleOpacityOverLife: true,
        particleSpreadAngle: 120, particleGlow: true, particleBlendMode: 'lighter',
        particleRotationSpeed: 2, particleRotationVariation: 360,
      };
      forces.push({ id:'f1_'+Date.now(), name:'Magic Updraft', type:'thermal-updraft', position:{x:0,y:0,z:0}, strength:10, radius:300, affectedEmitterIds:[emId], enabled:true });
      forces.push({ id:'f2_'+Date.now(), name:'Magic Drift', type:'turbulence', position:{x:0,y:0,z:0}, strength:5, radius:200, affectedEmitterIds:[emId], enabled:true });
    } else if (presetType === 'bubbles') {
      name = 'Bubbles';
      emProps = {
        emissionRate: 25, particleType: 'glow-circles',
        particleLifetime: 3.5, particleLifetimeVariation: 0.4,
        particleSpeed: 12, particleSpeedVariation: 0.4,
        particleSize: 7, particleSizeVariation: 0.5,
        particleColor: '#88eeff', particleOpacity: 0.55,
        particleSizeOverLife: 'grow', particleOpacityOverLife: true,
        particleSpreadAngle: 30, particleGlow: true, particleBlendMode: 'normal',
      };
      forces.push({ id:'f1_'+Date.now(), name:'Bubble Drift', type:'turbulence', position:{x:0,y:0,z:0}, strength:3, radius:200, affectedEmitterIds:[emId], enabled:true });
    } else if (presetType === 'fireflies') {
      name = 'Fireflies';
      emProps = {
        emissionRate: 5, particleType: 'glow-circles',
        particleLifetime: 6.0, particleLifetimeVariation: 0.5,
        particleSpeed: 6, particleSpeedVariation: 0.8,
        particleSize: 5, particleSizeVariation: 0.3,
        particleColor: '#aaff44', particleColorVariation: 0.15,
        particleOpacity: 0.85, particleOpacityOverLife: true,
        particleSpreadAngle: 180, particleGlow: true, particleBlendMode: 'lighter',
      };
      forces.push({ id:'f1_'+Date.now(), name:'Firefly Wander', type:'turbulence', position:{x:0,y:0,z:0}, strength:4, radius:300, affectedEmitterIds:[emId], enabled:true });
      forces.push({ id:'f2_'+Date.now(), name:'Firefly Lift', type:'thermal-updraft', position:{x:0,y:0,z:0}, strength:3, radius:300, affectedEmitterIds:[emId], enabled:true });
    } else if (presetType === 'embers') {
      name = 'Embers';
      emProps = {
        emissionRate: 40, particleType: 'sprites', particleSpriteImageDataUrl: softSprite('255','120','20'),
        particleLifetime: 2.5, particleLifetimeVariation: 0.5,
        particleSpeed: 18, particleSpeedVariation: 0.5,
        particleSize: 2.5, particleSizeVariation: 0.4,
        particleColor: '#ff6600', particleColorVariation: 0.2,
        particleColorOverLife: true, particleColorOverLifeTarget: '#550000',
        particleOpacity: 0.9, particleOpacityOverLife: true,
        particleSpreadAngle: 45, particleGlow: true, particleBlendMode: 'lighter',
      };
      forces.push({ id:'f1_'+Date.now(), name:'Ember Updraft', type:'thermal-updraft', position:{x:0,y:0,z:0}, strength:14, radius:200, affectedEmitterIds:[emId], enabled:true });
      forces.push({ id:'f2_'+Date.now(), name:'Ember Turbulence', type:'turbulence', position:{x:0,y:0,z:0}, strength:8, radius:150, affectedEmitterIds:[emId], enabled:true });
    } else if (presetType === 'galaxy') {
      name = 'Galaxy';
      emProps = {
        emissionRate: 90, particleType: 'stars',
        particleLifetime: 5.0, particleLifetimeVariation: 0.6,
        particleSpeed: 8, particleSpeedVariation: 0.8,
        particleSize: 4, particleSizeVariation: 0.6,
        particleColor: '#88aaff', particleColorVariation: 0.4,
        particleOpacity: 0.8, particleOpacityOverLife: true,
        particleSpreadAngle: 180, particleGlow: true, particleBlendMode: 'lighter',
        particleRotationSpeed: 0.5, particleRotationVariation: 360,
      };
      forces.push({ id:'f1_'+Date.now(), name:'Galaxy Drift', type:'turbulence', position:{x:0,y:0,z:0}, strength:2, radius:500, affectedEmitterIds:[emId], enabled:true });
    } else if (presetType === 'mist') {
      name = 'Mist';
      emProps = {
        emissionRate: 20, particleType: 'sprites', particleSpriteImageDataUrl: softSprite('170','190','210'),
        particleLifetime: 6.0, particleLifetimeVariation: 0.4,
        particleSpeed: 4, particleSpeedVariation: 0.5,
        particleSize: 28, particleSizeVariation: 0.5,
        particleColor: '#aac0d0', particleOpacity: 0.22,
        particleSizeOverLife: 'grow', particleOpacityOverLife: true,
        particleSpreadAngle: 180, particleGlow: false, particleBlendMode: 'normal',
      };
      forces.push({ id:'f1_'+Date.now(), name:'Mist Drift', type:'wind', position:{x:0,y:0,z:0}, strength:2, radius:1000, direction:{x:1,y:0.1,z:0}, affectedEmitterIds:[emId], enabled:true });
      forces.push({ id:'f2_'+Date.now(), name:'Mist Turbulence', type:'turbulence', position:{x:0,y:0,z:0}, strength:1.5, radius:600, affectedEmitterIds:[emId], enabled:true });
    }

    const emitter: SceneObject = {
      id: emId, name, type: 'Emitter',
      position:{x:0,y:0,z:0}, rotation:{x:0,y:0,z:0}, scale:{x:1,y:1,z:1}, parentId: null,
      properties: emProps,
    };
    setSceneObjects(prev => [...prev, emitter]);
    if (forces.length > 0) setPhysicsForces(prev => [...prev, ...forces]);
    setSelectedObjectId(emId);
    setShowScenePropertiesPanel(true);
  }, []);


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

  const handleStartDragNode = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingNodeId(nodeId);
    setDragCursorPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleDropNode = useCallback((targetId: string, e: React.MouseEvent) => {
    if (!draggingNodeId || draggingNodeId === targetId) return;
    e.stopPropagation();
    setPendingDrop({ sourceId: draggingNodeId, targetId, x: e.clientX, y: e.clientY });
    setDraggingNodeId(null);
    setDragCursorPos(null);
  }, [draggingNodeId]);

  useEffect(() => {
    if (!draggingNodeId) return;
    const onMove = (e: MouseEvent) => setDragCursorPos({ x: e.clientX, y: e.clientY });
    const onUp = () => { setDraggingNodeId(null); setDragCursorPos(null); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [draggingNodeId]);

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

  // Track mouse position for Space hotbox
  useEffect(() => {
    const onMove = (e: MouseEvent) => { mousePosRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Context menu stays open until user clicks an item (onClick on items) or clicks the backdrop.

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

      // Escape: deselect current object / close marking menu
      if (event.key === 'Escape') {
        if (markingMenu) { setMarkingMenu(null); return; }
        setSelectedObjectId(null);
        return;
      }

      // Space: tap = toggle quad viewport; hold (>250 ms) = show hotbox marking menu
      if (key === ' ' && !event.repeat) {
        event.preventDefault();
        // If marking menu is already open, just close it — don't start timer or toggle viewport
        if (markingMenu) {
          setMarkingMenu(null);
          spaceHoldRef.current.menuShown = false;
          return;
        }
        spaceHoldRef.current.timer = setTimeout(() => {
          setMarkingMenu({ x: mousePosRef.current.x, y: mousePosRef.current.y, type: 'tool' });
          spaceHoldRef.current.menuShown = true;
          spaceHoldRef.current.timer = null;
        }, 250);
        return;
      }
      if (key === ' ' && event.repeat) { event.preventDefault(); return; }

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

    const handleKeyUp = (event: KeyboardEvent) => {
      const tgt = event.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      if (event.key === ' ') {
        event.preventDefault();
        if (spaceHoldRef.current.timer) {
          // Tapped — cancel timer, toggle quad viewport (only if menu is NOT open)
          clearTimeout(spaceHoldRef.current.timer);
          spaceHoldRef.current.timer = null;
          if (!markingMenu) setQuadViewport(prev => !prev);
        } else if (spaceHoldRef.current.menuShown) {
          // Released after hold — execute hovered item
          markingMenuHoveredRef.current?.action();
          setMarkingMenu(null);
          spaceHoldRef.current.menuShown = false;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleSave, handleSaveAs, handleOpen, handleUndo, handleRedo, handleDuplicateObject, handleDeleteObject, selectedObjectId, selectedKeyframeFrame, deleteKeyframeAtFrame, sceneObjects, startRenameObject, markingMenu]);

  const hierarchyChildrenByParent = useMemo(() => {
    return sceneObjects.reduce((acc, obj) => {
      let parentCandidate = obj.parentId;
      
      // Visually reparent dependencies (like fx attached to curves) to show up as children
      if (obj.properties) {
        if (obj.properties.targetPathId && obj.properties.targetPathId !== obj.id) parentCandidate = obj.properties.targetPathId as string;
        else if (obj.properties.curveId && obj.properties.curveId !== obj.id) parentCandidate = obj.properties.curveId as string;
      }

      let validParent = parentCandidate && sceneObjects.some((candidate) => candidate.id === parentCandidate)
        ? parentCandidate
        : null;
        
      // Prevent self-reference
      if (validParent === obj.id) validParent = null;

      // Prevent cyclic references from looping/breaking UI
      if (validParent) {
        let currentId = validParent;
        const visited = new Set<string>();
        while (currentId) {
          if (currentId === obj.id) {
            validParent = null; // Break cycle!
            break;
          }
          if (visited.has(currentId)) break;
          visited.add(currentId);
          const current = sceneObjects.find(o => o.id === currentId);
          if (!current) break;
          currentId = (current.properties?.targetPathId as string) 
            || (current.properties?.curveId as string) 
            || current.parentId as string;
        }
      }

      const list = acc.get(validParent) ?? [];
      list.push(obj);
      acc.set(validParent, list);
      return acc;
    }, new Map<string | null, SceneObject[]>());
  }, [sceneObjects]);

  hierarchyChildrenByParent.forEach((items) => {
    items.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  });

  const isDescendantOf = useCallback((nodeId: string, potentialAncestorId: string) => {
    let current = sceneObjects.find((obj) => obj.id === nodeId);
    const visited = new Set<string>();

    while (current) {
      const parentCandidate = (current.properties?.targetPathId as string) 
        || (current.properties?.curveId as string) 
        || current.parentId;

      if (!parentCandidate) break;

      if (parentCandidate === potentialAncestorId) {
        return true;
      }
      if (visited.has(parentCandidate)) {
        break;
      }
      visited.add(parentCandidate);
      current = sceneObjects.find((obj) => obj.id === parentCandidate);
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

  const getDropOptions = (sourceId: string, targetId: string) => {
    const source = sceneObjects.find(o => o.id === sourceId);
    const target = sceneObjects.find(o => o.id === targetId);
    if (!source || !target || sourceId === targetId) return [];
    const opts: { icon: string; label: string; action: () => void }[] = [];

    // Always available: simple re-parent
    opts.push({
      icon: '🔗',
      label: 'Parent — child follows target',
      action: () => { handleReparentObject(sourceId, targetId); setPendingDrop(null); },
    });

    // Any object → Emitter: become an emission shape
    if (target.type === 'Emitter') {
      opts.push({
        icon: '💥',
        label: 'Attach as emission shape',
        action: () => {
          setSceneObjects(prev => prev.map(o =>
            o.id === sourceId ? { ...o, parentId: targetId, type: 'EmitterShape' as any } : o
          ));
          setPendingDrop(null);
        },
      });
    }

    // Any object → Path: follow path animation
    if (target.type === 'Path') {
      opts.push({
        icon: '🛤️',
        label: 'Follow path',
        action: () => {
          setSceneObjects(prev => prev.map(o =>
            o.id === sourceId
              ? { ...o, properties: { ...(o.properties as any), pathAnimPathId: targetId } }
              : o
          ));
          setPendingDrop(null);
        },
      });
      if (source.type === 'Emitter') {
        opts.push({
          icon: '🌊',
          label: 'Emit along path',
          action: () => {
            setSceneObjects(prev => prev.map(o =>
              o.id === sourceId
                ? { ...o, properties: { ...(o.properties as any), pathAnimPathId: targetId, emissionMode: 'path' } }
                : o
            ));
            setPendingDrop(null);
          },
        });
      }
    }

    // Lightning / bezier path → Path: use path as lightning guide
    if (source.type === 'Lightning' && target.type === 'Path') {
      opts.push({
        icon: '⚡',
        label: 'Follow bezier (lightning guide)',
        action: () => {
          setSceneObjects(prev => prev.map(o =>
            o.id === sourceId
              ? { ...o, properties: { ...(o.properties as any), followBezierPathIds: [targetId] } }
              : o
          ));
          setPendingDrop(null);
        },
      });
    }

    return opts;
  };

  const renderHierarchyNode = (obj: SceneObject, depth = 0): React.ReactNode => {
    if (hierarchyHiddenTypes.has(obj.type)) return null;
    const children = hierarchyChildrenByParent.get(obj.id) ?? [];
    const isSelected = selectedObjectId === obj.id;
    const isRenaming = renamingObjectId === obj.id;
    const isCollapsed = collapsedHierarchyIds.has(obj.id);
    const toggleCollapse = (e: React.MouseEvent) => {
      e.stopPropagation();
      setCollapsedHierarchyIds(prev => {
        const next = new Set(prev);
        if (next.has(obj.id)) next.delete(obj.id); else next.add(obj.id);
        return next;
      });
    };
    const typeLabel = obj.type === 'EmitterShape' ? 'Shape' : obj.type === 'CameraTarget' ? 'Target' : obj.type;
    const typeColorClass = `type-${obj.type.toLowerCase()}`;
    const typeRowClass = `type-row-${obj.type.toLowerCase()}`;
    const parentObject = obj.parentId ? sceneObjects.find((candidate) => candidate.id === obj.parentId) : undefined;
    const parentCandidates = sceneObjects.filter((candidate) => (
      candidate.id !== obj.id && !isDescendantOf(candidate.id, obj.id)
    ));

    // Detect relationship kind for visual differentiation
    const objProps = obj.properties as any;
    let depClass = '';
    let depConnectorChar = '↳';
    let depConnectorColor = '#555';
    let depBadge: React.ReactNode = null;
    if (obj.type === 'CameraTarget') {
      depClass = 'dep-camera-target';
      depConnectorChar = '◎'; depConnectorColor = '#00ddff';
      depBadge = <span className="dep-badge camera-target">TARGET</span>;
    } else if (obj.type === 'EmitterShape') {
      depClass = 'dep-emitter-shape';
      depConnectorChar = '◆'; depConnectorColor = '#e8803a';
      depBadge = <span className="dep-badge emitter-shape">SHAPE OF</span>;
    } else if (objProps?.followBezierPathIds?.length > 0) {
      depClass = 'dep-lightning';
      depConnectorChar = '⚡'; depConnectorColor = '#f1c40f';
      depBadge = <span className="dep-badge lightning">GUIDED BY</span>;
    } else if (objProps?.pathAnimPathId && objProps?.emissionMode === 'path') {
      depClass = 'dep-emit-along';
      depConnectorChar = '⟿'; depConnectorColor = '#1abc9c';
      depBadge = <span className="dep-badge emit-along">EMITS ALONG</span>;
    } else if (objProps?.pathAnimPathId) {
      depClass = 'dep-follow-path';
      depConnectorChar = '⤷'; depConnectorColor = '#9b59b6';
      depBadge = <span className="dep-badge follow-path">FOLLOWS</span>;
    } else if (objProps?.targetPathId || objProps?.curveId) {
      depClass = 'dep-attached-fx';
      depConnectorChar = '✨'; depConnectorColor = '#eeb868';
      depBadge = <span className="dep-badge attached-fx">ATTACHED TO</span>;
    }
    const depConnector = depth > 0
      ? <span className="hierarchy-connector" style={{ color: depConnectorColor }}>{depConnectorChar}</span>
      : null;

    return (
      <React.Fragment key={obj.id}>
        {isRenaming ? (
          <div
            className={`hierarchy-item ${depClass} ${typeRowClass} ${isSelected ? 'selected' : ''}`}
            data-depth={depth}
            style={{ paddingLeft: '8px' }}
            title={obj.id}
          >
            {depConnector}
            <input
              type="checkbox"
              checked={!spineExcludedObjectIds.has(obj.id)}
              onChange={() => toggleSpineExclude(obj.id)}
              onClick={e => e.stopPropagation()}
              title="Include in Spine export"
              style={{ cursor: 'pointer', marginRight: 3, accentColor: '#7ecf9e', flexShrink: 0 }}
            />
            {children.length > 0 && (
              <button type="button" onClick={toggleCollapse}
                style={{ background: 'none', border: 'none', color: '#7a8a9a', cursor: 'pointer', fontSize: '0.62rem', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                title={isCollapsed ? 'Expand' : 'Collapse'}>
                {isCollapsed ? '▶' : '▼'}
              </button>
            )}
            <span className={`hierarchy-item-type ${typeColorClass}`}>{typeLabel}</span>
            {depBadge}
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
            {children.length > 0 && (
              <span className="hierarchy-item-children" style={{ cursor: 'default' }}>({children.length})</span>
            )}
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            className={`hierarchy-item ${depClass} ${typeRowClass} ${isSelected ? 'selected' : ''}`}
            data-depth={depth}
            style={{ paddingLeft: '8px' }}
            onClick={() => setSelectedObjectId(obj.id)}
            onMouseUp={(e) => handleDropNode(obj.id, e)}
            onMouseEnter={(e) => { if (draggingNodeId && draggingNodeId !== obj.id) e.currentTarget.style.outline = '2px solid #5fc87a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.outline = ''; }}
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
            {depConnector}
            {children.length > 0 && (
              <button type="button" onClick={toggleCollapse}
                style={{ background: 'none', border: 'none', color: '#7a8a9a', cursor: 'pointer', fontSize: '0.62rem', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                title={isCollapsed ? 'Expand' : 'Collapse'}>
                {isCollapsed ? '▶' : '▼'}
              </button>
            )}
            <input
              type="checkbox"
              checked={!spineExcludedObjectIds.has(obj.id)}
              onChange={() => toggleSpineExclude(obj.id)}
              onClick={e => e.stopPropagation()}
              title="Include in Spine export"
              style={{ cursor: 'pointer', marginRight: 3, accentColor: '#7ecf9e', flexShrink: 0 }}
            />
            <span
              onMouseDown={(e) => { e.stopPropagation(); handleStartDragNode(obj.id, e); }}
              title="Drag to create relationship"
              style={{ cursor: 'grab', color: '#4a6a8a', fontSize: 12, flexShrink: 0, userSelect: 'none', padding: '0 2px', marginRight: 1 }}
            >⠇</span>
            <span className={`hierarchy-item-type ${typeColorClass}`}>{typeLabel}</span>
            {depBadge}
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
            {children.length > 0 && (
              <span className="hierarchy-item-children" style={{ cursor: 'pointer' }} onClick={toggleCollapse} title={isCollapsed ? 'Expand' : 'Collapse'}>
                {isCollapsed ? `▶ ${children.length}` : `▼ ${children.length}`}
              </span>
            )}
          </div>
        )}
        {!isCollapsed && children.length > 0 && (
          <div className="hierarchy-children-block">
            {children.map((child) => renderHierarchyNode(child, depth + 1))}
          </div>
        )}
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
    <div className="workspace" style={{ zoom: guiScale }}>
      {drawBezierCurveMode && (
        <div style={{ position: 'absolute', top: 50, left: '50%', transform: 'translateX(-50%)', zIndex: 100, pointerEvents: 'none', background: 'rgba(0,0,0,0.6)', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', display: 'flex', alignItems: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
          <span style={{ color: '#ffcc00', pointerEvents: 'none', fontSize: '14px', fontWeight: 'bold' }}>✏️ Drawing Curve Mode - Click inside the 3D scene to place points. Double-Click or ESC to finish.</span>
        </div>
      )}
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
                onClick={handleImportSpine}
                type="button"
              >
                <span>Import Spine File (.spine)…</span>
              </button>
              <div className="menu-separator"></div>
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
                className="menu-option menu-option-submenu"
                onMouseEnter={() => setShowPrefsSubmenu(true)}
                onMouseLeave={() => setShowPrefsSubmenu(false)}
                type="button"
              >
                <span>Preferences</span>
                <span className="submenu-indicator">▶</span>
                {showPrefsSubmenu && (
                  <div className="menu-submenu" style={{ minWidth: 170 }} onMouseEnter={() => setShowPrefsSubmenu(true)} onMouseLeave={() => setShowPrefsSubmenu(false)}>
                    <div style={{ padding: '5px 10px 3px', fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #1a1a1a', marginBottom: 2 }}>GUI Size</div>
                    {([['Compact', 0.8], ['Normal', 1.0], ['Large', 1.15], ['X-Large', 1.3]] as [string, number][]).map(([label, val]) => (
                      <button
                        key={label}
                        className="menu-option"
                        style={guiScale === val ? { color: '#e8803a', fontWeight: 700 } : {}}
                        onClick={() => { setGuiScale(val); setShowPrefsSubmenu(false); setShowFileMenu(false); }}
                        type="button"
                      >
                        <span>{label}</span>
                        {guiScale === val && <span style={{ color: '#e8803a', fontSize: '0.7rem' }}>✓</span>}
                      </button>
                    ))}
                  </div>
                )}
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
            onClick={() => setShowCreateMenu(!showCreateMenu)}
            type="button"
          >
            + Create
          </button>
          {showCreateMenu && (
            <div className="menu-dropdown">
              <div style={{ padding: '5px 10px 3px', fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #1a1a1a', marginBottom: 2 }}>Objects</div>
              
              <button
                className="menu-option"
                onClick={() => { handleCreateObject('Emitter'); setShowCreateMenu(false); setShowCreateSubmenu(null); }}
                onMouseEnter={() => setShowCreateSubmenu(null)}
                type="button"
              >
                <span>Emitter</span>
                <span style={{ fontSize: '0.68rem', color: '#666' }}>point · 100/s</span>
              </button>
              
              <button
                className="menu-option menu-option-submenu"
                onMouseEnter={() => setShowCreateSubmenu('Shapes')}
                type="button"
              >
                <span>Shapes</span>
                <span className="submenu-indicator">▶</span>
              </button>
              
              {showCreateSubmenu === 'Shapes' && (
                <div className="menu-submenu">
                  <div style={{ padding: '5px 10px 3px', fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #1a1a1a', marginBottom: 2 }}>3D Primitives</div>
                  {['Cube', 'Sphere', 'Cylinder', 'Cone', 'Plane', 'Torus'].map(shape => (
                    <button key={shape} className="menu-option" onClick={() => { handleCreateObject(shape); setShowCreateMenu(false); setShowCreateSubmenu(null); }} type="button">
                      <span>{shape}</span>
                    </button>
                  ))}
                  <div style={{ padding: '5px 10px 3px', fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #1a1a1a', marginBottom: 2, marginTop: 4 }}>2D Primitives</div>
                  {['Circle', 'Rectangle', 'Triangle', 'Line', 'Arc', 'Polygon'].map(shape => (
                    <button key={shape} className="menu-option" onClick={() => { handleCreateObject(shape); setShowCreateMenu(false); setShowCreateSubmenu(null); }} type="button">
                      <span>{shape}</span>
                    </button>
                  ))}
                  <div style={{ padding: '5px 10px 3px', fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #1a1a1a', marginBottom: 2, marginTop: 4 }}>Paths</div>
                  <button className="menu-option" onClick={() => { handleStartDrawBezierCurve(); setShowCreateMenu(false); setShowCreateSubmenu(null); }} type="button">
                    <span>✏️ Draw Bezier Curve</span>
                  </button>
                </div>
              )}
              
              <button
                className="menu-option menu-option-submenu"
                onMouseEnter={() => setShowCreateSubmenu('Modifiers')}
                type="button"
              >
                <span>Modifiers</span>
                <span className="submenu-indicator">▶</span>
              </button>
              
              {showCreateSubmenu === 'Modifiers' && (
                <div className="menu-submenu">
                  <div style={{ padding: '5px 10px 3px', fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #1a1a1a', marginBottom: 2 }}>Physics Forces</div>
                  {[
                    { id: 'gravity', label: 'Gravity' },
                    { id: 'wind', label: 'Wind' },
                    { id: 'vortex', label: 'Vortex' },
                    { id: 'turbulence', label: 'Turbulence' },
                    { id: 'tornado', label: 'Tornado' },
                    { id: 'attractor', label: 'Attractor' },
                    { id: 'collider', label: 'Collider' }, { id: 'flow-curve', label: 'Follow Path' }, { id: 'repulsor', label: 'Repulsor' }, { id: 'thermal-updraft', label: 'Thermal Updraft' }, { id: 'drag', label: 'Drag' }, { id: 'damping', label: 'Damping' }
                  ].map(force => (
                    <button key={force.id} className="menu-option" onClick={() => { handleAddPhysicsForce(force.id as PhysicsForceType); setShowCreateMenu(false); setShowCreateSubmenu(null); }} type="button">
                      <span>{force.label}</span>
                    </button>
                  ))}
                </div>
              )}
              
              <button
                className="menu-option menu-option-submenu"
                onMouseEnter={() => setShowCreateSubmenu('Presets')}
                type="button"
              >
                <span>Presets</span>
                <span className="submenu-indicator">▶</span>
              </button>
              
              {showCreateSubmenu === 'Presets' && (
                <div className="menu-submenu" style={{ minWidth: 160 }}>
                  <button className="menu-option" onClick={() => { handleCreateFirePreset('campfire'); setShowCreateMenu(false); setShowCreateSubmenu(null); }} type="button">
                    <span>🔥 Campfire</span>
                  </button>
                  <button className="menu-option" onClick={() => { handleCreateFirePreset('torch'); setShowCreateMenu(false); setShowCreateSubmenu(null); }} type="button">
                    <span>🧨 Torch</span>
                  </button>
                  <div style={{ padding: '5px 10px 3px', fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #1a1a1a', marginBottom: 2, marginTop: 4 }}>Classic Native FX</div>
                  <button className="menu-option" onClick={() => { handleCreateClassicPreset('sparks'); setShowCreateMenu(false); setShowCreateSubmenu(null); }} type="button">
                    <span>✨ Magic Sparks</span>
                  </button>
                  <button className="menu-option" onClick={() => { handleCreateClassicPreset('fire'); setShowCreateMenu(false); setShowCreateSubmenu(null); }} type="button">
                    <span>🔥 Stylized Fire</span>
                  </button>
                  <button className="menu-option" onClick={() => { handleCreateClassicPreset('smoke'); setShowCreateMenu(false); setShowCreateSubmenu(null); }} type="button">
                    <span>💨 Soft Smoke</span>
                  </button>
                </div>
              )}
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
        <div className="menu-item">
          {(() => {
            const captureIds = sceneObjects.map(o => o.id).filter(id => !spineExcludedObjectIds.has(id));
            const canCapture = captureIds.length > 0;
            // Shared settings: max frameCount and fps across all included objects
            const sharedFrameCount = (sceneObjects as any[])
              .filter((o: any) => captureIds.includes(o.id))
              .reduce((mx: number, o: any) => Math.max(mx, (o.properties as any)?.frameCount ?? 24), 24);
            const sharedFps = (sceneObjects as any[])
              .filter((o: any) => captureIds.includes(o.id))
              .reduce((mx: number, o: any) => Math.max(mx, (o.properties as any)?.fps ?? 24), 24);
            return (
              <button
                className="menu-button"
                disabled={!canCapture}
                style={canCapture ? { backgroundColor: '#1e3f2a', color: '#7dffaa', fontWeight: 'bold', border: '1px solid #3a9f6a', whiteSpace: 'nowrap' } : { opacity: 0.4, whiteSpace: 'nowrap' }}
                title={canCapture ? `Capture ${captureIds.length} checked object(s) together as a ${sharedFrameCount}-frame sequence` : 'Check at least one object (green checkbox)'}
                onClick={async () => {
                  if (!canCapture) return;
                  try {
                    const frames = await scene3DRef.current?.captureSaberSequence(captureIds, sharedFrameCount, sharedFps);
                    if (!frames?.length) return;
                    const isElectron = !!(window as any).vertebrae?.isElectron;
                    if (isElectron) {
                      // Convert blobs → base64 strings for IPC transfer
                      const b64Frames = await Promise.all(frames.map(async blob => {
                        const ab = await blob.arrayBuffer();
                        const bytes = new Uint8Array(ab);
                        let binary = '';
                        for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
                        return btoa(binary);
                      }));
                      const result = await (window as any).vertebrae.saveCaptureSequence({ frames: b64Frames });
                      if (!result?.success) {
                        if (result?.error !== 'Cancelled') alert(`Capture failed: ` + result?.error);
                      } else {
                        alert(`Exported ${frames.length} frames to: ${result.dir}`);
                      }
                    } else {
                      // Browser: use File System Access API
                      let dirHandle: FileSystemDirectoryHandle | null = null;
                      try { dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' }); }
                      catch { return; }
                      if (!dirHandle) return;
                      for (let i = 0; i < frames.length; i++) {
                        const n = String(i).padStart(4, '0');
                        const fh = await dirHandle.getFileHandle(`sequence_${n}.png`, { create: true });
                        const w = await fh.createWritable();
                        await w.write(frames[i]);
                        await w.close();
                      }
                      alert(`Exported ${frames.length} frames (${captureIds.length} objects).`);
                    }
                  } catch (err) {
                    alert(`Capture failed: ` + (err as Error).message);
                  }
                }}
                type="button"
              >
                🎞 Capture Sequence
              </button>
            );
          })()}
        </div>
        <div className="snap-toolbar" style={{ gap: 6, paddingLeft: 8 }} title="Capture crop options">
          <label style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer', fontSize:'0.78rem', color:'#ff9944', whiteSpace:'nowrap' }}>
            <input type="checkbox" checked={showCaptureOverlay} onChange={e => {
              const next = e.target.checked;
              setShowCaptureOverlay(next);
              if (next && !manualCropRect) setManualCropRect({ left: 100, top: 80, width: 400, height: 300 });
            }} />
            Crop
          </label>
          {showCaptureOverlay && (
            <button type="button"
              onClick={() => setManualCropRect({ left: 100, top: 80, width: 400, height: 300 })}
              style={{ fontSize:'0.72rem', padding:'1px 7px', background:'#1e2e3e', border:'1px solid #3b4f6a', color:'#7dffaa', borderRadius:4, cursor:'pointer' }}>
              Reset
            </button>
          )}
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
          <label className="snap-axis" title="Snap bezier points to 3D mesh surface or vertices when drawing">
            <input type="checkbox" checked={snapSettings.snapTo3DObject ?? false}
              onChange={e => setSnapSettings(prev => ({ ...prev, snapTo3DObject: e.target.checked }))} />
            3D
          </label>
          <select value={snapSettings.snap3DTarget ?? 'face'}
            onChange={e => setSnapSettings(prev => ({ ...prev, snap3DTarget: e.target.value as 'face' | 'vertex' }))}
            title="3D snap mode: hit face center or nearest vertex">
            <option value="face">Face</option>
            <option value="vertex">Vertex</option>
          </select>
        </div>
      </div>

      {/* ─── Create Shelf ─── */}
      <div className="create-shelf">
        <div className="create-shelf-tabs">
          {(['Objects', '3D', '2D', 'Curves', 'Modifiers', 'Particle Systems', 'FX'] as const).map(tab => (
            <button
              key={tab}
              className={`create-shelf-tab ${activeShelfTab === tab ? 'active' : ''}`}
              onClick={() => setActiveShelfTab(prev => prev === tab ? null : tab)}
              type="button"
            >
              {tab === 'Objects' && '💫 '}
              {tab === '3D' && '🧊 '}
              {tab === '2D' && '⬡ '}
              {tab === 'Curves' && '✏️ '}
              {tab === 'Modifiers' && '⚡ '}
              {tab === 'Particle Systems' && '✨ '}
              {tab === 'FX' && '🎆 '}
              {tab}
            </button>
          ))}
        </div>
        {activeShelfTab === 'Objects' && (
          <div className="create-shelf-actions">
            <button className="create-shelf-action" onClick={() => handleCreateObject('Emitter')} type="button">
              <span className="create-shelf-action-icon">💫</span>
              <span>Emitter</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateObject('Camera')} type="button">
              <span className="create-shelf-action-icon">📷</span>
              <span>Camera</span>
            </button>
          </div>
        )}
        {activeShelfTab === '3D' && (
          <div className="create-shelf-actions">
            {[
              { name: 'Cube',     icon: '🧊' },
              { name: 'Sphere',   icon: '🔵' },
              { name: 'Cylinder', icon: '🥫' },
              { name: 'Cone',     icon: '📐' },
              { name: 'Plane',    icon: '▬' },
              { name: 'Torus',    icon: '⭕' },
            ].map(({ name, icon }) => (
              <button key={name} className="create-shelf-action" onClick={() => handleCreateObject(name)} type="button">
                <span className="create-shelf-action-icon">{icon}</span>
                <span>{name}</span>
              </button>
            ))}
            <button className="create-shelf-action" onClick={() => importModelInputRef.current?.click()} type="button">
              <span className="create-shelf-action-icon">📦</span>
              <span>Import 3D</span>
            </button>
            <input
              ref={importModelInputRef}
              type="file"
              accept=".obj,.fbx,.gltf,.glb"
              style={{ display: 'none' }}
              onChange={handleImportModelFile}
            />
          </div>
        )}
        {activeShelfTab === '2D' && (
          <div className="create-shelf-actions">
            {[
              { name: 'Circle',    icon: '⭕' },
              { name: 'Rectangle', icon: '▬' },
              { name: 'Triangle',  icon: '🔺' },
              { name: 'Line',      icon: '〰️' },
              { name: 'Arc',       icon: '🌙' },
              { name: 'Polygon',   icon: '⬡' },
            ].map(({ name, icon }) => (
              <button key={name} className="create-shelf-action" onClick={() => handleCreateObject(name)} type="button">
                <span className="create-shelf-action-icon">{icon}</span>
                <span>{name}</span>
              </button>
            ))}
          </div>
        )}
        {activeShelfTab === 'Curves' && (
          <>
          <div className="create-shelf-actions">
            <button className="create-shelf-action" onClick={() => { handleStartDrawBezierCurve(); }} type="button">
              <span className="create-shelf-action-icon">✏️</span>
              <span>Draw Bezier</span>
            </button>
            {([
              { key: 'BZ Circle',    label: 'Circle',    icon: '⭕' },
              { key: 'BZ Ellipse',   label: 'Ellipse',   icon: '🔵' },
              { key: 'BZ Square',    label: 'Square',    icon: '⬛' },
              { key: 'BZ Rectangle', label: 'Rectangle', icon: '▬' },
              { key: 'BZ Triangle',  label: 'Triangle',  icon: '🔺' },
              { key: 'BZ Diamond',   label: 'Diamond',   icon: '◆' },
              { key: 'BZ Pentagon',  label: 'Pentagon',  icon: '⬠' },
              { key: 'BZ Hexagon',   label: 'Hexagon',   icon: '⬡' },
              { key: 'BZ Octagon',   label: 'Octagon',   icon: '⯃' },
              { key: 'BZ Star',      label: 'Star 5',    icon: '⭐' },
              { key: 'BZ Star 6',    label: 'Star 6',    icon: '✡️' },
              { key: 'BZ Cross',     label: 'Cross',     icon: '✚' },
              { key: 'BZ Arrow',     label: 'Arrow',     icon: '➤' },
              { key: 'BZ Heart',     label: 'Heart',     icon: '❤️' },
              { key: 'BZ Wave',      label: 'Wave',      icon: '〰️' },
            ] as const).map(({ key, label, icon }) => (
              <button key={key} className="create-shelf-action" onClick={() => handleCreateBezierShape(key)} type="button"
                title={`Create ${label} bezier path`}>
                <span className="create-shelf-action-icon">{icon}</span>
                <span>{label}</span>
              </button>
            ))}
            <button className="create-shelf-action" onClick={() => setSpiralDialog({ turns: 3, diameter: 160, cw: true })} type="button"
              title="Create spiral curve (configure turns, diameter, direction)">
              <span className="create-shelf-action-icon">🌀</span>
              <span>Spiral</span>
            </button>
            <button className="create-shelf-action" onClick={() => importCurveInputRef.current?.click()} type="button"
              title="Import paths from SVG or Illustrator AI file">
              <span className="create-shelf-action-icon">🎨</span>
              <span>Import AI</span>
            </button>
            <input
              ref={importCurveInputRef}
              type="file"
              accept=".svg,.ai"
              style={{ display: 'none' }}
              onChange={handleImportCurveFile}
            />
          </div>
          {spiralDialog !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 10px', background: '#252c3e', borderTop: '1px solid #1c2030', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: '#a0b0c0', fontWeight: 600 }}>🌀 Spiral</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: '#ccc' }}>
                Turns
                <input type="number" min={0.5} max={20} step={0.5}
                  value={spiralDialog.turns}
                  onChange={e => setSpiralDialog(prev => prev ? { ...prev, turns: Math.max(0.5, Number(e.target.value)) } : prev)}
                  style={{ width: '52px', background: '#1a1f2e', border: '1px solid #3b455c', color: '#e0e0e0', borderRadius: '3px', padding: '2px 4px', fontSize: '0.72rem' }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: '#ccc' }}>
                Diameter
                <input type="number" min={10} max={2000} step={10}
                  value={spiralDialog.diameter}
                  onChange={e => setSpiralDialog(prev => prev ? { ...prev, diameter: Math.max(10, Number(e.target.value)) } : prev)}
                  style={{ width: '62px', background: '#1a1f2e', border: '1px solid #3b455c', color: '#e0e0e0', borderRadius: '3px', padding: '2px 4px', fontSize: '0.72rem' }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: '#ccc' }}>
                <input type="checkbox" checked={spiralDialog.cw}
                  onChange={e => setSpiralDialog(prev => prev ? { ...prev, cw: e.target.checked } : prev)} />
                Clockwise
              </label>
              <button type="button"
                onClick={() => handleCreateSpiral(spiralDialog.turns, spiralDialog.diameter, spiralDialog.cw)}
                style={{ padding: '3px 10px', background: '#3e7de8', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}>
                Create
              </button>
              <button type="button"
                onClick={() => setSpiralDialog(null)}
                style={{ padding: '3px 8px', background: '#3a3a3a', border: '1px solid #555', borderRadius: '4px', color: '#aaa', fontSize: '0.72rem', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          )}
          </>
        )}
        {activeShelfTab === 'Modifiers' && (
          <div className="create-shelf-actions">
            {[
              { id: 'gravity',          label: 'Gravity',         icon: '⬇️' },
              { id: 'wind',             label: 'Wind',            icon: '🌬️' },
              { id: 'vortex',           label: 'Vortex',          icon: '🌀' },
              { id: 'turbulence',       label: 'Turbulence',      icon: '〰️' },
              { id: 'tornado',          label: 'Tornado',         icon: '🌪️' },
              { id: 'attractor',        label: 'Attractor',       icon: '🧲' },
              { id: 'collider',         label: 'Collider',        icon: '🔲' },
              { id: 'flow-curve',       label: 'Follow Path',     icon: '↗️' },
              { id: 'repulsor',         label: 'Repulsor',        icon: '↔️' },
              { id: 'thermal-updraft',  label: 'Thermal Updraft', icon: '🔆' },
              { id: 'drag',             label: 'Drag',            icon: '⏬' },
              { id: 'damping',          label: 'Damping',         icon: '🔇' },
            ].map(f => (
              <button key={f.id} className="create-shelf-action" onClick={() => handleAddPhysicsForce(f.id as PhysicsForceType)} type="button">
                <span className="create-shelf-action-icon">{f.icon}</span>
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        )}
        {activeShelfTab === 'Particle Systems' && (
          <div className="create-shelf-actions">
            <button className="create-shelf-action" onClick={() => handleCreateObject('Emitter')} type="button">
              <span className="create-shelf-action-icon">⭐</span>
              <span>Simple Emitter</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateFirePreset('campfire')} type="button">
              <span className="create-shelf-action-icon">🔥</span>
              <span>Campfire</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateFirePreset('torch')} type="button">
              <span className="create-shelf-action-icon">🧨</span>
              <span>Torch</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateClassicPreset('sparks')} type="button">
              <span className="create-shelf-action-icon">✨</span>
              <span>Magic Sparks</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateClassicPreset('fire')} type="button">
              <span className="create-shelf-action-icon">🔥</span>
              <span>Stylized Fire</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateClassicPreset('smoke')} type="button">
              <span className="create-shelf-action-icon">💨</span>
              <span>Soft Smoke</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateParticlePreset('rain')} type="button">
              <span className="create-shelf-action-icon">🌧️</span>
              <span>Rain</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateParticlePreset('snow')} type="button">
              <span className="create-shelf-action-icon">❄️</span>
              <span>Snow</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateParticlePreset('explosion')} type="button">
              <span className="create-shelf-action-icon">💥</span>
              <span>Explosion</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateParticlePreset('confetti')} type="button">
              <span className="create-shelf-action-icon">🎊</span>
              <span>Confetti</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateParticlePreset('magic-dust')} type="button">
              <span className="create-shelf-action-icon">🪄</span>
              <span>Magic Dust</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateParticlePreset('bubbles')} type="button">
              <span className="create-shelf-action-icon">🫧</span>
              <span>Bubbles</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateParticlePreset('fireflies')} type="button">
              <span className="create-shelf-action-icon">🌿</span>
              <span>Fireflies</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateParticlePreset('embers')} type="button">
              <span className="create-shelf-action-icon">🟠</span>
              <span>Embers</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateParticlePreset('galaxy')} type="button">
              <span className="create-shelf-action-icon">🌌</span>
              <span>Galaxy</span>
            </button>
            <button className="create-shelf-action" onClick={() => handleCreateParticlePreset('mist')} type="button">
              <span className="create-shelf-action-icon">🌫️</span>
              <span>Mist</span>
            </button>
          </div>
        )}
        {activeShelfTab === 'FX' && (
          <div className="create-shelf-actions">
            <button className="create-shelf-action" onClick={() => setShowParticleCreator(true)} type="button">
              <span className="create-shelf-action-icon">🎨</span>
              <span>Particle Creator</span>
            </button>
            <button className="create-shelf-action" onClick={() => {
              const opts = defaultLightningOpts();
              const lId = 'lightning_' + Date.now();
              const startId = 'lpt_start_' + Date.now();
              const endId   = 'lpt_end_'   + (Date.now() + 1);

              // If a Path is selected, snap start/end to its first/last PathPoints
              // and attach the lightning as a follow-bezier-curve follower.
              let startPos = { x: -80, y: 0, z: 0 };
              let endPos   = { x:  80, y: 0, z: 0 };
              let extraProps: Record<string, unknown> = {};
              if (selectedObject && selectedObject.type === 'Path') {
                const pathPts = (sceneObjects as SceneObject[])
                  .filter(o => o.type === 'PathPoint' && o.parentId === selectedObject.id)
                  .sort((a, b) => {
                    // PathPoints are ordered by insertion; use name heuristic or just array order
                    const ai = (sceneObjects as SceneObject[]).indexOf(a);
                    const bi = (sceneObjects as SceneObject[]).indexOf(b);
                    return ai - bi;
                  });
                if (pathPts.length >= 2) {
                  const first = pathPts[0].position;
                  const last  = pathPts[pathPts.length - 1].position;
                  startPos = { x: first.x, y: first.y, z: first.z ?? 0 };
                  endPos   = { x: last.x,  y: last.y,  z: last.z  ?? 0 };
                } else if (pathPts.length === 1) {
                  const p = pathPts[0].position;
                  startPos = { x: p.x, y: p.y, z: p.z ?? 0 };
                }
                extraProps = {
                  followBezierPathIds: [selectedObject.id],
                  curveTightness: 10,
                };
              }

              const lightning: SceneObject = { id: lId, name: 'Lightning', type: 'Lightning', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, parentId: null, properties: { ...opts, ...extraProps } };
              const ptStart:  SceneObject = { id: startId, name: 'Start', type: 'LightningPoint', position: startPos, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, parentId: lId, properties: { role: 'start' } };
              const ptEnd:    SceneObject = { id: endId,   name: 'End',   type: 'LightningPoint', position: endPos,   rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, parentId: lId, properties: { role: 'end'   } };
              setSceneObjects(prev => [...prev, lightning, ptStart, ptEnd]);
              setSelectedObjectId(lId);
              setShowScenePropertiesPanel(true);
            }} type="button">
              <span className="create-shelf-action-icon">⚡</span>
              <span>Lightning</span>
            </button>
            <button className="create-shelf-action" onClick={() => {
              const fId = 'flame_' + Date.now();
              const flame: SceneObject = {
                id: fId,
                name: 'Flame',
                type: 'Flame',
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                parentId: null,
                properties: {
                  coreColor: '#ffff88',
                  glowColor: '#ff3300',
                  height: 80,
                  width: 30,
                  numTendrils: 5,
                  turbulence: 0.55,
                  speed: 1.4,
                  coreWidth: 6,
                  glowWidth: 16,
                  density: 1.6,
                  coreBlur: 0.2,
                  glowFalloff: 1.2,
                  glowColorTop: '#880000',
                  coreColorTop: '#ffaa00',
                  flickerIntensity: 0.45,
                  flickerType: 'fractal',
                  usePhysicsModifiers: false,
                  modifierStrength: 1.0,
                  occludeByGeometry: true,
                },
              };
              setSceneObjects(prev => [...prev, flame]);
              setSelectedObjectId(fId);
              setShowScenePropertiesPanel(true);
            }} type="button">
              <span className="create-shelf-action-icon">🔥</span>
              <span>Flame</span>
            </button>
            <button className="create-shelf-action" onClick={() => {
              if (!selectedObject || selectedObject.type !== 'Path') {
                window.alert('Please select a bezier curve first');
                return;
              }
              const sId = 'saber_' + Date.now();
              const saber = {
                id: sId,
                name: 'Saber',
                type: 'Saber',
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                parentId: null,
                properties: {
                  targetPathId: selectedObject.id,
                  coreColor: '#ffffff',
                  coreColorEnd: '#ffffff',
                  glowColor: '#0088ff',
                  glowColorEnd: '#ff00ff',
                  coreWidth: 1.0,
                  glowWidth: 6.0,
                  startOffset: 0.0,
                  endOffset: 1.0,
                  phaseOffset: 0.0,
                  offsetSpeed: 0.0,
                  startTaper: 1.0,
                  endTaper: 0.0,
                  noiseIntensity: 0.5,
                  noiseScale: 5.0,
                  noiseAnimated: true,
                  noiseSpeed: 1.0,
                  smoothCurve: true,
                  coreFalloff: 0.2,
                  glowFalloff: 1.2,
                  tubularSegments: 64,
                  radiusSegments: 8,
                }
              };
              setSceneObjects(prev => [...prev, saber]);
              setSelectedObjectId(sId);
              setShowScenePropertiesPanel(true);
            }} type="button">
              <span className="create-shelf-action-icon">⚔</span>
              <span>Saber</span>
            </button>
            <button className="create-shelf-action" onClick={() => {
              if (!selectedObject || selectedObject.type !== 'Path') {
                window.alert('Please select a bezier curve first');
                return;
              }
              // Saber Bolt: Lightning tightly guided along the selected curve
              const pathPts = (sceneObjects as SceneObject[])
                .filter(o => o.type === 'PathPoint' && o.parentId === selectedObject.id)
                .sort((a, b) => (sceneObjects as SceneObject[]).indexOf(a) - (sceneObjects as SceneObject[]).indexOf(b));
              let startPos = { x: -80, y: 0, z: 0 };
              let endPos   = { x:  80, y: 0, z: 0 };
              if (pathPts.length >= 2) {
                const first = pathPts[0].position;
                const last  = pathPts[pathPts.length - 1].position;
                startPos = { x: first.x, y: first.y, z: first.z ?? 0 };
                endPos   = { x: last.x,  y: last.y,  z: last.z  ?? 0 };
              } else if (pathPts.length === 1) {
                const p = pathPts[0].position;
                startPos = { x: p.x, y: p.y, z: p.z ?? 0 };
              }
              const lId     = 'lightning_' + Date.now();
              const startId = 'lpt_start_' + Date.now();
              const endId   = 'lpt_end_'   + (Date.now() + 1);
              const saberBolt: SceneObject = {
                id: lId,
                name: 'Saber Bolt',
                type: 'Lightning',
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                parentId: null,
                properties: {
                  ...defaultLightningOpts(),
                  // Tight path following
                  followBezierPathIds: [selectedObject.id],
                  curveTightness: 55,
                  // Energy blade look — thin bright core, wide tight glow, minimal branching
                  coreColor:         '#ffffff',
                  coreWidth:         1.5,
                  glowColor:         '#aa44ff',
                  glowWidth:         10,
                  segmentDepth:      3,
                  roughness:         0.18,
                  turbulence:        0.12,
                  numSegments:       6,
                  branchProbability: 0.08,
                  branchCount:       0,
                  branchLevels:      1,
                  bend:              0,
                  density:           2.5,
                  mode:              'loop',
                  glowNoiseIntensity: 0.55,
                  glowNoiseScale:     4.0,
                  glowNoiseSpeed:     1.5,
                },
              };
              const ptStart: SceneObject = { id: startId, name: 'Start', type: 'LightningPoint', position: startPos, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, parentId: lId, properties: { role: 'start' } };
              const ptEnd:   SceneObject = { id: endId,   name: 'End',   type: 'LightningPoint', position: endPos,   rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, parentId: lId, properties: { role: 'end'   } };
              setSceneObjects(prev => [...prev, saberBolt, ptStart, ptEnd]);
              setSelectedObjectId(lId);
              setShowScenePropertiesPanel(true);
            }} type="button">
              <span className="create-shelf-action-icon">⚡⚔</span>
              <span>Saber 2</span>
            </button>
          </div>
        )}
      </div>

      <div className="workspace-content">
        {showScenePropertiesPanel && (
          <aside className="file-panel panel-left">
            <div className="panel-header">
              <h3>{leftPanelTab === 'scene' ? 'Scene Properties' : leftPanelTab === 'spine' ? 'Spine Import' : 'Hierarchy & Physics'}</h3>
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
                <button
                  type="button"
                  className={leftPanelTab === 'spine' ? 'active' : ''}
                  onClick={() => setLeftPanelTab('spine')}
                >
                  Spine
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

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '6px' }}>
                    <input
                      type="checkbox"
                      checked={sceneSettings.particleLivePreview ?? true}
                      onChange={(e) => setSceneSettings((prev) => ({ ...prev, particleLivePreview: e.target.checked }))}
                    />
                    Live Particle Preview (no play needed)
                  </label>

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

                  {/* Floating relationship picker */}
                  {pendingDrop && (() => {
                    const opts = getDropOptions(pendingDrop.sourceId, pendingDrop.targetId);
                    const srcName = sceneObjects.find(o => o.id === pendingDrop.sourceId)?.name ?? '?';
                    const tgtName = sceneObjects.find(o => o.id === pendingDrop.targetId)?.name ?? '?';
                    return (
                      <>
                        {/* backdrop to close on outside click */}
                        <div
                          style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                          onClick={() => setPendingDrop(null)}
                        />
                        <div style={{
                          position: 'fixed',
                          left: Math.min(pendingDrop.x, window.innerWidth - 260),
                          top: Math.min(pendingDrop.y, window.innerHeight - 280),
                          zIndex: 9999,
                          background: '#1a2636',
                          border: '1px solid #3a6a9a',
                          borderRadius: 9,
                          boxShadow: '0 6px 28px rgba(0,0,0,0.75)',
                          minWidth: 248,
                          overflow: 'hidden',
                          fontSize: 12,
                        }}>
                          <div style={{ padding: '8px 12px 7px', background: '#162030', borderBottom: '1px solid #2d4055', color: '#89b4d4', fontSize: 11 }}>
                            <span style={{ color: '#aed6f1', fontWeight: 700 }}>{srcName}</span>
                            <span style={{ color: '#4a6a8a', margin: '0 5px' }}>→</span>
                            <span style={{ color: '#aed6f1', fontWeight: 700 }}>{tgtName}</span>
                          </div>
                          {opts.length === 0 ? (
                            <div style={{ padding: '8px 12px', color: '#4a6a8a' }}>No valid relationships</div>
                          ) : opts.map((opt, i) => (
                            <div
                              key={i}
                              role="button" tabIndex={0}
                              onClick={opt.action}
                              onKeyDown={e => e.key === 'Enter' && opt.action()}
                              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#243546'}
                              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                              style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, color: '#c8daea' }}
                            >
                              <span style={{ fontSize: 15 }}>{opt.icon}</span>
                              <span>{opt.label}</span>
                            </div>
                          ))}
                          <div
                            role="button" tabIndex={0}
                            onClick={() => setPendingDrop(null)}
                            onKeyDown={e => e.key === 'Enter' && setPendingDrop(null)}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#1e2a36'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                            style={{ padding: '6px 14px', cursor: 'pointer', color: '#4a6a8a', borderTop: '1px solid #2d4055', fontSize: 11 }}
                          >Cancel</div>
                        </div>
                      </>
                    );
                  })()}

                  {/* Hierarchy type filters */}
                  {(() => {
                    const allTypes = Array.from(new Set(sceneObjects.map(o => o.type))).sort();
                    const typeIcons: Record<string, string> = {
                      Emitter: '⭐', Flame: '🔥', Lightning: '⚡', Saber: '🔵', GlowSphere: '🔴',
                      LightningPoint: '✦', Path: '〰️', PathPoint: '◦', EmitterShape: '◆',
                      CameraTarget: '🎥', Bone: '🦴', Mesh: '⬡',
                    };
                    const typeColors: Record<string, string> = {
                      Emitter: '#5a9fd4', Flame: '#e8803a', Lightning: '#f1c40f', Saber: '#00e5ff',
                      GlowSphere: '#ff6bcd', LightningPoint: '#f1c40f', Path: '#5fc87a', PathPoint: '#5fc87a',
                      EmitterShape: '#e8803a', CameraTarget: '#c084fc',
                    };
                    const toggleType = (t: string) => setHierarchyHiddenTypes(prev => {
                      const next = new Set(prev);
                      if (next.has(t)) next.delete(t); else next.add(t);
                      return next;
                    });
                    if (allTypes.length === 0 && physicsForces.length === 0) return null;
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '0 0 8px 0', borderBottom: '1px solid #2d3a4a', marginBottom: '8px' }}>
                        {allTypes.map(t => {
                          const hidden = hierarchyHiddenTypes.has(t);
                          const color = typeColors[t] ?? '#7a8a9a';
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => toggleType(t)}
                              title={hidden ? `Show ${t}` : `Hide ${t}`}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '3px',
                                padding: '2px 7px', borderRadius: '10px', border: `1px solid ${hidden ? '#2d3a4a' : color}`,
                                background: hidden ? '#1a2332' : `${color}22`,
                                color: hidden ? '#3d4d5d' : color,
                                fontSize: '0.65rem', cursor: 'pointer', lineHeight: 1.4,
                                opacity: hidden ? 0.5 : 1, transition: 'all 0.15s',
                              }}
                            >
                              <span>{typeIcons[t] ?? '▪'}</span>
                              <span>{t}</span>
                            </button>
                          );
                        })}
                        {physicsForces.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleType('__forces__')}
                            title={hierarchyHiddenTypes.has('__forces__') ? 'Show Forces' : 'Hide Forces'}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '3px',
                              padding: '2px 7px', borderRadius: '10px',
                              border: `1px solid ${hierarchyHiddenTypes.has('__forces__') ? '#2d3a4a' : '#ff6b6b'}`,
                              background: hierarchyHiddenTypes.has('__forces__') ? '#1a2332' : '#ff6b6b22',
                              color: hierarchyHiddenTypes.has('__forces__') ? '#3d4d5d' : '#ff6b6b',
                              fontSize: '0.65rem', cursor: 'pointer', lineHeight: 1.4,
                              opacity: hierarchyHiddenTypes.has('__forces__') ? 0.5 : 1, transition: 'all 0.15s',
                            }}
                          >
                            <span>⚡</span><span>Forces</span>
                          </button>
                        )}
                      </div>
                    );
                  })()}

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
                                onMouseUp={(e) => handleDropNode(obj.id, e)}
                                onMouseEnter={(e) => {
                                  if (draggingForceId) { e.currentTarget.style.backgroundColor = '#5a4a3a'; e.currentTarget.style.borderColor = '#f39c12'; }
                                  if (draggingNodeId && draggingNodeId !== obj.id) { e.currentTarget.style.outline = '2px solid #5fc87a'; }
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = '';
                                  e.currentTarget.style.borderColor = '';
                                  e.currentTarget.style.outline = '';
                                }}
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
                                <input
                                  type="checkbox"
                                  checked={!spineExcludedObjectIds.has(obj.id)}
                                  onChange={() => toggleSpineExclude(obj.id)}
                                  onClick={e => e.stopPropagation()}
                                  title="Include in Spine export"
                                  style={{ cursor: 'pointer', accentColor: '#7ecf9e', flexShrink: 0 }}
                                />
                                <span
                                  onMouseDown={(e) => handleStartDragNode(obj.id, e)}
                                  title="Drag to create relationship"
                                  style={{ cursor: 'grab', color: '#4a6a8a', fontSize: 12, flexShrink: 0, userSelect: 'none', padding: '0 2px' }}
                                >⠇</span>
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
                              {((hierarchyChildrenByParent.get(obj.id) ?? []).length > 0 || (!hierarchyHiddenTypes.has('__forces__') && affectingForces.length > 0)) && (
                              <div className="hierarchy-children-block">
                              {/* Child shapes/objects connected to this emitter as emission sources */}
                              {(hierarchyChildrenByParent.get(obj.id) ?? []).map(child => renderHierarchyNode(child, 1))}
                              {/* Physics forces affecting this emitter */}
                              {!hierarchyHiddenTypes.has('__forces__') && affectingForces.map(force => (
                                <div
                                  key={force.id}
                                  ref={(el) => {
                                    if (el) hierarchyNodeRefsRef.current.set(force.id, { element: el, type: 'force' });
                                    else hierarchyNodeRefsRef.current.delete(force.id);
                                  }}
                                  className={`hierarchy-row ${selectedForceId === force.id ? 'selected' : ''}`}
                                  onClick={(e) => { e.stopPropagation(); setSelectedForceId(force.id); }}
                                  role="treeitem"
                                  aria-selected={selectedForceId === force.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    paddingLeft: '8px',
                                    background: selectedForceId === force.id ? '#6b2311' : '#3d2e2e',
                                    borderLeft: '3px solid #ff6b6b',
                                    fontSize: '0.8rem',
                                  }}
                                >
                                  <span style={{ color: '#ff6b6b', fontSize: '0.7rem', flexShrink: 0 }}>⚡</span>
                                  <span className="hierarchy-item-type" style={{ color: '#ff9090', fontSize: '0.68rem' }}>
                                    {force.type.replace(/-/g, ' ')}
                                  </span>
                                  <span className="hierarchy-item-name" style={{ fontSize: '0.78rem' }}>{force.name}</span>
                                  <button
                                    className="hierarchy-delete-btn"
                                    onClick={(e) => { e.stopPropagation(); handleDeletePhysicsForce(force.id); }}
                                    type="button"
                                    title="Delete force"
                                    style={{ marginLeft: 'auto' }}
                                  >🗑</button>
                                </div>
                              ))}
                              </div>
                              )}
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
                          <React.Fragment key={obj.id}>
                            {renderHierarchyNode(obj, 0)}
                          </React.Fragment>
                        ))}
                    </div>
                  )}

                  {(() => { const unassignedForces = physicsForces.filter(f => f.affectedEmitterIds.length === 0); return (unassignedForces.length === 0 || hierarchyHiddenTypes.has('__forces__')) ? null : (
                  <div style={{ borderTop: '1px solid #3b455c', paddingTop: '0.75rem' }}>
                    <div style={{ paddingBottom: '0.5rem', fontSize: '0.75rem', color: '#a9b5ca', fontWeight: 'bold' }}>
                      UNASSIGNED FORCES
                    </div>
                    {(
                      unassignedForces.map((force) => (
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
                  ); })()}
                </div>
              )}

              {leftPanelTab === 'spine' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.5rem 0' }}>
                  {!importedSpineSource ? (
                    <div style={{ color: '#888', fontSize: '0.8rem', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div>No Spine file imported yet.</div>
                      <button
                        type="button"
                        onClick={handleImportSpine}
                        style={{
                          display: 'inline-block',
                          padding: '0.4rem 0.7rem',
                          background: '#1e3a5f',
                          color: '#7db8f0',
                          border: '1px solid #2e5a8f',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                        }}
                      >
                        📂 Import .spine File…
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* File info */}
                      <div style={{ fontSize: '0.72rem', color: '#a9b5ca', padding: '0 0.25rem 0.25rem', borderBottom: '1px solid #3b455c', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ flex: 1 }}>
                          {importedSpineSource.fileName}
                          <span style={{ marginLeft: '0.5rem', color: '#666' }}>
                            · {importedSpineSource.json.bones?.length ?? 0} bones
                            · {importedSpineSource.json.slots?.length ?? 0} slots
                          </span>
                        </span>
                        <button
                          type="button"
                          title="Re-import .spine file"
                          onClick={handleImportSpine}
                          style={{ padding: '1px 5px', background: '#1e3a5f', color: '#7db8f0', border: '1px solid #2e5a8f', borderRadius: '3px', cursor: 'pointer', fontSize: '0.7rem', flexShrink: 0 }}
                        >
                          ↺
                        </button>
                      </div>

                      {/* Skins list — only when multiple skins exist */}
                      {spineSkinNames.length > 1 && (
                        <div>
                          <div style={{ fontSize: '0.72rem', color: '#a9b5ca', fontWeight: 'bold', padding: '0.25rem 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Skins
                          </div>
                          {spineSkinNames.map((skinName) => {
                            const isActive = activeSpineSkin ? activeSpineSkin === skinName : (skinName === 'default' || spineSkinNames.indexOf(skinName) === 0);
                            return (
                              <button
                                key={skinName}
                                type="button"
                                onClick={() => setActiveSpineSkin(skinName)}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '0.3rem 0.5rem',
                                  marginBottom: '2px',
                                  background: isActive ? '#2a4a2a' : '#232b38',
                                  color: isActive ? '#80e080' : '#c0cfe0',
                                  border: isActive ? '1px solid #4aaa4a' : '1px solid transparent',
                                  borderRadius: '3px',
                                  cursor: 'pointer',
                                  fontSize: '0.8rem',
                                }}
                              >
                                ◆ {skinName}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Animations list */}
                      <div>
                        <div style={{ fontSize: '0.72rem', color: '#a9b5ca', fontWeight: 'bold', padding: '0.25rem 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Animations
                        </div>
                        {Object.keys(importedSpineSource.json.animations ?? {}).length === 0 ? (
                          <div style={{ color: '#666', fontSize: '0.75rem' }}>No animations found</div>
                        ) : (
                          Object.keys(importedSpineSource.json.animations).map((animName) => (
                            <button
                              key={animName}
                              type="button"
                              onClick={() => switchSpineAnimation(animName)}
                              style={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                padding: '0.3rem 0.5rem',
                                marginBottom: '2px',
                                background: activeSpineAnimation === animName ? '#1a4a8a' : '#232b38',
                                color: activeSpineAnimation === animName ? '#fff' : '#c0cfe0',
                                border: activeSpineAnimation === animName ? '1px solid #3a7fd4' : '1px solid transparent',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                              }}
                            >
                              ▶ {animName}
                            </button>
                          ))
                        )}
                      </div>

                      {/* Layer spread */}
                      <div style={{ borderTop: '1px solid #3b455c', paddingTop: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span style={{ fontSize: '0.72rem', color: '#a9b5ca', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Layer Spread</span>
                          <span style={{ fontSize: '0.72rem', color: '#7db8f0' }}>{spineLayerSpread.toFixed(1)}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={0.5}
                          value={spineLayerSpread}
                          onChange={(e) => setSpineLayerSpread(parseFloat(e.target.value))}
                          style={{ width: '100%', accentColor: '#3a7fd4' }}
                        />
                      </div>

                      {/* Attachments / slots */}
                      {spineAllAttachments.length > 0 && (
                        <div style={{ borderTop: '1px solid #3b455c', paddingTop: '0.5rem' }}>
                          <div style={{ fontSize: '0.72rem', color: '#a9b5ca', fontWeight: 'bold', padding: '0.25rem 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Attachments ({spineAllAttachments.length})
                          </div>
                          {spineAllAttachments.map((att) => (
                            <div
                              key={att.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                padding: '0.2rem 0.4rem',
                                marginBottom: '2px',
                                background: '#1c2430',
                                borderRadius: '3px',
                                fontSize: '0.75rem',
                                color: '#9ab',
                              }}
                            >
                              {att.imageDataUrl ? (
                                <img
                                  src={att.imageDataUrl}
                                  alt={att.slotName}
                                  style={{ width: 24, height: 24, objectFit: 'contain', borderRadius: '2px', background: '#111', flexShrink: 0 }}
                                />
                              ) : (
                                <div style={{ width: 24, height: 24, background: '#333', borderRadius: '2px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: '#666' }}>?</div>
                              )}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.slotName}</span>
                              <span style={{ marginLeft: 'auto', color: '#555', flexShrink: 0 }}>{att.width}×{att.height}</span>
                              <button
                                title="Generate bezier path from visible edge"
                                onClick={() => {
                                  const pts = scene3DRef.current?.getSpineEdgeOutline(att.id, 32);
                                  if (!pts || pts.length < 2) return;
                                  const pathId = 'spine_edge_' + att.id + '_' + Date.now();
                                  const pathObject: SceneObject = {
                                    id: pathId,
                                    name: att.slotName + ' Edge',
                                    type: 'Path',
                                    position: { x: 0, y: 0, z: 0 },
                                    rotation: { x: 0, y: 0, z: 0 },
                                    scale: { x: 1, y: 1, z: 1 },
                                    parentId: null,
                                    properties: { closed: true },
                                  };
                                  const pointObjects: SceneObject[] = pts.map((pt, i) => ({
                                    id: 'spine_edge_pt_' + Date.now() + '_' + i,
                                    name: 'Point ' + i,
                                    type: 'PathPoint',
                                    position: { x: pt.x, y: pt.y, z: pt.z },
                                    rotation: { x: 0, y: 0, z: 0 },
                                    scale: { x: 1, y: 1, z: 1 },
                                    parentId: pathId,
                                    properties: {},
                                  }));
                                  setSceneObjects(prev => [...prev, pathObject, ...pointObjects]);
                                }}
                                style={{ flexShrink: 0, padding: '1px 5px', fontSize: '0.65rem', backgroundColor: '#1a3060', color: '#7db8f0', border: '1px solid #2a4a8a', borderRadius: 3, cursor: 'pointer' }}
                              >→ Path</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
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
          style={{ position: 'relative' }}
        >
          {/* ─── Toolbox ─── */}
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 10,
            display: 'flex', flexDirection: 'column', gap: 3,
            background: 'rgba(28,28,28,0.92)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 7, padding: '6px 4px', pointerEvents: 'auto',
          }}>
            {/* Transform tools */}
            {([
              { mode: 'translate', icon: '✛', title: 'Move (W / G)' },
              { mode: 'rotate',    icon: '↻', title: 'Rotate (E / R)' },
              { mode: 'scale',     icon: '⤡', title: 'Scale (S)' },
            ] as const).map(({ mode, icon, title }) => (
              <button key={mode} title={title} type="button"
                onClick={() => setManipulatorMode(mode)}
                style={{
                  width: 30, height: 30, border: 'none', borderRadius: 5, cursor: 'pointer',
                  background: manipulatorMode === mode ? '#e8803a' : 'rgba(255,255,255,0.07)',
                  color: manipulatorMode === mode ? '#fff' : '#bbb',
                  fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.1s',
                }}>{icon}</button>
            ))}

            {/* Divider */}
            <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.1)', margin: '2px 0' }} />

            {/* Draw bezier */}
            <button title="Draw Bezier Curve" type="button"
              onClick={handleStartDrawBezierCurve}
              style={{
                width: 30, height: 30, border: 'none', borderRadius: 5, cursor: 'pointer',
                background: drawBezierCurveMode ? '#e8803a' : 'rgba(255,255,255,0.07)',
                color: drawBezierCurveMode ? '#fff' : '#bbb',
                fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>✏️</button>

            {/* Draw on surface mode */}
            {selectedObjectId && drawBezierCurveMode && (
              <button
                title={bezierSurfaceObjectId === selectedObjectId ? 'Exit surface draw mode' : 'Lock bezier draw to selected object surface'}
                type="button"
                onClick={() => setBezierSurfaceObjectId(prev => prev === selectedObjectId ? null : selectedObjectId)}
                style={{
                  width: 30, height: 30, border: 'none', borderRadius: 5, cursor: 'pointer',
                  background: bezierSurfaceObjectId === selectedObjectId ? '#5a3fc0' : 'rgba(255,255,255,0.07)',
                  color: bezierSurfaceObjectId === selectedObjectId ? '#fff' : '#bbb',
                  fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>🧲</button>
            )}

            {/* Auto-vine on surface */}
            {selectedObjectId && (
              <button
                title="Generate vine path on selected object surface"
                type="button"
                onClick={() => setShowVinePanel(v => !v)}
                style={{
                  width: 30, height: 30, border: 'none', borderRadius: 5, cursor: 'pointer',
                  background: showVinePanel ? '#2e7d4f' : 'rgba(255,255,255,0.07)',
                  color: showVinePanel ? '#fff' : '#bbb',
                  fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>🌿</button>
            )}

            {/* Divider */}
            <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.1)', margin: '2px 0' }} />

            {/* View modes */}
            {([
              { mode: 'perspective', label: 'P', title: 'Perspective' },
              { mode: 'y',          label: 'T', title: 'Top (Y)' },
              { mode: 'z',          label: 'F', title: 'Front (Z)' },
              { mode: 'x',          label: 'S', title: 'Side (X)' },
            ] as const).map(({ mode, label, title }) => (
              <button key={mode} title={title} type="button"
                onClick={() => setViewMode(mode)}
                style={{
                  width: 30, height: 30, border: 'none', borderRadius: 5, cursor: 'pointer',
                  background: viewMode === mode ? '#4a90d9' : 'rgba(255,255,255,0.07)',
                  color: viewMode === mode ? '#fff' : '#bbb',
                  fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.1s',
                }}>{label}</button>
            ))}

            {/* Divider */}
            <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.1)', margin: '2px 0' }} />

            {/* Quad viewport toggle */}
            <button title="Quad Viewport (tap Space)" type="button"
              onClick={() => setQuadViewport(prev => !prev)}
              style={{
                width: 30, height: 30, border: 'none', borderRadius: 5, cursor: 'pointer',
                background: quadViewport ? '#4a90d9' : 'rgba(255,255,255,0.07)',
                color: quadViewport ? '#fff' : '#bbb',
                fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>⊞</button>
          </div>

          {/* ── Vine generator panel ── */}
          {showVinePanel && selectedObjectId && (
            <div style={{
              position: 'absolute', top: 10, left: 50, zIndex: 20,
              background: 'rgba(22,34,22,0.97)', border: '1px solid rgba(60,180,80,0.35)',
              borderRadius: 9, padding: '12px 14px', minWidth: 210,
              boxShadow: '0 4px 24px rgba(0,0,0,0.6)', color: '#ccc',
              fontSize: 12, display: 'flex', flexDirection: 'column', gap: 9,
              pointerEvents: 'auto',
            }}>
              <div style={{ fontWeight: 700, color: '#7ecf9e', fontSize: 13, marginBottom: 2 }}>
                🌿 Vine Generator
              </div>

              {/* Control points */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ color: '#aaa' }}>Control points: <strong style={{ color: '#fff' }}>{vineNumPoints}</strong></span>
                <input type="range" min={3} max={24} step={1}
                  value={vineNumPoints}
                  onChange={e => setVineNumPoints(Number(e.target.value))}
                  style={{ accentColor: '#5fc87a' }} />
              </label>

              {/* Length */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ color: '#aaa' }}>
                  Length: <strong style={{ color: '#fff' }}>{vineLength}</strong>
                  <input type="number" min={5} max={2000} step={5}
                    value={vineLength}
                    onChange={e => setVineLength(Number(e.target.value))}
                    style={{
                      marginLeft: 8, width: 62, background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
                      color: '#fff', fontSize: 11, padding: '1px 4px',
                    }} />
                </span>
                <input type="range" min={5} max={2000} step={5}
                  value={vineLength}
                  onChange={e => setVineLength(Number(e.target.value))}
                  style={{ accentColor: '#5fc87a' }} />
              </label>

              {/* Curliness */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ color: '#aaa' }}>Curliness: <strong style={{ color: '#fff' }}>{vineCurliness.toFixed(2)}</strong></span>
                <input type="range" min={0} max={1} step={0.01}
                  value={vineCurliness}
                  onChange={e => setVineCurliness(Number(e.target.value))}
                  style={{ accentColor: '#5fc87a' }} />
              </label>

              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <button type="button" onClick={handleGenerateVine} style={{
                  flex: 1, padding: '5px 0', background: '#2e7d4f', border: 'none',
                  borderRadius: 5, color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                }}>Generate</button>
                <button type="button" onClick={() => { handleGenerateVine(); }} style={{
                  padding: '5px 8px', background: 'rgba(255,255,255,0.08)', border: 'none',
                  borderRadius: 5, color: '#aaa', fontSize: 11, cursor: 'pointer',
                }} title="Generate new random variation">↺</button>
                <button type="button" onClick={() => setShowVinePanel(false)} style={{
                  padding: '5px 8px', background: 'rgba(255,255,255,0.06)', border: 'none',
                  borderRadius: 5, color: '#888', fontSize: 11, cursor: 'pointer',
                }}>✕</button>
              </div>
            </div>
          )}

            <Scene3D
              drawBezierCurveMode={drawBezierCurveMode}
              onFinishDrawBezierCurve={handleFinishDrawBezierCurve}
              bezierSurfaceObjectId={bezierSurfaceObjectId}
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
            onObjectSelect={(id) => { setSelectedObjectId(id); if (id) setShowScenePropertiesPanel(true); }}
            onForceSelect={setSelectedForceId}
            onObjectTransform={handleObjectTransform}
            handleScale={handleScale}
            onCacheFrameCountChange={setCachedFrameCount}
            cacheResetToken={cacheResetToken}
            onUpdateSceneSettings={(updates) => setSceneSettings(prev => ({ ...prev, ...updates }))}
            spineAttachments={spineAllAttachments}
            spineFrameOverrides={spineFrameOverrides}
            spineLayerSpread={spineLayerSpread}
            quadViewport={quadViewport}
            quadPanelViews={quadPanelViews}
            manipulatorMode={manipulatorMode}
            onManipulatorModeChange={setManipulatorMode}
            lookThroughCamera={lookThroughCamera}
            onViewportRightClick={(sx, sy, panel) => setMarkingMenu({ x: sx, y: sy, type: 'context', panel })}
            capturePreviewObjectIds={[]}
            capturePreviewPadding={capturePadding}
            manualCropRect={showCaptureOverlay ? (manualCropRect ?? undefined) : undefined}
            onManualCropChange={setManualCropRect}
            hiddenObjectIds={[...spineExcludedObjectIds]}
          />

          {/* ─── Viewport render-frame preview ──────────────────────────────── */}
          {(viewportSeqDialog !== null || renderFramePreview !== null) && (() => {
            const src = viewportSeqDialog ?? renderFramePreview!;
            const isRendering = !!(viewportSeqDialog?.rendering);
            const isPreviewOnly = viewportSeqDialog === null;
            return (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 8, pointerEvents: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  aspectRatio: `${src.width} / ${src.height}`,
                  maxWidth: '100%',
                  maxHeight: '100%',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.48)',
                  border: `2px solid ${
                    isRendering ? 'rgba(100,200,100,0.9)'
                    : isPreviewOnly ? 'rgba(120,180,255,0.85)'
                    : 'rgba(255,200,50,0.9)'
                  }`,
                  position: 'relative',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.25s',
                }}>
                  {/* inner guide rectangle */}
                  <div style={{
                    position: 'absolute', inset: 6,
                    border: `1px solid ${
                      isRendering ? 'rgba(100,200,100,0.25)'
                      : isPreviewOnly ? 'rgba(120,180,255,0.18)'
                      : 'rgba(255,200,50,0.25)'
                    }`,
                    transition: 'border-color 0.25s',
                  }} />
                  {/* info badge — bottom-center */}
                  <div style={{
                    position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(0,0,0,0.72)', padding: '3px 10px', borderRadius: 5,
                    color: isRendering ? 'rgba(100,220,100,0.95)'
                      : isPreviewOnly ? 'rgba(140,200,255,0.95)'
                      : 'rgba(255,210,60,0.95)',
                    fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
                    letterSpacing: '0.03em',
                  }}>
                    {isRendering
                      ? `● Rendering…`
                      : `${src.width}×${src.height} · ${src.frameCount}f @ ${src.fps} fps`
                    }
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ─── Marking Menu overlay ─── */}
          {markingMenu && (() => {
            const selectedObj = sceneObjects.find(o => o.id === selectedObjectId);
            // Determine which viewport's current view to show as active
            const clickedPanelView: 'perspective'|'x'|'y'|'z' = (markingMenu.panel && quadViewport)
              ? quadPanelViews[markingMenu.panel]
              : viewMode;
            // Change view: in quad mode affect only the clicked panel; otherwise global viewMode
            const changeView = (v: 'perspective'|'x'|'y'|'z') => {
              if (markingMenu.panel && quadViewport) {
                setQuadPanelViews(prev => ({ ...prev, [markingMenu.panel!]: v }));
              } else {
                setViewMode(v);
              }
            };
            // Space hotbox: tools + view modes
            const toolItems: MarkingMenuItem[] = [
              { position: 'N',  icon: '✛', label: 'Move',       shortcut: 'W / G', active: manipulatorMode === 'translate', action: () => setManipulatorMode('translate') },
              { position: 'E',  icon: '↻', label: 'Rotate',     shortcut: 'E / R', active: manipulatorMode === 'rotate',    action: () => setManipulatorMode('rotate') },
              { position: 'S',  icon: '⤡', label: 'Scale',      shortcut: 'S',     active: manipulatorMode === 'scale',     action: () => setManipulatorMode('scale') },
              { position: 'W',  icon: '⊹', label: 'Deselect',  shortcut: 'Esc',                                            action: () => setSelectedObjectId(null) },
              { position: 'NW', icon: '◈', label: 'Persp',     shortcut: '',      active: clickedPanelView === 'perspective', action: () => changeView('perspective') },
              { position: 'NE', icon: '▤', label: 'Top',       shortcut: '',      active: clickedPanelView === 'y',           action: () => changeView('y') },
              { position: 'SE', icon: '▥', label: 'Front',     shortcut: '',      active: clickedPanelView === 'z',           action: () => changeView('z') },
              { position: 'SW', icon: '▦', label: 'Side',      shortcut: '',      active: clickedPanelView === 'x',           action: () => changeView('x') },
            ];
            // RMB context menu: no object selected
            const noSelContextItems: MarkingMenuItem[] = [
              { position: 'N',  icon: '⌖', label: 'Frame All', shortcut: 'A',                                               action: () => { setMarkingMenu(null); } },
              { position: 'NW', icon: '◈', label: 'Persp',     shortcut: '',      active: clickedPanelView === 'perspective', action: () => changeView('perspective') },
              { position: 'NE', icon: '▤', label: 'Top',       shortcut: '',      active: clickedPanelView === 'y',           action: () => changeView('y') },
              { position: 'E',  icon: '▥', label: 'Front',     shortcut: '',      active: clickedPanelView === 'z',           action: () => changeView('z') },
              { position: 'SE', icon: '▦', label: 'Side',      shortcut: '',      active: clickedPanelView === 'x',           action: () => changeView('x') },
              { position: 'S',  icon: '📷', label: 'Camera View', shortcut: '',   active: lookThroughCamera,                  action: () => setLookThroughCamera(p => !p) },
              { position: 'SW', icon: '⊞', label: 'Quad',      shortcut: 'Space', active: quadViewport,                      action: () => setQuadViewport(p => !p) },
            ];
            // RMB context menu: object selected
            const selContextItems: MarkingMenuItem[] = [
              { position: 'N',  icon: '⊕', label: 'Duplicate', shortcut: 'Ctrl+D',                                          action: () => handleDuplicateObject() },
              { position: 'S',  icon: '✕', label: 'Delete',    shortcut: 'Del',                                             action: () => handleDeleteObject(),   color: 'rgba(200,55,55,0.97)' },
              { position: 'W',  icon: '⊹', label: 'Deselect',  shortcut: 'Esc',                                             action: () => setSelectedObjectId(null) },
              { position: 'E',  icon: '⌖', label: 'Focus',     shortcut: 'F',                                               action: () => { /* F key fires via Scene3D */ } },
              { position: 'NE', icon: '✏', label: 'Rename',    shortcut: 'F2',                                              action: () => { if (selectedObj) startRenameObject(selectedObj); } },
              { position: 'NW', icon: '◈', label: 'Persp',     shortcut: '',      active: clickedPanelView === 'perspective', action: () => changeView('perspective') },
              { position: 'SE', icon: '▤', label: 'Top',       shortcut: '',      active: clickedPanelView === 'y',           action: () => changeView('y') },
              { position: 'SW', icon: '▥', label: 'Front',     shortcut: '',      active: clickedPanelView === 'z',           action: () => changeView('z') },
            ];
            const items = markingMenu.type === 'tool' ? toolItems
              : selectedObjectId ? selContextItems : noSelContextItems;
            return (
              <MarkingMenu
                x={markingMenu.x} y={markingMenu.y}
                items={items}
                title={markingMenu.type === 'tool' ? 'Hotbox' : selectedObj ? selectedObj.name : 'Viewport'}
                onClose={() => setMarkingMenu(null)}
                onHoverChange={item => { markingMenuHoveredRef.current = item; }}
              />
            );
          })()}
        </main>

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

                        {(force.type === 'attractor' || force.type === 'repulsor' || force.type === 'tornado' || force.type === 'vortex' || force.type === 'turbulence' || force.type === 'flow-curve') && (
                          <>
                            <label htmlFor="force-radius">
                              {force.type === 'turbulence' ? 'Size (Deformation Map)' : force.type === 'flow-curve' ? 'Tube Radius' : 'Radius'}: {force.radius?.toFixed(1) ?? 50}
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

                        {force.type === 'flow-curve' && (
                          <>
                            <label>Target Path</label>
                            <select
                              value={force.curveId || ''}
                              onChange={(event) => {
                                handleUpdatePhysicsForce(force.id, { curveId: event.target.value || undefined });
                              }}
                            >
                              <option value="">Select Path...</option>
                              {sceneObjects
                                .filter((obj) => obj.type === 'Path' || obj.type === 'Curve' || (obj.type || '').toLowerCase().includes('bezier'))
                                .map((shape) => (
                                  <option key={shape.id} value={shape.id}>
                                    {shape.name || shape.id}
                                  </option>
                                ))}
                            </select>
                            
                            <label style={{ display: 'flex', alignItems: 'center', marginTop: '10px', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={!!force.reverseFlow}
                                onChange={(event) => {
                                  handleUpdatePhysicsForce(force.id, { reverseFlow: event.target.checked });
                                }}
                                style={{ marginRight: '8px' }}
                              />
                              Reverse Path Direction
                            </label>

                            <label htmlFor={`force-twist-${force.id}`} style={{ marginTop: '10px', display: 'block' }}>
                              Twist: {(force.twist ?? 0).toFixed(0)}° / loop
                            </label>
                            <input
                              id={`force-twist-${force.id}`}
                              type="range"
                              min={-720}
                              max={720}
                              step={5}
                              value={force.twist ?? 0}
                              onChange={(event) => handleUpdatePhysicsForce(force.id, { twist: Number.parseFloat(event.target.value) })}
                            />

                            <label htmlFor={`force-falloff-${force.id}`} style={{ marginTop: '10px', display: 'block' }}>
                              Fall Off Start: {(force.falloff ?? 100).toFixed(0)}%
                            </label>
                            <input
                              id={`force-falloff-${force.id}`}
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={force.falloff ?? 100}
                              onChange={(event) => handleUpdatePhysicsForce(force.id, { falloff: Number.parseFloat(event.target.value) })}
                            />
                            <p style={{ fontSize: '0.8rem', color: '#8a93a2', margin: '2px 0 6px' }}>
                              After this point on the path the pull weakens, letting particles fly away.
                            </p>

                            <p style={{ fontSize: '0.85rem', color: '#8a93a2', marginTop: '0.5rem' }}>
                              Particles will run along the selected 3D path.
                            </p>
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


                        <label htmlFor="emission-rate">
                          Emission Rate: {selectedEmitterProperties.emissionRate} particles/sec
                        </label>
                        <input
                          id="emission-rate"
                          max={10000}
                          min={1}
                          onChange={(event) => handleUpdateEmitterProperty('emissionRate', Number.parseFloat(event.target.value))}
                          step={10}
                          type="range"
                          value={selectedEmitterProperties.emissionRate}
                        />

                        <hr style={{ margin: '0.8rem 0', borderColor: '#3b455c' }} />

                        <label htmlFor="emit-spine-attach">Emit from Spine Attachment</label>
                        <select
                          id="emit-spine-attach"
                          value={selectedEmitterProperties.emitFromSpineAttachmentId || ''}
                          onChange={(e) => handleUpdateEmitterProperty('emitFromSpineAttachmentId', e.target.value)}
                          style={{ width: '100%', marginBottom: '0.4rem' }}
                        >
                          <option value="">None (use emitter position)</option>
                          {spineAllAttachments.map(att => (
                            <option key={att.id} value={att.id}>
                              {att.slotName}
                            </option>
                          ))}
                        </select>

                        <div className={`transform-slots ${selectedObject.type === 'Emitter' ? 'compact-emitter' : ''}`}>
                          <label htmlFor="emitter-type">Emitter Shape</label>
                          <select
                            id="emitter-type"
                            value={selectedEmitterProperties.emitterType}
                            onChange={(event) => handleUpdateEmitterProperty('emitterType', event.target.value)}
                          >
                            <option value="point">Point</option>
                            <option value="circle">Circle</option>
                            <option value="square">Square</option>
                            <option value="cube">Cube</option>
                            <option value="ball">Ball (Sphere)</option>
                            <option value="layer">Layer</option>
                          </select>

                          {selectedEmitterProperties.emitterType !== 'point' && (
                            <>
                              <label htmlFor="emitter-emission-mode">Emission Mode</label>
                              <select
                                id="emitter-emission-mode"
                                value={selectedEmitterProperties.emissionMode}
                                onChange={(event) => handleUpdateEmitterProperty('emissionMode', event.target.value as 'volume' | 'surface' | 'edge')}
                              >
                                <option value="volume">Volume (fill interior)</option>
                                <option value="surface">Surface (outer shell)</option>
                                <option value="edge">Edge (wireframe)</option>
                              </select>
                            </>
                          )}
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
                        <p style={{ fontSize: '0.8rem', color: '#8a93a2', marginTop: '0.5rem', marginBottom: '0.8rem' }}>
                            {selectedObject.parentId
                              ? 'This shape is connected to an emitter and will be used as an emission source.'
                              : 'Select an emitter to use this shape as an emission source.'}
                          </p>

                          {selectedObject.parentId && (
                            <>
                              <label htmlFor="shape-emission-mode">Emission Mode</label>
                              <select
                                id="shape-emission-mode"
                                value={(selectedObject.properties as any)?.emissionMode || 'volume'}
                                onChange={(event) => {
                                  handleUpdateEmitterProperty('emissionMode', event.target.value);
                                }}
                              >
                                <option value="volume">Volume (Random fill / Inner)</option>
                                <option value="surface">Surface (Outer Shell)</option>
                                <option value="edge">Edge (Wireframe)</option>
                              </select>
                            </>
                          )}
                        </div>
                    )}

                    <hr style={{ margin: '0.8rem 0', borderColor: '#3b455c' }} />
                  </>
                )}

                {/* Path Animation Section */}
                <button
                  type="button"
                  className="collapsible-section"
                  onClick={() => setShowPathAnimation((prev) => !prev)}
                >
                  <span>Path Animation</span>
                  <span>{showPathAnimation ? '▾' : '▸'}</span>
                </button>

                {showPathAnimation && (
                  <div className="subpanel-content">
                    <label htmlFor="path-anim-id">Follow Path</label>
                    <select
                      id="path-anim-id"
                      value={(selectedObject.properties as any)?.pathAnimPathId || ''}
                      onChange={(e) => handleUpdateEmitterProperty('pathAnimPathId', e.target.value)}
                      style={{ width: '100%', marginBottom: '0.4rem' }}
                    >
                      <option value="">None</option>
                      {sceneObjects
                        .filter((obj) => obj.type === 'Path')
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name || p.id}
                          </option>
                        ))}
                    </select>

                    {!!(selectedObject.properties as any)?.pathAnimPathId && (
                      <>
                        <label htmlFor="path-anim-speed">
                          Speed: {((selectedObject.properties as any)?.pathAnimSpeed ?? 0.1).toFixed(2)}
                        </label>
                        <input
                          id="path-anim-speed"
                          type="range"
                          min={0.01}
                          max={2.0}
                          step={0.01}
                          value={(selectedObject.properties as any)?.pathAnimSpeed ?? 0.1}
                          onChange={(e) => handleUpdateEmitterProperty('pathAnimSpeed', Number.parseFloat(e.target.value))}
                        />

                        <hr style={{ margin: '0.6rem 0', borderColor: '#3b455c' }} />

                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '6px' }}>
                          <input
                            type="checkbox"
                            checked={(selectedObject.properties as any)?.pathAnimLoop !== false}
                            onChange={(e) => handleUpdateEmitterProperty('pathAnimLoop', e.target.checked)}
                          />
                          Loop
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '6px' }}>
                          <input
                            type="checkbox"
                            checked={!!(selectedObject.properties as any)?.pathAnimOrient}
                            onChange={(e) => handleUpdateEmitterProperty('pathAnimOrient', e.target.checked)}
                          />
                          Orient to path (align forward axis)
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '6px' }}>
                          <input
                            type="checkbox"
                            checked={!!(selectedObject.properties as any)?.pathAnimAlignUp}
                            onChange={(e) => handleUpdateEmitterProperty('pathAnimAlignUp', e.target.checked)}
                          />
                          Lock up-axis to path normal
                        </label>
                      </>
                    )}
                  </div>
                )}

                <hr style={{ margin: '0.8rem 0', borderColor: '#3b455c' }} />

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
                          <option value="circles">Circles</option>
                          <option value="glow-circles">Glow Circles</option>
                          <option value="stars">Stars (4-point)</option>
                          <option value="sparkle">Sparkle (8-point lens flare)</option>
                            <option value="glitter">Glitter (Metallic Bloom)</option>
                          <option value="sprites">Sprites</option>
                          <option value="3d-model">Live 3D Model</option>
                        </select>

                        <button
                          type="button"
                          className="apply-button"
                          style={{ marginBottom: '6px' }}
                          onClick={() => setShowParticleCreator(true)}
                        >
                          ✨ Open Particle Creator
                        </button>

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

                            {selectedEmitterProperties.particleSpriteSequenceDataUrls.length === 0 && selectedEmitterProperties.particleSpriteImageDataUrl && (
                              <div style={{ margin: '6px 0', background: '#0a0d18', borderRadius: '6px', padding: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <img
                                  src={selectedEmitterProperties.particleSpriteImageDataUrl}
                                  alt="sprite preview"
                                  style={{ width: '56px', height: '56px', objectFit: 'contain', imageRendering: 'pixelated', background: '#000', borderRadius: '4px', flexShrink: 0 }}
                                />
                                <span style={{ fontSize: '0.78rem', color: '#8a93a2', wordBreak: 'break-all' }}>
                                  {selectedEmitterProperties.particleSpriteImageName || 'Custom sprite'}
                                </span>
                              </div>
                            )}

                            {selectedEmitterProperties.particleSpriteSequenceDataUrls.length > 0 && (
                              <div style={{ margin: '6px 0', background: '#0a0d18', borderRadius: '6px', padding: '6px' }}>
                                <div style={{ fontSize: '0.75rem', color: '#8a93a2', marginBottom: '4px' }}>
                                  {selectedEmitterProperties.particleSpriteSequenceFirstName || 'Animated sequence'} — {selectedEmitterProperties.particleSpriteSequenceDataUrls.length} frames
                                </div>
                                <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                                  {selectedEmitterProperties.particleSpriteSequenceDataUrls.slice(0, 8).map((url, i) => (
                                    <img key={i} src={url} alt={`frame ${i}`}
                                      style={{ width: '28px', height: '28px', objectFit: 'contain', background: '#000', borderRadius: '3px', imageRendering: 'pixelated' }} />
                                  ))}
                                  {selectedEmitterProperties.particleSpriteSequenceDataUrls.length > 8 && (
                                    <span style={{ fontSize: '0.7rem', color: '#555', alignSelf: 'center' }}>+{selectedEmitterProperties.particleSpriteSequenceDataUrls.length - 8} more</span>
                                  )}
                                </div>
                              </div>
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

                              {/* SPRITE LIBRARY */}
                              <div style={{ marginTop: '12px', background: '#0a0d18', borderRadius: '6px', padding: '8px', border: '1px solid #3b455c' }}>
                                <div style={{ fontSize: '0.8rem', color: '#c8d0e0', marginBottom: '8px', fontWeight: 'bold' }}>Sprite Library</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: '6px', maxHeight: '160px', overflowY: 'auto', paddingRight: '4px' }}>
                                  {spriteLibrary.length === 0 && <div style={{ fontSize: '0.7rem', color: '#8a93a2', gridColumn: '1 / -1' }}>No saved sprites. Upload a PNG to add it to your library.</div>}
                                  {spriteLibrary.map(img => (
                                    <div key={img.id} style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: '4px', background: '#1a1f2e', border: ((selectedEmitterProperties.particleSpriteImageDataUrl === img.dataUrl) ? '2px solid #4f6ef7' : '1px solid #3b455c'), cursor: 'pointer', overflow: 'hidden' }} onClick={() => {
                                      handleUpdateEmitterProperty('particleSpriteImageDataUrl', img.dataUrl);
                                      handleUpdateEmitterProperty('particleSpriteImageName', img.name);
                                      handleUpdateEmitterProperty('particleSpriteSequenceDataUrls', []);
                                      handleUpdateEmitterProperty('particleSpriteSequenceFirstName', '');
                                    }} title={img.name}>
                                      <img src={img.dataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }} alt={img.name} />
                                      <button type="button" onClick={(e) => {
                                        e.stopPropagation();
                                        deleteImageFromDB(img.id);
                                        setSpriteLibrary(prev => prev.filter(i => i.id !== img.id));
                                      }} style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', fontSize: '10px', borderRadius: '3px', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 10 }}>×</button>
                                    </div>
                                  ))}
                                </div>
                              </div>
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
                          min={0}
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

                        <label htmlFor="particle-rotation-drift">
                          Rotation Drift: {(selectedEmitterProperties.particleRotationDrift ?? 0).toFixed(0)}°
                        </label>
                        <input
                          id="particle-rotation-drift"
                          max={180}
                          min={0}
                          onChange={(event) => handleUpdateEmitterProperty('particleRotationDrift', Number.parseFloat(event.target.value))}
                          step={1}
                          type="range"
                          value={selectedEmitterProperties.particleRotationDrift ?? 0}
                          title="Each particle slowly wobbles ±this many degrees around its base rotation — smooth sinusoidal, not chaotic"
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

                        {/* ── Drift Ghost Copies ── */}
                        <div style={{ padding: '0.4rem 0.5rem', background: '#1a2030', borderRadius: '4px', border: '1px solid #2c3a55', marginBottom: '0.5rem' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#9bd4ff', fontSize: '0.78rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={Boolean((selectedEmitterProperties as any).driftCopiesEnabled ?? false)}
                              onChange={e => handleUpdateEmitterProperty('driftCopiesEnabled', e.target.checked)}
                            />
                            Drift Ghost Copies
                          </label>
                          {Boolean((selectedEmitterProperties as any).driftCopiesEnabled) && (
                            <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <label>Copies: {(selectedEmitterProperties as any).driftCopiesCount ?? 3}</label>
                              <input type="range" min={1} max={8} step={1}
                                value={(selectedEmitterProperties as any).driftCopiesCount ?? 3}
                                onChange={e => handleUpdateEmitterProperty('driftCopiesCount', Number(e.target.value))} />
                              <label>Spacing: {(selectedEmitterProperties as any).driftCopiesSpacing ?? 20}</label>
                              <input type="range" min={4} max={120} step={2}
                                value={(selectedEmitterProperties as any).driftCopiesSpacing ?? 20}
                                onChange={e => handleUpdateEmitterProperty('driftCopiesSpacing', Number(e.target.value))} />
                              <label>Drift Speed: {(selectedEmitterProperties as any).driftCopiesSpeed ?? 40}</label>
                              <input type="range" min={5} max={200} step={5}
                                value={(selectedEmitterProperties as any).driftCopiesSpeed ?? 40}
                                onChange={e => handleUpdateEmitterProperty('driftCopiesSpeed', Number(e.target.value))} />
                            </div>
                          )}
                        </div>

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

                        {/* ── Tint Gradient: colour + alpha over particle lifetime ── */}
                        <div style={{ marginTop: '10px', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#c8d0e0' }}>Tint Gradient</span>
                            <div style={{ display: 'flex', gap: '5px' }}>
                              <button type="button"
                                style={{ fontSize: '0.7rem', background: '#252f45', border: '1px solid #3b455c', color: '#c8d0e0', borderRadius: '4px', padding: '2px 7px', cursor: 'pointer' }}
                                onClick={() => {
                                  const cur = selectedEmitterProperties.particleTintGradient ?? [];
                                  const tNew = cur.length === 0 ? 0 : cur.length === 1 ? 1 : Math.round(((cur[cur.length - 1].t + 1) / 2) * 100) / 100;
                                  const newStop: TintStop = { t: Math.min(1, tNew), color: '#ffffff', alpha: 1 };
                                  handleUpdateEmitterProperty('particleTintGradient', [...cur, newStop].sort((a, b) => a.t - b.t));
                                }}>+ Add Stop</button>
                              {(selectedEmitterProperties.particleTintGradient ?? []).length > 0 && (
                                <button type="button"
                                  style={{ fontSize: '0.7rem', background: '#3b1c1c', border: '1px solid #6b2a2a', color: '#e08080', borderRadius: '4px', padding: '2px 7px', cursor: 'pointer' }}
                                  onClick={() => handleUpdateEmitterProperty('particleTintGradient', [])}>Clear</button>
                              )}
                            </div>
                          </div>
                          {/* Gradient preview bar */}
                          {(selectedEmitterProperties.particleTintGradient ?? []).length > 0 && (() => {
                            const stops = [...(selectedEmitterProperties.particleTintGradient ?? [])].sort((a, b) => a.t - b.t);
                            const parts = stops.map(s => {
                              const r = parseInt(s.color.slice(1, 3), 16);
                              const g = parseInt(s.color.slice(3, 5), 16);
                              const b = parseInt(s.color.slice(5, 7), 16);
                              return `rgba(${r},${g},${b},${s.alpha}) ${Math.round(s.t * 100)}%`;
                            });
                            return (
                              <div style={{ height: '14px', borderRadius: '4px', border: '1px solid #3b455c', marginBottom: '8px',
                                background: `linear-gradient(to right, ${parts.join(', ')})` }} />
                            );
                          })()}
                          {/* Stop rows */}
                          {[...(selectedEmitterProperties.particleTintGradient ?? [])].sort((a, b) => a.t - b.t).map((stop, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                              <input type="range" min={0} max={100} step={1}
                                value={Math.round(stop.t * 100)}
                                title={`Position: ${Math.round(stop.t * 100)}%`}
                                onChange={e => {
                                  const arr = [...(selectedEmitterProperties.particleTintGradient ?? [])].sort((a, b) => a.t - b.t);
                                  arr[idx] = { ...arr[idx], t: Number(e.target.value) / 100 };
                                  handleUpdateEmitterProperty('particleTintGradient', arr);
                                }}
                                style={{ width: '52px', accentColor: stop.color }} />
                              <span style={{ fontSize: '0.65rem', color: '#8a93a2', minWidth: '24px' }}>{Math.round(stop.t * 100)}%</span>
                              <input type="color" value={stop.color}
                                onChange={e => {
                                  const arr = [...(selectedEmitterProperties.particleTintGradient ?? [])].sort((a, b) => a.t - b.t);
                                  arr[idx] = { ...arr[idx], color: e.target.value };
                                  handleUpdateEmitterProperty('particleTintGradient', arr);
                                }}
                                style={{ width: '28px', height: '22px', padding: '1px', border: '1px solid #3b455c', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                              <input type="range" min={0} max={100} step={1}
                                value={Math.round(stop.alpha * 100)}
                                title={`Alpha: ${Math.round(stop.alpha * 100)}%`}
                                onChange={e => {
                                  const arr = [...(selectedEmitterProperties.particleTintGradient ?? [])].sort((a, b) => a.t - b.t);
                                  arr[idx] = { ...arr[idx], alpha: Number(e.target.value) / 100 };
                                  handleUpdateEmitterProperty('particleTintGradient', arr);
                                }}
                                style={{ width: '52px', accentColor: '#8a93a2' }} />
                              <span style={{ fontSize: '0.65rem', color: '#8a93a2', minWidth: '22px' }}>{Math.round(stop.alpha * 100)}%</span>
                              <button type="button"
                                onClick={() => {
                                  const arr = [...(selectedEmitterProperties.particleTintGradient ?? [])].sort((a, b) => a.t - b.t);
                                  arr.splice(idx, 1);
                                  handleUpdateEmitterProperty('particleTintGradient', arr);
                                }}
                                style={{ fontSize: '0.7rem', background: 'transparent', border: '1px solid #3b455c', color: '#8a93a2', borderRadius: '3px', padding: '1px 5px', cursor: 'pointer' }}>✕</button>
                            </div>
                          ))}
                        </div>

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

                {selectedObject.type === 'Lightning' && (() => {
                  const lp = (selectedObject.properties ?? {}) as any;
                  const upd = (k: string, v: any) => handleUpdateEmitterProperty(k, v);
                  // Candidate anchor objects — anything except the lightning itself and its own LightningPoint children
                  const lightningChildIds = new Set(sceneObjects.filter(o => o.parentId === selectedObject.id).map(o => o.id));
                  const anchorCandidates = sceneObjects.filter(o => o.id !== selectedObject.id && !lightningChildIds.has(o.id));
                  return (
                    <>
                      <div className="collapsible-section" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontWeight: 600, color: '#c8d0e0' }}>⚡ Lightning Properties</span>
                      </div>
                      <div className="subpanel-content">

                        <div style={{ marginBottom: '6px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Anchors</div>
                        <label>Source Object</label>
                        <select
                          value={lp.startShapeId ?? ''}
                          onChange={e => upd('startShapeId', e.target.value || undefined)}
                        >
                          <option value="">(Start handle)</option>
                          {anchorCandidates.map(o => (
                            <option key={o.id} value={o.id}>{o.name || o.type} [{o.type}]</option>
                          ))}
                        </select>

                        <label>Target Object</label>
                        <select
                          value={lp.endShapeId ?? ''}
                          onChange={e => upd('endShapeId', e.target.value || undefined)}
                        >
                          <option value="">(End handle)</option>
                          {anchorCandidates.map(o => (
                            <option key={o.id} value={o.id}>{o.name || o.type} [{o.type}]</option>
                          ))}
                        </select>

                        {(lp.endShapeId) && (
                          <>
                            <label>Target Attraction: {(lp.targetAttraction ?? 0.6).toFixed(1)}</label>
                            <input type="range" min={0} max={10} step={0.1}
                              value={lp.targetAttraction ?? 0.6}
                              onChange={e => upd('targetAttraction', Number(e.target.value))} />
                            <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>
                              Higher = branches crawl to surface. Set a mesh as Target to enable surface crawl.
                            </div>
                          </>
                        )}

                        <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Follow Bezier Curves</div>
                        {anchorCandidates.filter(o => o.type === 'Path').length === 0 ? (
                          <div style={{ fontSize: '0.72rem', color: '#6a7382', marginBottom: '4px' }}>No Path objects in scene. Draw a Bezier curve first.</div>
                        ) : (
                          anchorCandidates.filter(o => o.type === 'Path').map(pathObj => {
                            const ids: string[] = Array.isArray(lp.followBezierPathIds) ? lp.followBezierPathIds : [];
                            const checked = ids.includes(pathObj.id);
                            return (
                              <label key={pathObj.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '2px', fontWeight: 400 }}>
                                <input type="checkbox" checked={checked} onChange={e => {
                                  const next = e.target.checked ? [...ids, pathObj.id] : ids.filter(x => x !== pathObj.id);
                                  upd('followBezierPathIds', next);
                                }} />
                                {pathObj.name || 'Path'}
                              </label>
                            );
                          })
                        )}
                        {(() => { const ids: string[] = Array.isArray(lp.followBezierPathIds) ? lp.followBezierPathIds : []; return ids.length > 0; })() && (
                          <>
                            <label>Curve Tightness: {(lp.curveTightness ?? 0.65).toFixed(2)}</label>
                            <input type="range" min={0} max={10} step={0.05}
                              value={lp.curveTightness ?? 0.65}
                              onChange={e => upd('curveTightness', Number(e.target.value))} />
                          </>
                        )}

                        <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Crawl 3D Surface</div>
                        <select
                          value={lp.bindSurfaceId ?? ''}
                          onChange={e => upd('bindSurfaceId', e.target.value || undefined)}
                        >
                          <option value="">(None)</option>
                          {anchorCandidates.filter(o => !['LightningPoint','Path','Emitter','Force','Bone','Light','Camera'].includes(o.type)).map(o => (
                            <option key={o.id} value={o.id}>{o.name || o.type} [{o.type}]</option>
                          ))}
                        </select>
                        {lp.bindSurfaceId && (
                          <>
                            <label>Crawl Tightness: {((lp.surfaceTightness ?? 0.72) * 100).toFixed(0)}%</label>
                            <input type="range" min={0} max={1} step={0.02}
                              value={lp.surfaceTightness ?? 0.72}
                              onChange={e => upd('surfaceTightness', Number(e.target.value))} />
                            <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>0% = bolt ignores surface. 100% = bolt pressed flat against mesh.</div>
                          </>
                        )}

                        <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Spine Image Crawl</div>
                        {spineAllAttachments.length === 0 ? (
                          <div style={{ fontSize: '0.72rem', color: '#6a7382', marginBottom: '4px' }}>No Spine imported. Import a Spine file first.</div>
                        ) : (
                          <>
                            <label>Spine Image</label>
                            <select
                              value={lp.bindSpineAttachmentId ?? ''}
                              onChange={e => upd('bindSpineAttachmentId', e.target.value || undefined)}
                            >
                              <option value="">(None)</option>
                              {spineAllAttachments.map(att => (
                                <option key={att.id} value={att.id}>{att.slotName}</option>
                              ))}
                            </select>
                            {lp.bindSpineAttachmentId && (
                              <>
                                <label>Surface → Outline: {Math.round((lp.spineEdgeRatio ?? 0) * 100)}%</label>
                                <input type="range" min={0} max={1} step={0.02}
                                  value={lp.spineEdgeRatio ?? 0}
                                  onChange={e => upd('spineEdgeRatio', Number(e.target.value))} />
                                <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>
                                  0% = lightning scatters across full image area. 100% = lightning snaps to visible outline.
                                </div>
                                <label>Snap Tightness: {((lp.surfaceTightness ?? 0.72) * 100).toFixed(0)}%</label>
                                <input type="range" min={0} max={1} step={0.02}
                                  value={lp.surfaceTightness ?? 0.72}
                                  onChange={e => upd('surfaceTightness', Number(e.target.value))} />
                              </>
                            )}
                          </>
                        )}

                        <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Physics Modifiers</div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400 }}>
                          <input type="checkbox" checked={!!(lp.usePhysicsModifiers)} onChange={e => upd('usePhysicsModifiers', e.target.checked)} />
                          Apply Physics Forces
                        </label>
                        {!!(lp.usePhysicsModifiers) && (
                          <>
                            <label>Modifier Strength: {(lp.modifierStrength ?? 1).toFixed(2)}</label>
                            <input type="range" min={0} max={4} step={0.05}
                              value={lp.modifierStrength ?? 1}
                              onChange={e => upd('modifierStrength', Number(e.target.value))} />
                          </>
                        )}

                        <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Rendering</div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400 }}>
                          <input type="checkbox"
                            checked={lp.occludeByGeometry !== false}
                            onChange={e => upd('occludeByGeometry', e.target.checked)} />
                          Respect 3D depth (occluded by objects in front)
                        </label>
                        <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>
                          Off = lightning always renders on top of everything.
                        </div>

                        <div style={{ marginTop: '6px', marginBottom: '6px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Bolt Shape</div>
                        <label>Mode</label>
                        <select value={lp.mode ?? 'loop-strike'} onChange={e => upd('mode', e.target.value)}>
                          <option value="loop">Loop (jitter)</option>
                          <option value="strike">Strike (grow)</option>
                          <option value="loop-strike">Loop-Strike (auto cycle)</option>
                        </select>

                        <label>Core Color</label>
                        <input type="color" value={lp.coreColor ?? '#ffffff'} onChange={e => upd('coreColor', e.target.value)} style={{ width: '100%', height: '30px' }} />
                        <label>Glow Color</label>
                        <input type="color" value={lp.glowColor ?? '#0008ff'} onChange={e => upd('glowColor', e.target.value)} style={{ width: '100%', height: '30px' }} />

                        <label>Core Width: {lp.coreWidth ?? 1}</label>
                        <input type="range" min={0.5} max={8} step={0.5} value={lp.coreWidth ?? 1} onChange={e => upd('coreWidth', Number(e.target.value))} />
                        <label>Glow Width: {lp.glowWidth ?? 4}</label>
                        <input type="range" min={1} max={30} step={1} value={lp.glowWidth ?? 4} onChange={e => upd('glowWidth', Number(e.target.value))} />
                        <label>Base Shape</label>
                        <select value={lp.flareShape ?? 'circle'} onChange={e => upd('flareShape', e.target.value)}>
                          <option value="circle">Circle (Soft)</option>
                          <option value="diamond">Diamond (Sharp)</option>
                          <option value="star">Star (Cross)</option>
                          <option value="sharp">Hard Edge Circle</option>  {spriteLibrary && spriteLibrary.map(s => <option key={s.id} value={s.dataUrl}>Custom: {s.name}</option>)}
</select>
                        <label>Segments: {lp.numSegments ?? 4}</label>
                        <input type="range" min={1} max={12} step={1} value={lp.numSegments ?? 4} onChange={e => upd('numSegments', Number(e.target.value))} />
                        <label>Segment Depth: {lp.segmentDepth ?? 2}</label>
                        <input type="range" min={1} max={4} step={1} value={lp.segmentDepth ?? 2} onChange={e => upd('segmentDepth', Number(e.target.value))} />
                        <label>Bend: {(lp.bend ?? 0).toFixed(2)}</label>
                        <input type="range" min={-2} max={2} step={0.05} value={lp.bend ?? 0} onChange={e => upd('bend', Number(e.target.value))} />
                        <label>Roughness: {(lp.roughness ?? 0.45).toFixed(2)}</label>
                        <input type="range" min={0} max={1} step={0.05} value={lp.roughness ?? 0.45} onChange={e => upd('roughness', Number(e.target.value))} />
                        <label>Turbulence: {(lp.turbulence ?? 0.35).toFixed(2)}</label>
                        <input type="range" min={0} max={1} step={0.05} value={lp.turbulence ?? 0.35} onChange={e => upd('turbulence', Number(e.target.value))} />
                        <label>Density: {(lp.density ?? 1.6).toFixed(1)}</label>
                        <input type="range" min={0.5} max={4} step={0.1} value={lp.density ?? 1.6} onChange={e => upd('density', Number(e.target.value))} />

                        <div style={{ marginTop: '6px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Branching</div>
                        <label>Branch Probability: {Math.round((lp.branchProbability ?? 0.5) * 100)}%</label>
                        <input type="range" min={0} max={1} step={0.05} value={lp.branchProbability ?? 0.5} onChange={e => upd('branchProbability', Number(e.target.value))} />
                        <label>Branch Levels: {lp.branchLevels ?? 2}</label>
                        <input type="range" min={1} max={3} step={1} value={lp.branchLevels ?? 2} onChange={e => upd('branchLevels', Number(e.target.value))} />
                        <label>Branch Decay: {(lp.branchDecay ?? 0.5).toFixed(2)}</label>
                        <input type="range" min={0.1} max={0.9} step={0.05} value={lp.branchDecay ?? 0.5} onChange={e => upd('branchDecay', Number(e.target.value))} />
                        <label>Branch Angle: {lp.branchAngle ?? 90}°</label>
                        <input type="range" min={0} max={180} step={5} value={lp.branchAngle ?? 90} onChange={e => upd('branchAngle', Number(e.target.value))} />

                        <div style={{ marginTop: '6px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Glow Noise</div>
                        <label>Glow Noise: {((lp.glowNoiseIntensity ?? 0) * 100).toFixed(0)}%</label>
                        <input type="range" min={0} max={1} step={0.05} value={lp.glowNoiseIntensity ?? 0} onChange={e => upd('glowNoiseIntensity', Number(e.target.value))} />
                        {(lp.glowNoiseIntensity ?? 0) > 0 && (
                          <>
                            <label>Noise Scale: {(lp.glowNoiseScale ?? 3).toFixed(1)}</label>
                            <input type="range" min={0.5} max={12} step={0.5} value={lp.glowNoiseScale ?? 3} onChange={e => upd('glowNoiseScale', Number(e.target.value))} />
                            <label>Noise Speed: {(lp.glowNoiseSpeed ?? 1).toFixed(1)} cyc/s</label>
                            <input type="range" min={0} max={5} step={0.1} value={lp.glowNoiseSpeed ?? 1} onChange={e => upd('glowNoiseSpeed', Number(e.target.value))} />
                          </>
                        )}

                        <div style={{ marginTop: '6px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Export</div>
                        <label>Frame Count: {lp.frameCount ?? 10}</label>
                        <input type="range" min={2} max={60} step={1} value={lp.frameCount ?? 10} onChange={e => upd('frameCount', Number(e.target.value))} />
                        <label>FPS: {lp.fps ?? 12}</label>
                        <input type="range" min={6} max={60} step={1} value={lp.fps ?? 12} onChange={e => upd('fps', Number(e.target.value))} />
                        <label>Export Mode</label>
                        <select value={lp.exportMode ?? 'sequence'} onChange={e => { upd('exportMode', e.target.value); setRenderFramePreview(null); }}>
                          <option value="sequence">Spine: PNG Sequence (slot cycles)</option>
                          <option value="bone-anim">Spine: Bone Animation</option>
                          <option value="viewport-sequence">Viewport PNG Sequence (transparent)</option>
                        </select>
                        {(lp.exportMode ?? 'sequence') === 'viewport-sequence' && (
                          <button
                            type="button"
                            onClick={() => setRenderFramePreview(prev =>
                              prev ? null : {
                                width:      lp.viewportExportWidth  ?? 512,
                                height:     lp.viewportExportHeight ?? 512,
                                frameCount: lp.frameCount ?? 10,
                                fps:        lp.fps ?? 12,
                              }
                            )}
                            style={{
                              marginTop: '6px', width: '100%', padding: '5px 0',
                              background: renderFramePreview ? 'rgba(100,170,255,0.15)' : 'rgba(255,255,255,0.06)',
                              border: renderFramePreview ? '1px solid rgba(120,180,255,0.6)' : '1px solid #3a4a5e',
                              borderRadius: '5px',
                              color: renderFramePreview ? '#80c0ff' : '#8a93a2',
                              fontSize: '0.78rem', cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                          >
                            {renderFramePreview ? '📹 Hide render frame' : '📹 Preview render frame'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleExportLightningToSpine}
                          style={{
                            marginTop: '10px', width: '100%', padding: '7px 0',
                            background: 'linear-gradient(135deg, #2a3a6a, #1a4a8a)',
                            border: '1px solid #4a7aff', borderRadius: '6px',
                            color: '#aac8ff', fontWeight: 700, fontSize: '0.8rem',
                            cursor: 'pointer', letterSpacing: '0.03em',
                          }}
                        >
                          {(lp.exportMode ?? 'sequence') === 'viewport-sequence' ? '🎞 Export PNG Sequence' : '⚡ Export to Spine'}
                        </button>
                      </div>
                    </>
                  );
                })()}

                {selectedObject.type === 'Camera' && (() => {
                  const cp = (selectedObject.properties ?? {}) as any;
                  const upd = (k: string, v: any) => handleUpdateEmitterProperty(k, v);
                  const fov = cp.fov ?? 75;
                  const hAoV = (2 * Math.atan(Math.tan((fov * Math.PI / 180) / 2) * (16 / 9)) * 180 / Math.PI).toFixed(0);
                  // Find the companion CameraTarget child
                  const camTargetObj = sceneObjects.find(o => o.type === 'CameraTarget' && o.parentId === selectedObject.id);
                  return (
                    <>
                      <div className="collapsible-section" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontWeight: 600, color: '#88ccff' }}>📷 Camera Properties</span>
                      </div>
                      <div className="subpanel-content">
                        {/* Look Through — toggle only via marking menu */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px',
                          padding: '6px 10px', borderRadius: '6px',
                          background: lookThroughCamera ? 'rgba(100,180,255,0.18)' : 'rgba(255,255,255,0.05)',
                          border: lookThroughCamera ? '1px solid #4a9eff' : '1px solid #3b455c',
                          fontWeight: 600, color: lookThroughCamera ? '#88ccff' : '#8a93a2' }}>
                          👁 Look Through Camera
                          {lookThroughCamera
                            ? <span style={{ fontSize: '0.7rem', fontWeight: 400, color: '#7acfff', marginLeft: 'auto' }}>Active — RMB to switch</span>
                            : <span style={{ fontSize: '0.7rem', fontWeight: 400, color: '#6a7a8a', marginLeft: 'auto' }}>RMB to activate</span>}
                        </div>

                        {/* Target info */}
                        <div style={{ fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px' }}>Look-at Target</div>
                        {camTargetObj ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
                            padding: '6px 10px', borderRadius: '6px', background: 'rgba(0,200,255,0.08)',
                            border: '1px solid rgba(0,200,255,0.25)' }}>
                            <span style={{ color: '#00ddff', fontSize: '1rem' }}>&#x25CE;</span>
                            <div>
                              <div style={{ fontWeight: 600, color: '#00ddff', fontSize: '0.8rem' }}>{camTargetObj.name || 'camera target'}</div>
                              <div style={{ fontSize: '0.7rem', color: '#7a8a9a' }}>
                                {camTargetObj.position.x.toFixed(0)}, {camTargetObj.position.y.toFixed(0)}, {camTargetObj.position.z.toFixed(0)}
                              </div>
                            </div>
                            <button type="button" onClick={() => setSelectedObjectId(camTargetObj.id)}
                              style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '3px 8px',
                                borderRadius: '4px', background: 'rgba(0,200,255,0.15)',
                                border: '1px solid rgba(0,200,255,0.4)', color: '#00ddff', cursor: 'pointer' }}>
                              Select
                            </button>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.72rem', color: '#7a8a9a', marginBottom: '8px' }}>
                            No target object found. Re-create the camera to get a movable target.
                          </div>
                        )}

                        <div style={{ fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>Lens</div>
                        <label>Field of View: {fov.toFixed(0)}° vertical · {hAoV}° horiz (16:9)</label>
                        <input type="range" min={10} max={150} step={1}
                          value={fov}
                          onChange={e => upd('fov', Number(e.target.value))} />
                        <div style={{ fontSize: '0.72rem', color: '#7a8a9a', marginTop: '4px' }}>
                          Wide angle ≈ 90°+, telephoto ≈ 20–40°
                        </div>

                        <hr style={{ margin: '0.8rem 0', borderColor: '#3b455c' }} />

                        {/* Path animation */}
                        <div style={{ fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '6px' }}>Follow Path</div>
                        <select
                          value={cp.pathAnimPathId || ''}
                          onChange={e => upd('pathAnimPathId', e.target.value)}
                          style={{ width: '100%', marginBottom: '0.4rem' }}
                        >
                          <option value="">None</option>
                          {sceneObjects
                            .filter(o => o.type === 'Path')
                            .map(p => (
                              <option key={p.id} value={p.id}>{p.name || p.id}</option>
                            ))}
                        </select>
                        {!!cp.pathAnimPathId && (
                          <>
                            <label>Speed: {(cp.pathAnimSpeed ?? 0.1).toFixed(2)}</label>
                            <input type="range" min={0.01} max={2.0} step={0.01}
                              value={cp.pathAnimSpeed ?? 0.1}
                              onChange={e => upd('pathAnimSpeed', Number(e.target.value))} />
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '4px' }}>
                              <input type="checkbox"
                                checked={cp.pathAnimLoop !== false}
                                onChange={e => upd('pathAnimLoop', e.target.checked)} />
                              Loop
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '4px' }}>
                              <input type="checkbox"
                                checked={!!cp.pathAnimOrient}
                                onChange={e => upd('pathAnimOrient', e.target.checked)} />
                              Orient camera forward along path
                            </label>
                            <div style={{ fontSize: '0.72rem', color: '#7a8a9a', marginTop: '2px' }}>
                              When oriented, camera looks down the path direction; target object is ignored.
                            </div>
                          </>
                        )}

                        <div style={{ fontSize: '0.72rem', color: '#7a8a9a', marginTop: '8px' }}>
                          Position and look-at target are fully keyframeable via the timeline.
                        </div>
                      </div>
                    </>
                  );
                })()}

                {selectedObject.type === 'Saber' && (() => {
  const sp = (selectedObject.properties ?? {}) as any;
  const upd = (key: string, val: unknown) => handleUpdateEmitterProperty(key, val as any);
  const applyPreset = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const presetName = e.target.value;
    let preset: any = null;
    if (presetName === 'Fire') {
        preset = { coreColor: '#ffffff', coreColorEnd: '#ffff00', glowColor: '#ffaa00', glowColorEnd: '#ff0000', coreWidth: 0.5, glowWidth: 12.0, noiseIntensity: 2.5, noiseScale: 6.0, noiseSpeed: 1.5, coreFalloff: 0.2, glowFalloff: 1.5 };
    } else if (presetName === 'Neon') {
        preset = { coreColor: '#eef5ff', coreColorEnd: '#eef5ff', glowColor: '#0066ff', glowColorEnd: '#0022ff', coreWidth: 1.2, glowWidth: 15.0, noiseIntensity: 0.0, coreFalloff: 0.1, glowFalloff: 1.0 };
    } else if (presetName === 'Electric') {
        preset = { coreColor: '#ffffff', coreColorEnd: '#ffffff', glowColor: '#aa00ff', glowColorEnd: '#00aaff', coreWidth: 0.3, glowWidth: 6.0, noiseIntensity: 3.5, noiseScale: 15.0, noiseSpeed: 3.5, coreFalloff: 0.1, glowFalloff: 0.8 };
    } else if (presetName === 'Ghost') {
        preset = { coreColor: '#ffffff', coreColorEnd: '#aaffaa', glowColor: '#00ffaa', glowColorEnd: '#0088ff', coreWidth: 1.0, glowWidth: 10.0, noiseIntensity: 1.2, noiseScale: 3.0, noiseSpeed: 0.8, coreFalloff: 0.4, glowFalloff: 1.2 };
    } else if (presetName === 'Default') {
        preset = { coreColor: '#ffffff', coreColorEnd: '#ffffff', glowColor: '#0088ff', glowColorEnd: '#ff00ff', coreWidth: 1.0, glowWidth: 6.0, noiseIntensity: 0.5, noiseScale: 5.0, noiseSpeed: 1.0, glowFalloff: 1.2, coreFalloff: 0.2 };
    }
    if (preset) {
        setSceneObjects(prev => prev.map(obj => obj.id === selectedObject.id ? { ...obj, properties: { ...(obj.properties || {}), ...preset } } : obj));
    }
    // Reset select to allow choosing same preset again
    e.target.value = "";
  };
  return (
    <>
      <div className="properties-section">
        <h4>⚔ Saber Render</h4>
        <div className="property-row" style={{marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #3c4c5c'}}>
          <label style={{color: '#fff', fontWeight: 'bold'}}>Preset Dropdown</label>
          <select onChange={applyPreset} defaultValue="" style={{width: '60%', padding: '4px', backgroundColor: '#1a222c', color: '#fff', border: '1px solid #3c4c5c', borderRadius: '4px'}}>
            <option value="" disabled>Select Preset...</option>
            <option value="Default">Restore Default</option>
            <option value="Fire">🔥 Chaotic Fire</option>
            <option value="Neon">⭕ Smooth Neon</option>
            <option value="Electric">⚡ Electric Lightning</option>
            <option value="Ghost">👻 Ghostly Plasma</option>
          </select>
        </div>
        <div className="property-row">
          <label>Core Color</label>
          <input type="color" value={sp.coreColor ?? '#ffffff'} onChange={(e) => upd('coreColor', e.target.value)} />
        </div>
        <div className="property-row">
          <label>Glow Color</label>
          <input type="color" value={sp.glowColor ?? '#0088ff'} onChange={(e) => upd('glowColor', e.target.value)} />
        </div>
        <div className="property-row">
          <label>Glow Color End</label>
          <input type="color" value={sp.glowColorEnd ?? sp.glowColor ?? '#ff00ff'} onChange={(e) => upd('glowColorEnd', e.target.value)} />
        </div>
        <div className="property-row">
          <label>Core Color End</label>
          <input type="color" value={sp.coreColorEnd ?? sp.coreColor ?? '#ffffff'} onChange={(e) => upd('coreColorEnd', e.target.value)} />
        </div>
        <div className="property-row">
          <label>Core Width</label>
          <input type="range" min="0.1" max="20" step="0.1" value={sp.coreWidth ?? 1.0} onChange={(e) => upd('coreWidth', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Glow Width</label>
          <input type="range" min="0.1" max="100" step="0.1" value={sp.glowWidth ?? 6.0} onChange={(e) => upd('glowWidth', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Core Falloff</label>
          <input type="range" min="0.0" max="2.0" step="0.01" value={sp.coreFalloff ?? 0.2} onChange={(e) => upd('coreFalloff', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Glow Falloff</label>
          <input type="range" min="0.0" max="5.0" step="0.01" value={sp.glowFalloff ?? 1.2} onChange={(e) => upd('glowFalloff', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Start Taper</label>
          <input type="range" min="0" max="1" step="0.01" value={sp.startTaper ?? 1.0} onChange={(e) => upd('startTaper', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>End Taper</label>
          <input type="range" min="0" max="1" step="0.01" value={sp.endTaper ?? 0.0} onChange={(e) => upd('endTaper', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Smooth Curve</label>
          <input type="checkbox" checked={sp.smoothCurve ?? true} onChange={(e) => upd('smoothCurve', e.target.checked)} />
        </div>
      </div>
      <div className="properties-section">
        <h4>Timing & Offsets</h4>
        <div className="property-row">
          <label>Start Offset</label>
          <input type="range" min="0" max="1" step="0.01" value={sp.startOffset ?? 0.0} onChange={(e) => upd('startOffset', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>End Offset</label>
          <input type="range" min="0" max="1" step="0.01" value={sp.endOffset ?? 1.0} onChange={(e) => upd('endOffset', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Phase Offset</label>
          <input type="range" min="-5" max="5" step="0.01" value={sp.phaseOffset ?? 0.0} onChange={(e) => upd('phaseOffset', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Offset Speed</label>
          <input type="range" min="-5" max="5" step="0.1" value={sp.offsetSpeed ?? 0.0} onChange={(e) => upd('offsetSpeed', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Loop Mode</label>
          <input type="checkbox" checked={sp.loopMode ?? true} onChange={(e) => upd('loopMode', e.target.checked)} />
        </div>
      </div>
      <div className="properties-section">
        <h4>Volumetric Distortion</h4>
        <div className="property-row">
          <label>Type</label>
          <select value={sp.noiseType ?? 0} onChange={e => upd('noiseType', parseInt(e.target.value))} style={{width:'100%',padding:'3px 4px',backgroundColor:'#1a222c',color:'#dde',border:'1px solid #3c4c5c',borderRadius:3}}>
            <option value={0}>FBM (smooth)</option>
            <option value={4}>Fractal Simplex</option>
            <option value={1}>Turbulent</option>
            <option value={2}>Ripple</option>
            <option value={3}>Cellular</option>
          </select>
        </div>
        <div className="property-row">
          <label>Intensity</label>
          <input type="range" min="0" max="5" step="0.01" value={sp.noiseIntensity ?? 0.5} onChange={(e) => upd('noiseIntensity', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Scale</label>
          <input type="range" min="0.1" max="50" step="0.1" value={sp.noiseScale ?? 5.0} onChange={(e) => upd('noiseScale', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Animated</label>
          <input type="checkbox" checked={sp.noiseAnimated ?? true} onChange={(e) => upd('noiseAnimated', e.target.checked)} />
        </div>
        <div className="property-row">
          <label>Speed</label>
          <input type="range" min="0" max="10" step="0.1" value={sp.noiseSpeed ?? 1.0} onChange={(e) => upd('noiseSpeed', parseFloat(e.target.value))} />
        </div>
        <div className="property-row">
          <label>Flow Dir: {(sp.noiseFlowAngle ?? 0).toFixed(0)}°</label>
          <input type="range" min="0" max="360" step="1" value={sp.noiseFlowAngle ?? 0} onChange={(e) => upd('noiseFlowAngle', parseFloat(e.target.value))} />
        </div>
      </div>
      <div className="properties-section">
        <h4>Target Path</h4>
        <div className="property-row">
          <label>Target</label>
          <span style={{color: '#99b', fontSize: '0.8rem', paddingLeft: 4}}>{sp.targetPathId || 'None'}</span>
        </div>
      </div>
      <div className="properties-section">
        <h4>⬇ Export</h4>
        <button
          style={{ width: '100%', padding: '6px 0', background: '#1e3a5f', color: '#7dc8ff', border: '1px solid #3a6a9f', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
          onClick={() => {
            const pathId = sp.targetPathId || selectedObject.id;
            const pts = sceneObjects.filter((o: any) => o.parentId === pathId && o.type === 'PathPoint');
            if (!pts.length) {
              alert('No PathPoint children found on the target path. Make sure this Saber has a target Path with points.');
              return;
            }
            const sortedPts = [...pts].sort((a: any, b: any) => (a.order ?? a.index ?? 0) - (b.order ?? b.index ?? 0));
            // Project 3-D world positions through the live viewport camera
            const camera = scene3DRef.current?.getCamera?.() ?? null;
            const rSize  = scene3DRef.current?.getRendererSize?.() ?? null;
            const pts3D = sortedPts.map((p: any) => {
              const wx = p.position?.x ?? 0;
              const wy = p.position?.y ?? 0;
              const wz = p.position?.z ?? 0;
              if (camera && rSize) {
                // THREE.Vector3.project() → NDC -1..1 (Y up)
                const v = new THREE.Vector3(wx, wy, wz).project(camera);
                // Convert NDC → Spine pixel space (Y up, origin bottom-left)
                return {
                  x: (v.x + 1) * 0.5 * rSize.width,
                  y: (v.y + 1) * 0.5 * rSize.height,
                  z: 0,
                };
              }
              return { x: wx, y: wy, z: wz };
            });
            exportSaberToSpine(pts3D, {
              name: (selectedObject.name ?? 'saber').replace(/\s+/g, '_'),
              coreColor:    sp.coreColor    ?? '#ffffff',
              glowColor:    sp.glowColor    ?? '#0088ff',
              glowWidth:    sp.glowWidth    ?? 40,
              glowFalloff:  sp.glowFalloff  ?? 1.2,
              noiseAnimated: sp.noiseAnimated ?? true,
              noiseSpeed:   sp.noiseSpeed   ?? 1.0,
            }).then(blob => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${(selectedObject.name ?? 'saber').replace(/\s+/g, '_')}.zip`;
              a.click();
              URL.revokeObjectURL(url);
            }).catch(err => alert('Export failed: ' + (err as Error).message));
          }}
        >
          ⚔ Export to Spine ZIP
        </button>
        <div className="property-row">
          <label>Frame Count: {sp.frameCount ?? 24}</label>
          <input type="range" min={1} max={120} step={1} value={sp.frameCount ?? 24} onChange={e => upd('frameCount', Number(e.target.value))} />
        </div>
        <div className="property-row">
          <label>FPS: {sp.fps ?? 24}</label>
          <input type="range" min={1} max={60} step={1} value={sp.fps ?? 24} onChange={e => upd('fps', Number(e.target.value))} />
        </div>
      </div>
    </>
  );
})()}

                {selectedObject.type === 'Flame' && (() => {
                  const fp = (selectedObject.properties ?? {}) as any;
                  const upd = (key: string, val: unknown) => handleUpdateEmitterProperty(key, val as any);

                  // tendrilDensity = tendrils per 100 world-units of path length
                  const FLAME_PRESETS: { label: string; emoji: string; tendrilDensity: number; props: Record<string, unknown> }[] = [
                    {
                      label: 'Campfire', emoji: '🏕', tendrilDensity: 3.0,
                      props: {
                        coreColor: '#ffee88', coreColorTop: '#ffcc00',
                        glowColor: '#ff6600', glowColorTop: '#aa2200',
                        height: 80, width: 30, numTendrils: 7,
                        detachRate: 0.6, turbulence: 0.6, speed: 1.3,
                        flickerType: 'fractal', flickerIntensity: 0.5,
                        coreWidth: 6, coreBlur: 0.22, glowWidth: 18, glowFalloff: 1.3, density: 1.7,
                        emberFrequency: 0.30, emberSize: 0.7, emberLife: 0.9, emberOffset: 0.2, emberSpeed: 0.4,
                      },
                    },
                    {
                      label: 'Torch', emoji: '🔦', tendrilDensity: 2.0,
                      props: {
                        coreColor: '#ffffaa', coreColorTop: '#ffaa00',
                        glowColor: '#ff5500', glowColorTop: '#991100',
                        height: 120, width: 18, numTendrils: 4,
                        detachRate: 0.75, turbulence: 0.45, speed: 1.6,
                        flickerType: 'fractal', flickerIntensity: 0.35,
                        coreWidth: 5, coreBlur: 0.15, glowWidth: 14, glowFalloff: 1.6, density: 1.9,
                        emberFrequency: 0.15, emberSize: 0.5, emberLife: 0.7, emberOffset: 0.1, emberSpeed: 0.5,
                      },
                    },
                    {
                      label: 'Inferno', emoji: '🔥', tendrilDensity: 7.0,
                      props: {
                        coreColor: '#ffffff', coreColorTop: '#ffdd44',
                        glowColor: '#ff2200', glowColorTop: '#880000',
                        height: 200, width: 80, numTendrils: 20,
                        detachRate: 0.85, turbulence: 1.2, speed: 2.2,
                        flickerType: 'turbulent', flickerIntensity: 0.75,
                        coreWidth: 8, coreBlur: 0.35, glowWidth: 40, glowFalloff: 0.8, density: 2.8,
                        emberFrequency: 0.70, emberSize: 1.2, emberLife: 1.3, emberOffset: 0.5, emberSpeed: 0.8,
                      },
                    },
                    {
                      label: 'Spirit', emoji: '🩵', tendrilDensity: 2.5,
                      props: {
                        coreColor: '#eeffff', coreColorTop: '#88aaff',
                        glowColor: '#2244ff', glowColorTop: '#000088',
                        height: 100, width: 22, numTendrils: 5,
                        detachRate: 0.35, turbulence: 0.3, speed: 0.9,
                        flickerType: 'smooth', flickerIntensity: 0.3,
                        coreWidth: 5, coreBlur: 0.4, glowWidth: 22, glowFalloff: 1.0, density: 1.2,
                        emberFrequency: 0, emberSize: 1.0, emberLife: 1.0, emberOffset: 0.0, emberSpeed: 1.0,
                      },
                    },
                    {
                      label: 'Ember', emoji: '✨', tendrilDensity: 1.5,
                      props: {
                        coreColor: '#ff9944', coreColorTop: '#ff4400',
                        glowColor: '#dd2200', glowColorTop: '#550000',
                        height: 40, width: 14, numTendrils: 3,
                        detachRate: 0.3, turbulence: 0.4, speed: 0.7,
                        flickerType: 'smooth', flickerIntensity: 0.6,
                        coreWidth: 4, coreBlur: 0.3, glowWidth: 10, glowFalloff: 1.8, density: 1.4,
                        emberFrequency: 0.80, emberSize: 1.5, emberLife: 1.5, emberOffset: 0.6, emberSpeed: 0.3,
                      },
                    },
                    {
                      label: 'Wildfire', emoji: '🌪', tendrilDensity: 14.0,
                      props: {
                        coreColor: '#ffff66', coreColorTop: '#ff8800',
                        glowColor: '#ff3300', glowColorTop: '#990000',
                        height: 160, width: 60, numTendrils: 40,
                        detachRate: 0.9, turbulence: 1.5, speed: 2.8,
                        flickerType: 'turbulent', flickerIntensity: 0.9,
                        coreWidth: 7, coreBlur: 0.45, glowWidth: 35, glowFalloff: 0.6, density: 3.5,
                        emberFrequency: 1.0, emberSize: 1.0, emberLife: 1.5, emberOffset: 0.7, emberSpeed: 0.9,
                      },
                    },
                    {
                      label: 'Candle', emoji: '🕯', tendrilDensity: 1.0,
                      props: {
                        coreColor: '#ffffd0', coreColorTop: '#ffdd88',
                        glowColor: '#ff8800', glowColorTop: '#553300',
                        height: 30, width: 8, numTendrils: 2,
                        detachRate: 0.25, turbulence: 0.2, speed: 0.6,
                        flickerType: 'smooth', flickerIntensity: 0.25,
                        coreWidth: 3, coreBlur: 0.18, glowWidth: 8, glowFalloff: 2.0, density: 1.1,
                        emberFrequency: 0.05, emberSize: 0.3, emberLife: 0.6, emberOffset: 0.0, emberSpeed: 0.2,
                      },
                    },
                    {
                      label: 'Fel Fire', emoji: '🤢', tendrilDensity: 6.0,
                      props: {
                        coreColor: '#ccffaa', coreColorTop: '#66ff00',
                        glowColor: '#22bb00', glowColorTop: '#004400',
                        height: 140, width: 45, numTendrils: 12,
                        detachRate: 0.8, turbulence: 0.9, speed: 1.8,
                        flickerType: 'turbulent', flickerIntensity: 0.65,
                        coreWidth: 6, coreBlur: 0.3, glowWidth: 25, glowFalloff: 1.1, density: 2.2,
                        emberFrequency: 0.6, emberSize: 0.8, emberLife: 1.1, emberOffset: 0.4, emberSpeed: 0.7,
                        oscillation: 0.5, shapeTwist: 0.2
                      },
                    },
                    {
                      label: 'Arcane', emoji: '🔮', tendrilDensity: 4.0,
                      props: {
                        coreColor: '#eeccff', coreColorTop: '#aa66ff',
                        glowColor: '#6600ff', glowColorTop: '#220088',
                        height: 100, width: 35, numTendrils: 8,
                        detachRate: 0.5, turbulence: 0.4, speed: 1.1,
                        flickerType: 'smooth', flickerIntensity: 0.4,
                        coreWidth: 5, coreBlur: 0.5, glowWidth: 30, glowFalloff: 0.9, density: 1.8,
                        emberFrequency: 0.8, emberSize: 0.5, emberLife: 1.5, emberOffset: 0.8, emberSpeed: 1.2,
                        oscillation: 0.8, shapeTwist: 0.5
                      },
                    },
                    {
                      label: 'Abyssal', emoji: '👁‍🗨', tendrilDensity: 8.0,
                      props: {
                        coreColor: '#ffffff', coreColorTop: '#aaaaaa',
                        glowColor: '#000000', glowColorTop: '#111122',
                        height: 180, width: 60, numTendrils: 15,
                        detachRate: 0.7, turbulence: 1.2, speed: 2.5,
                        flickerType: 'fractal', flickerIntensity: 0.8,
                        coreWidth: 3, coreBlur: 0.1, glowWidth: 15, glowFalloff: 1.5, density: 3.0,
                        emberFrequency: 0.9, emberSize: 1.5, emberLife: 0.8, emberOffset: 0.2, emberSpeed: 1.5,
                        oscillation: 1.2, shapeTwist: -0.4
                      },
                    },
                    {
                      label: 'Plasma', emoji: '💫', tendrilDensity: 5.0,
                      props: {
                        coreColor: '#ffffff', coreColorTop: '#ffffff',
                        glowColor: '#00ffff', glowColorTop: '#0033ff',
                        height: 120, width: 30, numTendrils: 6,
                        detachRate: 0.9, turbulence: 0.2, speed: 3.0,
                        flickerType: 'smooth', flickerIntensity: 0.2,
                        coreWidth: 4, coreBlur: 0.1, glowWidth: 20, glowFalloff: 2.0, density: 1.5,
                        emberFrequency: 0.5, emberSize: 0.5, emberLife: 0.5, emberOffset: 0.1, emberSpeed: 2.0,
                        oscillation: 2.0, shapeTwist: 1.5
                      },
                    },
                    {
                      label: 'Cyberpunk', emoji: '🤖', tendrilDensity: 6.0,
                      props: {
                        coreColor: '#ffffff', coreColorTop: '#00ffff',
                        glowColor: '#ff00ff', glowColorTop: '#8800ff',
                        height: 140, width: 40, numTendrils: 12,
                        detachRate: 0.85, turbulence: 1.0, speed: 2.5,
                        flickerType: 'fractal', flickerIntensity: 0.8,
                        coreWidth: 5, coreBlur: 0.2, glowWidth: 25, glowFalloff: 1.0, density: 2.0,
                        emberFrequency: 0.8, emberSize: 1.0, emberLife: 1.0, emberOffset: 0.5, emberSpeed: 2.0,
                        oscillation: 1.5, shapeTwist: 0.8
                      },
                    },
                    {
                      label: 'Reactor Core', emoji: '☢️', tendrilDensity: 7.0,
                      props: {
                        coreColor: '#aaffff', coreColorTop: '#55ffff',
                        glowColor: '#0055ff', glowColorTop: '#001188',
                        height: 160, width: 50, numTendrils: 14,
                        detachRate: 0.6, turbulence: 0.5, speed: 1.5,
                        flickerType: 'smooth', flickerIntensity: 0.3,
                        coreWidth: 10, coreBlur: 0.6, glowWidth: 40, glowFalloff: 1.2, density: 2.5,
                        emberFrequency: 0.2, emberSize: 1.5, emberLife: 2.0, emberOffset: 0.2, emberSpeed: 0.8,
                        oscillation: 0.5, shapeTwist: 1.2
                      },
                    },
                    {
                      label: 'Thruster', emoji: '🚀', tendrilDensity: 8.0,
                      props: {
                        coreColor: '#ffffff', coreColorTop: '#aaffff',
                        glowColor: '#00aaff', glowColorTop: '#0000ff',
                        height: 200, width: 30, numTendrils: 16,
                        detachRate: 0.95, turbulence: 0.2, speed: 4.0,
                        flickerType: 'turbulent', flickerIntensity: 0.5,
                        coreWidth: 8, coreBlur: 0.1, glowWidth: 20, glowFalloff: 0.5, density: 3.5,
                        emberFrequency: 0.9, emberSize: 0.5, emberLife: 0.5, emberOffset: 0.8, emberSpeed: 4.0,
                        oscillation: 0.0, shapeTwist: 0.0
                      },
                    },
                    {
                      label: 'Quantum', emoji: '⚛️', tendrilDensity: 4.5,
                      props: {
                        coreColor: '#ffffff', coreColorTop: '#ffccff',
                        glowColor: '#aa00ff', glowColorTop: '#00bbff',
                        height: 120, width: 60, numTendrils: 8,
                        detachRate: 0.3, turbulence: 2.0, speed: 2.0,
                        flickerType: 'turbulent', flickerIntensity: 0.9,
                        coreWidth: 4, coreBlur: 0.5, glowWidth: 35, glowFalloff: 0.8, density: 1.5,
                        emberFrequency: 1.0, emberSize: 0.8, emberLife: 1.5, emberOffset: 0.1, emberSpeed: 1.5,
                        oscillation: 3.0, shapeTwist: -1.5
                      },
                    },
                    {
                      label: 'Necrotic', emoji: '☠', tendrilDensity: 4.5,
                      props: {
                        coreColor: '#d0ffd0', coreColorTop: '#aaddaa',
                        glowColor: '#003311', glowColorTop: '#001100',
                        height: 90, width: 40, numTendrils: 9,
                        detachRate: 0.4, turbulence: 0.3, speed: 0.5,
                        flickerType: 'smooth', flickerIntensity: 0.3,
                        coreWidth: 6, coreBlur: 1.0, glowWidth: 30, glowFalloff: 1.5, density: 2.5,
                        emberFrequency: 0.1, emberSize: 1.0, emberLife: 2.0, emberOffset: 0.5, emberSpeed: 0.2,
                        oscillation: 0.3, shapeTwist: 0.0
                      },
                    },
                    {
                      label: 'Frostfire', emoji: '❄️', tendrilDensity: 5.0,
                      props: {
                        coreColor: '#ffffff', coreColorTop: '#cceeff',
                        glowColor: '#44aaff', glowColorTop: '#004488',
                        height: 130, width: 35, numTendrils: 10,
                        detachRate: 0.7, turbulence: 0.8, speed: 1.2,
                        flickerType: 'fractal', flickerIntensity: 0.5,
                        coreWidth: 4, coreBlur: 0.15, glowWidth: 20, glowFalloff: 1.6, density: 2.0,
                        emberFrequency: 0.4, emberSize: 0.6, emberLife: 1.2, emberOffset: 0.2, emberSpeed: 0.6,
                        oscillation: 0.4, shapeTwist: -0.2
                      },
                    }
                  ];

                  const applyPreset = (preset: typeof FLAME_PRESETS[0]) => {
                    const props = { ...preset.props };
                    // If the flame is already attached to a path, scale numTendrils
                    // by path length so coverage stays even regardless of path size.
                    const pathId = fp.targetPathId as string | undefined;
                    if (pathId) {
                      const pts = (sceneObjects as any[])
                        .filter((o: any) => o.type === 'PathPoint' && o.parentId === pathId)
                        .map((o: any) => o.position as { x: number; y: number; z: number });
                      if (pts.length >= 2) {
                        let pathLen = 0;
                        for (let i = 1; i < pts.length; i++) {
                          const dx = pts[i].x - pts[i-1].x;
                          const dy = pts[i].y - pts[i-1].y;
                          const dz = (pts[i].z ?? 0) - (pts[i-1].z ?? 0);
                          pathLen += Math.sqrt(dx*dx + dy*dy + dz*dz);
                        }
                        const scaled = Math.round(preset.tendrilDensity * pathLen / 100);
                        props.numTendrils = Math.max(2, Math.min(200, scaled));
                      }
                    }
                    Object.entries(props).forEach(([k, v]) => upd(k, v));
                  };

                  return (
                    <>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px', color: '#ff9944' }}>
                        🔥 Flame
                      </div>

                      <div style={{ marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Presets</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                        {FLAME_PRESETS.map(preset => (
                          <button
                            key={preset.label}
                            onClick={() => applyPreset(preset)}
                            title={preset.label}
                            style={{
                              padding: '4px 8px',
                              backgroundColor: '#1e2c3a',
                              color: '#ddccaa',
                              border: '1px solid #4a5a3a',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                          >
                            <span>{preset.emoji}</span>
                            <span>{preset.label}</span>
                          </button>
                        ))}
                        {customFlamePresets.map((preset, idx) => (
                          <button
                            key={'custom_'+preset.label+'_'+idx}
                            onClick={() => applyPreset(preset)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                if (confirm('Delete custom preset "' + preset.label + '"?')) {
                                    const next = customFlamePresets.filter((_, i) => i !== idx);
                                    setCustomFlamePresets(next);
                                    localStorage.setItem('v_customFlamePresets', JSON.stringify(next));
                                }
                            }}
                            title={preset.label + " (Right-click to delete)"}
                            style={{
                              padding: '4px 8px',
                              backgroundColor: '#2a1a3a',
                              color: '#ccaadd',
                              border: '1px solid #5a3a5a',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                          >
                            <span>{preset.emoji}</span>
                            <span>{preset.label}</span>
                          </button>
                        ))}
                        <button
                          onClick={() => {
                              const name = prompt('Enter a name for your custom flame preset:', 'My Flame');
                              if (name) {
                                  const emoji = prompt('Enter an emoji for this preset:', '🔥') || '🔥';
                                  // extract current props
                                  const p = (selectedObject.properties ?? {}) as any;
                                  const propNames = [
                                    'coreColor', 'coreColorTop', 'glowColor', 'glowColorTop', 'height', 'width', 'numTendrils',
                                    'detachRate', 'turbulence', 'speed', 'flickerType', 'flickerIntensity', 'coreWidth', 'coreBlur',
                                    'glowWidth', 'glowFalloff', 'density', 'emberFrequency', 'emberSize', 'emberLife', 'emberOffset', 'emberSpeed', 'oscillation', 'shapeTwist'
                                  ];
                                  const newProps: any = {};
                                  propNames.forEach(pn => {
                                      if (p[pn] !== undefined) newProps[pn] = p[pn];
                                  });
                                  
                                  const preset = {
                                      label: name,
                                      emoji,
                                      tendrilDensity: p.tendrilDensity ?? 3.0,
                                      props: newProps
                                  };
                                  const next = [...customFlamePresets, preset];
                                  setCustomFlamePresets(next);
                                  localStorage.setItem('v_customFlamePresets', JSON.stringify(next));
                              }
                          }}
                          style={{
                              padding: '4px 8px',
                              backgroundColor: '#1a222c',
                              color: '#8a93a2',
                              border: '1px dashed #3c4c5c',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                          }}
                          title="Save current settings as a new preset"
                        >
                          + Save Preset
                        </button>
                      </div>

                      <div style={{ marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Source Geometry</div>
                      <div className="property-row">
                        <label>Path</label>
                        <select
                          value={fp.targetPathId ?? ''}
                          onChange={e => { upd('targetPathId', e.target.value || undefined); if (e.target.value) { upd('attachedShapeId', undefined); upd('attachedSpineId', undefined); } }}
                          style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}
                        >
                          <option value="">(none)</option>
                          {sceneObjects.filter((o: any) => o.type === 'Path').map((o: any) => (
                            <option key={o.id} value={o.id}>{o.name ?? o.id}</option>
                          ))}
                        </select>
                      </div>

                      <div className="property-row">
                        <label>3D Mesh</label>
                        <select
                          value={fp.attachedShapeId ?? ''}
                          onChange={e => { upd('attachedShapeId', e.target.value || undefined); if (e.target.value) { upd('targetPathId', undefined); upd('attachedSpineId', undefined); } }}
                          style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}
                        >
                          <option value="">(none)</option>
                          {sceneObjects.filter((o: any) => ['3DModel', 'Cube', 'Sphere', 'Cylinder', 'Cone', 'Plane', 'Torus'].includes(o.type)).map((o: any) => (
                            <option key={o.id} value={o.id}>{o.name ?? o.id}</option>
                          ))}
                        </select>
                      </div>

                      <div className="property-row">
                        <label>Spine Image</label>
                        <select
                          value={fp.attachedSpineId ?? ''}
                          onChange={e => { upd('attachedSpineId', e.target.value || undefined); if (e.target.value) { upd('targetPathId', undefined); upd('attachedShapeId', undefined); } }}
                          style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}
                        >
                          <option value="">(none)</option>
                          {spineAllAttachments.map(att => (
                            <option key={att.id} value={att.id}>{att.slotName}</option>
                          ))}
                        </select>
                      </div>

                      {fp.attachedSpineId && (
                          <div className="property-row">
                            <label>Sample Mode</label>
                            <select
                                value={fp.attachedSpineMode ?? 'surface'}
                                onChange={e => upd('attachedSpineMode', e.target.value)}
                                style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}
                            >
                                <option value="surface">Visible Surface</option>
                                <option value="edge">Outer Edge</option>
                            </select>
                          </div>
                      )}

                      {(fp.attachedSpineId || fp.attachedShapeId) && (
                          <div className="property-row">
                            <label>Depth Placement</label>
                            <select
                                value={fp.placementZ ?? 'center'}
                                onChange={e => upd('placementZ', e.target.value)}
                                style={{ flex:1, width: '60%', padding:'3px 4px', backgroundColor:'#1a222c', color:'#dde', border:'1px solid #3c4c5c', borderRadius:3 }}
                            >
                                <option value="front">In Front (+Z)</option>
                                <option value="center">Surface (0)</option>
                                <option value="back">Behind (-Z)</option>
                            </select>
                          </div>
                      )}

                      {fp.targetPathId && (
                        <>
                          <label>Path Speed: {(fp.pathSpeed ?? 0.05).toFixed(3)}</label>
                          <input type="range" min={-1.5} max={1.5} step={0.01} value={fp.pathSpeed ?? 0.05} onChange={e => upd('pathSpeed', Number(e.target.value))} />
                          <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>How fast the flame slides along the curve.</div>
                        </>
                      )}

                      <div style={{ marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Rendering</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400 }}>
                        <input type="checkbox"
                          checked={fp.occludeByGeometry !== false}
                          onChange={e => upd('occludeByGeometry', e.target.checked)} />
                        Respect 3D depth (occluded by objects in front)
                      </label>
                      <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>Off = flame always renders on top of everything.</div>

                      <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Colors</div>
                      <label>Core Color (Base)</label>
                      <input type="color" value={fp.coreColor ?? '#ffff88'} onChange={e => upd('coreColor', e.target.value)} style={{ width: '100%', height: '30px' }} />
                      <label>Core Color (Tip)</label>
                      <input type="color" value={fp.coreColorTop ?? fp.coreColor ?? '#ffaa00'} onChange={e => upd('coreColorTop', e.target.value)} style={{ width: '100%', height: '30px' }} />
                      <label>Glow Color (Base)</label>
                      <input type="color" value={fp.glowColor ?? '#ff3300'} onChange={e => upd('glowColor', e.target.value)} style={{ width: '100%', height: '30px' }} />
                      <label>Glow Color (Tip)</label>
                      <input type="color" value={fp.glowColorTop ?? fp.glowColor ?? '#880000'} onChange={e => upd('glowColorTop', e.target.value)} style={{ width: '100%', height: '30px' }} />

                      <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Shape</div>
                      <label>Base Shape</label>
                      <select value={fp.flareShape ?? 'circle'} onChange={e => upd('flareShape', e.target.value)}>
                        <option value="circle">Circle (Soft)</option>
                        <option value="diamond">Diamond (Sharp)</option>
                        <option value="star">Star (Cross)</option>
                        <option value="sharp">Hard Edge Circle</option>
                        {spriteLibrary && spriteLibrary.map(s => <option key={s.id} value={s.dataUrl}>Custom: {s.name}</option>)}
                      </select>
                      <label>Base Twist: {((fp.shapeTwist ?? 0) * 100).toFixed(0)}%</label>
                      <input type="range" min={-2} max={2} step={0.01} value={fp.shapeTwist ?? 0} onChange={e => upd('shapeTwist', Number(e.target.value))} />
                      <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>Visual twist along tendril.</div>
                      <label>Height: {fp.height ?? 80}</label>
                      <input type="range" min={10} max={300} step={5} value={fp.height ?? 80} onChange={e => upd('height', Number(e.target.value))} />
                      <label>Width: {fp.width ?? 30}</label>
                      <input type="range" min={4} max={120} step={2} value={fp.width ?? 30} onChange={e => upd('width', Number(e.target.value))} />
                      <label>Tendrils: {fp.numTendrils ?? 5}</label>
                      <input type="range" min={1} max={200} step={1} value={fp.numTendrils ?? 5} onChange={e => upd('numTendrils', Number(e.target.value))} />
                      <label>Detach Rate: {((fp.detachRate ?? 0.5) * 100).toFixed(0)}%</label>
                      <input type="range" min={0} max={1} step={0.01} value={fp.detachRate ?? 0.5} onChange={e => upd('detachRate', Number(e.target.value))} />
                      <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>0% = tendrils stay rooted, 100% = full fly-up behaviour.</div>
                      <label>Ember Rate: {(fp.emberFrequency ?? 0.2) > 0 ? ((fp.emberFrequency ?? 0.2) * 40).toFixed(1) + '/sec' : 'Off'}</label>
                      <input type="range" min={0} max={1} step={0.01} value={fp.emberFrequency ?? 0.2} onChange={e => upd('emberFrequency', Number(e.target.value))} />
                      <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>Embers shed per second across the whole flame. 0 = none, max = 40/sec.</div>
                      <label>Ember Size: {(fp.emberSize ?? 1.0).toFixed(2)}×</label>
                      <input type="range" min={0.05} max={3} step={0.05} value={fp.emberSize ?? 1.0} onChange={e => upd('emberSize', Number(e.target.value))} />
                      <label>Ember Lifetime: {(fp.emberLife ?? 1.0).toFixed(2)}×</label>
                      <input type="range" min={0.1} max={3} step={0.05} value={fp.emberLife ?? 1.0} onChange={e => upd('emberLife', Number(e.target.value))} />
                      <label>Ember Offset: {((fp.emberOffset ?? 0) * 100).toFixed(0)}%</label>
                      <input type="range" min={0} max={1} step={0.01} value={fp.emberOffset ?? 0} onChange={e => upd('emberOffset', Number(e.target.value))} />
                      <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>0% = spawn at tip only, 100% = spawn anywhere along the tendril.</div>
                      <label>Ember Speed: {(fp.emberSpeed ?? 1.0).toFixed(2)}×</label>
                      <input type="range" min={0.05} max={4} step={0.05} value={fp.emberSpeed ?? 1.0} onChange={e => upd('emberSpeed', Number(e.target.value))} />

                      <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Motion</div>
                      <label>Turbulence: {(fp.turbulence ?? 0.55).toFixed(2)}</label>
                      <input type="range" min={0} max={2} step={0.05} value={fp.turbulence ?? 0.55} onChange={e => upd('turbulence', Number(e.target.value))} />
                      <label>Buoyancy: {(fp.buoyancy ?? 1.0).toFixed(2)}</label>
                      <input type="range" min={0} max={10} step={0.1} value={fp.buoyancy ?? 1.0} onChange={e => upd('buoyancy', Number(e.target.value))} />
                      <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>Amplifies height/draft when tendrils cluster. 0 = independent tendrils.</div>
                      <label>Speed: {(fp.speed ?? 1.4).toFixed(2)}</label>
                      <input type="range" min={0.1} max={5} step={0.1} value={fp.speed ?? 1.4} onChange={e => upd('speed', Number(e.target.value))} />

                      <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Flicker</div>
                      <label>Type</label>
                      <select value={fp.flickerType ?? 'fractal'} onChange={e => upd('flickerType', e.target.value)}>
                        <option value="smooth">Smooth — gentle sine pulses</option>
                        <option value="fractal">Fractal — natural FBM complexity</option>
                        <option value="turbulent">Turbulent — sharp combustion bursts</option>
                      </select>
                      <label>Intensity: {((fp.flickerIntensity ?? 0.45) * 100).toFixed(0)}%</label>
                      <input type="range" min={0} max={1} step={0.01}
                        value={fp.flickerIntensity ?? 0.45}
                        onChange={e => upd('flickerIntensity', Number(e.target.value))} />
                      <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>0% = constant glow, 100% = full flicker range.</div>

                      <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Glow</div>
                      <label>Core Width: {fp.coreWidth ?? 6}</label>
                      <input type="range" min={1} max={20} step={0.5} value={fp.coreWidth ?? 6} onChange={e => upd('coreWidth', Number(e.target.value))} />
                      <label>Core Blur: {((fp.coreBlur ?? 0.2) * 100).toFixed(0)}%</label>
                      <input type="range" min={0} max={1} step={0.01} value={fp.coreBlur ?? 0.2} onChange={e => upd('coreBlur', Number(e.target.value))} />
                      <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>0% = tight bright spike, 100% = wide soft bloom.</div>
                      <label>Glow Width: {fp.glowWidth ?? 16}</label>
                      <input type="range" min={2} max={60} step={1} value={fp.glowWidth ?? 16} onChange={e => upd('glowWidth', Number(e.target.value))} />
                      <label>Vertical Falloff: {(fp.glowFalloff ?? 1.2).toFixed(2)}</label>
                      <input type="range" min={0} max={4} step={0.05} value={fp.glowFalloff ?? 1.2} onChange={e => upd('glowFalloff', Number(e.target.value))} />
                      <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '4px' }}>0 = even brightness top to bottom, higher = glow concentrated at base.</div>
                      <label>Density: {(fp.density ?? 1.6).toFixed(1)}</label>
                      <input type="range" min={0.5} max={5} step={0.1} value={fp.density ?? 1.6} onChange={e => upd('density', Number(e.target.value))} />

                      <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 600, color: '#8a93a2', fontSize: '0.75rem', textTransform: 'uppercase' }}>Physics Modifiers</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400 }}>
                        <input type="checkbox"
                          checked={fp.usePhysicsModifiers ?? false}
                          onChange={e => upd('usePhysicsModifiers', e.target.checked)} />
                        Enable physics modifiers (attractors, flow curves)
                      </label>
                      {(fp.usePhysicsModifiers) && (
                        <>
                          <label>Modifier Strength: {(fp.modifierStrength ?? 1).toFixed(2)}</label>
                          <input type="range" min={0} max={3} step={0.05}
                            value={fp.modifierStrength ?? 1}
                            onChange={e => upd('modifierStrength', Number(e.target.value))} />
                        </>
                      )}
                    </>
                  );
                })()}

                <hr className="form-divider" />

                {selectedObject.type === 'Path' && !!(selectedObject.properties as any)?.spiralShape && (
                  <SpiralPropertiesPanel
                    objectId={selectedObject.id}
                    initialTurns={(selectedObject.properties as any).spiralTurns ?? 3}
                    initialDiameter={(selectedObject.properties as any).spiralDiameter ?? 160}
                    initialCW={(selectedObject.properties as any).spiralCW ?? true}
                    onRegenerate={handleRegenerateSpiral}
                  />
                )}

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
          <label className="timeline-input-group" htmlFor="timeline-fps" style={{ marginLeft: '0.5rem' }}>
            FPS
            <input
              id="timeline-fps"
              type="number"
              min={1}
              max={120}
              step={1}
              value={fps}
              onChange={(e) => {
                const v = Math.max(1, Math.min(120, Number.parseInt(e.target.value, 10) || 24));
                setFps(v);
              }}
              style={{ width: '3rem' }}
            />
          </label>
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
      <ParticleCreator
          visible={showParticleCreator}
          onExport={(dataUrl, name) => {
            handleUpdateEmitterProperty('particleSpriteImageDataUrl', dataUrl);
            handleUpdateEmitterProperty('particleSpriteImageName', name);
            handleUpdateEmitterProperty('particleType', 'sprites');
            handleUpdateEmitterProperty('particleSpriteSequenceDataUrls', []);
            setShowParticleCreator(false);
          }}
          onExportSequence={(dataUrls, name, fps) => {
            handleUpdateEmitterProperty('particleSpriteSequenceDataUrls', dataUrls);
            handleUpdateEmitterProperty('particleSpriteSequenceFirstName', `${name}_frame0.png`);
            handleUpdateEmitterProperty('particleSpriteSequenceFps', fps);
            handleUpdateEmitterProperty('particleSpriteImageDataUrl', '');
            handleUpdateEmitterProperty('particleSpriteImageName', '');
            handleUpdateEmitterProperty('particleType', 'sprites');
            setShowParticleCreator(false);
          }}
          onClose={() => setShowParticleCreator(false)}
          particleCameraState={particleCameraState}
        />

        {/* ── Viewport PNG Sequence render settings dialog ─────────────────── */}
        {viewportSeqDialog !== null && (() => {
          const dlg = viewportSeqDialog;
          const setW = (v: number) => setViewportSeqDialog(p => p ? { ...p, width:  Math.max(16, v) } : p);
          const setH = (v: number) => setViewportSeqDialog(p => p ? { ...p, height: Math.max(16, v) } : p);
          const PRESETS = [
            { label: '256 × 256',  w: 256,  h: 256  },
            { label: '512 × 512',  w: 512,  h: 512  },
            { label: '1024 × 512', w: 1024, h: 512  },
            { label: '1024 × 1024',w: 1024, h: 1024 },
            { label: '1280 × 720', w: 1280, h: 720  },
            { label: '1920 × 1080',w: 1920, h: 1080 },
            { label: 'Custom',     w: -1,   h: -1   },
          ];
          const activePreset = PRESETS.find(p => p.w === dlg.width && p.h === dlg.height) ?? PRESETS[PRESETS.length - 1];
          const inputStyle: React.CSSProperties = {
            width: '70px', background: '#1a1f2e', border: '1px solid #3b455c',
            color: '#e0e0e0', borderRadius: '4px', padding: '3px 6px', fontSize: '0.8rem',
          };
          const rowStyle: React.CSSProperties = {
            display: 'flex', alignItems: 'center', gap: '10px',
            marginBottom: '8px', fontSize: '0.8rem', color: '#b0bec9',
          };
          const labelW: React.CSSProperties = { minWidth: '90px', color: '#8a93a2' };
          return (
            <>
              {/* backdrop */}
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.55)' }}
                onClick={() => !dlg.rendering && setViewportSeqDialog(null)}
              />
              {/* dialog */}
              <div style={{
                position: 'fixed',
                left: '50%', top: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 9001,
                background: '#1a2030',
                border: '1px solid #3a5070',
                borderRadius: '10px',
                boxShadow: '0 8px 40px rgba(0,0,0,0.8)',
                minWidth: '360px',
                maxWidth: '420px',
                overflow: 'hidden',
                fontFamily: 'inherit',
              }}>
                {/* header */}
                <div style={{
                  padding: '10px 16px', background: '#131a28',
                  borderBottom: '1px solid #2a3848',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#8ac4ff', letterSpacing: '0.04em' }}>🎞 Viewport PNG Sequence</span>
                  {!dlg.rendering && (
                    <button type="button" onClick={() => setViewportSeqDialog(null)}
                      style={{ background: 'none', border: 'none', color: '#6a8aaa', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 2px' }}>✕</button>
                  )}
                </div>

                <div style={{ padding: '14px 16px' }}>
                  {/* Resolution preset */}
                  <div style={{ ...rowStyle, marginBottom: '12px' }}>
                    <span style={labelW}>Resolution</span>
                    <select
                      value={activePreset.label}
                      disabled={dlg.rendering}
                      onChange={e => {
                        const p = PRESETS.find(x => x.label === e.target.value);
                        if (p && p.w !== -1) { setW(p.w); setH(p.h); }
                      }}
                      style={{ flex: 1, background: '#1a1f2e', border: '1px solid #3b455c', color: '#e0e0e0', borderRadius: '4px', padding: '3px 6px', fontSize: '0.8rem' }}
                    >
                      {PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                    </select>
                  </div>

                  {/* W × H */}
                  <div style={{ ...rowStyle, marginBottom: '12px' }}>
                    <span style={labelW}>Width × Height</span>
                    <input type="number" min={16} max={4096} step={1} value={dlg.width}  disabled={dlg.rendering}
                      onChange={e => setW(Number(e.target.value))} style={inputStyle} />
                    <span style={{ color: '#4a6a8a' }}>×</span>
                    <input type="number" min={16} max={4096} step={1} value={dlg.height} disabled={dlg.rendering}
                      onChange={e => setH(Number(e.target.value))} style={inputStyle} />
                  </div>

                  {/* Frame count */}
                  <div style={rowStyle}>
                    <span style={labelW}>Frames</span>
                    <input type="number" min={1} max={240} step={1}
                      value={dlg.frameCount} disabled={dlg.rendering}
                      onChange={e => setViewportSeqDialog(p => p ? { ...p, frameCount: Math.max(1, Number(e.target.value)) } : p)}
                      style={inputStyle} />
                  </div>

                  {/* FPS */}
                  <div style={rowStyle}>
                    <span style={labelW}>FPS</span>
                    <input type="number" min={1} max={120} step={1}
                      value={dlg.fps} disabled={dlg.rendering}
                      onChange={e => setViewportSeqDialog(p => p ? { ...p, fps: Math.max(1, Number(e.target.value)) } : p)}
                      style={inputStyle} />
                  </div>

                  {/* Mode */}
                  <div style={{ ...rowStyle, marginBottom: '14px' }}>
                    <span style={labelW}>Mode</span>
                    <select
                      value={dlg.mode} disabled={dlg.rendering}
                      onChange={e => setViewportSeqDialog(p => p ? { ...p, mode: e.target.value } : p)}
                      style={{ flex: 1, background: '#1a1f2e', border: '1px solid #3b455c', color: '#e0e0e0', borderRadius: '4px', padding: '3px 6px', fontSize: '0.8rem' }}
                    >
                      <option value="loop">Loop (jitter)</option>
                      <option value="strike">Strike (grow)</option>
                      <option value="loop-strike">Loop-Strike (auto cycle)</option>
                    </select>
                  </div>

                  <div style={{ fontSize: '0.72rem', color: '#4a6a8a', marginBottom: '14px', lineHeight: 1.4 }}>
                    The golden frame in the viewport shows exactly what will be rendered. Position your view, then click Render &amp; Export.
                  </div>

                  {/* Buttons */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
                    {/* Left: frame helper */}
                    <button
                      type="button"
                      disabled={dlg.rendering}
                      title="Move viewport camera to frame the lightning bolt"
                      onClick={() => scene3DRef.current?.frameLightningInViewport(dlg.lightningId)}
                      style={{
                        padding: '6px 12px', background: '#1e2d1e',
                        border: '1px solid rgba(80,200,80,0.4)', borderRadius: '6px',
                        color: dlg.rendering ? '#4a6a4a' : '#80d080',
                        fontSize: '0.78rem', cursor: dlg.rendering ? 'default' : 'pointer',
                      }}
                    >
                      🎯 Frame lightning
                    </button>

                    {/* Right: Cancel + Render */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                    {!dlg.rendering && (
                      <button type="button" onClick={() => setViewportSeqDialog(null)}
                        style={{ padding: '6px 16px', background: '#252c3e', border: '1px solid #3a4a5e', borderRadius: '6px', color: '#8a93a2', fontSize: '0.8rem', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={dlg.rendering}
                      onClick={() => doViewportSeqExport(dlg.lightningId, dlg.name, dlg.width, dlg.height, dlg.frameCount, dlg.fps, dlg.mode)}
                      style={{
                        padding: '6px 20px',
                        background: dlg.rendering ? '#1a3a5a' : 'linear-gradient(135deg, #2a3a6a, #1a4a8a)',
                        border: '1px solid #4a7aff', borderRadius: '6px',
                        color: dlg.rendering ? '#6a8aaa' : '#aac8ff',
                        fontWeight: 700, fontSize: '0.8rem',
                        cursor: dlg.rendering ? 'default' : 'pointer',
                      }}
                    >
                      {dlg.rendering
                        ? `Rendering… (${dlg.frameCount} frames)`
                        : `🎞 Render & Export (${dlg.width}×${dlg.height}, ${dlg.frameCount}f)`
                      }
                    </button>
                    </div>{/* end right buttons */}
                  </div>{/* end buttons row */}
                </div>
              </div>
            </>
          );
        })()}
    </div>
  );
}






