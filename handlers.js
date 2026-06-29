const { Markup } = require('telegraf');
const { GROUP_ID, TOPIC_TEST, TOPIC_PAYMENT, TOPIC_ERROR, TOPIC_SUPPORT, ADMIN_IDS, userSteps, adminSteps } = require('./config');
const { mainKeyboard, chatKeyboard, rulesKeyboard, getPlansKeyboard, receiptKeyboard, supportMenuKeyboard, getAdminKeyboard, adminVipMenu, adminUsersMenu, adminFinanceMenu, adminServersMenu, adminMarketingMenu } = require('./keyboards');const { readDb, writeDb } = require('./db');
const { createClient, deleteClient, renewClient, getClientTraffic, generateMciConfig, generateMtnConfig, getUsdtRate, testServerConnection } = require('./api');
function generateOrderId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const fetchCache = {};

async function fetchGithubLatest(repo, keyword) {
    const cacheKey = `${repo}_${keyword}`;
    const now = Date.now();

    if (fetchCache[cacheKey] && (now - fetchCache[cacheKey].time < 3 * 60 * 60 * 1000)) {
        return fetchCache[cacheKey].url;
    }

    try {
        const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
        const data = await response.json();
        
        // بررسی وجود assets (اگر لیمیت شده باشیم، این بخش وجود ندارد)
        if (data && data.assets) {
            const asset = data.assets.find(a => a.name.toLowerCase().includes(keyword.toLowerCase()));
            if (asset) {
                fetchCache[cacheKey] = { url: asset.browser_download_url, time: now };
                return asset.browser_download_url;
            }
        }
        
        // در صورت عدم یافتن فایل، لینک کش شده قبلی را بده (اگر موجود بود)
        return fetchCache[cacheKey] ? fetchCache[cacheKey].url : `https://github.com/${repo}/releases/latest`;
    } catch (error) {
        return fetchCache[cacheKey] ? fetchCache[cacheKey].url : `https://github.com/${repo}/releases/latest`;
    }
}

function getServerFlag(serverName) {
    if (!serverName) return '';
    if (serverName.includes('هلند')) return '🇳🇱';
    if (serverName.includes('آلمان')) return '🇩🇪';
    if (serverName.includes('ایتالیا')) return '🇮🇹';
    if (serverName.includes('فرانسه')) return '🇫🇷';
    if (serverName.includes('انگلیس') || serverName.includes('بریتانیا')) return '🇬🇧';
    if (serverName.includes('ترکیه')) return '🇹🇷';
    return '🌍'; // پرچم پیش‌فرض
}

function isUserAdmin(userId) {
    if (!userId) return false;
    const db = readDb();
    return ADMIN_IDS.includes(userId.toString()) || (db.admins && db.admins.some(a => a.id === userId.toString()));
}

async function checkMembership(ctx, userId) {
    try {
        const member = await ctx.telegram.getChatMember('@cyphernett', userId);
        // وضعیت‌های مجاز: ممبر عادی، ادمین، یا سازنده کانال
        return ['member', 'creator', 'administrator'].includes(member.status);
    } catch (e) {
        console.error("خطا در بررسی عضویت کانال:", e.message);
        return false;
    }
}

function setupHandlers(bot) {
    
    bot.use(async (ctx, next) => {
        const db = readDb();
        const userId = ctx.from?.id?.toString();
        if (!userId) return next();

        // بررسی کاربران مسدود شده
        if (!db.bannedUsers) db.bannedUsers = [];
        if (db.bannedUsers.includes(userId)) {
            return ctx.reply('❌ شما توسط مدیریت مسدود شده‌اید و دسترسی شما به ربات قطع است.');
        }

        // بررسی حالت آپدیت (مِینتِنَنس)
        if (db.settings.maintenance && !isUserAdmin(userId) && ctx.chat?.type === 'private') {
            return ctx.reply('🛠 <b>ربات در حال بروزرسانی است...</b>\nلطفاً دقایقی دیگر تلاش کنید.', { parse_mode: 'HTML' });
        }

        // --- سیستم عضویت اجباری برای تمام تعاملات ---
        // اجازه می‌دهیم دکمه بررسی عضویت کار کند
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'check_channel_join') {
            return next();
        }

        // بررسی عضویت برای کاربران عادی (ادمین‌ها مستثنی هستند)
        if (!isUserAdmin(userId) && ctx.chat?.type === 'private') {
            const isMember = await checkMembership(ctx, userId);
            if (!isMember) {
                const joinMsg = '⚠️ برای استفاده از خدمات ربات، لطفاً ابتدا در کانال اطلاع‌رسانی ما عضو شوید:';
                const joinMarkup = {
                    inline_keyboard: [
                        [Markup.button.url('🔴 عضویت در کانال (اجباری)', 'https://t.me/cyphernett')],
                        [Markup.button.callback('✅ عضو شدم', 'check_channel_join')]
                    ]
                };
                
                // اگر کاربر روی دکمه شیشه‌ای کلیک کرد
                if (ctx.callbackQuery) {
                    await ctx.answerCbQuery('❌ ابتدا در کانال عضو شوید!', { show_alert: true });
                    return ctx.reply(joinMsg, { reply_markup: joinMarkup });
                } 
                // اگر کاربر پیام متنی فرستاد
                else {
                    return ctx.reply(joinMsg, { reply_markup: joinMarkup });
                }
            }
        }
        // ------------------------------------------

        return next();
    });

    bot.action('admin_broadcast', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.set(ctx.from.id, { step: 'WAITING_BROADCAST_MESSAGE' });
        ctx.reply('📢 لطفاً پیام خود را بفرستید.\n\n(پشتیبانی از متن، عکس، ویدیو و کپشن)', { 
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('❌ لغو ارسال', 'cancel_broadcast')]
                ]
            }
        });
        ctx.answerCbQuery();
    });

    bot.action('cancel_broadcast', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.delete(ctx.from.id);
        ctx.editMessageText('❌ عملیات ارسال همگانی لغو شد.');
        ctx.answerCbQuery();
    });

    bot.on('message', async (ctx, next) => {
        const adminState = adminSteps.get(ctx.from?.id);
        if (isUserAdmin(ctx.from?.id?.toString()) && adminState && adminState.step === 'WAITING_BROADCAST_MESSAGE') {
            if (ctx.message.text === 'لغو' || ctx.message.text === '/cancel') {
                adminSteps.delete(ctx.from.id);
                return ctx.reply('ارسال همگانی لغو شد.');
            }
            
            const db = readDb();
            const allUsers = new Set();
            Object.keys(db.users || {}).forEach(uid => allUsers.add(uid));
            Object.keys(db.userStats || {}).forEach(uid => allUsers.add(uid));
            
            const usersArray = Array.from(allUsers);
            ctx.reply(`⏳ در حال ارسال پیام به ${usersArray.length} کاربر...\nلطفاً صبور باشید.`);
            adminSteps.delete(ctx.from.id);
            
            let successCount = 0;
            let failCount = 0;
            
            for (const userId of usersArray) {
                try {
                    await ctx.telegram.copyMessage(userId, ctx.chat.id, ctx.message.message_id);
                    successCount++;
                } catch (e) {
                    failCount++; // کاربرانی که ربات را مسدود کرده‌اند
                }
                // وقفه کوتاه برای جلوگیری از مسدود شدن ربات توسط تلگرام (Flood Limit)
                await new Promise(r => setTimeout(r, 50)); 
            }
            
            return ctx.reply(`✅ ارسال همگانی به پایان رسید.\n\n🟢 موفق: ${successCount}\n🔴 ناموفق (بلاک کرده‌اند): ${failCount}`);
        }
        return next();
    });

    // منوی مدیریت
    // جایگزین بخش دستور ادمین
bot.command('admin', (ctx) => {
    const userId = ctx.from?.id?.toString();
    const adminState = adminSteps.get(ctx.from.id);
    if (isUserAdmin(userId) && adminState && adminState.step) return;
    if (!isUserAdmin(userId)) return;
    
    adminSteps.delete(ctx.from.id); 
    const db = readDb();
    const income = (db.totalIncome || 0).toLocaleString('fa-IR');
    const sales = (db.successfulSales || 0).toLocaleString('fa-IR');

    ctx.reply(`⚙️ <b>پنل مدیریت ربات</b>\n\n📊 <b>آمار مالی ربات:</b>\n💰 کل درآمد: <b>${income} تومان</b>\n🛍 تعداد فروش موفق: <b>${sales} عدد</b>`, { parse_mode: 'HTML', ...getAdminKeyboard(db) });
});

// جایگزین بخش دکمه بازگشت به منوی ادمین
bot.action('back_admin', (ctx) => {
    if (!isUserAdmin(ctx.from.id.toString())) return;
    adminSteps.delete(ctx.from.id);
    const db = readDb();
    const income = (db.totalIncome || 0).toLocaleString('fa-IR');
    const sales = (db.successfulSales || 0).toLocaleString('fa-IR');

    ctx.editMessageText(`⚙️ <b>پنل مدیریت ربات</b>\n\n📊 <b>آمار مالی ربات:</b>\n💰 کل درآمد: <b>${income} تومان</b>\n🛍 تعداد فروش موفق: <b>${sales} عدد</b>`, { parse_mode: 'HTML', ...getAdminKeyboard(db) });
    ctx.answerCbQuery();
});

    bot.action('admin_add_admin', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.set(ctx.from.id, { step: 'ADD_ADMIN' });
        ctx.reply('🆔 لطفاً آیدی عددی کاربری که می‌خواهید ادمین شود را بفرستید:');
        ctx.answerCbQuery();
    });

    bot.action('admin_remove_admin', (ctx) => {
    if (!isUserAdmin(ctx.from.id.toString())) return;
    adminSteps.set(ctx.from.id, { step: 'REMOVE_ADMIN' });
    ctx.reply('➖ لطفاً آیدی عددی کاربری که می‌خواهید دسترسی ادمینش لغو شود را بفرستید:');
    ctx.answerCbQuery();
});

// --- مارکتینگ و آمار ---
    bot.action('admin_marketing_menu', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        ctx.editMessageText('📊 <b>پنل آمار و مارکتینگ</b>\nکدوم بخش رو می‌خوای بررسی کنی؟', {
            parse_mode: 'HTML',
            reply_markup: adminMarketingMenu.reply_markup
        });
    });

    bot.action('marketing_users', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const db = readDb();
        const vipCount = (db.vipUsers || []).length;
        const totalUsers = Object.keys(db.users || {}).length;
        const normalCount = Math.max(0, totalUsers - vipCount);

        let serverDensity = {};
        let userConfigCounts = [];

        for (const uid in db.users) {
            const configs = db.users[uid];
            userConfigCounts.push({ id: uid, count: configs.length });
            configs.forEach(c => {
                const sId = c.serverId || 'default';
                serverDensity[sId] = (serverDensity[sId] || 0) + 1;
            });
        }

        userConfigCounts.sort((a, b) => b.count - a.count);
        const top10Configs = userConfigCounts.slice(0, 10);

        let text = `👥 <b>آمار جامع کاربران</b>\n\n`;
        text += `🔸 کل مشتریان: <b>${totalUsers}</b>\n`;
        text += `👑 اعضای VIP: <b>${vipCount}</b>\n`;
        text += `👤 کاربران عادی: <b>${normalCount}</b>\n\n`;

        text += `🖥 <b>تراکم کانفیگ‌ها روی سرورها:</b>\n`;
        const servers = db.servers || [];
        for (const sId in serverDensity) {
            const srv = servers.find(s => s.id === sId);
            const name = srv ? srv.name : 'سرور نامشخص/قدیمی';
            text += `➖ ${name}: <b>${serverDensity[sId]}</b> کانفیگ\n`;
        }

        text += `\n🏆 <b>بیشترین کانفیگ فعال (۱۰ کاربر اول):</b>\n`;
        top10Configs.forEach((u, i) => {
            if (u.count > 0) text += `${i + 1}. <code>${u.id}</code> (<b>${u.count}</b> کانفیگ)\n`;
        });

        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 بازگشت', 'admin_marketing_menu')]] } });
    });

    bot.action('marketing_sales', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const db = readDb();
        
        let totalRevenue = 0;
        let buyers = [];
        for (const uid in db.userStats || {}) {
            const stats = db.userStats[uid];
            if (stats.totalSpent > 0 || stats.buyCount > 0 || stats.renewCount > 0) {
                buyers.push({ id: uid, ...stats });
                totalRevenue += stats.totalSpent;
            }
        }

        const buyersCount = buyers.length;
        const avgLTV = buyersCount > 0 ? Math.floor(totalRevenue / buyersCount) : 0;

        const topSpenders = [...buyers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10);
        const mostLoyal = [...buyers].sort((a, b) => b.renewCount - a.renewCount).slice(0, 10);
        
        const plans = db.settings.plans || [];
        const bestSeller = [...plans].sort((a, b) => (b.sold || 0) - (a.sold || 0))[0];

        const stats = db.stats || { abandonedCarts: 0 };

        let text = `📈 <b>آمار فروش و مارکتینگ</b>\n\n`;
        text += `🛒 سبدهای رها شده: <b>${stats.abandonedCarts}</b>\n`;
        text += `💎 ارزش طول عمر مشتری (LTV): <b>${avgLTV.toLocaleString('fa-IR')} تومان</b>\n`;
        if (bestSeller && bestSeller.sold > 0) {
            text += `🔥 پرفروش‌ترین پلن: <b>${bestSeller.name}</b> (${bestSeller.sold} فروش)\n\n`;
        } else {
            text += `🔥 پرفروش‌ترین پلن: <b>دیتای کافی نیست</b>\n\n`;
        }

        text += `🐋 <b>مشتریان پرخرج (نهنگ‌ها):</b>\n`;
        if (topSpenders.length === 0) text += `دیتای کافی نیست.\n`;
        topSpenders.forEach((u, i) => {
            text += `${i + 1}. <code>${u.id}</code>: <b>${u.totalSpent.toLocaleString('fa-IR')}</b> تومان\n`;
        });

        text += `\n🔄 <b>مشتریان وفادار (بیشترین تمدید):</b>\n`;
        if (mostLoyal.length === 0) text += `دیتای کافی نیست.\n`;
        mostLoyal.forEach((u, i) => {
            if (u.renewCount > 0) text += `${i + 1}. <code>${u.id}</code>: <b>${u.renewCount}</b> بار\n`;
        });

        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 بازگشت', 'admin_marketing_menu')]] } });
    });

    bot.action('marketing_search', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.set(ctx.from.id, { step: 'SEARCH_USER_ID' });
        ctx.reply('🔍 لطفاً آیدی عددی کاربر مورد نظر را ارسال کنید:');
        ctx.answerCbQuery();
    });

