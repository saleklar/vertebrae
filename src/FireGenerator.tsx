import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import JSZip from 'jszip';

export interface FireGeneratorProps { particleCameraState?: {position: THREE.Vector3, quaternion: THREE.Quaternion} | null;  onExport?: (blob: Blob, name: string)=>void; onExportToParticleSystem?: (urls: string[], fps: number)=>void; onAttachToEmitter?: (urls: string[])=>void; embeddedUI?: boolean; autoRenderOnChange?: boolean; }

export interface GeneratorParams {
  motionBlurEnabled?: boolean;
  motionBlurSamples?: number;
  stretchX?: number;
  stretchY?: number;
  shapeType: 'ground' | 'fireball' | 'wisp';
  color1: string;
  color2: string;
  color3: string;
  speed: number;
  scale: number;
  coreBottom: number;
  coreTop: number;
  brightness: number;
  contrast: number;
  saturation: number;
  frames: number;
  fps: number;
  resolution: number; domainResolution?: number; emitterTurbulence?: number; emitterSpeed?: number;
  noiseType: 'simplex' | 'voronoi' | 'cellular' | 'value';
  distortion: number;
  detail: number;
  density?: number;
  alphaThreshold?: number;
  particleSize?: number;
    evolveOverLife?: boolean;
    flowX: number;
    flowY: number;
    flowZ: number;
    rotX: number;
    rotY: number;
    rotZ: number;
  rotSpeedX?: number;
  rotSpeedY?: number;
  rotSpeedZ?: number;
  thermalBuoyancy?: number;
  vorticityConfinement?: number;
  baseBlur?: number;
  baseOpacity?: number;
  glow1Blur?: number;
  glow1Opacity?: number;
  glow2Blur?: number;
  glow2Opacity?: number;
  useBlackbody?: boolean;
  baseTemperature?: number;
  peakTemperature?: number;
  globalWarpAmount?: number;
}

  export interface SavedPreset {
    name: string;
    params: GeneratorParams;
  }

  export const vertexShader = `

uniform float loopProgress;
uniform float speed;
uniform float scale;
uniform float stretchX;
uniform float stretchY;
uniform float shapeType;
uniform vec3 flowDirection;
uniform vec3 rotation;
uniform vec3 rotationSpeed;
uniform float thermalBuoyancy;
uniform float distortion;
uniform float detail;
uniform float densityMultiplier;
uniform bool useBlackbody;
uniform float baseTemperature;
uniform float peakTemperature;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;
uniform float alphaThreshold;
uniform float emitterTurbulence;
uniform float emitterSpeed;
uniform float vorticityConfinement;
uniform float noiseType;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;

mat3 getRotationMatrix(vec3 rot) {
    float cx = cos(rot.x), sx = sin(rot.x);
    float cy = cos(rot.y), sy = sin(rot.y);
    float cz = cos(rot.z), sz = sin(rot.z);
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, -sx, 0.0, sx, cx);
    mat3 ry = mat3(cy, 0.0, sy, 0.0, 1.0, 0.0, -sy, 0.0, cy);
    mat3 rz = mat3(cz, -sz, 0.0, sz, cz, 0.0, 0.0, 0.0, 1.0);
    return rz * ry * rx;
}

float hash(float n) { return fract(sin(n) * 1e4); }
float noise(vec3 x) {
    const vec3 step = vec3(110.0, 241.0, 171.0);
    vec3 i = floor(x);
    vec3 f = fract(x);
    float n = dot(i, step);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix( hash(n + dot(step, vec3(0, 0, 0))), hash(n + dot(step, vec3(1, 0, 0))), u.x),
                   mix( hash(n + dot(step, vec3(0, 1, 0))), hash(n + dot(step, vec3(1, 1, 0))), u.x), u.y),
               mix(mix( hash(n + dot(step, vec3(0, 0, 1))), hash(n + dot(step, vec3(1, 0, 1))), u.x),
                   mix( hash(n + dot(step, vec3(0, 1, 1))), hash(n + dot(step, vec3(1, 1, 1))), u.x), u.y), u.z);
}

// Voronoi (cellular) noise
float voronoiNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float minD = 8.0;
    for(int xi = -1; xi <= 1; xi++) {
        for(int yi = -1; yi <= 1; yi++) {
            for(int zi = -1; zi <= 1; zi++) {
                vec3 nb = vec3(float(xi), float(yi), float(zi));
                float h = dot(i + nb, vec3(127.1, 311.7, 74.7));
                vec3 pt = nb + fract(sin(vec3(h, h * 1.31, h * 2.71)) * 43758.5453) - f;
                minD = min(minD, dot(pt, pt));
            }
        }
    }
    return sqrt(minD);
}

// Dispatch to selected noise type (uniform noiseType: 0=value, 1=voronoi, 2=invVoronoi, 3=value-hifreq)
float noiseAt(vec3 p) {
    if (noiseType < 0.5) return noise(p);
    if (noiseType < 1.5) return voronoiNoise(p * 1.2);
    if (noiseType < 2.5) return 1.0 - voronoiNoise(p);
    return noise(p * 1.7) * 0.7 + noise(p * 3.1) * 0.3;
}

float fbm(vec3 p) {
    float f = 0.0;
    float amp = 0.5;
    vec3 shift = vec3(100.0);
    for(int i=0; i<4; i++) {
        f += amp * noiseAt(p);
        p = p * 2.01 + shift;
        amp *= 0.5;
    }
    return f;
}

float getDensity(vec3 p, float t) {
    p.y += 0.8; 
    float sx = stretchX > 0.01 ? stretchX : 1.0;
    float sy = stretchY > 0.01 ? stretchY : 1.0;
    p.x /= sx;
    p.y /= sy;
    p.z /= sx;
    
    // THERMAL BUOYANCY: Geometrically lift the central core higher
    // Pull the sampling coordinate DOWN in the center so the physical shape goes UP
    float centerProximity = smoothstep(1.5, 0.0, length(p.xz));
    float lift = centerProximity * max(0.5, thermalBuoyancy * 2.5);
    float liftedY = p.y - (lift * 1.5); 

    // Convert to volume shape distance using lifted coordinate
    // Cone tapers much slower in the center so it reaches high into the air
    float coneTaper = mix(0.4, 0.15, centerProximity);
    float radius = max(0.01, 1.2 - max(0.0, liftedY) * coneTaper);
    float d = length(p.xz) - radius;

    // Central parts also move upward significantly faster
    float currentSpeed = speed * (1.0 + lift * 1.2) * 2.5;

    // Use lifted coordinates for sampling noise so turbulence follows the flame up
    vec3 np = vec3(p.x, liftedY, p.z) * scale * 0.5;

    // VORTICITY CONFINEMENT: domain-warp the sample space to create turbulent curling
    // Uses a second noise field sampled at offset positions for the warp direction
    if (vorticityConfinement > 0.01) {
        vec3 wp = np * 0.8;
        float wx = noise(wp + vec3(13.71, 7.33, 19.17)) - 0.5;
        float wy = noise(wp + vec3(-9.13, 2.77, -5.83)) - 0.5;
        float wz = noise(wp + vec3(-5.83, 23.11, -11.99)) - 0.5;
        // Primarily warp XZ (horizontal swirl), gentle Y (vertical stretch)
        np += vec3(wx, wy * 0.15, wz) * vorticityConfinement * 0.045;
    }

    // To make it seamlessly loop over t from 0.0 to 1.0
    // We blend two noise offsets
    // Pass 1: current time
    float disp1 = t * currentSpeed;
    vec3 np1 = np - vec3(0.0, disp1, 0.0);
    float n1_1 = fbm(np1);
    float n2_1 = fbm(np1 * 2.0 - vec3(0.0, disp1 * 2.0, 0.0));
    float noise1 = n1_1 * 0.7 + n2_1 * 0.35;

    // Pass 2: time wrapped to loop around
    float disp2 = (t - 1.0) * currentSpeed;
    vec3 np2 = np - vec3(0.0, disp2, 0.0);
    float n1_2 = fbm(np2);
    float n2_2 = fbm(np2 * 2.0 - vec3(0.0, disp2 * 2.0, 0.0));
    float noise2 = n1_2 * 0.7 + n2_2 * 0.35;

    // Blend them based on time to create a perfect loop
    float noiseBlended = mix(noise1, noise2, t);

    // Give it a more dynamic displacement using distortion
    // Remap noise into negative/positive to push and pull bounds
    float nSigned = (noiseBlended - 0.5) * 2.0;
    d += nSigned * max(0.5, distortion) * smoothstep(0.0, 1.5, p.y + 0.5); // increased displacement

    // DETACHED EMBERS: Pockets of fire breaking off near the top
    float emberSpeed = currentSpeed * 1.5; 
    float eDisp1 = t * emberSpeed;
    float eDisp2 = (t - 1.0) * emberSpeed;
    vec3 eNp1 = np * 3.5 - vec3(0.0, eDisp1, 0.0);
    vec3 eNp2 = np * 3.5 - vec3(0.0, eDisp2, 0.0);
    float eNoise = mix(fbm(eNp1), fbm(eNp2), t);
    
    // Threshold to create distinct small blobs
    float emberMask = smoothstep(0.65, 0.85, eNoise);
    emberMask *= smoothstep(0.5, 3.5, p.y) * smoothstep(2.0, 0.5, d);
    d -= emberMask * 0.9;

    // Ethereal thinning
    // Thinner shell based on detail to make it wispy instead of blocky
    // Default detail is ~1.0, so thickness will be ~0.25 (much thinner than 0.4)
    float shellThickness = mix(0.35, 0.05, clamp(detail / 5.0, 0.0, 1.0)); 
    float shell = 1.0 - smoothstep(0.0, shellThickness, abs(d));

    // High frequency textural cutouts for a wispy, stringy look
    vec3 hfNp1 = np * 2.5 - vec3(0.0, disp1 * 1.8, 0.0);
    vec3 hfNp2 = np * 2.5 - vec3(0.0, disp2 * 1.8, 0.0);
    float hfN = mix(fbm(hfNp1), fbm(hfNp2), t);
    
    // Create holes and wisps along the surface
    shell *= smoothstep(0.1, 0.9, hfN + (detail * 0.15));

    // A very faint core so the center is mostly empty and we see far-side details
    float coreAmt = smoothstep(0.2, -0.4, d) * 0.02;  
    float den = shell + coreAmt;

    // Let the center and embers fade out much higher up!
    float topFadeStart = mix(1.2, 4.0, centerProximity);
    float topFadeEnd = mix(3.5, 6.5, centerProximity);

    den *= smoothstep(-0.3, 0.5, p.y);
    den *= smoothstep(topFadeEnd, topFadeStart, p.y);

    float emDisp1 = t * emitterSpeed * 2.5;
    float emDisp2 = (t - 1.0) * emitterSpeed * 2.5;

    vec3 emNp1 = vec3(p.x * 2.0, p.z * 2.0, emDisp1);
    vec3 emNp2 = vec3(p.x * 2.0, p.z * 2.0, emDisp2);      
    float emN1 = fbm(emNp1);
    float emN2 = fbm(emNp2);
    float emN = mix(emN1, emN2, t);
    
    float emMask = mix(1.0, smoothstep(0.1, 0.9, emN), emitterTurbulence);
    den *= mix(emMask, 1.0, smoothstep(-0.5, 1.5, p.y));

    return den * max(0.0, densityMultiplier);
}

vec3 blackbody(float Temp) {
    vec3 c = vec3(255.0);
    c.x = 56100000. * pow(Temp,(-3.0 / 2.0)) + 148.0;
    c.y = 100.04 * log(Temp) - 236.0;
    if (Temp <= 6500.0) c.y = 99.47 * log(Temp) - 161.11;
    if (Temp <= 1900.0) c.y = 50.0;
    c.z = 194.18 * log(Temp) - 262.0;
    if (Temp <= 1900.0) c.z = 0.0;
    return clamp(c / 255.0, 0.0, 1.0);
}

void main() {
    vUv = uv;
    vec3 instancePos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float t = loopProgress;
    float local_den = getDensity(instancePos, t);
    
    if (local_den < 0.05) {
        gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
        return;
    }
    
    float temp = mix(baseTemperature, peakTemperature, local_den);
    if (useBlackbody) {
        vColor = blackbody(temp) * local_den * 2.0;
    } else {
        vec3 colMix = mix(color3, color2, smoothstep(0.0, 0.5, local_den));
        vColor = mix(colMix, color1, smoothstep(0.5, 1.0, local_den)) * local_den * 2.0;
    }
    
    vAlpha = smoothstep(alphaThreshold, alphaThreshold + 0.1, local_den);
    if (vAlpha <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
        return;
    }
    
    vec3 scalePos = position * clamp(local_den * 1.5, 0.2, 1.0);
        vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mvPosition.xyz += vec3(scalePos.xy, 0.0);
        gl_Position = projectionMatrix * mvPosition;
}

`;

