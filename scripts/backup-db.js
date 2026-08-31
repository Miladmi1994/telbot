const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { createReadStream, createWriteStream } = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Telegraf } = require('telegraf');
const { HttpsProxyAgent } = require('https-proxy-agent');

const ROOT = path.join(__dirname, '..');
const BACKUP_DIR = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(ROOT, 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);

async function gzipFile(sourcePath, destPath) {
    await pipeline(
        createReadStream(sourcePath),
        zlib.createGzip(),
        createWriteStream(destPath)
    );
}

function resolveDbPath() {
    if (process.env.DB_PATH) {
        const dbPath = path.resolve(ROOT, process.env.DB_PATH);
        if (!fs.existsSync(dbPath)) {
            throw new Error(`Database not found: ${dbPath}`);
        }
        return dbPath;
    }

    const candidates = [
        path.join(ROOT, 'db.json'),
        path.join(ROOT, 'telbot.db')
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) {
        throw new Error(`Database not found (checked: ${candidates.join(', ')})`);
    }
    return found;
}

async function copySqliteBackup(dbPath, rawBackup) {
    try {
        const Database = require('better-sqlite3');
        // دیتابیس رو فقط برای خواندن باز می‌کنیم تا تداخلی با ربات اصلی نداشته باشه
        const db = new Database(dbPath, { readonly: true });
        
        // استفاده از متد قدرتمند بکاپ‌گیری better-sqlite3
        await db.backup(rawBackup);
        db.close();
    } catch (err) {
        console.warn(`better-sqlite3 backup failed (${err.message}); falling back to file copy`);
        if (fs.existsSync(rawBackup)) {
            try { fs.unlinkSync(rawBackup); } catch (_) {}
        }
        fs.copyFileSync(dbPath, rawBackup);
    }
}
async function createBackup(dbPath) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.basename(dbPath, path.extname(dbPath));
    const ext = path.extname(dbPath) || '.db';
    const rawBackup = path.join(BACKUP_DIR, `${base}-${stamp}${ext}`);

    if (dbPath.endsWith('.db') || dbPath.endsWith('.sqlite')) {
        await copySqliteBackup(dbPath, rawBackup);
    } else {
        fs.copyFileSync(dbPath, rawBackup);
    }

    const gzBackup = `${rawBackup}.gz`;
    await gzipFile(rawBackup, gzBackup);
    fs.unlinkSync(rawBackup);

    return gzBackup;
}

function pruneOldBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(BACKUP_DIR)) {
        const fullPath = path.join(BACKUP_DIR, file);
        if (fs.statSync(fullPath).isFile() && fs.statSync(fullPath).mtimeMs < cutoff) {
            fs.unlinkSync(fullPath);
        }
    }
}

function getAdminId() {
    return process.env.ADMIN_ID;
}

async function sendWithTelegram(telegram, filePath, caption) {
    const adminId = getAdminId();
    if (!adminId) {
        throw new Error('ADMIN_ID must be set in .env');
    }
    await telegram.sendDocument(adminId, { source: filePath }, { caption });
}

async function sendWithNewBot(filePath, caption) {
    if (!process.env.BOT_TOKEN || !process.env.ADMIN_ID) {
        throw new Error('BOT_TOKEN and ADMIN_ID must be set in .env');
    }

    const agent = process.env.PROXY_URL
        ? new HttpsProxyAgent(process.env.PROXY_URL)
        : undefined;
    const bot = new Telegraf(
        process.env.BOT_TOKEN,
        agent ? { telegram: { agent } } : undefined
    );

    await sendWithTelegram(bot.telegram, filePath, caption);
}

/**
 * Create a gzipped DB backup, send it to ADMIN_ID, and prune old local files.
 * @param {{ telegram?: import('telegraf').Telegram }} [options]
 */
async function runBackup(options = {}) {
    const dbPath = resolveDbPath();
    const backupFile = await createBackup(dbPath);
    const sizeMb = (fs.statSync(backupFile).size / (1024 * 1024)).toFixed(2);
    const label = process.env.BACKUP_LABEL || path.basename(path.dirname(dbPath));

    const caption = [
        '🗄 Database backup',
        `Server: ${label}`,
        `Source: ${path.basename(dbPath)}`,
        `File: ${path.basename(backupFile)}`,
        `Size: ${sizeMb} MB`,
        `Time: ${new Date().toISOString()}`
    ].join('\n');

    if (options.telegram) {
        await sendWithTelegram(options.telegram, backupFile, caption);
    } else {
        await sendWithNewBot(backupFile, caption);
    }

    pruneOldBackups();

    console.log(`Backup saved and sent to admin ${getAdminId()}: ${backupFile}`);
    return backupFile;
}

/**
 * Schedule a nightly backup inside the bot process (checks every minute).
 * Hour/minute use the server's local timezone. Override with BACKUP_HOUR / BACKUP_MINUTE.
 */
function scheduleNightlyBackup(bot) {
    const hour = Number(process.env.BACKUP_HOUR ?? 3);
    const minute = Number(process.env.BACKUP_MINUTE ?? 0);
    let lastRunKey = null;
    let running = false;

    const tick = async () => {
        const now = new Date();
        if (now.getHours() !== hour || now.getMinutes() !== minute) return;

        const runKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        if (lastRunKey === runKey || running) return;

        lastRunKey = runKey;
        running = true;
        try {
            await runBackup({ telegram: bot.telegram });
        } catch (err) {
            console.error('Nightly backup failed:', err.message);
            const adminId = getAdminId();
            if (adminId) {
                await bot.telegram.sendMessage(
                    adminId,
                    `⚠️ Nightly database backup failed:\n<code>${err.message}</code>`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
        } finally {
            running = false;
        }
    };

    setInterval(tick, 60 * 1000);
    console.log(`Nightly backup scheduled for ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} local time`);
}

if (require.main === module) {
    runBackup().catch((err) => {
        console.error('Backup failed:', err.message);
        process.exit(1);
    });
}

module.exports = { runBackup, scheduleNightlyBackup };
