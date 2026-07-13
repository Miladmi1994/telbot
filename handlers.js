const { Markup } = require('telegraf');
const { GROUP_ID, TOPIC_TEST, TOPIC_PAYMENT, TOPIC_ERROR, TOPIC_SUPPORT, ADMIN_IDS, userSteps, adminSteps } = require('./config');
const { mainKeyboard, chatKeyboard, rulesKeyboard, getPlansKeyboard, receiptKeyboard, supportMenuKeyboard, getAdminKeyboard, adminVipMenu, adminUsersMenu, adminFinanceMenu, adminServersMenu, adminMarketingMenu } = require('./keyboards');
const { readDb, writeDb } = require('./db');
const { createClient, deleteClient, renewClient, getClientTraffic, generateMciConfig, generateMtnConfig, getUsdtRate, testServerConnection, getCloudflareZones, getDnsRecords, updateDnsRecord } = require('./api');

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
        
        if (data && data.assets) {
            const asset = data.assets.find(a => a.name.toLowerCase().includes(keyword.toLowerCase()));
            if (asset) {
                fetchCache[cacheKey] = { url: asset.browser_download_url, time: now };
                return asset.browser_download_url;
            }
        }
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
    return '🌍'; 
}

function isUserAdmin(userId) {
    if (!userId) return false;
    const db = readDb();
    return ADMIN_IDS.includes(userId.toString()) || (db.admins && db.admins.some(a => a.id === userId.toString()));
}

async function checkMembership(ctx, userId) {
    try {
        const member = await ctx.telegram.getChatMember('@cyphernett', userId);
        return ['member', 'creator', 'administrator'].includes(member.status);
    } catch (e) {
        return false;
    }
}

// تابع فوروارد پیام کاربر به ادمین در تاپیک پشتیبانی
// تابع فوروارد پیام کاربر به ادمین در تاپیک پشتیبانی
async function forwardToAdmin(ctx, state) {
    state.lastUserMsgId = ctx.message.message_id;
    const userId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : 'ندارد';
    const topicId = parseInt(state.step === 'CHAT_ERROR' ? TOPIC_ERROR : TOPIC_SUPPORT);
    
    
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🔒 بستن تیکت', `close_ticket_${userId}`), Markup.button.callback('🚫 مسدود کردن', `ban_ticket_${userId}`)]
    ]);

    try {
        let extraOptions = { parse_mode: 'HTML', message_thread_id: topicId, ...kb };
        let isThread = !!state.lastAdminMsgId;
        
        // اگر قبلا ادمین جوابی داده، پیام جدید کاربر به همون جواب ریپلای بشه
        if (isThread) {
            extraOptions.reply_to_message_id = state.lastAdminMsgId;
        }

        if (ctx.message.text) {
            const safeText = ctx.message.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const header = isThread 
                ? `💬 <b>پیام جدید</b> | 👤 #User_${userId}` 
                : `📩 <b>تیکت جدید</b>\n👤 #User_${userId}\n🆔 ${username}`;
            const text = `${header}\n\n<blockquote>${safeText}</blockquote>`;
            
            await ctx.telegram.sendMessage(GROUP_ID, text, extraOptions);
        } else {
            let originalCaption = ctx.message.caption || '';
            if (originalCaption.length > 800) originalCaption = originalCaption.substring(0, 800) + '...';
            originalCaption = originalCaption.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
            const header = isThread 
                ? `💬 <b>پیام جدید</b> | 👤 #User_${userId} | 🔖 #Msg_${ctx.message.message_id}` 
                : `📩 <b>تیکت جدید</b>\n👤 #User_${userId}\n🆔 ${username}\n🔖 #Msg_${ctx.message.message_id}`;
            const newCaption = `${header}\n\n<blockquote>${originalCaption}</blockquote>`;
            
            await ctx.telegram.copyMessage(GROUP_ID, ctx.chat.id, ctx.message.message_id, {
                ...extraOptions,
                caption: newCaption
            });
        }
    } catch (err) {
        console.error("Error forwarding support message:", err);
    }
}

