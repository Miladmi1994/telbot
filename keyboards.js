const { Markup } = require('telegraf');

const mainKeyboard = Markup.keyboard([
    ['👤 داشبورد من', '📥 اپلیکیشن و آموزش'],
    ['🛒 خرید مستقیم (بدون شماره)', Markup.button.contactRequest('🎁 دریافت تست (نیاز به شماره)')],
    ['🤝 دریافت لینک دعوت'],
    ['🛠 پشتیبانی و گزارش خطا', '🔄 تمدید سرویس']
]).resize();

const chatKeyboard = Markup.keyboard([
    ['❌ خروج از چت پشتیبانی']
]).resize();

const cancelBtn = Markup.button.callback('❌ لغو', 'cancel_flow');

const rulesKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⚠️ قوانین را می‌پذیرم', 'accept_rules')],
    [cancelBtn]
]);

const getPlansKeyboard = (userId, db) => {
    const buttons = [
        [Markup.button.callback('📦 30 گیگ - 1 ماهه (180,000 تومان)', 'plan_30')],
        [Markup.button.callback('📦 50 گیگ - 1 ماهه (275,000 تومان)', 'plan_50')],
        [Markup.button.callback('📦 100 گیگ - 2 ماهه (500,000 تومان)', 'plan_100')]
    ];

    const isUserVip = (db.vipUsers || []).includes(userId);
    if (isUserVip) {
        const userConfigs = db.users?.[userId] || [];
        const alreadyHasVip = userConfigs.some(c => c.isVip);
        
        if (!alreadyHasVip) {
            buttons.push([Markup.button.callback('👑 100 گیگ VIP - 1 ماهه', 'plan_vip')]); 
        }
    }

    buttons.push([Markup.button.callback('🔙 بازگشت', 'back_rules'), cancelBtn]);
    return Markup.inlineKeyboard(buttons);
};

const receiptKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔙 بازگشت', 'back_plans'), cancelBtn]
]);

const supportMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔌 پشتیبانی و گزارش مشکل', 'support_error')],
    [cancelBtn]
]);

// پنل مدیریت ادمین
const getAdminKeyboard = (db) => Markup.inlineKeyboard([
    [
        Markup.button.callback(`فروش: ${db.settings.salesOpen ? '🟢 باز' : '🔴 بسته'}`, 'toggle_sales'),
        Markup.button.callback(`بروزرسانی: ${db.settings.maintenance ? '🔴 روشن' : '🟢 خاموش'}`, 'toggle_maint')
    ],
    [
        Markup.button.callback('👑 اعضای VIP', 'admin_vip_menu'),
        Markup.button.callback('📦 پکیج‌ها', 'admin_plans_menu')
    ],
    [
        Markup.button.callback('👥 مدیریت کاربران', 'admin_users_menu'),
        Markup.button.callback('🖥 مدیریت سرورها', 'admin_servers_menu')
    ],
    [
        Markup.button.callback('💰 مالی و فروش', 'admin_finance_menu'),
        Markup.button.callback('📊 آمار و مارکتینگ', 'admin_marketing_menu')
    ]
]);

const getAdminMarketingMenu = (db) => {
    const exemptStatus = db.settings.adminExemptReferral ? '🟢 روشن' : '🔴 خاموش';
    
    return Markup.inlineKeyboard([
        [Markup.button.callback('👥 آمار کاربران', 'marketing_users'), Markup.button.callback('📈 آمار فروش', 'marketing_sales')],
        [Markup.button.callback('🏆 برترین معرف‌ها (لیدربورد)', 'marketing_leaderboard')],
        [Markup.button.callback('🔍 جستجوی پیشرفته کاربر', 'marketing_search')],
        [Markup.button.callback('📢 ارسال پیام همگانی', 'admin_broadcast')],
        [Markup.button.callback(`معافیت ادمین از رفرال: ${exemptStatus}`, 'toggle_admin_exempt')],
        [Markup.button.callback('🔙 بازگشت', 'back_admin')]
    ]);
};

