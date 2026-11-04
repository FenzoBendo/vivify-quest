// Builds the Vivify Quest test map's asset bundle (bundleWindows2021.vivify)
// from nothing but code and the shaders in Assets/TestMap/Shaders: every mesh,
// material and prefab is generated here, so the repository holds no binary
// art and CI can rebuild it from scratch.
//
//   Unity menu:  Vivify > Build Test Map
//   CI:          -executeMethod VivifyTestMap.BuildTestMap.BuildFromCommandLine
//                (.github/workflows/build-test-map.yml)
//
// The bundle and its CRC (bundle_crc.txt, for Info.dat's _assetBundle) are
// written to ../../map, beside the map's .dat files.
//
// Scenes (asset paths are what the map's events name, lower-cased):
//   drive.prefab        a car the player stands in, driving through rain at
//                       night: road stripes and street lights scroll past
//   rain.prefab         a particle system of rain streaks
//   screenedges.prefab  a one-point mesh a geometry shader turns into a glow
//                       along the edges of the view
//   shore.prefab        the second scene: a shore at dusk and an original
//                       character sitting on a rock by the water
//   note/notedot/debris/saber.prefab  custom notes, debris and sabers
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace VivifyTestMap
{
    public static class BuildTestMap
    {
        const string Root = "Assets/TestMap";
        const string BundleName = "bundleWindows2021.vivify";

        static readonly List<string> BundleAssets = new List<string>();

        [MenuItem("Vivify/Build Test Map")]
        public static void BuildFromMenu()
        {
            Build();
            EditorUtility.DisplayDialog("Vivify test map", "Built " + OutputPath(), "OK");
        }

        public static void BuildFromCommandLine()
        {
            try
            {
                Build();
                EditorApplication.Exit(0);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                EditorApplication.Exit(1);
            }
        }

        static string MapDirectory()
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "map"));
        }

        static string OutputPath()
        {
            return Path.Combine(MapDirectory(), BundleName);
        }

        static void Build()
        {
            BundleAssets.Clear();
            foreach (var folder in new[] { "Meshes", "Materials", "Prefabs" })
            {
                string path = Root + "/" + folder;
                if (AssetDatabase.IsValidFolder(path)) AssetDatabase.DeleteAsset(path);
                AssetDatabase.CreateFolder(Root, folder);
            }
            AssetDatabase.Refresh();

            var m = new Materials();
            BuildDrive(m);
            BuildRain(m);
            BuildScreenEdges(m);
            BuildShore(m);
            BuildNotes(m);
            BuildSaber(m);
            AssetDatabase.SaveAssets();

            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.StandaloneWindows64, new[] { GraphicsDeviceType.Direct3D11 });

            string staging = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Temp", "TestMapBundle"));
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            Directory.CreateDirectory(staging);
            var build = new AssetBundleBuild
            {
                assetBundleName = BundleName,
                assetNames = BundleAssets.ToArray()
            };
            var manifest = BuildPipeline.BuildAssetBundles(staging, new[] { build },
                BuildAssetBundleOptions.ChunkBasedCompression | BuildAssetBundleOptions.ForceRebuildAssetBundle,
                BuildTarget.StandaloneWindows64);
            if (manifest == null) throw new Exception("BuildAssetBundles failed");

            string built = Path.Combine(staging, BundleName.ToLowerInvariant());
            if (!File.Exists(built)) built = Path.Combine(staging, BundleName);
            Directory.CreateDirectory(MapDirectory());
            File.Copy(built, OutputPath(), true);
            if (!BuildPipeline.GetCRCForAssetBundle(built, out uint crc)) throw new Exception("no CRC for the bundle");
            File.WriteAllText(Path.Combine(MapDirectory(), "bundle_crc.txt"), crc.ToString());
            Debug.Log("Vivify test map: wrote " + OutputPath() + " (crc " + crc + ", " + BundleAssets.Count + " assets)");
        }

        // ------------------------------------------------------------------
        // Materials
        // ------------------------------------------------------------------

        class Materials
        {
            readonly Dictionary<string, Material> cache = new Dictionary<string, Material>();

            public Material Get(string name, string shader, Action<Material> setup, bool inBundle = false)
            {
                if (cache.TryGetValue(name, out var existing)) return existing;
                var found = Shader.Find(shader);
                if (found == null) throw new Exception("shader not found: " + shader);
                var material = new Material(found) { name = name };
                setup?.Invoke(material);
                string path = Root + "/Materials/" + name + ".mat";
                AssetDatabase.CreateAsset(material, path);
                if (inBundle) BundleAssets.Add(path);
                cache[name] = material;
                return material;
            }

            public Material Unlit(string name, Color color, float emission = 0, float scroll = 0, float bob = 0,
                float wave = 0, float rim = 0)
            {
                return Get(name, "VivifyTest/Unlit", mat =>
                {
                    mat.SetColor("_Color", color);
                    mat.SetFloat("_Emission", emission);
                    mat.SetFloat("_Scroll", scroll);
                    mat.SetFloat("_Bob", bob);
                    mat.SetFloat("_Wave", wave);
                    mat.SetFloat("_Rim", rim);
                    mat.SetColor("_RimColor", new Color(1f, 0.7f, 0.5f, 1f));
                });
            }

            public Material Glow(string name, Color color, float scroll = 0)
            {
                return Get(name, "VivifyTest/Glow", mat =>
                {
                    mat.SetColor("_Color", color);
                    mat.SetFloat("_Scroll", scroll);
                });
            }
        }

        // ------------------------------------------------------------------
        // Meshes
        // ------------------------------------------------------------------

        static readonly Dictionary<string, Mesh> Meshes = new Dictionary<string, Mesh>();

        static Mesh SaveMesh(string name, Mesh mesh)
        {
            mesh.name = name;
            mesh.RecalculateBounds();
            AssetDatabase.CreateAsset(mesh, Root + "/Meshes/" + name + ".asset");
            Meshes[name] = mesh;
            return mesh;
        }

        static Mesh Box()
        {
            if (Meshes.TryGetValue("box", out var cached)) return cached;
            var vertices = new List<Vector3>();
            var normals = new List<Vector3>();
            var uvs = new List<Vector2>();
            var triangles = new List<int>();
            Vector3[] faceNormals = { Vector3.right, Vector3.left, Vector3.up, Vector3.down, Vector3.forward, Vector3.back };
            foreach (var n in faceNormals)
            {
                Vector3 u = Mathf.Abs(n.y) > 0.5f ? Vector3.right : Vector3.up;
                Vector3 v = Vector3.Cross(n, u);
                int start = vertices.Count;
                for (int i = 0; i < 4; i++)
                {
                    float a = (i == 0 || i == 3) ? -0.5f : 0.5f;
                    float b = (i < 2) ? -0.5f : 0.5f;
                    vertices.Add(n * 0.5f + u * a + v * b);
                    normals.Add(n);
                    uvs.Add(new Vector2(a + 0.5f, b + 0.5f));
                }
                triangles.AddRange(new[] { start, start + 1, start + 2, start, start + 2, start + 3 });
            }
            var mesh = new Mesh();
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(triangles, 0);
            FixWinding(mesh);
            return SaveMesh("box", mesh);
        }

        // Makes every triangle face along its vertices' normal, so the face
        // construction above does not have to get the winding right by hand.
        static void FixWinding(Mesh mesh)
        {
            var v = mesh.vertices;
            var n = mesh.normals;
            var t = mesh.triangles;
            for (int i = 0; i < t.Length; i += 3)
            {
                Vector3 face = Vector3.Cross(v[t[i + 1]] - v[t[i]], v[t[i + 2]] - v[t[i]]);
                if (Vector3.Dot(face, n[t[i]]) < 0)
                {
                    int swap = t[i + 1];
                    t[i + 1] = t[i + 2];
                    t[i + 2] = swap;
                }
            }
            mesh.triangles = t;
        }

        static Mesh Cylinder()
        {
            if (Meshes.TryGetValue("cylinder", out var cached)) return cached;
            const int segments = 20;
            var vertices = new List<Vector3>();
            var normals = new List<Vector3>();
            var uvs = new List<Vector2>();
            var triangles = new List<int>();
            for (int i = 0; i <= segments; i++)
            {
                float a = i * Mathf.PI * 2 / segments;
                var n = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                vertices.Add(n * 0.5f + Vector3.down * 0.5f); normals.Add(n); uvs.Add(new Vector2(i / (float)segments, 0));
                vertices.Add(n * 0.5f + Vector3.up * 0.5f); normals.Add(n); uvs.Add(new Vector2(i / (float)segments, 1));
            }
            for (int i = 0; i < segments; i++)
            {
                int a = i * 2;
                triangles.AddRange(new[] { a, a + 1, a + 2, a + 1, a + 3, a + 2 });
            }
            foreach (float y in new[] { -0.5f, 0.5f })
            {
                int centre = vertices.Count;
                var n = new Vector3(0, Mathf.Sign(y), 0);
                vertices.Add(new Vector3(0, y, 0)); normals.Add(n); uvs.Add(new Vector2(0.5f, 0.5f));
                for (int i = 0; i <= segments; i++)
                {
                    float a = i * Mathf.PI * 2 / segments;
                    vertices.Add(new Vector3(Mathf.Cos(a) * 0.5f, y, Mathf.Sin(a) * 0.5f)); normals.Add(n);
                    uvs.Add(new Vector2(Mathf.Cos(a) * 0.5f + 0.5f, Mathf.Sin(a) * 0.5f + 0.5f));
                }
                for (int i = 0; i < segments; i++) triangles.AddRange(new[] { centre, centre + 1 + i, centre + 2 + i });
            }
            var mesh = new Mesh();
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(triangles, 0);
            FixWinding(mesh);
            return SaveMesh("cylinder", mesh);
        }

        static Mesh Sphere()
        {
            if (Meshes.TryGetValue("sphere", out var cached)) return cached;
            const int rings = 12, segments = 20;
            var vertices = new List<Vector3>();
            var normals = new List<Vector3>();
            var uvs = new List<Vector2>();
            var triangles = new List<int>();
            for (int r = 0; r <= rings; r++)
            {
                float phi = Mathf.PI * r / rings;
                for (int s = 0; s <= segments; s++)
                {
                    float theta = Mathf.PI * 2 * s / segments;
                    var n = new Vector3(Mathf.Sin(phi) * Mathf.Cos(theta), Mathf.Cos(phi), Mathf.Sin(phi) * Mathf.Sin(theta));
                    vertices.Add(n * 0.5f); normals.Add(n); uvs.Add(new Vector2(s / (float)segments, r / (float)rings));
                }
            }
            for (int r = 0; r < rings; r++)
            {
                for (int s = 0; s < segments; s++)
                {
                    int a = r * (segments + 1) + s, b = a + segments + 1;
                    triangles.AddRange(new[] { a, b, a + 1, a + 1, b, b + 1 });
                }
            }
            var mesh = new Mesh();
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(triangles, 0);
            FixWinding(mesh);
            return SaveMesh("sphere", mesh);
        }

        // A quad in the XY plane, facing -Z (towards a player looking along +Z).
        static Mesh Quad()
        {
            if (Meshes.TryGetValue("quad", out var cached)) return cached;
            var mesh = new Mesh();
            mesh.SetVertices(new List<Vector3> { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(0.5f, 0.5f, 0), new Vector3(-0.5f, 0.5f, 0) });
            mesh.SetNormals(new List<Vector3> { Vector3.back, Vector3.back, Vector3.back, Vector3.back });
            mesh.SetUVs(0, new List<Vector2> { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) });
            mesh.SetTriangles(new List<int> { 0, 1, 2, 0, 2, 3 }, 0);
            FixWinding(mesh);
            return SaveMesh("quad", mesh);
        }

        // A flat grid in the XZ plane for the water, fine enough to wave.
        static Mesh Grid()
        {
            if (Meshes.TryGetValue("grid", out var cached)) return cached;
            const int cells = 48;
            var vertices = new List<Vector3>();
            var normals = new List<Vector3>();
            var uvs = new List<Vector2>();
            var triangles = new List<int>();
            for (int z = 0; z <= cells; z++)
            {
                for (int x = 0; x <= cells; x++)
                {
                    vertices.Add(new Vector3(x / (float)cells - 0.5f, 0, z / (float)cells - 0.5f));
                    normals.Add(Vector3.up);
                    uvs.Add(new Vector2(x / (float)cells, z / (float)cells));
                }
            }
            for (int z = 0; z < cells; z++)
            {
                for (int x = 0; x < cells; x++)
                {
                    int a = z * (cells + 1) + x, b = a + cells + 1;
                    triangles.AddRange(new[] { a, b, a + 1, a + 1, b, b + 1 });
                }
            }
            var mesh = new Mesh { indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(triangles, 0);
            FixWinding(mesh);
            return SaveMesh("grid", mesh);
        }

        // One point, with bounds large enough that it is never culled: the
        // geometry shader draws the screen edges from it.
        static Mesh Point()
        {
            if (Meshes.TryGetValue("point", out var cached)) return cached;
            var mesh = new Mesh();
            mesh.SetVertices(new List<Vector3> { Vector3.zero });
            mesh.SetIndices(new[] { 0 }, MeshTopology.Points, 0);
            mesh.name = "point";
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 100000f);
            AssetDatabase.CreateAsset(mesh, Root + "/Meshes/point.asset");
            Meshes["point"] = mesh;
            return mesh;
        }

        // A note's arrow: a flat chevron pointing down (-Y), facing -Z.
        static Mesh Arrow()
        {
            if (Meshes.TryGetValue("arrow", out var cached)) return cached;
            var mesh = new Mesh();
            mesh.SetVertices(new List<Vector3>
            {
                new Vector3(-0.16f, 0.06f, 0), new Vector3(0.16f, 0.06f, 0), new Vector3(0, -0.1f, 0),
            });
            mesh.SetNormals(new List<Vector3> { Vector3.back, Vector3.back, Vector3.back });
            mesh.SetTriangles(new List<int> { 0, 1, 2 }, 0);
            FixWinding(mesh);
            return SaveMesh("arrow", mesh);
        }

        // ------------------------------------------------------------------
        // Scene building
        // ------------------------------------------------------------------

        static GameObject Part(Transform parent, string name, Mesh mesh, Material material, Vector3 position,
            Vector3 scale, Vector3 euler = default)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = position;
            go.transform.localEulerAngles = euler;
            go.transform.localScale = scale;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return go;
        }

        static void SavePrefab(GameObject root, string name)
        {
            string path = Root + "/Prefabs/" + name + ".prefab";
            PrefabUtility.SaveAsPrefabAsset(root, path);
            UnityEngine.Object.DestroyImmediate(root);
            BundleAssets.Add(path);
        }

        static void BuildDrive(Materials m)
        {
            var root = new GameObject("Drive").transform;
            var asphalt = m.Unlit("asphalt", new Color(0.05f, 0.05f, 0.06f));
            var stripe = m.Unlit("stripe", new Color(0.8f, 0.75f, 0.5f), emission: 0.3f, scroll: 1);
            var pole = m.Unlit("pole", new Color(0.15f, 0.16f, 0.18f), scroll: 1);
            var lamp = m.Glow("lamp", new Color(1f, 0.75f, 0.4f), scroll: 1);
            var body = m.Unlit("carbody", new Color(0.32f, 0.08f, 0.07f), bob: 1, rim: 0.4f);
            var trim = m.Unlit("cartrim", new Color(0.08f, 0.08f, 0.09f), bob: 1);
            var dash = m.Unlit("dashlights", new Color(0.3f, 0.7f, 1f), emission: 1.5f, bob: 1);
            var beam = m.Glow("headlight", new Color(0.55f, 0.5f, 0.4f));
            var glass = m.Get("windshield", "VivifyTest/Windshield", null);
            var ground = m.Unlit("verge", new Color(0.03f, 0.05f, 0.04f));

            // The road and the verges either side; the road stays put, what is
            // on it moves.
            Part(root, "Road", Box(), asphalt, new Vector3(0, -0.62f, 60), new Vector3(9, 0.1f, 200));
            Part(root, "VergeLeft", Box(), ground, new Vector3(-30, -0.65f, 60), new Vector3(42, 0.1f, 200));
            Part(root, "VergeRight", Box(), ground, new Vector3(30, -0.65f, 60), new Vector3(42, 0.1f, 200));
            for (int i = 0; i < 20; i++)
            {
                Part(root, "Stripe" + i, Box(), stripe, new Vector3(0, -0.56f, -10 + i * 8), new Vector3(0.15f, 0.02f, 3));
            }
            for (int i = 0; i < 8; i++)
            {
                foreach (float side in new[] { -1f, 1f })
                {
                    var light = new GameObject("StreetLight" + i + (side < 0 ? "L" : "R")).transform;
                    light.SetParent(root, false);
                    light.localPosition = new Vector3(side * 6.5f, 0, -10 + i * 20 + (side > 0 ? 10 : 0));
                    Part(light, "Pole", Cylinder(), pole, new Vector3(0, 2.4f, 0), new Vector3(0.15f, 6f, 0.15f));
                    Part(light, "Arm", Box(), pole, new Vector3(-side * 0.9f, 5.35f, 0), new Vector3(1.8f, 0.1f, 0.1f));
                    Part(light, "Lamp", Quad(), lamp, new Vector3(-side * 1.7f, 5.2f, 0), new Vector3(1.6f, 1.6f, 1f));
                }
            }

            // The car, around the player: kept below the note lanes and outside
            // the saber reach, so nothing blocks play.
            var car = new GameObject("Car").transform;
            car.SetParent(root, false);
            Part(car, "Floor", Box(), trim, new Vector3(0, -0.08f, 0), new Vector3(3.4f, 0.1f, 4.2f));
            Part(car, "Hood", Box(), body, new Vector3(0, -0.02f, 3.1f), new Vector3(3.2f, 0.22f, 2.2f));
            Part(car, "Trunk", Box(), body, new Vector3(0, 0.05f, -2.6f), new Vector3(3.2f, 0.4f, 1.2f));
            foreach (float side in new[] { -1f, 1f })
            {
                Part(car, "Door" + side, Box(), body, new Vector3(side * 1.75f, 0.35f, 0), new Vector3(0.12f, 0.9f, 4.2f));
                Part(car, "Pillar" + side, Box(), trim, new Vector3(side * 1.65f, 1.15f, 1.55f), new Vector3(0.08f, 2.5f, 0.08f),
                    new Vector3(-28, 0, 0));
                Part(car, "Rail" + side, Box(), trim, new Vector3(side * 1.65f, 2.25f, -0.4f), new Vector3(0.08f, 0.08f, 3.2f));
                Part(car, "Beam" + side, Quad(), beam, new Vector3(side * 1.1f, 0.15f, 9f), new Vector3(2.2f, 1.2f, 14f),
                    new Vector3(90, 0, 0));
                Part(car, "Wheel" + side + "F", Cylinder(), trim, new Vector3(side * 1.8f, -0.25f, 2.6f), new Vector3(0.75f, 0.3f, 0.75f),
                    new Vector3(0, 0, 90));
                Part(car, "Wheel" + side + "R", Cylinder(), trim, new Vector3(side * 1.8f, -0.25f, -2.2f), new Vector3(0.75f, 0.3f, 0.75f),
                    new Vector3(0, 0, 90));
            }
            Part(car, "RoofFront", Box(), trim, new Vector3(0, 2.25f, 1.2f), new Vector3(3.3f, 0.08f, 0.08f));
            Part(car, "Windshield", Quad(), glass, new Vector3(0, 1.2f, 1.6f), new Vector3(3.2f, 2.4f, 1f), new Vector3(-28, 0, 0));
            Part(car, "DashGlow", Box(), dash, new Vector3(0, 0.1f, 1.95f), new Vector3(2.6f, 0.03f, 0.05f));
            SavePrefab(root.gameObject, "drive");
        }

        static void BuildRain(Materials m)
        {
            var rainMaterial = m.Get("rain", "VivifyTest/Rain", mat =>
            {
                mat.SetColor("_Color", new Color(0.75f, 0.85f, 1f, 0.55f));
                mat.SetFloat("_Intensity", 0.4f);
            }, inBundle: true);
            var go = new GameObject("Rain");
            go.transform.position = new Vector3(0, 14, 18);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = true;
            main.duration = 5f;
            main.prewarm = true;
            main.playOnAwake = true;
            main.startLifetime = 1.3f;
            main.startSpeed = 0f;
            main.startSize = 0.025f;
            main.startColor = new Color(1, 1, 1, 1);
            main.maxParticles = 2500;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var emission = ps.emission;
            emission.rateOverTime = 1400f;
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(30f, 1f, 50f);
            var velocity = ps.velocityOverLifetime;
            velocity.enabled = true;
            velocity.space = ParticleSystemSimulationSpace.World;
            velocity.x = new ParticleSystem.MinMaxCurve(0f);
            velocity.y = new ParticleSystem.MinMaxCurve(-14f);
            velocity.z = new ParticleSystem.MinMaxCurve(-9f);
            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Stretch;
            renderer.velocityScale = 0.05f;
            renderer.lengthScale = 1f;
            renderer.sharedMaterial = rainMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            SavePrefab(go, "rain");
        }

        static void BuildScreenEdges(Materials m)
        {
            var material = m.Get("screenedges", "VivifyTest/ScreenEdges", mat =>
            {
                mat.SetColor("_EdgeColor", new Color(0.35f, 0.6f, 1f, 1f));
                mat.SetFloat("_Pulse", 0.25f);
                mat.SetFloat("_Width", 0.12f);
            }, inBundle: true);
            var go = new GameObject("ScreenEdges");
            go.AddComponent<MeshFilter>().sharedMesh = Point();
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            SavePrefab(go, "screenedges");
        }

        static void BuildShore(Materials m)
        {
            var root = new GameObject("Shore").transform;
            var water = m.Unlit("water", new Color(0.18f, 0.2f, 0.32f), wave: 1, rim: 0.6f);
            var sand = m.Unlit("sand", new Color(0.45f, 0.36f, 0.3f));
            var rock = m.Unlit("rock", new Color(0.2f, 0.18f, 0.2f), rim: 0.3f);
            var sun = m.Glow("sun", new Color(1f, 0.55f, 0.3f));
            // The character: original, made of simple shapes, sitting on a
            // rock and looking out at the water. Raincoat, scarf, dark hair.
            var coat = m.Unlit("coat", new Color(0.85f, 0.45f, 0.12f), rim: 0.8f);
            var scarf = m.Unlit("scarf", new Color(0.25f, 0.45f, 0.35f), rim: 0.5f);
            var skin = m.Unlit("skin", new Color(0.86f, 0.68f, 0.56f), rim: 0.5f);
            var hair = m.Unlit("hair", new Color(0.12f, 0.08f, 0.07f), rim: 0.6f);
            var trousers = m.Unlit("trousers", new Color(0.12f, 0.13f, 0.18f), rim: 0.3f);

            Part(root, "Water", Grid(), water, new Vector3(0, -0.45f, 40), new Vector3(140, 1, 90));
            Part(root, "Sand", Box(), sand, new Vector3(0, -0.6f, -4), new Vector3(60, 0.3f, 16));
            Part(root, "Sun", Quad(), sun, new Vector3(-30, 6, 120), new Vector3(30, 30, 1));
            Part(root, "Rock1", Box(), rock, new Vector3(-4.5f, -0.1f, 6), new Vector3(2.2f, 1.1f, 1.6f), new Vector3(0, 20, 6));
            Part(root, "Rock2", Box(), rock, new Vector3(5.5f, -0.2f, 9), new Vector3(3f, 1.4f, 2f), new Vector3(8, -30, 0));
            Part(root, "Rock3", Box(), rock, new Vector3(9, -0.3f, 4), new Vector3(1.6f, 0.8f, 1.4f), new Vector3(0, 45, 12));

            var figure = new GameObject("Character").transform;
            figure.SetParent(root, false);
            figure.localPosition = new Vector3(-4.5f, 0.45f, 6f);
            figure.localEulerAngles = new Vector3(0, 30, 0);
            Part(figure, "Torso", Cylinder(), coat, new Vector3(0, 0.45f, 0), new Vector3(0.42f, 0.6f, 0.3f));
            Part(figure, "Hips", Box(), trousers, new Vector3(0, 0.1f, 0.05f), new Vector3(0.4f, 0.18f, 0.32f));
            foreach (float side in new[] { -1f, 1f })
            {
                Part(figure, "Thigh" + side, Cylinder(), trousers, new Vector3(side * 0.11f, 0.08f, 0.28f), new Vector3(0.14f, 0.45f, 0.14f),
                    new Vector3(90, 0, 0));
                Part(figure, "Shin" + side, Cylinder(), trousers, new Vector3(side * 0.11f, -0.2f, 0.5f), new Vector3(0.12f, 0.45f, 0.12f));
                Part(figure, "Arm" + side, Cylinder(), coat, new Vector3(side * 0.25f, 0.42f, 0.1f), new Vector3(0.11f, 0.5f, 0.11f),
                    new Vector3(-30, 0, side * 10));
                Part(figure, "Hand" + side, Sphere(), skin, new Vector3(side * 0.22f, 0.18f, 0.28f), new Vector3(0.09f, 0.09f, 0.09f));
            }
            Part(figure, "Scarf", Cylinder(), scarf, new Vector3(0, 0.8f, 0), new Vector3(0.28f, 0.1f, 0.26f));
            Part(figure, "Head", Sphere(), skin, new Vector3(0, 1.0f, 0), new Vector3(0.24f, 0.28f, 0.25f));
            Part(figure, "Hair", Sphere(), hair, new Vector3(0, 1.06f, -0.03f), new Vector3(0.27f, 0.26f, 0.27f));
            SavePrefab(root.gameObject, "shore");
        }

        static void BuildNotes(Materials m)
        {
            var noteMaterial = m.Get("note", "VivifyTest/Note", mat => mat.SetColor("_Color", Color.red));
            var markMaterial = m.Get("notemark", "VivifyTest/NoteMark", mat => mat.SetColor("_MarkColor", Color.white));

            var note = new GameObject("Note").transform;
            Part(note, "Body", Box(), noteMaterial, Vector3.zero, Vector3.one * 0.42f);
            Part(note, "Arrow", Arrow(), markMaterial, new Vector3(0, 0, -0.215f), Vector3.one);
            SavePrefab(note.gameObject, "note");

            var dot = new GameObject("NoteDot").transform;
            Part(dot, "Body", Box(), noteMaterial, Vector3.zero, Vector3.one * 0.42f);
            Part(dot, "Dot", Sphere(), markMaterial, new Vector3(0, 0, -0.215f), new Vector3(0.1f, 0.1f, 0.02f));
            SavePrefab(dot.gameObject, "notedot");

            var debris = new GameObject("Debris").transform;
            Part(debris, "Body", Box(), noteMaterial, Vector3.zero, Vector3.one * 0.42f);
            SavePrefab(debris.gameObject, "debris");
        }

        static void BuildSaber(Materials m)
        {
            var blade = m.Get("saberblade", "VivifyTest/SaberBlade", mat =>
            {
                mat.SetColor("_Color", new Color(0.2f, 0.5f, 1f));
                mat.SetFloat("_Core", 0.6f);
            });
            var handle = m.Unlit("saberhandle", new Color(0.12f, 0.12f, 0.14f), rim: 0.4f);
            m.Get("sabertrail", "VivifyTest/SaberTrail", mat => mat.SetColor("_Color", Color.white), inBundle: true);

            // The game holds a saber at its origin and points it along +Z.
            var saber = new GameObject("Saber").transform;
            Part(saber, "Handle", Cylinder(), handle, new Vector3(0, 0, 0.08f), new Vector3(0.045f, 0.13f, 0.045f), new Vector3(90, 0, 0));
            Part(saber, "Blade", Cylinder(), blade, new Vector3(0, 0, 0.6f), new Vector3(0.03f, 0.4f, 0.03f), new Vector3(90, 0, 0));
            SavePrefab(saber.gameObject, "saber");

            // Materials named by the map's events directly, not through a prefab.
            m.Get("wetlens", "VivifyTest/WetLens", mat => mat.SetFloat("_Amount", 1f), inBundle: true);
            m.Get("flash", "VivifyTest/Flash", mat => mat.SetFloat("_Amount", 0f), inBundle: true);
            m.Get("nightsky", "VivifyTest/Sky", mat =>
            {
                mat.SetColor("_Zenith", new Color(0.01f, 0.015f, 0.04f));
                mat.SetColor("_Horizon", new Color(0.08f, 0.1f, 0.16f));
                mat.SetFloat("_Stars", 1f);
                mat.SetColor("_SunColor", Color.black);
            }, inBundle: true);
            m.Get("dusksky", "VivifyTest/Sky", mat =>
            {
                mat.SetColor("_Zenith", new Color(0.12f, 0.1f, 0.25f));
                mat.SetColor("_Horizon", new Color(0.95f, 0.5f, 0.35f));
                mat.SetFloat("_Stars", 0.3f);
                mat.SetColor("_SunColor", new Color(1f, 0.6f, 0.3f));
                mat.SetVector("_SunDirection", new Vector4(-0.25f, 0.05f, 1f, 0f));
            }, inBundle: true);
        }
    }
}
