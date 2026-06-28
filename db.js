require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const STATE_ID = 'main';
const dbPath = path.join(__dirname, 'db.json');

const defaultDb = {
    totalIncome: 0,
    successfulSales: 0,
    testUsers: [],
    bannedUsers: [],
    users: {},
    userStats: {},
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

let cache = null;
let collection = null;
let client = null;
let initPromise = null;

function normalizeDb(data) {
    let needsUpdate = false;

    if (!data.settings) { data.settings = { salesOpen: true, maintenance: false }; needsUpdate = true; }
    if (!data.settings.plans) { data.settings.plans = defaultDb.settings.plans; needsUpdate = true; }

    data.settings.plans.forEach(plan => {
        if (plan.sold === undefined) { plan.sold = 0; needsUpdate = true; }
    });

    if (!data.testUsers) { data.testUsers = []; needsUpdate = true; }
    if (!data.users) { data.users = {}; needsUpdate = true; }
    if (!data.userStats) { data.userStats = {}; needsUpdate = true; }
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

async function persistDb(data) {
    await collection.replaceOne(
        { _id: STATE_ID },
        { _id: STATE_ID, ...data },
        { upsert: true }
    );
}

async function initDb() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) throw new Error('MONGODB_URI is not set in .env');

        const dbName = process.env.MONGODB_DB || 'telbot';
        client = new MongoClient(uri);
        await client.connect();
        collection = client.db(dbName).collection('state');

        let doc = await collection.findOne({ _id: STATE_ID });
        if (!doc && fs.existsSync(dbPath)) {
            doc = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        }
        if (!doc) {
            doc = { ...defaultDb };
        } else {
            delete doc._id;
        }

        const { data, needsUpdate } = normalizeDb(doc);
        cache = data;
        if (needsUpdate) await persistDb(data);

        console.log('Database connected (MongoDB)');
    })();

    return initPromise;
}

function readDb() {
    if (!cache) throw new Error('Database not initialized. Call initDb() first.');
    return cache;
}

function writeDb(data) {
    cache = data;
    persistDb(data).catch(err => console.error('Failed to write to MongoDB:', err.message));
}

module.exports = { initDb, readDb, writeDb };
