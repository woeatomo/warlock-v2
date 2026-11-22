#!/bin/bash
# Supervisor for the live/dry bot. DRY_RUN defaults to 1.
# Live start requires DRY_RUN=0 AND LIVE_CONFIRMED=1 AND the operator's approval AND a funded wallet.
# This script will not remove /workspace/lp-bot/STOP.
cd /workspace/lp-bot
export DRY_RUN="${DRY_RUN:-1}"

if [ "${DRY_RUN}" != "1" ] && [ "${LIVE_CONFIRMED:-}" != "1" ]; then
  echo "REFUSING LIVE START: need DRY_RUN=0 and LIVE_CONFIRMED=1 after operator approves and the wallet is funded." >&2
  exit 1
fi
if [ "${DRY_RUN}" != "1" ] && [ -f STOP ]; then
  echo "REFUSING LIVE START: STOP file is present. Leave it unless operator approves a live start." >&2
  exit 1
fi

echo $$ > run.pid
while true; do
  node bot.js >> stdout.log 2>&1
  [ -f STOP ] && { echo "$(date) STOP present, supervisor exit" >> stdout.log; rm -f run.pid; exit 0; }
  sleep 30
done
