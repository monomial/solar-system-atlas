#include <metal_stdlib>
using namespace metal;
// scn_metal leans on bare float4x4 etc., so the namespace must be open before it arrives.
#include <SceneKit/scn_metal>

// The cosmic web volume — the Metal port of the web raymarcher (app/universeVolume.ts).
// It samples the same committed 128³ RGBA field: emission density in R, palette balance in G,
// dust/void absorption in B and catalog-anchor mask in A. Like GalaxyVolume.metal, rays march in
// node-local space so the finale can position and scale the whole universe without changing the
// field math. Output is premultiplied for SceneKit's .alpha blend, and node.opacity reaches the
// shader through the per-node intensity uniform installed by Universe.swift.
//
// The only deliberate renderer tuning is the 24–40 segment-scaled step range. The web uses 32–56;
// this finale already runs at half resolution and 30 fps, but every step here samples a real 3D
// texture, so the Apple TV ceiling is lower.

struct UniverseNodeBuffer {
    float4x4 modelTransform;
    float4x4 inverseModelTransform;
    float4x4 modelViewProjectionTransform;
};

struct UniverseUniforms {
    float intensity;
};

struct UniverseVertexIn {
    float3 position [[attribute(SCNVertexSemanticPosition)]];
};

struct UniverseVertexOut {
    float4 position [[position]];
    float3 localPos;
};

vertex UniverseVertexOut universeVertex(UniverseVertexIn in [[stage_in]],
                                        constant SCNSceneBuffer& scn_frame [[buffer(0)]],
                                        constant UniverseNodeBuffer& scn_node [[buffer(1)]]) {
    UniverseVertexOut out;
    out.position = scn_node.modelViewProjectionTransform * float4(in.position, 1.0);
    out.localPos = in.position;
    return out;
}

static float2 intersectUniverseBox(float3 origin, float3 direction) {
    float3 inverseDirection = 1.0 / direction;
    float3 t0 = (-60.0 - origin) * inverseDirection;
    float3 t1 = ( 60.0 - origin) * inverseDirection;
    float3 lo = min(t0, t1), hi = max(t0, t1);
    return float2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}

// Interleaved gradient noise: per-pixel start jitter that turns step banding into fine grain.
static float universeIGN(float2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, float2(0.06711056, 0.00583715))));
}

fragment float4 universeFragment(UniverseVertexOut in [[stage_in]],
                                 constant SCNSceneBuffer& scn_frame [[buffer(0)]],
                                 constant UniverseNodeBuffer& scn_node [[buffer(1)]],
                                 constant UniverseUniforms& uniforms [[buffer(2)]],
                                 texture3d<float> fieldTexture [[texture(0)]]) {
    constexpr sampler smp(address::clamp_to_edge, filter::linear);

    float3 cameraWorld = (scn_frame.inverseViewTransform * float4(0, 0, 0, 1)).xyz;
    float3 origin = (scn_node.inverseModelTransform * float4(cameraWorld, 1)).xyz;
    float3 direction = normalize(in.localPos - origin);
    float2 hit = intersectUniverseBox(origin, direction);
    float nearDistance = max(hit.x, 0.0);
    float segment = max(0.0, hit.y - nearDistance);
    if (segment <= 0.0) discard_fragment();

    float steps = mix(24.0, 40.0, clamp(segment / 120.0, 0.0, 1.0));
    float stepLength = segment / steps;
    float distanceAlong = nearDistance + stepLength * universeIGN(in.position.xy);
    float4 accumulated = float4(0.0);

    for (int index = 0; index < 40; index++) {
        if (float(index) >= steps || accumulated.a > 0.96) break;
        float3 samplePosition = origin + direction * distanceAlong;
        float3 uvw = samplePosition / 120.0 + 0.5;
        float4 field = fieldTexture.sample(smp, uvw);
        float absorption = mix(1.0, 0.52, smoothstep(0.5, 1.0, field.b));
        float density = smoothstep(0.17, 0.78, field.r) * 1.22 * absorption;
        float charted = field.a;
        float3 cool = float3(0.055, 0.18, 0.48);
        float3 warm = float3(0.96, 0.36, 0.13);
        float3 anchorWarm = float3(1.0, 0.58, 0.24);
        float3 color = mix(cool, warm, clamp(field.g + charted * 0.1, 0.0, 1.0));
        color = mix(color, anchorWarm, charted * 0.24) * (0.28 + density * 1.55 + charted * 0.18);
        float alpha = clamp(density * stepLength * 0.018, 0.0, 0.1);
        accumulated.rgb += (1.0 - accumulated.a) * color * alpha;
        accumulated.a += (1.0 - accumulated.a) * alpha;
        distanceAlong += stepLength;
    }

    return accumulated * uniforms.intensity;
}