// --- مدیریت سرورها ---
   bot.action('admin_servers_menu', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        ctx.editMessageText('🖥 <b>مدیریت سرورها</b>\nاز اینجا می‌تونی سرورها رو مدیریت کنی و مقصدهای پیش‌فرض رو تعیین کنی:', { 
            parse_mode: 'HTML', 
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('➖ حذف سرور', 'admin_remove_server'), Markup.button.callback('➕ افزودن سرور', 'admin_add_server')],
                    [Markup.button.callback('📋 لیست سرورها', 'admin_list_servers')],
                    [Markup.button.callback('✅ سرور عادی', 'admin_set_active_server'), Markup.button.callback('👑 سرور VIP', 'admin_set_vip_server')],
                    [Markup.button.callback('🧳 مدیریت وضعیت تخلیه', 'admin_migration_menu')],
                    [Markup.button.callback('🔙 بازگشت', 'back_admin')]
                ]
            }
        });
        ctx.answerCbQuery();
    });

    bot.action('admin_migration_menu', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const db = readDb();
        const servers = db.servers || [];
        if (servers.length === 0) return ctx.answerCbQuery('سروری وجود ندارد.', {show_alert:true});
        
        const buttons = servers.map(s => {
            const label = s.isMigrating ? `🧳 در حال تخلیه: ${s.name}` : `🟢 سالم: ${s.name}`;
            return [Markup.button.callback(label, `toggle_migration_srv_${s.id}`)];
        });
        
        buttons.push([Markup.button.callback('🔙 بازگشت', 'admin_servers_menu')]);
        ctx.editMessageText('🧳 <b>مدیریت وضعیت تخلیه سرورها</b>\n\nاگه سروری رو روی حالت "در حال تخلیه" بذاری، کاربرای اون سرور موقع تمدید، به صورت اتوماتیک به سرور اکتیو (جدید) کوچ داده میشن.\n\nبرای تغییر وضعیت، روی دکمه‌ی سرور مورد نظر کلیک کن:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
    });

    bot.action(/toggle_migration_srv_(.*)/, (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const srvId = ctx.match[1];
        const db = readDb();
        const server = (db.servers || []).find(s => s.id === srvId);
        if (server) {
            server.isMigrating = !server.isMigrating;
            writeDb(db);
            ctx.answerCbQuery(`وضعیت تخلیه برای سرور تغییر کرد.`, {show_alert: false});
            
            // رفرش کردن منو بعد از تغییر وضعیت
            const buttons = db.servers.map(s => {
                const label = s.isMigrating ? `🧳 در حال تخلیه: ${s.name}` : `🟢 سالم: ${s.name}`;
                return [Markup.button.callback(label, `toggle_migration_srv_${s.id}`)];
            });
            buttons.push([Markup.button.callback('🔙 بازگشت', 'admin_servers_menu')]);
            ctx.editMessageText('🧳 <b>مدیریت وضعیت تخلیه سرورها</b>\n\nاگه سروری رو روی حالت "در حال تخلیه" بذاری، کاربرای اون سرور موقع تمدید، به صورت اتوماتیک به سرور اکتیو (جدید) کوچ داده میشن.\n\nبرای تغییر وضعیت، روی دکمه‌ی سرور مورد نظر کلیک کن:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
        } else {
            ctx.answerCbQuery('سرور یافت نشد!', {show_alert: true});
        }
    });

    bot.action('admin_add_server', (ctx) => {
        adminSteps.set(ctx.from.id, { step: 'ADD_SERVER_FORMAT' });
        ctx.reply(`برای افزودن سرور جدید، اطلاعات رو دقیقاً با فرمت زیر بفرست:\n\n` +
        `نام: سرور آلمان\n` +
        `آدرس: http://1.2.3.4:54321\n` +
        `مسیر پنل: /znuwjha\n` +
        `توکن: XXXXXX\n` +
        `اینباند: 1\n` +
        `دامنه: ns.crrc.ir\n` +
        `اس‌ان‌آی: css.2net.ir\n` +
        `مسیر کانفیگ: /Cypher_Net`);
        ctx.answerCbQuery();
    });

    bot.action('admin_list_servers', (ctx) => {
        const db = readDb();
        const servers = db.servers || [];
        if (servers.length === 0) return ctx.answerCbQuery('هیچ سروری ثبت نشده.', {show_alert:true});
        
        // محاسبه تعداد کاربران روی هر سرور
        const userCounts = {};
        Object.values(db.users || {}).forEach(userConfigs => {
            userConfigs.forEach(conf => {
                const sId = conf.serverId || 'default';
                userCounts[sId] = (userCounts[sId] || 0) + 1;
            });
        });

        let text = '📋 <b>لیست سرورهای فعلی:</b>\n\n';
        servers.forEach(s => {
            let status = [];
            if (db.settings.activeServerId === s.id) status.push('🟢 عادی');
            if (db.settings.activeVipServerId === s.id) status.push('👑 VIP');
            if (s.isMigrating) status.push('🧳 تخلیه');
            const statusStr = status.length > 0 ? status.join(' + ') : '⚪️ استندبای';
            
            const count = userCounts[s.id] || 0;
            
            text += `🔖 شناسه: <code>${s.id}</code>\n🖥 نام: ${s.name} [${statusStr}]\n👥 تعداد اکانت: <b>${count}</b>\n🌐 آدرس: ${s.panelUrl}\n〰️〰️〰️〰️\n`;
        });
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 بازگشت', 'admin_servers_menu')]] } });
    });

    bot.action('admin_set_active_server', (ctx) => {
        const db = readDb();
        const servers = db.servers || [];
        if (servers.length === 0) return ctx.answerCbQuery('سروری وجود ندارد.', {show_alert:true});
        
        const buttons = servers.map(s => {
            // اگر این سرور عادیِ فعلی هست، تیک سبز بخوره
            const label = s.id === db.settings.activeServerId ? `✅ ${s.name}` : s.name;
            return [Markup.button.callback(label, `set_normal_srv_${s.id}`)];
        });
        
        buttons.push([Markup.button.callback('🔙 بازگشت', 'admin_servers_menu')]);
        ctx.editMessageText('✅ سرور <b>خریدهای عادی</b> را انتخاب کن:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
    });

    bot.action('admin_set_vip_server', (ctx) => {
        const db = readDb();
        const servers = db.servers || [];
        if (servers.length === 0) return ctx.answerCbQuery('سروری وجود ندارد.', {show_alert:true});
        
        const buttons = servers.map(s => {
            // اگر این سرور VIPِ فعلی هست، تاج بخوره
            const label = s.id === db.settings.activeVipServerId ? `👑 ${s.name}` : s.name;
            return [Markup.button.callback(label, `set_vip_srv_${s.id}`)];
        });
        
        buttons.push([Markup.button.callback('🔙 بازگشت', 'admin_servers_menu')]);
        ctx.editMessageText('👑 سرور <b>خریدهای VIP</b> را انتخاب کن:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
    });

    bot.action(/set_normal_srv_(.*)/, (ctx) => {
        const srvId = ctx.match[1];
        const db = readDb();
        db.settings.activeServerId = srvId;
        writeDb(db);
        ctx.answerCbQuery('✅ سرور پیش‌فرض عادی تغییر کرد.', {show_alert: true});
        ctx.editMessageText('🖥 <b>مدیریت سرورها</b>\nیک گزینه رو انتخاب کن:', { parse_mode: 'HTML', reply_markup: adminServersMenu.reply_markup });
    });

    bot.action(/set_vip_srv_(.*)/, (ctx) => {
        const srvId = ctx.match[1];
        const db = readDb();
        db.settings.activeVipServerId = srvId;
        writeDb(db);
        ctx.answerCbQuery('👑 سرور پیش‌فرض VIP تغییر کرد.', {show_alert: true});
        ctx.editMessageText('🖥 <b>مدیریت سرورها</b>\nیک گزینه رو انتخاب کن:', { parse_mode: 'HTML', reply_markup: adminServersMenu.reply_markup });
    });

    bot.action('admin_remove_server', (ctx) => {
        adminSteps.set(ctx.from.id, { step: 'REMOVE_SERVER_ID' });
        ctx.reply('➖ شناسه (ID) سروری که می‌خوای حذف بشه رو بفرست:');
        ctx.answerCbQuery();
    });

    bot.action('admin_manual_buy', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.set(ctx.from.id, { step: 'MANUAL_BUY_USER' });
        ctx.reply('🆔 لطفاً آیدی عددی کاربر را ارسال کنید:');
        ctx.answerCbQuery();
    });

    bot.action('admin_ban_user', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.set(ctx.from.id, { step: 'BAN_USER' });
        ctx.reply('🚫 آیدی عددی کاربر برای مسدودسازی را ارسال کنید:');
        ctx.answerCbQuery();
    });

    bot.action('admin_unban_user', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.set(ctx.from.id, { step: 'UNBAN_USER' });
        ctx.reply('✅ آیدی عددی کاربر برای رفع مسدودسازی را ارسال کنید:');
        ctx.answerCbQuery();
    });

    bot.action('admin_clear_test', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.set(ctx.from.id, { step: 'CLEAR_TEST' });
        ctx.reply('🧹 آیدی عددی کاربر برای پاک کردن سابقه تست را ارسال کنید:');
        ctx.answerCbQuery();
    });

    bot.action('admin_reset_user', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.set(ctx.from.id, { step: 'RESET_USER' });
        ctx.reply('🗑 آیدی عددی کاربر برای ریست کامل را ارسال کنید:');
        ctx.answerCbQuery();
    });

    bot.action('toggle_sales', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const db = readDb();
        db.settings.salesOpen = !db.settings.salesOpen;
        writeDb(db);
        ctx.editMessageReplyMarkup(getAdminKeyboard(db).reply_markup);
        ctx.answerCbQuery(db.settings.salesOpen ? 'فروش باز شد' : 'فروش بسته شد');
    });

    bot.action('toggle_maint', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const db = readDb();
        db.settings.maintenance = !db.settings.maintenance;
        writeDb(db);
        ctx.editMessageReplyMarkup(getAdminKeyboard(db).reply_markup);
        ctx.answerCbQuery(db.settings.maintenance ? 'حالت بروزرسانی روشن شد' : 'حالت بروزرسانی خاموش شد');
    });

    bot.action('admin_vip_menu', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        ctx.editMessageText('👑 <b>مدیریت اعضای VIP</b>\nلطفاً یک گزینه را انتخاب کنید:', { parse_mode: 'HTML', reply_markup: adminVipMenu.reply_markup });
        ctx.answerCbQuery();
    });

    bot.action('back_admin', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const db = readDb();
        ctx.editMessageText('⚙️ <b>پنل مدیریت ربات</b>', { parse_mode: 'HTML', ...getAdminKeyboard(db) });
        ctx.answerCbQuery();
    });

    bot.action('admin_users_menu', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        ctx.editMessageText('👥 <b>مدیریت کاربران</b>\nیک گزینه رو انتخاب کن:', { 
            parse_mode: 'HTML', 
            reply_markup: adminUsersMenu.reply_markup 
        });
        ctx.answerCbQuery();
    });


bot.action('admin_list_admins', (ctx) => {
    if (!isUserAdmin(ctx.from.id.toString())) return;
    const db = readDb();
    let text = '📋 <b>لیست ادمین‌های ربات:</b>\n\n';
    text += '👑 <b>ادمین‌های اصلی (Super Admins):</b>\n';
    ADMIN_IDS.forEach(id => {
        text += `👤 <code>${id}</code>\n`;
    });
    
    text += '\n👥 <b>ادمین‌های اضافه شده:</b>\n';
    if (db.admins && db.admins.length > 0) {
        db.admins.forEach(admin => {
            text += `🔹 ${admin.name} (<code>${admin.id}</code>)\n`;
        });
    } else {
        text += 'هیچ ادمین جدیدی اضافه نشده است.\n';
    }
    
    ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: adminUsersMenu.reply_markup });
    ctx.answerCbQuery();
});

