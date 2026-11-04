// A note's arrow or dot. It reads _MarkColor, not _Color: the game colours
// every renderer of a note prefab through _Color, and the mark stays white.
Shader "VivifyTest/NoteMark"
{
    Properties
    {
        _MarkColor ("Mark colour", Color) = (1, 1, 1, 1)
        _Cutout ("Cutout", Range(0, 1)) = 0
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry+1" }
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ STEREO_INSTANCING_ON
            #include "TestMapCommon.cginc"

            float4 _MarkColor;
            float _Cutout;

            struct appdata
            {
                float4 vertex : POSITION;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                clip(0.999 - _Cutout);
                return _MarkColor;
            }
            ENDCG
        }
    }
}
