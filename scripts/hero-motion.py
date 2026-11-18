#!/usr/bin/env python3
"""
Writes motion maps for project heroes whose picture is not a film frame, one small PNG per
hero in public/work/motion/, from scripts/hero-motion.json. The maps use the film's format
(see scripts/film-motion.py), so components/film/movingStill.ts plays them on the hero.

  uv run --with pillow --with numpy python scripts/hero-motion.py            # every hero
  uv run --with pillow --with numpy python scripts/hero-motion.py disco      # one hero
  ... scripts/hero-motion.py --preview DIR                                   # also overlays
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "scripts" / "hero-motion.json"
OUT = ROOT / "public" / "work" / "motion"

# The film's map builder, reused as is.
_spec = importlib.util.spec_from_file_location("film_motion", ROOT / "scripts" / "film-motion.py")
fm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fm)


def ring_mask(ring, w, h, band):
    """The ring's outer ellipse, or with band=True only the band outside its inner one."""
    ss = fm.SS
    big = Image.new("L", (w * ss, h * ss), 0)
    d = ImageDraw.Draw(big)
    (cx, cy), (ox, oy), (ix, iy) = ring["center"], ring["outer"], ring["inner"]
    d.ellipse([(cx - ox) * w * ss, (cy - oy) * h * ss, (cx + ox) * w * ss, (cy + oy) * h * ss], fill=255)
    if band:
        d.ellipse([(cx - ix) * w * ss, (cy - iy) * h * ss, (cx + ix) * w * ss, (cy + iy) * h * ss], fill=0)
    return big.resize((w, h), Image.LANCZOS)


def hold_mask(hold, src, w, h, feather):
    """Pixels in the polygon that pass the key, grown by 'grow' and softened."""
    rgb = fm.arr(src.resize((w, h), Image.LANCZOS))
    k = fm.key_mask(rgb, hold["key"]) * fm.arr(fm.poly_mask(hold["poly"], w, h))
    m = Image.fromarray(((k > 0.5) * 255).astype(np.uint8))
    size = max(3, int(round(hold.get("grow", 0.01) * w)) * 2 + 1)
    m = m.filter(ImageFilter.MaxFilter(size))
    return fm.arr(fm.blur(m, max(1.0, feather * 0.6)))


def build(hero):
    img, src = fm.build(hero)
    a = np.asarray(img, dtype=np.float32).copy()
    w, h = img.size
    feather = hero.get("feather", 0.008) * w
    if "hold" in hero:
        m = hold_mask(hero["hold"], src.convert("RGB"), w, h, feather)
        a[..., 0] = a[..., 0] * (1 - m) + 128 * m
        a[..., 1] = a[..., 1] * (1 - m) + 128 * m
    rings = hero.get("rings", [])
    for ring in rings:
        # Everything in the ring holds still (flow back to zero, 128), so neither its band nor
        # the cards passing through it double up; only the band shimmers.
        hold = fm.arr(fm.blur(ring_mask(ring, w, h, False), max(1.0, feather * 0.6)))
        band = fm.arr(fm.blur(ring_mask(ring, w, h, True), max(1.0, feather * 0.6)))
        a[..., 0] = a[..., 0] * (1 - hold) + 128 * hold
        a[..., 1] = a[..., 1] * (1 - hold) + 128 * hold
        a[..., 2] = np.maximum(a[..., 2] * (1 - hold), 255 * ring.get("shimmer", 0) * band)
    out = np.clip(np.round(a), 0, 255).astype(np.uint8)
    out[..., 0] = np.maximum(out[..., 0], 1)
    out[..., 1] = np.maximum(out[..., 1], 1)
    return Image.fromarray(out), src


def main():
    args = sys.argv[1:]
    pdir = None
    if "--preview" in args:
        i = args.index("--preview")
        pdir = Path(args[i + 1])
        del args[i : i + 2]
    spec = json.loads(SPEC.read_text())["heroes"]
    OUT.mkdir(parents=True, exist_ok=True)
    for k in args or list(spec):
        hero = spec[k]
        img, src = build(hero)
        path = OUT / f"{hero['name']}.png"
        img.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}  {path.stat().st_size // 1024} KB")
        if pdir:
            pdir.mkdir(parents=True, exist_ok=True)
            fm.preview(hero, img, src, pdir / f"hero-{k}.jpg")


if __name__ == "__main__":
    main()
