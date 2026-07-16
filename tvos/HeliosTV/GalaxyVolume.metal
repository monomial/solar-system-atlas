#include <metal_stdlib>
#include <SceneKit/scn_metal>
using namespace metal;

// The volumetric Milky Way — the Metal port of the web's raymarcher (app/galaxyVolume.ts).
// Same 2.5D model, same constants, same march: the painted emission/dust maps (baked to PNGs by
// `npm run galaxy-maps` from the SAME painter the web runs live) extruded through analytic
// vertical profiles, integrated front-to-back with dust extinction and self-absorption. If a
// constant changes here it must change there, and vice versa — the two renderers are one design.
//
// Differences from the GLSL, all mechanical:
//  · marched in NODE-LOCAL space (ro pulled through inverseModelTransform), so the node can be
//    scaled/positioned freely by the finale without touching the shader;
//  · the emission PNG is pre-flattened onto black (rgb·alpha at bake time), so no alpha multiply;
//  · no tone mapping here — SceneKit's HDR camera (wantsHDR + bloom in OrreryScene) grades it;
//  · output is premultiplied color+alpha, which is SceneKit's native .alpha blend convention,
//    scaled by an intensity uniform the finale uses to fade the whole volume in and out.

struct NodeBuffer {
    float4x4 modelTransform;
    float4x4 inverseModelTransform;
    float4x4 modelViewProjectionTransform;
};

struct GalaxyUniforms {
    float intensity;
};

struct VertexIn {
    float3 position [[attribute(SCNVertexSemanticPosition)]];
};

struct VertexOut {
    float4 position [[position]];
    float3 localPos;
};

vertex VertexOut galaxyVertex(VertexIn in [[stage_in]],
                              constant SCNSceneBuffer& scn_frame [[buffer(0)]],
                              constant NodeBuffer& scn_node [[buffer(1)]]) {
    VertexOut out;
    out.position = scn_node.modelViewProjectionTransform * float4(in.position, 1.0);
    out.localPos = in.position;
    return out;
}

constant float R   = 56.0;    // disk edge in galaxy units (1 unit = 1,000 light-years)
constant float MAP = 122.0;   // span of the painted maps
constant float HY  = 4.0;     // thin slab half-height marched
constant float CYL = 58.0;    // radial bound
constant float BAR = 2.0595;  // bar position angle, 118°
constant int   N   = 72;
constant float GAIN  = 0.34;
constant float DUSTK = 2.0;
constant float BULGE = 0.035;
constant float SELF  = 0.85;

// Interleaved gradient noise: per-pixel start jitter that turns step banding into fine grain.
static float ign(float2 p) {
    return fract(52.9829189 * fract(dot(p, float2(0.06711056, 0.00583715))));
}

// Corrugation + integral-sign warp, damped 55% — identical to the web shader and star cloud.
static float rippleAt(float r, float th) {
    float f = r / R;
    return (sin(r * 0.42 + 1.3) * (0.1 + f * f * 1.1) + f * f * f * 2.4 * sin(th - 1.1)) * 0.55;
}

