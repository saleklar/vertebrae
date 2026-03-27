/**
 * GlowSphereGenerator.tsx
 * Interactive volumetric glowing-sphere lab.
 * Three.js + custom GLSL shaders; no external deps beyond three.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { EffectComposer }  from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass }      from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass }      from 'three/examples/jsm/postprocessing/OutputPass.js';
import JSZip from 'jszip';

export interface GlowSphereGeneratorProps {
  onExportToParticleSystem?: (urls: string[], fps: number) => void;
  onAttachToEmitter?: (urls: string[]) => void;
  onSendToShape?: (url: string) => void;
  onSendSequenceToShape?: (urls: string[], fps: number) => void;
  onSendToPaint?: (url: string) => void;
}

// ─── Parameter interface ────────────────────────────────────────────────────
interface SP {
  // Colors
  innerColor:       string;  // core / interior hue
  surfaceColor:     string;  // bright rim hue
  glowColor:        string;  // outer atmospheric glow hue
  // Shape
  surfaceThickness: number;  // 0.02..1.0  — width of the bright rim band
  glowRange:        number;  // 0.10..2.0  — how wide the glow extends
  // Intensities
  glowIntensity:    number;  // 0..1
  rimIntensity:     number;  // 0..1
  innerOpacity:     number;  // 0..0.8    — fill opacity of interior
  // Animation
  rotateSpeed:      number;  // 0..2 revolutions/sec
  pulseSpeed:       number;  // 0..3
  pulseAmount:      number;  // 0..0.40   — glow pulse amplitude
  // Scene
  bgColor:          string;
  sphereRadius:     number;  // 0.3..1.5
  // Vertex displacement deformation
  displaceStrength: number;  // 0..0.6  — magnitude of surface warp
  displaceScale:    number;  // 0.3..8  — noise spatial frequency (lower = bigger blobs)
  displaceSpeed:    number;  // 0..3    — advection speed through noise field
  displaceOctaves:  number;  // 1..6    — fBm detail layers
  displaceDir:      number;  // 0..360  — flow azimuth in degrees
  gradientStrength: number;  // 0..10.0 — top bright, bottom dim/invisible cutoff
  buoyancy:           number;  // 0..6.0  — upward elongation (teardrop) of top hemisphere
  buoyancyTurbulence: number;  // 0..2.0  — noise turbulence applied to buoyancy
  // Outer glow corona
  outerGlowColor:     string;
  outerGlowScale:     number;
  outerGlowRange:     number;
  outerGlowIntensity: number;
  outerGlowFeather:   number;
  // Post-processing FX
  fxBloom:          number;  // 0..2  — UnrealBloom strength
  fxBloomRadius:    number;  // 0..1
  fxBloomThreshold: number;  // 0..1
  fxBrightness:     number;  // -0.5..0.5
  fxContrast:       number;  // 0.5..2
  fxSaturation:     number;  // 0..2
  fxGamma:          number;  // 0.3..2.5
  fxRedMul:         number;
  fxGreenMul:       number;
  fxBlueMul:        number;
  fxRedPow:         number;
  fxGreenPow:       number;
  fxBluePow:        number;
  fxStarStrength:   number;  // 0..1
  fxStarRays:       number;  // 2..8
  fxStarAngle:      number;  // 0..180 — base streak angle in degrees
  fxStarLength:     number;  // 0..1
  fxVignette:       number;  // 0..1
    // Flame remap
    fxFlameMapStr:    number;
    fxFlameMapCenter: number;
    fxFlameMapBright: string;
    fxFlameMapDark:   string;
}

const DEFAULT_SP: SP = {
  innerColor:       '#0a0200',
  surfaceColor:     '#fff8d0',
  glowColor:        '#ff6600',
  surfaceThickness: 0.18,
  glowRange:        0.55,
  glowIntensity:    0.80,
  rimIntensity:     0.95,
  innerOpacity:     0.15,
  rotateSpeed:      0.25,
  pulseSpeed:       0.60,
  pulseAmount:      0.12,
  bgColor:          '#080200',
  sphereRadius:     1.0,
  displaceStrength: 0.0,
  displaceScale:    2.0,
  displaceSpeed:    0.5,
  displaceOctaves:  3,
  displaceDir:      90,
  gradientStrength: 0.0,
  buoyancy:           0.0,
  buoyancyTurbulence: 0.0,
  outerGlowColor:     '#cc2200',
  outerGlowScale:     2.5,
  outerGlowRange:     0.55,
  outerGlowIntensity: 0.0,
  outerGlowFeather:   0.20,
  fxBloom:          0.0,
  fxBloomRadius:    0.5,
  fxBloomThreshold: 0.1,
  fxBrightness:     0.0,
  fxContrast:       1.0,
  fxSaturation:     1.0,
  fxGamma:          1.0,
  fxRedMul:         1.0,
  fxGreenMul:       1.0,
  fxBlueMul:        1.0,
  fxRedPow:         1.0,
  fxGreenPow:       1.0,
  fxBluePow:        1.0,
  fxStarStrength:   0.0,
  fxStarRays:       4,
  fxStarAngle:      45,
  fxStarLength:     0.40,
  fxVignette:       0.0,
  fxFlameMapStr:    0.0,
  fxFlameMapCenter: 0.15,
  fxFlameMapBright: '#ff3300',
  fxFlameMapDark:   '#ffffcc',
};
// ─── Built-in named presets ───────────────────────────────────────────────
const BUILTIN_PRESETS: Record<string, Partial<SP>> = {
  'Flame':  {},  // filled by DEFAULT_SP spread at runtime
  'Plasma': { innerColor: '#150025', surfaceColor: '#ee88ff', glowColor: '#aa00ff',
              bgColor: '#0d0015', outerGlowColor: '#6600cc',
              glowIntensity: 0.85, rimIntensity: 0.90 },
  'Ice':    { innerColor: '#000a20', surfaceColor: '#c0ffff', glowColor: '#0088ff',
              bgColor: '#000510', outerGlowColor: '#0044cc',
              glowIntensity: 0.75, rimIntensity: 0.85 },
  'Solar':  { innerColor: '#180a00', surfaceColor: '#ffffaa', glowColor: '#ffaa00',
              bgColor: '#0a0500', outerGlowColor: '#ff6600',
              glowIntensity: 0.90, rimIntensity: 1.0  },
  'Void':   { innerColor: '#001008', surfaceColor: '#00ff88', glowColor: '#00cc44',
              bgColor: '#000a04', outerGlowColor: '#008833',
              glowIntensity: 0.70, rimIntensity: 0.80 },
};

const PRESET_KEY = 'gsg_presets';
function loadStoredPresets(): Record<string, SP> {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '{}'); } catch { return {}; }
}
function saveStoredPresets(p: Record<string, SP>) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(p));
}

// ─── Post-processing shader strings ─────────────────────────────────────────────────
const PP_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }\n`;

const PP_COLOR_FRAG = `
  uniform sampler2D tDiffuse;
  uniform float u_brightness;
  uniform float u_contrast;
  uniform float u_saturation;
  uniform float u_gamma;
  uniform vec3 u_rgbMul;
  uniform vec3 u_rgbPow;
  varying vec2 vUv;
  void main() {
    vec4 tex = texture2D(tDiffuse, vUv);
    vec3 c = tex.rgb;
    c *= u_rgbMul;
    c = pow(max(c, vec3(0.0001)), u_rgbPow);
    c += u_brightness;
    c = (c - 0.5) * u_contrast + 0.5;
    float gray = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(gray), c, u_saturation);
    c = pow(max(c, vec3(0.0001)), vec3(1.0 / max(0.001, u_gamma)));
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
  }\n`;

const PP_STAR_FRAG = `
  uniform sampler2D tDiffuse;
  uniform float u_strength;
  uniform float u_length;
  uniform float u_angle;
  uniform float u_rays;
  uniform vec2  u_res;
  varying vec2 vUv;
  void main() {
    vec4 base = texture2D(tDiffuse, vUv);
    if (u_strength < 0.001) { gl_FragColor = base; return; }
    float pi2 = 6.28318;
    vec4 streaks = vec4(0.0);
    int iRays = int(clamp(u_rays, 2.0, 8.0));
    for (int r = 0; r < 8; r++) {
      if (r >= iRays) break;
      float ang = u_angle + float(r) * pi2 / u_rays;
      vec2 dir = vec2(cos(ang), sin(ang)) / max(u_res, vec2(1.0));
      vec4 s = vec4(0.0); float decay = 1.0; float wt = 0.0;
      for (int i = 1; i <= 16; i++) {
        vec2 off = dir * float(i) * u_length * 80.0;
        s += texture2D(tDiffuse, vUv + off) * decay;
        wt += decay; decay *= 0.80;
      }
      streaks += s / max(wt, 0.001);
    }
    gl_FragColor = base + streaks * (u_strength / max(u_rays, 1.0));
  }\n`;

const PP_VIGNETTE_FRAG = `
  uniform sampler2D tDiffuse;
  uniform float u_strength;
  varying vec2 vUv;
  void main() {
    vec4 tex = texture2D(tDiffuse, vUv);
    float d = length(vUv - 0.5) * 2.0;
    float vig = 1.0 - smoothstep(0.4, 1.6, d * max(u_strength, 0.0001) * 1.6);
    gl_FragColor = vec4(tex.rgb * clamp(vig, 0.0, 1.0), tex.a);
  }\n`;

const PP_FLAMEMAP_FRAG = `
  uniform sampler2D tDiffuse;
  uniform float u_strength;
  uniform float u_center;
  uniform vec3 u_colorBright;
  uniform vec3 u_colorDark;
  varying vec2 vUv;
  void main() {
    vec4 tex = texture2D(tDiffuse, vUv);
    if (u_strength < 0.001) { gl_FragColor = tex; return; }
    
    // Evaluate perceived "energy" of the pixel
    float e = max(tex.r, max(tex.g, max(tex.b, 0.0)));
    
    // Calculate mapping: lower energies map towards u_colorDark (bright white/yellow), 
    // higher energies towards u_colorBright (reddish)
    float f = smoothstep(0.0, u_center, e);
    vec3 mapped = mix(u_colorDark, u_colorBright, f);
    
    // Mask out the empty background (we only want to colorize the glowing areas)
    float mask = smoothstep(0.0, 0.05, e);
    
    // Mix the original render with the remapped color
    vec3 finalColor = mix(tex.rgb, clamp(mapped, 0.0, 1.0) * mask * (0.5 + 0.5 * e), u_strength * mask);
    
    gl_FragColor = vec4(finalColor, tex.a);
  }\n`;
// ─── Helpers ────────────────────────────────────────────────────────────────
const h2rgb = (hex: string): [number, number, number] => {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3
    ? c.split('').map(x => x + x).join('')
    : c, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};
const rgbToThree = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

/** Minimal vertex shader for static spheres (no displacement) */
const VERT_SIMPLE = /* glsl */`
  varying vec3  vNormal;
  varying vec3  vViewDir;
  varying float vViewY;
  void main() {
    vNormal  = normalize(normalMatrix * normal);
    vec4 mv  = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mv.xyz);
    vViewY   = mv.y - (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;
    gl_Position = projectionMatrix * mv;
  }
`;

