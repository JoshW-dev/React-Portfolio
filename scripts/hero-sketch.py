#!/usr/bin/env python3
"""
Vector sketches of the project heroes' pictures, shown while the real picture loads.

For every picture a project page opens on (`frame.src` in lib/work.ts) it writes a small
vector version into lib/heroSketches.json: the picture's main contours as lines, which the
page draws in on arrival (components/film/HeroSketch.tsx), over a low-poly fill. The fill's
triangles have corners along those contours, so their edges follow the picture's, and each
takes the picture's colour, merged into a few dozen colours. Touching triangles of one colour
become one shape, which keeps the file small (about 8 to 25 KB a picture).

The coordinates are whole numbers in a box 1600 wide (the lines) or 1000 wide (the fill) with
the picture's own shape, so the sketch scales to any screen and lines up with the picture
under object-fit: cover.

    python3 scripts/hero-sketch.py              # every frame in lib/work.ts
    python3 scripts/hero-sketch.py --preview=DIR  # also writes DIR/<name>.svg, fully drawn

Needs numpy, scipy and Pillow. Run it again after a frame picture changes.
"""

from __future__ import annotations

import json
import re
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.cluster.vq import kmeans2
from scipy.spatial import Delaunay

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "lib" / "heroSketches.json"
VB_W = 1600  # the lines' box is this wide; its height follows the picture
FILL_W = 1000  # and the fill's

# The fill: how many triangle corners, how many colours.
POINTS = 620
COLOURS = 44
CHROMA = 1.15
# The lines: how many contours at most, and how many corners in all.
LINES = 140
LINE_POINTS = 2300
MIN_LINE = 50  # px, on the copy 960 wide
# The fill's corners follow this many contours, one every CONTOUR_GAP px (on the copy 800 wide).
STRUCTURE = 260
CONTOUR_GAP = 13
ON_CONTOURS = 0.5  # at most this share of the corners sit on contours
GROUPS = 8  # the lines draw in this many waves, the strongest first


def frames() -> list[str]:
    src = (ROOT / "lib" / "work.ts").read_text()
    found = re.findall(r"frame:\s*\{[^}]*?src:\s*\"([^\"]+)\"", src, re.S)
    return list(dict.fromkeys(found))


def load(path: str) -> np.ndarray:
    im = Image.open(ROOT / "public" / path.lstrip("/")).convert("RGB")
    return np.asarray(im, dtype=np.float32) / 255.0


def resize(img: np.ndarray, width: int) -> np.ndarray:
    h, w = img.shape[:2]
    im = Image.fromarray((img * 255).astype(np.uint8))
    return np.asarray(im.resize((width, round(h * width / w)), Image.LANCZOS), dtype=np.float32) / 255.0


def luma(img: np.ndarray) -> np.ndarray:
    return img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


# ---------- the fill ----------


def detail(img: np.ndarray) -> np.ndarray:
    """How much is going on at each pixel: the colour gradient, blurred a little."""
    g = np.zeros(img.shape[:2], np.float32)
    for c in range(3):
        ch = ndimage.gaussian_filter(img[..., c], 1.2)
        g += np.hypot(ndimage.sobel(ch, 0), ndimage.sobel(ch, 1))
    g = ndimage.gaussian_filter(g, 1.5)
    return g / (g.max() + 1e-6)


def resample(p: np.ndarray, gap: float) -> np.ndarray:
    """Points every `gap` along a polyline, both ends included."""
    seg = np.hypot(*np.diff(p, axis=0).T)
    at = np.concatenate([[0], np.cumsum(seg)])
    if at[-1] < gap:
        return p[[0, -1]]
    t = np.linspace(0, at[-1], max(2, int(round(at[-1] / gap)) + 1))
    return np.stack([np.interp(t, at, p[:, 0]), np.interp(t, at, p[:, 1])], 1)


