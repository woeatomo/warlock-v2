/**
 * PM2 ecosystem for the paper Telegram mini app only (localhost).
 * Never put SOLANA_BOT_PRIVATE_KEY or TELEGRAM_BOT_TOKEN in this file.
 * Start:  env -i PATH=... HOME=... PM2_HOME=... pm2 start /workspace/lp-bot/ecosystem.miniapp.config.js
 */
module.exports = {
  apps: [
    {
      name: 'lp-miniapp',
      cwd: '/workspace/lp-bot',
      script: '/workspace/lp-bot/miniapp-exec.sh',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      min_uptime: '5s',
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: '128M',
      env: {
        PAPER: '1',
        DRY_RUN: '1',
        MINIAPP_HOST: '127.0.0.1',
        MINIAPP_PORT: '8787',
      },
      out_file: '/workspace/lp-bot/paper/miniapp-out.log',
      error_file: '/workspace/lp-bot/paper/miniapp-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
  ],
};
