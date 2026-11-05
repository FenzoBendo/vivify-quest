// Custom note bodies and their debris. The game hands each note its colour
// in _Color and dissolves it through _Cutout (both in a property block); a
// debris half is cut by _CutPlane (xyz normal, w offset, object space).
Shader "VivifyTest/Note"
{
    Properties
    {
        _Color ("Color", Color) = (1, 0.2, 0.2, 1)
        _Cutout ("Cutout", Range(0, 1)) = 0
        _CutPlane ("Cut plane", Vector) = (0, 0, 0, 1)
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
            float _Cutout;
            float4 _CutPlane;

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
                float3 local : TEXCOORD1;
                float3 world : TEXCOORD2;
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
                o.local = v.vertex.xyz;
                o.world = mul(unity_ObjectToWorld, v.vertex).xyz;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                clip(dot(i.local, _CutPlane.xyz) + _CutPlane.w);
                clip(TestMapHash(floor(i.local.xy * 40.0) + floor(i.local.z * 40.0)) - _Cutout);
                float3 n = normalize(i.normal);
                float3 view = normalize(_WorldSpaceCameraPos - i.world);
                float facing = saturate(dot(n, view));
                float3 colour = _Color.rgb * (0.35 + 0.65 * facing);
                colour += _Color.rgb * pow(1.0 - facing, 2.0) * 1.5;
                return fixed4(colour, 1);
            }
            ENDCG
        }
    }
}
