#!/bin/bash
# Keeps LIVE on. LIVE mode = the live lock file STOP is absent (the LIVE button removes it, the DRY RUN button writes it).
# If STOP is absent and the live bot is not running (VPS reboot, crash, pm2 restart), start it again. In DRY RUN mode (STOP present) this does nothing.
# Run every minute from lpbot's crontab. WD_DIR / WD_PM2 / WD_LOCK exist only so the logic can be tested.
DIR="${WD_DIR:-$(cd "$(dirname "$0")" && pwd)}"
PM2="${WD_PM2:-pm2}"
LOCK="${WD_LOCK:-/tmp/sol-live-watchdog.lock}"
export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
exec 9>"$LOCK"; flock -n 9 || exit 0
[ -f "$DIR/STOP" ] && exit 0
# no wallet key, no live (the bot would refuse anyway)
if [ ! -s "$DIR/secrets/lp-bot-wallet.enc" ] && ! grep -q '^PRIVATE_KEY=.\+' "$DIR/.env" 2>/dev/null; then exit 0; fi
st=$($PM2 jlist 2>/dev/null | python3 -c '
import sys, json
try:
    l = json.load(sys.stdin)
    a = [x for x in l if x.get("name") == "sol-lp-live"]
    print(a[0]["pm2_env"]["status"] if a else "missing")
except Exception:
    print("unknown")')
case "$st" in online|launching|unknown) exit 0;; esac
echo "$(date '+%F %T %Z') live lock absent but live bot is '$st': starting it" >> "$DIR/live-watchdog.log"
if [ "$st" = missing ]; then
  $PM2 start "$DIR/ecosystem.sol-live.config.js" >> "$DIR/live-watchdog.log" 2>&1
else
  $PM2 restart sol-lp-live >> "$DIR/live-watchdog.log" 2>&1
fi