const adminServersMenu = Markup.inlineKeyboard([
    [Markup.button.callback('➖ حذف', 'admin_remove_server'), Markup.button.callback('✏️ ویرایش', 'admin_edit_server'), Markup.button.callback('➕ افزودن', 'admin_add_server')],
    [Markup.button.callback('📋 لیست سرورها', 'admin_list_servers')],
    [Markup.button.callback('✅ سرور عادی', 'admin_set_active_server'), Markup.button.callback('👑 سرور VIP', 'admin_set_vip_server')],
    [Markup.button.callback('☁️ مدیریت Cloudflare', 'admin_cf_menu')], 
    [Markup.button.callback('🔙 بازگشت', 'back_admin')]
]);

// منوی مدیریت اختصاصی یک سرور
const getServerManageMenu = (serverId) => Markup.inlineKeyboard([
    [Markup.button.callback('⚙️ مدیریت اینباندها', `manage_inbounds_${serverId}`)],
    [Markup.button.callback('✏️ ویرایش نام', `edit_srv_name_${serverId}`), Markup.button.callback('✏️ ویرایش آدرس', `edit_srv_url_${serverId}`)],
    [Markup.button.callback('✏️ ویرایش توکن', `edit_srv_token_${serverId}`)],
    [Markup.button.callback('🔙 لیست سرورها', 'admin_servers_menu')]
]);

// منوی لیست اینباندهای یک سرور
const getInboundsMenu = (serverId, inbounds = []) => {
    const buttons = inbounds.map((inb, index) => [
        Markup.button.callback(`🔌 شناسه: ${inb.id} | ${inb.domain}`, `edit_inbound_${serverId}_${index}`)
    ]);
    buttons.push([Markup.button.callback('➕ افزودن اینباند جدید', `add_inbound_${serverId}`)]);
    buttons.push([Markup.button.callback('🔙 بازگشت به مدیریت سرور', `manage_srv_${serverId}`)]);
    return Markup.inlineKeyboard(buttons);
};

// منوی ویرایش یک اینباند خاص
const getSingleInboundMenu = (serverId, inboundIndex, inb) => Markup.inlineKeyboard([
    [Markup.button.callback('✏️ ویرایش شناسه (ID)', `edit_inb_id_${serverId}_${inboundIndex}`)],
    [Markup.button.callback('✏️ ویرایش دامنه', `edit_inb_domain_${serverId}_${inboundIndex}`), Markup.button.callback('✏️ ویرایش SNI', `edit_inb_sni_${serverId}_${inboundIndex}`)],
    [Markup.button.callback('✏️ ویرایش مسیر (Path)', `edit_inb_path_${serverId}_${inboundIndex}`)],
    [Markup.button.callback('🌐 ویرایش نوع شبکه', `edit_inb_net_${serverId}_${inboundIndex}`)],
    [Markup.button.callback(inb?.isSpecialWs ? '✅ کانفیگ ویژه WS: فعال' : '❌ کانفیگ ویژه WS: غیرفعال', `toggle_special_ws_${serverId}_${inboundIndex}`)],
    [Markup.button.callback('🗑 حذف این اینباند', `del_inb_${serverId}_${inboundIndex}`)],
    [Markup.button.callback('🔙 بازگشت به لیست اینباندها', `manage_inbounds_${serverId}`)]
]);

// زیرمنوی مدیریت کاربران
const adminUsersMenu = Markup.inlineKeyboard([
    [Markup.button.callback('➖ حذف ادمین', 'admin_remove_admin'), Markup.button.callback('➕ افزودن ادمین جدید', 'admin_add_admin')],
    [Markup.button.callback('📋 لیست ادمین‌ها', 'admin_list_admins')],
    [Markup.button.callback('🚫 مسدود سازی کاربر', 'admin_ban_user'), Markup.button.callback('✅ رفع مسدودسازی', 'admin_unban_user')],
    [Markup.button.callback('🧹 پاک کردن تست کاربر', 'admin_clear_test'), Markup.button.callback('🗑 ریست کامل کاربر', 'admin_reset_user')],
    [Markup.button.callback('🔙 بازگشت', 'back_admin')]
]);

// زیرمنوی مدیریت مالی
const adminFinanceMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🛒 ثبت دستی خرید', 'admin_manual_buy')],
    [Markup.button.callback('📓 دفتر حساب‌وکتاب (تسویه)', 'admin_accounting_menu')],
    [Markup.button.callback('🧹 صفر کردن آمار مالی', 'reset_finance')],
    [Markup.button.callback('🔙 بازگشت', 'back_admin')]
]);

