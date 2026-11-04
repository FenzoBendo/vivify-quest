// The scenery: the car, the road and its lights, the shore, the character.
// Flat colour with a fixed key light, emission scaled by _TestMapGlow, a rim
// light, fog, and three vertex motions the map uses: road scroll, car bob,
// water waves.
Shader "VivifyTest/Unlit"
{
    Properties
    {
        _Color ("Color", Color) = (1, 1, 1, 1)
        _Emission ("Emission", Float) = 0
        _Rim ("Rim light", Float) = 0
        _RimColor ("Rim colour", Color) = (1, 1, 1, 1)
        _Scroll ("Moves with the road (0/1)", Float) = 0
        _ScrollLength ("Road wrap length", Float) = 160
        _Bob ("Car bob", Float) = 0
        _Wave ("Water waves", Float) = 0
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" }
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #pragma multi_compile _ STEREO_INSTANCING_ON
            #include "TestMapCommon.cginc"

            float4 _Color;
            float _Emission;
            float _Rim;
            float4 _RimColor;
            float _Scroll;
            float _ScrollLength;
            float _Bob;
            float _Wave;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float3 normal : TEXCOORD0;
                float3 world : TEXCOORD1;
                UNITY_FOG_COORDS(2)
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                float3 world = mul(unity_ObjectToWorld, v.vertex).xyz;
                world = TestMapScroll(world, _Scroll, _ScrollLength);
                world.y += _Bob * (sin(_Time.y * 9.0) * 0.006 + sin(_Time.y * 2.3) * 0.01);
                world.y += _Wave * (sin(world.x * 0.35 + _Time.y * 1.2) * 0.12 + sin(world.z * 0.5 - _Time.y * 0.9) * 0.08);
                o.world = world;
                o.normal = UnityObjectToWorldNormal(v.normal);
                o.pos = mul(UNITY_MATRIX_VP, float4(world, 1.0));
                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float3 n = normalize(i.normal);
                float key = 0.55 + 0.45 * saturate(dot(n, normalize(float3(0.3, 0.8, -0.4))));
                float3 colour = _Color.rgb * key;
                colour += _Color.rgb * _Emission * max(_TestMapGlow, 0.2);
                float3 view = normalize(_WorldSpaceCameraPos - i.world);
                colour += _RimColor.rgb * _Rim * pow(1.0 - saturate(dot(n, view)), 3.0);
                fixed4 result = fixed4(colour, 1);
                UNITY_APPLY_FOG(i.fogCoord, result);
                return result;
            }
            ENDCG
        }
    }
}
