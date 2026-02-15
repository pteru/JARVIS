#!/usr/bin/env bash
# Launch JARVIS mini dashboard as always-on-top floating window

# Wait for dashboard service to be ready
for i in $(seq 1 10); do
  curl -s http://localhost:3000/mini.html >/dev/null 2>&1 && break
  sleep 1
done

# Launch Chrome in app mode
nohup google-chrome \
  --app=http://localhost:3000/mini.html \
  --new-window \
  --enable-transparent-visuals \
  --disable-background-timer-throttling >/dev/null 2>&1 &

# Wait for window to appear
WID=""
for i in $(seq 1 10); do
  sleep 1
  WID=$(xdotool search --name "JARVIS" 2>/dev/null | tail -1)
  [[ -n "$WID" ]] && break
done

if [[ -n "$WID" ]]; then
  # Get screen size for positioning
  read -r SW SH <<< "$(xdotool getdisplaygeometry 2>/dev/null || echo '1920 1080')"

  # Resize, position bottom-right, and set always-on-top (all via wmctrl)
  wmctrl -i -r "$WID" -e 0,$((SW - 400)),$((SH - 460)),360,350
  sleep 0.3
  wmctrl -i -r "$WID" -b add,above
fi
