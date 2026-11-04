#!/usr/bin/env python3
"""Draws the test map's cover (testmap/map/cover.png): rain streaks over a
night-to-dusk gradient. Pure Python (zlib only), so no image is committed."""
import pathlib
import random
import struct
import zlib

SIZE = 256
OUT = pathlib.Path(__file__).resolve().parent.parent / "map" / "cover.png"


def main():
    rng = random.Random(7)
    pixels = [[[0.0, 0.0, 0.0] for _ in range(SIZE)] for _ in range(SIZE)]
    for y in range(SIZE):
        t = y / (SIZE - 1)
        top = (0.02, 0.03, 0.09)
        bottom = (0.75, 0.38, 0.28)
        k = t ** 2.2
        for x in range(SIZE):
            pixels[y][x] = [top[i] * (1 - k) + bottom[i] * k for i in range(3)]
    for _ in range(420):
        x0, y0 = rng.uniform(-40, SIZE), rng.uniform(-60, SIZE)
        length = rng.uniform(10, 34)
        bright = rng.uniform(0.08, 0.35)
        for s in range(int(length)):
            x, y = int(x0 + s * 0.35), int(y0 + s)
            if 0 <= x < SIZE and 0 <= y < SIZE:
                for i, c in enumerate((0.7, 0.8, 1.0)):
                    pixels[y][x][i] = min(1.0, pixels[y][x][i] + c * bright)
    # Two headlight glows low in the frame.
    for cx in (96, 160):
        for y in range(SIZE):
            for x in range(SIZE):
                d = ((x - cx) ** 2 + (y - 200) ** 2) / 600.0
                glow = 0.9 / (1.0 + d)
                pixels[y][x][0] = min(1.0, pixels[y][x][0] + glow)
                pixels[y][x][1] = min(1.0, pixels[y][x][1] + glow * 0.8)
                pixels[y][x][2] = min(1.0, pixels[y][x][2] + glow * 0.55)
    raw = b"".join(b"\x00" + bytes(int(c * 255) for p in row for c in p) for row in pixels)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    OUT.write_bytes(png)
    print(f"wrote {OUT} ({len(png)} bytes)")


if __name__ == "__main__":
    main()
