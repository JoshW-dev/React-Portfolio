#!/usr/bin/env python3
"""
Makes a stop's cinemagraph loop from a generated clip, as set in scripts/film-loops.json.

  python3 scripts/film-loop.py 03-plant path/to/generated.mp4 [--preview DIR]

The clip should start on the stop's frame with the camera locked and the moving thing moving
the whole time. (Giving the model the same last frame makes it hold still near the end.)
This script:
  1. holds the camera still: each frame is moved back by the drift of the 'stable' box,
  2. matches its colour to the frame (each channel's mean and spread, over the top half),
  3. crossfades its last seconds into its first, so the end runs into the start with no jump,
     or, with "loop": "pingpong", plays it forward then backward (for fog and clouds that
     drift one way over the clip, which a crossfade would show as a pulse),
  4. crops it to the loop's box and writes public/film/loops/<name>-hd.mp4 (full size) and
     <name>-m.mp4 (half size),
  5. writes <name>-mask.png: white, with the alpha saying where the loop shows,
  6. reports how fast the 'probe' box moves, so a loop that barely moves is caught here.
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


def phase_shift(a, b):
    """How far b's content sits from a's, in pixels (x, y), to about a fifth of a pixel."""
    h, w = a.shape
    win = np.outer(np.hanning(h), np.hanning(w))
    A = np.fft.fft2((a - a.mean()) * win)
    B = np.fft.fft2((b - b.mean()) * win)
    R = A * np.conj(B)
    R /= np.abs(R) + 1e-9
    r = np.fft.ifft2(R).real
    y, x = np.unravel_index(np.argmax(r), r.shape)

    def sub(m, c, p):
        d = m - 2 * c + p
        return 0.0 if abs(d) < 1e-12 else 0.5 * (m - p) / d

    dy = y + sub(r[(y - 1) % h, x], r[y, x], r[(y + 1) % h, x])
    dx = x + sub(r[y, (x - 1) % w], r[y, x], r[y, (x + 1) % w])
    if dy > h / 2:
        dy -= h
    if dx > w / 2:
        dx -= w
    return -dx, -dy


def box_px(box, w, h):
    x0, y0, x1, y1 = box
    return slice(round(y0 * h), round(y1 * h)), slice(round(x0 * w), round(x1 * w))


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
    fits = None
    # Only the stretch where the camera holds still enough to line up ('use', in seconds).
    if "use" in spec:
        u0, u1 = spec["use"]
        clip = clip[round(u0 * fps) : round(u1 * fps)]
    n = len(clip)
    pingpong = spec.get("loop") == "pingpong"
    k = 0 if pingpong else round(spec["crossfade"] * fps)

    # Hold the camera still. Video models drift and zoom a little even when told not to, so
    # each frame is lined up with the stop's frame itself: patches of things that never move
    # ('stable') are matched, a zoom, turn and shift is fitted to them, and the frame is
    # warped back by it. Two passes per frame, starting from the last frame's fit.
    if "stable" in spec:
        gray = lambda f: f.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
        rgray = gray(ref)
        boxes = [box_px(b, W, H) for b in spec["stable"]]
        cx, cy = W / 2, H / 2
        centres = np.array([((sx.start + sx.stop) / 2 - cx, (sy.start + sy.stop) / 2 - cy) for sy, sx in boxes])
        pad = 96  # edge pixels repeated round the frame, so a warp never pulls in black

        def warp(f, a, b, tx, ty):
            big = np.pad(f, ((pad, pad), (pad, pad), (0, 0)), mode="edge")
            coef = (a, -b, cx - a * cx + b * cy + tx + pad, b, a, cy - b * cx - a * cy + ty + pad)
            return np.asarray(Image.fromarray(big).transform((W, H), Image.AFFINE, coef, resample=Image.BILINEAR))

        fits = []
        prm = np.array([1.0, 0.0, 0.0, 0.0])  # a = scale cos, b = scale sin, tx, ty
        for f in clip:
            for _ in range(2):
                g = gray(warp(f, *prm))
                rows, rhs = [], []
                for (sy, sx), (px, py) in zip(boxes, centres):
                    dx, dy = phase_shift(rgray[sy, sx], g[sy, sx])
                    rows += [[px, -py, 1, 0], [py, px, 0, 1]]
                    rhs += [dx, dy]
                A, r = np.array(rows), np.array(rhs)
                # Patches that disagree by more than 3 px (steam crossing them, a bad match)
                # are dropped one at a time, worst first, while four or more are left.
                keep = np.ones(len(boxes), bool)
                while True:
                    k2 = np.repeat(keep, 2)
                    sol = np.linalg.lstsq(A[k2], r[k2], rcond=None)[0]
                    res = np.abs(A @ sol - r).reshape(-1, 2).max(1)
                    res[~keep] = 0
                    if res.max() <= 3 or keep.sum() <= 4:
                        break
                    keep[res.argmax()] = False
                # The residual is a small extra zoom, turn and shift on top of prm.
                da, db, dtx, dty = sol
                a, b, tx, ty = prm
                na, nb = a * (1 + da) - b * db, b * (1 + da) + a * db
                prm = np.array([na, nb, tx + a * dtx - b * dty, ty + b * dtx + a * dty])
            fits.append(prm.copy())
        fits = np.array(fits)
        ker = np.ones(5) / 5
        fits = np.stack([np.convolve(np.pad(fits[:, i], 2, mode="edge"), ker, "valid") for i in range(4)], 1)
        zoom = np.hypot(fits[:, 0], fits[:, 1])
        print(f"camera: zoom {zoom.min():.4f} to {zoom.max():.4f}, shift up to {np.abs(fits[:, 2:]).max(0).round(1)} px")
        clip = [warp(f, *prm) for f, prm in zip(clip, fits)]
        # What is left over, on the patches: should be well under a pixel.
        left = []
        for f in clip[:: max(1, len(clip) // 8)]:
            g = gray(f)
            left.append(np.median([np.hypot(*phase_shift(rgray[sy, sx], g[sy, sx])) for sy, sx in boxes]))
        print(f"after: median patch off by {np.round(left, 2)} px")

    # Colour: each channel's mean and spread over the top half, measured on blurred frames so
    # the re-drawn detail doesn't count.
    bw, bh = 960, round(960 * H / W)
    a = blurred(clip[0], bw, bh)[: bh // 2].reshape(-1, 3)
    b = blurred(ref, bw, bh)[: bh // 2].reshape(-1, 3)
    scale = b.std(0) / a.std(0)
    offset = b.mean(0) - a.mean(0) * scale
    print(f"{n} frames at {fps:g} fps; colour scale {np.round(scale, 4)} offset {np.round(offset, 2)}")

    x0, y0, x1, y1 = spec["crop"]
    # Even offsets, and sizes in fours so the half-size copy is even too (H.264 needs even).
    cx0, cy0 = round(x0 * W / 2) * 2, round(y0 * H / 2) * 2
    cw, ch = min(W - cx0, round((x1 - x0) * W / 4) * 4), min(H - cy0, round((y1 - y0) * H / 4) * 4)
    cw, ch = cw // 4 * 4, ch // 4 * 4
    OUT.mkdir(parents=True, exist_ok=True)
    hd = encoder(OUT / f"{name}-hd.mp4", cw, ch, fps, 20)
    m = encoder(OUT / f"{name}-m.mp4", cw // 2, ch // 2, fps, 23)
    order = list(range(n)) + list(range(n - 2, 0, -1)) if pingpong else list(range(n - k))
    for j, i in enumerate(order):
        f = clip[i].astype(np.float32)
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
    if fits is not None:
        # Where a warp reached past the clip's edge it repeated edge pixels, which show as
        # streaks; the loop shows only where every frame had real pixels, 6 px in.
        ys, xs = np.mgrid[0:mh, 0:mw].astype(np.float32)
        px = cx0 + (xs + 0.5) * cw / mw - W / 2
        py = cy0 + (ys + 0.5) * ch / mh - H / 2
        ok = np.ones((mh, mw), bool)
        for a, b, tx, ty in fits:
            sx_ = a * px - b * py + W / 2 + tx
            sy_ = b * px + a * py + H / 2 + ty
            ok &= (sx_ >= 6) & (sx_ <= W - 7) & (sy_ >= 6) & (sy_ <= H - 7)
        edge = Image.fromarray((ok * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5))
        edge = np.asarray(edge.filter(ImageFilter.GaussianBlur(3)), np.float32) / 255.0
        alpha *= edge
        print(f"edge cut: {100 * (1 - ok.mean()):.1f}% of the loop box had no real pixels in some frame")
    rgba = np.zeros((mh, mw, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = np.clip(alpha * 255, 0, 255).round().astype(np.uint8)
    Image.fromarray(rgba).save(OUT / f"{name}-mask.png", optimize=True)

    if "probe" in spec:
        # How fast the moving thing moves: change per second over its own detail, in pixels a
        # second at the clip's size. The first plant loop measured 0.6 and read as frozen.
        py, px = box_px(spec["probe"], W, H)
        g = [blurred(f[py, px], 240, 120).mean(2) for f in clip[: n - k]]
        step = round(fps / 2)
        change = np.mean([np.abs(g[i] - g[i + step]).mean() for i in range(0, len(g) - step, step)]) * 2
        gy, gx = np.gradient(g[0])
        scale = (px.stop - px.start) / 240
        print(f"probe motion: about {change / max(1e-6, np.hypot(gx, gy).mean()) * scale:.1f} px/s")

    for f in sorted(OUT.glob(f"{name}-*")):
        print(f"{f.relative_to(ROOT)}  {f.stat().st_size // 1024} KB")
    print(f"box: left {box[0] * 100:.4f}%  top {box[1] * 100:.4f}%  width {(box[2] - box[0]) * 100:.4f}%  height {(box[3] - box[1]) * 100:.4f}%")
    print(f"length {len(order) / fps:.3f} s")


if __name__ == "__main__":
    main()
