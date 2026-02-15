#!/usr/bin/env bash
# Launch JARVIS mini dashboard as always-on-top floating window

# Wait for dashboard service to be ready
for i in $(seq 1 10); do
  curl -s http://localhost:3000/mini.html >/dev/null 2>&1 && break
  sleep 1
done

# Launch Chrome in app mode
google-chrome --app=http://localhost:3000/mini.html --window-size=320,340 &
CHROME_PID=$!

# Wait for window to appear, then set always-on-top
sleep 2
WID=$(xdotool search --pid $CHROME_PID --name "JARVIS" 2>/dev/null | head -1)
if [[ -n "$WID" ]]; then
  xdotool set_window --overrideredirect 0 "$WID"
  # Set always on top via wmctrl-style property
  xprop -id "$WID" -f _NET_WM_STATE 32a -set _NET_WM_STATE _NET_WM_STATE_ABOVE 2>/dev/null || \
    xdotool windowactivate "$WID" key --clearmodifiers super+t 2>/dev/null || true
fi
