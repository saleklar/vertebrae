const fs = require('fs');
let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const tShaderFrag = \const fragmentShader = \\\\\
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                uniform float uTime;
                uniform vec3 uCoreColor;
                uniform vec3 uGlowColor;
                uniform float uCoreRatio;
                uniform float uFalloff;
                uniform float uNoiseScale;
                
                // 2D Noise for fragment surface noise
                float hash(vec2 p) { return fract(1e4 * sin(17.0 * p.x + p.y * 0.1) * (0.1 + abs(sin(p.y * 13.0 + p.x)))); }
                float noise2(vec2 x) {
                    vec2 i = floor(x);
                    vec2 f = fract(x);
                    float a = hash(i);
                    float b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0));
                    float d = hash(i + vec2(1.0, 1.0));
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
                }
                
                void main() {
                  vec3 normal = normalize(vNormal);
                  vec3 viewDir = normalize(vViewPosition);
                  float fresnel = dot(normal, viewDir);
                  fresnel = clamp(fresnel, 0.0, 1.0);
                  
                  // Add fractal noise into the fresnel to make the fresnel edge look like plasma/fire instead of smooth tube
                  float pNoise = noise2(vec2(vUv.x * uNoiseScale * 20.0 - uTime * 5.0, vUv.y * 10.0 + uTime * 2.0));
                  float pNoise2 = noise2(vec2(vUv.x * uNoiseScale * 40.0 + uTime * 3.0, vUv.y * 20.0 - uTime * 4.0));
                  float totalNoise = (pNoise + pNoise2 * 0.5) * 0.66;
                  
                  // Perturb fresnel with noise for fiery edges
                  float noisyFresnel = fresnel + (totalNoise - 0.5) * 0.8;
                  noisyFresnel = clamp(noisyFresnel, 0.0, 1.0);
                  
                  // Core is sharp, unaffected by noise
                  float coreMix = smoothstep(1.0 - uCoreRatio, 1.0, fresnel);
                  
                  // Glow relies on noisy fresnel
                  float glowMix = pow(1.0 - noisyFresnel, uFalloff);

                  vec3 color = mix(uGlowColor * glowMix, uCoreColor, coreMix);
                  
                  // Soft fade out for pure alpha glow
                  float alpha = max(coreMix, glowMix * totalNoise * 1.5);
                  
                  float cap = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
                  
                  gl_FragColor = vec4(color, alpha * cap);
                }
              \\\\\;\;

code = code.replace(/const fragmentShader = [\s\S]*?gl_FragColor = vec4\(color, alpha \* cap\);\s*}\s*;/, tShaderFrag);
fs.writeFileSync('src/Scene3D.tsx', code);
console.log('Modified Shader!')
