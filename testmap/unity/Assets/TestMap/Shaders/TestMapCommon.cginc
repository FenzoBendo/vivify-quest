// Shared by the Vivify Quest test map's shaders.
//
// Every shader here is written for single-pass instanced stereo, the way PC
// Beat Saber renders and the way a real Vivify map's shaders have to be: each
// declares STEREO_INSTANCING_ON itself (so the stereo variants are built
// without an XR package in this project) and uses Unity's stereo macros. The
// Quest port has to turn those variants into multiview programs, which is a
// large part of what this map tests.
#ifndef TESTMAP_COMMON_INCLUDED
#define TESTMAP_COMMON_INCLUDED

#include "UnityCG.cginc"

// Animated by the map (SetGlobalProperty): how brightly the street lights,
// headlights and dashboard glow.
float _TestMapGlow;

// The road moves, not the car: an object with _Scroll 1 slides towards the
// player at 18 m/s and wraps around every `len` metres, by its own origin so
// it never tears. Ahead of the player is +z.
float3 TestMapScroll(float3 world, float amount, float len)
{
    if (amount <= 0.0) return world;
    float3 origin = mul(unity_ObjectToWorld, float4(0, 0, 0, 1)).xyz;
    float z = origin.z - _Time.y * 18.0 * amount;
    float wrapped = z - len * floor((z + 12.0) / len);
    world.z += wrapped - origin.z;
    return world;
}

float TestMapHash(float2 p)
{
    p = frac(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return frac(p.x * p.y);
}

#endif