bot.command('fixdb', (ctx) => {
    if (!isUserAdmin(ctx.from.id.toString())) return;
    const db = readDb();
    let count = 0;
    
    for (const userId in db.users) {
        db.users[userId].forEach(conf => {
            // اگه سرورش رو پیدا نکرده بود یا همون آیدی‌های قبلی بود، بندازش رو آیدی درست ایتالیا
            if (!conf.serverId || conf.serverId === 'srv_11528' || conf.serverId === 'default') {
                conf.serverId = 'srv_580584'; // آیدی جدید و درست سرور ایتالیای شما
                count++;
            }
        });
    }
    writeDb(db);
    ctx.reply(`✅ دیتابیس اصلاح شد! ${count} کانفیگ قدیمی، با موفقیت به سرور ایتالیا وصل شدن.`);
});

    bot.action('admin_finance_menu', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        ctx.editMessageText('💰 <b>مدیریت مالی و فروش</b>\nیک گزینه رو انتخاب کن:', { 
            parse_mode: 'HTML', 
            reply_markup: adminFinanceMenu.reply_markup 
        });
        ctx.answerCbQuery();
    });

    bot.action('admin_add_vip', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        ctx.editMessageText('👑 نوع کاربر VIP را انتخاب کنید:', {
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('👤 کاربر جدید (فقط باز شدن پلن)', 'add_vip_new')],
                    [Markup.button.callback('🔄 کاربر قدیمی (اتصال کانفیگ)', 'add_vip_old')],
                    [Markup.button.callback('🔙 بازگشت', 'admin_vip_menu')]
                ]
            }
        });
    });


    bot.action('add_vip_new', (ctx) => {
        adminSteps.set(ctx.from.id, { step: 'ADD_VIP_NEW_USER' });
        ctx.reply('🆔 لطفاً آیدی عددی کاربر تلگرام را برای افزودن به لیست VIP ارسال کنید:');
        ctx.answerCbQuery();
    });

    bot.action('add_vip_old', (ctx) => {
        adminSteps.set(ctx.from.id, { step: 'ADD_VIP_USER_ID' }); 
        ctx.reply('🆔 لطفاً آیدی عددی کاربر تلگرام را ارسال کنید:');
        ctx.answerCbQuery();
    });

    bot.action('admin_remove_vip', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.set(ctx.from.id, { step: 'REMOVE_VIP_USER' });
        ctx.reply('➖ لطفاً آیدی عددی کاربری که می‌خواهید از لیست VIP حذف شود را بفرستید:');
        ctx.answerCbQuery();
    });

    bot.action('admin_list_vip', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const db = readDb();
        let text = '📋 <b>لیست اعضای VIP:</b>\n\n';
        let found = false;

        for (const userId in db.users) {
            const hasVip = db.users[userId].some(c => c.isVip);
            if (hasVip) {
                found = true;
                text += `👤 آیدی کاربر: <code>${userId}</code>\n`;
                db.users[userId].forEach(c => {
                    if (c.isVip) {
                        text += `🔹 نام: ${c.name}\n📧 ایمیل: <code>${c.email}</code>\n\n`;
                    }
                });
            }
        }

        if (!found) text += 'هیچ عضو VIP یافت نشد.';
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: adminVipMenu.reply_markup });
        ctx.answerCbQuery();
    });

    bot.action('admin_plans_menu', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        ctx.editMessageText('📦 <b>مدیریت پکیج‌ها</b>\nیک گزینه رو انتخاب کن:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('➕ افزودن یا ویرایش پکیج', 'admin_add_plan')],
                    [Markup.button.callback('📋 لیست پکیج‌های فعلی', 'admin_view_plans')],
                    [Markup.button.callback('➖ حذف پکیج', 'admin_remove_plan')],
                    [Markup.button.callback('🔙 بازگشت', 'back_admin')]
                ]
            }
        });
    });

    bot.action('admin_view_plans', (ctx) => {
        const db = readDb();
        const plans = db.settings.plans || [];
        if (plans.length === 0) return ctx.answerCbQuery('هیچ پکیجی وجود ندارد.', {show_alert:true});
        
        let text = '📋 <b>لیست پکیج‌های فعلی:</b>\n\n';
        plans.forEach(p => {
            text += `🔖 شناسه: <code>${p.id}</code>\n🏷 نام: ${p.name}\n📦 حجم: ${p.gb} | ⏳ روز: ${p.days}\n💰 قیمت: ${p.price}\n👁 خرید جدید: ${p.showInNew ? 'بله' : 'خیر'} | 🔄 تمدید: ${p.showInRenew ? 'بله' : 'خیر'}\n👤 اختصاصی برای: <code>${p.targetUserId || 'همه'}</code>\n〰️〰️〰️〰️\n`;
        });
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 بازگشت', 'admin_plans_menu')]] } });
    });

    bot.action('admin_add_plan', (ctx) => {
        adminSteps.set(ctx.from.id, { step: 'ADD_PLAN_FORMAT' });
        const text = `برای افزودن یا آپدیت پکیج، اطلاعات رو دقیقاً با فرمت زیر کپی کن و با مقادیر خودت بفرست:\n\n` +
        `شناسه: custom_1\n` +
        `نام: 20 گیگ ویژه\n` +
        `حجم: 20\n` +
        `روز: 15\n` +
        `قیمت: 100000\n` +
        `ترتیب: 1\n` +
        `نمایش در خرید جدید: بله\n` +
        `نمایش در تمدید: خیر\n` +
        `آیدی کاربر خاص: ندارد`;
        ctx.reply(text);
    });

    bot.action('admin_remove_plan', (ctx) => {
        adminSteps.set(ctx.from.id, { step: 'REMOVE_PLAN_ID' });
        ctx.reply('➖ شناسه (ID) پکیجی که می‌خوای حذف بشه رو بفرست:');
    });

    bot.action('reset_finance', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const db = readDb();
        db.totalIncome = 0;
        db.successfulSales = 0;
        writeDb(db);
        ctx.answerCbQuery('🧹 آمار مالی و تعداد فروش با موفقیت صفر شد!', { show_alert: true });
    });

    bot.action(/manual_p_(.*)/, async (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const planId = ctx.match[1];
        const state = adminSteps.get(ctx.from.id);
        if (!state || state.step !== 'MANUAL_BUY_PLAN') return;

        state.planId = planId;
        state.step = 'MANUAL_BUY_ORDER';
        adminSteps.set(ctx.from.id, state);

        ctx.reply('🔢 حالا شماره سفارش (مثلاً ۶ رقمی) را ارسال کنید:');
        ctx.answerCbQuery();
    });

    const sendFeedbackPrompt = async (ctx, userId, ticketMsgId) => {
        try {
            await ctx.telegram.sendMessage(userId, '🔒 مکالمه بسته شد.\nآیا مشکل شما برطرف شد؟', {
                reply_markup: { inline_keyboard: [[Markup.button.callback('✅ بله، مشکل حل شد', `feedback_yes_${ticketMsgId}`)], [Markup.button.callback('❌ خیر، حل نشد', `feedback_no_${ticketMsgId}`)]] }
            });
        } catch (e) {}
    };

    // هندلر دکمه بررسی عضویت
    bot.action('check_channel_join', async (ctx) => {
        const isMember = await checkMembership(ctx, ctx.from.id);
        if (isMember) {
            await ctx.answerCbQuery('✅ عضویت شما تایید شد. خوش آمدید!', { show_alert: true });
            await ctx.deleteMessage().catch(() => {});
            
            // نمایش پیام اصلی استارت
            userSteps.delete(ctx.from.id);
            const username = ctx.from.username ? `@${ctx.from.username}` : 'ندارد';
            ctx.reply(`سلام! خوش اومدی 🌹\n\n👤 <b>آیدی تلگرام:</b> ${username}\n🆔 <b>کد یکتای شما:</b> <code>${ctx.from.id}</code>\n\n👇 لطفاً یک گزینه رو انتخاب کن:`, { parse_mode: 'HTML', ...mainKeyboard });
        } else {
            await ctx.answerCbQuery('❌ شما هنوز در کانال عضو نشده‌اید! لطفاً ابتدا عضو شوید.', { show_alert: true });
        }
    });

    // تغییر دستور استارت
    bot.start(async (ctx) => {
        const isMember = await checkMembership(ctx, ctx.from.id);
        
        if (!isMember) {
            return ctx.reply('⚠️ برای استفاده از خدمات ربات، لطفاً ابتدا در کانال اطلاع‌رسانی ما عضو شوید:', {
                reply_markup: {
                    inline_keyboard: [
                        [Markup.button.url('🔴 عضویت در کانال', 'https://t.me/cyphernett')],
                        [Markup.button.callback('✅ عضو شدم', 'check_channel_join')]
                    ]
                }
            });
        }

        // اگر کاربر از قبل عضو بود، پیام عادی را می‌بیند
        userSteps.delete(ctx.from.id);
        const username = ctx.from.username ? `@${ctx.from.username}` : 'ندارد';
        ctx.reply(`سلام! خوش اومدی 🌹\n\n👤 <b>آیدی تلگرام:</b> ${username}\n🆔 <b>کد یکتای شما:</b> <code>${ctx.from.id}</code>\n\n👇 لطفاً یک گزینه رو انتخاب کن:`, { parse_mode: 'HTML', ...mainKeyboard });
    });

    bot.action('cancel_flow', (ctx) => {
        ctx.answerCbQuery();
        const state = userSteps.get(ctx.from.id);
        if (state && (state.step === 'WAITING_RECEIPT' || state.step === 'WAITING_RENEW_RECEIPT')) {
            const db = readDb();
            if (!db.stats) db.stats = { abandonedCarts: 0, testToBuyConversion: 0 };
            db.stats.abandonedCarts++;
            writeDb(db);
        }
        userSteps.delete(ctx.from.id);
        ctx.editMessageText('عملیات لغو شد. می‌تونی از منوی پایین یک گزینه انتخاب کنی.');
    });

    const dashMenu = Markup.inlineKeyboard([
        [Markup.button.callback('📊 وضعیت حجم و زمان', 'dash_status')],
        [Markup.button.callback('ℹ️ دریافت کانفیگ', 'dash_info')],
        [Markup.button.callback('❌ بستن', 'close_menu')]
    ]);
 
    bot.hears('👤 داشبورد من', async (ctx) => {
        // چون چک کردن وضعیت اکانت‌ها از سرور ممکنه چند ثانیه طول بکشه، اول یه پیام لودینگ میدیم
        const msgWait = await ctx.reply('⏳ در حال دریافت اطلاعات از سرور...');
        
        const results = await fetchUserConfigsStatus(ctx.from.id);
        
        const activeCount = results.filter(r => r.status === 'active').length;
        const expiredCount = results.filter(r => r.status === 'expired').length;
        
        const msg = `👤 <b>داشبورد مدیریت حساب</b>\n\n` +
                    `🆔 شناسه کاربری: <code>${ctx.from.id}</code>\n` +
                    `🟢 تعداد اکانت‌های فعال: <b>${activeCount}</b>\n` +
                    `🔴 تعداد اکانت‌های منقضی شده: <b>${expiredCount}</b>\n\n` +
                    `👇 لطفا یک بخش را انتخاب کنید:`;

        await ctx.telegram.editMessageText(ctx.chat.id, msgWait.message_id, undefined, msg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🟢 اکانت‌های فعال', 'dash_active')],
                    [Markup.button.callback('🔴 اکانت‌های منقضی شده', 'dash_expired')]
                ]
            }
        });
    });

    bot.action('dash_main', async (ctx) => {
        await ctx.answerCbQuery('در حال بروزرسانی اطلاعات...', { show_alert: false });
        
        const results = await fetchUserConfigsStatus(ctx.from.id);
        
        const activeCount = results.filter(r => r.status === 'active').length;
        const expiredCount = results.filter(r => r.status === 'expired').length;
        
        const msg = `👤 <b>داشبورد مدیریت حساب</b>\n\n` +
                    `🆔 شناسه کاربری: <code>${ctx.from.id}</code>\n` +
                    `🟢 تعداد اکانت‌های فعال: <b>${activeCount}</b>\n` +
                    `🔴 تعداد اکانت‌های منقضی شده: <b>${expiredCount}</b>\n\n` +
                    `👇 لطفا یک بخش را انتخاب کنید:`;

        await ctx.editMessageText(msg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🟢 اکانت‌های فعال', 'dash_active')],
                    [Markup.button.callback('🔴 اکانت‌های منقضی شده', 'dash_expired')]
                ]
            }
        });
    });

    bot.action('dash_main', async (ctx) => {
        await ctx.answerCbQuery();
        const msg = `به داشبورد کاربری خوش آمدید.\nلطفا یک بخش را انتخاب کنید:`;
        await ctx.editMessageText(msg, {
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🟢 اکانت‌های فعال', 'dash_active')],
                    [Markup.button.callback('🔴 اکانت‌های منقضی شده', 'dash_expired')]
                ]
            }
        });
    });

    async function fetchUserConfigsStatus(userId) {
        const db = readDb();
        let userConfigs = [...(db.users[userId] || [])];

        userConfigs.sort((a, b) => {
            if (a.isVip !== b.isVip) return a.isVip ? -1 : 1;
            const tsA = parseInt((a.email.match(/_(\d+)$/) || [0,0])[1]) || 0;
            const tsB = parseInt((b.email.match(/_(\d+)$/) || [0,0])[1]) || 0;
            return tsB - tsA; 
        });

        return await Promise.all(userConfigs.map(async (conf) => {
            // --- تغییر مهم: پیدا کردن سرور اختصاصی این کانفیگ ---
            const targetServer = db.servers?.find(s => s.id === conf.serverId);
            const traffic = await getClientTraffic(conf.email, targetServer);
            // ----------------------------------------------------
            
            if (!traffic) return { conf, status: 'deleted', remainDays: -999 };
            
            const usedGB = (traffic.up + traffic.down) / 1073741824;
            const totalGB = traffic.total / 1073741824;
            
            let isExpired = false;
            let remainDays = 999;
            
            if (traffic.expiryTime > 0) {
                remainDays = (traffic.expiryTime - Date.now()) / (1000 * 60 * 60 * 24);
                if (remainDays < 0) isExpired = true;
            } else if (traffic.expiryTime === 0 && traffic.total > 0 && usedGB >= totalGB) {
                isExpired = true;
                remainDays = -1;
            }

            if (traffic.total > 0 && usedGB >= totalGB) isExpired = true;
            
            return { conf, status: isExpired ? 'expired' : 'active', remainDays };
        }));
    }

    bot.action('dash_active', async (ctx) => {
        await ctx.answerCbQuery();
        const results = await fetchUserConfigsStatus(ctx.from.id);
        let activeButtons = results
            .filter(r => r.status === 'active')
            .map(r => [Markup.button.callback(r.conf.name, `dash_detail_${r.conf.uuid}`)]);

        if (activeButtons.length === 0) return ctx.editMessageText('🟢 شما هیچ اکانت فعالی ندارید.', { reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 بازگشت', 'dash_main')]] } });
        
        activeButtons.push([Markup.button.callback('🔙 بازگشت', 'dash_main')]);
        ctx.editMessageText('🟢 <b>لیست اکانت‌های فعال شما:</b>\nبرای مشاهده جزئیات روی نام کانفیگ کلیک کنید.', { parse_mode: 'HTML', reply_markup: { inline_keyboard: activeButtons } });
    });

    bot.action('dash_expired', async (ctx) => {
        await ctx.answerCbQuery();
        const results = await fetchUserConfigsStatus(ctx.from.id);
        let expiredButtons = results
            .filter(r => r.status !== 'active')
            .map(r => [Markup.button.callback(`${r.status === 'deleted' ? '❌' : '🔴'} ${r.conf.name}`, `dash_detail_${r.conf.uuid}`)]);

        if (expiredButtons.length === 0) return ctx.editMessageText('🔴 شما هیچ اکانت منقضی شده‌ای ندارید.', { reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 بازگشت', 'dash_main')]] } });
        
        expiredButtons.push([Markup.button.callback('🔙 بازگشت', 'dash_main')]);
        ctx.editMessageText('🔴 <b>لیست اکانت‌های منقضی و حذف شده شما:</b>', { parse_mode: 'HTML', reply_markup: { inline_keyboard: expiredButtons } });
    });

    bot.action(/dash_detail_(.+)/, async (ctx) => {
        const uuid = ctx.match[1];
        await ctx.answerCbQuery('در حال دریافت اطلاعات...', { show_alert: false });
        
        const db = readDb();
        const conf = (db.users[ctx.from.id] || []).find(c => c.uuid === uuid);
        if (!conf) return ctx.editMessageText('❌ اکانت یافت نشد.');

        const targetServer = db.servers?.find(s => s.id === conf.serverId);
        const traffic = await getClientTraffic(conf.email, targetServer);
        let statusText, totalText = 'نامحدود', usedText = '0 GB', remainText = 'نامحدود', remainDaysText = 'نامحدود';
        let isActive = false;

        if (!traffic) {
            statusText = '🔴 حذف شده از سرور';
        } else {
            const totalGB = traffic.total / 1073741824;
            const usedGB = (traffic.up + traffic.down) / 1073741824;
            
            totalText = traffic.total === 0 ? 'نامحدود' : totalGB.toFixed(2) + ' GB';
            usedText = usedGB.toFixed(2) + ' GB';
            remainText = traffic.total === 0 ? 'نامحدود' : (totalGB - usedGB).toFixed(2) + ' GB';

            if (traffic.expiryTime > 0) {
                const diffMs = traffic.expiryTime - Date.now();
                if (diffMs > 0) {
                    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                    remainDaysText = `${days} روز و ${hours} ساعت و ${minutes} دقیقه`;
                } else {
                    remainDaysText = 'منقضی شده ❌';
                }
            }

            const isVolumeExpired = traffic.total > 0 && usedGB >= totalGB;
            const isTimeExpired = traffic.expiryTime > 0 && traffic.expiryTime < Date.now();
            isActive = !isVolumeExpired && !isTimeExpired;
            statusText = isActive ? '🟢 فعال' : '🔴 منقضی شده';
        }

        const isTest = conf.name.includes('Test') || conf.name.includes('تست');
        const orderIdText = conf.orderId ? conf.orderId : 'ندارد';

        const msg = `📝 <b>نام کانفیگ:</b> ${conf.name}\n👤 <b>شناسه کاربر:</b> <code>${ctx.from.id}</code>\n🧾 <b>شناسه خرید:</b> <code>${orderIdText}</code> (ثبت‌شده)\nوضعیت: ${statusText}\n\n🔸 <b>کل حجم:</b> ${totalText}\n🔹 <b>مصرف شده:</b> ${usedText}\n🟢 <b>باقی‌مانده:</b> ${remainText}\n⏳ <b>زمان باقی‌مانده:</b> ${remainDaysText}`;

        let buttons = [];
        if (isActive) buttons.push([Markup.button.callback('دریافت کانفیگ', `dash_getconf_${conf.uuid}`)]);
        if (!isTest) buttons.push([Markup.button.callback('🔄 تمدید سرویس', `init_renew_${conf.email}`)]);
        buttons.push([Markup.button.callback('🔙 بازگشت', isActive ? 'dash_active' : 'dash_expired')]);

        ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
    });

    bot.action(/dash_getconf_(.+)/, async (ctx) => {
    const uuid = ctx.match[1];
    ctx.editMessageText(`کدام کانفیگ را می‌خواهید؟\n\n⚠️ <b>نکته:</b> ابتدا کانفیگ ۱ را امتحان کنید. در صورت بروز مشکل و عدم اتصال، از کانفیگ ۲ استفاده کنید.`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [Markup.button.callback('🟡 کانفیگ ۱', `getconf_1_${uuid}`), Markup.button.callback('🔵 کانفیگ ۲', `getconf_2_${uuid}`)],
                [Markup.button.callback('🔙 بازگشت به جزئیات', `dash_detail_${uuid}`)]
            ]
        }
    });
});

    bot.hears('🔄 تمدید سرویس', async (ctx) => {
        userSteps.delete(ctx.from.id);
        
        const statusMsg = await ctx.reply('⏳ در حال بررسی وضعیت اکانت‌ها...');
        const results = await fetchUserConfigsStatus(ctx.from.id);
        
        // فیلتر کردن اکانت‌های تستی، سرویس قبلی و منقضی‌های بالای ۵ روز
        const eligibleConfigs = results.filter(r => {
            if (r.conf.name === 'سرویس قبلی' || r.conf.email.startsWith('Test_')) return false;
            if (r.status === 'deleted') return false; 
            if (r.status === 'expired' && r.remainDays < -5) return false; 
            return true;
        }).map(r => r.conf);

        ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

        if (eligibleConfigs.length === 0) return ctx.reply('❌ شما سرویس مجازی برای تمدید ندارید.');
        if (eligibleConfigs.length === 1) return triggerRenewPlanMenu(ctx, eligibleConfigs[0].email, eligibleConfigs[0].name);

        const buttons = eligibleConfigs.map(conf => [Markup.button.callback(`🔄 تمدید: ${conf.name}`, `init_renew_${conf.email}`)]);
        ctx.reply('📋 کدوم یکی از سرویس‌هات رو می‌خوای تمدید کنی؟', { reply_markup: { inline_keyboard: buttons } });
    });

    bot.action(/init_renew_(.+)/, (ctx) => {
        const email = ctx.match[1];
        ctx.answerCbQuery();
        const db = readDb();
        const allConfigs = Object.values(db.users).flat();
        const conf = allConfigs.find(c => c.email === email);
        triggerRenewPlanMenu(ctx, email, conf ? conf.name : 'سرویس شما');
    });

    function triggerRenewPlanMenu(ctx, email, name) {
        userSteps.set(ctx.from.id, { step: 'RENEW_SELECT_PLAN', email, configName: name, ts: Date.now() });
        
        const db = readDb();
        const plans = db.settings.plans || [];
        
        const userConfigs = db.users[ctx.from.id] || [];
        const targetConf = userConfigs.find(c => c.email === email);
        const isUserStillVip = db.vipUsers && db.vipUsers.includes(ctx.from.id.toString());
        const isThisConfigVip = targetConf && (targetConf.isVip || targetConf.name.includes('VIP')) && isUserStillVip;
        let buttons = [];
        
        if (isThisConfigVip) {
            buttons.push([Markup.button.callback('👑 VIP: 100G - 1 ماهه (قیمت 1$)', 'renew_plan_vip')]);
        } else {
            buttons = plans.map(plan => [Markup.button.callback(plan.btnText, `renew_plan_${plan.id}`)]);
        }
        
        buttons.push([Markup.button.callback('❌ لغو', 'cancel_flow')]);

        const txt = `🔄 قصد تمدید سرویس <b>${name}</b> را دارید.\nبسته مورد نظرت رو انتخاب کن:`;
        const kb = { reply_markup: { inline_keyboard: buttons } };
        
        if (ctx.callbackQuery) ctx.editMessageText(txt, { parse_mode: 'HTML', ...kb });
        else ctx.reply(txt, { parse_mode: 'HTML', ...kb });
    }

    bot.action(/renew_plan_(.*)/, async (ctx) => {
        const planId = ctx.match[1];
        if (planId !== 'vip') ctx.answerCbQuery();
        
        const state = userSteps.get(ctx.from.id);
        if (!state || state.step !== 'RENEW_SELECT_PLAN') return;

        const db = readDb();
        let planName, priceStr, priceDisplay;
        let vipPrice = null;

        if (planId === 'vip') {
            ctx.answerCbQuery('⏳ در حال بررسی قیمت...', { show_alert: false });
            const isVip = db.vipUsers && db.vipUsers.includes(ctx.from.id.toString());
            if (!isVip) return ctx.answerCbQuery('❌ فقط اعضای VIP می‌توانند این پلن را انتخاب کنند.', { show_alert: true });
            
            vipPrice = await getUsdtRate();
            planName = '100G  VIP - یک ماهه';
            
            if (vipPrice) {
                priceStr = vipPrice.toString();
                priceDisplay = `<code>${vipPrice.toLocaleString('en-US')}</code> تومان (1$)`;
            } else {
                priceStr = 'نامعین';
                priceDisplay = 'نامعین ⚠️ (لطفاً فرآیند را لغو کرده و دوباره تلاش کنید)';
            }
        } else {
            const plan = (db.settings.plans || []).find(p => p.id === planId);
            if (!plan) return ctx.answerCbQuery('❌ خطای دریافت پلن!', { show_alert: true });
            planName = plan.name;
            priceStr = plan.price.toString();
            priceDisplay = `<code>${plan.price.toLocaleString('en-US')}</code> تومان`;
        }

        const orderId = generateOrderId();
        state.step = 'WAITING_RENEW_RECEIPT';
        state.planId = planId;
        state.planName = planName;
        state.price = priceStr;
        state.orderId = orderId;
        state.ts = Date.now();
        userSteps.set(ctx.from.id, state);

        let kbButtons = [];
        kbButtons.push([Markup.button.callback('❌ لغو', 'cancel_flow')]);

        ctx.editMessageText(`💳 مبلغ تمدید: ${priceDisplay}\n📝 نام سرویس: ${state.configName}\n🧾 شناسه خرید: <code>${state.orderId}</code> (شماره سفارش)\n\nشماره کارت:\n<code>6219861906525570</code>\nبه نام:\nح.احقاقی‌فر\n\n📸 <b>لطفا عکس رسید واریز را همینجا بفرستید:</b>`, { 
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: kbButtons }
        });
    });

    // هندلر برای بروزرسانی خودکار کیبورد کاربران قدیمی
    bot.hears('📚 آموزش‌ها', (ctx) => {
        ctx.reply('✅ منوی کاربری شما به نسخه جدید بروزرسانی شد.\nلطفاً برای مشاهده آموزش‌ها، دوباره روی دکمه «📥 اپلیکیشن و آموزش» در پایین صفحه ضربه بزنید.', mainKeyboard);
    });

    bot.hears('📥 اپلیکیشن و آموزش', (ctx) => {
        // userSteps.delete(ctx.from.id); // اگه تو پروژه‌ات داری فعالش کن
        
        ctx.reply('📚 <b>پنل دانلود و آموزش</b>\n\n⚠️ <b>نکته خیلی مهم:</b> برای اینکه کانفیگ‌ها بدون مشکل وصل بشن، حتماً باید آخرین نسخه اپلیکیشن رو نصب داشته باشی.\n\n👇 سیستم‌عامل دستگاهت رو انتخاب کن:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🍎 آیفون (iOS)', 'panel_tut_ios')],
                    [Markup.button.callback('🤖 اندروید (Android)', 'panel_tut_android')],
                    [Markup.button.callback('💻 ویندوز (Windows)', 'panel_tut_win')],
                    [Markup.button.callback('❌ بستن', 'close_menu')]
                ]
            }
        });
    });

    bot.action('panel_tut_ios', (ctx) => {
        ctx.answerCbQuery();
        ctx.editMessageText('🍎 <b>اپلیکیشن‌های آیفون (iOS)</b>\n\nبرای دریافت برنامه‌ها از اپ‌استور، روی لینک‌های زیر کلیک کنید:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.url('دانلود V2box', 'https://apps.apple.com/us/app/v2box-v2ray-client/id6446814690')],
                    [Markup.button.url('دانلود Incy', 'https://apps.apple.com/us/app/incy/id6756943388')],
                    [Markup.button.url('دانلود Happ Proxy', 'https://apps.apple.com/us/app/happ-proxy-utility/id6504287215')],
                    [Markup.button.callback('🔙 بازگشت', 'back_tut_main')]
                ]
            }
        });
    });

    // --- اندروید ---
    bot.action('panel_tut_android', async (ctx) => {
        await ctx.answerCbQuery('در حال دریافت اطلاعات...', { show_alert: false });
        const v2rayLink = await fetchGithubLatest('2dust/v2rayNG', 'universal.apk');

        ctx.editMessageText('🤖 <b>اپلیکیشن‌های اندروید</b>\n\nجهت دانلود، برنامه مورد نظر خود را انتخاب کنید:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.url('دانلود v2rayNG', v2rayLink)],
                    [Markup.button.callback('دانلود Incy', 'dl_and_incy')],
                    [Markup.button.callback('دانلود Happ Proxy', 'dl_and_happ')],
                    [Markup.button.url('دانلود NapsternetV', 'https://play.google.com/store/apps/details?id=com.napsternetlabs.napsternetv&hl=en')],
                    [Markup.button.callback('🔙 بازگشت', 'back_tut_main')]
                ]
            }
        });
    });

    bot.action('dl_and_incy', async (ctx) => {
    await ctx.answerCbQuery();
    const githubLink = await fetchGithubLatest('INCY-DEV/incy-platforms', 'Incy.apk');
    const playLink = 'https://play.google.com/store/apps/details?id=llc.itdev.incy&pcampaignid=web_share';

        ctx.editMessageText('🤖 <b>دانلود Incy (اندروید)</b>\n\nلطفاً منبع دانلود را انتخاب کنید:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.url('📥 دریافت مستقیم (GitHub)', githubLink)],
                    [Markup.button.url('▶️ گوگل پلی (Google Play)', playLink)],
                    [Markup.button.callback('🔙 بازگشت به لیست', 'panel_tut_android')]
                ]
            }
        });
    });

    bot.action('dl_and_happ', async (ctx) => {
        await ctx.answerCbQuery('در حال دریافت لینک...', { show_alert: false });
        // دریافت آخرین فایل با کلیدواژه دقیق
        const githubLink = await fetchGithubLatest('Happ-proxy/happ-android', 'Happ.apk');
        const playLink = 'https://play.google.com/store/apps/details?id=com.happproxy&hl=en';

        ctx.editMessageText('🤖 <b>دانلود Happ Proxy (اندروید)</b>\n\nلطفاً منبع دانلود را انتخاب کنید:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.url('📥 دریافت مستقیم (GitHub)', githubLink)],
                    [Markup.button.url('▶️ گوگل پلی (Google Play)', playLink)],
                    [Markup.button.callback('🔙 بازگشت به لیست', 'panel_tut_android')]
                ]
            }
        });
    });

    // --- ویندوز ---
    bot.action('panel_tut_win', async (ctx) => {
        await ctx.answerCbQuery('در حال دریافت لینک...', { show_alert: false });
        
        // دریافت آخرین فایل با کلیدواژه دقیق
        const v2raynLink = await fetchGithubLatest('2dust/v2rayN', 'windows-64.zip');
        const incyExe = 'https://github.com/INCY-DEV/incy-platforms/releases/download/desktop-v3.2.3/incy-windows-setup.exe';

        ctx.editMessageText('💻 <b>اپلیکیشن‌های ویندوز</b>\n\nبرای دانلود مستقیم آخرین نسخه، روی لینک زیر کلیک کنید:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.url('دانلود v2rayN', v2raynLink)],
                    [Markup.button.url('دانلود Incy', incyExe)],
                    [Markup.button.callback('🔙 بازگشت', 'back_tut_main')]
                ]
            }
        });
    });

    bot.action('back_tut_main', (ctx) => {
        ctx.answerCbQuery();
        ctx.editMessageText('📚 <b>پنل دانلود و آموزش</b>\n\n⚠️ <b>نکته خیلی مهم:</b> برای اینکه کانفیگ‌ها بدون مشکل وصل بشن، حتماً باید آخرین نسخه اپلیکیشن رو نصب داشته باشی.\n\n👇 سیستم‌عامل دستگاهت رو انتخاب کن:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🍎 آیفون (iOS)', 'panel_tut_ios')],
                    [Markup.button.callback('🤖 اندروید (Android)', 'panel_tut_android')],
                    [Markup.button.callback('💻 ویندوز (Windows)', 'panel_tut_win')],
                    [Markup.button.callback('❌ بستن', 'close_menu')]
                ]
            }
        });
    });
    // عملکرد دکمه بستن منوها
    bot.action('close_menu', (ctx) => {
        ctx.answerCbQuery();
        ctx.deleteMessage().catch(() => {});
    });

    bot.on('contact', async (ctx) => {
        userSteps.delete(ctx.from.id);
        const contact = ctx.message.contact;
        if (contact.user_id !== ctx.from.id) return ctx.reply('لطفا فقط شماره خودت رو بفرست.');
        const db = readDb();
        if (db.testUsers.includes(ctx.from.id)) return ctx.reply('❌ شما قبلاً اکانت تست دریافت کرده‌اید.', mainKeyboard);
        db.testUsers.push(ctx.from.id);
        writeDb(db);
        await ctx.telegram.sendMessage(GROUP_ID, `🆕 <b>درخواست تست</b>\n#User_${ctx.from.id}\n👤: ${ctx.from.username ? `@${ctx.from.username}` : 'ندارد'}\n📞: <code>+${contact.phone_number}</code>`, { message_thread_id: parseInt(TOPIC_TEST), parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✅ تایید و صدور تست', `sendtest_${ctx.from.id}`)]]) });
        ctx.reply('✅ درخواست تست شما ثبت شد.\nاین اکانت شامل ۲۰۰ مگابایت حجم و یک‌بار مصرف است. منتظر تایید باش.', mainKeyboard);
    });

    bot.action(/sendtest_(\d+)/, async (ctx) => {
        const userId = ctx.match[1];
        await ctx.answerCbQuery('در حال ساخت...', { show_alert: false });
        
        // پیدا کردن سرور عادیِ فعال از دیتابیس
        const db = readDb();
        const targetServerId = db.settings.activeServerId || 'srv_11528';
        const targetServer = db.servers?.find(s => s.id === targetServerId);

        const email = `Test_${userId}_${Date.now()}`;
        // پاس دادن سرور به تابع ساخت
        const uuid = await createClient(email, 0.2, 1, targetServer || null); 
        if (!uuid) return ctx.reply('❌ خطا در ارتباط با سرور.');

        if (!db.users[userId]) db.users[userId] = [];
        // ذخیره آیدی سرور برای این تست
        db.users[userId].push({ email, uuid, name: 'Test - اکانت تست', serverId: targetServerId });
        writeDb(db);

        await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ ارسال شد');
        await ctx.telegram.sendMessage(userId, `🎁 <b>کانفیگ تست شما آماده است.</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback('🎁 دریافت کانفیگ تست', `get_test_1_${uuid}`)]] } });
    });

    bot.action(/get_test_1_(.+)/, async (ctx) => {
        const uuid = ctx.match[1];
        await ctx.answerCbQuery('✅ در حال ارسال...', { show_alert: false });
        
        const db = readDb();
        const conf = (db.users[ctx.from.id] || []).find(c => c.uuid === uuid);
        const currentConfigName = conf ? conf.name : "Test - CypherNET💎";
        
        const targetServer = db.servers?.find(s => s.id === conf?.serverId);
        const configText = generateMtnConfig(uuid, currentConfigName, targetServer);
        
        const msg = `🟡 <b>کانفیگ شماره ۱:</b>\nبرای کپی کردن، روی کانفیگ ضربه بزنید:\n\n<blockquote expandable><code>${configText}</code></blockquote>\n\n⚠️ <b>نکته:</b> اگر این کانفیگ روی نت شما جواب نداد یا وصل نشد، از دکمه زیر کانفیگ دوم را دریافت کنید.`;
        
        await ctx.reply(msg, { 
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔄 دریافت کانفیگ دوم', `get_test_2_${uuid}`)]
                ]
            }
        });
    });

    bot.action(/get_test_2_(.+)/, async (ctx) => {
        const uuid = ctx.match[1];
        await ctx.answerCbQuery('✅ در حال ارسال...', { show_alert: false });
        
        const db = readDb();
        const conf = (db.users[ctx.from.id] || []).find(c => c.uuid === uuid);
        const currentConfigName = conf ? conf.name : "Test - CypherNET💎";
        
        // استخراج اطلاعات سرور
        const targetServer = db.servers?.find(s => s.id === conf?.serverId);
        const mciText = `<code>${generateMciConfig(uuid, currentConfigName, targetServer)}</code>`;
        
        const msg = `🔵 <b>کانفیگ شماره ۲:</b>\nبرای کپی کردن، روی کانفیگ ضربه بزنید:\n\n${mciText}`;
        
        await ctx.reply(msg, { parse_mode: 'HTML' });
    });

    bot.hears('🛒 خرید مستقیم (بدون شماره)', (ctx) => {
        const db = readDb();
        if (!db.settings.salesOpen) return ctx.reply('🔴 فروش در حال حاضر بسته است. لطفاً بعداً مراجعه کنید.');
        userSteps.set(ctx.from.id, { step: 'RULES', ts: Date.now() });
        ctx.reply("⚠️ <b>قوانین و شرایط:</b>\n\n1. در صورت اختلالات سراسری اینترنت ایران، عودت وجه انجام نخواهد شد.\n\nبا تایید این موارد، بسته‌ها نمایش داده می‌شود.", { parse_mode: 'HTML', ...rulesKeyboard });
    });

    bot.action('back_rules', (ctx) => { ctx.answerCbQuery(); userSteps.set(ctx.from.id, { step: 'RULES', ts: Date.now() }); ctx.editMessageText("⚠️ <b>قوانین و شرایط:</b>\n\n1. در صورت اختلالات سراسری اینترنت ایران، عودت وجه انجام نخواهد شد.\n\nبا تایید این موارد، بسته‌ها نمایش داده می‌شود.", { parse_mode: 'HTML', ...rulesKeyboard }); });
    
    function getDynamicPlansKeyboard(userId) {
        const db = readDb();
        const plans = db.settings.plans || [];
        
        let availablePlans = plans.filter(p => !p.targetUserId || p.targetUserId === userId.toString() || p.targetUserId === '');
        availablePlans = availablePlans.filter(p => p.showInNew !== false);    

        let buttons = availablePlans.map(plan => [Markup.button.callback(plan.btnText, `plan_${plan.id}`)]);
        
        const isVipUser = db.vipUsers && db.vipUsers.includes(userId.toString());
        const hasAnyVipConfig = (db.users[userId] || []).some(c => c.isVip);

        if (isVipUser && !hasAnyVipConfig) {
            buttons.unshift([Markup.button.callback('👑 100 گیگ VIP - یک ماهه (1$)', 'plan_vip')]);
        }
        
        buttons.push([
            Markup.button.callback('🔙 بازگشت', 'back_rules'), 
            Markup.button.callback('❌ لغو', 'cancel_flow')
        ]);
        
        return { reply_markup: { inline_keyboard: buttons } };
    }

    bot.action('accept_rules', (ctx) => { 
        ctx.answerCbQuery(); 
        ctx.editMessageText('یکی از پکیج‌های زیر را انتخاب کنید:', getDynamicPlansKeyboard(ctx.from.id));
    });

    bot.action('back_plans', (ctx) => { 
        ctx.answerCbQuery(); 
        userSteps.set(ctx.from.id, { step: 'PLANS', ts: Date.now() }); 
        ctx.editMessageText('بسته مورد نظرت رو انتخاب کن:', getDynamicPlansKeyboard(ctx.from.id)); 
    });

    bot.action('plan_vip', async (ctx) => {
        ctx.answerCbQuery('⏳ در حال بررسی قیمت دلار...', { show_alert: false });
        
        const db = readDb();
        const userId = ctx.from.id.toString();
        
        if (!db.vipUsers || !db.vipUsers.includes(userId)) {
            return ctx.answerCbQuery('❌ فقط اعضای VIP به این پکیج دسترسی دارند.', { show_alert: true });
        }
        
        let vipPrice = 65000;
        try {
            const usdtRate = await getUsdtRate();
            if (usdtRate && usdtRate > 0) vipPrice = usdtRate;
        } catch (e) {}
        
        const orderId = generateOrderId();
        userSteps.set(ctx.from.id, { 
            step: 'WAITING_NAME', 
            planId: 'vip', 
            planName: '100 گیگ VIP - یک ماهه',
            price: vipPrice.toString(),
            vipPrice: vipPrice,
            orderId, 
            ts: Date.now() 
        });
        
        ctx.editMessageText(
            `👑 <b>پلن VIP</b>\n\n📦 حجم: 100 گیگابایت\n⏰ مدت: 30 روز\n💰 قیمت: <code>${vipPrice.toLocaleString('en-US')}</code> تومان (1$)\n🧾 شماره سفارش: <code>${orderId}</code>\n\nیک اسم دلخواه برای این کانفیگ بنویس:`,
            { 
                parse_mode: 'HTML', 
                reply_markup: { 
                    inline_keyboard: [
                        [Markup.button.callback('رد شدن (بدون اسم)', 'skip_name')], 
                        [Markup.button.callback('❌ لغو', 'cancel_flow')]
                    ] 
                } 
            }
        );
    });

    bot.action(/plan_(.*)/, (ctx) => {
        const planId = ctx.match[1];
        const userId = ctx.from.id.toString();
        if (planId === 'vip') return;
        ctx.answerCbQuery();
        
        const db = readDb();
        const plan = (db.settings.plans || []).find(p => p.id === planId);
        if (!plan) return ctx.answerCbQuery('❌ خطای دریافت پلن!', { show_alert: true });
        
        const orderId = generateOrderId();
        userSteps.set(ctx.from.id, { step: 'WAITING_NAME', planId, planName: plan.name, price: plan.price.toString(), orderId, ts: Date.now() });
        ctx.editMessageText(`📝 شماره سفارش شما: <code>${orderId}</code>\n\nیک اسم دلخواه برای کانفیگت بنویس (مثلاً "گوشی خودم").\n\nاگه نمی‌خوای اسم بذاری، دکمه زیر رو بزن:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback('رد شدن (بدون اسم)', 'skip_name')], [Markup.button.callback('❌ لغو', 'cancel_flow')]] } });
    });

    bot.action('skip_name', (ctx) => { ctx.answerCbQuery(); processConfigName(ctx, 'بدون اسم'); });

    async function processConfigName(ctx, name) {
        const state = userSteps.get(ctx.from.id);
        if (!state) return;

        if (state.planId === 'vip' && !name.toUpperCase().includes('VIP')) {
            name = name + ' (VIP)';
        }

        state.configName = name;
        state.step = 'WAITING_RECEIPT';
        userSteps.set(ctx.from.id, state);
        
        // تبدیل به عدد انگلیسی
        const priceDisplay = parseInt(state.price).toLocaleString('en-US');

        // قیمت درون تگ کد قرار گرفت
        const msg = `💳 <b>مرحله پرداخت</b>\n\n📝 نام سرویس: ${name}\n🧾 شناسه خرید: <code>${state.orderId}</code>\n💰 مبلغ قابل پرداخت: <code>${priceDisplay}</code> تومان\n\nشماره کارت:\n<code>6219861906525570</code>\nبه نام:\nح.احقاقی‌فر\n\n📸 <b>لطفاً پس از واریز، عکس فیش یا رسید پرداختی خود را همینجا ارسال کنید.</b>`;

        const keyboard = { inline_keyboard: [[Markup.button.callback('❌ لغو', 'cancel_flow')]] };

        try {
            if (ctx.callbackQuery) {
                await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard });
            } else {
                await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: keyboard });
            }
        } catch (err) {
            await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: keyboard });
        }
    }

    bot.hears('🛠 پشتیبانی و گزارش خطا', (ctx) => { userSteps.set(ctx.from.id, { step: 'SUPPORT_MENU', ts: Date.now() }); ctx.reply('موضوع پیامت چیه؟', supportMenuKeyboard); });
    bot.action('support_general', (ctx) => { ctx.answerCbQuery('❌ بخش استرداد وجه فعلاً غیرفعال است.', { show_alert: true }); });
    bot.action('support_error', (ctx) => { ctx.answerCbQuery(); userSteps.set(ctx.from.id, { step: 'CHAT_ERROR', msgCount: 0, ticketMsgId: null, ticketBody: '', ts: Date.now() }); ctx.deleteMessage().catch(()=> {}); ctx.reply('وارد چت پشتیبانی شدی. پیامت رو بفرست:', chatKeyboard); });
    bot.hears('❌ خروج از چت پشتیبانی', async (ctx) => { const state = userSteps.get(ctx.from.id); if (state && state.ticketMsgId) { try { await ctx.telegram.editMessageText(GROUP_ID, state.ticketMsgId, null, state.ticketBody + '\n\n🚪 <b>کاربر خودش از چت خارج شد.</b>', { parse_mode: 'HTML' }); } catch(e) {} await sendFeedbackPrompt(ctx, ctx.from.id, state.ticketMsgId); } userSteps.delete(ctx.from.id); ctx.reply('از حالت پشتیبانی خارج شدی. به منوی اصلی برگشتیم:', mainKeyboard); });

    bot.on('photo', async (ctx) => {
        const state = userSteps.get(ctx.from.id);
        if (!state) return;

        if (state.step === 'WAITING_RECEIPT') {
            const payToken = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
            const db = readDb();
            if(!db.payments) db.payments = {};
            db.payments[payToken] = { userId: ctx.from.id, planId: state.planId, configName: state.configName, orderId: state.orderId, type: 'new' };
            writeDb(db);

            const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const caption = `💰 <b>رسید جدید</b>\n#User_${ctx.from.id}\n📦 شماره سفارش: <code>${state.orderId}</code>\n👤 آیدی: ${ctx.from.username ? `@${ctx.from.username}` : 'ندارد'}\n📦 پلن: ${state.planName}\n📝 نام: ${state.configName}\n💵 مبلغ: ${state.price} تومان`;
            await ctx.telegram.sendPhoto(GROUP_ID, photoId, { caption, message_thread_id: parseInt(TOPIC_PAYMENT), parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✅ تایید و صدور کانفیگ', `confnew_${payToken}`)], [Markup.button.callback('❌ رد رسید', `reject_${payToken}`)]]) });
            userSteps.delete(ctx.from.id);
            ctx.reply('رسید شما دریافت شد و در صف بررسی قرار گرفت.', mainKeyboard);
        }
        else if (state.step === 'WAITING_RENEW_RECEIPT') {
            const payToken = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
            const db = readDb();
            if (state.price === 'نامعین') {
                return ctx.reply('⚠️ قیمت دریافت نشد! لطفاً با زدن دکمه لغو، فرآیند را مجدداً شروع کنید.');
            }
            if(!db.payments) db.payments = {};
            db.payments[payToken] = { userId: ctx.from.id, planId: state.planId, email: state.email, orderId: state.orderId, type: 'renew' };
            writeDb(db);

            const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const caption = `🔄 <b>درخواست تمدید اکانت</b>\n#User_${ctx.from.id}\n📦 شماره سفارش: <code>${state.orderId}</code>\n👤 آیدی: ${ctx.from.username ? `@${ctx.from.username}` : 'ندارد'}\n📦 پلن: ${state.planName}\n📧 ایمیل: <code>${state.email}</code>\n💵 مبلغ: ${state.price} تومان`;
            await ctx.telegram.sendPhoto(GROUP_ID, photoId, { caption, message_thread_id: parseInt(TOPIC_PAYMENT), parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✅ تایید و تمدید سرویس', `confrenew_${payToken}`)], [Markup.button.callback('❌ رد رسید', `reject_${payToken}`)]]) });
            userSteps.delete(ctx.from.id);
            ctx.reply('رسید تمدید شما دریافت شد و در صف بررسی قرار گرفت.', mainKeyboard);
        }
        else if (state.step === 'CHAT_ERROR' || state.step === 'CHAT_SUPPORT') {
            if (state.ticketMsgId) await ctx.telegram.sendPhoto(GROUP_ID, ctx.message.photo[ctx.message.photo.length - 1].file_id, { caption: `📸 عکس ارسالی کاربر` + (ctx.message.caption ? `\nمتن: ${ctx.message.caption}` : ''), reply_to_message_id: state.ticketMsgId });
        }
    });

    bot.on('text', async (ctx) => {
        const userId = ctx.from.id.toString();
        const input = ctx.message.text.trim();
        const adminState = adminSteps.get(ctx.from.id);
        const state = userSteps.get(ctx.from.id);
        
        const ignoreTexts = ['🛒 خرید مستقیم (بدون شماره)', '🛠 پشتیبانی و گزارش خطا', '❌ خروج از چت پشتیبانی', '👤 داشبورد من', '📚 آموزش‌ها', '🔄 تمدید سرویس'];
        if (ignoreTexts.includes(ctx.message.text)) return;

        if (state && state.step === 'WAITING_NAME') {
            await processConfigName(ctx, ctx.message.text);
            return;
        }

        

        
        if (isUserAdmin(userId) && adminState && adminState.step) {
            const db = readDb();

            if (adminState.step === 'ADD_ADMIN') {
                if (ADMIN_IDS.includes(input)) {
                    ctx.reply('❌ این کاربر ادمین اصلی است.');
                    adminSteps.delete(ctx.from.id);
                    return;
                }
                if (db.admins && db.admins.some(a => a.id === input)) {
                    ctx.reply('⚠️ این کاربر از قبل ادمین است.');
                    adminSteps.delete(ctx.from.id);
                    return;
                }
                adminSteps.set(ctx.from.id, { step: 'ADD_ADMIN_NAME', targetAdminId: input });
                ctx.reply('📝 حالا یک اسم برای این ادمین بفرست تا تو لیست مشخص باشه (مثلاً: علی پشتیبان):');
                return;
            }

            if (adminState.step === 'ADD_ADMIN_NAME') {
                if (!db.admins) db.admins = [];
                db.admins.push({ id: adminState.targetAdminId, name: input });
                writeDb(db);
                ctx.reply(`✅ ادمین جدید با نام "<b>${input}</b>" و آیدی <code>${adminState.targetAdminId}</code> با موفقیت اضافه شد.`, { parse_mode: 'HTML' });
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'REMOVE_ADMIN') {
                if (ADMIN_IDS.includes(input)) {
                    ctx.reply('❌ این کاربر ادمین اصلی (سوپر ادمین) است و قابل حذف از طریق ربات نیست!');
                } else if (db.admins && db.admins.some(a => a.id === input)) {
                    db.admins = db.admins.filter(a => a.id !== input);
                    writeDb(db);
                    ctx.reply(`✅ دسترسی ادمین از آیدی <code>${input}</code> گرفته شد.`, { parse_mode: 'HTML' });
                } else {
                    ctx.reply('⚠️ این کاربر در لیست ادمین‌های داینامیک ربات وجود ندارد.');
                }
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'ADD_SERVER_FORMAT') {
                try {
                    const lines = input.split('\n');
                    
                    const extract = (key) => {
                        const line = lines.find(l => l.includes(key));
                        if (!line) return '';
                        return line.replace(new RegExp(`^.*?${key}\\s*[:：]`), '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
                    };

                    let extractedUrl = extract('آدرس');
                    // اینجا ربات خودش می‌فهمه که اگه http نذاشتی، برات بذاره
                    if (extractedUrl && !extractedUrl.startsWith('http')) {
                        extractedUrl = 'http://' + extractedUrl;
                    }

                    const newServer = {
                        id: 'srv_' + Math.floor(Math.random() * 900000),
                        name: extract('نام'),
                        panelUrl: extractedUrl,
                        webBasePath: extract('مسیر پنل'),
                        apiToken: extract('توکن'),
                        inboundId: parseInt(extract('اینباند')) || 1,
                        domain: extract('دامنه'),
                        sni: extract('اس‌ان‌آی'),
                        path: extract('مسیر کانفیگ')
                    };

                    ctx.reply(`🔍 در حال تست لاگین...\nآدرس نهایی: [${newServer.panelUrl}]\nمسیر: [${newServer.webBasePath}]`);

                    testServerConnection(newServer.panelUrl, newServer.webBasePath, newServer.apiToken).then(test => {
                        if (!test.success) return ctx.reply(`❌ اتصال برقرار نشد: ${test.msg}`);
                        
                        const freshDb = readDb();
                        if (!freshDb.servers) freshDb.servers = [];
                        freshDb.servers.push(newServer);
                        if (!freshDb.settings.activeServerId) freshDb.settings.activeServerId = newServer.id;
                        writeDb(freshDb);
                        
                        ctx.reply(`✅ سرور ${newServer.name} با موفقیت اضافه شد.`);
                    });
                    
                } catch (e) {
                    ctx.reply('❌ خطا در پردازش فرمت.');
                }
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'REMOVE_SERVER_ID') {
                if (!db.servers) db.servers = [];
                const initialLength = db.servers.length;
                db.servers = db.servers.filter(s => s.id !== input);
                
                // در صورت حذف، چک میکنه اگه دیفالت بوده خالی بشه
                if (db.settings.activeServerId === input) delete db.settings.activeServerId;
                if (db.settings.activeVipServerId === input) delete db.settings.activeVipServerId;
                
                writeDb(db);
                ctx.reply(initialLength > db.servers.length ? '✅ سرور با موفقیت حذف شد.' : '⚠️ سروری با این شناسه پیدا نشد.');
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'REMOVE_PLAN_ID') {
                if (!db.settings.plans) db.settings.plans = [];
                const initialLength = db.settings.plans.length;
                db.settings.plans = db.settings.plans.filter(p => p.id !== input);
                writeDb(db);
                ctx.reply(initialLength > db.settings.plans.length ? '✅ پکیج حذف شد.' : '⚠️ پکیجی با این شناسه پیدا نشد.');
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'ADD_PLAN_FORMAT') {
                try {
                    const lines = input.split('\n');
                    const getValue = (key) => {
                        const line = lines.find(l => l.includes(key));
                        return line ? line.split(/[:：]/)[1]?.trim() : null;
                    };

                    const name = getValue('نام');
                    const gb = parseInt(getValue('حجم'));
                    const days = parseInt(getValue('روز'));
                    const price = parseInt(getValue('قیمت'));
                    const order = parseInt(getValue('ترتیب')) || 99;
                    
                    if (!name || isNaN(gb) || isNaN(days) || isNaN(price)) {
                        return ctx.reply('❌ اطلاعات اصلی (نام، حجم، روز، قیمت) درست نیست. دوباره بفرست.');
                    }

                    let id = getValue('شناسه');
                    if (!id || id.includes('خالی') || id === 'ندارد') {
                        id = 'plan_' + Math.floor(Math.random() * 900000);
                    }

                    const showInNew = getValue('خرید جدید')?.includes('بله') ? true : false;
                    const showInRenew = getValue('تمدید')?.includes('بله') ? true : false;
                    let targetUserId = getValue('کاربر خاص');
                    if (targetUserId === 'ندارد' || !targetUserId) targetUserId = null;

                    // --- منطق هوشمند محاسبه زمان (روز یا ماه) ---
                    let durationText = '';
                    if (days < 30) {
                        durationText = `${days} روزه`;
                    } else {
                        const months = Math.floor(days / 30);
                        durationText = `${months} ماهه`;
                    }
                    // ----------------------------------------------

                    const newPlan = {
                        id, name, gb, days, price, order,
                        showInNew, showInRenew, targetUserId,
                        btnText: `📦 ${name} - ${durationText} (${price.toLocaleString('en-US')} تومان)`
                    };

                    if (!db.settings.plans) db.settings.plans = [];
                    const existingIndex = db.settings.plans.findIndex(p => p.id === id);
                    if (existingIndex > -1) db.settings.plans[existingIndex] = newPlan;
                    else db.settings.plans.push(newPlan);

                    // مرتب‌سازی پکیج‌ها
                    db.settings.plans.sort((a, b) => (a.order || 99) - (b.order || 99));

                    writeDb(db);
                    ctx.reply(`✅ پکیج با موفقیت ثبت شد.\n🔖 شناسه پکیج شما: <code>${id}</code>`, { parse_mode: 'HTML' });
                } catch (e) {
                    ctx.reply('❌ خطا در پردازش. فرمت رو دوباره چک کن.');
                }
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'ADD_VIP_NEW_USER') {
                if (!db.vipUsers) db.vipUsers = [];
                if (!db.vipUsers.includes(input)) {
                    db.vipUsers.push(input);
                    writeDb(db);
                    ctx.reply('✅ کاربر به لیست VIP اضافه شد و پیام خوش‌آمدگویی برایش ارسال شد.');
                    try {
                        ctx.telegram.sendMessage(input, '👑 <b>حساب شما به عنوان عضو VIP فعال شد!</b>\n\nاز این پس می‌توانید پکیج ویژه را در بخش خریدهای ربات مشاهده کنید.', { parse_mode: 'HTML' });
                    } catch (e) {}
                } else {
                    ctx.reply('⚠️ این کاربر از قبل در لیست VIP حضور دارد.');
                }
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'ADD_VIP_USER_ID') {
                adminSteps.set(ctx.from.id, { step: 'ADD_VIP_UUID', targetUserId: input });
                return ctx.reply('🔑 حالا UUID کانفیگ مربوطه را ارسال کنید:');
            }

            if (adminState.step === 'ADD_VIP_UUID') {
                adminSteps.set(ctx.from.id, { ...adminState, uuid: input, step: 'ADD_VIP_EMAIL' });
                return ctx.reply('📧 حالا ایمیل (Email) ثبت شده در پنل را ارسال کنید:');
            }

            if (adminState.step === 'ADD_VIP_EMAIL') {
                const { targetUserId, uuid } = adminState;
                const email = input;

                if (!db.users[targetUserId]) db.users[targetUserId] = [];
                
                const existingConf = db.users[targetUserId].find(c => c.uuid === uuid);
                if (existingConf) {
                    existingConf.isVip = true;
                    existingConf.email = email;
                } else {
                    db.users[targetUserId].push({
                        email: email,
                        uuid: uuid,
                        name: email + ' (VIP)',
                        isVip: true,
                        notified: { days3: false, gb1: false }
                    });
                }
                
                if (!db.vipUsers) db.vipUsers = [];
                if (!db.vipUsers.includes(targetUserId)) db.vipUsers.push(targetUserId);

                writeDb(db);
                adminSteps.delete(ctx.from.id);
                
                try {
                    ctx.telegram.sendMessage(targetUserId, '👑 <b>حساب شما به عنوان عضو VIP فعال شد و سرویس شما به ربات متصل گردید.</b>\n\nاز این پس می‌توانید از طریق بخش "👤 داشبورد من" وضعیت حجم و زمان کانفیگ خود را مدیریت کنید.', { parse_mode: 'HTML' });
                    ctx.reply('✅ اکانت کاربر با موفقیت متصل و وضعیت VIP فعال شد.');
                } catch (e) {
                    ctx.reply('⚠️ اطلاعات ذخیره شد، اما کاربر ربات را مسدود (بلاک) کرده است.');
                }
                return;
            }

            if (adminState.step === 'REMOVE_VIP_USER') {
                if (!db.vipUsers) db.vipUsers = [];
                db.vipUsers = db.vipUsers.filter(id => id !== input);
                
                if (db.users[input]) {
                    db.users[input].forEach(c => c.isVip = false);
                }
                
                writeDb(db);
                ctx.reply('✅ دسترسی VIP کاربر با موفقیت حذف شد.');
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'MANUAL_BUY_USER') {
                adminSteps.set(ctx.from.id, { step: 'MANUAL_BUY_PLAN', targetUserId: input });
                
                const db = readDb();
                const plans = db.settings.plans || [];
                
                // خواندن تمام پکیج‌های دیتابیس و ساخت دکمه
                let buttons = plans.map(p => [Markup.button.callback(`📦 ${p.name}`, `manual_p_${p.id}`)]);
                
                // اضافه کردن دکمه پکیج VIP در انتها
                buttons.push([Markup.button.callback('👑 100 گیگ VIP (1 ماهه)', 'manual_p_vip')]);
                
                return ctx.reply('📦 حالا پلن را انتخاب کنید:', { 
                    reply_markup: { inline_keyboard: buttons } 
                });
            }

            if (adminState.step === 'MANUAL_BUY_ORDER') {
                adminSteps.set(ctx.from.id, { ...adminState, orderId: input, step: 'MANUAL_BUY_NAME' });
                return ctx.reply('📝 نام کانفیگ را ارسال کنید (مثلاً سایفر دستی):');
            }

            if (adminState.step === 'MANUAL_BUY_NAME') {
                const { targetUserId, planId, orderId } = adminState;
                const db = readDb();
                
                let totalGB, expiryDays, isVip = false;
                
                if (planId === 'vip') {
                    totalGB = 100;
                    expiryDays = 30;
                    isVip = true;
                } else {
                    const plan = (db.settings.plans || []).find(p => p.id === planId);
                    if (!plan) return ctx.reply('❌ پلن یافت نشد. لطفاً فرآیند را مجدداً شروع کنید.');
                    totalGB = plan.gb;
                    expiryDays = plan.days;
                }
                
                // تشخیص هوشمند سرور هدف بر اساس نوع پلن انتخابی
                const targetServerId = (isVip && db.settings.activeVipServerId) 
                    ? db.settings.activeVipServerId 
                    : (db.settings.activeServerId || 'srv_11528');
                    
                const targetServer = db.servers?.find(s => s.id === targetServerId);
                const email = `User_${targetUserId}_Ord${orderId}_${Date.now()}`;
                
                // ساخت اکانت با پاس دادن آبجکت سرور صحیح
                const uuid = await createClient(email, totalGB, expiryDays, targetServer || null);
                if (!uuid) return ctx.reply('❌ خطا در ارتباط با پنل سرور.');

                const freshDb = readDb();
                if (!freshDb.users[targetUserId]) freshDb.users[targetUserId] = [];
                
                // افزودن اتوماتیک پرچم کشورِ سرور به انتهای اسم کانفیگ
                let finalName = input;
                const flag = getServerFlag(targetServer?.name);
                if (flag && !finalName.includes(flag)) {
                    finalName = `${finalName} ${flag}`.trim();
                }

                // ثبت مشخصات به همراه سرور اختصاصی و لیبل VIP در صورت نیاز
                freshDb.users[targetUserId].push({ 
                    email, 
                    uuid, 
                    name: finalName, 
                    orderId: orderId,
                    serverId: targetServerId,
                    ...(isVip ? { isVip: true } : {})
                });
                
                // اگر پکیج VIP بود، کاربر را هم به لیست مشتریان ویژه اضافه می‌کنیم
                if (isVip) {
                    if (!freshDb.vipUsers) freshDb.vipUsers = [];
                    if (!freshDb.vipUsers.includes(targetUserId)) freshDb.vipUsers.push(targetUserId);
                }

                writeDb(freshDb);

                try {
                    await ctx.telegram.sendMessage(targetUserId, `✅ <b>سرویس شما با موفقیت فعال شد</b>\n🆔 شماره سفارش: <code>${orderId}</code>\n\n⚠️ <b>نکته:</b> ابتدا کانفیگ ۱ را امتحان کنید در صورت عدم اتصال، کانفیگ 2 را دریافت کنید.`, { 
                    parse_mode: 'HTML', 
                    ...Markup.inlineKeyboard([[Markup.button.callback('🟡 کانفیگ ۱', `getconf_1_${uuid}`), Markup.button.callback('🔵 کانفیگ ۲', `getconf_2_${uuid}`)]]) 
                }); 
                    ctx.reply(`✅ خرید دستی با موفقیت ثبت و برای کاربر ارسال شد.\n🌐 سرور انتخاب شده: ${targetServer?.name || 'پیش‌فرض'}`);
                } catch (e) {
                    ctx.reply(`⚠️ ثبت شد اما کاربر ربات را بلاک کرده است.\n🌐 سرور انتخاب شده: ${targetServer?.name || 'پیش‌فرض'}`);
                }
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'BAN_USER') {
                if (!db.bannedUsers) db.bannedUsers = [];
                if (!db.bannedUsers.includes(input)) { db.bannedUsers.push(input); writeDb(db); ctx.reply(`🚫 کاربر ${input} با موفقیت مسدود شد.`); } 
                else ctx.reply('این کاربر از قبل مسدود است.');
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'SEARCH_USER_ID') {
                const targetId = input;
                const db = readDb();
                
                const isVip = (db.vipUsers || []).includes(targetId) ? 'بله 👑' : 'خیر 👤';
                const isBanned = (db.bannedUsers || []).includes(targetId) ? 'بله 🚫' : 'خیر ✅';
                const hasTest = (db.testUsers || []).includes(Number(targetId)) ? 'بله 🎁' : 'خیر';
                
                const stats = (db.userStats && db.userStats[targetId]) || { totalSpent: 0, buyCount: 0, renewCount: 0 };
                const configs = db.users[targetId] || [];

                // --- دریافت نام و یوزرنیم از سرور تلگرام ---
                let nameDisplay = 'نامشخص';
                let usernameDisplay = 'ندارد';
                try {
                    const chatInfo = await ctx.telegram.getChat(targetId);
                    nameDisplay = chatInfo.first_name || 'بدون نام';
                    if (chatInfo.last_name) nameDisplay += ` ${chatInfo.last_name}`;
                    // جلوگیری از بهم‌ریختگی تگ‌های HTML
                    nameDisplay = nameDisplay.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    usernameDisplay = chatInfo.username ? `@${chatInfo.username}` : 'ندارد';
                } catch (e) {
                    nameDisplay = 'نامشخص (ربات دسترسی ندارد)';
                }
                // ------------------------------------------

                let text = `🔍 <b>پرونده کاربر:</b> <code>${targetId}</code>\n`;
                text += `👤 <b>نام تلگرام:</b> ${nameDisplay}\n`;
                text += `🆔 <b>یوزرنیم:</b> ${usernameDisplay}\n\n`;
                text += `👑 وضعیت VIP: <b>${isVip}</b>\n`;
                text += `🚫 مسدود: <b>${isBanned}</b>\n`;
                text += `🎁 دریافت تست: <b>${hasTest}</b>\n`;
                text += `💰 مجموع پرداختی: <b>${stats.totalSpent.toLocaleString('fa-IR')} تومان</b>\n`;
                text += `🛍 تعداد خرید جدید: <b>${stats.buyCount}</b>\n`;
                text += `🔄 تعداد تمدید: <b>${stats.renewCount}</b>\n\n`;

                text += `📋 <b>لیست کانفیگ‌ها:</b>\n`;
                if (configs.length === 0) {
                    text += `هیچ کانفیگی ثبت نشده است.\n`;
                } else {
                    configs.forEach(c => {
                        const srv = (db.servers || []).find(s => s.id === c.serverId);
                        const srvName = srv ? srv.name : 'نامشخص';
                        text += `🔹 ${c.name} (سرور: ${srvName})\n`;
                    });
                }

                ctx.reply(text, { parse_mode: 'HTML' });
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'UNBAN_USER') {
                if (!db.bannedUsers) db.bannedUsers = [];
                db.bannedUsers = db.bannedUsers.filter(id => id !== input);
                writeDb(db);
                ctx.reply(`✅ مسدودسازی کاربر ${input} لغو شد.`);
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'CLEAR_TEST') {
                db.testUsers = db.testUsers.filter(id => id.toString() !== input);
                writeDb(db);
                ctx.reply(`🧹 سابقه تست کاربر ${input} پاک شد.`);
                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'RESET_USER') {
                // پاک کردن تمام کانفیگ‌های ثبت شده
                if (db.users[input]) delete db.users[input];
                
                // پاک کردن از لیست سابقه تست
                if (db.testUsers) db.testUsers = db.testUsers.filter(id => id.toString() !== input);
                
                // پاک کردن از لیست VIP
                if (db.vipUsers) db.vipUsers = db.vipUsers.filter(id => id.toString() !== input);
                
                writeDb(db);
                ctx.reply(`🗑 تمام اطلاعات کاربر ${input} (شامل کانفیگ‌ها، وضعیت VIP، سابقه تست و مسدودی) از دیتابیس ربات پاک شد.`);
                adminSteps.delete(ctx.from.id);
                return;
            }
        }

        if (ctx.chat.id.toString() === GROUP_ID) {
            if (adminState && adminState.userId) {
                try {
                    const safeAdminText = ctx.message.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    await ctx.telegram.sendMessage(adminState.userId, `👨‍💻 <b>پاسخ پشتیبانی:</b>\n\n${safeAdminText}`, { parse_mode: 'HTML' });
                    const newBody = adminState.ticketBody + `\n\n👨‍💻 <b>شما:</b>\n<blockquote>${safeAdminText}</blockquote>`;
                    await ctx.telegram.editMessageText(GROUP_ID, adminState.ticketMsgId, null, newBody, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('💬 ارسال پاسخ', `reply_${adminState.userId}_${adminState.ticketMsgId}`)], [Markup.button.callback('🔒 بستن چت', `close_${adminState.userId}_${adminState.ticketMsgId}`)]]) });
                    ctx.reply('✅ پاسخت برای کاربر ارسال شد.');
                } catch (err) {}
                adminSteps.delete(ctx.from.id);
            }
            return; 
        }

    

        if (state && (state.step === 'CHAT_ERROR' || state.step === 'CHAT_SUPPORT')) {
            if (state.msgCount >= 5) return ctx.reply('⚠️ شما سقف مجاز پیام را پر کرده‌اید.');
            state.msgCount++;
            state.ts = Date.now();
            const safeUserText = ctx.message.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
            const firstName = ctx.from.first_name ? ctx.from.first_name.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'بدون نام';
            const username = ctx.from.username ? `@${ctx.from.username}` : 'ندارد';

            if (!state.ticketMsgId) {
                state.ticketBody = `<b>🎫 تیکت جدید</b>\n#User_${ctx.from.id}\n👤 نام: ${firstName}\n🆔 آیدی: ${username}\n\n🗣 <b>متن پیام:</b>\n${safeUserText}`;
                const msg = await ctx.telegram.sendMessage(GROUP_ID, state.ticketBody, { message_thread_id: parseInt(state.step === 'CHAT_ERROR' ? TOPIC_ERROR : TOPIC_SUPPORT), parse_mode: 'HTML' });
                state.ticketMsgId = msg.message_id;
                await ctx.telegram.editMessageReplyMarkup(GROUP_ID, state.ticketMsgId, null, { inline_keyboard: [[Markup.button.callback('💬 ارسال پاسخ', `reply_${ctx.from.id}_${state.ticketMsgId}`)], [Markup.button.callback('🔒 بستن چت', `close_${ctx.from.id}_${state.ticketMsgId}`)]] });
            } else {
                state.ticketBody += `\n\n🗣 <b>متن پیام:</b>\n${safeUserText}`;
                await ctx.telegram.editMessageText(GROUP_ID, state.ticketMsgId, null, state.ticketBody, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('💬 ارسال پاسخ', `reply_${ctx.from.id}_${state.ticketMsgId}`)], [Markup.button.callback('🔒 بستن چت', `close_${ctx.from.id}_${state.ticketMsgId}`)]]) });
            }
            try {
                    await ctx.telegram.sendMessage(GROUP_ID, `🔔 <b>پیام جدید</b> از کاربر دریافت و به متن تیکت اضافه شد.`, { 
                        reply_to_message_id: state.ticketMsgId, 
                        parse_mode: 'HTML' 
                    });
                } catch(e) {}
            
            userSteps.set(ctx.from.id, state);
            ctx.reply('پیامت به تیکت اضافه شد.');
            return;
        }

        if (ctx.chat.type === 'private' && !isUserAdmin(userId)) {
            ctx.reply('لطفاً یک گزینه از منو انتخاب کن.');
        }
    });
    
    bot.action(/reply_(\d+)_(\d+)/, async (ctx) => { adminSteps.set(ctx.from.id, { userId: ctx.match[1], ticketMsgId: ctx.match[2], ticketBody: ctx.callbackQuery.message.text }); ctx.reply(`✍️ متنت رو بنویس:`); ctx.answerCbQuery(); });
    bot.action(/close_(\d+)_(\d+)/, async (ctx) => { userSteps.delete(Number(ctx.match[1])); await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n🔒 <b>چت بسته شد.</b>', { parse_mode: 'HTML' }); await sendFeedbackPrompt(ctx, ctx.match[1], ctx.match[2]); ctx.answerCbQuery(); });
    bot.action(/feedback_(yes|no)_(\d+)/, async (ctx) => { await ctx.editMessageText(`ممنون از بازخوردت 🌻.`); ctx.telegram.sendMessage(GROUP_ID, `📊 بازخورد: ${ctx.match[1] === 'yes' ? '✅ حل شد' : '❌ حل نشد'}`, { reply_to_message_id: parseInt(ctx.match[2]) }); });

    bot.action(/confnew_(.+)/, async (ctx) => {
        const payToken = ctx.match[1];
        const db = readDb();
        const payData = db.payments?.[payToken];
        
        if (!payData) return ctx.answerCbQuery('❌ اطلاعات تراکنش یافت نشد.', {show_alert: true});
        const { userId, planId, configName, orderId } = payData;
        const caption = ctx.callbackQuery.message.caption || '';
        
        await ctx.answerCbQuery('در حال ساخت...', { show_alert: false });

        let totalGB, expiryDays;
        if (planId === 'vip') { 
            totalGB = 100; 
            expiryDays = 30; 
        } else {
            const plan = (db.settings.plans || []).find(p => p.id === planId);
            if (!plan) return ctx.reply('❌ پلن در دیتابیس یافت نشد.');
            totalGB = plan.gb;
            expiryDays = plan.days;
        }

        const email = `User_${userId}_Ord${orderId}_${Date.now()}`;

        const targetServerId = (planId === 'vip' && db.settings.activeVipServerId)
            ? db.settings.activeVipServerId 
            : (db.settings.activeServerId || 'srv_11528');
            
        const targetServer = db.servers?.find(s => s.id === targetServerId);

        // --- فیچر جدید: نام‌گذاری هوشمند و افزودن پرچم ---
        let finalName = configName;
        if (finalName === 'بدون اسم' || !finalName) {
            const userConfigs = db.users[userId] || [];
            const cypherCount = userConfigs.filter(c => c.name && c.name.startsWith('سایفر')).length;
            finalName = `سایفر ${cypherCount + 1}`;
        }
        const flag = getServerFlag(targetServer?.name);
        finalName = `${finalName} ${flag}`.trim();
        // -----------------------------------------------

        // ساخت کانفیگ در سرور
        const uuid = await createClient(email, totalGB, expiryDays, targetServer || null);
        
        if (!uuid) return ctx.reply('❌ خطا در ساخت کانفیگ در پنل.');

        if (!db.users[userId]) db.users[userId] = [];
        db.users[userId].push({ 
            email, 
            uuid, 
            name: finalName, // ذخیره با اسم و پرچم جدید
            orderId: orderId,
            serverId: targetServerId,
            ...(planId === 'vip' ? { isVip: true } : {})
        });

        const priceMatch = caption.match(/💵 مبلغ: ([\d,]+) تومان/);
        if (priceMatch) { db.totalIncome = (db.totalIncome || 0) + parseInt(priceMatch[1].replace(/,/g, ''), 10); db.successfulSales = (db.successfulSales || 0) + 1; }
        if (!db.userStats) db.userStats = {};
        if (!db.userStats[userId]) db.userStats[userId] = { totalSpent: 0, buyCount: 0, renewCount: 0 };
        const priceVal = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0;
        db.userStats[userId].totalSpent += priceVal;
        db.userStats[userId].buyCount++;
        const pIndex = (db.settings.plans || []).findIndex(p => p.id === planId);
        if (pIndex > -1) {
            if (db.settings.plans[pIndex].sold === undefined) db.settings.plans[pIndex].sold = 0;
            db.settings.plans[pIndex].sold++;
        }

        delete db.payments[payToken];
        writeDb(db);

        await ctx.editMessageCaption(caption + '\n\n✅ <b>وضعیت: تایید شد</b>', { parse_mode: 'HTML' });
        await ctx.telegram.sendMessage(userId, `✅ <b>سرویس شما با موفقیت فعال شد</b>\n🆔 شماره سفارش: <code>${orderId}</code>\n\n⚠️ <b>نکته:</b> ابتدا کانفیگ ۱ را امتحان کنید در صورت عدم اتصال از کانفیگ ۲ استفاده کنید.`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🟡 کانفیگ ۱', `getconf_1_${uuid}`), Markup.button.callback('🔵 کانفیگ ۲', `getconf_2_${uuid}`)]]) }); 
    });

    bot.action(/confrenew_(.+)/, async (ctx) => {
        const payToken = ctx.match[1];
        const db = readDb();
        const payData = db.payments?.[payToken];
        
        if (!payData) return ctx.answerCbQuery('❌ اطلاعات تراکنش یافت نشد.', {show_alert: true});
        
        const { userId, email, planId, orderId } = payData;
        const caption = ctx.callbackQuery.message.caption || '';
        
        await ctx.answerCbQuery('در حال تمدید...', { show_alert: false });

        let totalGB, expiryDays;
        if (planId === 'vip') { 
            totalGB = 100; 
            expiryDays = 30; 
        } else {
            const plan = (db.settings.plans || []).find(p => p.id === planId);
            if (!plan) return ctx.reply('❌ پلن در دیتابیس یافت نشد.');
            totalGB = plan.gb;
            expiryDays = plan.days;
        }

        const userConfigs = db.users[userId] || [];
        const conf = userConfigs.find(c => c.email === email);
        if (!conf) return ctx.reply('❌ اکانت در دیتابیس یافت نشد.');

        // --- تشخیص هوشمند سرور فعلی (جلوگیری از باگ VIPهای قدیمی) ---
        let currentServerId = conf.serverId;
        if (!currentServerId) {
            currentServerId = (conf.isVip && db.settings.activeVipServerId) 
                ? db.settings.activeVipServerId 
                : (db.settings.activeServerId || 'srv_11528');
        }

        // --- تشخیص سرور هدف (مقصد) ---
       const oldServer = db.servers?.find(s => s.id === currentServerId);
        
        
        // حالت عادی: کاربر روی همون سرور خودش تمدید میشه
        let targetServerId = currentServerId; 
        
        // حالت تخلیه: اگر سرور کاربر تو وضعیت تخلیه بود، اونوقت کوچش میدیم به سرور اکتیو
        if (oldServer && oldServer.isMigrating) {
            targetServerId = (conf.isVip && db.settings.activeVipServerId)
                ? db.settings.activeVipServerId 
                : (db.settings.activeServerId || currentServerId);
        }

        const targetServer = db.servers?.find(s => s.id === targetServerId);

        const oldEmail = conf.email;
        const newEmail = `User_${userId}_Ord${orderId}_${Date.now()}`;

        // --- عملیات کوچ هوشمند دوطرفه با انتقال کامل حجم و زمان ---
        // --- محاسبه حجم و زمان باقیمانده برای همه تمدیدها (همون سرور یا کوچ) ---
        let remainGB = 0;
        let remainDays = 0;
        
        if (oldServer) {
            const traffic = await getClientTraffic(oldEmail, oldServer);
            if (traffic) {
                const totalOldGB = traffic.total / 1073741824;
                const usedOldGB = (traffic.up + traffic.down) / 1073741824;
                
                if (traffic.total > 0 && totalOldGB > usedOldGB) {
                    remainGB = totalOldGB - usedOldGB;
                }
                
                if (traffic.expiryTime > 0) {
                    const diffMs = traffic.expiryTime - Date.now();
                    if (diffMs > 0) {
                        remainDays = diffMs / (1000 * 60 * 60 * 24);
                    }
                }
            }
        }

            // ۳. جمع زدن حجم و زمان قبلی با جدید
            const finalGB = planId === 'vip' ? 100 : totalGB + remainGB;

            let finalDays;
            if (planId === 'vip') {
                // قانون هدیه تمدید به‌موقع برای اعضای VIP
                if (remainDays > 0 && remainDays <= 3) {
                    finalDays = 32; // ۳۰ روز اصلی + ۲ روز هدیه
                } else {
                    finalDays = 30; // تمدید استاندارد در سایر مواقع
                }
            } else {
                // قانون کاربران عادی: تجمیع زمان جدید با باقی‌مانده سرویس قبلی
                finalDays = expiryDays + Math.ceil(remainDays);
            }

            // ۴. ساخت اکانت تو سرور مقصد
            if (currentServerId !== targetServerId) {
            // ۱. حذف از سرور مبدأ
            if (oldServer) await deleteClient(oldEmail, oldServer); 
            
            // ۲. ساخت در سرور مقصد با حجم و زمان تجمیع‌شده
            const newUuid = await createClient(newEmail, finalGB, finalDays, targetServer || null);
            if (!newUuid) return ctx.reply('❌ خطا در کوچ کانفیگ به سرور جدید.');
            conf.uuid = newUuid; 
        } else {
            // تمدید عادی روی همون سرور قبلی اما با حجم و زمان تجمیع‌شده (finalGB و finalDays)
            const result = await renewClient(conf.uuid, oldEmail, newEmail, finalGB, finalDays, targetServer || null);
            if (!result.success) return ctx.reply(`❌ <b>خطا در تمدید:</b>\n<code>${result.log}</code>`, { parse_mode: 'HTML' });
        }
        // -------------------------------------------------------------

        conf.email = newEmail;
        conf.orderId = orderId; 
        conf.serverId = targetServerId; 
        
        // --- به‌روزرسانی اسم و پرچم ---
        if (conf.name.includes('تست') || conf.name === 'سرویس قبلی' || conf.name === 'بدون اسم') {
            const cypherCount = userConfigs.filter(c => c.name && c.name.startsWith('سایفر')).length;
            conf.name = `سایفر ${cypherCount + 1}`;
        }
        const flag = getServerFlag(targetServer?.name);
        if (!conf.name.includes(flag)) {
            const oldFlags = ['🇳🇱', '🇩🇪', '🇮🇹', '🇫🇷', '🇬🇧', '🇹🇷', '🌍', '🇫🇮'];
            oldFlags.forEach(f => { conf.name = conf.name.replace(f, '').trim(); });
            conf.name = `${conf.name} ${flag}`.trim();
        }
        // -----------------------------

        const priceMatch = caption.match(/💵 مبلغ: ([\d,]+) تومان/);
        if (priceMatch) { db.totalIncome = (db.totalIncome || 0) + parseInt(priceMatch[1].replace(/,/g, ''), 10); db.successfulSales = (db.successfulSales || 0) + 1; }
        if (!db.userStats) db.userStats = {};
        if (!db.userStats[userId]) db.userStats[userId] = { totalSpent: 0, buyCount: 0, renewCount: 0 };
        const priceVal = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0;
        db.userStats[userId].totalSpent += priceVal;
        db.userStats[userId].renewCount++;

        conf.notified = { days3: false, gb85: false };
        delete db.payments[payToken];
        writeDb(db);

        await ctx.editMessageCaption(caption + '\n\n✅ <b>وضعیت: تمدید شد</b>', { parse_mode: 'HTML' });
        await ctx.telegram.sendMessage(userId, `✅ <b>سرویس شما با موفقیت تمدید شد.</b>\n🧾 شناسه خرید: <code>${orderId}</code> (تاییدشده)\n\n⚠️ <b>نکته:</b> ابتدا کانفیگ ۱ را امتحان کنید. در صورت عدم اتصال، از کانفیگ ۲ استفاده کنید.`, { 
    parse_mode: 'HTML', 
    ...Markup.inlineKeyboard([
        [Markup.button.callback('🟡 کانفیگ ۱', `getconf_1_${conf.uuid}`), Markup.button.callback('🔵 کانفیگ ۲', `getconf_2_${conf.uuid}`)]
    ]) 
});
    });

    bot.action(/getconf_(1|2)_(.+)/, async (ctx) => {
    const opId = ctx.match[1];
    const uuid = ctx.match[2];
    await ctx.answerCbQuery('✅ در حال ارسال...', { show_alert: false });
    
    const db = readDb();
    const userConfigs = db.users[ctx.from.id] || [];
    const conf = userConfigs.find(c => c.uuid === uuid);
    const currentConfigName = conf ? conf.name : "CypherNET💎";
    
    // دریافت اطلاعات سرور اختصاصی همین کانفیگ
    const targetServer = db.servers?.find(s => s.id === conf?.serverId);
    
    if (opId === '1') {
        const configText = generateMtnConfig(uuid, currentConfigName, targetServer);
        const msg = `🟡 <b>کانفیگ شماره ۱:</b>\nجهت کپی کردن، روی کانفیگ زیر ضربه بزنید:\n\n<blockquote expandable><code>${configText}</code></blockquote>\n\n⚠️ <b>نکته:</b> اگر این کانفیگ روی نت شما متصل نشد، از دکمه زیر کانفیگ دوم را دریافت کنید.`;
        await ctx.reply(msg, { 
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔄 دریافت کانفیگ ۲', `getconf_2_${uuid}`)]
                ]
            }
        });
    
    } else if (opId === '2') {
        const configText = generateMciConfig(uuid, currentConfigName, targetServer);
        const msg = `🔵 <b>کانفیگ شماره ۲:</b>\nجهت کپی کردن، روی کانفیگ زیر ضربه بزنید:\n\n<blockquote expandable><code>${configText}</code></blockquote>`;
        await ctx.reply(msg, { parse_mode: 'HTML' });
    }
});

// --- سیستم همگام‌ساز خودکار پنل و ربات (هر ۱ ساعت) ---
    setInterval(async () => {
        try {
            const db = readDb();
            let dbChanged = false;

            for (const userId in db.users) {
                if (!Array.isArray(db.users[userId])) continue;

                for (let i = 0; i < db.users[userId].length; i++) {
                    let conf = db.users[userId][i];
                    
                    if (conf.name === 'سرویس قبلی' || conf.email.startsWith('Test_')) continue;

                    const targetServer = db.servers?.find(s => s.id === conf.serverId);
                    if (!targetServer) continue; 

                    const traffic = await getClientTraffic(conf.email, targetServer);
                    if (!traffic) continue; 

                    const currentTotal = traffic.total;
                    const currentUsed = traffic.up + traffic.down;
                    const currentExpiry = traffic.expiryTime;

                    // بررسی اینکه آیا ربات خودش این کانفیگ را به تازگی تمدید کرده است؟
                    // اگر ایمیل تغییر کرده باشد، یعنی تمدید توسط ربات بوده، پس فقط آمار را بی‌صدا آپدیت کن
                    if (!conf.panelStats || conf.panelStats.email !== conf.email) {
                        conf.panelStats = { total: currentTotal, used: currentUsed, expiry: currentExpiry, email: conf.email };
                        dbChanged = true;
                        continue; 
                    }

                    let changes = [];

                    if (currentExpiry > conf.panelStats.expiry) {
                        changes.push(`⏱ زمان سرویس شما بروزرسانی شد.`);
                    }

                    // (یک مگابایت بافر برای جلوگیری از خطای محاسباتی پنل)
                    if (currentTotal > conf.panelStats.total || currentUsed < (conf.panelStats.used - 1048576)) { 
                        changes.push(`🔋 حجم سرویس شما بروزرسانی شد.`);
                    }

                    // در صورتی که تغییرات توسط ادمین در پنل اعمال شده باشد
                    if (changes.length > 0) {
                        conf.panelStats = { total: currentTotal, used: currentUsed, expiry: currentExpiry, email: conf.email };
                        conf.notified = { days3: false, gb85: false };
                        dbChanged = true;

                        const message = `🔔 <b>بروزرسانی سرویس</b>\n\nتغییرات زیر روی کانفیگ شما (<b>${conf.name}</b>) اعمال گردید:\n\n` + 
                                      changes.map(c => `▪️ ${c}`).join('\n') +
                                      `\n\nبرای مشاهده جزئیات تغییرات می‌توانید از بخش داشبورد من اقدام کنید.`;

                        bot.telegram.sendMessage(userId, message, { 
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [Markup.button.callback('📊 مشاهده جزئیات کانفیگ', `dash_detail_${conf.uuid}`)]
                                ]
                            }
                        }).catch(() => {}); 
                    }
                    
                    await new Promise(r => setTimeout(r, 50));
                }
            }
            if (dbChanged) writeDb(db);
        } catch (error) {
            console.error("خطا در همگام‌ساز ۱ ساعته پنل:", error.message);
        }
    }, 60 * 60 * 1000);