// منوی دفتر حساب‌وکتاب (تسویه حساب شرکا)
const adminAccountingMenu = Markup.inlineKeyboard([
    [Markup.button.callback('📊 وضعیت دوره فعلی', 'acc_status')],
    [Markup.button.callback('➖ ثبت هزینه سرور', 'acc_add_expense')],
    [Markup.button.callback('🤝 تسویه‌حساب (تقسیم سود)', 'acc_settle')],
    [Markup.button.callback('🗂 تاریخچه تسویه‌ها', 'acc_history')],
    [Markup.button.callback('🔙 بازگشت', 'admin_finance_menu')]
]);

// منوی مدیریت VIP
const adminVipMenu = Markup.inlineKeyboard([
    [Markup.button.callback('➕ افزودن عضو VIP', 'admin_add_vip')],
    [Markup.button.callback('➖ حذف عضو VIP', 'admin_remove_vip')],
    [Markup.button.callback('📋 مشاهده اعضای VIP', 'admin_list_vip')],
    [Markup.button.callback('🔙 بازگشت', 'back_admin')]
]);

// لیست اصلی پکیج‌ها
const getAdminPlansMenu = (db) => {
    const plans = db.settings?.plans || [];
    const customStatus = db.settings?.customPlanEnabled ? '🟢 فعال' : '🔴 غیرفعال';
    
    let buttons = plans.map(p => [Markup.button.callback(`📦 ${p.name} (${p.price.toLocaleString()}T)`, `edit_plan_${p.id}`)]);
    
    buttons.push([Markup.button.callback('➕ افزودن پکیج جدید', 'admin_add_plan_wiz')]);
    buttons.push([Markup.button.callback(`✨ بسته دلخواه: ${customStatus}`, 'toggle_custom_plan')]);
    buttons.push([Markup.button.callback('🔙 بازگشت', 'back_admin')]);
    
    return Markup.inlineKeyboard(buttons);
};

// منوی مدیریت یک پکیج خاص
const getSinglePlanMenu = (plan) => {
    return Markup.inlineKeyboard([
        [Markup.button.callback(`✏️ نام: ${plan.name}`, `edit_p_name_${plan.id}`)],
        [Markup.button.callback(`✏️ حجم: ${plan.gb} GB`, `edit_p_gb_${plan.id}`), Markup.button.callback(`✏️ زمان: ${plan.days} روز`, `edit_p_days_${plan.id}`)],
        [Markup.button.callback(`✏️ قیمت پایه: ${plan.price.toLocaleString()}T`, `edit_p_price_${plan.id}`)],
        [Markup.button.callback(`🎁 تخفیف: ${plan.discountPercent || 0} درصد`, `edit_p_disc_${plan.id}`)],
        [
            Markup.button.callback(`👁 خرید جدید: ${plan.showInNew !== false ? '✅' : '❌'}`, `toggle_p_new_${plan.id}`),
            Markup.button.callback(`🔄 تمدید: ${plan.showInRenew !== false ? '✅' : '❌'}`, `toggle_p_renew_${plan.id}`)
        ],
        [Markup.button.callback(plan.targetUserId ? `👤 اختصاصی: ${plan.targetUserId}` : '👤 تخصیص به کاربر خاص', `edit_p_user_${plan.id}`)],
        [Markup.button.callback('🗑 حذف پکیج', `del_plan_${plan.id}`)],
        [Markup.button.callback('🔙 لیست پکیج‌ها', 'admin_plans_menu')]
    ]);
};

module.exports = {
    mainKeyboard, 
    chatKeyboard, 
    rulesKeyboard, 
    getPlansKeyboard, 
    receiptKeyboard, 
    supportMenuKeyboard, 
    getAdminKeyboard,
    adminServersMenu,
    adminVipMenu,
    adminUsersMenu,
    adminFinanceMenu,
    cancelBtn,
    getAdminMarketingMenu,
    adminAccountingMenu,
    getServerManageMenu,
    getInboundsMenu,
    getSingleInboundMenu,
    getAdminPlansMenu,
    getSinglePlanMenu
};
