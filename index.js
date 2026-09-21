const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Telegraf } = require('telegraf');
const setupHandlers = require('./handlers');
const { scheduleNightlyBackup } = require('./scripts/backup-db');
const { flushDb } = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);

setupHandlers(bot);

if (process.env.ENABLE_BACKUP !== 'false') {
    scheduleNightlyBackup(bot);
} else {
    console.log('Nightly backup is DISABLED for this instance.');
}

bot.catch((err, ctx) => {
    console.error(`⚠️ [Telegraf Catch] خطای پردازش:`, err.message);
});

async function run() {
    try {
        const info = await bot.telegram.getWebhookInfo();
        console.log(`[Start Check] وضعیت وب‌هوک فعلی: ${info.url || 'ندارد (Polling)'}`);

        if (info.url) {
            console.log(`[Delete Webhook] در حال حذف وب‌هوک مانده روی توکن...`);
            await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        }

        await bot.launch({ dropPendingUpdates: true });
        console.log('🚀 ربات بدون مشکل استارت شد و در حال پولینگ است.');
    } catch (err) {
        console.error('❌ [Launch Error]:', err);
    }
}

run();

function shutdown(signal) {
    try { flushDb(); } catch (e) {}
    bot.stop(signal);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));