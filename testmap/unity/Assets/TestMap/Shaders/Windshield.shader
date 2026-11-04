// The windshield: nearly clear glass with raindrops that run down it.
// Procedural: the glass is cut into cells, each holding a drop that slides at
// its own speed. Kept faint, since the notes come through it.
Shader "VivifyTest/Windshield"
{
    Properties
    {
        _Color ("Glass tint", Color) = (0.6, 0.75, 0.9, 0.06)
        _DropColor ("Drop colour", Color) = (0.85, 0.9, 1, 0.35)
        _Cells ("Drop cells", Float) = 18
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "Queue" = "Transparent" "IgnoreProjector" = "True" }
        Blend SrcAlpha OneMinusSrcAlpha
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
            float4 _DropColor;
            float _Cells;

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
                float2 grid = float2(_Cells, _Cells * 0.6);
                float2 cell = floor(i.uv * grid);
                float seed = TestMapHash(cell);
                float slide = frac(_Time.y * (0.05 + seed * 0.12) + seed);
                float2 local = frac(i.uv * grid) - float2(0.5, 1.0 - slide);
                local.x *= 1.6;
                float drop = smoothstep(0.12, 0.05, length(local)) * step(0.35, seed);
                float alpha = _Color.a + drop * _DropColor.a;
                float3 colour = lerp(_Color.rgb, _DropColor.rgb, saturate(drop));
                return fixed4(colour, alpha);
            }
            ENDCG
        }
    }
}
