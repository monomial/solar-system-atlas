import * as THREE from "three";

// The volumetric Milky Way: a true emission–absorption raymarcher, not stacked pictures.
//
// The galaxy is a 60:1 pancake, so the right volume model is 2.5D: the high-resolution painted
// maps carry everything lateral (E(x,z) emission, D(x,z) dust), and analytic vertical profiles
// carry everything the maps cannot — a flared thin disk, a thicker faint tail, dust hugging the
// midplane tighter than the stars, the corrugation/warp displacement, and a triaxial bulge with
// a hot nucleus. Each ray integrates emission front-to-back while dust extinction eats what lies
// behind it (Beer–Lambert), which is what makes the edge view honest: dark lanes actually
// silhouette against the bulge instead of being painted on.
//
// Every constant here is shared with two siblings that must stay in lock-step:
//   · the 3D star cloud in DeepSpace.tsx (same R, same ripple(), same bulge axes/bar angle),
//   · the Metal port in tvos/HeliosTV/GalaxyVolume.metal (same math, translated).
//
// Vertical profiles are normalized by their own column integral, so looking straight down the
// accumulated column equals the painted map's brightness — the top view is exactly as crisp as
// the painting, and thickness only shows where it physically should: toward edge-on.
//
// Output is premultiplied color+alpha over NormalBlending: emitted light adds over the scene
// while alpha (1 − transmittance) lets dense dust genuinely darken the background starfield.

const VERT = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
// three injects the tone-mapping and colorspace helper FUNCTIONS into every program prologue;
// only the application chunks at the end may be included here, or the functions get two bodies.
uniform sampler2D uEmission;
uniform sampler2D uDust;
uniform float uGain;   // emission scale: 1.0 calibrates top-down brightness to the painted map
uniform float uDustK;  // dust column optical depth per unit of map density
uniform float uBulge;  // analytic bulge amplitude
uniform float uSelf;   // self-absorption: caps any sightline near 1/uSelf (edge-on safety, physically)
varying vec3 vWorld;

const float R   = 56.0;    // disk edge in world units (≈ 50,000 ly) — matches the star cloud
const float MAP = 122.0;   // world span of the painted maps (the old plane size)
const float HY  = 4.0;     // thin slab half-height; density is negligible beyond this
const float CYL = 58.0;    // radial bound: density is zero past the painted edge anyway
const float BAR = 2.0595;  // bar position angle, 118° — matches MILKY_WAY_ARMS
const int   N   = 72;

// Interleaved gradient noise: per-pixel start jitter that turns step banding into fine grain.
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// The corrugation + integral-sign warp — ported verbatim from milkyWay() so the glowing gas and
// the 3D star cloud undulate together.
float ripple(float r, float th){
  float f = r / R;
  return sin(r * 0.42 + 1.3) * (0.1 + f * f * 1.1) + f * f * f * 2.4 * sin(th - 1.1);
}

