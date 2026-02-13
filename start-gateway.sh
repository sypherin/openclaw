#!/bin/bash
set -a
source /home/awpapa/.openclaw/.env
set +a
cd /home/awpapa/openclaw-source
exec node openclaw.mjs gateway run --bind lan --port 18789 --force
