/**
 * Sync panel client exports into telbot SQLite.
 * Only auto-links emails matching: User_{telegramId}_Ord{orderId}_{timestamp}
 *
 * Matching order:
 *   1) existing row with same email
 *   2) existing row with same uuid  → update email, KEEP name
 *   3) otherwise insert (new uuid only)
 *
 * Usage:
 *   node scripts/sync-panel-clients.js --db ./telbot.db \
 *     --normal ./clients-export-normal.json \
 *     --vip ./clients-export-vip.json \
 *     [--apply]
 *
 * Without --apply: dry-run (report only).
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const USER_EMAIL_RE = /^User_(\d+)_Ord(\d+)_(\d+)$/;

function parseArgs(argv) {
    const out = { apply: false, db: null, normal: null, vip: null };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--apply') out.apply = true;
        else if (a === '--db') out.db = argv[++i];
        else if (a === '--normal') out.normal = argv[++i];
        else if (a === '--vip') out.vip = argv[++i];
    }
    return out;
}

function loadExport(filePath, source) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(raw)) throw new Error(`Export is not an array: ${filePath}`);
    return raw.map((row) => {
        const c = row.client || row;
        return {
            source,
            email: c.email,
            uuid: c.id,
            enable: !!c.enable,
            totalGB: c.totalGB ?? null,
            expiryTime: c.expiryTime ?? null
        };
    }).filter((c) => c.email && c.uuid);
}

function parseUserEmail(email) {
    const m = String(email).match(USER_EMAIL_RE);
    if (!m) return null;
    return { telegramId: m[1], orderId: m[2], createdTs: m[3] };
}

function main() {
    const args = parseArgs(process.argv);
    if (!args.db || !args.normal || !args.vip) {
        console.error('Required: --db <path> --normal <json> --vip <json> [--apply]');
        process.exit(1);
    }

    const dbPath = path.resolve(args.db);
    const normalClients = loadExport(path.resolve(args.normal), 'normal');
    const vipClients = loadExport(path.resolve(args.vip), 'vip');
    const all = [...normalClients, ...vipClients];

    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON');

    const settings = db.prepare('SELECT active_server_id, active_vip_server_id FROM settings WHERE id = 1').get();
    const normalServerId = settings?.active_server_id || 'srv_363974';
    const vipServerId = settings?.active_vip_server_id || 'srv_364212';

    const rows = db.prepare(
        'SELECT id, telegram_id, email, uuid, server_id, deleted_from_panel, name, order_id FROM services'
    ).all();

    const existingByEmail = new Map(rows.map((r) => [r.email, r]));
    const existingByUuid = new Map(rows.map((r) => [r.uuid, r]));

    const report = {
        mode: args.apply ? 'APPLY' : 'DRY_RUN',
        skippedNonUserEmail: [],
        inserted: [],
        undeleted: [],
        relinkedByUuid: [],
        alreadyOk: [],
        uuidUpdated: [],
        errors: []
    };

    const ensureUser = db.prepare(`
        INSERT OR IGNORE INTO users (telegram_id, has_used_test, is_vip, is_banned)
        VALUES (?, 0, ?, 0)
    `);
    const ensureStats = db.prepare(`
        INSERT OR IGNORE INTO user_stats (telegram_id, total_spent, buy_count, renew_count)
        VALUES (?, 0, 0, 0)
    `);
    const nextSort = db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM services WHERE telegram_id = ?
    `);
    const insertService = db.prepare(`
        INSERT INTO services (
            telegram_id, sort_order, email, uuid, name, server_id, order_id, is_vip,
            deleted_from_panel, notified_days3, notified_gb85, notified_gb1,
            panel_total, panel_used, panel_expiry, panel_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, 0, ?, ?)
    `);
    // Keep name — only revive / refresh panel fields
    const undeleteByEmail = db.prepare(`
        UPDATE services
        SET deleted_from_panel = 0,
            uuid = ?,
            server_id = ?,
            order_id = COALESCE(?, order_id),
            panel_total = ?,
            panel_expiry = ?,
            panel_email = ?,
            is_vip = CASE WHEN ? = 1 THEN 1 ELSE is_vip END
        WHERE email = ?
    `);
    // Same uuid, new panel email (renew) — keep name
    const relinkByUuid = db.prepare(`
        UPDATE services
        SET email = ?,
            order_id = ?,
            deleted_from_panel = 0,
            server_id = ?,
            panel_total = ?,
            panel_expiry = ?,
            panel_email = ?,
            is_vip = CASE WHEN ? = 1 THEN 1 ELSE is_vip END
        WHERE id = ?
    `);
    const updateActiveByEmail = db.prepare(`
        UPDATE services
        SET uuid = ?, server_id = ?, panel_total = ?, panel_expiry = ?, panel_email = ?,
            order_id = COALESCE(?, order_id)
        WHERE email = ? AND deleted_from_panel = 0
    `);

    const cypherCountStmt = db.prepare(`
        SELECT COUNT(*) AS c FROM services
        WHERE telegram_id = ? AND name LIKE 'سایفر%'
    `);

    if (args.apply) db.exec('BEGIN');
    try {
        for (const client of all) {
            const parsed = parseUserEmail(client.email);
            if (!parsed) {
                report.skippedNonUserEmail.push({ source: client.source, email: client.email });
                continue;
            }

            const isVip = client.source === 'vip';
            const serverId = isVip ? vipServerId : normalServerId;
            const { telegramId, orderId } = parsed;
            const byEmail = existingByEmail.get(client.email);
            const byUuid = existingByUuid.get(client.uuid);

            // 1) Exact email match
            if (byEmail) {
                if (byEmail.deleted_from_panel === 1) {
                    if (args.apply) {
                        undeleteByEmail.run(
                            client.uuid,
                            serverId,
                            orderId,
                            client.totalGB,
                            client.expiryTime,
                            client.email,
                            isVip ? 1 : 0,
                            client.email
                        );
                    }
                    report.undeleted.push({
                        email: client.email,
                        telegramId: byEmail.telegram_id,
                        name: byEmail.name,
                        serverId
                    });
                    byEmail.deleted_from_panel = 0;
                    byEmail.uuid = client.uuid;
                    existingByUuid.set(client.uuid, byEmail);
                } else if (byEmail.uuid !== client.uuid || byEmail.server_id !== serverId) {
                    if (args.apply) {
                        updateActiveByEmail.run(
                            client.uuid,
                            serverId,
                            client.totalGB,
                            client.expiryTime,
                            client.email,
                            orderId,
                            client.email
                        );
                    }
                    report.uuidUpdated.push({
                        email: client.email,
                        name: byEmail.name,
                        oldUuid: byEmail.uuid,
                        newUuid: client.uuid
                    });
                    existingByUuid.delete(byEmail.uuid);
                    byEmail.uuid = client.uuid;
                    existingByUuid.set(client.uuid, byEmail);
                } else {
                    report.alreadyOk.push({ email: client.email, name: byEmail.name });
                }
                continue;
            }

            // 2) Same uuid, different email (renew / email rewrite) — KEEP name
            if (byUuid) {
                const oldEmail = byUuid.email;
                if (args.apply) {
                    ensureUser.run(byUuid.telegram_id || telegramId, isVip ? 1 : 0);
                    ensureStats.run(byUuid.telegram_id || telegramId);
                    if (isVip) {
                        db.prepare('UPDATE users SET is_vip = 1 WHERE telegram_id = ?')
                            .run(byUuid.telegram_id || telegramId);
                    }
                    relinkByUuid.run(
                        client.email,
                        orderId,
                        serverId,
                        client.totalGB,
                        client.expiryTime,
                        client.email,
                        isVip ? 1 : 0,
                        byUuid.id
                    );
                }
                report.relinkedByUuid.push({
                    oldEmail,
                    newEmail: client.email,
                    uuid: client.uuid,
                    name: byUuid.name,
                    telegramId: byUuid.telegram_id
                });
                existingByEmail.delete(oldEmail);
                byUuid.email = client.email;
                byUuid.deleted_from_panel = 0;
                byUuid.uuid = client.uuid;
                existingByEmail.set(client.email, byUuid);
                existingByUuid.set(client.uuid, byUuid);
                continue;
            }

            // 3) Truly new — insert with generated placeholder name
            const count = cypherCountStmt.get(telegramId)?.c || 0;
            const name = `سایفر ${count + 1} 🇳🇱`.trim();
            const action = {
                email: client.email,
                telegramId,
                orderId,
                serverId,
                isVip,
                name,
                uuid: client.uuid,
                enable: client.enable
            };

            if (args.apply) {
                ensureUser.run(telegramId, isVip ? 1 : 0);
                ensureStats.run(telegramId);
                if (isVip) {
                    db.prepare('UPDATE users SET is_vip = 1 WHERE telegram_id = ?').run(telegramId);
                }
                const sortOrder = nextSort.get(telegramId).n;
                insertService.run(
                    telegramId,
                    sortOrder,
                    client.email,
                    client.uuid,
                    name,
                    serverId,
                    orderId,
                    isVip ? 1 : 0,
                    client.totalGB,
                    client.expiryTime,
                    client.email
                );
                const inserted = {
                    id: Number(db.prepare('SELECT last_insert_rowid() AS id').get().id),
                    telegram_id: telegramId,
                    email: client.email,
                    uuid: client.uuid,
                    server_id: serverId,
                    deleted_from_panel: 0,
                    name,
                    order_id: orderId
                };
                existingByEmail.set(client.email, inserted);
                existingByUuid.set(client.uuid, inserted);
            }
            report.inserted.push(action);
        }
        if (args.apply) db.exec('COMMIT');
    } catch (err) {
        if (args.apply) {
            try { db.exec('ROLLBACK'); } catch (_) {}
        }
        throw err;
    }

    console.log(JSON.stringify({
        dbPath,
        mode: report.mode,
        servers: { normalServerId, vipServerId },
        summary: {
            inserted: report.inserted.length,
            undeleted: report.undeleted.length,
            relinkedByUuid: report.relinkedByUuid.length,
            uuidUpdated: report.uuidUpdated.length,
            alreadyOk: report.alreadyOk.length,
            skippedNonUserEmail: report.skippedNonUserEmail.length
        },
        inserted: report.inserted,
        undeleted: report.undeleted,
        relinkedByUuid: report.relinkedByUuid,
        uuidUpdated: report.uuidUpdated,
        skippedNonUserEmail: report.skippedNonUserEmail
    }, null, 2));

    if (!args.apply) {
        console.error('\nDry-run only. Re-run with --apply to write changes.');
    }
}

main();
