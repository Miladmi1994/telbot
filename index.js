const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Telegraf } = require('telegraf');
const setupHandlers = require('./handlers');
const { scheduleNightlyBackup } = require('./scripts/backup-db');
const { flushDb } = require('./db');

// راه‌اندازی ربات به صورت مستقیم و بدون نیاز به پروکسی
const bot = new Telegraf(process.env.BOT_TOKEN);

setupHandlers(bot);
scheduleNightlyBackup(bot);

bot.catch((err, ctx) => {
    console.error(`⚠️ خطای محافظت شده در پردازش آپدیت:`, err.message);
});

bot.launch({ dropPendingUpdates: true }).then(() => console.log('ربات کامل ران شد!'));

function shutdown(signal) {
    try { flushDb(); } catch (e) {}
    bot.stop(signal);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));