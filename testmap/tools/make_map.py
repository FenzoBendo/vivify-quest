#!/usr/bin/env python3
"""Writes the Vivify Quest test map's Info.dat and ExpertPlusStandard.dat.

    python3 testmap/tools/make_map.py [--windows2021-crc N]

Reads testmap/map/analysis.json (beat grid and loudness, see analyze.py) and
writes into testmap/map/. The Unity build (testmap/unity, BuildTestMap.cs) runs
this again with the bundle's CRC once the bundle exists.

The chart follows the song's onsets on a half-beat grid at 75 BPM, one hand at
a time with each hand alternating down and up swings, and doubles on strong
downbeats in the loud sections. The Vivify events run through everything a
port has to get right: prefabs placed and destroyed, custom notes, debris and
sabers with a trail, a particle system, a geometry shader, material and global
property animation, render settings, and a screen effect (Blit).
"""
import argparse
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
MAP = HERE.parent / "map"

A = "assets/testmap/"
DRIVE = A + "prefabs/drive.prefab"
RAIN = A + "prefabs/rain.prefab"
EDGES = A + "prefabs/screenedges.prefab"
SHORE = A + "prefabs/shore.prefab"
NOTE = A + "prefabs/note.prefab"
NOTE_DOT = A + "prefabs/notedot.prefab"
DEBRIS = A + "prefabs/debris.prefab"
SABER = A + "prefabs/saber.prefab"
TRAIL = A + "materials/sabertrail.mat"
RAIN_MAT = A + "materials/rain.mat"
EDGES_MAT = A + "materials/screenedges.mat"
LENS_MAT = A + "materials/wetlens.mat"
FLASH_MAT = A + "materials/flash.mat"
SKY_MAT = A + "materials/nightsky.mat"
DUSK_MAT = A + "materials/dusksky.mat"

# Song sections in seconds, from the loudness in analysis.json: a quiet intro,
# The Sense of Me, the handover, Chemicals (with a breath at 276-280 s).
INTRO_END = 38.0
SWITCH = 155.0
SONG2 = 162.0
BREATH = (276.0, 280.0)
END = 515.0


def beat_of(seconds, bpm):
    return round(seconds * bpm / 60.0, 3)