// --- سیستم پاکسازی خودکار اکانت‌های منقضی شده (هر ۳ ساعت) ---
    setInterval(async () => {
        try {
            const db = readDb();
            let dbChanged = false;
            const now = Date.now();

            for (const userId in db.users) {
                if (!Array.isArray(db.users[userId])) continue;

                for (let conf of db.users[userId]) {
                    // اگر قبلا از پنل پاک شده، نیازی به بررسی مجدد نیست
                    if (conf.deletedFromPanel) continue;

                    const isTestAccount = conf.email?.startsWith('Test_') || conf.planId === 'test' || conf.name?.includes('تست');
                    const targetServer = db.servers?.find(s => s.id === conf.serverId);
                    if (!targetServer) continue;

                    // دریافت ترافیک از سرور برای دسترسی به expiryTime
                    const traffic = await getClientTraffic(conf.email, targetServer);
                    
                    if (!traffic) {
                        conf.deletedFromPanel = true;
                        dbChanged = true;
                        continue;
                    }

                    if (traffic.expiryTime > 0) {
                        const diffMs = now - traffic.expiryTime;

                        // بررسی اکانت‌های تست (بیش از ۲ روز)
                        if (isTestAccount && diffMs > (2 * 24 * 60 * 60 * 1000)) {
                            await deleteClient(conf.email, targetServer).catch(()=>{});
                            conf.deletedFromPanel = true;
                            dbChanged = true;
                        } 
                        // بررسی اکانت‌های عادی و VIP (بیش از ۱۴ روز)
                        else if (!isTestAccount && diffMs > (14 * 24 * 60 * 60 * 1000)) {
                            await deleteClient(conf.email, targetServer).catch(()=>{});
                            conf.deletedFromPanel = true;
                            dbChanged = true;
                        }
                    }
                }
            }
            if (dbChanged) writeDb(db);
        } catch (error) {
            console.error("خطا در سیستم پاکسازی خودکار:", error.message);
        }
    }, 3 * 60 * 60 * 1000);

