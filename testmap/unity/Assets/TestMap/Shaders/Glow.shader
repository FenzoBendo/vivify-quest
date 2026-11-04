// Additive light: street lamp heads, headlight beams, the sun disc. Fades with
// the view angle so a beam's quads do not show their edges.
Shader "VivifyTest/Glow"
{
    Properties
    {
        _Color ("Color", Color) = (1, 0.8, 0.5, 1)
        _Scroll ("Moves with the road (0/1)", Float) = 0
        _ScrollLength ("Road wrap length", Float) = 160
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "Queue" = "Transparent" "IgnoreProjector" = "True" }
        Blend One One
        ZWrite Off
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ STEREO_INSTANCING_ON
            #include "TestMapCommon.cginc"

            float4 _Color;
            float _Scroll;
            float _ScrollLength;

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
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
                o.pos = mul(UNITY_MATRIX_VP, float4(world, 1.0));
                o.uv = v.uv;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float2 c = i.uv * 2.0 - 1.0;
                float falloff = saturate(1.0 - dot(c, c));
                return fixed4(_Color.rgb * falloff * falloff * max(_TestMapGlow, 0.2), 1);
            }
            ENDCG
        }
    }
}
