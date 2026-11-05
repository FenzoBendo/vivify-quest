// A glow along the four edges of the view, built by a geometry shader.
//
// The mesh is a single point. The geometry stage turns it into four quads
// written straight into clip space (left, right, top and bottom bands), so
// they sit on the edges of each eye's view wherever the player looks. In
// single-pass instanced stereo the eye arrives through the instance ID and
// the geometry stage routes each quad to its eye's layer: this is the
// pattern (grass, fur, screen effects) that drew in one eye only on Quest
// before Vivify Quest 0.15.1.
//
// _EdgeColor and _Pulse are animated by the map (SetMaterialProperty).
Shader "VivifyTest/ScreenEdges"
{
    Properties
    {
        _EdgeColor ("Edge colour", Color) = (0.35, 0.6, 1, 1)
        _Pulse ("Pulse", Float) = 0.25
        _Width ("Width (clip space)", Float) = 0.12
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "Queue" = "Overlay" "IgnoreProjector" = "True" }
        Blend One One
        ZWrite Off
        ZTest Always
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma geometry geom
            #pragma fragment frag
            #pragma target 4.0
            #pragma multi_compile _ STEREO_INSTANCING_ON
            #include "TestMapCommon.cginc"

            float4 _EdgeColor;
            float _Pulse;
            float _Width;

            struct appdata
            {
                float4 vertex : POSITION;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2g
            {
                float4 vertex : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct g2f
            {
                float4 pos : SV_POSITION;
                float inner : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2g vert (appdata v)
            {
                v2g o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                o.vertex = v.vertex;
                return o;
            }

            // One band: corners a (outer) and b (outer), pulled inwards by `inward`.
            void Band (float2 a, float2 b, float2 inward, g2f proto, inout TriangleStream<g2f> stream)
            {
                g2f o = proto;
                o.pos = float4(a, 0.5, 1); o.inner = 0; stream.Append(o);
                o.pos = float4(b, 0.5, 1); o.inner = 0; stream.Append(o);
                o.pos = float4(a + inward, 0.5, 1); o.inner = 1; stream.Append(o);
                o.pos = float4(b + inward, 0.5, 1); o.inner = 1; stream.Append(o);
                stream.RestartStrip();
            }

            [maxvertexcount(16)]
            void geom (point v2g input[1], inout TriangleStream<g2f> stream)
            {
                UNITY_SETUP_INSTANCE_ID(input[0]);
                g2f proto;
                UNITY_INITIALIZE_OUTPUT(g2f, proto);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(proto);
                float w = _Width;
                Band(float2(-1, -1), float2(-1, 1), float2(w, 0), proto, stream);
                Band(float2(1, -1), float2(1, 1), float2(-w, 0), proto, stream);
                Band(float2(-1, 1), float2(1, 1), float2(0, -w), proto, stream);
                Band(float2(-1, -1), float2(1, -1), float2(0, w), proto, stream);
            }

            fixed4 frag (g2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float fade = 1.0 - i.inner;
                return fixed4(_EdgeColor.rgb * fade * fade * saturate(_Pulse), 1);
            }
            ENDCG
        }
    }
}
