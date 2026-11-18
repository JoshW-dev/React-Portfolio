#!/usr/bin/env python3
"""
Writes the film's motion maps: one small PNG per stop in public/film/motion/.

Each map lines up with the frame the stop rests on (the 'image' in scripts/film-motion.json),
and <name>-still.png with the stop's own still, which a project page's hero shows.
Red and green carry the flow, a direction in pixel space with x and y both in shares of the
width, stored as 128 + 127 * v. Blue carries the shimmer: the ripple and the twinkle.
components/film/movingStill.ts reads them.

  python3 scripts/film-motion.py            # every stop
  python3 scripts/film-motion.py 7 8        # some stops
  python3 scripts/film-motion.py --preview DIR   # also writes overlays to DIR for checking
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "scripts" / "film-motion.json"
OUT = ROOT / "public" / "film" / "motion"
WIDTH = 480  # map width in pixels; the shader filters it smoothly
SS = 2  # polygons are drawn this much larger, then reduced, for soft edges


def poly_mask(poly, w, h):
    big = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(big).polygon([(x * w * SS, y * h * SS) for x, y in poly], fill=255)
    return big.resize((w, h), Image.LANCZOS)


def blur(img, radius):
    return img.filter(ImageFilter.GaussianBlur(radius)) if radius > 0 else img


def arr(img):
    return np.asarray(img, dtype=np.float32) / 255.0


def smooth(a, b, x):
    t = np.clip((x - a) / max(1e-6, b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def key_mask(rgb, key):
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    mx = rgb.max(axis=2)
    sat = np.where(mx > 1e-4, (mx - rgb.min(axis=2)) / np.maximum(mx, 1e-4), 0.0)
    k = smooth(key["lo"] - 0.08, key["lo"] + 0.08, lum) * (1 - smooth(key["hi"] - 0.02, key["hi"] + 0.02, lum))
    k *= 1 - smooth(key["sat"] - 0.08, key["sat"] + 0.08, sat)
    if "minsat" in key:
        k *= smooth(key["minsat"] - 0.08, key["minsat"] + 0.08, sat)
    return k


def build(stop):
    src = Image.open(ROOT / stop["image"]).convert("RGB")
    w = WIDTH
    h = round(WIDTH * src.height / src.width)
    rgb = arr(src.resize((w, h), Image.LANCZOS))
    feather = stop.get("feather", 0.008) * w

    flow = np.zeros((h, w, 2), np.float32)
    shim = np.zeros((h, w), np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    px = (xs + 0.5) / w  # shares of the width
    py = (ys + 0.5) / h  # shares of the height

    for r in stop["regions"]:
        m = arr(blur(poly_mask(r["poly"], w, h), r["feather"] * w if "feather" in r else feather))
        if "ramp" in r:
            y0, v0, y1, v1 = r["ramp"]
            m *= v0 + (v1 - v0) * np.clip((py - y0) / (y1 - y0), 0, 1)
        # The key limits shimmer as well as flow (it used to limit only flow, so a keyed
        # shimmer region shimmered all of its polygon).
        if "key" in r:
            k = key_mask(rgb, r["key"])
            k = arr(blur(Image.fromarray((k * 255).astype(np.uint8)), max(1.0, feather * 0.5)))
            m = m * k
        if "shimmer" in r:
            shim = np.maximum(shim, m * r["shimmer"])
        if "flow" not in r and "radial" not in r:
            continue
        speed = r.get("speed", 1.0)
        if "radial" in r:
            rad = r["radial"]
            cx, cy = rad["center"]
            # Pixel space, both axes in shares of the width.
            dx = px - cx
            dy = (py - cy) * h / w
            d = np.sqrt(dx * dx + dy * dy) + 1e-6
            mag = np.clip(d / rad["reach"], 0, 1) ** rad.get("power", 1.0)
            sign = rad.get("sign", 1)
            v = np.stack([dx / d, dy / d], axis=2) * (mag * speed * sign)[..., None]
        else:
            fx, fy = r["flow"]
            n = max(1e-6, (fx * fx + fy * fy) ** 0.5)
            v = np.zeros((h, w, 2), np.float32)
            v[..., 0] = fx / n * speed
            v[..., 1] = fy / n * speed
        flow = flow * (1 - m[..., None]) + v * m[..., None]

    for poly in stop.get("exclude", []):
        e = arr(blur(poly_mask(poly, w, h), max(1.0, feather * 0.6)))
        flow *= (1 - e)[..., None]
        shim *= 1 - e

    out = np.zeros((h, w, 3), np.uint8)
    out[..., 0] = np.clip(np.round(128 + 127 * flow[..., 0]), 1, 255)
    out[..., 1] = np.clip(np.round(128 + 127 * flow[..., 1]), 1, 255)
    out[..., 2] = np.clip(np.round(255 * shim), 0, 255)
    return Image.fromarray(out), src


def build_conveyor(stop):
    """
    A conveyor's map (components/film/movingStill.ts, Conveyor): red is how much each pixel
    moves, green is 1 on a belt or 0.5 times 'hold' where colour holds still, blue is the
    spacing. Parts are bands of angle around the vanishing point (degrees, 0 = right, 90 =
    down), each with its spacing (1 over the distance from the vanishing point, in picture
    heights) by angle. 'near' lowers a part's spacing by near[0] for each unit closer than
    near[1], which keeps the nearest cartons in proportion. Polygons are shares of 'ref'.
    """
    cv = stop["conveyor"]
    src = Image.open(ROOT / stop["image"]).convert("RGB")
    ref = Image.open(ROOT / cv["ref"])
    w = WIDTH
    h = round(WIDTH * src.height / src.width)
    a, ra = src.width / src.height, ref.width / ref.height
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    # Picture heights from the centre line (the film's frames and the stills line up at equal
    # height), and share of the height.
    px = ((xs + 0.5) / w - 0.5) * a
    py = (ys + 0.5) / h
    vx, vy = cv["vanish"]
    dx, dy = px - vx, py - vy
    u = 1.0 / np.maximum(np.sqrt(dx * dx + dy * dy), 1e-4)
    th = np.degrees(np.arctan2(dy, dx)) % 360

    def ref_poly(poly):
        # A polygon in shares of 'ref', moved into this image's shares.
        pts = [((x - 0.5) * ra / a + 0.5, y) for x, y in poly]
        return arr(blur(poly_mask(pts, w, h), max(1.0, cv.get("feather", 0.004) * w)))

    weight = np.zeros((h, w), np.float32)
    green = np.zeros((h, w), np.float32)
    spacing = np.zeros((h, w), np.float32)
    for part in cv["parts"]:
        t0, t1, t2, t3 = part["theta"]
        m = smooth(t0, t1, th) * (1 - smooth(t2, t3, th))
        ang, val = zip(*part["spacing"])
        b = np.interp(th, ang, val) * part.get("scale", 1.0)
        if "near" in part:
            k, ur = part["near"]
            b = b * (1 - k * np.clip(ur - u, 0, None))
        g = 1.0 if part.get("belt") else 0.5 * part.get("hold", 0.0)
        take = m > weight
        weight = np.where(take, m, weight)
        spacing = np.where(take, b, spacing)
        green = np.where(take, g, green)
    for poly in cv.get("exclude", []):
        weight *= 1 - ref_poly(poly)
    lo, span = cv["spacing"]
    out = np.zeros((h, w, 3), np.uint8)
    out[..., 0] = np.clip(np.round(255 * weight), 0, 255)
    out[..., 1] = np.clip(np.round(255 * green), 0, 255)
    out[..., 2] = np.clip(np.round(255 * (spacing - lo) / span), 0, 255)
    return Image.fromarray(out), src


def preview(stop, img, src, path):
    """The frame with the flow in green to red and the shimmer in blue, for checking masks."""
    base = src.resize(img.size, Image.LANCZOS).convert("RGB")
    a = np.asarray(img, dtype=np.float32)
    mag = np.sqrt(((a[..., 0] - 128) / 127) ** 2 + ((a[..., 1] - 128) / 127) ** 2)
    over = np.asarray(base, dtype=np.float32) * 0.55
    over[..., 1] += 200 * np.clip(mag, 0, 1)
    over[..., 0] += 120 * np.clip(mag - 0.5, 0, 1) * 2
    over[..., 2] += 180 * a[..., 2] / 255
    Image.fromarray(np.clip(over, 0, 255).astype(np.uint8)).save(path, quality=85)


def main():
    args = sys.argv[1:]
    pdir = None
    if "--preview" in args:
        i = args.index("--preview")
        pdir = Path(args[i + 1])
        del args[i : i + 2]
    spec = json.loads(SPEC.read_text())["stops"]
    OUT.mkdir(parents=True, exist_ok=True)
    for k in args or list(spec):
        stop = spec[k]
        make = build_conveyor if "conveyor" in stop else build
        img, src = make(stop)
        path = OUT / f"{stop['name']}.png"
        img.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}  {path.stat().st_size // 1024} KB")
        if pdir:
            pdir.mkdir(parents=True, exist_ok=True)
            preview(stop, img, src, pdir / f"map-{k}.jpg")
        # A project page shows the stop's own still, which lines up with the film's frame to
        # within about 1%, so the same regions are keyed again on its pixels.
        still = f"public/film/{stop['name']}.webp"
        if stop["image"] != still and (ROOT / still).exists():
            img, _ = make({**stop, "image": still})
            path = OUT / f"{stop['name']}-still.png"
            img.save(path, optimize=True)
            print(f"{path.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
