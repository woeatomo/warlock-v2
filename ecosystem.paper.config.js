/**
 * PM2 ecosystem for the paper (dry-run) bot only.
 * Never put SOLANA_BOT_PRIVATE_KEY or any signing secret in this file.
 * Start:  pm2 start /workspace/lp-bot/ecosystem.paper.config.js
 * Stop:   pm2 stop lp-paper   and/or   touch /workspace/lp-bot/paper/STOP
 */
module.exports = {
  apps: [
    {
      name: 'lp-paper',
      cwd: '/workspace/lp-bot',
      script: '/workspace/lp-bot/paper-exec.sh',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      min_uptime: '10s',
      max_restarts: 20,
      restart_delay: 10000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      env: {
        PAPER: '1',
        DRY_RUN: '1',
        PAPER_USDC: '500',
        USDC_BUFFER: '0.10',
        GAS_BUFFER_SOL: '0.30',
        PAPER_DAYS: '7',
        POLL_SEC: '300',
        FT_WINDOW: '30m',
        MIN_FT: '1',
        MIN_LIQ_USD: '10000',
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
        ALLOWED_TG_IDS: '1000000001',
      },
      out_file: '/workspace/lp-bot/paper/pm2-out.log',
      error_file: '/workspace/lp-bot/paper/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
  ],
};