/** Soft outer corona — large back-face sphere, purely volumetric */
const FRAG_OUTER = /* glsl */`
  uniform vec3  u_color;
  uniform float u_range;
  uniform float u_feather;     // 0..1 — soft rim fade (0=hard edge, 1=very soft)
  uniform float u_intensity;
  uniform float u_pulse;
  uniform float u_gradStr;
  uniform float u_sphereR;

  varying vec3  vNormal;
  varying vec3  vViewDir;
  varying float vViewY;

  void main() {
    float nDotV   = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
    float fresnel = 1.0 - nDotV;          // 1 at silhouette, 0 at pole
    // Core glow falloff
    float glow    = pow(fresnel, 1.0 / max(0.01, u_range));
    // Feather: smoothstep clamps the outer rim to avoid a hard silhouette line
    float featherMask = smoothstep(0.0, max(0.001, u_feather), 1.0 - fresnel);
    glow *= featherMask * u_intensity * (0.8 + 0.2 * u_pulse);
    // Vertical gradient
    float gradT   = clamp(vViewY / max(0.01, u_sphereR) * 0.5 + 0.5, 0.0, 1.0);
    float gradMul = max(0.0, mix(1.0 - u_gradStr, 1.0, gradT));
    gl_FragColor  = vec4(u_color, clamp(glow * gradMul, 0.0, 1.0));
  }
`;

// ─── GLSL ───────────────────────────────────────────────────────────────────
const VERT = /* glsl */`
  // ── 3-D hash value-noise (no texture needed) ────────────────────────────
  float h3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h3(i),              h3(i+vec3(1,0,0)), u.x),
          mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), u.x), u.y),
      mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), u.x),
          mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), u.x), u.y),
      u.z);
  }
  // fBm – up to 6 octaves, controlled by oct uniform
  float fbm3(vec3 p, int oct) {
    float v = 0.0, a = 0.5, fr = 1.0;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      v  += noise3(p * fr) * a;
      a  *= 0.5;  fr *= 2.0;
    }
    return v;
  }

  uniform float u_displaceStr;
  uniform float u_displaceScale;
  uniform float u_displaceOct;   // stored as float, cast to int inside shader
  uniform vec3  u_displaceDir;   // normalised advection direction
  uniform float u_time;          // accumulated displacement time
    uniform float u_buoyancy;      // 0..6.0 — upward elongation + lateral pinch at top
    uniform float u_buoyancyTurb;  // 0..2.0 — noise turbulence applied to buoyancy

    varying vec3  vNormal;
    varying vec3  vViewDir;
    varying float vViewY;          // view-space Y — used for vertical gradient 

    void main() {
      vec3 pos = position;

      // Buoyancy: elongate along the displacement flow direction so both are aligned
      if (u_buoyancy > 0.0) {
        float alongFlow  = dot(pos, u_displaceDir);      // signed "height" on flow axis
        float topMask    = max(0.0, alongFlow);           // only leading hemisphere
        vec3  lateral    = pos - u_displaceDir * alongFlow; // component perp. to flow
        
        float effBuoyancy = u_buoyancy;
        if (topMask > 0.0 && u_buoyancyTurb > 0.0) {
          int oct = int(clamp(u_displaceOct, 1.0, 4.0));
          float n = fbm3(pos * 2.0 - u_displaceDir * u_time * u_displaceScale, oct) * 2.0 - 1.0;
          effBuoyancy *= max(0.0, 1.0 + n * u_buoyancyTurb * topMask);
        }

        // Quadratic stretch along flow, pinch laterally
        pos = u_displaceDir * (alongFlow + effBuoyancy * topMask * topMask)
            + lateral * (1.0 - effBuoyancy * 0.30 * topMask);
      }

    if (u_displaceStr > 0.0) {
      // Advect noise sampling position in flow direction over time
      vec3 sp = pos * u_displaceScale - u_displaceDir * u_time;
      int  oct = int(u_displaceOct);
      // Domain-warp: sample a second fBm to warp the first for extra turbulence
      vec3 warp = vec3(
        fbm3(sp + vec3(0.0),        oct),
        fbm3(sp + vec3(1.7, 9.2, 3.4), oct),
        fbm3(sp + vec3(8.3, 2.8, 5.1), oct)
      ) * 2.0 - 1.0;
      float d = (fbm3(sp + warp * 0.6, oct) - 0.5) * 2.0;

      // Extrude along normal
      pos += normal * d * u_displaceStr;
    }
    vNormal  = normalize(normalMatrix * normal);
    vec4 mv  = modelViewMatrix * vec4(pos, 1.0);
    vViewDir = normalize(-mv.xyz);
    vViewY   = mv.y - (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;               // in view space relative to center — fixed to screen up
    gl_Position = projectionMatrix * mv;
  }
`;

