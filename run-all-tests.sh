#!/bin/sh
# Runs every test-*.js in an ISOLATED temp copy of the bot, never in the real folder.
# Why: env-config.load() copies .env into process.env, and .env sets LP_BOT_DIR/LP_PAPER_DIR to the real
# folders, overriding the temp dirs tests ask for. Run in place, tests read real settings and some wrote into paper/.
# The copy has no .env, no secrets/ and no live paper data; only a snapshot of paper/state.json is copied
# (test-pnl-calendar-day checks the real history). Nothing is ever written back to the real folder.
# jsdom-based tests need: cd ~/test-deps && npm install jsdom (kept outside the bot node_modules) -> NODE_PATH below.
SRC=$(cd "$(dirname "$0")" && pwd)
D=$(mktemp -d /tmp/lp-tests-XXXXXX) || exit 1
case "$D" in /tmp/lp-tests-?*) ;; *) echo "bad temp dir: $D"; exit 1;; esac
trap 'rm -rf -- "$D"' EXIT INT TERM
chmod 700 "$D"
(cd "$SRC" && tar --exclude=./node_modules --exclude=./paper --exclude=./secrets --exclude=./backups \
  --exclude='./backup-*' --exclude=./.env --exclude='./.env.*' --exclude='*.tar.gz' --exclude='*.bak_*' \
  -cf - .) | (cd "$D" && tar -xf -) || exit 1
ln -s "$SRC/node_modules" "$D/node_modules"
: > "$D/STOP"   # live always locked in the copy (several tests also expect the lock to exist)
mkdir -p "$D/paper" && cp "$SRC/paper/state.json" "$D/paper/state.json" 2>/dev/null
cd "$D" || exit 1
export NODE_PATH="${NODE_PATH:-$SRC/.test-deps/node_modules}"   # no .env in the copy, so env-config defaults every path to the copy itself
pass=0; fail=0
for f in test-*.js; do if timeout 180 node "$f" >/dev/null 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $f"; fi; done
echo "PASS: $pass FAIL: $fail (isolated copy, real folder untouched)"
[ "$fail" -eq 0 ]