export const fragmentShader = `

uniform float brightness;
uniform float contrast;
uniform float saturation;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;

void main() {
    if (vAlpha <= 0.05) discard;
    vec3 col = vColor;
    col = col * brightness;
    col = (col - 0.5) * contrast + 0.5;
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, saturation);
    
    
    // Soft circle mask
    float d = distance(vUv, vec2(0.5));
    float softMask = smoothstep(0.5, 0.1, d);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), vAlpha * 0.8 * softMask);
    
}

`;

export const FireGenerator: React.FC<FireGeneratorProps> = ({ onExport, onAttachToEmitter, embeddedUI, onExportToParticleSystem, autoRenderOnChange, particleCameraState }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const perspCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const particleCameraStateRef = useRef(particleCameraState);
  useEffect(() => {
    particleCameraStateRef.current = particleCameraState;
  }, [particleCameraState]);
  
  
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>(() => {
    const saved = localStorage.getItem('fireGeneratorSavedPresets');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      {
        name: 'Default Campfire',
        params: {
          shapeType: 'ground',
          color1: '#ff0000', color2: '#ff6600', color3: '#ffff00',
          speed: 3.0, scale: 3.0, coreBottom: 1.5, coreTop: 1.0,
          brightness: 1.0, contrast: 1.0, saturation: 1.0,
          frames: 64, fps: 30, resolution: 128, domainResolution: 24, emitterTurbulence: 0.5, emitterSpeed: 1.0,
          noiseType: 'simplex', distortion: 2.0, detail: 1.0, alphaThreshold: 0.0, particleSize: 1.5, flowX: 0, flowY: 1, flowZ: 0, rotX: 0, rotY: 0, rotZ: 0
        }
      },
      { name: 'Plasma Wisp (Details)',
        params: {
          shapeType: 'wisp',
          color1: '#550000', color2: '#ff3300', color3: '#ffffff',
          speed: 4.0, scale: 3.5, coreBottom: 1.0, coreTop: 1.0,
          brightness: 1.8, contrast: 1.4, saturation: 1.2,
          frames: 64, fps: 30, resolution: 128, domainResolution: 24,
          noiseType: 'simplex', distortion: 3.5, detail: 1.8, alphaThreshold: 0.2
        }
      },
      {
        name: 'Scientific FDS Fire',
        params: {
          shapeType: 'ground',
          color1: '#050000', // Blackbody core start
          color2: '#e64000', // Heat transition
          color3: '#ffe173', // Superheated core
          speed: 2.0, scale: 4.0, coreBottom: 1.8, coreTop: 0.8,
          brightness: 1.5, contrast: 1.2, saturation: 1.0,
          frames: 64, fps: 30, resolution: 128, domainResolution: 24,
          noiseType: 'voronoi', distortion: 3.0, detail: 1.5, alphaThreshold: 0.1, thermalBuoyancy: 3.5, vorticityConfinement: 2.5
        }
      },
      {
        name: 'ForeFire Real-Time Simulation',
        params: {
          shapeType: 'ground',
          color1: '#110000', color2: '#ff2200', color3: '#fff0aa',
          speed: 1.2, scale: 2.5, coreBottom: 2.0, coreTop: 0.9,
          brightness: 1.3, contrast: 1.1, saturation: 0.9,
          frames: 64, fps: 60, resolution: 128, domainResolution: 24,
          noiseType: 'simplex', distortion: 4.0, detail: 2.0, alphaThreshold: 0.2, thermalBuoyancy: 1.2, vorticityConfinement: 4.0
        }
      },
      { name: 'Magic Blue Fire',
        params: {
          shapeType: 'ground',
          color1: '#0000ff', color2: '#00ffff', color3: '#ffffff',
          speed: 4.0, scale: 2.5, coreBottom: 2.0, coreTop: 1.2,
          brightness: 1.2, contrast: 1.1, saturation: 1.5,
          frames: 64, fps: 30, resolution: 128, domainResolution: 24,
          noiseType: 'simplex', distortion: 2.5, detail: 1.2
        }
      }
    ];
  });

  useEffect(() => {
    localStorage.setItem('fireGeneratorSavedPresets', JSON.stringify(savedPresets));
  }, [savedPresets]);

  const [presetName, setPresetName] = useState('');
  const [selectedPresetIndex, setSelectedPresetIndex] = useState<number | ''>('');

  const handleSavePreset = () => {
    if (!presetName.trim()) return;
    const newPreset = { name: presetName.trim(), params: { ...params } };
    setSavedPresets([...savedPresets, newPreset]);
    setPresetName('');
    setSelectedPresetIndex(savedPresets.length); // the new one
  };

  const handleLoadPreset = (index: number) => {
    if (index >= 0 && index < savedPresets.length) {
      
  const p = {...savedPresets[index].params};
  if (p.flowX === undefined) p.flowX = 0;
  if (p.flowY === undefined) p.flowY = 1;
  if (p.flowZ === undefined) p.flowZ = 0;
  if (p.rotX === undefined) p.rotX = 0;
  if (p.rotY === undefined) p.rotY = 0;
  if (p.rotZ === undefined) p.rotZ = 0;
  setParams(p);

      setSelectedPresetIndex(index);
    }
  };

  const handleDeletePreset = (index: number) => {
    if (confirm('Delete preset: ' + savedPresets[index].name + '?')) {
      const newPresets = [...savedPresets];
      newPresets.splice(index, 1);
      setSavedPresets(newPresets);
      if (selectedPresetIndex === index) {
        setSelectedPresetIndex('');
      } else if (typeof selectedPresetIndex === 'number' && selectedPresetIndex > index) {
        setSelectedPresetIndex(selectedPresetIndex - 1);
      }
    }
  };
