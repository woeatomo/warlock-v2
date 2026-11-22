#!/bin/bash
# Cloudflare quick tunnel to the paper mini app (app name: lp-tunnel).
# Never loads a signing key. Drops TELEGRAM_BOT_TOKEN from this process;
# Node reads the chmod 600 secret file when updating the Telegram menu button.
set -u
cd /workspace/lp-bot
export PAPER=1
export DRY_RUN=1
unset LIVE_CONFIRMED || true
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
export PATH="${HOME}/.local/bin:${PATH:-/usr/bin:/bin}"
export CLOUDFLARED="${CLOUDFLARED:-${HOME}/.local/bin/cloudflared}"
export TUNNEL_TARGET="${TUNNEL_TARGET:-http://127.0.0.1:8787}"
exec node /workspace/lp-bot/tunnel-watch.js
