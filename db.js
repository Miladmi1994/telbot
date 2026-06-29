const fs = require('fs');
const path = require('path');
const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, 'db.json');

const defaultDb = { 
    totalIncome: 0,
    successfulSales: 0,
    testUsers: [],
    bannedUsers: [],
    users: {},
    userStats: {}, // ╪░╪«█î╪▒┘ç ╪»╪º╪ª┘à█î ╪│┘ê╪º╪¿┘é ┘ç╪▒ ┌⌐╪º╪▒╪¿╪▒ (╪º╪▒╪▓╪┤ ╪╖┘ê┘ä ╪╣┘à╪▒)
    stats: {
        abandonedCarts: 0,     // ╪│╪¿╪»┘ç╪º█î ╪▒┘ç╪º ╪┤╪»┘ç
        testToBuyConversion: 0 // ╪¬╪¿╪»█î┘ä ╪¬╪│╪¬ ╪¿┘ç ╪«╪▒█î╪»
    },
    settings: { 
        salesOpen: true, 
        maintenance: false,
        plans: [
            { id: '30', name: '30 ┌»█î┌» █î┌⌐ ┘à╪º┘ç┘ç', gb: 30, days: 30, price: 180000, btnText: '≡ƒôª 30 ┌»█î┌» - 1 ┘à╪º┘ç┘ç (180,000 ╪¬┘ê┘à╪º┘å)', sold: 0 },
            { id: '50', name: '50 ┌»█î┌» █î┌⌐ ┘à╪º┘ç┘ç', gb: 50, days: 30, price: 275000, btnText: '≡ƒôª 50 ┌»█î┌» - 1 ┘à╪º┘ç┘ç (275,000 ╪¬┘ê┘à╪º┘å)', sold: 0 },
            { id: '100', name: '100 ┌»█î┌» ╪»┘ê ┘à╪º┘ç┘ç', gb: 100, days: 60, price: 500000, btnText: '≡ƒôª 100 ┌»█î┌» - 2 ┘à╪º┘ç┘ç (500,000 ╪¬┘ê┘à╪º┘å)', sold: 0 }
        ]
    }
};

function readDb() {
    if (!fs.existsSync(dbPath)) { 
        fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2)); 
        return defaultDb; 
    }
    
    let data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    let needsUpdate = false;

    if (!data.settings) { data.settings = { salesOpen: true, maintenance: false }; needsUpdate = true; }
    if (!data.settings.plans) { data.settings.plans = defaultDb.settings.plans; needsUpdate = true; }
    
    // ╪ó┘╛╪»█î╪¬ ┘╛┌⌐█î╪¼ΓÇî┘ç╪º█î ┘é╪»█î┘à█î
    data.settings.plans.forEach(plan => {
        if (plan.sold === undefined) { plan.sold = 0; needsUpdate = true; }
    });

    if (!data.testUsers) { data.testUsers = []; needsUpdate = true; }
    if (!data.users) { data.users = {}; needsUpdate = true; }
    if (!data.userStats) { data.userStats = {}; needsUpdate = true; }
    if (!data.stats) { data.stats = { abandonedCarts: 0, testToBuyConversion: 0 }; needsUpdate = true; }
    if (data.settings && data.settings.usdRate) { delete data.settings.usdRate; needsUpdate = true; }
    
    // ╪ó┘╛╪»█î╪¬ ┌⌐╪º╪▒╪¿╪▒╪º┘å ┘é╪»█î┘à█î ┘ê ╪│╪º╪«╪¬ ┘╛╪▒┘ê┘ü╪º█î┘ä ╪ó┘à╪º╪▒█î ╪¿╪▒╪º╪┤┘ê┘å
    for (const userId in data.users) {
        if (!data.userStats[userId]) {
            data.userStats[userId] = { totalSpent: 0, renewCount: 0, buyCount: 0 };
            needsUpdate = true;
        }

        if (data.users[userId] && !Array.isArray(data.users[userId])) {
            data.users[userId] = [
                { email: data.users[userId].email, uuid: data.users[userId].uuid, name: '╪│╪▒┘ê█î╪│ ┘é╪¿┘ä█î' }
            ];
            needsUpdate = true;
        }
    }
    
    if (needsUpdate) writeDb(data);
    return data;
}

function writeDb(data) { 
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); 
}

module.exports = { readDb, writeDb };
