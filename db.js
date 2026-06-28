const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, 'db.json');

const defaultDb = { 
    totalIncome: 0,
    successfulSales: 0,
    testUsers: [],
    bannedUsers: [],
    users: {},
    userStats: {}, // ذخیره دائمی سوابق هر کاربر (ارزش طول عمر)
    stats: {
        abandonedCarts: 0,     // سبدهای رها شده
        testToBuyConversion: 0 // تبدیل تست به خرید
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

function readDb() {
    if (!fs.existsSync(dbPath)) { 
        fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2)); 
        return defaultDb; 
    }
    
    let data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    let needsUpdate = false;

    if (!data.settings) { data.settings = { salesOpen: true, maintenance: false }; needsUpdate = true; }
    if (!data.settings.plans) { data.settings.plans = defaultDb.settings.plans; needsUpdate = true; }
    
    // آپدیت پکیج‌های قدیمی
    data.settings.plans.forEach(plan => {
        if (plan.sold === undefined) { plan.sold = 0; needsUpdate = true; }
    });

    if (!data.testUsers) { data.testUsers = []; needsUpdate = true; }
    if (!data.users) { data.users = {}; needsUpdate = true; }
    if (!data.userStats) { data.userStats = {}; needsUpdate = true; }
    if (!data.stats) { data.stats = { abandonedCarts: 0, testToBuyConversion: 0 }; needsUpdate = true; }
    if (data.settings && data.settings.usdRate) { delete data.settings.usdRate; needsUpdate = true; }
    
    // آپدیت کاربران قدیمی و ساخت پروفایل آماری براشون
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
    
    if (needsUpdate) writeDb(data);
    return data;
}

function writeDb(data) { 
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); 
}

module.exports = { readDb, writeDb };