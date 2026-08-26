const fs = require('fs');
const path = require('path');
const { openDatabase, loadState, saveState } = require('./db/sqlite-store');

const defaultDb = {
    totalIncome: 0,
    successfulSales: 0,
    testUsers: [],
    bannedUsers: [],
    vipUsers: [],
    users: {},
    userStats: {},
    payments: {},
    admins: [],
    servers: [],
    stats: {
        abandonedCarts: 0,
        testToBuyConversion: 0
    },
    settings: {
        salesOpen: true,
        maintenance: false,
        plans: [
            { id: '30', name: '30 گیگ یک ماهه', gb: 30, days: 30, price: 180000, btnText: '📦 30 گیگ - 1 ماهه (180,000 تومان)', sold: 0 },
            { id: '50', name: '50 گیگ یک ماهه', gb: 50, days: 30, price: 275000, btnText: '📦 50 گیگ - 1 ماهه (275,000 تومان)', sold: 0 },
            { id: '100', name: '100 گیگ دو ماهه', gb: 100, days: 60, price: 500000, btnText: '📦 100 گیگ - 2 ماهه (500,000 تومان)', sold: 0 }
        ],
        adminExemptReferral: false
    }
};

let sqliteDb = null;
let memoryCache = null;
let dbRevision = 0;
const REV = Symbol('dbRevision');

function isSqlitePath(value) {
    return typeof value === 'string' && (value.endsWith('.db') || value.endsWith('.sqlite'));
}

function getJsonPath() {
    return process.env.DB_PATH
        ? path.resolve(process.env.DB_PATH)
        : path.join(__dirname, 'db.json');
}

function getSqlitePath() {
    return path.resolve(process.env.DB_PATH || path.join(__dirname, 'telbot.db'));
}

function getSqliteDb() {
    if (!sqliteDb) {
        sqliteDb = openDatabase(getSqlitePath());
    }
    return sqliteDb;
}

function cloneDb(data) {
    return JSON.parse(JSON.stringify(data));
}

function normalizeDb(data) {
    let needsUpdate = false;

    if (!data.settings) { data.settings = { salesOpen: true, maintenance: false }; needsUpdate = true; }
    if (!data.settings.plans) { data.settings.plans = defaultDb.settings.plans; needsUpdate = true; }

    data.settings.plans.forEach((plan) => {
        if (plan.sold === undefined) { plan.sold = 0; needsUpdate = true; }
    });

    if (!data.testUsers) { data.testUsers = []; needsUpdate = true; }
    if (!data.vipUsers) { data.vipUsers = []; needsUpdate = true; }
    if (!data.bannedUsers) { data.bannedUsers = []; needsUpdate = true; }
    if (!data.users) { data.users = {}; needsUpdate = true; }
    if (!data.userStats) { data.userStats = {}; needsUpdate = true; }
    if (!data.payments) { data.payments = {}; needsUpdate = true; }
    if (!data.admins) { data.admins = []; needsUpdate = true; }
    if (!data.servers) { data.servers = []; needsUpdate = true; }
    if (!data.stats) { data.stats = { abandonedCarts: 0, testToBuyConversion: 0 }; needsUpdate = true; }
    if (data.settings && data.settings.usdRate) { delete data.settings.usdRate; needsUpdate = true; }

    for (const userId in data.users) {
        if (!data.userStats[userId]) {
            data.userStats[userId] = { 
                totalSpent: 0, renewCount: 0, buyCount: 0,
                referralCount: 0, referralBuys: 0, rewardTokens: 0, 
                hasMadeFirstBuy: false, referrerId: null 
            };
            needsUpdate = true;
        } else if (data.userStats[userId].referralCount === undefined) {
            data.userStats[userId].referralCount = 0;
            data.userStats[userId].referralBuys = 0;
            data.userStats[userId].rewardTokens = 0;
            data.userStats[userId].hasMadeFirstBuy = false;
            data.userStats[userId].referrerId = null;
            needsUpdate = true;
        }
    }

    return { data, needsUpdate };
}

