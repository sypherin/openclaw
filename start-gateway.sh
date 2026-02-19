#!/bin/bash
set -a
source /home/awpapa/.openclaw/.env
set +a

CONFIG_LINK="/home/awpapa/.openclaw/openclaw.json"
CONFIG_TARGET="/home/awpapa/.openclaw-config/openclaw.json"

# Background watchdog: restore symlink if gateway overwrites it
(
  sleep 5
  while true; do
    if [ ! -L "$CONFIG_LINK" ]; then
      # Gateway replaced symlink with a regular file — merge any new
      # fields (like auth token) into the real config, then restore link
      if [ -f "$CONFIG_LINK" ] && [ -f "$CONFIG_TARGET" ]; then
        python3 -c "
import json, sys
try:
    with open('$CONFIG_LINK') as f: gw = json.load(f)
    with open('$CONFIG_TARGET') as f: orig = json.load(f)
    # Merge gateway-generated auth token into real config
    tok = gw.get('gateway',{}).get('auth',{}).get('token')
    if tok:
        orig.setdefault('gateway',{}).setdefault('auth',{})['token'] = tok
    with open('$CONFIG_TARGET','w') as f: json.dump(orig, f, indent=2); f.write('\n')
except: pass
" 2>/dev/null
      fi
      rm -f "$CONFIG_LINK"
      ln -s "$CONFIG_TARGET" "$CONFIG_LINK"
    fi
    sleep 3
  done
) &

cd /home/awpapa/openclaw-source
exec node openclaw.mjs gateway run --bind loopback --port 18789 --force --allow-unconfigured
