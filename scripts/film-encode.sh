#!/usr/bin/env bash
# Encodes one film hop clip for scroll scrubbing.
#
#   scripts/film-encode.sh <source.mp4> <name>
#
# Writes to public/film/clips/:
#   <name>-hd.mp4     1920 wide, for desktops on a fast connection
#   <name>-d.mp4      1280 wide, for desktops on a slow connection and phones on a fast one
#   <name>-m.mp4      854 wide, for phones on a slow connection
#   <name>-first.webp first frame, 1600 wide
#   <name>-last.webp  last frame, 1600 wide
#
# All three mp4s are H.264, 24 fps, no audio, with a keyframe every 12 frames and no B-frames,
# so a seek decodes 12 frames at most. All-intra files were 2 to 3 times larger, and on a
# slow connection the download time mattered more than the seek time. A light denoise
# removes grain that costs bits, and the first and last frames get extra quality because
# the film rests on them.
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
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

GOP=12
# Frames in the 24 fps output, for the quality zones on the first and last frames.
FRAMES=$(ffprobe -v error -select_streams v:0 -show_entries format=duration -of csv=p=0 "$SRC" | awk '{printf "%d", $1 * 24 + 0.5}')
[ "$FRAMES" -gt 4 ] || die "source is too short"

encode() { # <width> <crf> <out>
  ffmpeg -hide_banner -loglevel error -y -i "$SRC" -an \
    -vf "fps=24,hqdn3d=1.5:1.5:6:6,scale=$1:-2:flags=lanczos" \
    -c:v libx264 -preset slow -crf "$2" -pix_fmt yuv420p \
    -g "$GOP" -keyint_min "$GOP" -bf 0 \
    -x264-params "scenecut=0:zones=0,1,q=20/$((FRAMES - 3)),$((FRAMES + 2)),q=20" \
    -movflags +faststart "$3"
}

# A B-frame or a long run between keyframes makes a seek decode more frames and stutter.
check_gop() { # <file>
  local types total run
  types=$(ffprobe -v error -select_streams v:0 -show_entries frame=pict_type -of csv=p=0 "$1" | tr -d ' ,\n')
  total=${#types}
  [ "$total" -gt 0 ] || die "$1 has no video frames"
  case "$types" in *B*) die "$1 has B-frames" ;; esac
  [ "${types:0:1}" = "I" ] || die "$1 does not start on a keyframe"
  run=$(echo "$types" | tr 'I' '\n' | awk '{ if (length($0) > m) m = length($0) } END { print m + 1 }')
  [ "$run" -le "$GOP" ] || die "$1 has $run frames between keyframes, more than $GOP"
  echo "  $(basename "$1"): $total frames, a keyframe every $run at most, no B-frames"
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
encode 1920 24 "$OUT/$NAME-hd.mp4"
encode 1280 30 "$OUT/$NAME-d.mp4"
encode 854 31 "$OUT/$NAME-m.mp4"
check_gop "$OUT/$NAME-hd.mp4"
check_gop "$OUT/$NAME-d.mp4"
check_gop "$OUT/$NAME-m.mp4"

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
for f in "$NAME-hd.mp4" "$NAME-d.mp4" "$NAME-m.mp4" "$NAME-first.webp" "$NAME-last.webp"; do
  printf '  %-24s %6s KB\n' "$f" "$(( $(stat -f %z "$OUT/$f") / 1024 ))"
done
