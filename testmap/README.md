# Vivify Quest test map

A Windows (PC) Vivify map made for this port, both to play and to check what
a dev build gets right. **Settings > Vivify > Diagnostics > Test Vivify**
installs it. It is built like any PC Vivify map, so the Quest port converts
it on the headset exactly as it converts other people's maps.

**Song:** Mud Flow, *The Sense of Me / Chemicals* (8:40). The song is not
included: it is a commercial track. Bring your own copy (below).
**Map, assets and shaders:** Vivify Quest (Rayla & Claude). Everything in
the bundle is generated from code in this folder.

## What it tests

| Part of the map | What it exercises in the port |
| --- | --- |
| A car you stand in, driving at night: road stripes and street lights scroll past, the body bobs | prefabs (`InstantiatePrefab`), vertex animation, fog, `SetRenderingSettings` (fog, ambient, skybox) |
| Rain | a particle system with stretched billboards; `SetMaterialProperty` on its material |
| Raindrops running down the windshield | a transparent procedural shader |
| A glow on the edges of your view | a **geometry shader** fed by a one-point mesh, routing each eye's quads by single-pass stereo |
| Custom notes, dots and debris | `AssignObjectPrefab` colorNotes, `_Color` and `_Cutout` from the game, debris cut plane |
| Custom sabers and trail | `AssignObjectPrefab` saber with `trailAsset` |
| Wet-lens look through the first song, a flash at the switch | `Blit` screen effects reading the eye texture array |
| At the switch to *Chemicals*, the drive gives way to a shore at dusk with a character sitting by the water | `DestroyObject`, a second scene, a different skybox and fog |
| Light levels | `SetGlobalProperty` animation |

Every shader is written for single-pass instanced stereo, as PC maps must
be. If the conversion gets something wrong, it shows: an effect in one eye
only, notes without bodies, a black screen effect, a missing scene.

## Playing it

1. Install a Vivify Quest build that includes the test map. Builds made after
   the map's bundle was first built include it. The full build only, not Lite.
2. Put your copy of the song on the headset as an Ogg Vorbis file, at
   `/sdcard/ModData/com.beatgames.beatsaber/Mods/Vivify/TestMapSong.ogg`.
   A file in `Download` or `Music` whose name contains "sense of me" or
   "chemicals" works too. To make an .ogg from another format on a PC:
   `ffmpeg -i "your copy.mp3" -c:a libvorbis -q:a 5 TestMapSong.ogg`
3. In Beat Saber: Settings > Mod Settings > Vivify > **Test Vivify**. The status
   line says what happened. The map appears under Custom Levels.

## Building it

CI builds it: `.github/workflows/build-test-map.yml` runs Unity 2021.3.16f1
through game-ci, then `build.yml` packs the result into the QMOD.

Unity needs a license. Once, as the repository owner:

1. Get a Unity Personal license file (free): follow game-ci's guide at
   <https://game.ci/docs/github/activation> to produce `Unity_lic.ulf`.
2. In the repository: Settings > Secrets and variables > Actions > New
   repository secret, three times:
   - `UNITY_LICENSE`: the whole contents of `Unity_lic.ulf`
   - `UNITY_EMAIL`: your Unity account's email
   - `UNITY_PASSWORD`: your Unity account's password
3. Run **Build Test Map** from the Actions tab (or push a change under
   `testmap/`). Later `build.yml` runs include the map.

Without the secrets, the workflow says so in its summary and stops; it does
not fail.

Locally: open `testmap/unity` in Unity 2021.3 and use **Vivify > Build Test
Map**. That writes `testmap/map/bundleWindows2021.vivify` and
`bundle_crc.txt`. Then run
`python3 testmap/tools/make_map.py --windows2021-crc <crc>` and
`python3 testmap/tools/make_cover.py`.

## Files

- `unity/Assets/Editor/BuildTestMap.cs` builds every mesh, material and
  prefab, and exports the bundle.
- `unity/Assets/TestMap/Shaders/` holds the map's shaders.
- `tools/analyze.py` turns a copy of the song into the beat grid in
  `map/analysis.json`: tempo, first beat, and loudness per half beat. These are
  numbers only; the audio is never stored.
- `tools/make_map.py` writes the chart (`ExpertPlusStandard.dat`, 397 notes at
  75 BPM) and `Info.dat`.
- `tools/make_cover.py` draws `cover.png`.