fragment float4 galaxyFragment(VertexOut in [[stage_in]],
                               constant SCNSceneBuffer& scn_frame [[buffer(0)]],
                               constant NodeBuffer& scn_node [[buffer(1)]],
                               constant GalaxyUniforms& uniforms [[buffer(2)]],
                               texture2d<float> emissionMap [[texture(0)]],
                               texture2d<float> dustMap [[texture(1)]]) {
    constexpr sampler smp(address::clamp_to_edge, filter::linear, mip_filter::linear);

    float3 camWorld = (scn_frame.inverseViewTransform * float4(0, 0, 0, 1)).xyz;
    float3 ro = (scn_node.inverseModelTransform * float4(camWorld, 1)).xyz;
    float3 rd = normalize(in.localPos - ro);

    // March segment: the |y|<=HY slab intersected with the r<=CYL cylinder.
    float t0, t1;
    if (abs(rd.y) < 1e-4) {
        if (abs(ro.y) > HY) return float4(0);
        t0 = 0.0; t1 = 1e5;
    } else {
        float ta = (-HY - ro.y) / rd.y, tb = (HY - ro.y) / rd.y;
        t0 = min(ta, tb); t1 = max(ta, tb);
    }
    float a = dot(rd.xz, rd.xz);
    if (a > 1e-6) {
        float b = 2.0 * dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - CYL * CYL;
        float disc = b * b - 4.0 * a * c;
        if (disc < 0.0) return float4(0);
        float sq = sqrt(disc);
        t0 = max(t0, (-b - sq) / (2.0 * a));
        t1 = min(t1, (-b + sq) / (2.0 * a));
    } else if (dot(ro.xz, ro.xz) > CYL * CYL) {
        return float4(0);
    }
    t0 = max(t0, 0.0);
    if (t1 <= t0) return float4(0);

    float dt = (t1 - t0) / float(N);
    float t = t0 + dt * ign(in.position.xy);
    float cb = cos(BAR), sb = sin(BAR);
    float3 col = float3(0.0);
    float T = 1.0;

    // Stable texture gradients from the ray's midplane crossing (see galaxyVolume.ts), and the
    // grazing factor that fades one-pixel star detail before it can smear into vertical streaks.
    float tm = abs(rd.y) > 1e-4 ? clamp(-ro.y / rd.y, t0, t1) : (t0 + t1) * 0.5;
    float2 pm = (ro + rd * tm).xz;
    float2 gx = float2(dfdx(pm.x), -dfdx(pm.y)) / MAP;
    float2 gy = float2(dfdy(pm.x), -dfdy(pm.y)) / MAP;
    float grazing = smoothstep(0.12, 0.45, abs(rd.y));

    for (int i = 0; i < N; i++) {
        float3 p = ro + rd * t; t += dt;
        float r = length(p.xz);
        float dy = p.y - rippleAt(r, atan2(p.z, p.x + 1e-6));

        // Roughly 60:1 thin disk plus a very faint old-disk tail, column-normalized.
        float s1 = 0.32 + 0.42 * (r * r) / (R * R);
        float vert = exp(-dy * dy / (2.0 * s1 * s1)) + 0.018 * exp(-abs(dy) / 1.15);
        float norm = s1 * 2.5066 + 0.0414;

        float2 uv = float2(p.x / MAP + 0.5, 0.5 - p.z / MAP);
        float3 sharp = emissionMap.sample(smp, uv, gradient2d(gx, gy)).rgb;
        float3 soft  = emissionMap.sample(smp, uv, gradient2d(gx * 12.0, gy * 12.0)).rgb;
        float3 e = mix(soft, sharp, grazing) * (vert / norm) * GAIN;

        // Triaxial bulge (bar frame) + hot nucleus, column-calibrated amplitudes.
        float bu = p.x * cb + p.z * sb, bv = -p.x * sb + p.z * cb;
        float q = bu * bu / 72.25 + bv * bv / 12.96 + p.y * p.y / 9.61;
        e += float3(1.0, 0.87, 0.63) * (exp(-q * 1.4) * BULGE);
        e += float3(1.0, 0.95, 0.82) * (exp(-dot(p, p) / 1.6) * 0.35);

        // Dust hugging the midplane tighter than the light it blocks, plus self-absorption so
        // edge-on sightlines saturate instead of blowing out.
        float sd = 0.55 * s1;
        float dens = dustMap.sample(smp, uv, gradient2d(gx, gy)).r
                   * (exp(-dy * dy / (2.0 * sd * sd)) / (sd * 2.5066)) * DUSTK;

        col += e * T * dt;
        T *= exp(-(dens + dot(e, float3(0.333)) * SELF) * dt);
        if (T < 0.01) break;
    }

    return float4(col, 1.0 - T) * uniforms.intensity;
}
