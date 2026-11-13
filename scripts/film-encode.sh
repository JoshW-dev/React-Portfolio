#!/usr/bin/env bash
# Encodes one film hop clip for scroll scrubbing.
#
#   scripts/film-encode.sh <source.mp4> <name>
#
# Writes to public/film/clips/:
#   <name>-d.mp4      desktop, 1280 wide (FILM_WIDTH=1600 for a sharper, larger file)
#   <name>-m.mp4      phone, 854 wide
#   <name>-first.webp first frame, 1600 wide
#   <name>-last.webp  last frame, 1600 wide
#
# Both mp4s are H.264, 24 fps, no audio, and all-intra (every frame a keyframe), so any
# seek lands on a frame the browser can show without decoding a run of earlier ones.
# Then set `kind: "video", clip: "<name>"` on the hop in lib/film.ts.

set -euo pipefail

die() {
  echo "film-encode: $*" >&2
  exit 1
}

[ $# -eq 2 ] || die "usage: scripts/film-encode.sh <source.mp4> <name>"
SRC=$1
NAME=$2
[ -f "$SRC" ] || die "no such file: $SRC"
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "name must be lowercase letters, digits and dashes: $NAME"
command -v ffmpeg >/dev/null || die "ffmpeg is not installed"
command -v ffprobe >/dev/null || die "ffprobe is not installed"

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/public/film/clips"
mkdir -p "$OUT"
D_WIDTH=${FILM_WIDTH:-1280}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

encode() { # <width> <crf> <out>
  ffmpeg -hide_banner -loglevel error -y -i "$SRC" -an \
    -vf "fps=24,scale=$1:-2:flags=lanczos" \
    -c:v libx264 -preset slow -crf "$2" -pix_fmt yuv420p \
    -g 1 -keyint_min 1 -x264-params scenecut=0 \
    -movflags +faststart "$3"
}

# Every frame must be an I-frame, or scrubbing stutters on the frames between keyframes.
check_intra() { # <file>
  local counts total intra
  counts=$(ffprobe -v error -select_streams v:0 -show_entries frame=pict_type -of csv=p=0 "$1" | tr -d ' ,' | sort | uniq -c)
  total=$(echo "$counts" | awk '{s += $1} END {print s + 0}')
  intra=$(echo "$counts" | awk '$2 == "I" {print $1}')
  intra=${intra:-0}
  [ "$total" -gt 0 ] || die "$1 has no video frames"
  if [ "$intra" -ne "$total" ]; then
    echo "$counts" >&2
    die "$1 is not all-intra: $intra of $total frames are I-frames"
  fi
  echo "  $(basename "$1"): $total frames, all I-frames"
}

to_webp() { # <png> <webp>
  if command -v cwebp >/dev/null; then
    cwebp -quiet -q 80 -m 6 "$1" -o "$2"
  elif [ -d "$ROOT/node_modules/sharp" ]; then
    (cd "$ROOT" && node -e 'require("sharp")(process.argv[1]).webp({ quality: 80 }).toFile(process.argv[2]).catch((e) => { console.error(e); process.exit(1); })' "$1" "$2")
  else
    die "need cwebp (brew install webp) or sharp in node_modules to write WebP"
  fi
}

echo "Encoding $SRC as $NAME"
encode "$D_WIDTH" 24 "$OUT/$NAME-d.mp4"
encode 854 26 "$OUT/$NAME-m.mp4"
check_intra "$OUT/$NAME-d.mp4"
check_intra "$OUT/$NAME-m.mp4"

# The stills stand in for the clip while it downloads, so they come from the same source.
ffmpeg -hide_banner -loglevel error -y -i "$SRC" -vf "scale=1600:-2:flags=lanczos" -frames:v 1 "$TMP/first.png"
# -update 1 rewrites the file for each frame decoded from the last second, so the last one stays.
ffmpeg -hide_banner -loglevel error -y -sseof -1 -i "$SRC" -vf "scale=1600:-2:flags=lanczos" -update 1 "$TMP/last.png"
[ -s "$TMP/first.png" ] || die "could not read the first frame"
[ -s "$TMP/last.png" ] || die "could not read the last frame"
to_webp "$TMP/first.png" "$OUT/$NAME-first.webp"
to_webp "$TMP/last.png" "$OUT/$NAME-last.webp"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$NAME-d.mp4")
echo "Done ($DUR s):"
for f in "$NAME-d.mp4" "$NAME-m.mp4" "$NAME-first.webp" "$NAME-last.webp"; do
  printf '  %-24s %6s KB\n' "$f" "$(( $(stat -f %z "$OUT/$f") / 1024 ))"
done