const [params, setParams] = useState<GeneratorParams>(() => {
    const saved = localStorage.getItem('fireGeneratorParams');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.core !== undefined && parsed.coreBottom === undefined) {
          parsed.coreBottom = parsed.core;
          parsed.coreTop = parsed.core;
        } else if (parsed.coreBottom === undefined) {
          parsed.coreBottom = 1.5;
          parsed.coreTop = 1.0;
        }
        
          if (parsed.flowX === undefined) parsed.flowX = 0;
          if (parsed.flowY === undefined) parsed.flowY = 1;
          if (parsed.flowZ === undefined) parsed.flowZ = 0;
          if (parsed.rotX === undefined) parsed.rotX = 0;
          if (parsed.rotY === undefined) parsed.rotY = 0;
          if (parsed.rotZ === undefined) parsed.rotZ = 0;
          if (parsed.baseBlur === undefined) parsed.baseBlur = 0.0;
          if (parsed.baseOpacity === undefined) parsed.baseOpacity = 1.0;
          if (parsed.glow1Blur === undefined) parsed.glow1Blur = 4.0;
          if (parsed.glow1Opacity === undefined) parsed.glow1Opacity = 0.6;
          if (parsed.glow2Blur === undefined) parsed.glow2Blur = 12.0;
          if (parsed.glow2Opacity === undefined) parsed.glow2Opacity = 0.3;
          if (parsed.useBlackbody === undefined) parsed.useBlackbody = false;
          if (parsed.baseTemperature === undefined) parsed.baseTemperature = 800;
          if (parsed.peakTemperature === undefined) parsed.peakTemperature = 3500;
          if (parsed.density === undefined) parsed.density = 1.0;
          return parsed;

      } catch (e) {
        console.error('Failed to parse saved fire generator params', e);
      }
    }
    return {
      shapeType: 'ground' as 'ground' | 'fireball',
      color1: '#ff0000', // darkest red
      color2: '#ff6600', // mid orange
      color3: '#ffff00', // hot yellow core
      speed: 3.0,
      scale: 3.0,
      coreBottom: 1.5,
      coreTop: 1.0,
      brightness: 1.0,
      contrast: 1.0,
      saturation: 1.0,
      frames: 30,
      fps: 30,
      resolution: 128, domainResolution: 24,
      noiseType: 'voronoi' as 'simplex' | 'voronoi' | 'cellular' | 'value',
      thermalBuoyancy: 1.0,
      vorticityConfinement: 1.0,
      distortion: 0.8,
      detail: 1.0,
      density: 1.0,
      alphaThreshold: 0.0, particleSize: 1.5, flowX: 0, flowY: 1, flowZ: 0, rotX: 0, rotY: 0, rotZ: 0,
      baseBlur: 0.0,
      baseOpacity: 1.0,
      glow1Blur: 4.0,
      glow1Opacity: 0.6,
      glow2Blur: 12.0,
      glow2Opacity: 0.3,
      useBlackbody: false,
      baseTemperature: 800,
      peakTemperature: 3500
    };
  });

  useEffect(() => {
    localStorage.setItem('fireGeneratorParams', JSON.stringify(params));
  }, [params]);

  // Update domain resolution dynamically
  useEffect(() => {
    if (!sceneRef.current || !materialRef.current) return;
    const scene = sceneRef.current;
    let oldMesh = null;
    scene.children.forEach(c => {
      if ((c as THREE.InstancedMesh).isInstancedMesh) oldMesh = c;
    });
    if (oldMesh) {
      scene.remove(oldMesh);
      ((oldMesh as any).geometry as THREE.BufferGeometry).dispose();
      (oldMesh as any).dispose();
    }

    const GRID_SIZE = params.domainResolution || 24;
    const DOMAIN_SIZE = 4.8;
    const SPACING = DOMAIN_SIZE / GRID_SIZE;
    const ps = params.particleSize || 1.5;
    const geometry = new THREE.PlaneGeometry(SPACING * ps, SPACING * ps);
    const GRID_SIZE_Y = Math.floor(GRID_SIZE * 2.5);
    const COUNT = GRID_SIZE * GRID_SIZE_Y * GRID_SIZE;
    const mesh = new THREE.InstancedMesh(geometry, materialRef.current, COUNT); 

    let idx = 0;
    const dummy = new THREE.Object3D();
    const offset = (GRID_SIZE / 2.0) * SPACING;
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE_Y; y++) {
            for (let z = 0; z < GRID_SIZE; z++) {
                dummy.position.set(x * SPACING - offset, y * SPACING - offset + 1.0, z * SPACING - offset);
                dummy.updateMatrix();
                mesh.setMatrixAt(idx++, dummy.matrix);
            }
        }
    }
    scene.add(mesh);
  }, [params.domainResolution, params.particleSize]);

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    rendererRef.current = renderer;

    const canvas2d = document.createElement('canvas');
    canvas2d.width = width;
    canvas2d.height = height;
    canvas2d.style.position = 'absolute';
    canvas2d.style.top = '0';
    canvas2d.style.left = '0';
    // Removed pointerEvents='none' to allow OrbitControls
    const ctx2d = canvas2d.getContext('2d');
    mountRef.current.appendChild(canvas2d);

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cameraRef.current = camera;
    const perspCam = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    perspCam.position.set(0, 0.5, 4.0);
    perspCameraRef.current = perspCam;

    const controls = new OrbitControls(perspCam, canvas2d);
    controls.enableDamping = true;
    controls.target.set(0, 0.5, 0);
    controlsRef.current = controls;

    
    const GRID_SIZE = params.domainResolution || 24;
    const DOMAIN_SIZE = 4.8; // Keep overall fire volume constant
    const SPACING = DOMAIN_SIZE / GRID_SIZE;
    const ps = params.particleSize || 1.5;
    const geometry = new THREE.PlaneGeometry(SPACING * ps, SPACING * ps);

    
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        stretchX: { value: params.stretchX || 1.0 },
        stretchY: { value: params.stretchY || 1.0 },
        cameraPos: { value: new THREE.Vector3() },
        cameraDir: { value: new THREE.Vector3() },
        cameraUp: { value: new THREE.Vector3() },
        cameraRight: { value: new THREE.Vector3() },
        fovT: { value: Math.tan(45 * 0.5 * Math.PI / 180) },
        resolution: { value: new THREE.Vector2(1, 1) },
        loopProgress: { value: 0 },
        shapeType: { value: params.shapeType === 'fireball' ? 1.0 : (params.shapeType === 'wisp' ? 2.0 : 0.0) },
        color1: { value: new THREE.Color(params.color1) },
        color2: { value: new THREE.Color(params.color2) },
        color3: { value: new THREE.Color(params.color3) },
        speed: { value: params.speed },
        scale: { value: params.scale },
        coreBottom: { value: params.coreBottom },
        coreTop: { value: params.coreTop },
        brightness: { value: params.brightness },
        contrast: { value: params.contrast },
        saturation: { value: params.saturation },
        noiseType: { value: params.noiseType === 'value' ? 3.0 : (params.noiseType === 'cellular' ? 2.0 : (params.noiseType === 'voronoi' ? 1.0 : 0.0)) },
        distortion: { value: params.distortion },
        detail: { value: params.detail },
          densityMultiplier: { value: params.density ?? 1.0 },
          
          alphaThreshold: { value: params.alphaThreshold || 0.0 },
          emitterTurbulence: { value: params.emitterTurbulence ?? 0.5 },
          emitterSpeed: { value: params.emitterSpeed ?? 1.0 },
          evolveOverLife: { value: params.evolveOverLife ? 1.0 : 0.0 },
          flowDirection: { value: new THREE.Vector3(params.flowX || 0, params.flowY || 1.0, params.flowZ || 0) },
          rotation: { value: new THREE.Vector3(params.rotX || 0, params.rotY || 0, params.rotZ || 0) },
            rotationSpeed: { value: new THREE.Vector3(params.rotSpeedX || 0, params.rotSpeedY || 0, params.rotSpeedZ || 0) },
          thermalBuoyancy: { value: params.thermalBuoyancy !== undefined ? params.thermalBuoyancy : 1.0 },
          vorticityConfinement: { value: params.vorticityConfinement !== undefined ? params.vorticityConfinement : 1.0 },
          useBlackbody: { value: params.useBlackbody || false },
          baseTemperature: { value: params.baseTemperature || 800 },
          peakTemperature: { value: params.peakTemperature || 3500 },
          globalWarpAmount: { value: params.globalWarpAmount || 0.0 }
        },
      transparent: true,
      blending: THREE.NormalBlending
    });
    materialRef.current = material;

    
    const GRID_SIZE_Y = Math.floor(GRID_SIZE * 2.5);
    const COUNT = GRID_SIZE * GRID_SIZE_Y * GRID_SIZE;
    const mesh = new THREE.InstancedMesh(geometry, material, COUNT);

    // Add additive blending back directly onto material
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;

    let idx = 0;
    const dummy = new THREE.Object3D();
    const offset = (GRID_SIZE / 2.0) * SPACING;
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE_Y; y++) {
            for (let z = 0; z < GRID_SIZE; z++) {
                dummy.position.set(x * SPACING - offset, y * SPACING - offset + 1.0, z * SPACING - offset);
                dummy.updateMatrix();
                mesh.setMatrixAt(idx++, dummy.matrix);
            }
        }
    }
    scene.add(mesh);


    let animationId: number;
    let clock = new THREE.Clock();

    const render = () => {
      animationId = requestAnimationFrame(render);
      const currentParams = paramsRef.current;
      
      if (materialRef.current) {
        const loopDuration = currentParams.frames / currentParams.fps;
        const pg = (clock.getElapsedTime() % loopDuration) / loopDuration;
        materialRef.current.uniforms.loopProgress.value = pg;
        materialRef.current.uniforms.stretchX.value = currentParams.stretchX || 1.0;
        materialRef.current.uniforms.stretchY.value = currentParams.stretchY || 1.0;
        if (controlsRef.current && perspCameraRef.current) {
          if (!particleCameraStateRef.current || !embeddedUI) {
             controlsRef.current.update();
          }
          const pCam = perspCameraRef.current;
          const m = materialRef.current;
          m.uniforms.cameraPos.value.copy(pCam.position);
          pCam.getWorldDirection(m.uniforms.cameraDir.value);
          m.uniforms.cameraUp.value.copy(pCam.up).applyQuaternion(pCam.quaternion);
          m.uniforms.cameraRight.value.crossVectors(m.uniforms.cameraDir.value, m.uniforms.cameraUp.value).normalize();
          m.uniforms.fovT.value = Math.tan(THREE.MathUtils.degToRad(pCam.fov * 0.5));
          m.uniforms.resolution.value.set(rendererRef.current?.domElement.width || 1, rendererRef.current?.domElement.height || 1);
        }
      }
      renderer.render(scene, perspCameraRef.current!);

      if (ctx2d) {
        ctx2d.clearRect(0, 0, canvas2d.width, canvas2d.height);
        
        ctx2d.globalCompositeOperation = 'source-over';
        ctx2d.filter = currentParams.baseBlur !== undefined && currentParams.baseBlur > 0 ? `blur(${currentParams.baseBlur}px)` : 'none';
        ctx2d.globalAlpha = currentParams.baseOpacity !== undefined ? currentParams.baseOpacity : 1.0;
        ctx2d.drawImage(renderer.domElement, 0, 0, canvas2d.width, canvas2d.height);

        // First glow pass
        ctx2d.globalCompositeOperation = 'screen';
        ctx2d.filter = `blur(${currentParams.glow1Blur ?? 4}px)`;
        ctx2d.globalAlpha = currentParams.glow1Opacity ?? 0.6;
        ctx2d.drawImage(renderer.domElement, 0, 0, canvas2d.width, canvas2d.height);

        // Second glow pass
        ctx2d.filter = `blur(${currentParams.glow2Blur ?? 12}px)`;
        ctx2d.globalAlpha = currentParams.glow2Opacity ?? 0.3;
        ctx2d.drawImage(renderer.domElement, 0, 0, canvas2d.width, canvas2d.height);
        
        // Reset
        ctx2d.filter = 'none';
        ctx2d.globalAlpha = 1.0;
        ctx2d.globalCompositeOperation = 'source-over';
      }
    };
    render();

    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      
      rendererRef.current.setSize(w, h);
      
      canvas2d.width = w;
      canvas2d.height = h;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      if (mountRef.current && canvas2d.parentNode === mountRef.current) {
          mountRef.current.removeChild(canvas2d);
      }
      if (controlsRef.current) controlsRef.current.dispose();
      renderer.dispose();
      material.dispose();
      geometry.dispose();
    };
  }, []);

  // Update uniforms without remounting
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.shapeType.value = params.shapeType === 'fireball' ? 1.0 : (params.shapeType === 'wisp' ? 2.0 : 0.0);
      materialRef.current.uniforms.color1.value.set(params.color1);
      materialRef.current.uniforms.color2.value.set(params.color2);
      materialRef.current.uniforms.color3.value.set(params.color3);
      materialRef.current.uniforms.speed.value = params.speed;
      materialRef.current.uniforms.scale.value = params.scale;
      materialRef.current.uniforms.coreBottom.value = params.coreBottom;
      materialRef.current.uniforms.coreTop.value = params.coreTop;
      materialRef.current.uniforms.brightness.value = params.brightness;
      materialRef.current.uniforms.contrast.value = params.contrast;
      materialRef.current.uniforms.saturation.value = params.saturation;
      materialRef.current.uniforms.noiseType.value = params.noiseType === 'value' ? 3.0 : (params.noiseType === 'cellular' ? 2.0 : (params.noiseType === 'voronoi' ? 1.0 : 0.0));
      materialRef.current.uniforms.distortion.value = params.distortion;
      materialRef.current.uniforms.detail.value = params.detail;
      if (materialRef.current.uniforms.densityMultiplier) materialRef.current.uniforms.densityMultiplier.value = params.density ?? 1.0;
      if(materialRef.current.uniforms.thermalBuoyancy) materialRef.current.uniforms.thermalBuoyancy.value = params.thermalBuoyancy !== undefined ? params.thermalBuoyancy : 1.0;
      if(materialRef.current.uniforms.vorticityConfinement) materialRef.current.uniforms.vorticityConfinement.value = params.vorticityConfinement !== undefined ? params.vorticityConfinement : 1.0;
      
      if(materialRef.current.uniforms.useBlackbody) materialRef.current.uniforms.useBlackbody.value = params.useBlackbody || false;
      if(materialRef.current.uniforms.baseTemperature) materialRef.current.uniforms.baseTemperature.value = params.baseTemperature || 800;
      if(materialRef.current.uniforms.peakTemperature) materialRef.current.uniforms.peakTemperature.value = params.peakTemperature || 3500;
      if(materialRef.current.uniforms.globalWarpAmount) materialRef.current.uniforms.globalWarpAmount.value = params.globalWarpAmount || 0.0;

        materialRef.current.uniforms.alphaThreshold.value = params.alphaThreshold || 0.0;
        materialRef.current.uniforms.emitterTurbulence.value = params.emitterTurbulence ?? 0.5;
        materialRef.current.uniforms.emitterSpeed.value = params.emitterSpeed ?? 1.0;
        if (materialRef.current.uniforms.flowDirection) {
           materialRef.current.uniforms.flowDirection.value.set(params.flowX || 0, params.flowY || 1, params.flowZ || 0);
        }
        if (materialRef.current.uniforms.rotation) {
           materialRef.current.uniforms.rotation.value.set(params.rotX || 0, params.rotY || 0, params.rotZ || 0);
        }

    }
  }, [params]);

  
  // We use a ref to prevent racing or overlapping renders
  const isAutoRenderingRef = useRef(false);

    const generateSequenceDataUrls = async (currentParams: GeneratorParams): Promise<string[]> => {
      if (!rendererRef.current || !sceneRef.current || !perspCameraRef.current || !materialRef.current) {
        return [];
      }

      const renderer = rendererRef.current;
      const targetSize = currentParams.resolution;

      const renderTarget = new THREE.WebGLRenderTarget(targetSize, targetSize, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter
      });

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = targetSize;
      tempCanvas.height = targetSize;
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) { return []; }

      
      if (controlsRef.current && perspCameraRef.current && materialRef.current) {
          const pCam = perspCameraRef.current;
          const m = materialRef.current;
          m.uniforms.cameraPos.value.copy(pCam.position);
          pCam.getWorldDirection(m.uniforms.cameraDir.value);
          m.uniforms.cameraUp.value.copy(pCam.up).applyQuaternion(pCam.quaternion);
          m.uniforms.cameraRight.value.crossVectors(m.uniforms.cameraDir.value, m.uniforms.cameraUp.value).normalize();
      }
      const dataUrls: string[] = [];

      for (let i = 0; i < currentParams.frames; i++) {
        const progress = i / currentParams.frames;
        materialRef.current.uniforms.loopProgress.value = progress;

        renderer.setRenderTarget(renderTarget);
        renderer.render(sceneRef.current, perspCameraRef.current);
        renderer.setRenderTarget(null);

        const pixels = new Uint8Array(targetSize * targetSize * 4);
        renderer.readRenderTargetPixels(renderTarget, 0, 0, targetSize, targetSize, pixels);
        
        const imageData = new ImageData(targetSize, targetSize);
        // Correcting image data flip
        const data = imageData.data;
        for (let y = 0; y < targetSize; y++) {
            for (let x = 0; x < targetSize; x++) {
                const srcIdx = ((targetSize - 1 - y) * targetSize + x) * 4;
                const destIdx = (y * targetSize + x) * 4;
                data[destIdx] = pixels[srcIdx];
                data[destIdx+1] = pixels[srcIdx+1];
                data[destIdx+2] = pixels[srcIdx+2];
                data[destIdx+3] = pixels[srcIdx+3];
            }
        }

        const offCanvas = document.createElement('canvas');
        offCanvas.width = targetSize;
        offCanvas.height = targetSize;
        const offCtx = offCanvas.getContext('2d');

        if (offCtx) {
          offCtx.putImageData(imageData, 0, 0);

          ctx.clearRect(0, 0, targetSize, targetSize);
          ctx.globalCompositeOperation = 'source-over';
          ctx.filter = currentParams.baseBlur !== undefined && currentParams.baseBlur > 0 ? `blur(${currentParams.baseBlur}px)` : 'none';
          ctx.globalAlpha = currentParams.baseOpacity !== undefined ? currentParams.baseOpacity : 1.0;
          ctx.drawImage(offCanvas, 0, 0);

          // First glow pass
          ctx.globalCompositeOperation = 'screen';
          ctx.filter = `blur(${currentParams.glow1Blur ?? 4}px)`;
          ctx.globalAlpha = currentParams.glow1Opacity ?? 0.6;
          ctx.drawImage(offCanvas, 0, 0);

          // Second glow pass
          ctx.filter = `blur(${currentParams.glow2Blur ?? 12}px)`;
          ctx.globalAlpha = currentParams.glow2Opacity ?? 0.3;
          ctx.drawImage(offCanvas, 0, 0);
        } else {
          ctx.putImageData(imageData, 0, 0);
        }

        dataUrls.push(tempCanvas.toDataURL('image/png'));
        
        // Yield to browser event loop to prevent freezing!
        await new Promise(r => setTimeout(r, 10));
      }

      renderTarget.dispose();
      return dataUrls;
  };

  // Synchronize camera with particle system
  useEffect(() => {
    if (particleCameraState && perspCameraRef.current && controlsRef.current) {
      if (!embeddedUI) return;

      const distance = 4.0;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(particleCameraState.quaternion);
      perspCameraRef.current.position.set(-dir.x * distance, -dir.y * distance + 0.5, -dir.z * distance);
      // If controlled by particle system, strictly match rotation!
      if (embeddedUI) {
         perspCameraRef.current.quaternion.copy(particleCameraState.quaternion);
      } else {
         perspCameraRef.current.lookAt(0, 0.5, 0);
         controlsRef.current.update();
      }
    }
  }, [particleCameraState, embeddedUI]);

