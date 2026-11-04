// Screen effect (Blit) for the switch between the two scenes: the view goes
// to warm white and back, by _Amount (animated in the Blit event itself).
Shader "VivifyTest/Flash"
{
    Properties
    {
        _MainTex ("Screen", 2D) = "white" {}
        _Amount ("Amount", Float) = 0
        _FlashColor ("Flash colour", Color) = (1, 0.92, 0.85, 1)
    }
    SubShader
    {
        Cull Off
        ZWrite Off
        ZTest Always
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ STEREO_INSTANCING_ON
            #include "TestMapCommon.cginc"

            UNITY_DECLARE_SCREENSPACE_TEXTURE(_MainTex);
            float _Amount;
            float4 _FlashColor;

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
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                fixed4 colour = UNITY_SAMPLE_SCREENSPACE_TEXTURE(_MainTex, i.uv);
                colour.rgb = lerp(colour.rgb, _FlashColor.rgb, saturate(_Amount));
                return colour;
            }
            ENDCG
        }
    }
}