function persistNow(data) {
    if (isSqlitePath(process.env.DB_PATH)) {
        saveState(getSqliteDb(), data);
    } else {
        fs.writeFileSync(getJsonPath(), JSON.stringify(data, null, 2));
    }
}

/**
 * Stale snapshot write (e.g. long volume job) must not wipe newer purchases.
 * Upsert services by email; never drop users/services absent from the incoming snapshot.
 */
function mergeStaleIntoCache(incoming) {
    if (!memoryCache.users) memoryCache.users = {};
    if (!memoryCache.userStats) memoryCache.userStats = {};
    if (!memoryCache.payments) memoryCache.payments = {};

    for (const [userId, services] of Object.entries(incoming.users || {})) {
        if (!Array.isArray(services)) continue;
        if (!memoryCache.users[userId]) memoryCache.users[userId] = [];

        for (const svc of services) {
            if (!svc || !svc.email) continue;
            const list = memoryCache.users[userId];
            const idx = list.findIndex((s) => s.email === svc.email);
            if (idx >= 0) list[idx] = svc;
            else list.push(svc);
        }

        if (incoming.userStats?.[userId]) {
            memoryCache.userStats[userId] = incoming.userStats[userId];
        }
    }

    // Safe list merges: union, never shrink from a stale snapshot
    for (const key of ['testUsers', 'vipUsers', 'bannedUsers']) {
        if (!Array.isArray(incoming[key])) continue;
        const set = new Set([...(memoryCache[key] || []), ...incoming[key]].map(String));
        memoryCache[key] = Array.from(set);
    }

    if (incoming.settings) memoryCache.settings = incoming.settings;
    if (incoming.servers) memoryCache.servers = incoming.servers;
    if (incoming.admins) memoryCache.admins = incoming.admins;
    if (incoming.stats) memoryCache.stats = incoming.stats;

    // Prefer newer totals when incoming looks like an in-place update of known keys
    for (const key of ['totalIncome', 'successfulSales', 'periodIncome', 'periodExpenses']) {
        if (incoming[key] !== undefined) memoryCache[key] = incoming[key];
    }

    // Payments: apply incoming tokens; keep tokens that exist only in cache
    // (stale job snapshots shouldn't resurrect deleted payments, but also shouldn't
    // wipe payments created after the snapshot was taken)
    for (const [token, payment] of Object.entries(incoming.payments || {})) {
        memoryCache.payments[token] = payment;
    }
}

function ensureLoaded() {
    if (memoryCache) return;

    let rawData;
    if (isSqlitePath(process.env.DB_PATH)) {
        rawData = loadState(getSqliteDb());
    } else {
        const dbPath = getJsonPath();
        if (!fs.existsSync(dbPath)) {
            fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2));
            rawData = defaultDb;
        } else {
            rawData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        }
    }

    const { data: normalized, needsUpdate } = normalizeDb(rawData);
    memoryCache = normalized;
    dbRevision = 1;

    if (needsUpdate) {
        persistNow(memoryCache);
    }
}

function readDb() {
    ensureLoaded();
    const data = cloneDb(memoryCache);
    Object.defineProperty(data, REV, { value: dbRevision, enumerable: false, configurable: true });
    return data;
}

function writeDb(data) {
    ensureLoaded();

    const incomingRev = data[REV];
    const isStale = incomingRev !== undefined && incomingRev !== dbRevision;

    if (isStale) {
        console.warn(`[db] stale writeDb ignored (full replace) — merging users/services instead (rev ${incomingRev} → ${dbRevision})`);
        mergeStaleIntoCache(data);
    } else {
        memoryCache = cloneDb(data);
    }

    dbRevision += 1;
    persistNow(memoryCache);
}

function flushDb() {
    if (!memoryCache) return;
    persistNow(memoryCache);
}

module.exports = { readDb, writeDb, flushDb };