setInterval(async () => {
        try {
            const db = readDb();
            let dbChanged = false;
            const now = Date.now();

            for (const [uid, state] of userSteps.entries()) {
                if (now - (state.ts || now) > 3600000) userSteps.delete(uid); 
            }

            for (const userId in db.users) {
                if (!Array.isArray(db.users[userId])) continue;
                
                let updatedConfigs = [];
                for (const conf of db.users[userId]) {
                    if (conf.name === 'سرویس قبلی' || conf.email.startsWith('Test_')) {
                        updatedConfigs.push(conf);
                        continue;
                    }
                    
                    // تنظیمات اولیه هشدارها با اضافه شدن gb1
                    if (!conf.notified) { 
                        conf.notified = { days3: false, gb85: false, gb1: false }; 
                        dbChanged = true; 
                    } else {
                        if (conf.notified.gb85 === undefined) { conf.notified.gb85 = false; dbChanged = true; }
                        if (conf.notified.gb1 === undefined) { conf.notified.gb1 = false; dbChanged = true; }
                        if (conf.notified.days3 === undefined) { conf.notified.days3 = false; dbChanged = true; }
                    }

                    const targetServer = db.servers?.find(s => s.id === conf.serverId);
                    const traffic = await getClientTraffic(conf.email, targetServer);
                    if (!traffic) {
                        updatedConfigs.push(conf);
                        continue;
                    }

                    // حذف اکانت‌های منقضی شده بالای ۳۰ روز از دیتابیس
                    if (traffic.expiryTime > 0) {
                        const diffDays = (now - traffic.expiryTime) / (1000 * 60 * 60 * 24);
                        const isTestAccount = traffic.email?.startsWith('Test_') || traffic.planId === 'test' || traffic.name?.includes('تست');

                        if (diffDays > 30 && !isTestAccount) {
                            if (db.vipUsers && db.vipUsers.includes(String(userId))) {
                                db.vipUsers = db.vipUsers.filter(id => String(id) !== String(userId));
                            }
                            dbChanged = true;
                            continue; 
                        }
                    }

                    updatedConfigs.push(conf);

                    const totalGB = traffic.total / 1073741824;
                    const usedGB = (traffic.up + traffic.down) / 1073741824;
                    const remainGB = traffic.total === 0 ? 999 : (totalGB - usedGB);
                    let remainDays = 999;
                    
                    if (traffic.expiryTime > 0) {
                        const diffMs = traffic.expiryTime - now;
                        remainDays = diffMs > 0 ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : 0;
                    }

                    // ۱. هشدار زمان (۳ روز مانده)
                    if (remainDays <= 3 && remainDays > 0 && !conf.notified.days3) {
                        conf.notified.days3 = true;
                        dbChanged = true;
                        await bot.telegram.sendMessage(userId, `⚠️ <b>هشدار پایان سرویس</b>\n\n⏳ فقط <b>${remainDays} روز</b> از اعتبار سرویس شما (<b>${conf.name}</b>) باقی مانده است.`, {
                            parse_mode: 'HTML',
                            ...Markup.inlineKeyboard([[Markup.button.callback('🔄 تمدید آنلاین', `init_renew_${conf.email}`)], [Markup.button.callback('❌ لغو', 'close_menu')]])
                        });
                    }

                    // ۲. هشدار مصرف ۸۵ درصد (به شرطی که بیشتر از ۱ گیگ مانده باشد تا تداخل نکند)
                    if (traffic.total > 0 && (usedGB / totalGB) >= 0.85 && remainGB > 1 && !conf.notified.gb85) {
                        conf.notified.gb85 = true;
                        dbChanged = true;
                        await bot.telegram.sendMessage(userId, `⚠️ <b>هشدار مصرف حجم</b>\n\n📉 <b>۸۵٪</b> از حجم سرویس شما (<b>${conf.name}</b>) مصرف شده است و تنها <b>${remainGB.toFixed(2)} گیگابایت</b> باقی مانده است.`, {
                            parse_mode: 'HTML',
                            ...Markup.inlineKeyboard([[Markup.button.callback('🔄 تمدید آنلاین', `init_renew_${conf.email}`)], [Markup.button.callback('❌ لغو', 'close_menu')]])
                        });
                    }

                    // ۳. هشدار کمتر از ۱ گیگابایت
                    if (traffic.total > 0 && remainGB <= 1 && remainGB > 0 && !conf.notified.gb1) {
                        conf.notified.gb1 = true;
                        dbChanged = true;
                        await bot.telegram.sendMessage(userId, `⚠️ <b>هشدار اتمام حجم</b>\n\n📉 کمتر از <b>۱ گیگابایت</b> (${remainGB.toFixed(2)} GB) از حجم سرویس شما (<b>${conf.name}</b>) باقی مانده است. لطفاً برای جلوگیری از قطعی اقدام کنید.`, {
                            parse_mode: 'HTML',
                            ...Markup.inlineKeyboard([[Markup.button.callback('🔄 تمدید آنلاین', `init_renew_${conf.email}`)], [Markup.button.callback('❌ لغو', 'close_menu')]])
                        });
                    }

                    await new Promise(r => setTimeout(r, 50));
                }
                
                if (db.users[userId].length !== updatedConfigs.length) {
                    db.users[userId] = updatedConfigs;
                    dbChanged = true;
                }
            }
            if (dbChanged) writeDb(db);
        } catch (e) {}
    }, 60 * 60 * 1000);
}


module.exports = setupHandlers;