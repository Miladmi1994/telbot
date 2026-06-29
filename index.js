const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Telegraf } = require('telegraf');
const setupHandlers = require('./handlers');

if (!process.env.BOT_TOKEN) {
    console.error('BOT_TOKEN is missing. Check that .env exists in:', __dirname);
    process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// اتصال هندلرها (منطق‌ها) به ربات
setupHandlers(bot);

// مدیریت خطاهای سراسری برای جلوگیری از توقف ربات
bot.catch((err, ctx) => {
    console.error(`⚠️ خطای محافظت شده در پردازش آپدیت:`, err.message);
});

// اجرای ربات همراه با پاک کردن آپدیت‌های قدیمی و گیر کرده
bot.launch({ dropPendingUpdates: true }).then(() => console.log('ربات کامل ران شد!'));

// بستن امن پروسه
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));