def sample_points(weight: np.ndarray, n: int, rng: np.random.Generator, fixed: np.ndarray) -> tuple[np.ndarray, float]:
    """
    About n points spread like blue noise. The fixed points (along the picture's contours)
    go in first, so triangle edges follow them. Then a loose jittered grid, so flat areas
    (sky, water) still get even triangles, then more points where the weight is high.
    Returns the points and the grid's step.
    """
    h, w = weight.shape
    step = float(np.sqrt(w * h / (n * 0.22)))
    base = step * 0.6
    cell = max(2.0, base * 0.35)
    reach = int(np.ceil(base / cell))
    grid: dict[tuple[int, int], list[tuple[float, float, float]]] = {}
    out: list[tuple[float, float]] = []

    def free(x: float, y: float, r: float) -> bool:
        gx, gy = int(x // cell), int(y // cell)
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                for qx, qy, qr in grid.get((gx + dx, gy + dy), ()):
                    if (qx - x) ** 2 + (qy - y) ** 2 < min(r, qr) ** 2:
                        return False
        return True

    def add(x: float, y: float, r: float) -> None:
        grid.setdefault((int(x // cell), int(y // cell)), []).append((x, y, r))
        out.append((x, y))

    for x, y in fixed:
        if 2 <= x <= w - 3 and 2 <= y <= h - 3 and free(x, y, 4.0):
            add(float(x), float(y), base * 0.45)

    X, Y = np.meshgrid(np.arange(step / 2, w, step), np.arange(step / 2, h, step))
    seed = np.stack([X.ravel(), Y.ravel()], 1) + rng.uniform(-step * 0.3, step * 0.3, (X.size, 2))
    for x, y in np.clip(seed, 2, [w - 3, h - 3]):
        if free(float(x), float(y), base):
            add(float(x), float(y), base)

    p = (weight**0.8 + 0.02).ravel()
    p /= p.sum()
    cand = rng.choice(p.size, size=n * 8, replace=False, p=p)
    ys, xs = np.divmod(cand, w)
    wt = weight.ravel()[cand]
    order = np.argsort(-wt - rng.random(cand.size) * 0.15)
    for i in order:
        if len(out) >= n:
            break
        x, y = float(xs[i]), float(ys[i])
        # The gap between points shrinks where the weight is high.
        r = base * (1.0 - 0.7 * float(wt[i]) ** 0.5)
        if free(x, y, r):
            add(x, y, r)
    return np.array(out, np.float32), step


def border_points(w: int, h: int, step: float) -> np.ndarray:
    pts = []
    for x in np.linspace(0, w - 1, max(2, round(w / step)) + 1):
        pts += [(x, 0), (x, h - 1)]
    for y in np.linspace(0, h - 1, max(2, round(h / step)) + 1)[1:-1]:
        pts += [(0, y), (w - 1, y)]
    return np.array(pts, np.float32)


def triangle_colours(img: np.ndarray, pts: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """The colour inside each triangle: the median, so a sliver of a bright edge doesn't tint it."""
    h, w = img.shape[:2]
    out = np.zeros((len(tris), 3), np.float32)
    for k, t in enumerate(tris):
        a, b, c = pts[t]
        x0, y0 = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
        x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w - 1), min(y1, h - 1)
        yy, xx = np.mgrid[y0 : y1 + 1, x0 : x1 + 1]
        px, py = xx + 0.5, yy + 0.5
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-6:
            out[k] = img[int((a[1] + b[1] + c[1]) / 3), int((a[0] + b[0] + c[0]) / 3)]
            continue
        l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d
        l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d
        inside = (l1 >= -0.01) & (l2 >= -0.01) & (1 - l1 - l2 >= -0.01)
        if inside.any():
            out[k] = np.median(img[yy[inside], xx[inside]], axis=0)
        else:
            out[k] = img[int((a[1] + b[1] + c[1]) / 3), int((a[0] + b[0] + c[0]) / 3)]
    return out


def to_lab(rgb: np.ndarray) -> np.ndarray:
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4).astype(np.float64)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    # (Some numpy builds on macOS warn about this product for no reason; the values are fine.)
    with np.errstate(all="ignore"):
        xyz = lin @ m.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def quantise(cols: np.ndarray, areas: np.ndarray, k: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Merges the triangle colours into k colours, chosen in a perceptual colour space."""
    lab = to_lab(cols)
    # Repeat the bigger triangles so they pull the palette harder.
    reps = np.clip(np.round(areas / np.median(areas)), 1, 8).astype(int)
    data = np.repeat(lab, reps, 0)
    k = min(k, len(np.unique(np.round(lab), axis=0)))
    _, _ = kmeans2(data, k, minit="++", seed=rng, iter=30)
    centres, _ = kmeans2(data, k, minit="++", seed=rng, iter=30)
    d = ((lab[:, None, :] - centres[None]) ** 2).sum(-1)
    label = d.argmin(1)
    # Each colour is the area-weighted mean of its triangles' real colours.
    pal = np.zeros((k, 3), np.float32)
    for i in range(k):
        m = label == i
        if m.any():
            pal[i] = (cols[m] * areas[m, None]).sum(0) / areas[m].sum()
    # Flat shapes read a little greyer than the picture, so give the colour back.
    grey = luma(pal)[:, None]
    pal = np.clip(grey + (pal - grey) * CHROMA, 0, 1)
    return pal, label


# ---------- the lines ----------


def edges(img: np.ndarray, sigma: float) -> tuple[np.ndarray, np.ndarray]:
    """Thin edges (Canny's non-maximum suppression and hysteresis) and their strength."""
    l = ndimage.gaussian_filter(luma(img), sigma)
    gx, gy = ndimage.sobel(l, 1), ndimage.sobel(l, 0)
    mag = np.hypot(gx, gy)
    ang = (np.rad2deg(np.arctan2(gy, gx)) + 180) % 180
    h, w = mag.shape
    nms = np.zeros_like(mag)
    pad = np.pad(mag, 1)
    q = ((ang + 22.5) // 45).astype(int) % 4
    offs = {0: (0, 1), 1: (1, 1), 2: (1, 0), 3: (1, -1)}
    for k, (dy, dx) in offs.items():
        m = q == k
        a = pad[1 + dy : 1 + dy + h, 1 + dx : 1 + dx + w]
        b = pad[1 - dy : 1 - dy + h, 1 - dx : 1 - dx + w]
        keep = m & (mag >= a) & (mag >= b)
        nms[keep] = mag[keep]
    vals = nms[nms > 0]
    hi = np.percentile(vals, 88)
    lo = hi * 0.45
    weak = nms > lo
    lab, n = ndimage.label(weak, structure=np.ones((3, 3)))
    strong = np.zeros(n + 1, bool)
    strong[np.unique(lab[nms > hi])] = True
    strong[0] = False
    return strong[lab], mag / (mag.max() + 1e-6)


NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def chains(mask: np.ndarray) -> list[np.ndarray]:
    """Follows the edge pixels into chains, from their ends first, then any loops left."""
    h, w = mask.shape
    m = mask.copy()
    m[0, :] = m[-1, :] = m[:, 0] = m[:, -1] = False
    count = ndimage.convolve(m.astype(np.uint8), np.ones((3, 3), np.uint8), mode="constant") - m
    seen = np.zeros_like(m)
    ys, xs = np.nonzero(m & (count == 1))
    starts = list(zip(ys.tolist(), xs.tolist()))
    ys2, xs2 = np.nonzero(m)
    starts += list(zip(ys2.tolist(), xs2.tolist()))
    out = []
    for sy, sx in starts:
        if seen[sy, sx]:
            continue
        path = [(sy, sx)]
        seen[sy, sx] = True
        y, x = sy, sx
        dy0, dx0 = 0, 0
        while True:
            best = None
            for dy, dx in NB:
                ny, nx = y + dy, x + dx
                if m[ny, nx] and not seen[ny, nx]:
                    # Prefer going straight on.
                    score = dy * dy0 + dx * dx0 - 0.1 * (abs(dy) + abs(dx))
                    if best is None or score > best[0]:
                        best = (score, ny, nx, dy, dx)
            if best is None:
                break
            _, y, x, dy0, dx0 = best
            seen[y, x] = True
            path.append((y, x))
        if len(path) >= 6:
            out.append(np.array(path, np.float32)[:, ::-1])  # as x, y
    return out


def rdp(p: np.ndarray, eps: float) -> np.ndarray:
    if len(p) < 3:
        return p
    a, b = p[0], p[-1]
    ab = b - a
    n = np.hypot(*ab)
    if n < 1e-9:
        d = np.hypot(*(p - a).T)
    else:
        d = np.abs(ab[0] * (p[:, 1] - a[1]) - ab[1] * (p[:, 0] - a[0])) / n
    i = int(d.argmax())
    if d[i] > eps:
        return np.vstack([rdp(p[: i + 1], eps)[:-1], rdp(p[i:], eps)])
    return np.array([a, b])


def smooth(p: np.ndarray, passes: int = 2) -> np.ndarray:
    for _ in range(passes):
        if len(p) < 3:
            return p
        q = p.copy()
        q[1:-1] = 0.25 * p[:-2] + 0.5 * p[1:-1] + 0.25 * p[2:]
        p = q
    return p


# ---------- out ----------


def hexc(c: np.ndarray) -> str:
    r, g, b = (np.clip(c, 0, 1) * 255 + 0.5).astype(int)
    return f"#{r:02x}{g:02x}{b:02x}"


def num(v: float) -> str:
    return str(int(round(v)))


def poly_d(p: np.ndarray, closed: bool) -> str:
    """Path data with relative moves, rounded to whole units."""
    q = np.round(p).astype(int)
    keep = [0] + [i for i in range(1, len(q)) if (q[i] != q[i - 1]).any()]
    q = q[keep]
    s = f"M{q[0][0]} {q[0][1]}"
    d = np.diff(q, axis=0)
    if len(d):
        parts = []
        for dx, dy in d:
            parts.append(f"{dx}" + (f" {dy}" if dy >= 0 else f"{dy}"))
        joined = ""
        for t in parts:
            joined += t if (not joined or t.startswith("-")) else " " + t
        s += "l" + joined
    return s + ("z" if closed else "")


def outlines(tris: np.ndarray, pts: np.ndarray) -> list[list[int]]:
    """
    The outline of a set of triangles as closed loops of point indices: every edge two of them
    share drops out, so a patch of one colour is one shape. The loops keep the triangles'
    turning direction, so holes cut out under the nonzero fill rule.
    """
    a, b, c = pts[tris[:, 0]], pts[tris[:, 1]], pts[tris[:, 2]]
    cross = (b - a)[:, 0] * (c - a)[:, 1] - (b - a)[:, 1] * (c - a)[:, 0]
    t = tris.copy()
    t[cross < 0] = t[cross < 0][:, [0, 2, 1]]
    edges: dict[tuple[int, int], None] = {}
    for x, y, z in t.tolist():
        for u, v in ((x, y), (y, z), (z, x)):
            if (v, u) in edges:
                del edges[(v, u)]
            else:
                edges[(u, v)] = None
    nxt: dict[int, list[int]] = {}
    for u, v in edges:
        nxt.setdefault(u, []).append(v)
    loops = []
    while nxt:
        start = next(iter(nxt))
        loop, u = [start], start
        while True:
            v = nxt[u].pop()
            if not nxt[u]:
                del nxt[u]
            if v == start:
                break
            loop.append(v)
            u = v
        loops.append(loop)
    return loops


def contours(img: np.ndarray) -> list[np.ndarray]:
    """The picture's main contours as smoothed polylines, strongest first, in its pixels."""
    mask, mag = edges(img, 2.2)
    scored = []
    for ch in chains(mask):
        length = float(np.hypot(*np.diff(ch, axis=0).T).sum())
        if length < MIN_LINE:
            continue
        span = float(np.hypot(*(ch.max(0) - ch.min(0))))
        # Small loops round a light or a speck read as noise, not as a drawn line.
        if span < MIN_LINE * 0.8 or (span < 0.4 * length and length < 4 * MIN_LINE):
            continue
        strength = float(mag[ch[:, 1].astype(int), ch[:, 0].astype(int)].mean())
        scored.append((length**1.25 * strength**0.7, smooth(ch, 3)))
    scored.sort(key=lambda s: -s[0])
    return [p for _, p in scored]


def sketch(path: str, seed: int = 7) -> dict:
    rng = np.random.default_rng(seed)
    full = load(path)
    H0, W0 = full.shape[:2]
    vb_h = H0 * VB_W / W0

    # The contours, found on a copy 960 wide.
    mid = resize(full, 960)
    mw = mid.shape[1]
    found = contours(mid)

    # The lines: the strongest contours, up to a budget of corners, in waves.
    lk = VB_W / mw
    drawn = []
    total = 0
    for p in found[:LINES]:
        q = rdp(p, 1.0) * lk
        if total + len(q) > LINE_POINTS:
            break
        total += len(q)
        drawn.append(q)
    waves: list[list[str]] = [[] for _ in range(GROUPS)]
    for rank, q in enumerate(drawn):
        waves[min(GROUPS - 1, int(GROUPS * (rank / max(len(drawn), 1)) ** 0.8))].append(poly_d(q, False))
    # One path per wave: each line is a piece of it.
    lines = ["".join(w) for w in waves if w]

    # The fill, worked out on a copy 800 wide, with corners along the contours.
    small = resize(full, 800)
    sh, sw = small.shape[:2]
    fk = sw / mw
    along: list[np.ndarray] = []
    for p in found[:STRUCTURE]:
        q = resample(p * fk, CONTOUR_GAP)
        if sum(len(a) for a in along) + len(q) > POINTS * ON_CONTOURS:
            break
        along.append(q)
    fixed = np.vstack(along) if along else np.zeros((0, 2), np.float32)
    pts, step = sample_points(detail(small), POINTS, rng, fixed)
    pts = np.vstack([pts, border_points(sw, sh, step * 0.6)])
    tris = Delaunay(pts).simplices
    cols = triangle_colours(small, pts, tris)
    a, b, c = pts[tris[:, 0]], pts[tris[:, 1]], pts[tris[:, 2]]
    areas = 0.5 * np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1]))
    pal, label = quantise(cols, areas + 1e-3, COLOURS, rng)
    fb_h = H0 * FILL_W / W0
    vpts = pts * np.array([FILL_W / sw, fb_h / sh], np.float32)
    # Push the frame's own edge just past the box so no seam shows at the sides.
    vpts[:, 0] = np.where(pts[:, 0] <= 0.5, -1, np.where(pts[:, 0] >= sw - 1.5, FILL_W + 1, vpts[:, 0]))
    vpts[:, 1] = np.where(pts[:, 1] <= 0.5, -1, np.where(pts[:, 1] >= sh - 1.5, fb_h + 1, vpts[:, 1]))
    fill = []
    for i in np.argsort(luma(pal)):
        ts = tris[label == i]
        if len(ts):
            fill.append([hexc(pal[i]), "".join(poly_d(vpts[loop], True) for loop in outlines(ts, pts))])

    return {
        "w": VB_W,
        "h": round(vb_h, 2),
        "fw": FILL_W,
        "fh": round(fb_h, 2),
        "a": round(W0 / H0, 6),
        "fill": fill,
        "lines": lines,
    }


def svg(s: dict) -> str:
    """A standalone preview of a sketch, fully drawn."""
    w, h = s["w"], round(s["h"])
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {s["h"]}" width="{w}" height="{h}">']
    out.append(f'<svg viewBox="0 0 {s["fw"]} {s["fh"]}" width="100%" height="100%">')
    for colour, d in s["fill"]:
        out.append(f'<path fill="{colour}" stroke="{colour}" stroke-width="0.8" stroke-linejoin="round" d="{d}"/>')
    out.append("</svg>")
    out.append('<g fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">')
    for d in s["lines"]:
        out.append(f'<path d="{d}"/>')
    out.append("</g></svg>")
    return "\n".join(out)


def main() -> None:
    preview = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--preview=")), None)
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    data = json.loads(OUT.read_text()) if OUT.exists() and only else {}
    for src in only or frames():
        s = sketch(src)
        data[src] = s
        raw = json.dumps(s, separators=(",", ":"))
        print(f"{src}: {len(s['fill'])} colours, {len(raw) / 1024:.1f} KB, {len(zlib.compress(raw.encode(), 9)) / 1024:.1f} KB deflated")
        if preview:
            d = Path(preview)
            d.mkdir(parents=True, exist_ok=True)
            (d / (Path(src).stem + ".svg")).write_text(svg(s))
    OUT.write_text(json.dumps(data, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
