// Screen effect (Blit) for the drive: the view runs a little, as through a
// wet window, with a darker, bluer edge. Reads the camera image as a
// screen-space texture, which under single-pass instanced stereo is a
// two-slice array: one of the cases a port's Blit has to get right.
Shader "VivifyTest/WetLens"
{
    Properties
    {
        _MainTex ("Screen", 2D) = "white" {}
        _Amount ("Amount", Float) = 1
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
                float2 uv = i.uv;
                float wobble = sin(uv.y * 40.0 + _Time.y * 2.0) * 0.0015 + sin(uv.x * 23.0 - _Time.y * 1.3) * 0.001;
                uv.x += wobble * _Amount;
                fixed4 colour = UNITY_SAMPLE_SCREENSPACE_TEXTURE(_MainTex, uv);
                float2 c = i.uv * 2.0 - 1.0;
                float vignette = saturate(1.0 - dot(c, c) * 0.35 * _Amount);
                colour.rgb *= vignette;
                colour.rgb = lerp(colour.rgb, colour.rgb * float3(0.85, 0.95, 1.15), 0.5 * _Amount);
                return colour;
            }
            ENDCG
        }
    }
}
