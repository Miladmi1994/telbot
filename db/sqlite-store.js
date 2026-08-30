const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function openDatabase(dbFilePath) {
    const dir = path.dirname(dbFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // استفاده از better-sqlite3
    const db = new Database(dbFilePath);
    
    // فعال‌سازی حالت WAL برای جلوگیری از خطای Database Locked و تداخل در نوشتن همزمان
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    
    try { db.exec("ALTER TABLE global_stats ADD COLUMN period_income INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE global_stats ADD COLUMN period_expenses INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}

    // ساخت جدول اینباندها اگر وجود نداشت + ستون‌های جدید
    db.exec(`
        CREATE TABLE IF NOT EXISTS server_inbounds (
            server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
            inbound_id INTEGER NOT NULL,
            domain TEXT NOT NULL,
            sni TEXT NOT NULL,
            path TEXT NOT NULL,
            network TEXT NOT NULL DEFAULT 'ws',
            is_special_ws INTEGER NOT NULL DEFAULT 0
        );
    `);
    
    // تلاش برای اضافه کردن ستون‌ها در صورتی که جدول از قبل با ساختار قدیمی وجود داشته
    try { db.exec("ALTER TABLE server_inbounds ADD COLUMN network TEXT NOT NULL DEFAULT 'ws';"); } catch (e) {}
    try { db.exec("ALTER TABLE server_inbounds ADD COLUMN is_special_ws INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE settings ADD COLUMN admin_exempt_referral INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE user_stats ADD COLUMN referrer_id TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE user_stats ADD COLUMN has_made_first_buy INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE user_stats ADD COLUMN referral_count INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE user_stats ADD COLUMN referral_buys INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE user_stats ADD COLUMN reward_tokens INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}

    return db;
}

function rowToPlan(row) {
    const plan = {
        id: row.id,
        name: row.name,
        gb: row.gb,
        days: row.days,
        price: row.price,
        btnText: row.btn_text,
        sold: row.sold
    };
    if (row.sort_order != null) plan.order = row.sort_order;
    if (row.show_in_new != null) plan.showInNew = !!row.show_in_new;
    if (row.show_in_renew != null) plan.showInRenew = !!row.show_in_renew;
    if (row.target_user_id != null) plan.targetUserId = row.target_user_id;
    return plan;
}

function rowToServer(row) {
    const server = {
        id: row.id,
        name: row.name,
        panelUrl: row.panel_url,
        webBasePath: row.web_base_path,
        apiToken: row.api_token,
        inboundId: row.inbound_id,
        domain: row.domain,
        sni: row.sni,
        path: row.path
    };
    if (row.is_migrating) server.isMigrating = true;
    return server;
}

function rowToService(row) {
    const service = {
        email: row.email,
        uuid: row.uuid,
        name: row.name
    };
    if (row.server_id) service.serverId = row.server_id;
    if (row.order_id) service.orderId = row.order_id;
    if (row.is_vip) service.isVip = true;
    if (row.deleted_from_panel) service.deletedFromPanel = true;

    if (row.notified_days3 != null || row.notified_gb85 != null || row.notified_gb1 != null) {
        service.notified = {
            days3: !!row.notified_days3,
            gb85: !!row.notified_gb85,
            gb1: !!row.notified_gb1
        };
    }

    if (row.panel_total != null || row.panel_used != null || row.panel_expiry != null || row.panel_email) {
        service.panelStats = {
            total: row.panel_total,
            used: row.panel_used,
            expiry: row.panel_expiry,
            email: row.panel_email
        };
    }

    return service;
}

function loadState(db) {
    const global = db.prepare('SELECT * FROM global_stats WHERE id = 1').get();
    const settingsRow = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const plans = db.prepare('SELECT * FROM plans ORDER BY sort_order ASC, id ASC').all().map(rowToPlan);
    const servers = db.prepare('SELECT * FROM servers ORDER BY id ASC').all().map(rowToServer);
    
    // خواندن اینباندها از دیتابیس
    const inboundsRows = db.prepare('SELECT * FROM server_inbounds').all();
    
    servers.forEach(srv => {
        srv.inbounds = inboundsRows
            .filter(row => row.server_id === srv.id)
            .map(row => ({
                id: row.inbound_id,
                domain: row.domain,
                sni: row.sni,
                path: row.path,
                network: row.network,
                isSpecialWs: !!row.is_special_ws
            }));

        // انتقال اتوماتیک اینباند قدیمی به ساختار جدید
        if (srv.inbounds.length === 0 && srv.domain && srv.sni) {
            srv.inbounds.push({
                id: srv.inboundId || 1,
                domain: srv.domain,
                sni: srv.sni,
                path: srv.path || '',
                network: 'xhttp',
                isSpecialWs: false
            });
        }
    });
    
    const admins = db.prepare('SELECT * FROM admins ORDER BY telegram_id ASC').all()
        .map((row) => ({ id: row.telegram_id, name: row.name }));

    const users = {};
    const userRows = db.prepare('SELECT * FROM users ORDER BY telegram_id ASC').all();
    const serviceRows = db.prepare('SELECT * FROM services ORDER BY telegram_id ASC, sort_order ASC, id ASC').all();

    for (const row of serviceRows) {
        if (!users[row.telegram_id]) users[row.telegram_id] = [];
        users[row.telegram_id].push(rowToService(row));
    }

    const userStats = {};
    for (const row of db.prepare('SELECT * FROM user_stats ORDER BY telegram_id ASC').all()) {
        userStats[row.telegram_id] = {
            totalSpent: row.total_spent,
            buyCount: row.buy_count,
            renewCount: row.renew_count,
            referrerId: row.referrer_id || null,
            hasMadeFirstBuy: !!row.has_made_first_buy,
            referralCount: row.referral_count || 0,
            referralBuys: row.referral_buys || 0,
            rewardTokens: row.reward_tokens || 0
        };
    }

    const testUsers = userRows.filter((row) => row.has_used_test).map((row) => Number(row.telegram_id));
    const vipUsers = userRows.filter((row) => row.is_vip).map((row) => row.telegram_id);
    const bannedUsers = userRows.filter((row) => row.is_banned).map((row) => row.telegram_id);

    const payments = {};
    for (const row of db.prepare('SELECT * FROM payments ORDER BY token ASC').all()) {
        payments[row.token] = {
            userId: row.user_id,
            planId: row.plan_id,
            configName: row.config_name || undefined, // این خط اضافه شد
            email: row.email || undefined,
            orderId: row.order_id || undefined,
            type: row.type
        };
    }

    const settlements = db.prepare('SELECT * FROM settlements ORDER BY id ASC').all().map(row => ({
        id: row.id,
        date: row.date,
        income: row.income,
        expense: row.expense,
        netProfit: row.net_profit,
        partnerShare: row.partner_share
    }));

    return {
        periodIncome: global?.period_income || 0,
        periodExpenses: global?.period_expenses || 0,
        settlements: settlements,
        totalIncome: global?.total_income || 0,
        successfulSales: global?.successful_sales || 0,
        settings: {
            salesOpen: !!settingsRow?.sales_open,
            maintenance: !!settingsRow?.maintenance,
            activeServerId: settingsRow?.active_server_id || undefined,
            activeVipServerId: settingsRow?.active_vip_server_id || undefined,
            adminExemptReferral: !!settingsRow?.admin_exempt_referral,
            plans
        },
        testUsers,
        vipUsers,
        bannedUsers,
        users,
        userStats,
        payments,
        admins,
        servers,
        stats: {
            abandonedCarts: global?.abandoned_carts || 0,
            testToBuyConversion: global?.test_to_buy_conversion || 0
        }
    };
}

function saveState(db, data) {
    db.exec('BEGIN');

    try {
        db.prepare(`
            UPDATE settings SET
                sales_open = ?,
                maintenance = ?,
                active_server_id = ?,
                active_vip_server_id = ?,
                admin_exempt_referral = ?
            WHERE id = 1
        `).run(
            data.settings?.salesOpen ? 1 : 0,
            data.settings?.maintenance ? 1 : 0,
            data.settings?.activeServerId || null,
            data.settings?.activeVipServerId || null,
            data.settings?.adminExemptReferral ? 1 : 0
        );

        db.prepare(`
            UPDATE settings SET
                sales_open = ?,
                maintenance = ?,
                active_server_id = ?,
                active_vip_server_id = ?
            WHERE id = 1
        `).run(
            data.settings?.salesOpen ? 1 : 0,
            data.settings?.maintenance ? 1 : 0,
            data.settings?.activeServerId || null,
            data.settings?.activeVipServerId || null
        );

        db.prepare('DELETE FROM payments').run();
        db.prepare('DELETE FROM services').run();
        db.prepare('DELETE FROM user_stats').run();
        db.prepare('DELETE FROM users').run();
        db.prepare('DELETE FROM admins').run();
        db.prepare('DELETE FROM servers').run();
        db.prepare('DELETE FROM server_inbounds').run();
        db.prepare('DELETE FROM plans').run();
        db.prepare('DELETE FROM settlements').run();

        const insertPlan = db.prepare(`
            INSERT INTO plans (
                id, name, gb, days, price, btn_text, sold,
                sort_order, show_in_new, show_in_renew, target_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        (data.settings?.plans || []).forEach((plan, index) => {
            insertPlan.run(
                plan.id,
                plan.name,
                plan.gb,
                plan.days,
                plan.price,
                plan.btnText,
                plan.sold || 0,
                plan.order ?? index + 1,
                plan.showInNew == null ? null : (plan.showInNew ? 1 : 0),
                plan.showInRenew == null ? null : (plan.showInRenew ? 1 : 0),
                plan.targetUserId ?? null
            );
        });

        const insertServer = db.prepare(`
            INSERT INTO servers (
                id, name, panel_url, web_base_path, api_token, inbound_id,
                domain, sni, path, is_migrating
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // کد قبلی را با این جایگزین کنید (اضافه شدن network)
        const insertInbound = db.prepare(`
        INSERT INTO server_inbounds (server_id, inbound_id, domain, sni, path, network, is_special_ws)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const server of data.servers || []) {
            insertServer.run(
                server.id,
                server.name,
                server.panelUrl,
                server.webBasePath ?? '',
                server.apiToken,
                server.inboundId ?? 1,
                server.domain || '',
                server.sni || '',
                server.path || '',
                server.isMigrating ? 1 : 0
            );
            
            // ذخیره لیست اینباندهای هر سرور همراه با فیلد شبکه
            for (const inb of server.inbounds || []) {
                insertInbound.run(server.id, inb.id, inb.domain, inb.sni, inb.path, inb.network || 'xhttp', inb.isSpecialWs ? 1 : 0);
            }
        }

        const insertAdmin = db.prepare('INSERT INTO admins (telegram_id, name) VALUES (?, ?)');
        for (const admin of data.admins || []) {
            insertAdmin.run(String(admin.id), admin.name);
        }

        const testSet = new Set((data.testUsers || []).map(String));
        const vipSet = new Set((data.vipUsers || []).map(String));
        const bannedSet = new Set((data.bannedUsers || []).map(String));
        const allUserIds = new Set([
            ...Object.keys(data.users || {}),
            ...Object.keys(data.userStats || {}),
            ...testSet,
            ...vipSet,
            ...bannedSet
        ]);

        const insertUser = db.prepare(`
            INSERT INTO users (telegram_id, has_used_test, is_vip, is_banned)
            VALUES (?, ?, ?, ?)
        `);
        const insertUserStats = db.prepare(`
            INSERT INTO user_stats (
                telegram_id, total_spent, buy_count, renew_count,
                referrer_id, has_made_first_buy, referral_count, referral_buys, reward_tokens
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertService = db.prepare(`
            INSERT INTO services (
                telegram_id, sort_order, email, uuid, name, server_id, order_id, is_vip,
                deleted_from_panel, notified_days3, notified_gb85, notified_gb1,
                panel_total, panel_used, panel_expiry, panel_email
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const telegramId of allUserIds) {
            insertUser.run(
                telegramId,
                testSet.has(telegramId) ? 1 : 0,
                vipSet.has(telegramId) ? 1 : 0,
                bannedSet.has(telegramId) ? 1 : 0
            );

            const stats = data.userStats?.[telegramId] || { totalSpent: 0, buyCount: 0, renewCount: 0 };
            insertUserStats.run(
                telegramId,
                stats.totalSpent || 0,
                stats.buyCount || 0,
                stats.renewCount || 0,
                stats.referrerId || null,
                stats.hasMadeFirstBuy ? 1 : 0,
                stats.referralCount || 0,
                stats.referralBuys || 0,
                stats.rewardTokens || 0
            );

            const services = data.users?.[telegramId] || [];
            services.forEach((service, index) => {
                insertService.run(
                    telegramId,
                    index,
                    service.email,
                    service.uuid,
                    service.name,
                    service.serverId || null,
                    service.orderId || null,
                    service.isVip ? 1 : 0,
                    service.deletedFromPanel ? 1 : 0,
                    service.notified?.days3 ? 1 : 0,
                    service.notified?.gb85 ? 1 : 0,
                    service.notified?.gb1 ? 1 : 0,
                    service.panelStats?.total ?? null,
                    service.panelStats?.used ?? null,
                    service.panelStats?.expiry ?? null,
                    service.panelStats?.email ?? null
                );
            });
        }

        const insertPayment = db.prepare(`
            INSERT INTO payments (token, user_id, plan_id, config_name, email, order_id, type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const [token, payment] of Object.entries(data.payments || {})) {
            insertPayment.run(
                token,
                payment.userId,
                payment.planId,
                payment.configName || null, // این خط اضافه شد
                payment.email || null,
                payment.orderId || null,
                payment.type
            );
        }

        const insertSettlement = db.prepare(`
            INSERT INTO settlements (id, date, income, expense, net_profit, partner_share)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const s of data.settlements || []) {
            insertSettlement.run(s.id, s.date, s.income, s.expense, s.netProfit, s.partnerShare);
        }
        
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

function importFromJson(db, jsonPath) {
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    saveState(db, payload);
    return payload;
}

module.exports = { openDatabase, loadState, saveState, importFromJson };