void main(){
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);

  // March segment: the |y|<=HY slab intersected with the r<=CYL cylinder. The box corners hold
  // no galaxy — clipping to the cylinder claws back ~a third of the wasted steps.
  float t0, t1;
  if(abs(rd.y) < 1e-4){
    if(abs(ro.y) > HY) discard;
    t0 = 0.0; t1 = 1e5;
  } else {
    float ta = (-HY - ro.y) / rd.y, tb = (HY - ro.y) / rd.y;
    t0 = min(ta, tb); t1 = max(ta, tb);
  }
  float a = dot(rd.xz, rd.xz);
  if(a > 1e-6){
    float b = 2.0 * dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - CYL * CYL;
    float disc = b * b - 4.0 * a * c;
    if(disc < 0.0) discard;
    float sq = sqrt(disc);
    t0 = max(t0, (-b - sq) / (2.0 * a));
    t1 = min(t1, (-b + sq) / (2.0 * a));
  } else if(dot(ro.xz, ro.xz) > CYL * CYL) discard;
  t0 = max(t0, 0.0);
  if(t1 <= t0) discard;

  float dt = (t1 - t0) / float(N);
  float t = t0 + dt * ign(gl_FragCoord.xy);
  float cb = cos(BAR), sb = sin(BAR);
  vec3 col = vec3(0.0);
  float T = 1.0;

  // Stable texture gradients, computed ONCE from the ray's midplane crossing: inside the loop
  // neighbouring pixels sit at different march depths, so implicit derivatives go chaotic and
  // the sampler falls back to a blurry mip. This is what keeps the top view as crisp as the map.
  float tm = abs(rd.y) > 1e-4 ? clamp(-ro.y / rd.y, t0, t1) : (t0 + t1) * 0.5;
  vec2 pm = (ro + rd * tm).xz;
  vec2 gx = vec2(dFdx(pm.x), -dFdx(pm.y)) / MAP;
  vec2 gy = vec2(dFdy(pm.x), -dFdy(pm.y)) / MAP;
  float grazing = smoothstep(0.12, 0.45, abs(rd.y));

  for(int i = 0; i < N; i++){
    vec3 p = ro + rd * t; t += dt;
    float r = length(p.xz);
    // Corrugation at 55%: the full-amplitude sheet tilts steeply enough near the rim that oblique
    // columns brighten on the slopes facing the camera, reading as wavy defocus bands from above.
    float dy = p.y - ripple(r, atan(p.z, p.x + 1e-6)) * 0.55;

    // A genuinely thin, roughly 60:1 luminous disk. The previous outer sigma of 1.4 plus a 9%
    // scale-height-2 tail projected broad arm-colored fog across every oblique view. Keep a small
    // old-disk tail, but let the resolved 3D stars carry structure above the plane.
    float s1 = 0.32 + 0.42 * (r * r) / (R * R);
    float vert = exp(-dy * dy / (2.0 * s1 * s1)) + 0.018 * exp(-abs(dy) / 1.15);
    float norm = s1 * 2.5066 + 0.0414;

    vec2 uv = vec2(p.x / MAP + 0.5, 0.5 - p.z / MAP);
    // The canvas is painted with 'lighter' (alpha accumulates too) and WebGL un-premultiplies on
    // upload, so faint texels arrive with screaming RGB and tiny alpha. Multiplying by alpha
    // restores the painted intensity — the exact multiply AdditiveBlending did for the old
    // slices. (The baked tvOS PNGs are flattened to alpha 1, so this stays a no-op there.)
    // Grazing rays blend toward a mip-blurred sample: the map's one-pixel stars are extruded into
    // thin vertical columns by the profile, and viewed edge-on those columns read as streaks —
    // so point detail fades out exactly where it would smear, and stays full-res from above.
    vec4 tex = mix(textureGrad(uEmission, uv, gx * 12.0, gy * 12.0), textureGrad(uEmission, uv, gx, gy), grazing);
    vec3 e = tex.rgb * tex.a * (vert / norm) * uGain;

    // Triaxial bulge in the bar frame + hot nucleus — the vertical body the flat map cannot
    // carry. Same axes as the star cloud's bulge (8.5 / 3.6 / 3.1). These are per-unit-length
    // densities: a ray staring through the core integrates a ~13-unit chord, so amplitudes are
    // calibrated for the COLUMN (~1.0 bulge, ~2.5 nucleus), not the point value.
    float bu = p.x * cb + p.z * sb, bv = -p.x * sb + p.z * cb;
    float q = bu * bu / 72.25 + bv * bv / 12.96 + p.y * p.y / 9.61;
    e += vec3(1.0, 0.87, 0.63) * (exp(-q * 1.4) * uBulge);
    e += vec3(1.0, 0.95, 0.82) * (exp(-dot(p, p) / 1.6) * 0.35);

    // Dust: same map strokes, hugging the midplane tighter than the light it blocks.
    float sd = 0.55 * s1;
    float dens = textureGrad(uDust, uv, gx, gy).r * (exp(-dy * dy / (2.0 * sd * sd)) / (sd * 2.5066)) * uDustK;

    col += e * T * dt;
    // Dust extinction PLUS self-absorption: a medium that emits also absorbs, so a sightline
    // saturates at the source function instead of integrating forever. This is what keeps the
    // edge-on view a structured bright band (capped near e/uSelf) rather than a white blowout —
    // the same reason real edge-on disks have a surface brightness at all.
    T *= exp(-(dens + dot(e, vec3(0.333)) * uSelf) * dt);
    if(T < 0.01) break;
  }

  gl_FragColor = vec4(col, 1.0 - T);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createGalaxyVolume(emission: THREE.Texture, dust: THREE.Texture){
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uEmission: { value: emission },
      uDust:     { value: dust },
      // The authored surface now carries high-frequency structure; the volume is the milk beneath.
      uGain:     { value: 0.34 },
      // The authored image already contains its dust lanes. Keep only enough volumetric
      // extinction to establish depth in oblique/edge views, not enough to redraw old arms.
      uDustK:    { value: 2.0 },
      uBulge:    { value: 0.035 },
      uSelf:     { value: 0.85 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    // BackSide + no depth test: the ray segment is computed analytically, so the camera can sit
    // inside the slab, and markers/labels layer over the glow purely by renderOrder. depthWrite
    // off keeps the volume from occluding anything it did not actually absorb.
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    premultipliedAlpha: true,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(124, 8, 124), material);
  // After the starfield (so dust can darken background stars), before the star cloud and labels.
  mesh.renderOrder = 1;
  return mesh;
}