/** Primary rim+glow sphere — front faces */
const FRAG_RIM = /* glsl */`
  uniform vec3  u_innerColor;
  uniform vec3  u_surfaceColor;
  uniform vec3  u_glowColor;
  uniform float u_thickness;    // rim band width
  uniform float u_glowRange;    // glow spread
  uniform float u_rimIntensity;
  uniform float u_glowIntensity;
  uniform float u_innerOpacity;
  uniform float u_pulse;        // 0..1 animated pulse multiplier
  uniform float u_gradStr;      // 0..1 vertical gradient strength
  uniform float u_sphereR;      // sphere radius in scene units

  varying vec3  vNormal;
  varying vec3  vViewDir;
  varying float vViewY;

  void main() {
    float nDotV  = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
    float fresnel = 1.0 - nDotV;  // 0 = center, 1 = rim

    // Rim band — sharp falloff controlled by thickness
    float rimPow = 1.0 / max(0.008, u_thickness);
    float rim    = pow(fresnel, rimPow) * u_rimIntensity;

    // Glow halo — softer, wider
    float glowPow = 1.0 / max(0.008, u_glowRange + u_thickness * 0.5);
    float glow    = pow(fresnel, glowPow) * u_glowIntensity * (0.7 + 0.3 * u_pulse);

    // Inner fill
    float innerMask = 1.0 - fresnel;
    float inner     = innerMask * innerMask * u_innerOpacity;

    // Vertical gradient: top=(1-gradStr), bottom=1; fixed in screen/view space
    float gradT  = clamp(vViewY / max(0.01, u_sphereR) * 0.5 + 0.5, 0.0, 1.0);
    float gradMul = max(0.0, mix(1.0 - u_gradStr, 1.0, gradT));

    vec3 col = u_innerColor;
    col = mix(col, u_glowColor,    clamp(glow, 0.0, 1.0));
    col = mix(col, u_surfaceColor, clamp(rim,  0.0, 1.0));

    float alpha = clamp(rim + glow * 0.6 + inner, 0.0, 1.0) * gradMul;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** Outer atmospheric halo — back faces of a slightly larger sphere */
const FRAG_HALO = /* glsl */`
  uniform vec3  u_glowColor;
  uniform float u_glowRange;
  uniform float u_glowIntensity;
  uniform float u_pulse;
  uniform float u_gradStr;
  uniform float u_sphereR;

  varying vec3  vNormal;
  varying vec3  vViewDir;
  varying float vViewY;

  void main() {
    float nDotV  = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
    float fresnel = 1.0 - nDotV;
    float glow    = pow(fresnel, 1.0 / max(0.01, u_glowRange * 1.8));
    float gradT   = clamp(vViewY / max(0.01, u_sphereR) * 0.5 + 0.5, 0.0, 1.0);
    float gradMul = max(0.0, mix(1.0 - u_gradStr, 1.0, gradT));
    float alpha   = glow * u_glowIntensity * 0.55 * (0.75 + 0.25 * u_pulse) * gradMul;
    gl_FragColor  = vec4(u_glowColor, alpha);
  }
