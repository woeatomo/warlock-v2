#!/bin/bash
# Paper entrypoint for pm2 (app name: sol-lp-paper). Never loads a signing key.
# Does not touch any grok*/elysium*/bsc* process or file, or remove the live STOP file.
set -u
. "$(dirname "$0")/sol-env.sh"
cd "$LP_BOT_DIR"
mkdir -p "$LP_PAPER_DIR"

export PAPER=1
export DRY_RUN=1
unset LIVE_CONFIRMED || true
unset SOLANA_BOT_PRIVATE_KEY || true
unset PRIVATE_KEY || true
unset TELEGRAM_BOT_TOKEN || true
unset __CURSOR_SANDBOX_ENV_RESTORE || true

# Drop any inherited env whose value embeds the token (names only; never echo values).
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

if [ "${DRY_RUN}" != "1" ] || [ "${PAPER}" != "1" ]; then
  echo "sol-paper-exec.sh refuses to start unless PAPER=1 and DRY_RUN=1" >&2
  exit 1
fi

stamp() { date '+%Y-%m-%d %H:%M:%S %Z'; }

pm2_stop_self() {
  local bin="${PM2_BIN:-pm2}"
  local app="${PM2_PAPER_APP:-sol-lp-paper}"
  case "$app" in grok*|elysium*|bsc*) echo "refusing to stop foreign app $app" >&2; return 1 ;; esac
  "$bin" stop "$app" --silent >/dev/null 2>&1 || true
}

if [ -f "$LP_PAPER_DIR/STOP" ]; then
  echo "$(stamp) paper/STOP is present; not starting node. Stopping $PM2_PAPER_APP if running."
  pm2_stop_self
  exit 0
fi
if [ -f "$LP_PAPER_DIR/ENDED" ]; then
  echo "$(stamp) paper/ENDED is present; not starting node. Stopping $PM2_PAPER_APP if running."
  pm2_stop_self
  exit 0
fi

if [ ! -d node_modules/@solana/web3.js ]; then
  echo "$(stamp) node_modules missing or incomplete; installing dependencies."
  if [ -f package-lock.json ]; then
    npm ci --omit=dev || npm install --omit=dev
  else
    npm install --omit=dev
  fi
  if [ ! -d node_modules/@solana/web3.js ]; then
    echo "$(stamp) dependency install failed" >&2
    exit 1
  fi
fi

PAPER=1 DRY_RUN=1 node bot.js
code=$?
if [ -f "$LP_PAPER_DIR/STOP" ] || [ -f "$LP_PAPER_DIR/ENDED" ]; then
  echo "$(stamp) paper window stop/end after node exit (code=${code}); stopping $PM2_PAPER_APP."
  pm2_stop_self
elif [ "$code" != "0" ]; then
  echo "$(stamp) paper bot exited with code=${code}; sending crash notify (no token logged)."
  PAPER=1 DRY_RUN=1 node telegram-notify.js --crash "$code" >/dev/null 2>&1 || true
fi
exit "$code"
