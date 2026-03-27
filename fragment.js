const fs = require('fs');

let code = fs.readFileSync('src/Scene3D.tsx', 'utf8');

const tShaderFrag = `const fragmentShader = \`
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

                  // Base fresnel calculates how close the surface aligns with the camera view.
                  // 1.0 = looking straight down the barrel/surface, 0.0 = looking at edge
                  float fresnel = dot(normal, viewDir);
                  fresnel = clamp(fresnel, 0.0, 1.0);
                  
                  // Add fractal noise into the fresnel to make the edge look like plasma/fire instead of a smooth tube
                  // UV x drives it along the tube, y drives it radially around the circumference. 
                  float pNoise = noise2(vec2(vUv.x * uNoiseScale * 20.0 - uTime * 5.0, vUv.y * 10.0 + uTime * 2.0));
                  float pNoise2 = noise2(vec2(vUv.x * uNoiseScale * 40.0 + uTime * 3.0, vUv.y * 20.0 - uTime * 4.0));
                  
                  // Blend the two octaves
                  float totalNoise = (pNoise + pNoise2 * 0.5) * 0.66;
                  
                  // Radically perturb fresnel with noise for fiery/electric edges
                  float noisyFresnel = fresnel + (totalNoise - 0.5) * 1.5;
                  noisyFresnel = clamp(noisyFresnel, 0.0, 1.0);
                  
                  // Core is sharp, mostly unaffected by noise, staying right at the center line
                  float coreMix = smoothstep(1.0 - uCoreRatio, 1.0, fresnel + (totalNoise-0.5)*0.2);
                  
                  // Glow completely relies on the noisy fragmented fresnel 
                  float glowMix = pow(1.0 - noisyFresnel, uFalloff);

                  // Additional pulse ripple going continuously down the length 
                  float pulse = sin(vUv.x * uNoiseScale * 10.0 - uTime * 15.0) * 0.5 + 0.5;
                  glowMix += pulse * totalNoise * 0.5;

                  vec3 color = mix(uGlowColor * glowMix, uCoreColor, coreMix);
                  
                  // Final alpha blending: We let noise punch completely transparent holes into the outer glow!
                  float alpha = max(coreMix, glowMix * smoothstep(0.2, 0.8, totalNoise) * 1.5);
                  
                  float cap = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
                  
                  gl_FragColor = vec4(color, clamp(alpha * cap, 0.0, 1.0));
                }
              \`;`;

// Using strict replacement for safety
const regex = /const fragmentShader = `[\s\S]*?gl_FragColor = vec4\(color, alpha \* cap\);\s*}\s*`;/;
code = code.replace(regex, tShaderFrag);

fs.writeFileSync('src/Scene3D.tsx', code);
console.log('Modified Shader with 2D Plasma Noise!');