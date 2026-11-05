#!/usr/bin/env python3
"""Beat grid and loudness for the Vivify Quest test map.

    ffmpeg -i <your copy of the song> -ac 1 -ar 11025 -f f32le song.f32
    python3 testmap/tools/analyze.py song.f32 > testmap/map/analysis.json

Writes numbers only (tempo, first-beat offset, onset strength and loudness
per half beat); the song itself is never stored in this repository.
Needs numpy.
"""
import json
import sys

import numpy as np

SR = 11025
HOP = 256
BPM = 75.0


def envelope(samples):
    window = np.hanning(1024)
    padded = np.concatenate([samples, np.zeros(1024, dtype=samples.dtype)])
    frames = len(samples) // HOP
    flux = np.zeros(frames)
    rms = np.zeros(frames)
    previous = None
    for i in range(frames):
        segment = padded[i * HOP:i * HOP + 1024] * window
        spectrum = np.log1p(np.abs(np.fft.rfft(segment)))
        rms[i] = np.sqrt(np.mean(segment ** 2))
        if previous is not None:
            flux[i] = np.sum(np.maximum(0.0, spectrum - previous))
        previous = spectrum
    return flux, rms


def main():
    samples = np.fromfile(sys.argv[1], dtype=np.float32)
    flux, rms = envelope(samples)
    hop_seconds = HOP / SR
    duration = len(samples) / SR
    beat = 60.0 / BPM
    # The phase of the beat grid: the offset whose beats sit on the most onset.
    best_offset, best_score = 0.0, -1.0
    for offset in np.arange(0.0, beat, 0.005):
        times = np.arange(offset, duration, beat)
        index = np.clip((times / hop_seconds).astype(int), 0, len(flux) - 1)
        score = flux[index].sum()
        if score > best_score:
            best_offset, best_score = float(offset), float(score)
    half = beat / 2
    slots = []
    t = best_offset
    while t < duration - half:
        a = int(t / hop_seconds)
        b = min(len(flux), a + max(1, int(0.06 / hop_seconds)))
        slots.append([round(float(flux[a:b].max()), 3), round(float(rms[a:b].mean()), 4)])
        t += half
    json.dump({"bpm": BPM, "offset": round(best_offset, 3), "duration": round(duration, 2),
               "slotBeats": 0.5, "slots": slots}, sys.stdout)


if __name__ == "__main__":
    main()
