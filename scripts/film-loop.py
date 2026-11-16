#!/usr/bin/env python3
"""
Makes a stop's cinemagraph loop from a generated clip, as set in scripts/film-loops.json.

  python3 scripts/film-loop.py 03-plant path/to/generated.mp4 [--preview DIR]

The clip should start and end on the stop's frame with the camera locked. This script:
  1. matches its colour to the frame (each channel's mean and spread, over the top half),
  2. crossfades its last seconds into its first, so the end runs into the start with no jump,
  3. crops it to the loop's box and writes public/film/loops/<name>-hd.mp4 (full size) and
     <name>-m.mp4 (half size),
  4. writes <name>-mask.png: white, with the alpha saying where the loop shows.
components/film/FilmLoop.tsx plays it over the frame.
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "scripts" / "film-loops.json"
OUT = ROOT / "public" / "film" / "loops"
SS = 2  # polygons are drawn this much larger, then reduced, for smooth edges


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip().split(",")
    num, den = out[2].split("/")
    return int(out[0]), int(out[1]), float(num) / float(den)


def frames(path, w, h):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = w * h * 3
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    p.wait()


def encoder(path, w, h, fps, crf):
    return subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", f"{fps:g}", "-i", "-",
         "-an", "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-profile:v", "high", "-pix_fmt", "yuv420p",
         "-g", str(round(fps * 2)), "-movflags", "+faststart", str(path)],
        stdin=subprocess.PIPE,
    )


def blurred(a, w, h):
    return np.asarray(Image.fromarray(a).resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(4)), np.float32)


def poly_mask(polys, box, w, h, feather):
    x0, y0, x1, y1 = box
    big = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(big)
    for poly in polys:
        d.polygon([((x - x0) / (x1 - x0) * w * SS, (y - y0) / (y1 - y0) * h * SS) for x, y in poly], fill=255)
    m = big.resize((w, h), Image.LANCZOS)
    radius = feather / (x1 - x0) * w
    return np.asarray(m.filter(ImageFilter.GaussianBlur(radius)) if radius > 0 else m, np.float32) / 255.0


def main():
    args = sys.argv[1:]
    pdir = None
    if "--preview" in args:
        i = args.index("--preview")
        pdir = Path(args[i + 1])
        del args[i : i + 2]
    name, raw = args[0], Path(args[1])
    spec = json.loads(SPEC.read_text())["loops"][name]
    W, H, fps = probe(raw)
    ref = np.asarray(Image.open(ROOT / spec["frame"]).convert("RGB").resize((W, H), Image.LANCZOS))

    clip = list(frames(raw, W, H))
    n = len(clip)
    k = round(spec["crossfade"] * fps)

    # Colour: each channel's mean and spread over the top half, measured on blurred frames so
    # the re-drawn detail doesn't count.
    bw, bh = 960, round(960 * H / W)
    a = blurred(clip[0], bw, bh)[: bh // 2].reshape(-1, 3)
    b = blurred(ref, bw, bh)[: bh // 2].reshape(-1, 3)
    scale = b.std(0) / a.std(0)
    offset = b.mean(0) - a.mean(0) * scale
    print(f"{n} frames at {fps:g} fps; colour scale {np.round(scale, 4)} offset {np.round(offset, 2)}")

    x0, y0, x1, y1 = spec["crop"]
    cx0, cy0 = round(x0 * W / 2) * 2, round(y0 * H / 2) * 2
    cw, ch = round((x1 - x0) * W / 2) * 2, round((y1 - y0) * H / 2) * 2
    OUT.mkdir(parents=True, exist_ok=True)
    hd = encoder(OUT / f"{name}-hd.mp4", cw, ch, fps, 20)
    m = encoder(OUT / f"{name}-m.mp4", cw // 2, ch // 2, fps, 23)
    for j in range(n - k):
        f = clip[j].astype(np.float32)
        if j < k:
            w = (j + 0.5) / k
            w = w * w * (3 - 2 * w)
            f = clip[n - k + j].astype(np.float32) * (1 - w) + f * w
        f = np.clip(f * scale + offset, 0, 255).round().astype(np.uint8)
        part = f[cy0 : cy0 + ch, cx0 : cx0 + cw]
        hd.stdin.write(np.ascontiguousarray(part).tobytes())
        m.stdin.write(np.asarray(Image.fromarray(part).resize((cw // 2, ch // 2), Image.LANCZOS)).tobytes())
        if pdir and j % 24 == 0:
            pdir.mkdir(parents=True, exist_ok=True)
            Image.fromarray(f).save(pdir / f"{name}-{j:03d}.jpg", quality=88)
    for e in (hd, m):
        e.stdin.close()
        e.wait()

    # The mask, at half the crop's size: the regions, less the things that stay still.
    box = (cx0 / W, cy0 / H, (cx0 + cw) / W, (cy0 + ch) / H)
    mw, mh = cw // 2, ch // 2
    alpha = poly_mask(spec["regions"], box, mw, mh, spec["feather"])
    alpha *= 1 - poly_mask(spec["exclude"], box, mw, mh, spec["exclude_feather"])
    rgba = np.zeros((mh, mw, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = np.clip(alpha * 255, 0, 255).round().astype(np.uint8)
    Image.fromarray(rgba).save(OUT / f"{name}-mask.png", optimize=True)

    for f in sorted(OUT.glob(f"{name}-*")):
        print(f"{f.relative_to(ROOT)}  {f.stat().st_size // 1024} KB")
    print(f"box: left {box[0] * 100:.4f}%  top {box[1] * 100:.4f}%  width {(box[2] - box[0]) * 100:.4f}%  height {(box[3] - box[1]) * 100:.4f}%")
    print(f"length {(n - k) / fps:.3f} s")


if __name__ == "__main__":
    main()
