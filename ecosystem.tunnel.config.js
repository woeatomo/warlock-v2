/**
 * PM2 ecosystem for the Cloudflare quick tunnel in front of the paper mini app.
 * Never put SOLANA_BOT_PRIVATE_KEY or TELEGRAM_BOT_TOKEN in this file.
 * Start:  env -i PATH=... HOME=... PM2_HOME=... pm2 start /workspace/lp-bot/ecosystem.tunnel.config.js
 */
module.exports = {
  apps: [
    {
      name: 'lp-tunnel',
      cwd: '/workspace/lp-bot',
      script: '/workspace/lp-bot/tunnel-exec.sh',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      min_uptime: '5s',
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: '512M',
      env: {
        PAPER: '1',
        DRY_RUN: '1',
        TUNNEL_TARGET: 'http://127.0.0.1:8787',
      },
      out_file: '/workspace/lp-bot/paper/tunnel-out.log',
      error_file: '/workspace/lp-bot/paper/tunnel-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
  ],
};
