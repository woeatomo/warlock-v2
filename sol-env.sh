# Shared VPS/box path env for Sol LP bot. Sourced by sol-*-exec.sh. No secrets exported.
# Override any of these before start if needed.
LP_BOT_DIR="${LP_BOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
export LP_BOT_DIR
export LP_PAPER_DIR="${LP_PAPER_DIR:-$LP_BOT_DIR/paper}"
export LP_STOP_FILE="${LP_STOP_FILE:-$LP_BOT_DIR/STOP}"
export LP_NO_NEW_FILE="${LP_NO_NEW_FILE:-$LP_BOT_DIR/NO_NEW}"
export LP_SECRETS_DIR="${LP_SECRETS_DIR:-$LP_BOT_DIR/secrets}"
export TELEGRAM_TOKEN_FILE="${TELEGRAM_TOKEN_FILE:-$LP_BOT_DIR/secrets/telegram.env}"
export PM2_PAPER_APP="${PM2_PAPER_APP:-sol-lp-paper}"
export PM2_LIVE_APP="${PM2_LIVE_APP:-sol-lp-live}"
export PM2_PAPER_ECOSYSTEM="${PM2_PAPER_ECOSYSTEM:-$LP_BOT_DIR/ecosystem.sol.config.js}"
export PM2_LIVE_ECOSYSTEM="${PM2_LIVE_ECOSYSTEM:-$LP_BOT_DIR/ecosystem.sol-live.config.js}"
export PM2_BIN="${PM2_BIN:-pm2}"
export MINIAPP_HOST="${MINIAPP_HOST:-127.0.0.1}"
export MINIAPP_PORT="${MINIAPP_PORT:-8797}"
export TUNNEL_TARGET="${TUNNEL_TARGET:-http://127.0.0.1:8797}"
export CLOUDFLARED="${CLOUDFLARED:-/usr/local/bin/cloudflared}"
export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
