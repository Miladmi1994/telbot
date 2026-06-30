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
    const dbPath = process.env.DB_PATH
        ? path.resolve(ROOT, process.env.DB_PATH)
        : path.join(ROOT, 'db.json');

    if (!fs.existsSync(dbPath)) {
        throw new Error(`Database not found: ${dbPath}`);
    }

    return dbPath;
}

async function createBackup(dbPath) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.basename(dbPath, path.extname(dbPath));
    const ext = path.extname(dbPath) || '.db';
    const rawBackup = path.join(BACKUP_DIR, `${base}-${stamp}${ext}`);

    if (dbPath.endsWith('.db') || dbPath.endsWith('.sqlite')) {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(dbPath);
        const escaped = rawBackup.replace(/'/g, "''");
        db.exec(`VACUUM INTO '${escaped}'`);
        db.close();
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

async function sendToAdmin(filePath, caption) {
    const agent = process.env.PROXY_URL
        ? new HttpsProxyAgent(process.env.PROXY_URL)
        : undefined;
    const bot = new Telegraf(
        process.env.BOT_TOKEN,
        agent ? { telegram: { agent } } : undefined
    );

    await bot.telegram.sendDocument(
        process.env.ADMIN_ID,
        { source: filePath },
        { caption }
    );
}

async function main() {
    if (!process.env.BOT_TOKEN || !process.env.ADMIN_ID) {
        throw new Error('BOT_TOKEN and ADMIN_ID must be set in .env');
    }

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

    await sendToAdmin(backupFile, caption);
    pruneOldBackups();

    console.log(`Backup saved and sent to admin ${process.env.ADMIN_ID}: ${backupFile}`);
}

main().catch((err) => {
    console.error('Backup failed:', err.message);
    process.exit(1);
});