def chart(analysis):
    bpm = analysis["bpm"]
    offset = analysis["offset"]
    slots = analysis["slots"]
    step = analysis["slotBeats"]
    strengths = [s[0] for s in slots]
    loudness = [s[1] for s in slots]

    def seconds(i):
        return offset + i * step * 60.0 / bpm

    def section(t):
        if t < INTRO_END:
            return "intro"
        if t < SONG2 - 2:
            return "song1"
        if t < SONG2:
            return "handover"
        if BREATH[0] <= t < BREATH[1]:
            return "breath"
        if t < END:
            return "song2"
        return "outro"

    # Thresholds per section: the strongest 35% of half beats in a loud
    # section get a note, the strongest 15% in the intro.
    by_section = {}
    for i, value in enumerate(strengths):
        by_section.setdefault(section(seconds(i)), []).append(value)

    def percentile(values, fraction):
        ordered = sorted(values)
        return ordered[min(len(ordered) - 1, int(len(ordered) * fraction))] if ordered else 1e9

    threshold = {name: percentile(values, 0.85 if name == "intro" else 0.65) for name, values in by_section.items()}
    loud = percentile(loudness, 0.8)

    notes = []
    hand = 0
    last_beat = {0: -10.0, 1: -10.0}
    swing_down = {0: True, 1: True}
    lanes = {0: (1, 0), 1: (2, 3)}
    for i, value in enumerate(strengths):
        t = seconds(i)
        name = section(t)
        if name in ("handover", "breath", "outro") or t < 3.0:
            continue
        if value < threshold.get(name, 1e9):
            continue
        b = beat_of(t, bpm)
        min_gap = 2.0 if name == "intro" else 1.0
        double = name != "intro" and loudness[i] >= loud and (i % 4 == 0)
        hands = [0, 1] if double else [hand]
        if any(b - last_beat[h] < min_gap for h in hands):
            other = 1 - hand
            if double or b - last_beat[other] < min_gap:
                continue
            hands = [other]
        for h in hands:
            down = swing_down[h]
            if double:
                direction = 1 if down else 0
            else:
                # Mostly straight down/up, sometimes the diagonal away from the body.
                diagonal = (i // 8) % 3 == 2
                if down:
                    direction = (6 if h == 0 else 7) if diagonal else 1
                else:
                    direction = (4 if h == 0 else 5) if diagonal else 0
            lane = lanes[h][(i // 16) % 2]
            layer = 0 if down else (1 if (i // 32) % 2 else 0)
            notes.append({"b": b, "x": lane, "y": layer, "c": h, "d": direction, "a": 0})
            swing_down[h] = not down
            last_beat[h] = b
        hand = 1 - hands[-1]
    return notes


def events(bpm):
    def b(seconds):
        return beat_of(seconds, bpm)

    ev = []
    # Opening: the car in the rain, the screen edges, custom notes and sabers.
    ev.append({"b": 0, "t": "SetRenderingSettings", "d": {
        "renderSettings": {"fog": 1, "fogMode": 2, "fogDensity": 0.025, "fogColor": [0.05, 0.07, 0.12, 1],
                           "ambientMode": 3, "ambientLight": [0.12, 0.14, 0.2, 1], "skybox": SKY_MAT}}})
    ev.append({"b": 0, "t": "InstantiatePrefab", "d": {"asset": DRIVE, "id": "drive"}})
    ev.append({"b": 0, "t": "InstantiatePrefab", "d": {"asset": RAIN, "id": "rain"}})
    ev.append({"b": 0, "t": "InstantiatePrefab", "d": {"asset": EDGES, "id": "edges"}})
    ev.append({"b": 0, "t": "AssignObjectPrefab", "d": {
        "colorNotes": {"asset": NOTE, "anyDirectionAsset": NOTE_DOT, "debrisAsset": DEBRIS}}})
    ev.append({"b": 0, "t": "AssignObjectPrefab", "d": {
        "saber": {"type": "Both", "asset": SABER, "trailAsset": TRAIL,
                  "trailTopPos": [0, 0, 1], "trailBottomPos": [0, 0, 0.1], "trailDuration": 0.3}}})
    ev.append({"b": 0, "t": "SetGlobalProperty", "d": {"properties": [
        {"id": "_TestMapGlow", "type": "Float", "value": 0.4}]}})
    # The song comes in: the lights come up, the rain thickens, the lens gets wet.
    ev.append({"b": b(INTRO_END - 4), "t": "SetGlobalProperty", "d": {"duration": b(8), "properties": [
        {"id": "_TestMapGlow", "type": "Float", "value": [[0.4, 0], [1.0, 1, "easeInOutSine"]]}]}})
    ev.append({"b": b(INTRO_END - 4), "t": "SetMaterialProperty", "d": {"asset": RAIN_MAT, "duration": b(8), "properties": [
        {"id": "_Intensity", "type": "Float", "value": [[0.4, 0], [1.0, 1, "easeOutQuad"]]}]}})
    ev.append({"b": b(INTRO_END), "t": "Blit", "d": {"asset": LENS_MAT, "duration": b(SWITCH) - b(INTRO_END)}})
    # A beat pulse on the screen edges, one key per bar, through the first song.
    pulse = []
    bar = 4 * 60.0 / bpm
    t = INTRO_END
    while t < SWITCH:
        start = (t - INTRO_END) / (SWITCH - INTRO_END)
        pulse.append([1.0, round(start, 4)])
        pulse.append([0.25, round(min(1.0, start + 0.5 * bar / (SWITCH - INTRO_END)), 4), "easeOutQuad"])
        t += bar
    ev.append({"b": b(INTRO_END), "t": "SetMaterialProperty", "d": {"asset": EDGES_MAT,
               "duration": b(SWITCH) - b(INTRO_END), "properties": [{"id": "_Pulse", "type": "Float", "value": pulse}]}})
    # The switch: a flash, the drive and the rain go, the shore and its
    # character come, at dusk.
    ev.append({"b": b(SWITCH - 1), "t": "Blit", "d": {"asset": FLASH_MAT, "duration": b(2), "properties": [
        {"id": "_Amount", "type": "Float", "value": [[0, 0], [1, 0.5, "easeInQuad"], [0, 1, "easeOutQuad"]]}]}})
    ev.append({"b": b(SWITCH), "t": "DestroyObject", "d": {"id": ["drive", "rain"]}})
    ev.append({"b": b(SWITCH), "t": "InstantiatePrefab", "d": {"asset": SHORE, "id": "shore"}})
    ev.append({"b": b(SWITCH), "t": "SetRenderingSettings", "d": {
        "renderSettings": {"fogColor": [0.55, 0.32, 0.3, 1], "fogDensity": 0.012,
                           "ambientLight": [0.5, 0.36, 0.34, 1], "skybox": DUSK_MAT}}})
    ev.append({"b": b(SWITCH), "t": "SetMaterialProperty", "d": {"asset": EDGES_MAT, "properties": [
        {"id": "_EdgeColor", "type": "Color", "value": [1.0, 0.55, 0.35, 1]}]}})
    # The breath in Chemicals: the edges fade out and come back.
    ev.append({"b": b(BREATH[0]), "t": "SetMaterialProperty", "d": {"asset": EDGES_MAT, "duration": b(BREATH[1]) - b(BREATH[0]),
               "properties": [{"id": "_Pulse", "type": "Float", "value": [[1, 0], [0, 0.4], [0, 0.6], [1, 1, "easeInQuad"]]}]}})
    ev.append({"b": b(END), "t": "DestroyObject", "d": {"id": ["shore", "edges"]}})
    return ev


def info(windows2021_crc):
    data = {
        "_version": "2.1.0",
        "_songName": "The Sense of Me / Chemicals",
        "_songSubName": "Vivify Quest test map",
        "_songAuthorName": "Mud Flow",
        "_levelAuthorName": "Vivify Quest (Rayla & Claude)",
        "_beatsPerMinute": 75,
        "_songTimeOffset": 0,
        "_shuffle": 0,
        "_shufflePeriod": 0.5,
        "_previewStartTime": 40,
        "_previewDuration": 12,
        "_songFilename": "song.egg",
        "_coverImageFilename": "cover.png",
        "_environmentName": "DefaultEnvironment",
        "_allDirectionsEnvironmentName": "GlassDesertEnvironment",
        "_customData": {
            "_contributors": [
                {"_role": "Music", "_name": "Mud Flow - The Sense of Me / Chemicals (not included; bring your own copy)"},
                {"_role": "Map, assets and shaders", "_name": "Vivify Quest (Rayla & Claude)"},
            ],
        },
        "_difficultyBeatmapSets": [{
            "_beatmapCharacteristicName": "Standard",
            "_difficultyBeatmaps": [{
                "_difficulty": "ExpertPlus",
                "_difficultyRank": 9,
                "_beatmapFilename": "ExpertPlusStandard.dat",
                "_noteJumpMovementSpeed": 16,
                "_noteJumpStartBeatOffset": 0,
                "_customData": {"_requirements": ["Vivify"], "_difficultyLabel": "Vivify Test"},
            }],
        }],
    }
    if windows2021_crc is not None:
        data["_customData"]["_assetBundle"] = {"_windows2021": windows2021_crc}
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--windows2021-crc", type=int, default=None)
    args = parser.parse_args()
    analysis = json.loads((MAP / "analysis.json").read_text())
    notes = chart(analysis)
    difficulty = {
        "version": "3.3.0",
        "bpmEvents": [], "rotationEvents": [], "colorNotes": notes, "bombNotes": [], "obstacles": [],
        "sliders": [], "burstSliders": [], "waypoints": [], "basicBeatmapEvents": [],
        "colorBoostBeatmapEvents": [], "lightColorEventBoxGroups": [], "lightRotationEventBoxGroups": [],
        "lightTranslationEventBoxGroups": [], "basicEventTypesWithKeywords": {}, "useNormalEventsAsCompatibleEvents": True,
        "customData": {"customEvents": events(analysis["bpm"])},
    }
    (MAP / "ExpertPlusStandard.dat").write_text(json.dumps(difficulty, separators=(",", ":")))
    (MAP / "Info.dat").write_text(json.dumps(info(args.windows2021_crc), indent=2) + "\n")
    print(f"{len(notes)} notes, {len(difficulty['customData']['customEvents'])} Vivify events")


if __name__ == "__main__":
    main()
