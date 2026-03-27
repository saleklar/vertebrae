const fs = require('fs');

const shaderStr = `// ── Saber live preview ───────────────────────────────────────────────────────────────────
      {
        const sAnimT = (Date.now() % 10000000) / 1000.0;
        sceneObjectsRef.current.forEach((sObj) => {
          if (sObj.type !== 'Saber') return;
          const sGroup = sceneObjectMeshesRef.current.get(sObj.id) as THREE.Group | undefined;
          if (!sGroup) return;

          const targetPathId = (sObj.properties ?? {}).targetPathId || sObj.id;
          const sPts = sceneObjectsRef.current.filter(o => o.parentId === targetPathId && o.type === 'PathPoint');
          
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
          const sFalloff   = sp.glowFalloff ?? 1.2;

          const segments = Math.max(20, Math.min(Math.floor(curve.getLength() * 10), 400));
          
          // Use a FAT tube with 32 radial segments for a smooth high-res canvas
          // We don't use it as a mesh, we use it as a volumetric bounding shell
          const tubeGeo = new THREE.TubeGeometry(curve, segments, Math.max(1.0, glowWidth * 0.4), 32, closed);

          let saberMesh = sGroup.getObjectByName('SaberMesh') as THREE.Mesh;
          
          if (!saberMesh) {
              const vertexShader = \`
                varying vec2 vUv;
                varying vec3 vOriginalNormal;
                varying vec3 vViewPosition;
                varying float vVertexNoise;
                
                uniform float uTime;
                uniform float uNoiseScale;
                uniform float uNoiseInt;
                
                // Simplex 3D Noise inside Vertex Shader
                vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
                vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
                float snoise(vec3 v){ 
                  const vec2  C = vec2(1.0/6.0, 1.0/3.0);
                  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
                  vec3 i  = floor(v + dot(v, C.yyy));
                  vec3 x0 = v - i + dot(i, C.xxx);
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
                  float n_ = 1.0/7.0;
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
                  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
                  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                  m = m * m;
                  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
                }

                void main() {
                  vUv = uv;
                  
                  // Use the perfect cylindrical normal for fragment volumetric math
                  vOriginalNormal = normalize(normalMatrix * normal);
                  
                  // Generate organic 3D vertex wobbling
                  vVertexNoise = snoise(position * uNoiseScale * 0.5 - uTime * 2.0);
                  
                  // Displace vertex to warp the containment tube, 
                  // but we keep original normal to do the rim fade perfectly
                  vec3 displaced = position + normal * (vVertexNoise * uNoiseInt * 0.2);
                  
                  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
                  vViewPosition = -mvPosition.xyz;
                  gl_Position = projectionMatrix * mvPosition;
                }
              \`;

              const fragmentShader = \`
                varying vec2 vUv;
                varying vec3 vOriginalNormal;
                varying vec3 vViewPosition;
                varying float vVertexNoise;
                
                uniform float uTime;
                uniform vec3 uCoreColor;
                uniform vec3 uGlowColor;
                uniform float uCoreRatio;
                uniform float uFalloff;
                
                // Helper to create micro pixel-perfect noise details
                float hash(vec2 p) { return fract(1e4 * sin(17.0 * p.x + p.y * 0.1) * (0.1 + abs(sin(p.y * 13.0 + p.x)))); }
                float fbm(vec2 x) {
                    float v = 0.0;
                    float a = 0.5;
                    vec2 shift = vec2(100.0);
                    for (int i = 0; i < 4; ++i) {
                        v += a * hash(x);
                        x = x * 2.0 + shift;
                        a *= 0.5;
                    }
                    return v;
                }

                void main() {
                  // Direction to camera
                  vec3 viewDir = normalize(vViewPosition);
                  
                  // Using the UNDISPLACED normal is the magic trick here!
                  // It tells us how deep inside the theoretical perfectly smooth tube we are.
                  // 1.0 = dead center of the pipe, 0.0 = grazing edge.
                  float radial = abs(dot(vOriginalNormal, viewDir));
                  
                  // Softly erase the hard polygons of the tube mesh completely
                  // Anything closer to the edge than 0.2 gets faded to invisible
                  float meshEdgeFade = smoothstep(0.01, 0.4, radial);
                  
                  // The solid central laser beam
                  // We boost it massively to make a sharp, over-exposed white/core center
                  float coreThickness = uCoreRatio * 0.5;
                  float core = pow(radial, 20.0 / clamp(coreThickness + 0.01, 0.1, 5.0)) * 2.5;
                  
                  // The wider volumetric plasma aura
                  float glow = pow(radial, uFalloff);
                  
                  // High-frequency procedural detail to make the glow look like fire/electricity
                  // We scroll the UVs rapidly
                  vec2 noiseUv = vUv * vec2(20.0, 5.0) - vec2(uTime * 5.0, 0.0);
                  float microNoise = fbm(noiseUv);
                  
                  // Combine vertex waviness and pixel micro-noise to warp the glow output
                  float organicWarp = (vVertexNoise * 0.5 + 0.5) * (microNoise * 0.5 + 0.5);
                  
                  vec3 finalColor = mix(uGlowColor * glow * (1.0 + organicWarp * 3.0), uCoreColor, clamp(core, 0.0, 1.0));
                  
                  // Final additive opacity
                  float alpha = (core + glow * (0.5 + organicWarp * 1.5)) * meshEdgeFade;
                  
                  // Taper the ends of the tube so it gently fades to zero instead of a hard cap
                  float capFade = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
                  
                  gl_FragColor = vec4(finalColor, clamp(alpha * capFade, 0.0, 1.0));
                }
              \`;

              const material = new THREE.ShaderMaterial({
                  vertexShader,
                  fragmentShader,
                  uniforms: {
                      uTime: { value: 0 },
                      uCoreColor: { value: coreColor },
                      uGlowColor: { value: glowColor },
                      uCoreRatio: { value: coreWidth / glowWidth },
                      uNoiseScale: { value: noiseScale * 0.1 },
                      uNoiseInt: { value: noiseInt },
                      uFalloff: { value: sFalloff * 2.0 } // Boost falloff for softer edges
                  },
                  transparent: true,
                  blending: THREE.AdditiveBlending,
                  depthWrite: false, // Critical for volumetric look
                  depthTest: true,
                  side: THREE.DoubleSide // Render both inner and outer face of tube for volumetric layering
              });

              saberMesh = new THREE.Mesh(tubeGeo, material);
              saberMesh.name = 'SaberMesh';
              sGroup.clear();
              sGroup.add(saberMesh);
          } else {
              if (saberMesh.geometry) saberMesh.geometry.dispose();
              saberMesh.geometry = tubeGeo;
              
              const mat = saberMesh.material as THREE.ShaderMaterial;
              mat.uniforms.uTime.value = isAnim ? sAnimT * noiseSpeed : 0;
              mat.uniforms.uCoreColor.value.copy(coreColor);
              mat.uniforms.uGlowColor.value.copy(glowColor);
              if (glowWidth > 0) mat.uniforms.uCoreRatio.value = coreWidth / Math.max(0.1, glowWidth);
              mat.uniforms.uNoiseScale.value = noiseScale * 0.1;
              mat.uniforms.uNoiseInt.value = noiseInt;
              mat.uniforms.uFalloff.value = sFalloff * 2.0;
          }
          
           sGroup.position.set(0, 0, 0);
           sGroup.rotation.set(0, 0, 0);
           sGroup.scale.set(1, 1, 1);
        });
      }
// ── End saber live preview ─────────────────────────────────────────────────────────────────`;

let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');
const rx = /\/\/ ── Saber live preview ───────────────────────────────────────────────────────────────────[\s\S]*?\/\/ ── End saber live preview ─────────────────────────────────────────────────────────────────/;
code = code.replace(rx, shaderStr);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log('Procedural glow shader replaced.');