// The custom saber's blade: a white core fading into the saber colour, which
// the game sets in _Color.
Shader "VivifyTest/SaberBlade"
{
    Properties
    {
        _Color ("Color", Color) = (0.2, 0.5, 1, 1)
        _Core ("Core", Float) = 0.6
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" }
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ STEREO_INSTANCING_ON
            #include "TestMapCommon.cginc"

            float4 _Color;
            float _Core;

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
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.normal = UnityObjectToWorldNormal(v.normal);
                o.world = mul(unity_ObjectToWorld, v.vertex).xyz;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float facing = saturate(dot(normalize(i.normal), normalize(_WorldSpaceCameraPos - i.world)));
                float3 colour = lerp(_Color.rgb * 1.6, float3(1, 1, 1), smoothstep(1.0 - _Core, 1.0, facing));
                return fixed4(colour, 1);
            }
            ENDCG
        }
    }
}
