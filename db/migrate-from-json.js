#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { openDatabase, importFromJson, loadState } = require('./sqlite-store');

const jsonPath = process.argv[2]
    || process.env.MIGRATE_SOURCE
    || (process.env.DB_PATH && !process.env.DB_PATH.endsWith('.db') ? process.env.DB_PATH : null)
    || path.join(__dirname, '..', 'db.staging.json');

const dbPath = process.argv[3]
    || process.env.MIGRATE_TARGET
    || (process.env.DB_PATH && process.env.DB_PATH.endsWith('.db') ? process.env.DB_PATH : null)
    || path.join(__dirname, '..', 'telbot.db');

console.log(`Migrating ${jsonPath} -> ${dbPath}`);

const db = openDatabase(path.resolve(dbPath));
const imported = importFromJson(db, path.resolve(jsonPath));
const loaded = loadState(db);

console.log('Migration complete.');
console.log(`Users: ${Object.keys(loaded.users || {}).length}`);
console.log(`Services: ${Object.values(loaded.users || {}).reduce((sum, list) => sum + list.length, 0)}`);
console.log(`Plans: ${(loaded.settings?.plans || []).length}`);
console.log(`Servers: ${(loaded.servers || []).length}`);
console.log(`Total income: ${loaded.totalIncome}`);

db.close();
