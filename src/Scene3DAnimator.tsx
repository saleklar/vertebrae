import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';
import { 
  AnimatorObject, 
  AnimatorLightSettings, 
  AnimatorRenderSettings,
  AnimatorEffectsSettings,
  AnimatorAnimationSettings,
  RenderProgress 
} from './Animator3DTypes';

const StarGlintShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    threshold: { value: 0.72 },
    centerThreshold: { value: 0.68 },
    intensity: { value: 0.8 },
    spread: { value: 1.0 },
    rayLength: { value: 1.0 },
    rayBoost: { value: 1.0 },
    horizontalBlur: { value: 1.0 },
    verticalBlur: { value: 1.0 },
    glowBlur: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision mediump float;
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float threshold;
    uniform float centerThreshold;
    uniform float intensity;
    uniform float spread;
    uniform float rayLength;
    uniform float rayBoost;
    uniform float horizontalBlur;
    uniform float verticalBlur;
    uniform float glowBlur;
    varying vec2 vUv;

    float getLum(vec3 color) {
      return dot(color, vec3(0.2126, 0.7152, 0.0722));
    }

    void main() {
      vec4 baseSample = texture2D(tDiffuse, vUv);
      vec3 base = baseSample.rgb;
      
      vec2 pixel = vec2(1.0 / resolution.x, 1.0 / resolution.y);
      
      // Sample horizontal blur with smooth falloff
      float hGlow = 0.0;
      float hRange = 60.0 * (1.0 + horizontalBlur * 3.0);
      for (float x = -3.0; x <= 3.0; x += 0.05) {
        vec3 sampleColor = texture2D(tDiffuse, clamp(vUv + vec2(x * hRange * pixel.x, 0.0), 0.001, 0.999)).rgb;
        float lum = getLum(sampleColor);
        float dist = abs(x) / 3.0;
        float falloff = exp(-dist * dist * 3.0);
        hGlow += max(0.0, lum - centerThreshold) * falloff + lum * falloff * 0.1;
      }
      hGlow /= 120.0;
      
      // Sample vertical blur with smooth falloff
      float vGlow = 0.0;
      float vRange = 60.0 * (1.0 + verticalBlur * 3.0);
      for (float y = -3.0; y <= 3.0; y += 0.05) {
        vec3 sampleColor = texture2D(tDiffuse, clamp(vUv + vec2(0.0, y * vRange * pixel.y), 0.001, 0.999)).rgb;
        float lum = getLum(sampleColor);
        float dist = abs(y) / 3.0;
        float falloff = exp(-dist * dist * 3.0);
        vGlow += max(0.0, lum - centerThreshold) * falloff + lum * falloff * 0.1;
      }
      vGlow /= 120.0;
      
      // Current pixel brightness
      float currentLum = getLum(base);
      
      // Smooth gradient from center outward
      float starGlow = currentLum * 0.8;
      starGlow += (hGlow + vGlow) * 0.5;
      
      // Apply soft blur to glow by blending with neighborhood
      if (glowBlur > 0.01) {
        float neighborhood = 0.0;
        float blurPx = glowBlur / resolution.x;
        
        // Sample 8 neighbors
        neighborhood += getLum(texture2D(tDiffuse, vUv + vec2(-blurPx, -blurPx)).rgb);
        neighborhood += getLum(texture2D(tDiffuse, vUv + vec2(0.0, -blurPx)).rgb);
        neighborhood += getLum(texture2D(tDiffuse, vUv + vec2(blurPx, -blurPx)).rgb);
        neighborhood += getLum(texture2D(tDiffuse, vUv + vec2(-blurPx, 0.0)).rgb);
        neighborhood += getLum(texture2D(tDiffuse, vUv + vec2(blurPx, 0.0)).rgb);
        neighborhood += getLum(texture2D(tDiffuse, vUv + vec2(-blurPx, blurPx)).rgb);
        neighborhood += getLum(texture2D(tDiffuse, vUv + vec2(0.0, blurPx)).rgb);
        neighborhood += getLum(texture2D(tDiffuse, vUv + vec2(blurPx, blurPx)).rgb);
        neighborhood /= 8.0;
        
        // Blend glow with neighborhood for softness
        float blurFactor = clamp(glowBlur / 10.0, 0.0, 1.0);
        starGlow = mix(starGlow, neighborhood, blurFactor * 0.4);
      }
      
      vec3 starColor = vec3(1.0, 0.97, 0.88);
      vec3 glowAdd = starColor * starGlow * intensity * (0.5 + rayBoost * 1.2);
      vec3 color = base + glowAdd;
      
      gl_FragColor = vec4(color, baseSample.a);
    }
  `,
};

const ColorCorrectionShader = {
  uniforms: {
    tDiffuse: { value: null },
    brightness: { value: 1.0 },
    contrast: { value: 1.0 },
    saturation: { value: 1.0 },
    hue: { value: 0.0 }, // in radians
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float brightness;
    uniform float contrast;
    uniform float saturation;
    uniform float hue;
    varying vec2 vUv;

    // RGB to HSV
    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    // HSV to RGB
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      vec4 texColor = texture2D(tDiffuse, vUv);
      vec3 color = texColor.rgb;

      // Brightness
      color = color * brightness;

      // Contrast
      color = (color - 0.5) * contrast + 0.5;

      // Hue and Saturation
      vec3 hsv = rgb2hsv(color);
      hsv.x = mod(hsv.x + hue / 6.28318530718, 1.0);
      hsv.y = clamp(hsv.y * saturation, 0.0, 1.0);
      color = hsv2rgb(hsv);

      gl_FragColor = vec4(color, texColor.a);
    }
  `,
};

