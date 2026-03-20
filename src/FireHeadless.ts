import * as THREE from 'three';
import { vertexShader, fragmentShader, GeneratorParams } from './FireGenerator';

export const defaultTorchParams: GeneratorParams = {
  shapeType: 'ground',
  color1: '#ff0000',
  color2: '#ff6600',
  color3: '#ffff00',
  speed: 1.0,
  scale: 4.0,
  coreBottom: 1.5,
  coreTop: 0.1,
  brightness: 1.5,
  contrast: 1.2,
  saturation: 1.0,
  frames: 30, // 30 frames
  fps: 30,    // 30 fps -> 1 second duration
  resolution: 128,
  noiseType: 'voronoi',
  distortion: 0.8,
  detail: 1.0, alphaThreshold: 0.0, particleSize: 1.5, flowX: 0, flowY: 1, flowZ: 0, rotX: 0, rotY: 0, rotZ: 0,
  baseBlur: 0.0, baseOpacity: 1.0, glow1Blur: 4.0, glow1Opacity: 0.6, glow2Blur: 12.0, glow2Opacity: 0.3
};

export const defaultCampfireParams: GeneratorParams = {
  shapeType: 'ground',
  color1: '#ff0000',
  color2: '#ff6600',
  color3: '#ffff00',
  speed: 0.5,
  scale: 2.0,
  coreBottom: 1.5,
  coreTop: 0.8,
  brightness: 1.5,
  contrast: 1.0,
  saturation: 1.0,
  frames: 40, 
  fps: 20, 
  resolution: 128,
  noiseType: 'voronoi',
  distortion: 0.5,
  detail: 1.0, alphaThreshold: 0.0, particleSize: 1.5, flowX: 0, flowY: 1, flowZ: 0, rotX: 0, rotY: 0, rotZ: 0,
  baseBlur: 0.0, baseOpacity: 1.0, glow1Blur: 4.0, glow1Opacity: 0.6, glow2Blur: 12.0, glow2Opacity: 0.3
};

export const generateFireSequenceHeadless = async (params: GeneratorParams): Promise<string[]> => {
  return new Promise((resolve) => {
    // Create offscreen renderer
    const canvas = document.createElement('canvas');
    canvas.width = params.resolution;
    canvas.height = params.resolution;

    // Use WebGL1 for best compat outside DOM
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(params.resolution, params.resolution);
    renderer.setPixelRatio(1);

    const scene = new THREE.Scene();
    
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 1.5, 6);
    camera.lookAt(0, 0.5, 0);

    camera.position.z = 1;

    
    const GRID_SIZE = params.domainResolution || 24;
    const DOMAIN_SIZE = 4.8; // Keep overall fire volume constant
    const SPACING = DOMAIN_SIZE / GRID_SIZE;
    const ps = params.particleSize || 1.5;
    const geometry = new THREE.PlaneGeometry(SPACING * ps, SPACING * ps);

    
    // Convert hex to THREE.Color
    const parseColor = (hex: string) => {
      const c = new THREE.Color(hex);
      // Ensure color is linear
      return c;
    }

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      uniforms: {
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
      blending: THREE.NormalBlending,
      depthWrite: false,
    });

    
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    
    const GRID_SIZE_Y = Math.floor(GRID_SIZE * 2.5);
    const COUNT = GRID_SIZE * GRID_SIZE_Y * GRID_SIZE;
    const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
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


    const dataUrls: string[] = [];

    // Render loop
    for (let i = 0; i < params.frames; i++) {
        const progress = i / params.frames;
        mesh.material.uniforms.loopProgress.value = progress;
        renderer.render(scene, camera);
        dataUrls.push(canvas.toDataURL('image/png'));
    }

    // Cleanup
    geometry.dispose();
    material.dispose();
    renderer.dispose();

    resolve(dataUrls);
  });
};
