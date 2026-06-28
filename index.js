require('dotenv').config();
const { Telegraf } = require('telegraf');
const { agent } = require('./config');
const setupHandlers = require('./handlers');
const { initDb } = require('./db');

function validateEnv() {
    const required = ['BOT_TOKEN', 'MONGODB_URI', 'GROUP_ID'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    if (!process.env.ADMIN_ID && !process.env.ADMIN_IDS) {
        throw new Error('Missing required environment variable: ADMIN_ID or ADMIN_IDS');
    }
}

const bot = new Telegraf(process.env.BOT_TOKEN);

async function start() {
    validateEnv();
    await initDb();

    setupHandlers(bot);

    bot.catch((err, ctx) => {
        console.error(`⚠️ خطای محافظت شده در پردازش آپدیت:`, err.message);
    });

    await bot.launch({ dropPendingUpdates: true });
    console.log('ربات کامل ران شد!');
}

start().catch(err => {
    console.error('Failed to start bot:', err.message);
    process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));