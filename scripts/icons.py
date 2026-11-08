"""Build the repo-native geometric icon with the Python standard library."""
from pathlib import Path
import struct
import zlib
import sys

OUT = Path(__file__).resolve().parents[1] / "extension" / "icons"
OUT.mkdir(exist_ok=True)

def inside(x, y, points):
    result = False
    for i, (x1, y1) in enumerate(points):
        x2, y2 = points[(i + 1) % len(points)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            result = not result
    return result

def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

for size in ((1024,) if "--ios" in sys.argv else (16, 48, 128)):
    opaque = size == 1024
    scale = 1 if opaque else 4
    rows = bytearray()
    shield = [(0.5, .08), (.87, .22), (.84, .57), (.72, .77), (.5, .93), (.28, .77), (.16, .57), (.13, .22)]
    inner = [(0.5, .2), (.75, .29), (.72, .54), (.63, .7), (.5, .8), (.37, .7), (.28, .54), (.25, .29)]
    for y in range(size):
        rows.append(0)
        for x in range(size):
            samples = []
            for sy in range(scale):
                for sx in range(scale):
                    px, py = (x + (sx + .5) / scale) / size, (y + (sy + .5) / scale) / size
                    color = (242, 246, 240, 255) if opaque else (0, 0, 0, 0)
                    if inside(px, py, shield):
                        color = (37, 75, 55, 255)
                    if inside(px, py, inner):
                        color = (216, 234, 208, 255)
                    if (.45 < px < .55 and .33 < py < .59) or (px - .5) ** 2 + (py - .68) ** 2 < .0025:
                        color = (37, 75, 55, 255)
                    samples.append(color)
            rows.extend(round(sum(c[i] for c in samples) / len(samples)) for i in range(3 if opaque else 4))
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2 if opaque else 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(bytes(rows))) + chunk(b"IEND", b"")
    target = OUT.parents[1] / "ios/Input Defender/Input Defender/Assets.xcassets/AppIcon.appiconset/universal-icon-1024@1x.png" if opaque else OUT / f"{size}.png"
    target.write_bytes(data)
