// Rain streaks, drawn by a particle system as stretched billboards. Each
// particle's quad becomes a thin streak brightest in its middle. _Intensity is
// animated by the map (SetMaterialProperty).
Shader "VivifyTest/Rain"
{
    Properties
    {
        _Color ("Color", Color) = (0.7, 0.8, 1, 0.5)
        _Intensity ("Intensity", Float) = 0.4
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "Queue" = "Transparent" "IgnoreProjector" = "True" }
        Blend SrcAlpha One
        ZWrite Off
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #pragma multi_compile _ STEREO_INSTANCING_ON
            #include "TestMapCommon.cginc"

            float4 _Color;
            float _Intensity;

            struct appdata
            {
                float4 vertex : POSITION;
                float4 color : COLOR;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float4 color : COLOR;
                float2 uv : TEXCOORD0;
                UNITY_FOG_COORDS(1)
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.color = v.color;
                o.uv = v.uv;
                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float across = 1.0 - abs(i.uv.x * 2.0 - 1.0);
                float along = sin(i.uv.y * 3.14159);
                float alpha = across * across * along * _Color.a * i.color.a * saturate(_Intensity);
                fixed4 result = fixed4(_Color.rgb * i.color.rgb, alpha);
                UNITY_APPLY_FOG_COLOR(i.fogCoord, result, fixed4(0, 0, 0, 0));
                return result;
            }
            ENDCG
        }
    }
}
