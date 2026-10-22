#!/usr/bin/env bash
# Generates the placeholder "sample video testimonial" clips used on the home
# page. They are synthetic on purpose: an animated voice waveform over a soft
# generated tone, clearly labelled as a sample with no real person in them.
# Requires ffmpeg with libx264, libvpx-vp9, libopus and drawtext (libfreetype).
#
#   scripts/make-sample-videos.sh [output-dir]   (default: public/samples)
set -euo pipefail

OUT="${1:-public/samples}"
FONT_BOLD="${FONT_BOLD:-/usr/share/fonts/opentype/inter/Inter-Bold.otf}"
FONT_MED="${FONT_MED:-/usr/share/fonts/opentype/inter/Inter-Medium.otf}"
W=960
H=600
DUR=10
mkdir -p "$OUT"

# id | first name (fictional) | top colour | bottom colour | voice pitch (Hz) | syllable rate (Hz)
CLIPS=(
  "maya|Maya|0x3a1d2e|0x0d1020|190|3.1"
  "daniel|Daniel|0x13304a|0x0d1020|120|2.6"
  "aiko|Aiko|0x1f2f2a|0x0d1020|230|3.6"
)

for clip in "${CLIPS[@]}"; do
  IFS="|" read -r id name c0 c1 pitch rate <<<"$clip"
  echo "→ $id"
  # A soft, speech-like synthetic tone: a low sine whose loudness rises and
  # falls at a syllable-like rate, with short pauses, faded in and out.
  audio="aevalsrc='0.22*sin(2*PI*${pitch}*t)*(0.55+0.45*sin(2*PI*${rate}*t))*(0.5+0.5*sin(2*PI*0.45*t))*gt(sin(2*PI*0.23*t)+0.75\,0)':s=48000:d=${DUR},afade=t=in:d=0.4,afade=t=out:st=$((DUR - 1)):d=1"
  # Animated "voice bars" (like the site's waveform), drawn per frame with geq
  # on a small transparent layer and gated by the same envelope as the audio,
  # so they move with the sound. 24 bars, 10px wide, 18px apart.
  env="(0.5+0.5*sin(2*PI*0.45*T))*gt(sin(2*PI*0.23*T)+0.75,0)"
  barh="(14+120*abs(sin(2*PI*(${rate}*T*0.5+floor(X/18)*0.217)))*${env})"
  filter="
    gradients=s=${W}x${H}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${W}:y1=${H}:d=${DUR}:speed=0.008:r=30[bg];
    color=c=black:s=424x160:r=30:d=${DUR},format=rgba,
    geq=r=255:g=255:b=255:a='220*lt(mod(X,18),10)*lt(abs(Y-80),${barh}/2)'[bars];
    [bg][bars]overlay=x=268:y=230,
    drawbox=x=40:y=40:w=226:h=40:color=black@0.35:t=fill,
    drawtext=fontfile=${FONT_BOLD}:text='SAMPLE VIDEO':fontsize=20:fontcolor=white:x=88:y=50,
    drawbox=x=58:y=54:w=12:h=12:color=0xe2463f@1:t=fill,
    drawtext=fontfile=${FONT_BOLD}:text='${name}':fontsize=54:fontcolor=white:x=40:y=H-150,
    drawtext=fontfile=${FONT_MED}:text='Fictional customer · placeholder clip, no real person':fontsize=22:fontcolor=white@0.72:x=40:y=H-80,
    format=yuv420p[v]"
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$audio" \
    -filter_complex "$filter" -map "[v]" -map 0:a -t "$DUR" \
    -c:v libx264 -profile:v main -preset slow -crf 28 -pix_fmt yuv420p -movflags +faststart \
    -c:a aac -b:a 64k "$OUT/$id.mp4"
  ffmpeg -hide_banner -loglevel error -y -i "$OUT/$id.mp4" \
    -c:v libvpx-vp9 -b:v 0 -crf 40 -row-mt 1 -deadline good -cpu-used 4 \
    -c:a libopus -b:a 48k "$OUT/$id.webm"
  ffmpeg -hide_banner -loglevel error -y -ss 2.2 -i "$OUT/$id.mp4" -frames:v 1 -q:v 4 "$OUT/$id.jpg"
done
ls -la "$OUT"
