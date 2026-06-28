require('dotenv').config();
const { Telegraf } = require('telegraf');
const { agent } = require('./config');
const setupHandlers = require('./handlers');


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