// Auto-Update logic debounce
  useEffect(() => {
    if (!embeddedUI || !onExportToParticleSystem) return;

    const timerId = setTimeout(async () => {
      if (isAutoRenderingRef.current) return;
      isAutoRenderingRef.current = true;
      try {
        const dataUrls = await generateSequenceDataUrls(params);
        if (dataUrls.length > 0) {
            onExportToParticleSystem(dataUrls, params.fps);
        }
      } catch(err) {
        console.error(err);
      } finally {
         isAutoRenderingRef.current = false;
      }
    }, 400); // 400ms debounce

    return () => clearTimeout(timerId);
  }, [params, embeddedUI, onExportToParticleSystem, particleCameraState]);

  const handleExport = async () => {
    if (!rendererRef.current || !materialRef.current || !sceneRef.current || !perspCameraRef.current) return;
    setIsRendering(true);
    setProgress(0);

    const oldWidth = rendererRef.current.domElement.width;
    const oldHeight = rendererRef.current.domElement.height;

    rendererRef.current.setSize(params.resolution, params.resolution);
    
    const zip = new JSZip();
    const folder = zip.folder(`fire_sequence`);

    // Reset clock for export so it loops predictably
    const duration = params.frames / params.fps;

    for (let i = 0; i < params.frames; i++) {
        const progress = i / params.frames;
        materialRef.current.uniforms.loopProgress.value = progress;
        rendererRef.current.render(sceneRef.current, perspCameraRef.current);
        
        await new Promise<void>((resolve) => {
            rendererRef.current!.domElement.toBlob((blob) => {
                if (blob && folder) {
                    const paddedIndex = i.toString().padStart(3, '0');
                    folder.file(`fire_${paddedIndex}.png`, blob);
                }
                setProgress((i + 1) / params.frames);
                resolve();
            }, 'image/png');
        });
    }

    // Restore size
    rendererRef.current.setSize(mountRef.current?.clientWidth || oldWidth, mountRef.current?.clientHeight || oldHeight);

    const content = await zip.generateAsync({ type: 'blob' });
    if (onExport) onExport(content, `fire_sequence.zip`);

    setIsRendering(false);
  };

  const handleAttachToEmitter = async () => {
    if (!rendererRef.current || !materialRef.current || !sceneRef.current || !perspCameraRef.current || !onAttachToEmitter) return;
    setIsRendering(true);
    setProgress(0);

    const oldWidth = rendererRef.current.domElement.width;
    const oldHeight = rendererRef.current.domElement.height;

    rendererRef.current.setSize(params.resolution, params.resolution);
    
    const duration = params.frames / params.fps;
    const dataUrls: string[] = [];

    for (let i = 0; i < params.frames; i++) {
        const progress = i / params.frames;
        materialRef.current.uniforms.loopProgress.value = progress;
        rendererRef.current.render(sceneRef.current, perspCameraRef.current);
        
        dataUrls.push(rendererRef.current.domElement.toDataURL('image/png'));
        setProgress((i + 1) / params.frames);
        
        // Small delay to allow UI update
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Restore size
    rendererRef.current.setSize(mountRef.current?.clientWidth || oldWidth, mountRef.current?.clientHeight || oldHeight);

    onAttachToEmitter(dataUrls);
    
    setIsRendering(false);
  };

  return (
    <div style={embeddedUI ? { display: 'flex', flexDirection: 'column', width: '100%', backgroundColor: 'transparent', color: 'inherit' } : { display: 'flex', width: '100%', height: '100vh', backgroundColor: '#1e1e1e', color: '#fff' }}>
      <div style={embeddedUI ? { width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', padding: '0', borderRight: 'none', overflowY: 'visible' } : { width: '300px', display: 'flex', flexDirection: 'column', gap: '15px', padding: '20px', borderRight: '1px solid #333', overflowY: 'auto' }}>
        {!embeddedUI && <h3 style={{ margin: 0 }}>Fire Shader Generator</h3>}
          {/* Presets Section */}
          <div style={{ background: '#222', padding: '10px', borderRadius: '4px', marginBottom: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px' }}>Presets</div>
            
            <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
              <select 
                value={selectedPresetIndex}
                onChange={e => {
                  const val = e.target.value;
                  if (val !== '') {
                    handleLoadPreset(Number(val));
                  } else {
                    setSelectedPresetIndex('');
                  }
                }}
                style={{ flex: 1, background:'#2a2a2a', border:'1px solid #444', color:'#fff', padding:'5px' }}
              >
                <option value="">-- Load Preset --</option>
                {savedPresets.map((p, i) => (
                  <option key={i} value={i}>{p.name}</option>
                ))}
              </select>
              {typeof selectedPresetIndex === 'number' && true && (
                <button 
                  onClick={() => handleDeletePreset(selectedPresetIndex)}
                  style={{ background:'#dc3545', color:'white', border:'none', borderRadius:'3px', padding:'0 8px', cursor:'pointer' }}
                  title="Delete Preset"
                >
                  X
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '5px' }}>
              <input 
                type="text" 
                placeholder="New preset name..." 
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                style={{ flex: 1, background:'#2a2a2a', border:'1px solid #444', color:'#fff', padding:'5px' }}
              />
              <button 
                onClick={handleSavePreset}
                disabled={!presetName.trim()}
                style={{ background: presetName.trim() ? '#28a745' : '#555', color:'white', border:'none', borderRadius:'3px', padding:'5px 10px', cursor: presetName.trim() ? 'pointer' : 'default' }}
              >
                Save
              </button>
            </div>
          </div>


        <div>
          <label style={{display: 'block', fontSize: '12px', marginBottom:'5px'}}>Noise Algorithm</label>
          <select
            value={params.noiseType}
            onChange={e => setParams({...params, noiseType: e.target.value as 'simplex' | 'voronoi' | 'cellular' | 'value'})}
            style={{width:'100%', background:'#2a2a2a', border:'1px solid #444', color:'#fff', padding:'5px'}}
          >
            <option value="simplex">Simplex (Soft & Puffy)</option>
            <option value="voronoi">Voronoi (Crisp & Liquid)</option>
          </select>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Domain Distortion (Turbulence)</span>
            <span>{params.distortion.toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="3.0" step="0.05" value={params.distortion} onChange={e => setParams({...params, distortion: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Domain Resolution</span>
            <span>{params.domainResolution || 24}</span>
          </label>
          <input type="range" min="8" max="150" step="1" value={params.domainResolution || 24} onChange={e => setParams({...params, domainResolution: parseInt(e.target.value)})} style={{width:'100%'}}/>
        </div>

                <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Flow Dir X</span>
            <span>{(params.flowX || 0).toFixed(2)}</span>
          </label>
          <input type="range" min="-5.0" max="5.0" step="0.1" value={params.flowX || 0} onChange={e => setParams({...params, flowX: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Flow Dir Y</span>
            <span>{(params.flowY || 0).toFixed(2)}</span>
          </label>
          <input type="range" min="-5.0" max="5.0" step="0.1" value={params.flowY || 0} onChange={e => setParams({...params, flowY: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Flow Dir Z</span>
            <span>{(params.flowZ || 0).toFixed(2)}</span>
          </label>
          <input type="range" min="-5.0" max="5.0" step="0.1" value={params.flowZ || 0} onChange={e => setParams({...params, flowZ: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Rotation X</span>
            <span>{(params.rotX || 0).toFixed(2)}</span>
          </label>
          <input type="range" min="0" max="6.28" step="0.1" value={params.rotX || 0} onChange={e => setParams({...params, rotX: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Rotation Y</span>
            <span>{(params.rotY || 0).toFixed(2)}</span>
          </label>
          <input type="range" min="0" max="6.28" step="0.1" value={params.rotY || 0} onChange={e => setParams({...params, rotY: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Rotation Z</span>
            <span>{(params.rotZ || 0).toFixed(2)}</span>
          </label>
          <input type="range" min="0" max="6.28" step="0.1" value={params.rotZ || 0} onChange={e => setParams({...params, rotZ: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>
          <hr style={{ borderColor: '#333', margin: '5px 0' }} />
          <div style={{ fontSize: '13px', fontWeight: 'bold' }}>Rotation Speed</div>
          <div>
            <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
              <span>Rot Speed X</span>
              <span>{(params.rotSpeedX || 0).toFixed(2)}</span>
            </label>
            <input type="range" min="-5.0" max="5.0" step="0.1" value={params.rotSpeedX || 0} onChange={e => setParams({...params, rotSpeedX: parseFloat(e.target.value)})} style={{width:'100%'}}/>
          </div>
          <div>
            <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
              <span>Rot Speed Y</span>
              <span>{(params.rotSpeedY || 0).toFixed(2)}</span>
            </label>
            <input type="range" min="-5.0" max="5.0" step="0.1" value={params.rotSpeedY || 0} onChange={e => setParams({...params, rotSpeedY: parseFloat(e.target.value)})} style={{width:'100%'}}/>
          </div>
          <div>
            <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
              <span>Rot Speed Z</span>
              <span>{(params.rotSpeedZ || 0).toFixed(2)}</span>
            </label>
            <input type="range" min="-5.0" max="5.0" step="0.1" value={params.rotSpeedZ || 0} onChange={e => setParams({...params, rotSpeedZ: parseFloat(e.target.value)})} style={{width:'100%'}}/>
          </div>
            <div>
            <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
              <span>Thermal Buoyancy</span>
              <span>{params.thermalBuoyancy?.toFixed(2) || '1.00'}</span>
            </label>
            <input type="range" min="0.0" max="5.0" step="0.1" value={params.thermalBuoyancy ?? 1.0} onChange={e => setParams({...params, thermalBuoyancy: parseFloat(e.target.value)})} style={{width:'100%'}}/>
          </div>
          <div>
            <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
              <span>Vorticity Confinement</span>
              <span>{params.vorticityConfinement?.toFixed(2) || '1.00'}</span>
            </label>
            <input type="range" min="0.0" max="5.0" step="0.1" value={params.vorticityConfinement ?? 1.0} onChange={e => setParams({...params, vorticityConfinement: parseFloat(e.target.value)})} style={{width:'100%'}}/>
          </div>
          <div>
            <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
              <span>Fractal Detail</span>
            <span>{params.detail.toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="2.0" step="0.05" value={params.detail} onChange={e => setParams({...params, detail: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>
          <div>
            <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
              <span>Density</span>
              <span>{(params.density ?? 1.0).toFixed(2)}</span>
            </label>
            <input type="range" min="0.0" max="3.0" step="0.05" value={params.density ?? 1.0} onChange={e => setParams({...params, density: parseFloat(e.target.value)})} style={{width:'100%'}}/>
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={{display: 'block', fontSize: '12px', marginBottom:'5px'}} title="Stretch X">Stretch X</label>
            <input type="range" min="0" max="2" step="0.05" value={params.stretchX ?? 1.0} onChange={e => setParams({...params, stretchX: parseFloat(e.target.value)})} style={{width:'100%'}}/>
            <div style={{fontSize:'10px', color:'#aaa', textAlign:'right'}}>{(params.stretchX ?? 1.0).toFixed(2)}</div>
          </div>
        

        <div>
          <label style={{display: 'block', fontSize: '12px', marginBottom:'5px'}}>Fire Shape</label>
          <select
            value={params.shapeType}
            onChange={e => setParams({...params, shapeType: e.target.value as 'ground' | 'fireball' | 'wisp'})}
            style={{width:'100%', background:'#2a2a2a', border:'1px solid #444', color:'#fff', padding:'5px'}}
          >
            <option value="ground">Ground Fire</option>
            <option value="fireball">Fireball</option>
            <option value="wisp">Wisp / Ribbon</option>
          </select>
        </div>

        <div>
          <label style={{display: 'block', fontSize: '12px', marginBottom:'5px'}}>Color 1 (Edge)</label>
          <input type="color" value={params.color1} onChange={e => setParams({...params, color1: e.target.value})} style={{width:'100%'}} disabled={params.useBlackbody} />
        </div>
        <div>
          <label style={{display: 'block', fontSize: '12px', marginBottom:'5px'}}>Color 2 (Mid)</label>
          <input type="color" value={params.color2} onChange={e => setParams({...params, color2: e.target.value})} style={{width:'100%'}} disabled={params.useBlackbody} />
        </div>
        <div>
          <label style={{display: 'block', fontSize: '12px', marginBottom:'5px'}}>Color 3 (Core)</label>
          <input type="color" value={params.color3} onChange={e => setParams({...params, color3: e.target.value})} style={{width:'100%'}} disabled={params.useBlackbody} />
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Speed</span>
            <span>{params.speed.toFixed(1)}</span>
          </label>
          <input type="range" min="0.1" max="10" step="0.1" value={params.speed} onChange={e => setParams({...params, speed: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Noise Scale</span>
            <span>{params.scale.toFixed(1)}</span>
          </label>
          <input type="range" min="0.5" max="10" step="0.1" value={params.scale} onChange={e => setParams({...params, scale: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Core Contrast Bottom</span>
            <span>{params.coreBottom.toFixed(2)}</span>
          </label>
          <input type="range" min="0.1" max="5" step="0.1" value={params.coreBottom} onChange={e => setParams({...params, coreBottom: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>
        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Core Contrast Top</span>
            <span>{params.coreTop.toFixed(2)}</span>
          </label>
          <input type="range" min="0.1" max="5" step="0.1" value={params.coreTop} onChange={e => setParams({...params, coreTop: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        
        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Alpha Control</span>
            <span>{(params.alphaThreshold || 0).toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="1.5" step="0.01" value={params.alphaThreshold || 0.0} onChange={e => setParams({...params, alphaThreshold: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Emitter Turbulence</span>
            <span>{(params.emitterTurbulence ?? 0.5).toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="2.0" step="0.05" value={params.emitterTurbulence ?? 0.5} onChange={e => setParams({...params, emitterTurbulence: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>
        
        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Emitter Speed</span>
            <span>{(params.emitterSpeed ?? 1.0).toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="5.0" step="0.1" value={params.emitterSpeed ?? 1.0} onChange={e => setParams({...params, emitterSpeed: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>
        <hr style={{ borderColor: '#333', margin: '5px 0' }} />
        <div style={{ fontSize: '13px', fontWeight: 'bold' }}>Color Correction & Physics</div>

        <div>
          <label style={{display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px'}}>
            <input type="checkbox" checked={params.useBlackbody || false} onChange={e => setParams({...params, useBlackbody: e.target.checked})} />
            <span>Use Physical Blackbody Mapping</span>
          </label>
        </div>

        {params.useBlackbody && (
          <>
            <div>
              <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
                <span>Base Temp (K)</span>
                <span>{Math.round(params.baseTemperature || 800)}</span>
              </label>
              <input type="range" min="300" max="2000" step="10" value={params.baseTemperature || 800} onChange={e => setParams({...params, baseTemperature: parseFloat(e.target.value)})} style={{width:'100%'}}/>
            </div>

            <div>
              <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
                <span>Peak Temp (K)</span>
                <span>{Math.round(params.peakTemperature || 3500)}</span>
              </label>
              <input type="range" min="1500" max="6000" step="10" value={params.peakTemperature || 3500} onChange={e => setParams({...params, peakTemperature: parseFloat(e.target.value)})} style={{width:'100%'}}/>
            </div>
          </>
        )}

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Brightness</span>
            <span>{params.brightness.toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="3.0" step="0.05" value={params.brightness} onChange={e => setParams({...params, brightness: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Contrast</span>
            <span>{params.contrast.toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="3.0" step="0.05" value={params.contrast} onChange={e => setParams({...params, contrast: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Saturation</span>
            <span>{params.saturation.toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="3.0" step="0.05" value={params.saturation} onChange={e => setParams({...params, saturation: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <hr style={{ borderColor: '#333', margin: '10px 0' }} />
        <div style={{ fontSize: '13px', fontWeight: 'bold' }}>Rendering</div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Base Blur</span>
            <span>{(params.baseBlur ?? 0).toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="20.0" step="0.1" value={params.baseBlur ?? 0} onChange={e => setParams({...params, baseBlur: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Base Opacity</span>
            <span>{(params.baseOpacity ?? 1).toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="2.0" step="0.05" value={params.baseOpacity ?? 1} onChange={e => setParams({...params, baseOpacity: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Glow 1 Blur</span>
            <span>{(params.glow1Blur ?? 4).toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="40.0" step="0.5" value={params.glow1Blur ?? 4} onChange={e => setParams({...params, glow1Blur: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Glow 1 Opacity</span>
            <span>{(params.glow1Opacity ?? 0.6).toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="2.0" step="0.05" value={params.glow1Opacity ?? 0.6} onChange={e => setParams({...params, glow1Opacity: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Glow 2 Blur</span>
            <span>{(params.glow2Blur ?? 12).toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="80.0" step="0.5" value={params.glow2Blur ?? 12} onChange={e => setParams({...params, glow2Blur: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <div>
          <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px'}}>
            <span>Glow 2 Opacity</span>
            <span>{(params.glow2Opacity ?? 0.3).toFixed(2)}</span>
          </label>
          <input type="range" min="0.0" max="2.0" step="0.05" value={params.glow2Opacity ?? 0.3} onChange={e => setParams({...params, glow2Opacity: parseFloat(e.target.value)})} style={{width:'100%'}}/>
        </div>

        <hr style={{ borderColor: '#333', margin: '10px 0' }} />

        <div>
          <label style={{display: 'block', fontSize: '12px', marginBottom:'5px'}}>Sequence Frames</label>
          <input type="number" value={params.frames} onChange={e => setParams({...params, frames: parseInt(e.target.value)})} style={{width:'100%', background:'#2a2a2a', border:'1px solid #444', color:'#fff', padding:'5px'}}/>
        </div>
        
        <div>
          <label style={{display: 'block', fontSize: '12px', marginBottom:'5px'}}>Resolution</label>
          <select value={params.resolution} onChange={e => setParams({...params, resolution: parseInt(e.target.value)})} style={{width:'100%', background:'#2a2a2a', border:'1px solid #444', color:'#fff', padding:'5px'}}>
            <option value={64}>64 x 64</option>
            <option value={128}>128 x 128</option>
            <option value={256}>256 x 256</option>
            <option value={512}>512 x 512</option>
          </select>
        </div>

        <button 
          onClick={handleExport}
          disabled={isRendering}
          style={{
            marginTop: '20px',
            padding: '10px',
            backgroundColor: isRendering ? '#444' : '#0066cc',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: isRendering ? 'default' : 'pointer'
          }}
        >
          {isRendering ? `Rendering ${Math.round(progress * 100)}%` : 'Export Fire ZIP'}
        </button>

        {onAttachToEmitter && (
          <button 
            onClick={handleAttachToEmitter}
            disabled={isRendering}
            style={{
              marginTop: '10px',
              padding: '10px',
              backgroundColor: isRendering ? '#444' : '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: isRendering ? 'default' : 'pointer'
            }}
          >
            {isRendering ? `Attaching ${Math.round(progress * 100)}%` : 'Attach to Selected Emitter'}
          </button>
        )}

      </div>
      
      <div style={{ flex: 1, position: 'relative' }}>
        <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 10, fontSize: '12px', background: 'rgba(0,0,0,0.5)', padding: '5px' }}>
          Live Preview
        </div>
        <div ref={mountRef} style={{ width: '100%', height: '100%', background: '#000' }} />
      </div>
    </div>
  );
};
