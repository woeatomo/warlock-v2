#!/bin/bash
# Paper entrypoint for pm2 (app name: lp-paper).
# Never loads a private key, never signs, never sends. Does not touch /workspace/lp-bot/STOP.
set -u
cd /workspace/lp-bot
mkdir -p paper

export PAPER=1
export DRY_RUN=1
unset LIVE_CONFIRMED || true
# Belt and suspenders: paper must never see a signing key from the environment.
unset SOLANA_BOT_PRIVATE_KEY || true
unset PRIVATE_KEY || true

# If a new box process inherited TELEGRAM_BOT_TOKEN, persist it to a chmod 600
# file outside the repo, then drop it from this process so pm2 dump cannot store it.
# Node reads the file at runtime (telegram-notify.js). Never echo the value.
SECRET_TG="/home/box/.secrets/lp-bot-telegram.token"
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  mkdir -p /home/box/.secrets
  chmod 700 /home/box/.secrets
  umask 077
  python3 -c "import os,pathlib; t=os.environ.get('TELEGRAM_BOT_TOKEN','').strip(); p=pathlib.Path('$SECRET_TG');
p.write_text(t+chr(10) if t else ''); p.chmod(0o600)" || true
  chmod 600 "$SECRET_TG" 2>/dev/null || true
fi
unset TELEGRAM_BOT_TOKEN || true
unset __CURSOR_SANDBOX_ENV_RESTORE || true
# Drop any inherited env whose value embeds the token (names only; never echo values).
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

if [ "${DRY_RUN}" != "1" ] || [ "${PAPER}" != "1" ]; then
  echo "paper-exec.sh refuses to start unless PAPER=1 and DRY_RUN=1" >&2
  exit 1
fi

stamp() { date '+%Y-%m-%d %H:%M:%S %Z'; }

pm2_bin() {
  if command -v pm2 >/dev/null 2>&1; then command -v pm2; return 0; fi
  for c in "$HOME/.local/bin/pm2" /usr/local/bin/pm2 /workspace/lp-bot/node_modules/.bin/pm2; do
    if [ -x "$c" ]; then echo "$c"; return 0; fi
  done
  return 1
}
pm2_stop_self() {
  local bin
  bin=$(pm2_bin) || return 0
  "$bin" stop lp-paper --silent >/dev/null 2>&1 || true
}

if [ -f paper/STOP ]; then
  echo "$(stamp) paper/STOP is present; not starting node. Stopping lp-paper if running."
  pm2_stop_self
  exit 0
fi
if [ -f paper/ENDED ]; then
  echo "$(stamp) paper/ENDED is present (7-day window finished); not starting node. Stopping lp-paper if running."
  pm2_stop_self
  exit 0
fi

# Survive a missing node_modules (as happened 2026-11-10 after a remount).
if [ ! -d node_modules/@solana/web3.js ]; then
  echo "$(stamp) node_modules missing or incomplete; installing dependencies (npm ci, fallback npm install)."
  if [ -f package-lock.json ]; then
    npm ci --omit=dev || npm install --omit=dev
  else
    npm install --omit=dev
  fi
  if [ ! -d node_modules/@solana/web3.js ]; then
    echo "$(stamp) dependency install failed; @solana/web3.js still missing" >&2
    exit 1
  fi
fi

# Keep PAPER=1 DRY_RUN=1 on the process; never pass a key or the Telegram token.
PAPER=1 DRY_RUN=1 node bot.js
code=$?
if [ -f paper/STOP ] || [ -f paper/ENDED ]; then
  echo "$(stamp) paper window stop/end after node exit (code=${code}); stopping lp-paper so pm2 does not restart it."
  pm2_stop_self
elif [ "$code" != "0" ]; then
  echo "$(stamp) paper bot exited with code=${code}; sending crash notify (no token logged)."
  PAPER=1 DRY_RUN=1 node telegram-notify.js --crash "$code" >/dev/null 2>&1 || true
fi
exit "$code"
