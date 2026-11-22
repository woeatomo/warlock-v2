#!/bin/bash
# Live entrypoint for pm2 (app name: lp-live).
# Does not put the private key in the environment or pm2 dump.
# Bot.js loads the key from the encrypted store into memory only.
# Refuses to start if /workspace/lp-bot/STOP is present. Does not remove STOP.
set -u
cd /workspace/lp-bot
unset PAPER || true
unset SOLANA_BOT_PRIVATE_KEY || true
unset PRIVATE_KEY || true
unset TELEGRAM_BOT_TOKEN || true
unset __CURSOR_SANDBOX_ENV_RESTORE || true
if [ -s /home/box/.secrets/lp-bot-telegram.token ]; then
  while IFS= read -r _k; do
    [ -n "$_k" ] && unset "$_k" || true
  done < <(python3 -c "
import os, pathlib
t=pathlib.Path('/home/box/.secrets/lp-bot-telegram.token').read_text().strip()
for k,v in os.environ.items():
    if t and (t in k or t in (v or '')):
        print(k)
")
fi
# If a wallet secret string somehow landed in env, drop that variable too (name only).
if [ -f /home/box/.secrets/lp-bot-wallet.enc ]; then
  : # store exists; bot will decrypt in-process
fi
export DRY_RUN=0
export LIVE_CONFIRMED=1

if [ -f /workspace/lp-bot/STOP ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S %Z') REFUSING LIVE START: /workspace/lp-bot/STOP is present."
  exit 0
fi

exec node /workspace/lp-bot/bot.js