function setupHandlers(bot) {
    
    bot.use(async (ctx, next) => {
        const db = readDb();
        const userId = ctx.from?.id?.toString();
        if (!userId) return next();

        if (!db.bannedUsers) db.bannedUsers = [];
        if (db.bannedUsers.includes(userId)) {
            return ctx.reply('❌ شما توسط مدیریت مسدود شده‌اید و دسترسی شما به ربات قطع است.');
        }

        if (db.settings.maintenance && !isUserAdmin(userId) && ctx.chat?.type === 'private') {
            return ctx.reply('🛠 <b>ربات در حال بروزرسانی است...</b>\nلطفاً دقایقی دیگر تلاش کنید.', { parse_mode: 'HTML' });
        }

        if (ctx.callbackQuery && ctx.callbackQuery.data === 'check_channel_join') {
            return next();
        }

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
                
                if (ctx.callbackQuery) {
                    await ctx.answerCbQuery('❌ ابتدا در کانال عضو شوید!', { show_alert: true });
                    return ctx.reply(joinMsg, { reply_markup: joinMarkup });
                } else {
                    return ctx.reply(joinMsg, { reply_markup: joinMarkup });
                }
            }
        }
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
        
        // --- 1. سیستم برودکست ---
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
                    failCount++; 
                }
                await new Promise(r => setTimeout(r, 50)); 
            }
            return ctx.reply(`✅ ارسال همگانی به پایان رسید.\n\n🟢 موفق: ${successCount}\n🔴 ناموفق (بلاک کرده‌اند): ${failCount}`);
        }

        // --- 1. سیستم ریپلای مستقیم ادمین به کاربر در گروه ---
        if (ctx.chat.id.toString() === GROUP_ID) {
            if (ctx.message.reply_to_message && ctx.message.reply_to_message.from.id === ctx.botInfo.id) {
                const repliedText = ctx.message.reply_to_message.text || ctx.message.reply_to_message.caption || '';
                const userMatch = repliedText.match(/#User_(\d+)/);
                
                if (userMatch) {
                    const targetUserId = userMatch[1];
                    try {
                        // 1. بازگرداندن کاربر به محیط چت
                        let state = userSteps.get(Number(targetUserId)) || { step: 'CHAT_SUPPORT' };
                        state.lastAdminMsgId = ctx.message.message_id; // برای زنجیره ریپلای
                        state.ts = Date.now();
                        userSteps.set(Number(targetUserId), state);
                        
                        // 2. ارسال پاسخ به کاربر
                        const adminText = ctx.message.text || ctx.message.caption || '';
                        const extraOptions = { parse_mode: 'HTML', reply_to_message_id: (userSteps.get(Number(targetUserId))?.lastUserMsgId || undefined) };

                        if (ctx.message.text) {
                            await ctx.telegram.sendMessage(targetUserId, `👨‍💻 <b>پاسخ پشتیبانی:</b>\n\n${adminText}`, { parse_mode: 'HTML', ...chatKeyboard });
                        } else {
                            await ctx.telegram.sendMessage(targetUserId, `👨‍💻 <b>پاسخ پشتیبانی:</b>`, { parse_mode: 'HTML', ...chatKeyboard });
                            await ctx.telegram.copyMessage(targetUserId, ctx.chat.id, ctx.message.message_id);
                        }

                        // 3. پاک کردن پیام تایید ادمین
                        const sentAlert = await ctx.reply('✅ ارسال شد.', { reply_to_message_id: ctx.message.message_id });
                        setTimeout(() => { ctx.deleteMessage(sentAlert.message_id).catch(() => {}); }, 3000);
                    } catch (err) {
                        ctx.reply('❌ ارسال نشد (کاربر بلاک کرده).');
                    }
                }
            }
            return next();
        }

        return next();
    });

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

    bot.action('admin_servers_menu', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        ctx.editMessageText('🖥 <b>مدیریت سرورها</b>\nاز اینجا می‌تونی سرورها رو مدیریت کنی و مقصدهای پیش‌فرض رو تعیین کنی:', { 
            parse_mode: 'HTML', 
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('➖ حذف', 'admin_remove_server'), Markup.button.callback('✏️ ویرایش', 'admin_edit_server'), Markup.button.callback('➕ افزودن', 'admin_add_server')],
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

    // --- Cloudflare DNS Management ---

    // 1. منوی اصلی کلودفلر (لیست دامنه‌ها)
    bot.action('admin_cf_menu', async (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        await ctx.answerCbQuery('در حال دریافت دامنه‌ها از Cloudflare...', { show_alert: false });

        const zones = await getCloudflareZones();
        
        if (!zones || zones.length === 0) {
            return ctx.editMessageText('❌ هیچ دامنه‌ای یافت نشد یا توکن نامعتبر است.', {
                reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 بازگشت', 'admin_servers_menu')]] }
            });
        }

        const buttons = zones.map(z => [Markup.button.callback(`🌐 ${z.name}`, `cf_zone_${z.id}_${z.name}`)]);
        buttons.push([Markup.button.callback('🔙 بازگشت', 'admin_servers_menu')]);

        ctx.editMessageText('☁️ <b>مدیریت Cloudflare</b>\n\nلطفاً دامنه مورد نظر را انتخاب کنید:', { 
            parse_mode: 'HTML', 
            reply_markup: { inline_keyboard: buttons } 
        });
    });

    // 2. لیست رکوردهای یک دامنه
    bot.action(/cf_zone_(.+)_(.+)/, async (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const zoneId = ctx.match[1];
        const domainName = ctx.match[2];
        
        await ctx.answerCbQuery('در حال دریافت رکوردها...', { show_alert: false });
        const records = await getDnsRecords(zoneId);

        if (!records || records.length === 0) {
            return ctx.editMessageText(`❌ هیچ رکورد نوع A برای دامنه ${domainName} یافت نشد.`, {
                reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 بازگشت', 'admin_cf_menu')]] }
            });
        }

        let buttons = [];
        let text = `☁️ <b>رکوردهای A دامنه:</b> ${domainName}\n\nبرای تغییر IP، روی رکورد مورد نظر کلیک کنید:\n`;

        records.forEach(r => {
            const proxyStatus = r.proxied ? '🟠 پروکسی روشن' : '⚪️ DNS Only';
            buttons.push([Markup.button.callback(`✏️ ${r.name}`, `cf_edit_${zoneId}_${r.id}`)]);
            text += `\n🔸 <b>${r.name}</b>\nآی‌پی: <code>${r.content}</code>\nوضعیت: ${proxyStatus}\n〰️〰️〰️`;
        });

        buttons.push([Markup.button.callback('🔙 بازگشت', 'admin_cf_menu')]);

        ctx.editMessageText(text, { 
            parse_mode: 'HTML', 
            reply_markup: { inline_keyboard: buttons } 
        });
    });

    // 3. درخواست IP جدید از ادمین
    bot.action(/cf_edit_(.+)_(.+)/, async (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const zoneId = ctx.match[1];
        const recordId = ctx.match[2];

        // ذخیره استیت برای مرحله بعد
        adminSteps.set(ctx.from.id, { step: 'CF_WAITING_IP', zoneId, recordId });
        
        ctx.reply('✏️ لطفاً آی‌پی (IP) جدید را برای این رکورد ارسال کنید:\n\n(مثال: 104.21.23.10)');
        ctx.answerCbQuery();
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

    bot.action('admin_edit_server', (ctx) => {
        const db = readDb();
        const servers = db.servers || [];
        if (servers.length === 0) return ctx.answerCbQuery('سروری وجود ندارد.', {show_alert:true});
        
        const buttons = servers.map(s => {
            return [Markup.button.callback(`✏️ ${s.name}`, `select_edit_srv_${s.id}`)];
        });
        
        buttons.push([Markup.button.callback('🔙 بازگشت', 'admin_servers_menu')]);
        ctx.editMessageText('✏️ <b>کدام سرور را می‌خواهید ویرایش کنید؟</b>\n(با این کار شناسه سرور تغییر نمی‌کند و کاربران قطع نمی‌شوند)', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
    });

    bot.action(/select_edit_srv_(.*)/, (ctx) => {
        const srvId = ctx.match[1];
        adminSteps.set(ctx.from.id, { step: 'EDIT_SERVER_FORMAT', serverId: srvId });
        ctx.reply(`برای ویرایش سرور، اطلاعات جدید رو دقیقاً با فرمت زیر بفرست:\n\n` +
        `نام: سرور آلمان\n` +
        `آدرس: http://1.2.3.4:54321\n` +
        `مسیر پنل: /znuwjha\n` +
        `توکن: XXXXXX\n` +
        `اینباند: 1\n` +
        `دامنه: ns.crrc.ir\n` +
        `اس‌ان‌آی: css.2net.ir\n` +
        `مسیر کانفیگ: /Cypher_Net\n\n` +
        `⚠️ <b>نکته:</b> مسیر پنل اگر خالی است، جلوی آن چیزی ننویسید.`);
        ctx.answerCbQuery();
    });

    bot.action('admin_list_servers', (ctx) => {
        const db = readDb();
        const servers = db.servers || [];
        if (servers.length === 0) return ctx.answerCbQuery('هیچ سروری ثبت نشده.', {show_alert:true});
        
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

    bot.action('admin_users_menu', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        ctx.editMessageText('👥 <b>مدیریت کاربران</b>\nیک گزینه رو انتخاب کن:', { 
            parse_mode: 'HTML', 
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔍 جستجوی کاربر', 'marketing_search')],
                    [Markup.button.callback('💬 ارسال پیام (DM)', 'admin_send_dm')],
                    [Markup.button.callback('🚫 مسدود کردن', 'admin_ban_user'), Markup.button.callback('✅ رفع مسدودی', 'admin_unban_user')],
                    [Markup.button.callback('🗑 ریست کاربر', 'admin_reset_user'), Markup.button.callback('🧹 پاک کردن تست', 'admin_clear_test')],
                    [Markup.button.callback('📋 لیست ادمین‌ها', 'admin_list_admins')],
                    [Markup.button.callback('🎁 جبران خسارت (افزایش گروهی)', 'admin_comp_menu')],
                    [Markup.button.callback('🔙 بازگشت', 'back_admin')]
                ]
            }
        });
        ctx.answerCbQuery();
    });

    bot.action('admin_send_dm', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        adminSteps.set(ctx.from.id, { step: 'DM_GET_USER' });
        ctx.reply('🆔 لطفاً آیدی عددی کاربری که می‌خواهید برایش پیام بفرستید را ارسال کنید:');
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

    // --- بخش جبران خسارت ---
    bot.action('admin_comp_menu', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const db = readDb();
        const servers = db.servers || [];
        
        let buttons = servers.map(s => [Markup.button.callback(`🖥 ${s.name}`, `comp_srv_${s.id}`)]);
        buttons.push([Markup.button.callback('🌐 همه سرورها', 'comp_srv_all')]);
        buttons.push([Markup.button.callback('🔙 بازگشت', 'admin_users_menu')]);
        
        ctx.editMessageText('🎁 <b>جبران خسارت گروهی</b>\n\nلطفاً مشخص کنید که قصد دارید به کاربران کدام سرور هدیه/جبرانی بدهید:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
        ctx.answerCbQuery();
    });

    bot.action(/comp_srv_(.+)/, (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const srvId = ctx.match[1];
        
        adminSteps.set(ctx.from.id, { step: 'COMP_SELECT_TYPE', serverId: srvId });
        
        ctx.editMessageText('⚙️ <b>نوع جبران خسارت</b>\n\nقصد دارید چه چیزی به کاربران اضافه کنید؟', { 
            parse_mode: 'HTML', 
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔋 فقط حجم (گیگابایت)', 'comp_type_gb')],
                    [Markup.button.callback('⏳ فقط زمان (روز)', 'comp_type_days')],
                    [Markup.button.callback('🔋⏳ حجم و زمان (هر دو)', 'comp_type_both')],
                    [Markup.button.callback('❌ لغو', 'admin_users_menu')]
                ]
            }
        });
        ctx.answerCbQuery();
    });

    bot.action(/comp_type_(.+)/, (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const type = ctx.match[1];
        const state = adminSteps.get(ctx.from.id);
        
        if (!state || state.step !== 'COMP_SELECT_TYPE') return;
        
        state.step = 'COMP_GET_VALUE';
        state.compType = type;
        adminSteps.set(ctx.from.id, state);
        
        let msg = '';
        if (type === 'gb') msg = '🔋 لطفاً مقدار <b>حجم</b> مورد نظر برای اضافه شدن را به عدد (گیگابایت) وارد کنید:\n(مثلاً: 5)';
        else if (type === 'days') msg = '⏳ لطفاً مقدار <b>زمان</b> مورد نظر برای اضافه شدن را به عدد (روز) وارد کنید:\n(مثلاً: 3)';
        else msg = '🔋⏳ لطفاً مقدار <b>حجم و زمان</b> را با یک فاصله بنویسید (اول حجم بعد روز):\n(مثلاً برای 5 گیگ و 3 روز بنویسید: 5 3)';
        
        ctx.reply(msg, { parse_mode: 'HTML' });
        ctx.answerCbQuery();
    });

    bot.command('fixdb', (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const db = readDb();
        let count = 0;
        
        for (const userId in db.users) {
            db.users[userId].forEach(conf => {
                if (!conf.serverId || conf.serverId === 'srv_11528' || conf.serverId === 'srv_364212' || conf.serverId === 'default') {
                    conf.serverId = 'srv_364212'; 
                    count++;
                }
            });
        }
        writeDb(db);
        ctx.reply(`✅ دیتابیس اصلاح شد! ${count} کانفیگ قدیمی یا نامعتبر، با موفقیت به سرور ایتالیا (srv_364212) متصل شدند.`);
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

    bot.action('check_channel_join', async (ctx) => {
        const isMember = await checkMembership(ctx, ctx.from.id);
        if (isMember) {
            await ctx.answerCbQuery('✅ عضویت شما تایید شد. خوش آمدید!', { show_alert: true });
            await ctx.deleteMessage().catch(() => {});
            
            userSteps.delete(ctx.from.id);
            const username = ctx.from.username ? `@${ctx.from.username}` : 'ندارد';
            ctx.reply(`سلام! خوش اومدی 🌹\n\n👤 <b>آیدی تلگرام:</b> ${username}\n🆔 <b>کد یکتای شما:</b> <code>${ctx.from.id}</code>\n\n👇 لطفاً یک گزینه رو انتخاب کن:`, { parse_mode: 'HTML', ...mainKeyboard });
        } else {
            await ctx.answerCbQuery('❌ شما هنوز در کانال عضو نشده‌اید! لطفاً ابتدا عضو شوید.', { show_alert: true });
        }
    });

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
            let targetServer = db.servers?.find(s => s.id === conf.serverId);
            if (!targetServer && conf.isVip) targetServer = db.servers?.find(s => s.id === db.settings.activeVipServerId);
            if (!targetServer) targetServer = db.servers?.find(s => s.id === db.settings.activeServerId);
            
            const traffic = await getClientTraffic(conf.email, targetServer);
            
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

        let targetServer = db.servers?.find(s => s.id === conf.serverId);
        if (!targetServer && conf.isVip) targetServer = db.servers?.find(s => s.id === db.settings.activeVipServerId);
        if (!targetServer) targetServer = db.servers?.find(s => s.id === db.settings.activeServerId);
        
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
        // کد قبلی را با این جایگزین کنید:
        if (isActive) buttons.push([Markup.button.callback('📥 دریافت کانفیگ‌ها', `get_configs_${conf.uuid}`)]);
        if (!isTest) buttons.push([Markup.button.callback('🔄 تمدید سرویس', `init_renew_${conf.email}`)]);
        buttons.push([Markup.button.callback('🔙 بازگشت', isActive ? 'dash_active' : 'dash_expired')]);

        ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
    });



    bot.hears('🔄 تمدید سرویس', async (ctx) => {
        userSteps.delete(ctx.from.id);
        
        const statusMsg = await ctx.reply('⏳ در حال بررسی وضعیت اکانت‌ها...');
        const results = await fetchUserConfigsStatus(ctx.from.id);
        
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

    bot.hears('📚 آموزش‌ها', (ctx) => {
        ctx.reply('✅ منوی کاربری شما به نسخه جدید بروزرسانی شد.\nلطفاً برای مشاهده آموزش‌ها، دوباره روی دکمه «📥 اپلیکیشن و آموزش» در پایین صفحه ضربه بزنید.', mainKeyboard);
    });

    bot.hears('📥 اپلیکیشن و آموزش', (ctx) => {
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

    bot.action('panel_tut_win', async (ctx) => {
        await ctx.answerCbQuery('در حال دریافت لینک...', { show_alert: false });
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
        
        // ارسال پیام اطلاع‌رسانی به گروه (بدون دکمه تایید)
        await ctx.telegram.sendMessage(GROUP_ID, `🆕 <b>درخواست تست (صدور خودکار)</b>\n#User_${ctx.from.id}\n👤: ${ctx.from.username ? `@${ctx.from.username}` : 'ندارد'}\n📞: <code>+${contact.phone_number}</code>`, { message_thread_id: parseInt(TOPIC_TEST), parse_mode: 'HTML' });
        
        // پیام انتظار برای کاربر
        const waitMsg = await ctx.reply('⏳ در حال ساخت کانفیگ تست، لطفا چند لحظه صبر کنید...', mainKeyboard);

        // پروسه ساخت خودکار کانفیگ
        const targetServerId = db.settings.activeServerId || 'srv_364212';
        const targetServer = db.servers?.find(s => s.id === targetServerId);
        const email = `Test_${ctx.from.id}_${Date.now()}`;
        
        const uuid = await createClient(email, 0.2, 1, targetServer || null); 
        if (!uuid) return ctx.reply('❌ خطا در ارتباط با سرور.');

        const freshDb = readDb();
        if (!freshDb.users[ctx.from.id]) freshDb.users[ctx.from.id] = [];
        freshDb.users[ctx.from.id].push({ email, uuid, name: 'Test - اکانت تست', serverId: targetServerId });
        writeDb(freshDb);

        // پاک کردن پیام انتظار و ارسال کانفیگ
        // پاک کردن پیام انتظار
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        
        // ارسال پیام کانفیگ با دکمه شیشه‌ای
        await ctx.telegram.sendMessage(ctx.from.id, `🎁 <b>کانفیگ تست شما با موفقیت صادر شد.</b>\n\n📦 <b>حجم:</b> 200 مگابایت\n⏳ <b>زمان:</b> 1 روز\n\nجهت دریافت روی دکمه زیر کلیک کنید:`, { 
            parse_mode: 'HTML', 
            reply_markup: { 
                inline_keyboard: [[Markup.button.callback('🎁 دریافت کانفیگ‌ها', `get_configs_${uuid}`)]] 
            } 
        });

        // فراخوانی مجدد کیبورد اصلی برای جلوگیری از بسته شدن منو
        await ctx.reply('✅ ساخت اکانت به پایان رسید. منوی اصلی:', mainKeyboard);
    }); 

    bot.action(/sendtest_(\d+)/, async (ctx) => {
        const userId = ctx.match[1];
        await ctx.answerCbQuery('در حال ساخت...', { show_alert: false });
        
        const db = readDb();
        const targetServerId = db.settings.activeServerId || 'srv_364212';
        const targetServer = db.servers?.find(s => s.id === targetServerId);

        const email = `Test_${userId}_${Date.now()}`;
        const uuid = await createClient(email, 0.2, 1, targetServer || null); 
        if (!uuid) return ctx.reply('❌ خطا در ارتباط با سرور.');

        if (!db.users[userId]) db.users[userId] = [];
        db.users[userId].push({ email, uuid, name: 'Test - اکانت تست', serverId: targetServerId });
        writeDb(db);

        await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ ارسال شد');
        await ctx.telegram.sendMessage(userId, `🎁 <b>کانفیگ تست شما آماده است.</b>\nجهت دریافت روی دکمه زیر کلیک کنید:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback('🎁 دریافت کانفیگ‌ها', `get_configs_${uuid}`)]] } });
        await ctx.reply('✅ ساخت اکانت به پایان رسید. منوی اصلی:', mainKeyboard);
    });

    bot.action(/get_configs_(.+)/, async (ctx) => {
        const uuid = ctx.match[1];
        await ctx.answerCbQuery('✅ در حال ارسال...', { show_alert: false });
        
        const db = readDb();
        const userConfigs = db.users[ctx.from.id] || [];
        const conf = userConfigs.find(c => c.uuid === uuid);
        const currentConfigName = conf ? conf.name : "CypherNET💎";
        
        let targetServer = db.servers?.find(s => s.id === conf?.serverId);
        if (!targetServer && conf?.isVip) targetServer = db.servers?.find(s => s.id === db.settings.activeVipServerId);
        if (!targetServer) targetServer = db.servers?.find(s => s.id === db.settings.activeServerId);

        const config1 = generateMtnConfig(uuid, currentConfigName, targetServer);
        const config2 = generateMciConfig(uuid, currentConfigName, targetServer);
        
        const msg1 = `🟡 <b>کانفیگ شماره ۱:</b>\nبرای کپی کردن کانفیگ روی آن ضربه بزنید:\n\n<blockquote expandable><code>${config1}</code></blockquote>`;
        const msg2 = `🔵 <b>کانفیگ شماره ۲:</b>\nبرای کپی کردن کانفیگ روی آن ضربه بزنید:\n\n<blockquote expandable><code>${config2}</code></blockquote>\n\n⚠️ <b>نکته مهم:</b>\nلطفاً هر دو کانفیگ را به برنامه اضافه کنید و هرکدام که سرعت و پایداری بهتری داشت را متصل شوید. (ممکن است هر کانفیگ روی اپراتورهای خاصی عملکرد بهتری داشته باشد)`;
        
        await ctx.reply(msg1, { parse_mode: 'HTML' });
        await ctx.reply(msg2, { parse_mode: 'HTML' });
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

        // --- ثبت در دیتابیس پرداخت‌ها ---
        const db = readDb();
        if (!db.payments) db.payments = {};
        
        // اینجا اسم رو به آبجکت payments اضافه می‌کنیم
        db.payments[state.orderId] = { 
            userId: ctx.from.id, 
            planId: state.planId, 
            configName: name, // اسم اینجا ذخیره شد
            orderId: state.orderId, 
            type: 'new' 
        };
        writeDb(db);
        // ------------------------------
        
        const priceDisplay = parseInt(state.price).toLocaleString('en-US');

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
    bot.action('support_error', (ctx) => { 
        ctx.answerCbQuery(); 
        userSteps.set(ctx.from.id, { step: 'CHAT_ERROR', ts: Date.now() }); 
        ctx.deleteMessage().catch(()=> {}); 
        ctx.reply('وارد چت پشتیبانی شدی. پیامت رو بفرست:\n(متن، عکس، ویس یا ویدیو)', chatKeyboard); 
    });
    
    bot.hears('❌ خروج از چت پشتیبانی', async (ctx) => { 
        const state = userSteps.get(ctx.from.id); 
        if (state && (state.step === 'CHAT_ERROR' || state.step === 'CHAT_SUPPORT')) {
            const topicId = parseInt(state.step === 'CHAT_ERROR' ? TOPIC_ERROR : TOPIC_SUPPORT);
            try { await ctx.telegram.sendMessage(GROUP_ID, `🚪 کاربر #User_${ctx.from.id} از چت خارج شد.`, { message_thread_id: topicId }); } catch(e) {} 
        } 
        userSteps.delete(ctx.from.id); 
        ctx.reply('از حالت پشتیبانی خارج شدی. به منوی اصلی برگشتیم:', mainKeyboard); 
    });

    // --- هندلر یکپارچه برای دریافت تمام مدیاها (عکس، ویدیو، ویس، سند) ---
    bot.on(['photo', 'video', 'voice', 'document', 'audio', 'animation'], async (ctx) => {
        const state = userSteps.get(ctx.from.id);
        const adminState = adminSteps.get(ctx.from.id);

        // 1. ارسال پیام DM توسط ادمین
        if (isUserAdmin(ctx.from.id.toString()) && adminState && adminState.step === 'DM_GET_MSG') {
            try {
                await ctx.telegram.copyMessage(adminState.targetUserId, ctx.chat.id, ctx.message.message_id);
                ctx.reply('✅ فایل/پیام شما با موفقیت برای کاربر ارسال شد.');
            } catch (e) {
                ctx.reply('❌ ارسال ناموفق! (احتمالاً کاربر ربات را بلاک کرده است)');
            }
            adminSteps.delete(ctx.from.id);
            return;
        }

        // 2. چت پشتیبانی (ارسال از کاربر به ادمین)
        if (state && (state.step === 'CHAT_ERROR' || state.step === 'CHAT_SUPPORT')) {
            await forwardToAdmin(ctx, state);
            return;
        }

        // 3. دریافت رسید (فقط عکس مجاز است)
        if (state && (state.step === 'WAITING_RECEIPT' || state.step === 'WAITING_RENEW_RECEIPT')) {
            if (!ctx.message.photo) {
                return ctx.reply('⚠️ لطفاً برای بررسی پرداخت، فقط عکس (اسکرین‌شات رسید) ارسال کنید.');
            }

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
                db.payments[payToken] = { userId: ctx.from.id, planId: state.planId, configName: state.configName, email: state.email, orderId: state.orderId, type: 'renew' };
                writeDb(db);

                const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                const caption = `🔄 <b>درخواست تمدید اکانت</b>\n#User_${ctx.from.id}\n📦 شماره سفارش: <code>${state.orderId}</code>\n👤 آیدی: ${ctx.from.username ? `@${ctx.from.username}` : 'ندارد'}\n📦 پلن: ${state.planName}\n📝 نام: ${state.configName}\n📧 ایمیل: <code>${state.email}</code>\n💵 مبلغ: ${state.price} تومان`;
                await ctx.telegram.sendPhoto(GROUP_ID, photoId, { caption, message_thread_id: parseInt(TOPIC_PAYMENT), parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✅ تایید و تمدید سرویس', `confrenew_${payToken}`)], [Markup.button.callback('❌ رد رسید', `reject_${payToken}`)]]) });
                userSteps.delete(ctx.from.id);
                ctx.reply('رسید تمدید شما دریافت شد و در صف بررسی قرار گرفت.', mainKeyboard);
            }
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

            // --- Admin DM Handle Text ---
            if (adminState.step === 'DM_GET_USER') {
                adminSteps.set(ctx.from.id, { step: 'DM_GET_MSG', targetUserId: input });
                ctx.reply(`✍️ حالا پیامی که می‌خواهید برای کاربر ${input} ارسال شود را بفرستید:\n(پشتیبانی از متن، عکس، ویدیو، ویس و فایل)`);
                return;
            }

            if (adminState.step === 'DM_GET_MSG') {
                try {
                    await ctx.telegram.copyMessage(adminState.targetUserId, ctx.chat.id, ctx.message.message_id);
                    ctx.reply('✅ پیام متنی شما با موفقیت برای کاربر ارسال شد.');
                } catch (e) {
                    ctx.reply('❌ ارسال ناموفق! (احتمالاً کاربر ربات را بلاک کرده است)');
                }
                adminSteps.delete(ctx.from.id);
                return;
            }
            // -----------------------------

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

            if (adminState.step === 'EDIT_SERVER_FORMAT') {
                try {
                    const lines = input.split('\n');
                    const extract = (key) => {
                        const line = lines.find(l => l.includes(key));
                        if (!line) return '';
                        return line.replace(new RegExp(`^.*?${key}\\s*[:：]`), '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
                    };

                    let extractedUrl = extract('آدرس');
                    if (extractedUrl && !extractedUrl.startsWith('http')) {
                        extractedUrl = 'http://' + extractedUrl;
                    }

                    const db = readDb();
                    const serverIndex = db.servers.findIndex(s => s.id === adminState.serverId);
                    
                    if (serverIndex === -1) {
                        ctx.reply('❌ سرور یافت نشد.');
                        adminSteps.delete(ctx.from.id);
                        return;
                    }

                    const updatedServer = {
                        id: adminState.serverId, 
                        name: extract('نام') || db.servers[serverIndex].name,
                        panelUrl: extractedUrl || db.servers[serverIndex].panelUrl,
                        webBasePath: extract('مسیر پنل'),
                        apiToken: extract('توکن') || db.servers[serverIndex].apiToken,
                        inboundId: parseInt(extract('اینباند')) || db.servers[serverIndex].inboundId,
                        domain: extract('دامنه') || db.servers[serverIndex].domain,
                        sni: extract('اس‌ان‌آی') || db.servers[serverIndex].sni,
                        path: extract('مسیر کانفیگ') || db.servers[serverIndex].path,
                        isMigrating: db.servers[serverIndex].isMigrating 
                    };

                    ctx.reply(`🔍 در حال تست لاگین با اطلاعات جدید...\nآدرس نهایی: [${updatedServer.panelUrl}]\nمسیر: [${updatedServer.webBasePath}]`);

                    testServerConnection(updatedServer.panelUrl, updatedServer.webBasePath, updatedServer.apiToken).then(test => {
                        if (!test.success) return ctx.reply(`❌ اتصال برقرار نشد: ${test.msg}\nتغییرات ذخیره نشد.`);
                        
                        const freshDb = readDb(); 
                        const sIndex = freshDb.servers.findIndex(s => s.id === adminState.serverId);
                        if(sIndex > -1) {
                            freshDb.servers[sIndex] = updatedServer;
                            writeDb(freshDb);
                            ctx.reply(`✅ اطلاعات سرور ${updatedServer.name} با موفقیت ویرایش و جایگزین شد.`);
                        }
                    });
                    
                } catch (e) {
                    ctx.reply('❌ خطا در پردازش فرمت.');
                }
                adminSteps.delete(ctx.from.id);
                return;
            }

            // هندل کردن IP جدید برای کلودفلر
            if (adminState.step === 'CF_WAITING_IP') {
                const newIp = input;
                const { zoneId, recordId } = adminState;

                // یک ولیدیشن ساده برای فرمت IP
                const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
                if (!ipRegex.test(newIp)) {
                    return ctx.reply('❌ فرمت IP اشتباه است. لطفاً فقط یک آی‌پی معتبر بفرستید.');
                }

                ctx.reply('⏳ در حال اعمال تغییرات در Cloudflare...');

                // برای آپدیت، باید اسم رکورد و وضعیت پروکسی رو داشته باشیم
                // پس یه بار دیگه رکوردها رو می‌گیریم تا دیتای قبلیش رو پیدا کنیم
                const records = await getDnsRecords(zoneId);
                const targetRecord = records.find(r => r.id === recordId);

                if (!targetRecord) {
                    adminSteps.delete(ctx.from.id);
                    return ctx.reply('❌ رکورد در کلودفلر یافت نشد.');
                }

                const success = await updateDnsRecord(zoneId, recordId, targetRecord.name, 'A', newIp, targetRecord.proxied);

                if (success) {
                    ctx.reply(`✅ آی‌پی دامنه <b>${targetRecord.name}</b> با موفقیت به <code>${newIp}</code> تغییر یافت.`, { parse_mode: 'HTML' });
                } else {
                    ctx.reply('❌ خطا در ارتباط با کلودفلر. تغییرات اعمال نشد.');
                }

                adminSteps.delete(ctx.from.id);
                return;
            }

            if (adminState.step === 'REMOVE_SERVER_ID') {
                if (!db.servers) db.servers = [];
                const initialLength = db.servers.length;
                db.servers = db.servers.filter(s => s.id !== input);
                
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

                    let durationText = '';
                    if (days < 30) {
                        durationText = `${days} روزه`;
                    } else {
                        const months = Math.floor(days / 30);
                        durationText = `${months} ماهه`;
                    }

                    const newPlan = {
                        id, name, gb, days, price, order,
                        showInNew, showInRenew, targetUserId,
                        btnText: `📦 ${name} - ${durationText} (${price.toLocaleString('en-US')} تومان)`
                    };

                    if (!db.settings.plans) db.settings.plans = [];
                    const existingIndex = db.settings.plans.findIndex(p => p.id === id);
                    if (existingIndex > -1) db.settings.plans[existingIndex] = newPlan;
                    else db.settings.plans.push(newPlan);

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
                        serverId: db.settings.activeVipServerId || db.settings.activeServerId || 'srv_11528',
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
                
                let buttons = plans.map(p => [Markup.button.callback(`📦 ${p.name}`, `manual_p_${p.id}`)]);
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
                
                const targetServerId = (isVip && db.settings.activeVipServerId) 
                    ? db.settings.activeVipServerId 
                    : (db.settings.activeServerId || 'srv_364212');
                    
                const targetServer = db.servers?.find(s => s.id === targetServerId);
                const email = `User_${targetUserId}_Ord${orderId}_${Date.now()}`;
                
                const uuid = await createClient(email, totalGB, expiryDays, targetServer || null);
                if (!uuid) return ctx.reply('❌ خطا در ارتباط با پنل سرور.');

                const freshDb = readDb();
                if (!freshDb.users[targetUserId]) freshDb.users[targetUserId] = [];
                
                let finalName = input;
                const flag = getServerFlag(targetServer?.name);
                if (flag && !finalName.includes(flag)) {
                    finalName = `${finalName} ${flag}`.trim();
                }

                freshDb.users[targetUserId].push({ 
                    email, 
                    uuid, 
                    name: finalName, 
                    orderId: orderId,
                    serverId: targetServerId,
                    ...(isVip ? { isVip: true } : {})
                });
                
                if (isVip) {
                    if (!freshDb.vipUsers) freshDb.vipUsers = [];
                    if (!freshDb.vipUsers.includes(targetUserId)) freshDb.vipUsers.push(targetUserId);
                }

                writeDb(freshDb);

                try {
                    // کد قبلی را با این جایگزین کنید:
                    await ctx.telegram.sendMessage(targetUserId, `✅ <b>سرویس شما با موفقیت فعال شد</b>\n🆔 شماره سفارش: <code>${orderId}</code>\n\nجهت دریافت کانفیگ‌های خود روی دکمه زیر کلیک کنید:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('📥 دریافت کانفیگ‌ها', `get_configs_${uuid}`)]]) });
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

                let nameDisplay = 'نامشخص';
                let usernameDisplay = 'ندارد';
                try {
                    const chatInfo = await ctx.telegram.getChat(targetId);
                    nameDisplay = chatInfo.first_name || 'بدون نام';
                    if (chatInfo.last_name) nameDisplay += ` ${chatInfo.last_name}`;
                    nameDisplay = nameDisplay.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    usernameDisplay = chatInfo.username ? `@${chatInfo.username}` : 'ندارد';
                } catch (e) {
                    nameDisplay = 'نامشخص (ربات دسترسی ندارد)';
                }

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
                if (db.users[input]) delete db.users[input];
                if (db.testUsers) db.testUsers = db.testUsers.filter(id => id.toString() !== input);
                if (db.vipUsers) db.vipUsers = db.vipUsers.filter(id => id.toString() !== input);
                writeDb(db);
                ctx.reply(`🗑 تمام اطلاعات کاربر ${input} (شامل کانفیگ‌ها، وضعیت VIP، سابقه تست و مسدودی) از دیتابیس ربات پاک شد.`);
                adminSteps.delete(ctx.from.id);
                return;
            }
        }

            // --- پردازش مقادیر جبران خسارت ---
            if (adminState && adminState.step === 'COMP_GET_VALUE') {
                const { serverId, compType } = adminState;
                let addGb = 0;
                let addDays = 0;
                
                try {
                    if (compType === 'gb') {
                        addGb = parseFloat(input);
                        if (isNaN(addGb)) throw new Error();
                    } else if (compType === 'days') {
                        addDays = parseInt(input);
                        if (isNaN(addDays)) throw new Error();
                    } else if (compType === 'both') {
                        const parts = input.split(' ');
                        addGb = parseFloat(parts[0]);
                        addDays = parseInt(parts[1]);
                        if (isNaN(addGb) || isNaN(addDays)) throw new Error();
                    }
                } catch (e) {
                    return ctx.reply('❌ فرمت وارد شده اشتباه است. لطفاً عدد معتبر وارد کنید.');
                }

                adminSteps.delete(ctx.from.id);
                ctx.reply(`⏳ <b>در حال پردازش و اعمال جبران خسارت...</b>\n\nاین عملیات در پس‌زمینه انجام می‌شود و بسته به تعداد کاربران ممکن است چند دقیقه طول بکشد. لطفاً صبور باشید...`, { parse_mode: 'HTML' });

                const db = readDb();
                let successCount = 0;
                let failCount = 0;
                let affectedUsers = new Set();
                
                // اجرای حلقه امن در پس‌زمینه
                (async () => {
                    for (const uid in db.users) {

                        let dbChanged = false;
                        for (let conf of db.users[uid]) {

                            // فیلتر کردن سرور و اکانت‌های تست
                            if (serverId !== 'all' && conf.serverId !== serverId) continue;
                            if (conf.name === 'سرویس قبلی' || conf.email.startsWith('Test_')) continue;

                            const targetServer = db.servers?.find(s => s.id === conf.serverId);
                            if (!targetServer) continue;

                            try {
                                const traffic = await getClientTraffic(conf.email, targetServer);
                                if (!traffic) { failCount++; continue; }

                                // --- بررسی فعال بودن اکانت ---
                                const isTimeExpired = traffic.expiryTime > 0 && traffic.expiryTime < Date.now();
                                const isVolumeExpired = traffic.total > 0 && (traffic.up + traffic.down) >= traffic.total;
                                
                                if (isTimeExpired || isVolumeExpired) {
                                    continue; // اکانت منقضی شده است، رد می‌شویم
                                }
                                // -----------------------------

                                const currentTotalGB = traffic.total / 1073741824;
                                
                                let remainDays = 0;
                                if (traffic.expiryTime > 0) {
                                    const diffMs = traffic.expiryTime - Date.now();
                                    if (diffMs > 0) remainDays = diffMs / (1000 * 60 * 60 * 24);
                                }

                                const finalGB = traffic.total === 0 ? 0 : currentTotalGB + addGb;
                                const finalDays = traffic.expiryTime === 0 ? 0 : Math.ceil(remainDays + addDays);

                                const result = await renewClient(conf.uuid, conf.email, conf.email, finalGB, finalDays, targetServer);
                                
                                if (result && result.success) {
                                    successCount++;
                                    affectedUsers.add(uid);
                                    dbChanged = true;
                                } else {
                                    failCount++;
                                }
                            } catch (err) {
                                failCount++;
                            }
                            
                            await new Promise(r => setTimeout(r, 200));
                        }
                        if (dbChanged) writeDb(db);
                    }

                    await ctx.telegram.sendMessage(ctx.from.id, `✅ <b>عملیات جبران خسارت (تست کانفیگ خاص) پایان یافت.</b>\n\n🟢 موفق: ${successCount} کانفیگ\n🔴 ناموفق: ${failCount} کانفیگ\n👥 کاربران شامل هدیه: ${affectedUsers.size}`, { parse_mode: 'HTML' });

                    if (affectedUsers.size > 0) {
                        let userMsg = `🎁 <b>هدیه جبران خسارت</b>\n\nکاربر گرامی، بابت اختلالات اخیر سرورها صمیمانه عذرخواهی می‌کنیم.\nجهت جبران این قطعی، `;
                        if (compType === 'gb') userMsg += `مقدار <b>${addGb} گیگابایت</b> حجم`;
                        else if (compType === 'days') userMsg += `تعداد <b>${addDays} روز</b> زمان`;
                        else userMsg += `مقدار <b>${addGb} گیگابایت</b> حجم و <b>${addDays} روز</b> زمان`;
                        userMsg += ` به سرویس شما اضافه شد.\n\nاز همراهی و شکیبایی شما سپاسگزاریم. 🌹`;

                        for (const uid of affectedUsers) {
                            try {
                                await ctx.telegram.sendMessage(uid, userMsg, { parse_mode: 'HTML' });
                            } catch (e) {}
                            await new Promise(r => setTimeout(r, 50));
                        }
                    }
                })();
                return;
            }

        // --- User Support Message ---
        if (state && (state.step === 'CHAT_ERROR' || state.step === 'CHAT_SUPPORT')) {
            await forwardToAdmin(ctx, state);
            return;
        }

        if (ctx.chat.type === 'private' && !isUserAdmin(userId)) {
            ctx.reply('لطفاً یک گزینه از منو انتخاب کن.');
        }
    });
    
    // --- مدیریت دکمه‌های تیکت (بستن و مسدود کردن) ---
    bot.action(/close_ticket_(\d+)/, async (ctx) => { 
        const userId = Number(ctx.match[1]);
        userSteps.delete(userId); 
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
        await ctx.reply(`🔒 چت با کاربر #User_${userId} بسته شد.`);
        
        try {
            await ctx.telegram.sendMessage(userId, '🔒 <b>پشتیبانی به پایان رسید.</b>\nآیا مشکل شما برطرف شد؟', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [Markup.button.callback('✅ بله', `feedback_yes_${userId}`), Markup.button.callback('❌ خیر', `feedback_no_${userId}`)]
                    ]
                }
            });
        } catch (e) {}
        ctx.answerCbQuery(); 
    });

    bot.action(/ban_ticket_(\d+)/, async (ctx) => {
        if (!isUserAdmin(ctx.from.id.toString())) return;
        const userId = ctx.match[1];
        const db = readDb();
        if (!db.bannedUsers) db.bannedUsers = [];
        if (!db.bannedUsers.includes(userId)) { db.bannedUsers.push(userId); writeDb(db); }
        userSteps.delete(Number(userId));
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
        await ctx.reply(`🚫 کاربر #User_${userId} مسدود شد.`);
        try { await ctx.telegram.sendMessage(userId, '🚫 <b>دسترسی شما به ربات مسدود شد.</b>', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }); } catch (e) {}
        ctx.answerCbQuery('کاربر مسدود شد.');
    });


    bot.action(/feedback_(yes|no)_(\d+)/, async (ctx) => { 
        await ctx.editMessageText(`ممنون از بازخوردت 🌻.`); 
        ctx.telegram.sendMessage(GROUP_ID, `📊 بازخورد کاربر #User_${ctx.match[2]}: ${ctx.match[1] === 'yes' ? '✅ حل شد' : '❌ حل نشد'}`); 
    });

    bot.action(/reject_(.+)/, async (ctx) => {
        const payToken = ctx.match[1];
        const db = readDb();
        const payData = db.payments?.[payToken];
        
        if (!payData) return ctx.answerCbQuery('❌ اطلاعات تراکنش یافت نشد یا قبلاً بررسی شده است.', {show_alert: true});

        const userId = payData.userId;
        delete db.payments[payToken];
        writeDb(db);

        const caption = ctx.callbackQuery.message.caption || '';
        await ctx.editMessageCaption(caption + '\n\n❌ <b>وضعیت: رد شد</b>', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }).catch(()=>{});

        try {
            await ctx.telegram.sendMessage(userId, '❌ <b>رسید پرداختی شما توسط مدیریت تایید نشد.</b>\nدر صورت کسر وجه یا بروز مشکل، لطفاً از بخش «پشتیبانی و گزارش خطا» پیگیری کنید.', { parse_mode: 'HTML' });
        } catch (e) {}
    });

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
            : (db.settings.activeServerId || 'srv_364212');
            
        const targetServer = db.servers?.find(s => s.id === targetServerId);

        let finalName = configName;
        if (finalName === 'بدون اسم' || !finalName) {
            const userConfigs = db.users[userId] || [];
            const cypherCount = userConfigs.filter(c => c.name && c.name.startsWith('سایفر')).length;
            finalName = `سایفر ${cypherCount + 1}`;
        }
        const flag = getServerFlag(targetServer?.name);
        finalName = `${finalName} ${flag}`.trim();

        const uuid = await createClient(email, totalGB, expiryDays, targetServer || null);
        
        if (!uuid) return ctx.reply('❌ خطا در ساخت کانفیگ در پنل.');

        if (!db.users[userId]) db.users[userId] = [];
        db.users[userId].push({ 
            email, 
            uuid, 
            name: finalName,
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
    
        await ctx.editMessageCaption(caption + '\n\n✅ <b>وضعیت: تایید شد</b>', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
        
        // کد قبلی را با این جایگزین کنید:
        await ctx.telegram.sendMessage(userId, `✅ <b>سرویس شما با موفقیت فعال شد</b>\n🆔 شماره سفارش: <code>${orderId}</code>\n\nجهت دریافت کانفیگ‌های خود روی دکمه زیر کلیک کنید:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('📥 دریافت کانفیگ‌ها', `get_configs_${uuid}`)]]) });
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

        let currentServerId = conf.serverId;
        if (!currentServerId) {
            currentServerId = (conf.isVip && db.settings.activeVipServerId) 
                ? db.settings.activeVipServerId 
                : (db.settings.activeServerId || 'srv_364212');
        }

       const oldServer = db.servers?.find(s => s.id === currentServerId);
        
        let targetServerId = currentServerId; 
        
        if (oldServer && oldServer.isMigrating) {
            targetServerId = (conf.isVip && db.settings.activeVipServerId)
                ? db.settings.activeVipServerId 
                : (db.settings.activeServerId || currentServerId);
        }

        const targetServer = db.servers?.find(s => s.id === targetServerId);

        const oldEmail = conf.email;
        const newEmail = `User_${userId}_Ord${orderId}_${Date.now()}`;

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

            const finalGB = planId === 'vip' ? 100 : totalGB + remainGB;

            let finalDays;
            if (planId === 'vip') {
                if (remainDays > 0 && remainDays <= 3) {
                    finalDays = 32;
                } else {
                    finalDays = 30;
                }
            } else {
                finalDays = expiryDays + Math.ceil(remainDays);
            }

            if (currentServerId !== targetServerId) {
            if (oldServer) await deleteClient(oldEmail, oldServer); 
            
            const newUuid = await createClient(newEmail, finalGB, finalDays, targetServer || null);
            if (!newUuid) return ctx.reply('❌ خطا در کوچ کانفیگ به سرور جدید.');
            conf.uuid = newUuid; 
        } else {
            const result = await renewClient(conf.uuid, oldEmail, newEmail, finalGB, finalDays, targetServer || null);
            if (!result.success) return ctx.reply(`❌ <b>خطا در تمدید:</b>\n<code>${result.log}</code>`, { parse_mode: 'HTML' });
        }

        conf.email = newEmail;
        conf.orderId = orderId; 
        conf.serverId = targetServerId; 
        
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
        await ctx.editMessageCaption(caption + '\n\n✅ <b>وضعیت: تمدید شد</b>', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }).catch(()=>{});
       // کد قبلی را با این جایگزین کنید:
        await ctx.telegram.sendMessage(userId, `✅ <b>سرویس شما با موفقیت تمدید شد.</b>\n🧾 شناسه خرید: <code>${orderId}</code> (تأییدشده)\n\n♻️ <b>نکته مهم:</b> نیازی به وارد کردن کانفیگ جدید نیست! همان کانفیگ قبلی شما مجدداً شارژ شده و به درستی کار می‌کند.\n\n(اگر نیاز به دریافت مجدد کانفیگ دارید، می‌توانید از دکمه زیر استفاده کنید)`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('📥 دریافت مجدد کانفیگ‌ها', `get_configs_${conf.uuid}`)]]) });
    });



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

                    if (!conf.panelStats || conf.panelStats.email !== conf.email) {
                        conf.panelStats = { total: currentTotal, used: currentUsed, expiry: currentExpiry, email: conf.email };
                        dbChanged = true;
                        continue; 
                    }

                    let changes = [];

                    if (currentExpiry > conf.panelStats.expiry) {
                        changes.push(`⏱ زمان سرویس شما بروزرسانی شد.`);
                    }

                    if (currentTotal > conf.panelStats.total || currentUsed < (conf.panelStats.used - 1048576)) { 
                        changes.push(`🔋 حجم سرویس شما بروزرسانی شد.`);
                    }

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

    setInterval(async () => {
        try {
            const db = readDb();
            let dbChanged = false;
            const now = Date.now();

            for (const userId in db.users) {
                if (!Array.isArray(db.users[userId])) continue;

                for (let conf of db.users[userId]) {
                    if (conf.deletedFromPanel) continue;

                    const isTestAccount = conf.email?.startsWith('Test_') || conf.planId === 'test' || conf.name?.includes('تست');
                    const targetServer = db.servers?.find(s => s.id === conf.serverId);
                    if (!targetServer) continue;

                    const traffic = await getClientTraffic(conf.email, targetServer);
                    
                    if (!traffic) {
                        conf.deletedFromPanel = true;
                        dbChanged = true;
                        continue;
                    }

                    if (traffic.expiryTime > 0) {
                        const diffMs = now - traffic.expiryTime;

                        if (isTestAccount && diffMs > (2 * 24 * 60 * 60 * 1000)) {
                            await deleteClient(conf.email, targetServer).catch(()=>{});
                            conf.deletedFromPanel = true;
                            dbChanged = true;
                        } 
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

                    if (remainDays <= 3 && remainDays > 0 && !conf.notified.days3) {
                        conf.notified.days3 = true;
                        dbChanged = true;
                        await bot.telegram.sendMessage(userId, `⚠️ <b>هشدار پایان سرویس</b>\n\n⏳ فقط <b>${remainDays} روز</b> از اعتبار سرویس شما (<b>${conf.name}</b>) باقی مانده است.`, {
                            parse_mode: 'HTML',
                            ...Markup.inlineKeyboard([[Markup.button.callback('🔄 تمدید آنلاین', `init_renew_${conf.email}`)], [Markup.button.callback('❌ لغو', 'close_menu')]])
                        });
                    }

                    if (traffic.total > 0 && (usedGB / totalGB) >= 0.85 && remainGB > 1 && !conf.notified.gb85) {
                        conf.notified.gb85 = true;
                        dbChanged = true;
                        await bot.telegram.sendMessage(userId, `⚠️ <b>هشدار مصرف حجم</b>\n\n📉 <b>۸۵٪</b> از حجم سرویس شما (<b>${conf.name}</b>) مصرف شده است و تنها <b>${remainGB.toFixed(2)} گیگابایت</b> باقی مانده است.`, {
                            parse_mode: 'HTML',
                            ...Markup.inlineKeyboard([[Markup.button.callback('🔄 تمدید آنلاین', `init_renew_${conf.email}`)], [Markup.button.callback('❌ لغو', 'close_menu')]])
                        });
                    }

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