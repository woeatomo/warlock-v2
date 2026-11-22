/**
 * PM2 ecosystem for the LIVE bot.
 * Never put SOLANA_BOT_PRIVATE_KEY or TELEGRAM_BOT_TOKEN in this file.
 * The key is loaded by bot.js from the encrypted store into memory only.
 * Start only after operator confirms Go Live in the mini app (which removes STOP).
 * This file does not remove STOP. live-exec.sh refuses to start if STOP exists.
 */
module.exports = {
  apps: [
    {
      name: 'lp-live',
      cwd: '/workspace/lp-bot',
      script: '/workspace/lp-bot/live-exec.sh',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 10000,
      exp_backoff_restart_delay: 2000,
      max_memory_restart: '512M',
      env: {
        DRY_RUN: '0',
        LIVE_CONFIRMED: '1',
        PAPER_DAYS: '7',
        POLL_SEC: '300',
        FT_WINDOW: '30m',
        MIN_FT: '2',
        MIN_LIQ_USD: '25000',
        MIN_AGE_H: '24',
        MAX_PUMP_24H: '0.50',
        VOL_SPIKE_1H_OF_24H: '0.50',
        EMERGENCY_DROP: '0.30',
        MAX_POS_TVL_FRAC: '0.05',
        RUGCHECK: '1',
        CHECK_TOP_HOLDERS: '1',
        RESHAPE: '1',
        TP: '0.20',
        MAX_HOURS: '12',
        PAPER_USDC: '500',
        USDC_BUFFER: '0.10',
        GAS_BUFFER_SOL: '0.30',
        ALLOWED_TG_IDS: '1000000001',
      },
      out_file: '/workspace/lp-bot/live-pm2-out.log',
      error_file: '/workspace/lp-bot/live-pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
  ],
};
