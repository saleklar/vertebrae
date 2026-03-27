const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const regex = /\/\/ ── Saber live preview ───────────────────────────────────────────────────────────────────[\s\S]*?\/\/ ── End saber live preview ─────────────────────────────────────────────────────────────────/;

const replacement = \// ── Saber live preview ───────────────────────────────────────────────────────────────────
      {
        const sAnimT = Date.now() / 1000.0;
        sceneObjectsRef.current.forEach((sObj) => {
          if (sObj.type !== 'Saber') return;
          const sGroup = sceneObjectMeshesRef.current.get(sObj.id) as THREE.Group | undefined;
          if (!sGroup) return;

          // Gather points
          const sPts = sceneObjectsRef.current.filter(o => o.parentId === sObj.id && o.type === 'PathPoint');
          if (sPts.length < 2) {
             sGroup.clear();
             return;
          }

          const rawPoints = sPts.map(p => {
              const pMesh = sceneObjectMeshesRef.current.get(p.id);
              if (pMesh) {
                  const wp = new THREE.Vector3();
                  pMesh.getWorldPosition(wp);
                  return wp;
              }
              return new THREE.Vector3(p.position.x, p.position.y, p.position.z);
          });

          const sp = (sObj.properties ?? {}) as any;
          const closed = sp.closed ?? false;
          const tension = sp.tension ?? 0.5;
          const curve = new THREE.CatmullRomCurve3(rawPoints, closed, 'catmullrom', tension);

          const coreColor  = new THREE.Color(sp.coreColor ?? '#ffffff');
          const glowColor  = new THREE.Color(sp.glowColor ?? '#0088ff');
          const coreWidth  = sp.coreWidth ?? 1.0;
          const glowWidth  = sp.glowWidth ?? 6.0;
          const noiseInt   = sp.noiseIntensity ?? 0.5;
          const noiseScale = sp.noiseScale ?? 5.0;
          const isAnim     = sp.noiseAnimated ?? true;
          const noiseSpeed = sp.noiseSpeed ?? 1.0;

          // Find or create mesh
          let saberMesh = sGroup.getObjectByName('SaberMesh') as THREE.Mesh;
          
          // Rebuild geometry every frame for simplicity if points move (cheap enough for dev)
          const segments = Math.max(20, Math.min(Math.floor(curve.getLength() * 10), 300));
          const tubeGeo = new THREE.TubeGeometry(curve, segments, glowWidth * 0.5, 8, closed);

          if (!saberMesh) {
              const vertexShader = \\\
                varying vec2 vUv;
                varying vec3 vPosition;
                uniform float uTime;
                uniform float uNoiseScale;
                uniform float uNoiseInt;
                
                // Simplex 3D Noise 
                vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
                vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
                float snoise(vec3 v){ 
                  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
                  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
                  vec3 i  = floor(v + dot(v, C.yyy) );
                  vec3 x0 = v - i + dot(i, C.xxx) ;
                  vec3 g = step(x0.yzx, x0.xyz);
                  vec3 l = 1.0 - g;
                  vec3 i1 = min( g.xyz, l.zxy );
                  vec3 i2 = max( g.xyz, l.zxy );
                  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
                  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
                  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
                  i = mod(i, 289.0 ); 
                  vec4 p = permute( permute( permute( 
                             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                           + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
                  float n_ = 1.0/7.0; // N=7
                  vec3  ns = n_ * D.wyz - D.xzx;
                  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
                  vec4 x_ = floor(j * ns.z);
                  vec4 y_ = floor(j - 7.0 * x_ );
                  vec4 x = x_ *ns.x + ns.yyyy;
                  vec4 y = y_ *ns.x + ns.yyyy;
                  vec4 h = 1.0 - abs(x) - abs(y);
                  vec4 b0 = vec4( x.xy, y.xy );
                  vec4 b1 = vec4( x.zw, y.zw );
                  vec4 s0 = floor(b0)*2.0 + 1.0;
                  vec4 s1 = floor(b1)*2.0 + 1.0;
                  vec4 sh = -step(h, vec4(0.0));
                  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
                  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
                  vec3 p0 = vec3(a0.xy,h.x);
                  vec3 p1 = vec3(a0.zw,h.y);
                  vec3 p2 = vec3(a1.xy,h.z);
                  vec3 p3 = vec3(a1.zw,h.w);
                  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                  p0 *= norm.x;
                  p1 *= norm.y;
                  p2 *= norm.z;
                  p3 *= norm.w;
                  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                  m = m * m;
                  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
                }

                void main() {
                  vUv = uv;
                  vPosition = position;
                  
                  float noiseVal = snoise(position * uNoiseScale + uTime);
                  vec3 displaced = position + normal * noiseVal * uNoiseInt;
                  
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
                }
              \\\;

              const fragmentShader = \\\
                varying vec2 vUv;
                varying vec3 vPosition;
                uniform float uTime;
                uniform vec3 uCoreColor;
                uniform vec3 uGlowColor;
                uniform float uCoreRatio;
                uniform float uNoiseScale;
                
                void main() {
                  // vUv.y is around the tube (0 to 1)
                  // Dist to center of tube cross-section is abs(vUv.y - 0.5) * 2.0
                  float distToCenter = abs(vUv.y - 0.5) * 2.0; 
                  
                  // Core is sharp, glow is soft
                  float coreMix = 1.0 - smoothstep(0.0, uCoreRatio, distToCenter);
                  float glowMix = 1.0 - smoothstep(0.0, 1.0, distToCenter);
                  
                  // Add noise to fragment for fiery plasma look
                  float pulse = sin(vUv.x * uNoiseScale * 10.0 - uTime * 5.0) * 0.5 + 0.5;
                  glowMix *= (0.5 + 0.5 * pulse);

                  vec3 finalColor = mix(uGlowColor * glowMix, uCoreColor, coreMix);
                  float alpha = max(coreMix, glowMix * 0.8);
                  
                  gl_FragColor = vec4(finalColor, alpha);
                }
              \\\;

              const material = new THREE.ShaderMaterial({
                  vertexShader,
                  fragmentShader,
                  uniforms: {
                      uTime: { value: 0 },
                      uCoreColor: { value: coreColor },
                      uGlowColor: { value: glowColor },
                      uCoreRatio: { value: coreWidth / glowWidth },
                      uNoiseScale: { value: noiseScale * 0.1 },
                      uNoiseInt: { value: noiseInt }
                  },
                  transparent: true,
                  blending: THREE.AdditiveBlending,
                  depthWrite: false,
                  side: THREE.DoubleSide
              });

              saberMesh = new THREE.Mesh(tubeGeo, material);
              saberMesh.name = 'SaberMesh';
              sGroup.clear();
              sGroup.add(saberMesh);
          } else {
              // Update geometry
              saberMesh.geometry.dispose();
              saberMesh.geometry = tubeGeo;
              
              // Update uniforms
              const mat = saberMesh.material as THREE.ShaderMaterial;
              mat.uniforms.uTime.value = isAnim ? sAnimT * noiseSpeed : 0;
              mat.uniforms.uCoreColor.value.copy(coreColor);
              mat.uniforms.uGlowColor.value.copy(glowColor);
              if (glowWidth > 0) mat.uniforms.uCoreRatio.value = coreWidth / glowWidth;
              mat.uniforms.uNoiseScale.value = noiseScale * 0.1;
              mat.uniforms.uNoiseInt.value = noiseInt;
          }
          
           sGroup.position.set(0, 0, 0);
           sGroup.rotation.set(0, 0, 0);
           sGroup.scale.set(1, 1, 1);
        });
      }
      // ── End saber live preview ─────────────────────────────────────────────────────────────────\;

if (code.includes('// ── Saber live preview')) {
    code = code.replace(regex, replacement);
    fs.writeFileSync('src/Scene3D.tsx', code);
    console.log("Patched Scene3D.tsx with ShaderMaterial Saber implementation");
} else {
    console.log("Could not find saber preview section to replace");
}
