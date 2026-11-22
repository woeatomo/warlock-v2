#!/usr/bin/env bash
# Pemasang Sol Warlock: cek Node, pasang dependensi bot + renderer kartu, siapkan .env dan secrets/, jalankan tes.
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo "Node.js belum terpasang (butuh >= 20)."; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
(( major >= 20 )) || { echo "Node $(node -v) terlalu lama, butuh >= 20."; exit 1; }
echo "Node $(node -v) OK"

if command -v apt-get >/dev/null 2>&1 && ! dpkg -s libcairo2 >/dev/null 2>&1; then
  echo "Catatan: renderer kartu PnL (paket canvas) butuh pustaka sistem bila biner siap pakai tidak tersedia:"
  echo "  sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev"
fi

npm ci --no-audit --no-fund
(cd card && npm install --no-audit --no-fund)   # renderer kartu PnL (canvas)
# jsdom hanya untuk tes UI (dipasang terpisah, tidak dipakai bot)
npm install --prefix .test-deps jsdom --no-audit --no-fund --silent >/dev/null 2>&1 || echo "jsdom gagal dipasang: tes UI akan gagal, bot tetap jalan."

mkdir -p secrets paper && chmod 700 secrets
[ -f .env ] || { cp .env.example .env; chmod 600 .env; echo "Dibuat .env (izin 600)."; }
[ -f secrets/telegram.env ] || { printf 'TELEGRAM_BOT_TOKEN=\n' > secrets/telegram.env; chmod 600 secrets/telegram.env; echo "Dibuat secrets/telegram.env: isi TELEGRAM_BOT_TOKEN."; }
[ -f STOP ] || { echo "locked by install.sh: live off until the LIVE button is pressed" > STOP; echo "STOP dibuat: live terkunci (mode dry run)."; }

echo "Menjalankan tes (salinan terisolasi)..."
sh run-all-tests.sh >/tmp/warlock-test.log 2>&1 && echo "Tes lulus." || echo "Ada tes gagal, lihat /tmp/warlock-test.log"

command -v pm2 >/dev/null 2>&1 || echo "PERHATIAN: pm2 belum terpasang -> sudo npm i -g pm2"
command -v cloudflared >/dev/null 2>&1 || [ -x /usr/local/bin/cloudflared ] || echo "PERHATIAN: cloudflared belum terpasang (perlu untuk Mini App) -> lihat README langkah 1"

cat <<'TXT'

Selesai. Langkah berikutnya (detail di README):
  1. nano secrets/telegram.env   -> TELEGRAM_BOT_TOKEN=...
  2. nano .env                   -> HELIUS_API_KEY (atau SOLANA_RPC_URL), TELEGRAM_CHAT_ID, TELEGRAM_ALLOWED_ID (ID dari @userinfobot)
  3. pm2 start ecosystem.sol.config.js && pm2 save && pm2 startup
  4. LIVE (opsional): node set-wallet-key.js, lalu Mini App -> Wallet -> Live -> LIVE
Mode bawaan DRY RUN, uang virtual.
TXT
