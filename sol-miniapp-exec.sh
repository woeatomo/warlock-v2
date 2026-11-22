#!/bin/bash
# Mini app entrypoint (pm2 name: sol-miniapp). Binds localhost only. Never loads a signing key.
set -u
. "$(dirname "$0")/sol-env.sh"
cd "$LP_BOT_DIR"
export PAPER=1
export DRY_RUN=1
unset LIVE_CONFIRMED || true
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
exec node "$LP_BOT_DIR/miniapp/server.js"
