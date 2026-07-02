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
        ]
    }
};

let sqliteDb = null;

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
            data.userStats[userId] = { totalSpent: 0, renewCount: 0, buyCount: 0 };
            needsUpdate = true;
        }

        if (data.users[userId] && !Array.isArray(data.users[userId])) {
            data.users[userId] = [
                { email: data.users[userId].email, uuid: data.users[userId].uuid, name: 'سرویس قبلی' }
            ];
            needsUpdate = true;
        }
    }

    return { data, needsUpdate };
}

function readDb() {
    if (isSqlitePath(process.env.DB_PATH)) {
        const data = loadState(getSqliteDb());
        const { data: normalized, needsUpdate } = normalizeDb(data);
        if (needsUpdate) saveState(getSqliteDb(), normalized);
        return normalized;
    }

    const dbPath = getJsonPath();
    if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2));
        return defaultDb;
    }

    let data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const { data: normalized, needsUpdate } = normalizeDb(data);
    if (needsUpdate) writeDb(normalized);
    return normalized;
}

function writeDb(data) {
    if (isSqlitePath(process.env.DB_PATH)) {
        saveState(getSqliteDb(), data);
        return;
    }

    fs.writeFileSync(getJsonPath(), JSON.stringify(data, null, 2));
}

module.exports = { readDb, writeDb };
