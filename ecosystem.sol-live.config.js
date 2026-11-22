/**
 * PM2 ecosystem for Sol LP LIVE (sol-lp-live). Not started by deploy.
 * the operator's mini-app Go Live may start this later. This file does not remove STOP.
 * Never put a private key or Telegram token here. Never touch grok*, elysium*, or bsc*.
 */
const DIR = __dirname;
module.exports = {
  apps: [
    {
      name: 'sol-lp-live',
      cwd: DIR,
      script: DIR + '/sol-live-exec.sh',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      stop_exit_codes: [0],   // the bot exits 0 after it closed everything on STOP; pm2 must then leave it stopped (never kill it to close)
      watch: false,
      min_uptime: '10s',
      max_restarts: 1000000,   // never give up: live must not die on its own, only the DRY RUN button turns it off
      restart_delay: 10000,
      exp_backoff_restart_delay: 2000,
      max_memory_restart: '400M',
      env: {
        DRY_RUN: '0',
        PAPER: '0',
        LIVE_LAUNCH: '1',
        LIVE_CONFIRMED: '1',
        LP_BOT_DIR: DIR,
        LP_PAPER_DIR: DIR + '/paper',
        LP_STOP_FILE: DIR + '/STOP',
        LP_NO_NEW_FILE: DIR + '/NO_NEW',
        LP_SECRETS_DIR: DIR + '/secrets',
        TELEGRAM_TOKEN_FILE: DIR + '/secrets/telegram.env',
        PM2_PAPER_APP: 'sol-lp-paper',
        PM2_LIVE_APP: 'sol-lp-live',
        PM2_LIVE_ECOSYSTEM: DIR + '/ecosystem.sol-live.config.js',
        PM2_BIN: process.env.PM2_BIN || 'pm2',
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
        PAPER_USDC: '500',
        USDC_BUFFER: '0.10',
        GAS_BUFFER_SOL: '0.30',
        ALLOWED_TG_IDS: process.env.ALLOWED_TG_IDS || '',
      },
      out_file: DIR + '/live-pm2-out.log',
      error_file: DIR + '/live-pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
  ],
};