type Scene3DAnimatorProps = {
  animatorObject: AnimatorObject;
  lighting: AnimatorLightSettings;
  animation: AnimatorAnimationSettings;
  renderSettings: AnimatorRenderSettings;
  effects: AnimatorEffectsSettings;
  backgroundColor: string;
  isRendering: boolean;
  isPreviewPlaying: boolean;
  previewResetToken: number;
  onRenderProgress?: (progress: RenderProgress) => void;
  onRenderComplete?: (frames: Blob[]) => void;
  onSnapshotReady?: (blob: Blob) => void;
  disablePostProcessing?: boolean;
};

export function Scene3DAnimator({
  animatorObject,
  lighting,
  animation,
  renderSettings,
  effects,
  backgroundColor,
  isRendering,
  isPreviewPlaying,
  previewResetToken,
  onRenderProgress,
  onRenderComplete,
  onSnapshotReady,
  disablePostProcessing,
}: Scene3DAnimatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const helperSceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const objectRef = useRef<THREE.Mesh | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const lensPassRef = useRef<ShaderPass | null>(null);
  const starGlintPassRef = useRef<ShaderPass | null>(null);
  const blurGlintPassRef = useRef<ShaderPass | null>(null);
  const colorCorrectionPassRef = useRef<ShaderPass | null>(null);
  const sparklesRef = useRef<THREE.Points | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const renderRequestRef = useRef<{
    isRendering: boolean;
    currentFrame: number;
    frames: Blob[];
  }>({
    isRendering: false,
    currentFrame: 0,
    frames: [],
  });

  const animationRef = useRef(animation);
  const effectsRef = useRef(effects);
  const previewPlayingRef = useRef(isPreviewPlaying);
  const previewStateRef = useRef<{
    startTimeMs: number;
    baseCaptured: boolean;
    baseRotation: THREE.Euler;
    basePosition: THREE.Vector3;
    baseScale: THREE.Vector3;
    baseCameraPosition: THREE.Vector3;
  }>({
    startTimeMs: 0,
    baseCaptured: false,
    baseRotation: new THREE.Euler(),
    basePosition: new THREE.Vector3(),
    baseScale: new THREE.Vector3(1, 1, 1),
    baseCameraPosition: new THREE.Vector3(),
  });

  // Camera control state
  const cameraControlRef = useRef({
    isRotating: false,
    isPanning: false,
    lastX: 0,
    lastY: 0,
    theta: 0, // horizontal angle
    phi: Math.PI / 4, // vertical angle
    radius: 500, // distance from target
    targetX: 0,
    targetY: 0,
    targetZ: 0,
  });

  const renderSceneFrame = (includeHelpers: boolean, usePostProcessing: boolean = true) => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;

    if (usePostProcessing && composerRef.current) {
      try {
        composerRef.current.render();
      } catch (error) {
        console.warn('Post-processing failed, falling back to base renderer:', error);
        composerRef.current = null;
        bloomPassRef.current = null;
        lensPassRef.current = null;
        starGlintPassRef.current = null;
        blurGlintPassRef.current = null;
        renderer.render(scene, camera);
      }
    } else {
      renderer.render(scene, camera);
    }

    if (includeHelpers && helperSceneRef.current) {
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(helperSceneRef.current, camera);
      renderer.autoClear = previousAutoClear;
    }
  };

  const rebuildPostProcessing = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    composerRef.current = null;
    bloomPassRef.current = null;
    lensPassRef.current = null;
    starGlintPassRef.current = null;
    blurGlintPassRef.current = null;

    if (disablePostProcessing) {
      return;
    }

    const { bloom, lens, sparkles, ambientOcclusion } = effectsRef.current;
    const useStarGlint = sparkles.shinyGlints;
    const useColorCorrection = effectsRef.current.colorCorrection?.enabled;
    const useAO = ambientOcclusion?.enabled;
    if (!bloom.enabled && !lens.enabled && !useStarGlint && !useColorCorrection && !useAO) {
      return;
    }

    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    if (ambientOcclusion?.enabled) {
      const size = renderer.getSize(new THREE.Vector2());
      const ssaoPass = new SSAOPass(scene, camera, size.x, size.y);
      ssaoPass.kernelRadius = ambientOcclusion.radius || 16;
      ssaoPass.minDistance = 0.005;
      ssaoPass.maxDistance = 0.1;
      composer.addPass(ssaoPass);
    }

    if (bloom.enabled) {
      const rendererSize = renderer.getSize(new THREE.Vector2());
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(rendererSize.x, rendererSize.y),
        bloom.intensity,
        bloom.radius,
        bloom.threshold
      );
      bloomPass.strength = bloom.intensity;
      bloomPass.radius = bloom.radius;
      bloomPass.threshold = bloom.threshold;
      composer.addPass(bloomPass);
      bloomPassRef.current = bloomPass;
    }

    if (lens.enabled) {
      const lensPass = new ShaderPass(RGBShiftShader);
      lensPass.uniforms['amount'].value = lens.amount;
      composer.addPass(lensPass);
      lensPassRef.current = lensPass;
    }

    if (useStarGlint) {
      const starPass = new ShaderPass(StarGlintShader as any);
      const size = renderer.getSize(new THREE.Vector2());
      starPass.uniforms['resolution'].value.set(size.x, size.y);
      starPass.uniforms['threshold'].value = Math.max(0.2, Math.min(0.98, sparkles.glintThreshold));
      starPass.uniforms['centerThreshold'].value = Math.max(0.2, Math.min(0.98, sparkles.glintCenterThreshold));
      starPass.uniforms['intensity'].value = Math.max(0, sparkles.intensity);
      starPass.uniforms['spread'].value = Math.max(0.2, sparkles.glintSpread);
      starPass.uniforms['rayLength'].value = Math.max(0.5, sparkles.glintRayLength);
      starPass.uniforms['rayBoost'].value = Math.max(0.5, sparkles.glintRayBoost);
      starPass.uniforms['horizontalBlur'].value = Math.max(0, sparkles.glintHorizontalBlur);
      starPass.uniforms['verticalBlur'].value = Math.max(0, sparkles.glintVerticalBlur);
      starPass.uniforms['glowBlur'].value = Math.max(0, (sparkles as any).glowBlur || 0);
      composer.addPass(starPass);
      starGlintPassRef.current = starPass;
    }

    if (effectsRef.current.colorCorrection?.enabled) {
      const ccPass = new ShaderPass(ColorCorrectionShader);
      ccPass.uniforms['brightness'].value = effectsRef.current.colorCorrection.brightness;
      ccPass.uniforms['contrast'].value = effectsRef.current.colorCorrection.contrast;
      ccPass.uniforms['saturation'].value = effectsRef.current.colorCorrection.saturation;
      ccPass.uniforms['hue'].value = (effectsRef.current.colorCorrection.hue * Math.PI) / 180.0;
      composer.addPass(ccPass);
      colorCorrectionPassRef.current = ccPass;
    }

    const size = renderer.getSize(new THREE.Vector2());
    composer.setSize(size.x, size.y);
    composerRef.current = composer;
  };

  const rebuildSparkles = () => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (sparklesRef.current) {
      scene.remove(sparklesRef.current);
      sparklesRef.current.geometry.dispose();
      (sparklesRef.current.material as THREE.PointsMaterial).dispose();
      sparklesRef.current = null;
    }

    const sparkleSettings = effectsRef.current.sparkles;
    if (!sparkleSettings.enabled) return;

    const count = Math.max(10, Math.min(500, Math.round(sparkleSettings.count)));
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const radius = 120 + Math.random() * 80;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const index = i * 3;

      positions[index] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index + 1] = radius * Math.cos(phi);
      positions[index + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xfff7cf,
      size: sparkleSettings.size,
      transparent: true,
      opacity: Math.max(0, Math.min(1, sparkleSettings.intensity)),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const sparkles = new THREE.Points(geometry, material);
    scene.add(sparkles);
    sparklesRef.current = sparkles;
  };

  const updateEffectDynamics = (timeSeconds: number) => {
    if (sparklesRef.current) {
      sparklesRef.current.rotation.y += 0.0015 * effectsRef.current.sparkles.speed;
      const sparkleMaterial = sparklesRef.current.material as THREE.PointsMaterial;
      const pulse = 0.55 + 0.45 * Math.sin(timeSeconds * 3 * Math.max(0.1, effectsRef.current.sparkles.speed));
      sparkleMaterial.opacity = Math.max(0, Math.min(1.2, effectsRef.current.sparkles.intensity * pulse));
    }
  };

  const fitCameraForRender = (camera: THREE.PerspectiveCamera, object: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(8, size.length() * 0.5);

    const direction = camera.position.clone().sub(center);
    if (direction.lengthSq() < 0.0001) {
      direction.set(0, 0, 1);
    }
    direction.normalize();

    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const fitDistance = Math.max(60, radius / Math.sin(Math.max(0.2, fovRad * 0.5)) * 1.15);
    camera.position.copy(center.clone().add(direction.multiplyScalar(fitDistance)));
    camera.near = Math.max(0.1, fitDistance / 500);
    camera.far = Math.max(2000, fitDistance * 15);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  };

  const captureSnapshot = () => {
    if (!rendererRef.current) return;
    
    rendererRef.current.domElement.toBlob((blob) => {
      if (blob && onSnapshotReady) {
        onSnapshotReady(blob);
      }
    }, 'image/png', 1.0);
  };

  // Expose snapshot to parent via window
  React.useEffect(() => {
    if (containerRef.current && typeof window !== 'undefined') {
      (window as any).__captureSnapshot = captureSnapshot;
    }
  }, [onSnapshotReady]);

  // Initialize scene
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor);
    sceneRef.current = scene;

    const helperScene = new THREE.Scene();
    helperSceneRef.current = helperScene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 10000);
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ 
      antialias: renderSettings.antialias,
      preserveDrawingBuffer: true, // Important for capturing frames
      alpha: true, // Always enable alpha for proper transparency support
      premultipliedAlpha: false, // Don't premultiply alpha
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0); // Transparent clear color
    
    if (renderSettings.shadows) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer, more realistic self-shadowing 
    }
    
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Set up Studio Environment for realistic metallic reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const envScene = new RoomEnvironment();
    scene.environment = pmremGenerator.fromScene(envScene).texture;
    envScene.dispose();

    // Grid helper
    const gridHelper = new THREE.GridHelper(400, 20, 0x444444, 0x222222);
    helperScene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    // Axes helper
    const axesHelper = new THREE.AxesHelper(200);
    helperScene.add(axesHelper);
    axesHelperRef.current = axesHelper;

    // Setup lighting
    setupLighting(scene, lighting);

    // Create object
    createObject(scene, animatorObject);

    // Setup post effects
    effectsRef.current = effects;
    rebuildPostProcessing();
    rebuildSparkles();

    // Animation loop (preview)
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      if (
        previewPlayingRef.current &&
        !renderRequestRef.current.isRendering &&
        objectRef.current &&
        cameraRef.current
      ) {
        const anim = animationRef.current;
        const totalFrames = Math.max(1, anim.duration);
        const currentFrame = ((performance.now() - previewStateRef.current.startTimeMs) / 1000) * anim.fps;
        const loopedFrame = currentFrame % totalFrames;
        const progress = loopedFrame / totalFrames;

        const object = objectRef.current;
        const camera = cameraRef.current;
        const base = previewStateRef.current;

        object.rotation.x = base.baseRotation.x + (anim.rotation.x * Math.PI / 180) * loopedFrame;
        object.rotation.y = base.baseRotation.y + (anim.rotation.y * Math.PI / 180) * loopedFrame;
        object.rotation.z = base.baseRotation.z + (anim.rotation.z * Math.PI / 180) * loopedFrame;

        object.position.x = base.basePosition.x + anim.position.x * loopedFrame;
        object.position.y = base.basePosition.y + anim.position.y * loopedFrame;
        object.position.z = base.basePosition.z + anim.position.z * loopedFrame;

        object.scale.x = base.baseScale.x * (1 + (anim.scale.x - 1) * progress);
        object.scale.y = base.baseScale.y * (1 + (anim.scale.y - 1) * progress);
        object.scale.z = base.baseScale.z * (1 + (anim.scale.z - 1) * progress);

        if (anim.cameraPath === 'orbit') {
          const ctrl = cameraControlRef.current;
          const angle = (anim.cameraStartAngle + anim.cameraOrbitSpeed * loopedFrame) * Math.PI / 180;
          const radius = Math.sqrt(
            (base.baseCameraPosition.x - ctrl.targetX) ** 2 +
            (base.baseCameraPosition.y - ctrl.targetY) ** 2 +
            (base.baseCameraPosition.z - ctrl.targetZ) ** 2
          );
          camera.position.x = ctrl.targetX + Math.cos(angle) * radius;
          camera.position.z = ctrl.targetZ + Math.sin(angle) * radius;
          camera.lookAt(ctrl.targetX, ctrl.targetY, ctrl.targetZ);
        }
      }
      
      updateEffectDynamics(performance.now() / 1000);

      if (renderer && scene && camera) {
        renderSceneFrame(true, true);
      }
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composerRef.current) {
        composerRef.current.setSize(w, h);
      }
      if (starGlintPassRef.current) {
        starGlintPassRef.current.uniforms['resolution'].value.set(w, h);
      }
    };
    window.addEventListener('resize', handleResize);

    // Mouse controls for camera
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) { // Left button - rotate
        cameraControlRef.current.isRotating = true;
      } else if (e.button === 2) { // Right button - pan
        cameraControlRef.current.isPanning = true;
      }
      cameraControlRef.current.lastX = e.clientX;
      cameraControlRef.current.lastY = e.clientY;
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      const ctrl = cameraControlRef.current;
      const deltaX = e.clientX - ctrl.lastX;
      const deltaY = e.clientY - ctrl.lastY;

      if (ctrl.isRotating) {
        // Orbit camera
        ctrl.theta -= deltaX * 0.005;
        ctrl.phi -= deltaY * 0.005;
        ctrl.phi = Math.max(0.1, Math.min(Math.PI - 0.1, ctrl.phi));
        updateCameraPosition();
      } else if (ctrl.isPanning) {
        // Pan camera
        const panSpeed = 0.5;
        ctrl.targetX -= deltaX * panSpeed;
        ctrl.targetY += deltaY * panSpeed;
        updateCameraPosition();
      }

      ctrl.lastX = e.clientX;
      ctrl.lastY = e.clientY;
    };

    const handleMouseUp = () => {
      cameraControlRef.current.isRotating = false;
      cameraControlRef.current.isPanning = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctrl = cameraControlRef.current;
      ctrl.radius += e.deltaY * 0.5;
      ctrl.radius = Math.max(100, Math.min(2000, ctrl.radius));
      updateCameraPosition();
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const updateCameraPosition = () => {
      if (!cameraRef.current) return;
      const ctrl = cameraControlRef.current;
      
      // Calculate camera position in spherical coordinates
      const x = ctrl.radius * Math.sin(ctrl.phi) * Math.cos(ctrl.theta);
      const y = ctrl.radius * Math.cos(ctrl.phi);
      const z = ctrl.radius * Math.sin(ctrl.phi) * Math.sin(ctrl.theta);
      
      cameraRef.current.position.set(
        x + ctrl.targetX,
        y + ctrl.targetY,
        z + ctrl.targetZ
      );
      cameraRef.current.lookAt(ctrl.targetX, ctrl.targetY, ctrl.targetZ);
    };

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mouseup', handleMouseUp); // Catch mouse up outside container

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (container) {
        container.removeEventListener('mousedown', handleMouseDown);
        container.removeEventListener('mousemove', handleMouseMove);
        container.removeEventListener('mouseup', handleMouseUp);
        container.removeEventListener('wheel', handleWheel);
        container.removeEventListener('contextmenu', handleContextMenu);
      }
      window.removeEventListener('mouseup', handleMouseUp);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (sparklesRef.current) {
        scene.remove(sparklesRef.current);
        sparklesRef.current.geometry.dispose();
        (sparklesRef.current.material as THREE.PointsMaterial).dispose();
        sparklesRef.current = null;
      }
      if (gridHelperRef.current && helperSceneRef.current) {
        helperSceneRef.current.remove(gridHelperRef.current);
      }
      if (axesHelperRef.current && helperSceneRef.current) {
        helperSceneRef.current.remove(axesHelperRef.current);
      }
      helperSceneRef.current = null;
      composerRef.current = null;
      bloomPassRef.current = null;
      lensPassRef.current = null;
      starGlintPassRef.current = null;
      if (renderer) {
        container.removeChild(renderer.domElement);
        renderer.dispose();
      }
    };
  }, []);

  useEffect(() => {
    animationRef.current = animation;
  }, [animation]);

  useEffect(() => {
    effectsRef.current = effects;
    rebuildPostProcessing();
    rebuildSparkles();
  }, [effects]);

  useEffect(() => {
    previewPlayingRef.current = isPreviewPlaying;

    if (!objectRef.current || !cameraRef.current) return;

    if (isPreviewPlaying) {
      previewStateRef.current.baseRotation.copy(objectRef.current.rotation);
      previewStateRef.current.basePosition.copy(objectRef.current.position);
      previewStateRef.current.baseScale.copy(objectRef.current.scale);
      previewStateRef.current.baseCameraPosition.copy(cameraRef.current.position);
      previewStateRef.current.startTimeMs = performance.now();
      previewStateRef.current.baseCaptured = true;
    }
  }, [isPreviewPlaying]);

  useEffect(() => {
    if (!objectRef.current || !cameraRef.current) return;

    const base = previewStateRef.current;
    base.startTimeMs = performance.now();

    if (base.baseCaptured) {
      objectRef.current.rotation.copy(base.baseRotation);
      objectRef.current.position.copy(base.basePosition);
      objectRef.current.scale.copy(base.baseScale);
      cameraRef.current.position.copy(base.baseCameraPosition);
      cameraRef.current.lookAt(
        cameraControlRef.current.targetX,
        cameraControlRef.current.targetY,
        cameraControlRef.current.targetZ
      );
    }
  }, [previewResetToken]);

  // Update background color
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(backgroundColor);
    }
  }, [backgroundColor]);

  // Update object when settings change
  useEffect(() => {
    if (sceneRef.current && objectRef.current) {
      const previousObject = objectRef.current;
      const previousCamera = cameraRef.current;
      if (previousObject && previousCamera && previewPlayingRef.current) {
        previewStateRef.current.baseRotation.copy(previousObject.rotation);
        previewStateRef.current.basePosition.copy(previousObject.position);
        previewStateRef.current.baseScale.copy(previousObject.scale);
        previewStateRef.current.baseCameraPosition.copy(previousCamera.position);
      }

      sceneRef.current.remove(objectRef.current);
      objectRef.current.geometry.dispose();
      if (Array.isArray(objectRef.current.material)) {
        objectRef.current.material.forEach(m => m.dispose());
      } else {
        objectRef.current.material.dispose();
      }
      createObject(sceneRef.current, animatorObject);
    }
  }, [animatorObject]);

  // Update lighting when settings change
  useEffect(() => {
    if (sceneRef.current) {
      // Remove old lights
      const lights = sceneRef.current.children.filter(
        child => child instanceof THREE.Light
      );
      lights.forEach(light => sceneRef.current!.remove(light));
      
      // Add new lights
      setupLighting(sceneRef.current, lighting);
    }
  }, [lighting]);

  // Handle rendering
  useEffect(() => {
    if (isRendering && !renderRequestRef.current.isRendering) {
      startRendering();
    }
  }, [isRendering]);

  const setupLighting = (scene: THREE.Scene, lightSettings: AnimatorLightSettings) => {
    // Ambient light
    const ambient = new THREE.AmbientLight(
      lightSettings.ambientColor, 
      lightSettings.ambientIntensity
    );
    scene.add(ambient);

    // Directional lights
    lightSettings.directionalLights.forEach(lightData => {
      const light = new THREE.DirectionalLight(lightData.color, lightData.intensity);
      light.position.set(lightData.position.x, lightData.position.y, lightData.position.z);
      light.castShadow = lightData.castShadow;
      if (lightData.castShadow) {
        light.shadow.mapSize.width = 2048;
        light.shadow.mapSize.height = 2048;
        light.shadow.camera.near = 0.5;
        light.shadow.camera.far = 1000;
        // Expand frustum to cover big geometries (Coin max radius is ~100-200)
        light.shadow.camera.left = -150;
        light.shadow.camera.right = 150;
        light.shadow.camera.top = 150;
        light.shadow.camera.bottom = -150;
        // Add a slight bias to prevent self-shadowing acne
        light.shadow.bias = -0.0001;
        light.shadow.normalBias = 0.05;
      }
      scene.add(light);
    });

    // Point lights
    lightSettings.pointLights.forEach(lightData => {
      const light = new THREE.PointLight(
        lightData.color, 
        lightData.intensity, 
        lightData.distance
      );
      light.position.set(lightData.position.x, lightData.position.y, lightData.position.z);
      light.castShadow = lightData.castShadow;
      if (lightData.castShadow) {
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;
        light.shadow.bias = -0.0005;
      }
      scene.add(light);
    });
  };

  const createObject = (scene: THREE.Scene, objData: AnimatorObject) => {
    let geometry: THREE.BufferGeometry;
    const params = objData.geometryParams;

    const applyCylinderEdgeBevel = (
      targetGeometry: THREE.BufferGeometry,
      radiusTop: number,
      radiusBottom: number,
      height: number,
      edgeBevel: number
    ) => {
      const bevel = Math.max(0, Math.min(0.25, edgeBevel));
      if (bevel <= 0) return;

      const position = targetGeometry.getAttribute('position');
      if (!position) return;

      const minRadius = Math.max(0.001, Math.min(radiusTop, radiusBottom));
      const bevelHeight = Math.max(0.001, height * bevel);
      const bevelInset = Math.min(minRadius * 0.6, minRadius * bevel * 0.9);
      const halfHeight = height / 2;

      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);

        const radial = Math.sqrt(x * x + z * z);
        if (radial <= 0.00001) continue;

        const distToTop = Math.abs(halfHeight - y);
        const distToBottom = Math.abs(y + halfHeight);
        const edgeDist = Math.min(distToTop, distToBottom);
        if (edgeDist > bevelHeight) continue;

        const t = 1 - edgeDist / bevelHeight;
        const smooth = t * t * (3 - 2 * t);
        const inset = bevelInset * smooth;
        const targetRadius = Math.max(0.00001, radial - inset);
        const scale = targetRadius / radial;

        position.setX(i, x * scale);
        position.setZ(i, z * scale);
      }

      position.needsUpdate = true;
      targetGeometry.computeVertexNormals();
    };

    switch (objData.geometry) {
case 'coin':
  {
    const radius = params.radiusTop ?? 50;
    const fw = params.coinFrameWidth ?? 10;
    const fh = params.coinFrameHeight ?? 20;
    const size = params.coinInnerShapeSize ?? 20;
    const depth = params.coinInnerShapeDepth ?? 10;
    const pts = params.coinInnerShapePoints ?? 5;
    const type = params.coinInnerShapePattern ?? 'star';
    
    const geometries = [];
    const plateThickness = Math.max(1, depth * 0.5);
    const plateGeo = new THREE.CylinderGeometry(radius - fw/2, radius - fw/2, plateThickness, 64);
    plateGeo.rotateX(Math.PI / 2);
    geometries.push(plateGeo.toNonIndexed());

    const rimShape = new THREE.Shape();
    const ridgeCount = params.coinRidgeCount ?? 0;
    const ridgeDepth = params.coinRidgeDepth ?? 1.0;
    
    if (ridgeCount > 0) {
        const segments = Math.max(128, ridgeCount * 8);
        for (let i = 0; i < segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const ridgePhase = (i / segments) * ridgeCount * Math.PI * 2;
            // Create ridges by indenting the outer radius
            const wave = (Math.sin(ridgePhase) + 1) * 0.5; // 0 to 1
            const r = radius - wave * ridgeDepth;
            if (i === 0) rimShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else rimShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        // complete loop
        const r0 = radius - ((Math.sin(0) + 1) * 0.5) * ridgeDepth;
        rimShape.lineTo(Math.cos(0) * r0, Math.sin(0) * r0);
    } else {
        rimShape.absarc(0, 0, radius, 0, Math.PI * 2, false);
    }

    const rimHole = new THREE.Path();
    rimHole.absarc(0, 0, radius - fw, 0, Math.PI * 2, true);
    rimShape.holes.push(rimHole);
    const rimExtrude = new THREE.ExtrudeGeometry(rimShape, {
        depth: fh,
        bevelEnabled: (params.edgeBevel ?? 0) > 0,
        bevelThickness: (params.edgeBevel ?? 0) * radius,
        bevelSize: (params.edgeBevel ?? 0) * radius,
        bevelSegments: 4,
        curveSegments: 64
    });
    rimExtrude.translate(0, 0, -fh/2);
    const rimGeo = rimExtrude.toNonIndexed();
    rimGeo.groups.forEach(g => {
        if (g.materialIndex === 0) g.materialIndex = 1;
        else if (g.materialIndex === 1) g.materialIndex = 0;
    });
    geometries.push(rimGeo);

    if (type !== 'none') {
        const shape = new THREE.Shape();
        if (type === 'circle') {
            shape.absarc(0, 0, size, 0, Math.PI*2, false);
        } else if (type === 'polygon' || type === 'star') {
            const points = [];
            const ptsCount = type === 'polygon' ? pts : pts * 2;
            for(let i=0; i<ptsCount; i++) {
                const a = (i/ptsCount)*Math.PI*2 - Math.PI/2;
                const r = (type === 'polygon' || i%2===0) ? size : size*0.4;
                points.push({x: Math.cos(a)*r, y: Math.sin(a)*r});
            }
            const roundness = params.coinInnerShapeRoundness ?? 0;
            if (roundness <= 0.01) {
                points.forEach((p, i) => {
                    if (i === 0) shape.moveTo(p.x, p.y);
                    else shape.lineTo(p.x, p.y);
                });
            } else {
                let firstStartX = 0, firstStartY = 0;
                for(let i=0; i<points.length; i++) {
                    const prev = points[(i - 1 + points.length) % points.length];
                    const curr = points[i];
                    const next = points[(i + 1) % points.length];
                    
                    const dx1 = prev.x - curr.x;
                    const dy1 = prev.y - curr.y;
                    const len1 = Math.sqrt(dx1*dx1 + dy1*dy1);
                    
                    const dx2 = next.x - curr.x;
                    const dy2 = next.y - curr.y;
                    const len2 = Math.sqrt(dx2*dx2 + dy2*dy2);
                    
                    const d = Math.min(len1, len2) * 0.5 * roundness; // clamped roundness
                    
                    const startX = curr.x + (dx1 / len1) * d;
                    const startY = curr.y + (dy1 / len1) * d;
                    const endX = curr.x + (dx2 / len2) * d;
                    const endY = curr.y + (dy2 / len2) * d;
                    
                    if (i === 0) {
                        firstStartX = startX;
                        firstStartY = startY;
                        shape.moveTo(startX, startY);
                        shape.quadraticCurveTo(curr.x, curr.y, endX, endY);
                    } else {
                        shape.lineTo(startX, startY);
                        shape.quadraticCurveTo(curr.x, curr.y, endX, endY);
                    }
                }
                shape.lineTo(firstStartX, firstStartY);
            }
        }
        const shapeGeo = new THREE.ExtrudeGeometry(shape, {
            depth: depth,
            bevelEnabled: (params.edgeBevel ?? 0) > 0,
            bevelThickness: (params.edgeBevel ?? 0) * size,
            bevelSize: (params.edgeBevel ?? 0) * size,
            bevelSegments: 4
        });
        shapeGeo.translate(0, 0, -depth/2);
        const sGeo = shapeGeo.toNonIndexed();
        sGeo.groups.forEach(g => {
            if (g.materialIndex === 0) g.materialIndex = 1;
            else if (g.materialIndex === 1) g.materialIndex = 0;
        });
        geometries.push(sGeo);
    }

    geometries.forEach(g => {
        g.deleteAttribute('uv');
        g.deleteAttribute('normal');
    });
    geometry = BufferGeometryUtils.mergeGeometries(geometries, false);
    
    let offset = 0;
    geometry.clearGroups();
    geometries.forEach(g => {
        if (g.groups) {
            g.groups.forEach(group => {
                geometry.addGroup(offset + group.start, group.count, group.materialIndex);
            });
        }
        offset += g.attributes.position.count;
    });

    geometry.computeVertexNormals();
  }
  break;

      case 'cylinder':
        {
          const radiusTop = params.radiusTop ?? 50;
          const radiusBottom = params.radiusBottom ?? 50;
          const height = params.height ?? 100;
          const radialSegments = params.radialSegments ?? 32;

          geometry = new THREE.CylinderGeometry(
            radiusTop,
            radiusBottom,
            height,
            radialSegments,
            8
          );
          applyCylinderEdgeBevel(geometry, radiusTop, radiusBottom, height, params.edgeBevel ?? 0);
        }
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(
          params.radius ?? 50,
          params.widthSegments ?? 32,
          params.heightSegments ?? 32
        );
        break;
      case 'cube':
        if ((params.edgeBevel ?? 0) > 0) {
          const size = Math.max(params.width ?? 100, params.height ?? 100, params.depth ?? 100);
          const radius = size * (params.edgeBevel ?? 0.05);
          geometry = new RoundedBoxGeometry(
            params.width ?? 100,
            params.height ?? 100,
            params.depth ?? 100,
            10, // segments
            radius
          );
        } else {
          geometry = new THREE.BoxGeometry(
            params.width ?? 100,
            params.height ?? 100,
            params.depth ?? 100
          );
        }
        break;
      case 'plane':
        geometry = new THREE.PlaneGeometry(
          params.width ?? 100,
          params.height ?? 100
        );
        break;
      case 'torus':
        geometry = new THREE.TorusGeometry(
          params.radius ?? 50,
          params.tubeRadius ?? 20,
          params.radialSegments ?? 16,
          params.tubularSegments ?? 100
        );
        break;
      default:
        geometry = new THREE.CylinderGeometry(50, 50, 100, 32);
    }

    // Create cap material (face/top/bottom)
    const capMaterialOptions: THREE.MeshPhysicalMaterialParameters = {
      color: objData.material.color,
      metalness: Math.max(0.001, objData.material.metalness),
      roughness: objData.material.roughness,
      emissive: objData.material.emissive,
      emissiveIntensity: objData.material.emissiveIntensity,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      reflectivity: 1.0,
    };

    // Load textures if available
    const textureLoader = new THREE.TextureLoader();
    const applyUvProjection = (
      texture: THREE.Texture,
      projection: {
        scaleX: number;
        scaleY: number;
        offsetX: number;
        offsetY: number;
        rotationDeg: number;
      }
    ) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(projection.scaleX, projection.scaleY);
      texture.offset.set(projection.offsetX, projection.offsetY);
      texture.center.set(0.5, 0.5);
      texture.rotation = (projection.rotationDeg * Math.PI) / 180;
    };

    const capProjection = {
      scaleX: objData.material.uvScaleX,
      scaleY: objData.material.uvScaleY,
      offsetX: objData.material.uvOffsetX,
      offsetY: objData.material.uvOffsetY,
      rotationDeg: objData.material.uvRotation,
    };

    const sideProjection = {
      scaleX: objData.material.sideUvScaleX,
      scaleY: objData.material.sideUvScaleY,
      offsetX: objData.material.sideUvOffsetX,
      offsetY: objData.material.sideUvOffsetY,
      rotationDeg: objData.material.sideUvRotation,
    };
    
    if (objData.material.baseTextureDataUrl) {
      const texture = textureLoader.load(objData.material.baseTextureDataUrl);
      applyUvProjection(texture, capProjection);
      capMaterialOptions.map = texture;
    }

    if (objData.material.normalMapDataUrl) {
      const normalMap = textureLoader.load(objData.material.normalMapDataUrl);
      applyUvProjection(normalMap, capProjection);
      capMaterialOptions.normalMap = normalMap;
      capMaterialOptions.normalScale = new THREE.Vector2(objData.material.bumpScale ?? 1, objData.material.bumpScale ?? 1);
    }

    if (objData.material.bumpMapDataUrl) {
      const bumpMap = textureLoader.load(objData.material.bumpMapDataUrl);
      applyUvProjection(bumpMap, capProjection);
      capMaterialOptions.bumpMap = bumpMap;
      capMaterialOptions.bumpScale = objData.material.bumpScale;
    }

    let mesh: THREE.Mesh;
    if (objData.geometry === 'cylinder' && objData.material.useSeparateSideMaterial) {
      const sideMaterialOptions: THREE.MeshPhysicalMaterialParameters = {
        color: objData.material.sideColor,
        metalness: Math.max(0.001, objData.material.metalness),
        roughness: objData.material.roughness,
        emissive: objData.material.emissive,
        emissiveIntensity: objData.material.emissiveIntensity,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        reflectivity: 1.0,
      };

      if (objData.material.sideNormalMapDataUrl) {
        const sideNormalMap = textureLoader.load(objData.material.sideNormalMapDataUrl);
        applyUvProjection(sideNormalMap, sideProjection);
        sideMaterialOptions.normalMap = sideNormalMap;
        sideMaterialOptions.normalScale = new THREE.Vector2(objData.material.sideBumpScale ?? 1, objData.material.sideBumpScale ?? 1);
      }

      if (objData.material.sideBumpMapDataUrl) {
        const sideBumpMap = textureLoader.load(objData.material.sideBumpMapDataUrl);
        applyUvProjection(sideBumpMap, sideProjection);
        sideMaterialOptions.bumpMap = sideBumpMap;
        sideMaterialOptions.bumpScale = objData.material.sideBumpScale;
      }

      const sideMaterial = new THREE.MeshPhysicalMaterial(sideMaterialOptions);
      const capMaterial = new THREE.MeshPhysicalMaterial(capMaterialOptions);
      mesh = new THREE.Mesh(geometry, [sideMaterial, capMaterial, capMaterial]);
    } else {
      const material = new THREE.MeshPhysicalMaterial(capMaterialOptions);
      mesh = new THREE.Mesh(geometry, material);
    }

    mesh.position.set(objData.position.x, objData.position.y, objData.position.z);
    mesh.rotation.set(objData.rotation.x, objData.rotation.y, objData.rotation.z);
    mesh.scale.set(objData.scale.x, objData.scale.y, objData.scale.z);
    
    if (renderSettings.shadows) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    scene.add(mesh);
    objectRef.current = mesh;
  };

  const startRendering = async () => {
    if (!sceneRef.current || !cameraRef.current || !rendererRef.current || !objectRef.current) {
      return;
    }

    // Small delay to ensure textures load and scene is ready
    await new Promise(resolve => setTimeout(resolve, 100));

    renderRequestRef.current = {
      isRendering: true,
      currentFrame: 0,
      frames: [],
    };

    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const object = objectRef.current;

    if (!scene.children.includes(object)) {
      scene.add(object);
    }
    object.visible = true;

    // Store initial state
    const initialRotation = object.rotation.clone();
    const initialPosition = object.position.clone();
    const initialScale = object.scale.clone();
    const initialCameraPosition = camera.position.clone();
    const initialCameraNear = camera.near;
    const initialCameraFar = camera.far;
    const initialSceneBackground = scene.background;
    const initialRendererSize = renderer.getSize(new THREE.Vector2());

    // Configure renderer for output
    renderer.setSize(renderSettings.width, renderSettings.height);
    if (composerRef.current) {
      composerRef.current.setSize(renderSettings.width, renderSettings.height);
    }

    fitCameraForRender(camera, object);
    
    // Set transparent background for rendering
    if (renderSettings.transparent) {
      scene.background = null;
    }

    const totalFrames = animation.duration;
    const frames: Blob[] = [];

    // Render each frame
    for (let frame = 0; frame < totalFrames; frame++) {
      // Update object transformation
      const progress = frame / totalFrames;
      
      // Rotation (cumulative)
      object.rotation.x = initialRotation.x + (animation.rotation.x * Math.PI / 180) * frame;
      object.rotation.y = initialRotation.y + (animation.rotation.y * Math.PI / 180) * frame;
      object.rotation.z = initialRotation.z + (animation.rotation.z * Math.PI / 180) * frame;

      // Position (cumulative)
      object.position.x = initialPosition.x + animation.position.x * frame;
      object.position.y = initialPosition.y + animation.position.y * frame;
      object.position.z = initialPosition.z + animation.position.z * frame;

      // Scale (lerp from initial to target)
      object.scale.x = initialScale.x * (1 + (animation.scale.x - 1) * progress);
      object.scale.y = initialScale.y * (1 + (animation.scale.y - 1) * progress);
      object.scale.z = initialScale.z * (1 + (animation.scale.z - 1) * progress);

      // Camera animation
      if (animation.cameraPath === 'orbit') {
        const angle = (animation.cameraStartAngle + animation.cameraOrbitSpeed * frame) * Math.PI / 180;
        const radius = Math.sqrt(
          initialCameraPosition.x ** 2 + 
          initialCameraPosition.y ** 2 + 
          initialCameraPosition.z ** 2
        );
        camera.position.x = Math.cos(angle) * radius;
        camera.position.z = Math.sin(angle) * radius;
        camera.lookAt(object.position);
      } else {
        // For static or other paths, always look at the object
        camera.lookAt(object.position);
      }

      // Update camera aspect ratio for output size
      camera.aspect = renderSettings.width / renderSettings.height;
      camera.updateProjectionMatrix();

      updateEffectDynamics(frame / Math.max(1, animation.fps));

      // Render frame
      renderSceneFrame(false, true);

      // Capture frame with alpha for transparency
      const blob = await new Promise<Blob>((resolve, reject) => {
        renderer.domElement.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to capture frame'));
        }, `image/${renderSettings.outputFormat}`, renderSettings.outputQuality);
      });

      frames.push(blob);
      renderRequestRef.current.currentFrame = frame + 1;
      renderRequestRef.current.frames = frames;

      // Report progress
      if (onRenderProgress) {
        onRenderProgress({
          currentFrame: frame + 1,
          totalFrames,
          isRendering: true,
          renderedFrames: frames,
        });
      }

      // Allow UI to update
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Restore initial state
    object.rotation.set(initialRotation.x, initialRotation.y, initialRotation.z);
    object.position.set(initialPosition.x, initialPosition.y, initialPosition.z);
    object.scale.set(initialScale.x, initialScale.y, initialScale.z);
    camera.position.set(initialCameraPosition.x, initialCameraPosition.y, initialCameraPosition.z);
    camera.near = initialCameraNear;
    camera.far = initialCameraFar;
    camera.lookAt(0, 0, 0);
    
    // Restore renderer and scene
    scene.background = initialSceneBackground;
    renderer.setSize(initialRendererSize.x, initialRendererSize.y);
    if (composerRef.current) {
      composerRef.current.setSize(initialRendererSize.x, initialRendererSize.y);
    }
    if (containerRef.current) {
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
    }
    
    renderRequestRef.current.isRendering = false;

    // Report completion
    if (onRenderComplete) {
      onRenderComplete(frames);
    }
    if (onRenderProgress) {
      onRenderProgress({
        currentFrame: totalFrames,
        totalFrames,
        isRendering: false,
        renderedFrames: frames,
      });
    }
  };

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '100%', 
        height: '100%',
        position: 'relative',
      }}
    >
      {/* Camera Control Hint */}
      <div style={{
        position: 'absolute',
        bottom: '12px',
        left: '12px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '11px',
        fontFamily: 'monospace',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        <div>🖱️ Left Click + Drag: Rotate</div>
        <div>🖱️ Right Click + Drag: Pan</div>
        <div>🖱️ Scroll: Zoom</div>
      </div>
    </div>
  );
}
