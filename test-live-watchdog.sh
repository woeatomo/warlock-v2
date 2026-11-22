#!/bin/bash
# Test of sol-live-watchdog.sh with a fake pm2 and a temp bot dir (nothing real is touched).
set -u
SCRIPT="$(cd "$(dirname "$0")" && pwd)/sol-live-watchdog.sh"
T=$(mktemp -d /tmp/wd-test-XXXXXX); trap 'rm -rf -- "$T"' EXIT
mkdir -p "$T/bot/secrets" "$T/bin"; echo x > "$T/bot/secrets/lp-bot-wallet.enc"
cat > "$T/bin/pm2" <<'EOF'
#!/bin/bash
echo "$@" >> "$FAKE_LOG"
if [ "$1" = jlist ]; then echo "$FAKE_JLIST"; fi
EOF
chmod +x "$T/bin/pm2"
run() { FAKE_LOG="$T/calls" FAKE_JLIST="$1" WD_DIR="$T/bot" WD_PM2="$T/bin/pm2" WD_LOCK="$T/lock" bash "$SCRIPT"; }
fail() { echo "FAIL: $1"; exit 1; }
ONLINE='[{"name":"sol-lp-live","pm2_env":{"status":"online"}}]'; STOPPED='[{"name":"sol-lp-live","pm2_env":{"status":"stopped"}}]'; NONE='[{"name":"other","pm2_env":{"status":"online"}}]'
# 1. dry run mode (STOP present): never starts anything, never even asks pm2
: > "$T/bot/STOP"; : > "$T/calls"; run "$STOPPED"; [ ! -s "$T/calls" ] || fail "acted while STOP present"
# 2. live mode, already online: nothing to do
rm -f "$T/bot/STOP"; : > "$T/calls"; run "$ONLINE"; grep -q -E "^(start|restart)" "$T/calls" && fail "restarted an online bot"
# 3. live mode, stopped (crash / reboot): restart
: > "$T/calls"; run "$STOPPED"; grep -q "^restart sol-lp-live" "$T/calls" || fail "did not restart a stopped live bot"
# 4. live mode, not in pm2 at all (fresh daemon after reboot): start from the ecosystem file
: > "$T/calls"; run "$NONE"; grep -q "^start $T/bot/ecosystem.sol-live.config.js" "$T/calls" || fail "did not start the missing live bot"
# 5. no wallet key: never starts
rm -f "$T/bot/secrets/lp-bot-wallet.enc"; : > "$T/calls"; run "$STOPPED"; grep -q -E "^(start|restart)" "$T/calls" && fail "started without a key"
# 6. pm2 answers garbage (daemon still booting): wait for the next minute
echo x > "$T/bot/secrets/lp-bot-wallet.enc"; : > "$T/calls"; run "not json"; grep -q -E "^(start|restart)" "$T/calls" && fail "acted on an unknown pm2 state"
echo "test-live-watchdog: OK"
