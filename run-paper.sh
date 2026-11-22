#!/bin/bash
# Fallback paper supervisor (bash). Preferred runner is pm2:
#   pm2 start /workspace/lp-bot/ecosystem.paper.config.js
# Do not run this script at the same time as pm2 app lp-paper (duplicate writers).
# DRY_RUN forced, never signs or sends. Does NOT touch /workspace/lp-bot/STOP.
# Stop paper with:  touch /workspace/lp-bot/paper/STOP   or   pm2 stop lp-paper
set -euo pipefail
cd /workspace/lp-bot
mkdir -p paper

export PAPER=1
export DRY_RUN=1
unset LIVE_CONFIRMED || true
export POSITION_SOL="${POSITION_SOL:-5}"
export RESERVE_SOL="${RESERVE_SOL:-0.15}"
export PAPER_VIRTUAL_SOL="${PAPER_VIRTUAL_SOL:-5.30}"
export PAPER_DAYS="${PAPER_DAYS:-7}"
export POLL_SEC="${POLL_SEC:-300}"
export MIN_LIQ_USD="${MIN_LIQ_USD:-25000}"
export FT_WINDOW="${FT_WINDOW:-30m}"
export MIN_FT="${MIN_FT:-2}"
export MIN_AGE_H="${MIN_AGE_H:-24}"
export MAX_PUMP_24H="${MAX_PUMP_24H:-0.50}"
export VOL_SPIKE_1H_OF_24H="${VOL_SPIKE_1H_OF_24H:-0.50}"
export EMERGENCY_DROP="${EMERGENCY_DROP:-0.30}"
export MAX_POS_TVL_FRAC="${MAX_POS_TVL_FRAC:-0.05}"
export RUGCHECK="${RUGCHECK:-1}"
export CHECK_TOP_HOLDERS="${CHECK_TOP_HOLDERS:-1}"
export RESHAPE="${RESHAPE:-1}"

if [ "${DRY_RUN}" != "1" ] || [ "${PAPER}" != "1" ]; then
  echo "run-paper.sh refuses to start unless PAPER=1 and DRY_RUN=1" >&2
  exit 1
fi
if [ -f paper/STOP ]; then
  echo "paper/STOP is present; not starting. Remove paper/STOP only if you want to resume paper (not live)."
  exit 0
fi
if [ -f paper/ENDED ]; then
  echo "paper/ENDED is present (7-day window finished). Not restarting a new window automatically."
  exit 0
fi

echo $$ > paper/run.pid
echo "$(date '+%Y-%m-%d %H:%M:%S %Z') paper supervisor start pid=$$ DRY_RUN=1 PAPER=1 POSITION_SOL=${POSITION_SOL}" >> paper/stdout.log

ensure_deps() {
  if [ ! -d node_modules/@solana/web3.js ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S %Z') node_modules missing; installing (npm ci, fallback npm install)" >> paper/stdout.log
    if [ -f package-lock.json ]; then
      npm ci --omit=dev >> paper/stdout.log 2>&1 || npm install --omit=dev >> paper/stdout.log 2>&1
    else
      npm install --omit=dev >> paper/stdout.log 2>&1
    fi
  fi
}

while true; do
  ensure_deps
  # belt and suspenders: never pass DRY_RUN=0
  PAPER=1 DRY_RUN=1 node bot.js >> paper/stdout.log 2>&1 || true
  if [ -f paper/STOP ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S %Z') paper/STOP present, supervisor exit" >> paper/stdout.log
    rm -f paper/run.pid
    exit 0
  fi
  if [ -f paper/ENDED ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S %Z') paper window ended, supervisor exit" >> paper/stdout.log
    rm -f paper/run.pid
    exit 0
  fi
  echo "$(date '+%Y-%m-%d %H:%M:%S %Z') paper bot exited, restart in 30s" >> paper/stdout.log
  sleep 30
done
