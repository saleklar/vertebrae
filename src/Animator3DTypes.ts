// Types for 3D Asset Creator/Animator Module

export type AnimatorGeometryType = 'cylinder' | 'coin' | 'sphere' | 'cube' | 'plane' | 'torus';

export type AnimatorLightSettings = {
  ambientColor: string;
  ambientIntensity: number;
  directionalLights: {
    id: string;
    color: string;
    intensity: number;
    position: { x: number; y: number; z: number };
    castShadow: boolean;
  }[];
  pointLights: {
    id: string;
    color: string;
    intensity: number;
    position: { x: number; y: number; z: number };
    distance: number;
    castShadow: boolean;
  }[];
};

export type AnimatorEnvironment = 'studio' | 'outdoor' | 'dark' | 'custom';

export type AnimatorMaterialSettings = {
  baseTextureDataUrl?: string;
  baseTextureName?: string;
  normalMapDataUrl?: string;
  normalMapName?: string;
  bumpMapDataUrl?: string;
  bumpMapName?: string;
  useSeparateSideMaterial: boolean;
  sideColor: string;
  sideNormalMapDataUrl?: string;
  sideNormalMapName?: string;
  sideBumpMapDataUrl?: string;
  sideBumpMapName?: string;
  sideBumpScale: number;
  sideRidgeCount: number;
  sideRidgeDepth: number;
  sideUvScaleX: number;
  sideUvScaleY: number;
  sideUvOffsetX: number;
  sideUvOffsetY: number;
  sideUvRotation: number; // degrees
  uvScaleX: number;
  uvScaleY: number;
  uvOffsetX: number;
  uvOffsetY: number;
  uvRotation: number; // degrees
  bumpScale: number;
  metalness: number;
  roughness: number;
  reflectionIntensity: number;
  color: string;
  emissive: string;
  emissiveIntensity: number;
};

export type AnimatorCameraPath = 'static' | 'orbit' | 'dolly' | 'custom';

export type AnimatorAnimationSettings = {
  duration: number; // Total frames
  fps: number;
  rotation: { x: number; y: number; z: number }; // degrees per frame
  position: { x: number; y: number; z: number }; // movement per frame
  scale: { x: number; y: number; z: number }; // scale change per frame
  cameraPath: AnimatorCameraPath;
  cameraOrbitSpeed: number; // degrees per frame
  cameraStartAngle: number; // degrees
};

export type AnimatorRenderSettings = {
  width: number;
  height: number;
  backgroundColor: string;
  transparent: boolean;
  antialias: boolean;
  shadows: boolean;
  outputFormat: 'png' | 'jpg';
  outputQuality: number; // 0-1 for jpeg
};

export type AnimatorEffectsSettings = {
  ambientOcclusion?: {
    enabled: boolean;
    radius: number;
    intensity: number;
  };
  bloom: {
    enabled: boolean;
    intensity: number;
    threshold: number;
    radius: number;
  };
  lens: {
    enabled: boolean;
    amount: number;
  };
  sparkles: {
    enabled: boolean;
    count: number;
    size: number;
    intensity: number;
    speed: number;
    shinyGlints: boolean;
    glintThreshold: number;
    glintCenterThreshold: number;
    glintSpread: number;
    glintRayLength: number;
    glintRayBoost: number;
    glintHorizontalBlur: number;
    glintVerticalBlur: number;
    glowBlur: number;
  };
  colorCorrection: {
    enabled: boolean;
    brightness: number;
    contrast: number;
    saturation: number;
    hue: number;
  };
};

export type AnimatorObject = {
  id: string;
  name: string;
  geometry: AnimatorGeometryType;
  geometryParams: {
    // Cylinder
    radiusTop?: number;
    radiusBottom?: number;
    height?: number;
    radialSegments?: number;
    edgeBevel?: number; // 0-0.3, realtime scene bevel on cylinder edge

    // Parametric Coin
    coinFrameWidth?: number; // Rim width
    coinFrameHeight?: number; // Rim extrusion amount
    coinInnerShapePattern?: 'none' | 'star' | 'polygon' | 'circle';
    coinInnerShapeSize?: number; // Percentage or absolute size of inner shape
    coinInnerShapeDepth?: number; // Extrusion depth of inner shape
    coinInnerShapePoints?: number; // e.g., 5 for star
    coinInnerShapeRoundness?: number; // Corners beveling / fillet
    coinRidgeCount?: number; // Number of ridges on the outer edge (0 = none)
    coinRidgeDepth?: number; // Depth/size of the ridges

    // Sphere
    radius?: number;
    widthSegments?: number;
    heightSegments?: number;
    
    // Cube
    width?: number;
    depth?: number;
    
    // Plane
    // width, height (reuse)
    
    // Torus
    tubeRadius?: number;
    tubularSegments?: number;
  };
  material: AnimatorMaterialSettings;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
};

export type AnimatorProject = {
  object: AnimatorObject;
  lighting: AnimatorLightSettings;
  environment: AnimatorEnvironment;
  animation: AnimatorAnimationSettings;
  renderSettings: AnimatorRenderSettings;
  effects: AnimatorEffectsSettings;
  backgroundColor: string;
};

export type HeightMapData = {
  width: number;
  height: number;
  data: Uint8Array; // Height values 0-255
};

export type RenderProgress = {
  currentFrame: number;
  totalFrames: number;
  isRendering: boolean;
  renderedFrames: Blob[];
};
