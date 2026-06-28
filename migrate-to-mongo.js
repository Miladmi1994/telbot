require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const STATE_ID = 'main';
const dbPath = path.join(__dirname, 'db.json');

async function migrate() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI is not set in .env');
    }

    if (!fs.existsSync(dbPath)) {
        throw new Error('db.json not found');
    }

    const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const dbName = process.env.MONGODB_DB || 'telbot';

    const client = new MongoClient(uri);
    await client.connect();

    try {
        const collection = client.db(dbName).collection('state');
        const result = await collection.replaceOne(
            { _id: STATE_ID },
            { _id: STATE_ID, ...data },
            { upsert: true }
        );

        const saved = await collection.findOne({ _id: STATE_ID });
        console.log('Migration complete.');
        console.log(`Database: ${dbName}`);
        console.log(`Upserted: ${result.upsertedCount > 0}`);
        console.log(`Modified: ${result.modifiedCount > 0}`);
        console.log(`Users: ${Object.keys(saved.users || {}).length}`);
        console.log(`Test users: ${(saved.testUsers || []).length}`);
        console.log(`VIP users: ${(saved.vipUsers || []).length}`);
        console.log(`Banned users: ${(saved.bannedUsers || []).length}`);
        console.log(`Total income: ${saved.totalIncome}`);
        console.log(`Successful sales: ${saved.successfulSales}`);
    } finally {
        await client.close();
    }
}

migrate().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
