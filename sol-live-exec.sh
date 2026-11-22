#!/bin/bash
# Live entrypoint (pm2 name: sol-lp-live). Not started by this deploy.
# Refuses if STOP is present. Does not remove STOP. Never touches grok*/elysium*/bsc*.
set -u
. "$(dirname "$0")/sol-env.sh"
cd "$LP_BOT_DIR"
# PAPER=0 must be EXPORTED: .env contains PAPER=1 and the bot's dotenv fills it in when it is unset, which turned live into a paper run that exited at once
export PAPER=0
export LIVE_LAUNCH=1
unset SOLANA_BOT_PRIVATE_KEY || true
unset PRIVATE_KEY || true
unset TELEGRAM_BOT_TOKEN || true
unset __CURSOR_SANDBOX_ENV_RESTORE || true
if [ -s "$TELEGRAM_TOKEN_FILE" ]; then
  while IFS= read -r _k; do
    [ -n "$_k" ] && unset "$_k" || true
  done < <(python3 -c "
import os, pathlib, re
p=pathlib.Path(os.environ['TELEGRAM_TOKEN_FILE'])
raw=p.read_text()
m=re.search(r'(?m)^\\s*TELEGRAM_BOT_TOKEN\\s*=\\s*(.*)$', raw)
t=(m.group(1).strip().strip('\"').strip(\"'\") if m else '')
if not t:
    lines=[ln.strip() for ln in raw.splitlines() if ln.strip() and not ln.strip().startswith('#') and '=' not in ln]
    t=lines[0] if lines else ''
for k,v in os.environ.items():
    if t and (t in k or t in (v or '')):
        print(k)
")
fi
export DRY_RUN=0
export LIVE_CONFIRMED=1
if [ -f "$LP_STOP_FILE" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S %Z') REFUSING LIVE START: $LP_STOP_FILE is present."
  exit 0
fi
exec node "$LP_BOT_DIR/bot.js"