`;

// ─── Component ──────────────────────────────────────────────────────────────
export const GlowSphereGenerator: React.FC<GlowSphereGeneratorProps> = ({
  onExportToParticleSystem, onAttachToEmitter, onSendToShape, onSendSequenceToShape, onSendToPaint
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const spRef    = useRef<SP>(DEFAULT_SP);
  const rafRef   = useRef<number>(0);
  const [sp, setSp] = useState<SP>(DEFAULT_SP);
  const [exportRes, setExportRes] = useState(256);
  const [exportFrames, setExportFrames] = useState(24);
  const [exportFps, setExportFps] = useState(24);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProg, setExportProg] = useState(0);
  const exportApiRef = useRef<any>(null);
  const [presetName, setPresetName]       = useState('');
  const [userPresets, setUserPresets]     = useState<Record<string, SP>>(loadStoredPresets);
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  const allPresetNames = [
    ...Object.keys(BUILTIN_PRESETS),
    ...Object.keys(userPresets).filter(k => !(k in BUILTIN_PRESETS)),
  ];

  const loadPreset = useCallback((name: string) => {
    if (name in userPresets) { setSp({ ...DEFAULT_SP, ...userPresets[name] }); return; }
    if (name in BUILTIN_PRESETS) { setSp({ ...DEFAULT_SP, ...BUILTIN_PRESETS[name] }); return; }
  }, [userPresets]);

  const savePreset = useCallback(() => {
    const key = presetName.trim();
    if (!key) return;
    const next = { ...userPresets, [key]: { ...sp } };
    setUserPresets(next);
    saveStoredPresets(next);
    setSelectedPreset(key);
    setPresetName('');
  }, [presetName, sp, userPresets]);

  const deletePreset = useCallback((name: string) => {
    const next = { ...userPresets };
    delete next[name];
    setUserPresets(next);
    saveStoredPresets(next);
    if (selectedPreset === name) setSelectedPreset('');
  }, [userPresets, selectedPreset]);

  // Keep ref in sync
  useEffect(() => { spRef.current = sp; }, [sp]);

  const upd = useCallback(<K extends keyof SP>(k: K, v: SP[K]) => {
    setSp(prev => ({ ...prev, [k]: v }));
  }, []);

  // ── Three.js scene ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0x000000, 0); // Transparent base
    el.appendChild(renderer.domElement);

    // Scene / Camera
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 3.5);

    // Post-processing composer (created after scene + camera)
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(el.clientWidth, el.clientHeight), 0, 0.5, 0.1);
    composer.addPass(bloomPass);

    const colorPass = new ShaderPass({
      uniforms: { 
        tDiffuse: { value: null }, 
        u_brightness: { value: 0.0 }, 
        u_contrast: { value: 1.0 }, 
        u_saturation: { value: 1.0 }, 
        u_gamma: { value: 1.0 },
        u_rgbMul: { value: new THREE.Vector3(1, 1, 1) },
        u_rgbPow: { value: new THREE.Vector3(1, 1, 1) }
      },
      vertexShader: PP_VERT, fragmentShader: PP_COLOR_FRAG,
    });
    composer.addPass(colorPass);
    // Always reference pass.uniforms — ShaderPass clones on construction so local copies are stale
    const colorU = colorPass.uniforms;

    const starPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, u_strength: { value: 0.0 }, u_length: { value: 0.4 },
                  u_angle: { value: Math.PI / 4 }, u_rays: { value: 4.0 },
                  u_res: { value: new THREE.Vector2(el.clientWidth, el.clientHeight) } },
      vertexShader: PP_VERT, fragmentShader: PP_STAR_FRAG,
    });
    composer.addPass(starPass);
    const starU = starPass.uniforms;

    const vigPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, u_strength: { value: 0.0 } },
      vertexShader: PP_VERT, fragmentShader: PP_VIGNETTE_FRAG,
    });
    composer.addPass(vigPass);
    const vigU = vigPass.uniforms;

    const flameMapPass = new ShaderPass({
      uniforms: {
        tDiffuse:      { value: null },
        u_strength:    { value: 0.0 },
        u_center:      { value: 0.15 },
        u_colorBright: { value: new THREE.Color() },
        u_colorDark:   { value: new THREE.Color() }
      },
      vertexShader: PP_VERT, fragmentShader: PP_FLAMEMAP_FRAG,
    });
    composer.addPass(flameMapPass);
    const flameMapU = flameMapPass.uniforms;

    composer.addPass(new OutputPass());

    // Sphere geometries
    const geoMain = new THREE.SphereGeometry(1, 256, 128);
    const geoHalo = new THREE.SphereGeometry(1, 256, 128);

    // Materials
    const rimUniforms = {
      u_innerColor:   { value: new THREE.Color() },
      u_surfaceColor: { value: new THREE.Color() },
      u_glowColor:    { value: new THREE.Color() },
      u_thickness:    { value: DEFAULT_SP.surfaceThickness },
      u_glowRange:    { value: DEFAULT_SP.glowRange },
      u_rimIntensity: { value: DEFAULT_SP.rimIntensity },
      u_glowIntensity:{ value: DEFAULT_SP.glowIntensity },
      u_innerOpacity: { value: DEFAULT_SP.innerOpacity },
      u_pulse:         { value: 0.5 },
      u_gradStr:       { value: 0.0 },
      u_sphereR:       { value: DEFAULT_SP.sphereRadius },
      u_displaceStr:   { value: 0.0 },
      u_displaceScale: { value: 2.0 },
      u_displaceOct:   { value: 3.0 },
      u_displaceDir:   { value: new THREE.Vector3(0, 0.4, 1).normalize() },
      u_time:          { value: 0.0 },
      u_buoyancy:      { value: 0.0 },
      u_buoyancyTurb:  { value: 0.0 },
    };

    const haloUniforms = {
      u_glowColor:    { value: new THREE.Color() },
      u_glowRange:    { value: DEFAULT_SP.glowRange },
      u_glowIntensity:{ value: DEFAULT_SP.glowIntensity },
      u_pulse:         { value: 0.5 },
      u_gradStr:       { value: 0.0 },
      u_sphereR:       { value: DEFAULT_SP.sphereRadius },
      u_displaceStr:   { value: 0.0 },
      u_displaceScale: { value: 2.0 },
      u_displaceOct:   { value: 3.0 },
      u_displaceDir:   { value: new THREE.Vector3(0, 0.4, 1).normalize() },
      u_time:          { value: 0.0 },
      u_buoyancy:      { value: 0.0 },
      u_buoyancyTurb:  { value: 0.0 },
    };

    const rimMat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG_RIM,
      uniforms:       rimUniforms,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
      side:           THREE.FrontSide,
    });

    const haloMat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG_HALO,
      uniforms:       haloUniforms,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
      side:           THREE.BackSide,
    });

    const rimMesh  = new THREE.Mesh(geoMain, rimMat);
    const haloMesh = new THREE.Mesh(geoHalo, haloMat);

    // Outer glow corona — large low-poly back-face sphere
    const geoOuter = new THREE.SphereGeometry(1, 128, 64);
    const outerUniforms = {
      u_color:         { value: new THREE.Color() },
      u_range:         { value: DEFAULT_SP.outerGlowRange },
      u_feather:       { value: 0.20 },
      u_intensity:     { value: 0.0 },
      u_pulse:         { value: 0.5 },
      u_gradStr:       { value: 0.0 },
      u_sphereR:       { value: DEFAULT_SP.sphereRadius },
      // Shared with VERT so buoyancy + displacement shape the corona
      u_displaceStr:   { value: 0.0 },
      u_displaceScale: { value: 2.0 },
      u_displaceOct:   { value: 3.0 },
      u_displaceDir:   { value: new THREE.Vector3(0, 0.4, 1).normalize() },
      u_time:          { value: 0.0 },
      u_buoyancy:      { value: 0.0 },
      u_buoyancyTurb:  { value: 0.0 },
    };
    const outerMat = new THREE.ShaderMaterial({
      vertexShader:   VERT,         // same VERT — buoyancy shapes the corona
      fragmentShader: FRAG_OUTER,
      uniforms:       outerUniforms,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
      side:           THREE.BackSide,
    });
    const outerMesh = new THREE.Mesh(geoOuter, outerMat);

    // Pivot group — sphere meshes rotate together
    const pivot = new THREE.Group();
    pivot.add(haloMesh, rimMesh);
    scene.add(pivot);
    // Outer corona joins pivot AFTER pivot is in scene so it shares the same rotation
    pivot.add(outerMesh);

    // Separate UI scene for the direction arrow — bypasses post-processing
    const uiScene  = new THREE.Scene();
    const uiPivot  = new THREE.Group();
    uiScene.add(uiPivot);

    // Direction arrow — shows displacement flow direction
    const arrowDir = new THREE.Vector3(0, 0, 1);
    const arrowOrg = new THREE.Vector3(0, 0, 0);
    const arrowHelper = new THREE.ArrowHelper(arrowDir, arrowOrg, 1.85, 0xffee44, 0.28, 0.13);
    (arrowHelper.line.material as THREE.LineBasicMaterial).opacity = 0.75;
    (arrowHelper.line.material as THREE.LineBasicMaterial).transparent = true;
    (arrowHelper.cone.material as THREE.MeshBasicMaterial).opacity = 0.80;
    (arrowHelper.cone.material as THREE.MeshBasicMaterial).transparent = true;
    (arrowHelper.line.material as THREE.LineBasicMaterial).depthTest = false;
    (arrowHelper.cone.material as THREE.MeshBasicMaterial).depthTest = false;
    uiPivot.add(arrowHelper);

    // Orbit (left), pan (middle / right), zoom (scroll)
    let dragBtn = -1, lastX = 0, lastY = 0;
    let rotX = 0, rotY = 0;
    let panX = 0, panY = 0;
    let camZ = 3.5;

    const onDown = (e: MouseEvent) => {
      dragBtn = e.button; lastX = e.clientX; lastY = e.clientY;
      if (e.button === 2) e.preventDefault();
    };
    const onUp = () => { dragBtn = -1; };
    const onMove = (e: MouseEvent) => {
      if (dragBtn < 0) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (dragBtn === 0) {
        // orbit
        rotY += dx * 0.008;
        rotX += dy * 0.008;
      } else {
        // pan (middle or right button)
        const panSpeed = camZ * 0.0012;
        panX += dx * panSpeed;
        panY -= dy * panSpeed;
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camZ = Math.max(0.5, Math.min(12, camZ + e.deltaY * 0.005));
    };
    const onContext = (e: MouseEvent) => e.preventDefault();
    renderer.domElement.addEventListener('mousedown',    onDown);
    renderer.domElement.addEventListener('contextmenu', onContext);
    renderer.domElement.addEventListener('wheel',       onWheel, { passive: false });
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('mousemove', onMove);

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!el) return;
      renderer.setSize(el.clientWidth, el.clientHeight);
      composer.setSize(el.clientWidth, el.clientHeight);
      bloomPass.resolution.set(el.clientWidth, el.clientHeight);
      starU.u_res.value.set(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    // Export API setup
    exportApiRef.current = async (reqFrames: number, reqRes: number, reqFps: number, onProg: (p: number)=>void) => {
      if (!el) return [];
      const origW = el.clientWidth;
      const origH = el.clientHeight;
      const origAspect = camera.aspect;
      
      cancelAnimationFrame(rafRef.current);
      await new Promise(r => setTimeout(r, 20));

      renderer.setSize(reqRes, reqRes);
      composer.setSize(reqRes, reqRes);
      bloomPass.resolution.set(reqRes, reqRes);
      starU.u_res.value.set(reqRes, reqRes);
      camera.aspect = 1.0;
      camera.updateProjectionMatrix();

      const urls: string[] = [];
      for(let i=0; i<reqFrames; i++) {
        const time = i * (1/reqFps);
        const dt = 1/reqFps;
        renderInternal(time, dt, true);
        
        arrowHelper.visible = false;
        composer.render();
        const str = renderer.domElement.toDataURL('image/png');
        
        const c2 = document.createElement('canvas');
        c2.width = reqRes; c2.height = reqRes;
        const ctx2 = c2.getContext('2d');
        const img = new Image();
        img.src = str;
        await new Promise(r => { img.onload = r; });
        if(ctx2) ctx2.drawImage(img, 0, 0);
        urls.push(c2.toDataURL('image/png'));
        
        if(onProg) onProg((i+1)/reqFrames * 100);
        await new Promise(r => setTimeout(r, 10)); 
      }

      renderer.setSize(origW, origH);
      composer.setSize(origW, origH);
      bloomPass.resolution.set(origW, origH);
      starU.u_res.value.set(origW, origH);
      camera.aspect = origAspect;
      camera.updateProjectionMatrix();

      t0 = performance.now();
      appTime = 0;
      rafRef.current = requestAnimationFrame(tick);

      return urls;
    };

    const renderInternal = (appTimeOverride: number, dt: number, isExporting: boolean = false) => {
      const f = spRef.current;
      
      if (isExporting) {
        renderer.setClearColor(0x000000, 0); // Force transparent bg for export
      } else {
        const [br, bg, bb] = h2rgb(f.bgColor);
        renderer.setClearColor(rgbToThree(br, bg, bb), 1);
      }
      
      const r = Math.max(0.1, f.sphereRadius);
      rimMesh.scale.setScalar(r);
      haloMesh.scale.setScalar(r * 1.08);   
      const outerScale = Math.max(1.1, f.outerGlowScale ?? 2.5) * r;
      outerMesh.scale.setScalar(outerScale);
      rotY += f.rotateSpeed * 0.4 * dt;
      pivot.rotation.y = rotY;
      pivot.rotation.x = rotX;
      pivot.position.x = panX;
      pivot.position.y = panY;
      camera.position.z = camZ;
      uiPivot.rotation.copy(pivot.rotation);
      uiPivot.position.copy(pivot.position);
      const pulse = 0.5 + 0.5 * Math.sin(appTimeOverride * f.pulseSpeed * Math.PI * 2);
      const pulseMul = 1.0 - f.pulseAmount + f.pulseAmount * pulse;
      const [ir, ig, ib]   = h2rgb(f.innerColor);
      const [sr, sg, sb]   = h2rgb(f.surfaceColor);
      const [gr, gg, gb]   = h2rgb(f.glowColor);
      rimUniforms.u_innerColor.value.setRGB(ir, ig, ib);
      rimUniforms.u_surfaceColor.value.setRGB(sr, sg, sb);
      rimUniforms.u_glowColor.value.setRGB(gr, gg, gb);
      rimUniforms.u_thickness.value    = f.surfaceThickness;
      rimUniforms.u_glowRange.value    = f.glowRange;
      rimUniforms.u_rimIntensity.value = f.rimIntensity;
      rimUniforms.u_glowIntensity.value= f.glowIntensity * pulseMul;
      rimUniforms.u_innerOpacity.value = f.innerOpacity;
      rimUniforms.u_pulse.value        = pulse;
      haloUniforms.u_glowColor.value.setRGB(gr, gg, gb);
      haloUniforms.u_glowRange.value    = f.glowRange;
      haloUniforms.u_glowIntensity.value= f.glowIntensity * pulseMul;
      haloUniforms.u_pulse.value        = pulse;
      const radDir  = (f.displaceDir ?? 90) * Math.PI / 180;
      const dirVec  = new THREE.Vector3(Math.cos(radDir), 0.35, Math.sin(radDir)).normalize();
      const dispTime = appTimeOverride * Math.max(0, f.displaceSpeed ?? 0.5);
      const gradStr  = Math.max(0, f.gradientStrength ?? 0);
      for (const u of [rimUniforms, haloUniforms]) {
        u.u_displaceStr.value   = Math.max(0, f.displaceStrength ?? 0);
        u.u_displaceScale.value = Math.max(0.1, f.displaceScale ?? 2.0);
        u.u_displaceOct.value   = Math.max(1, Math.round(f.displaceOctaves ?? 3));
        u.u_displaceDir.value.copy(dirVec);
        u.u_time.value          = dispTime;
        u.u_gradStr.value       = gradStr;
        u.u_sphereR.value       = r;
        u.u_buoyancy.value      = Math.max(0, f.buoyancy ?? 0);
        u.u_buoyancyTurb.value  = Math.max(0, f.buoyancyTurbulence ?? 0);
      }
      const [ogr, ogg, ogb] = h2rgb(f.outerGlowColor ?? '#0033ff');
      outerUniforms.u_color.value.setRGB(ogr, ogg, ogb);
      outerUniforms.u_range.value     = Math.max(0.01, f.outerGlowRange ?? 0.55);
      outerUniforms.u_feather.value   = Math.max(0.001, f.outerGlowFeather ?? 0.20);
      outerUniforms.u_intensity.value = Math.max(0, f.outerGlowIntensity ?? 0) * pulseMul;
      outerUniforms.u_pulse.value     = pulse;
      outerUniforms.u_gradStr.value   = gradStr;
      outerUniforms.u_sphereR.value   = r;
      outerUniforms.u_displaceStr.value   = Math.max(0, f.displaceStrength ?? 0);
      outerUniforms.u_displaceScale.value = Math.max(0.1, f.displaceScale ?? 2.0);
      outerUniforms.u_displaceOct.value   = Math.max(1, Math.round(f.displaceOctaves ?? 3));
      outerUniforms.u_displaceDir.value.copy(dirVec);
      outerUniforms.u_time.value          = dispTime;
      outerUniforms.u_buoyancy.value      = Math.max(0, f.buoyancy ?? 0);
      outerUniforms.u_buoyancyTurb.value  = Math.max(0, f.buoyancyTurbulence ?? 0);
      arrowHelper.setDirection(dirVec);
      arrowHelper.visible = (f.displaceStrength ?? 0) > 0;
      bloomPass.strength  = Math.max(0, f.fxBloom ?? 0);
      bloomPass.radius    = Math.max(0, f.fxBloomRadius ?? 0.5);
      bloomPass.threshold = Math.max(0, f.fxBloomThreshold ?? 0.1);
      colorU.u_brightness.value = f.fxBrightness ?? 0;
      colorU.u_contrast.value   = f.fxContrast ?? 1;
      colorU.u_saturation.value = f.fxSaturation ?? 1;
      colorU.u_gamma.value      = f.fxGamma ?? 1;
      colorU.u_rgbMul.value.set(f.fxRedMul ?? 1, f.fxGreenMul ?? 1, f.fxBlueMul ?? 1);
      colorU.u_rgbPow.value.set(f.fxRedPow ?? 1, f.fxGreenPow ?? 1, f.fxBluePow ?? 1);
      flameMapU.u_strength.value = f.fxFlameMapStr ?? 0;
      flameMapU.u_center.value = f.fxFlameMapCenter ?? 0.15;
      flameMapU.u_colorBright.value.set(f.fxFlameMapBright ?? '#ff3300');
      flameMapU.u_colorDark.value.set(f.fxFlameMapDark ?? '#ffffcc');
      starU.u_strength.value = f.fxStarStrength ?? 0;
      starU.u_length.value   = f.fxStarLength ?? 0.4;
      starU.u_angle.value    = (f.fxStarAngle ?? 45) * Math.PI / 180;
      starU.u_rays.value     = Math.max(2, Math.round(f.fxStarRays ?? 4));
      vigU.u_strength.value = f.fxVignette ?? 0;
    };

    // Render loop
    let t0 = performance.now();
    let appTime = 0.0;
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const dt = (now - t0) / 1000;
      t0 = now;
      appTime += dt;
      renderInternal(appTime, dt);

      composer.render();

      // Draw UI overlay (arrow) without post-processing on top
      renderer.autoClear = false;
      renderer.render(uiScene, camera);
      renderer.autoClear = true;
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      renderer.domElement.removeEventListener('mousedown',    onDown);
      renderer.domElement.removeEventListener('contextmenu', onContext);
      renderer.domElement.removeEventListener('wheel',       onWheel);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('mousemove', onMove);
      ro.disconnect();
      composer.dispose();
      renderer.dispose();
      rimMat.dispose(); haloMat.dispose(); outerMat.dispose();
      geoMain.dispose(); geoHalo.dispose(); geoOuter.dispose();
      uiPivot.remove(arrowHelper);
      (arrowHelper.line.material as THREE.LineBasicMaterial).dispose();
      (arrowHelper.cone.material as THREE.MeshBasicMaterial).dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []); // stable — reads from spRef inside

  // ── Styles ─────────────────────────────────────────────────────────────
  const S = {
    wrap: {
      display: 'flex', flexDirection: 'row' as const,
      width: '100%', height: '100%', overflow: 'hidden',
      background: '#111827', color: '#c8d0e0', fontFamily: 'system-ui, sans-serif',
    } as React.CSSProperties,
    canvas: {
      flex: 1, minWidth: 0, cursor: 'grab',
    } as React.CSSProperties,
    panel: {
      width: '220px', flexShrink: 0, overflowY: 'auto' as const,
      background: '#161e2e', borderLeft: '1px solid #2a3450',
      padding: '10px 12px', fontSize: '0.76rem',
    } as React.CSSProperties,
    sec: {
      fontSize: '0.68rem', fontWeight: 700, color: '#4f6ef7',
      textTransform: 'uppercase' as const, letterSpacing: '0.06em',
      marginTop: '12px', marginBottom: '5px', paddingBottom: '3px',
      borderBottom: '1px solid #2a3450',
    },
    row: {
      display: 'flex', alignItems: 'center',
      gap: '6px', marginBottom: '5px',
    } as React.CSSProperties,
    label: {
      width: '105px', flexShrink: 0, color: '#8a93a2',
      textAlign: 'right' as const, paddingRight: '4px',
    },
    input: {
      flex: 1, accentColor: '#4f6ef7', cursor: 'pointer', minWidth: 0,
    } as React.CSSProperties,
  };

  const lbl = (name: string, val: string) => (
    <label style={S.label}>{name} <span style={{ color: '#c8d0e0' }}>{val}</span></label>
  );

  const colorRow = (name: string, key: keyof SP) => (
    <div style={S.row}>
      <label style={S.label}>{name}</label>
      <input type="color" value={sp[key] as string}
        onChange={e => upd(key, e.target.value as SP[typeof key])}
        style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'transparent', padding: 0 }} />
      <span style={{ fontSize: '0.68rem', color: '#5a6a82' }}>{sp[key] as string}</span>
    </div>
  );

  return (
    <div style={S.wrap}>
      {/* 3-D viewport */}
      <div ref={mountRef} style={S.canvas} />

      {/* Controls */}
      <div style={S.panel}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#c8d0e0', marginBottom: '4px' }}>
          🔵 Glow Sphere
        </div>
        <div style={{ fontSize: '0.67rem', color: '#5a6a82', marginBottom: '8px' }}>
          Drag viewport to orbit
        </div>

        {/* Colors */}
        <div style={S.sec}>Colors</div>
        {colorRow('Inner / Core',  'innerColor')}
        {colorRow('Surface Rim',   'surfaceColor')}
        {colorRow('Glow / Halo',   'glowColor')}
        {colorRow('Background',    'bgColor')}

        {/* Surface */}
        <div style={S.sec}>Surface</div>
        <div style={S.row}>{lbl('Rim Thickness', sp.surfaceThickness.toFixed(2))}
          <input type="range" style={S.input} min={0.02} max={3.0} step={0.01}
            value={sp.surfaceThickness} onChange={e => upd('surfaceThickness', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Rim Intensity', sp.rimIntensity.toFixed(2))}
          <input type="range" style={S.input} min={0} max={1} step={0.01}
            value={sp.rimIntensity} onChange={e => upd('rimIntensity', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Inner Fill', sp.innerOpacity.toFixed(2))}
          <input type="range" style={S.input} min={0} max={0.8} step={0.01}
            value={sp.innerOpacity} onChange={e => upd('innerOpacity', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Sphere Radius', sp.sphereRadius.toFixed(2))}
          <input type="range" style={S.input} min={0.3} max={1.5} step={0.02}
            value={sp.sphereRadius} onChange={e => upd('sphereRadius', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Buoyancy', (sp.buoyancy ?? 0).toFixed(2))}
          <input type="range" style={S.input} min={0} max={6.0} step={0.05}
            value={sp.buoyancy ?? 0} onChange={e => upd('buoyancy', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Buoyancy Turb.', (sp.buoyancyTurbulence ?? 0).toFixed(2))}
          <input type="range" style={S.input} min={0} max={2.0} step={0.01}
            value={sp.buoyancyTurbulence ?? 0} onChange={e => upd('buoyancyTurbulence', Number(e.target.value))} /></div>

        {/* Glow */}
        <div style={S.sec}>Glow</div>
        <div style={S.row}>{lbl('Glow Range', sp.glowRange.toFixed(2))}
          <input type="range" style={S.input} min={0.05} max={2.0} step={0.02}
            value={sp.glowRange} onChange={e => upd('glowRange', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Glow Intensity', sp.glowIntensity.toFixed(2))}
          <input type="range" style={S.input} min={0} max={1} step={0.01}
            value={sp.glowIntensity} onChange={e => upd('glowIntensity', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Vert. Gradient', (sp.gradientStrength ?? 0).toFixed(2))}
          <input type="range" style={S.input} min={0} max={10} step={0.05}
            value={sp.gradientStrength ?? 0} onChange={e => upd('gradientStrength', Number(e.target.value))} /></div>

        {/* Outer Glow */}
        <div style={S.sec}>Outer Corona</div>
        {colorRow('Corona Color', 'outerGlowColor')}
        <div style={S.row}>{lbl('Intensity', (sp.outerGlowIntensity ?? 0).toFixed(2))}
          <input type="range" style={S.input} min={0} max={1} step={0.01}
            value={sp.outerGlowIntensity ?? 0} onChange={e => upd('outerGlowIntensity', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Scale', (sp.outerGlowScale ?? 2.5).toFixed(2))}
          <input type="range" style={S.input} min={1.2} max={6} step={0.05}
            value={sp.outerGlowScale ?? 2.5} onChange={e => upd('outerGlowScale', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Range', (sp.outerGlowRange ?? 0.55).toFixed(2))}
          <input type="range" style={S.input} min={0.05} max={2} step={0.02}
            value={sp.outerGlowRange ?? 0.55} onChange={e => upd('outerGlowRange', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Feather', (sp.outerGlowFeather ?? 0.20).toFixed(2))}
          <input type="range" style={S.input} min={0.02} max={1.0} step={0.01}
            value={sp.outerGlowFeather ?? 0.20} onChange={e => upd('outerGlowFeather', Number(e.target.value))} /></div>

        {/* Displacement */}
        <div style={S.sec}>Displacement</div>
        <div style={S.row}>{lbl('Strength', (sp.displaceStrength ?? 0).toFixed(2))}
          <input type="range" style={S.input} min={0} max={0.6} step={0.01}
            value={sp.displaceStrength ?? 0} onChange={e => upd('displaceStrength', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Scale', (sp.displaceScale ?? 2).toFixed(2))}
          <input type="range" style={S.input} min={0.3} max={8} step={0.1}
            value={sp.displaceScale ?? 2} onChange={e => upd('displaceScale', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Speed', (sp.displaceSpeed ?? 0.5).toFixed(2))}
          <input type="range" style={S.input} min={0} max={15} step={0.05}
            value={sp.displaceSpeed ?? 0.5} onChange={e => upd('displaceSpeed', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Octaves', String(Math.round(sp.displaceOctaves ?? 3)))}
          <input type="range" style={S.input} min={1} max={6} step={1}
            value={sp.displaceOctaves ?? 3} onChange={e => upd('displaceOctaves', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Direction', `${Math.round(sp.displaceDir ?? 90)}°`)}
          <input type="range" style={S.input} min={0} max={360} step={5}
            value={sp.displaceDir ?? 90} onChange={e => upd('displaceDir', Number(e.target.value))} /></div>

        {/* Animation */}
        <div style={S.sec}>Animation</div>
        <div style={S.row}>{lbl('Rotate Speed', sp.rotateSpeed.toFixed(2))}
          <input type="range" style={S.input} min={0} max={2} step={0.02}
            value={sp.rotateSpeed} onChange={e => upd('rotateSpeed', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Pulse Speed', sp.pulseSpeed.toFixed(2))}
          <input type="range" style={S.input} min={0} max={3} step={0.05}
            value={sp.pulseSpeed} onChange={e => upd('pulseSpeed', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Pulse Amount', sp.pulseAmount.toFixed(2))}
          <input type="range" style={S.input} min={0} max={0.4} step={0.01}
            value={sp.pulseAmount} onChange={e => upd('pulseAmount', Number(e.target.value))} /></div>

        {/* Presets */}
        <div style={S.sec}>Presets</div>
        <div style={{ display: 'flex', gap: '5px', marginBottom: '4px' }}>
          <select
            value={selectedPreset}
            onChange={e => setSelectedPreset(e.target.value)}
            style={{ flex: 1, background: '#1a2235', border: '1px solid #3b455c', borderRadius: '4px', color: '#c8d0e0', padding: '3px 4px', fontSize: '0.73rem' }}>
            <option value=''>— choose preset —</option>
            {allPresetNames.map(n => (
              <option key={n} value={n}>{userPresets[n] ? '★ ' : ''}{n}</option>
            ))}
          </select>
          <button type="button"
            disabled={!selectedPreset}
            onClick={() => loadPreset(selectedPreset)}
            style={{ background: '#253545', border: '1px solid #3b5c6c', borderRadius: '4px', color: '#80d8ff', padding: '3px 8px', cursor: 'pointer', fontSize: '0.73rem', opacity: selectedPreset ? 1 : 0.45 }}>
            Load
          </button>
          {selectedPreset && userPresets[selectedPreset] && (
            <button type="button"
              onClick={() => deletePreset(selectedPreset)}
              style={{ background: '#3a1520', border: '1px solid #6c3b3b', borderRadius: '4px', color: '#ff8080', padding: '3px 7px', cursor: 'pointer', fontSize: '0.73rem' }}>
              ✕
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
          <input
            type="text" placeholder="preset name..."
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && savePreset()}
            style={{ flex: 1, background: '#1a2235', border: '1px solid #3b455c', borderRadius: '4px', color: '#c8d0e0', padding: '3px 6px', fontSize: '0.73rem', outline: 'none' }} />
          <button type="button"
            disabled={!presetName.trim()}
            onClick={savePreset}
            style={{ background: '#253545', border: '1px solid #3b6c4a', borderRadius: '4px', color: '#80ffb0', padding: '3px 8px', cursor: 'pointer', fontSize: '0.73rem', opacity: presetName.trim() ? 1 : 0.45 }}>
            Save
          </button>
        </div>

        {/* Reset */}
        <div style={{ marginTop: '2px', display: 'flex', gap: '6px' }}>
          <button type="button"
            onClick={() => setSp({ ...DEFAULT_SP })}
            style={{ flex: 1, background: '#252f45', border: '1px solid #3b455c', borderRadius: '5px', color: '#c8d0e0', padding: '5px 0', cursor: 'pointer', fontSize: '0.73rem' }}>
            ↺ Reset
          </button>
        </div>

        {/* Post FX */}
        <div style={S.sec}>Post FX — Bloom</div>
        <div style={S.row}>{lbl('Bloom Strength', (sp.fxBloom ?? 0).toFixed(2))}
          <input type="range" style={S.input} min={0} max={2} step={0.02}
            value={sp.fxBloom ?? 0} onChange={e => upd('fxBloom', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Bloom Radius', (sp.fxBloomRadius ?? 0.5).toFixed(2))}
          <input type="range" style={S.input} min={0} max={1} step={0.01}
            value={sp.fxBloomRadius ?? 0.5} onChange={e => upd('fxBloomRadius', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Bloom Threshold', (sp.fxBloomThreshold ?? 0.1).toFixed(2))}
          <input type="range" style={S.input} min={0} max={1} step={0.01}
            value={sp.fxBloomThreshold ?? 0.1} onChange={e => upd('fxBloomThreshold', Number(e.target.value))} /></div>

        <div style={S.sec}>Post FX — Color</div>
        <div style={S.row}>{lbl('Brightness', (sp.fxBrightness ?? 0).toFixed(2))}
          <input type="range" style={S.input} min={-0.5} max={0.5} step={0.01}
            value={sp.fxBrightness ?? 0} onChange={e => upd('fxBrightness', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Contrast', (sp.fxContrast ?? 1).toFixed(2))}
          <input type="range" style={S.input} min={0.5} max={2.5} step={0.02}
            value={sp.fxContrast ?? 1} onChange={e => upd('fxContrast', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Saturation', (sp.fxSaturation ?? 1).toFixed(2))}
          <input type="range" style={S.input} min={0} max={2.5} step={0.02}
            value={sp.fxSaturation ?? 1} onChange={e => upd('fxSaturation', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Gamma', (sp.fxGamma ?? 1).toFixed(2))}
          <input type="range" style={S.input} min={0.3} max={2.5} step={0.02}
            value={sp.fxGamma ?? 1} onChange={e => upd('fxGamma', Number(e.target.value))} /></div>

        <div style={S.sec}>Post FX — Channels (RGB)</div>
        <div style={S.row}>{lbl('Red Multiplier', (sp.fxRedMul ?? 1).toFixed(2))}
          <input type="range" style={S.input} min={0} max={3} step={0.02}
            value={sp.fxRedMul ?? 1} onChange={e => upd('fxRedMul', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Green Multiplier', (sp.fxGreenMul ?? 1).toFixed(2))}
          <input type="range" style={S.input} min={0} max={3} step={0.02}
            value={sp.fxGreenMul ?? 1} onChange={e => upd('fxGreenMul', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Blue Multiplier', (sp.fxBlueMul ?? 1).toFixed(2))}
          <input type="range" style={S.input} min={0} max={3} step={0.02}
            value={sp.fxBlueMul ?? 1} onChange={e => upd('fxBlueMul', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Red Power', (sp.fxRedPow ?? 1).toFixed(2))}
          <input type="range" style={S.input} min={0.1} max={5} step={0.05}
            value={sp.fxRedPow ?? 1} onChange={e => upd('fxRedPow', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Green Power', (sp.fxGreenPow ?? 1).toFixed(2))}
          <input type="range" style={S.input} min={0.1} max={5} step={0.05}
            value={sp.fxGreenPow ?? 1} onChange={e => upd('fxGreenPow', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Blue Power', (sp.fxBluePow ?? 1).toFixed(2))}
          <input type="range" style={S.input} min={0.1} max={5} step={0.05}
            value={sp.fxBluePow ?? 1} onChange={e => upd('fxBluePow', Number(e.target.value))} /></div>

        <div style={S.sec}>Post FX — Flame Filter</div>
        <div style={S.row}>{lbl('Strength', (sp.fxFlameMapStr ?? 0).toFixed(2))}
          <input type="range" style={S.input} min={0} max={1} step={0.01}
            value={sp.fxFlameMapStr ?? 0} onChange={e => upd('fxFlameMapStr', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Center Pivot', (sp.fxFlameMapCenter ?? 0.15).toFixed(2))}
          <input type="range" style={S.input} min={0.01} max={1.0} step={0.01}
            value={sp.fxFlameMapCenter ?? 0.15} onChange={e => upd('fxFlameMapCenter', Number(e.target.value))} /></div>
        {colorRow('Bright Color', 'fxFlameMapBright')}
        {colorRow('Dark Color', 'fxFlameMapDark')}

        <div style={S.sec}>Post FX — Star Glow</div>
        <div style={S.row}>{lbl('Strength', (sp.fxStarStrength ?? 0).toFixed(2))}
          <input type="range" style={S.input} min={0} max={1} step={0.01}
            value={sp.fxStarStrength ?? 0} onChange={e => upd('fxStarStrength', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Rays', String(Math.round(sp.fxStarRays ?? 4)))}
          <input type="range" style={S.input} min={2} max={8} step={1}
            value={sp.fxStarRays ?? 4} onChange={e => upd('fxStarRays', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Angle', `${Math.round(sp.fxStarAngle ?? 45)}°`)}
          <input type="range" style={S.input} min={0} max={180} step={1}
            value={sp.fxStarAngle ?? 45} onChange={e => upd('fxStarAngle', Number(e.target.value))} /></div>
        <div style={S.row}>{lbl('Streak Length', (sp.fxStarLength ?? 0.4).toFixed(2))}
          <input type="range" style={S.input} min={0.02} max={1} step={0.01}
            value={sp.fxStarLength ?? 0.4} onChange={e => upd('fxStarLength', Number(e.target.value))} /></div>

        <div style={S.sec}>Post FX — Vignette</div>
        <div style={S.row}>{lbl('Vignette', (sp.fxVignette ?? 0).toFixed(2))}
          <input type="range" style={S.input} min={0} max={1} step={0.01}
            value={sp.fxVignette ?? 0} onChange={e => upd('fxVignette', Number(e.target.value))} /></div>

        {/* --- Export Section --- */}
        <div style={S.sec}>Export</div>
        {(onSendToShape || onSendToPaint) && (
              <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={{ fontSize: '0.68rem', color: '#4a5880', marginBottom: '2px' }}>Send still to…</div>
                {onSendToShape && (
                  <button type="button" disabled={isExporting} onClick={async () => {
                    setIsExporting(true);
                    const urls = await exportApiRef.current(1, exportRes, exportFps, setExportProg);
                    setIsExporting(false);
                    if (urls[0]) onSendToShape(urls[0]);
                  }} style={{ ...S.input, background: '#5a3fc0', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px', opacity: isExporting ? 0.5 : 1 }}>
                    ✨ Add to Shape tab
                  </button>
                )}
                {onSendSequenceToShape && (
                  <button type="button" disabled={isExporting} onClick={async () => {
                    setIsExporting(true);
                    const urls = await exportApiRef.current(exportFrames, exportRes, exportFps, setExportProg);
                    setIsExporting(false);
                    if (urls.length) onSendSequenceToShape(urls, exportFps);
                  }} style={{ ...S.input, background: '#5a3fc0', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px', opacity: isExporting ? 0.5 : 1 }}>
                    🎞 Send Loop to Shape
                  </button>
                )}
                {onSendToPaint && (
                  <button type="button" disabled={isExporting} onClick={async () => {
                    setIsExporting(true);
                    const urls = await exportApiRef.current(1, exportRes, exportFps, setExportProg);
                    setIsExporting(false);
                    if (urls[0]) onSendToPaint(urls[0]);
                  }} style={{ ...S.input, background: '#3a7fd4', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px', opacity: isExporting ? 0.5 : 1 }}>
                    🎨 Send to Paint tab
                  </button>
                )}
              </div>
        )}
        <div style={S.row}>
          <label style={S.label}>Resolution</label>
          <select value={exportRes} onChange={e => setExportRes(Number(e.target.value))} style={{ width: '100%', background: '#1e2840', border: '1px solid #3b455c', color: '#c8d0e0', borderRadius: '4px', padding: '3px 6px', fontSize: '0.74rem' }}>
            <option value={128}>128 × 128</option>
            <option value={256}>256 × 256</option>
            <option value={512}>512 × 512</option>
          </select>
        </div>
        <div style={S.row}>{lbl('Frames', String(exportFrames))}
          <input type="range" style={S.input} min={1} max={64} step={1} value={exportFrames} onChange={e => setExportFrames(Number(e.target.value))} />
        </div>
        <div style={S.row}>
          <label style={S.label}>FPS</label>
          <select value={exportFps} onChange={e => setExportFps(Number(e.target.value))} style={{ width: '100%', background: '#1e2840', border: '1px solid #3b455c', color: '#c8d0e0', borderRadius: '4px', padding: '3px 6px', fontSize: '0.74rem' }}>
            <option value={8}>8 fps</option>
            <option value={12}>12 fps</option>
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
          <button type="button" disabled={isExporting} onClick={async () => {
            setIsExporting(true); setExportProg(0);
            const urls = await exportApiRef.current(1, exportRes, exportFps, setExportProg);
            setIsExporting(false);
            if (!urls.length) return;
            if (onAttachToEmitter) { onAttachToEmitter(urls); }
            else {
              const a = document.createElement('a');
              a.href = urls[0]; a.download = 'glow_sphere_still.png'; a.click();
            }
          }} style={{ background: '#4f6ef7', border: 'none', borderRadius: '4px', padding: '4px', color:'white', cursor: 'pointer', opacity: isExporting ? 0.5 : 1 }}>
            📷 Export Still PNG
          </button>
          <button type="button" disabled={isExporting} onClick={async () => {
            setIsExporting(true); setExportProg(0);
            const urls = await exportApiRef.current(exportFrames, exportRes, exportFps, setExportProg);
            setIsExporting(false);
            if (!urls.length) return;
            if (onExportToParticleSystem) {
              onExportToParticleSystem(urls, exportFps);
            } else {
              const zip = new JSZip();
              urls.forEach((u: string, i: number) => {
                const data = u.split(',')[1];
                zip.file(`sphere_${String(i).padStart(3, '0')}.png`, data, {base64: true});
              });
              const blob = await zip.generateAsync({type: 'blob'});
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'glow_sphere_sequence.zip';
              a.click();
            }
          }} style={{ background: '#27ae60', border: 'none', borderRadius: '4px', padding: '4px', color:'white', cursor: 'pointer', opacity: isExporting ? 0.5 : 1 }}>
            🎞 Export PNG Sequence
          </button>
          {onAttachToEmitter && (
            <button type="button" disabled={isExporting} onClick={async () => {
              setIsExporting(true); setExportProg(0);
              const urls = await exportApiRef.current(1, exportRes, exportFps, setExportProg);
              setIsExporting(false);
              if (urls.length && onAttachToEmitter) onAttachToEmitter(urls);
            }} style={{ background: '#e67e22', border: 'none', borderRadius: '4px', padding: '4px', color:'white', cursor: 'pointer', opacity: isExporting ? 0.5 : 1 }}>
              Use Still ↗
            </button>
          )}
          {onExportToParticleSystem && (
            <button type="button" disabled={isExporting} onClick={async () => {
              setIsExporting(true); setExportProg(0);
              const urls = await exportApiRef.current(exportFrames, exportRes, exportFps, setExportProg);
              setIsExporting(false);
              if (urls.length && onExportToParticleSystem) onExportToParticleSystem(urls, exportFps);
            }} style={{ background: '#27ae60', border: 'none', borderRadius: '4px', padding: '4px', color:'white', cursor: 'pointer', opacity: isExporting ? 0.5 : 1 }}>
              Use Anim ↗
            </button>
          )}
        </div>
        {isExporting && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '0.72rem', color: '#8a93a2', marginBottom: '3px' }}>Rendering… {exportProg.toFixed(0)}%</div>
            <div style={{ height: '4px', background: '#2a3450', borderRadius: '2px' }}>
              <div style={{ height: '100%', width: `${exportProg}%`, background: '#4f6ef7', borderRadius: '2px' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GlowSphereGenerator;
