// Skybox for both scenes: a gradient from horizon to zenith, stars, and an
// optional sun disc. The map swaps the night material for the dusk one
// (SetRenderingSettings skybox).
Shader "VivifyTest/Sky"
{
    Properties
    {
        _Zenith ("Zenith", Color) = (0.02, 0.03, 0.08, 1)
        _Horizon ("Horizon", Color) = (0.1, 0.12, 0.2, 1)
        _Stars ("Stars", Float) = 1
        _SunColor ("Sun colour", Color) = (0, 0, 0, 1)
        _SunDirection ("Sun direction", Vector) = (0, 0.1, 1, 0)
    }
    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Background" "PreviewType" = "Skybox" }
        Cull Off
        ZWrite Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ STEREO_INSTANCING_ON
            #include "TestMapCommon.cginc"

            float4 _Zenith;
            float4 _Horizon;
            float _Stars;
            float4 _SunColor;
            float4 _SunDirection;

            struct appdata
            {
                float4 vertex : POSITION;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float3 dir : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.dir = v.vertex.xyz;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float3 d = normalize(i.dir);
                float up = saturate(d.y);
                float3 colour = lerp(_Horizon.rgb, _Zenith.rgb, pow(up, 0.6));
                float2 cell = floor(float2(atan2(d.x, d.z), asin(d.y)) * 180.0);
                float star = step(0.997, TestMapHash(cell)) * up * _Stars;
                colour += star;
                float sun = pow(saturate(dot(d, normalize(_SunDirection.xyz))), 400.0);
                colour += _SunColor.rgb * (sun * 4.0 + pow(saturate(dot(d, normalize(_SunDirection.xyz))), 8.0) * 0.4);
                return fixed4(colour, 1);
            }
            ENDCG
        }
    }
}
