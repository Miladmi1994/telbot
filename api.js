const axios = require('axios');
const crypto = require('crypto');

// این ثابت‌ها فقط به عنوان "سرور پیش‌فرض" (ایتالیا) نگه داشته میشن 
// تا کانفیگ‌های قدیمی همچنان بدون مشکل کار کنن
const DEFAULT_PANEL_URL = 'http://216.106.191.213:2053';
const DEFAULT_WEB_BASE_PATH = '/znuwjha'; 
const DEFAULT_API_TOKEN = 'bM41sxxSuvXHexMz4EVj4i1m6xui7ZxtjJuddtz81mCyXdgY';
const DEFAULT_INBOUND_ID = 1;

// تابع ساخت کلاینت داینامیک برای هر سرور
function getApiClient(server) {
    const url = server?.panelUrl || DEFAULT_PANEL_URL;
    const path = server?.webBasePath !== undefined ? server.webBasePath : DEFAULT_WEB_BASE_PATH;
    const token = server?.apiToken || DEFAULT_API_TOKEN;

    return axios.create({
        baseURL: `${url}${path}/`,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        timeout: 10000 
    });
}

// API Bitpin
const BITPIN_API = 'https://api.bitpin.org/api/v1/mkt/tickers/';

// سیستم دریافت قیمت بر بستر HTTPS با کش ۳۰ ثانیه‌ای
let cachedUsdtPrice = null;
let lastFetchTime = 0;

async function getUsdtRate() {
    const now = Date.now();
    if (cachedUsdtPrice !== null && (now - lastFetchTime) < 30000) {
        return cachedUsdtPrice;
    }
    try {
        const res = await axios.get(BITPIN_API, { timeout: 8000 });
        if (res.data && Array.isArray(res.data)) {
            const usdt = res.data.find(ticker => ticker.symbol === 'USDT_IRT');
            if (usdt && usdt.price) {
                cachedUsdtPrice = Math.ceil(Number(usdt.price));
                lastFetchTime = now;
                return cachedUsdtPrice;
            }
        }
    } catch (error) {
        console.error('⚠️ [USDT] خطا در دریافت قیمت از بیت‌پین:', error.message);
    }
    return cachedUsdtPrice;
}

// تابع تست اتصال سرور (موقع ثبت سرور جدید در ربات استفاده میشه)
async function testServerConnection(panelUrl, webBasePath, apiToken) {
    try {
        const client = axios.create({
            baseURL: `${panelUrl}${webBasePath}/`,
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        const res = await client.get('panel/api/inbounds/list');
        if (res.data && res.data.success) {
            return { success: true, msg: 'اتصال موفقیت‌آمیز بود' };
        }
        return { success: false, msg: res.data?.msg || 'سرور خطا داد' };
    } catch (error) {
        return { success: false, msg: error.message };
    }
}

async function createClient(email, totalGB, expiryDays, server = null) {
    const expiryTime = expiryDays > 0 ? Date.now() + (expiryDays * 24 * 60 * 60 * 1000) : 0;
    const bytesTotal = Math.floor(totalGB * 1073741824);
    const uuid = crypto.randomUUID();
    const subId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    
    const inboundId = server?.inboundId || DEFAULT_INBOUND_ID;
    const apiClient = getApiClient(server);

    try {
        const res = await apiClient.post('panel/api/clients/add', {
            client: { id: uuid, email, totalGB: bytesTotal, expiryTime, enable: true, limitIp: 0, subId },
            inboundIds: [inboundId]
        });
        if (res.data && !res.data.success) {
            console.error("❌ ارور پنل موقع ساخت اکانت:", res.data.msg);
            return null;
        }
        return uuid;
    } catch (error) {
        console.error("❌ خطای API موقع ساخت:", error.response?.data ? JSON.stringify(error.response.data) : error.message);
        return null;
    }
}

async function deleteClient(email, server = null) {
    const apiClient = getApiClient(server);
    try {
        await apiClient.post(`panel/api/clients/del/${email}?keepTraffic=0`);
        return true;
    } catch (error) {
        return false;
    }
}

async function getClientTraffic(email, server = null) {
    const apiClient = getApiClient(server);
    try {
        const clientRes = await apiClient.get(`panel/api/clients/get/${encodeURIComponent(email)}`);
        let total = 0, expiryTime = 0;
        
        if (clientRes.data && clientRes.data.success && clientRes.data.obj) {
            const obj = clientRes.data.obj;
            total = obj.totalGB || obj.total || (obj.client && (obj.client.total || obj.client.totalGB)) || 0;
            expiryTime = obj.expiryTime || (obj.client && obj.client.expiryTime) || 0;
        } else {
            return null; 
        }

        let up = 0, down = 0;
        let trafficFound = false;

        try {
            const trafficRes = await apiClient.get(`panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`);
            if (trafficRes.data && trafficRes.data.success && trafficRes.data.obj) {
                const tObj = Array.isArray(trafficRes.data.obj) ? trafficRes.data.obj[0] : trafficRes.data.obj;
                if (tObj) {
                    up = tObj.up || 0;
                    down = tObj.down || 0;
                    if (total === 0 && tObj.total) total = tObj.total;
                    trafficFound = true;
                }
            }
        } catch (trafficErr) {}

        if (!trafficFound) {
            try {
                const listRes = await apiClient.get('panel/api/inbounds/list');
                if (listRes.data && listRes.data.success && listRes.data.obj) {
                    for (const inbound of listRes.data.obj) {
                        if (inbound.clientStats) {
                            const cStats = inbound.clientStats.find(c => c.email === email);
                            if (cStats) {
                                up += cStats.up || 0;
                                down += cStats.down || 0;
                                if (total === 0 && cStats.total) total = cStats.total;
                                trafficFound = true;
                            }
                        }
                    }
                }
            } catch (fallbackErr) {}
        }

        return { total, up, down, expiryTime };
    } catch (error) {
        return null;
    }
}

async function renewClient(uuid, oldEmail, newEmail, finalTotalGB, finalExpiryDays, server = null) {
    const apiClient = getApiClient(server);
    const inboundId = server?.inboundId || DEFAULT_INBOUND_ID;

    try {
        // تبدیل مستقیم اعدادی که هندلر محاسبه کرده به فرمت قابل فهم برای پنل
        const newTotalBytes = Math.floor(finalTotalGB * 1073741824);
        const newExpiryTime = Date.now() + (finalExpiryDays * 24 * 60 * 60 * 1000);

        // تلاش برای حذف کاربر قدیمی (با مدیریت خطای اکانت‌های منقضی و حذف شده)
        try {
            await apiClient.post(`panel/api/clients/del/${encodeURIComponent(oldEmail)}?keepTraffic=0`);
        } catch (e) {
            // نادیده گرفتن خطا اگر اکانت از قبل در پنل وجود نداشته باشد
        }

        const subId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
        
        // ساخت کاربر جدید با اطلاعات و مقادیر نهایی
        await apiClient.post('panel/api/clients/add', {
            client: {
                id: uuid,
                email: newEmail,
                totalGB: newTotalBytes,
                expiryTime: newExpiryTime,
                enable: true,
                limitIp: 0,
                subId: subId
            },
            inboundIds: [inboundId]
        });

        return { success: true, log: "OK" };

    } catch (error) {
        const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        return { success: false, log: errDetail };
    }
}

function generateMciConfig(uuid, configName = "CypherNET💎", server = null) {
    const remark = encodeURIComponent(configName + " 2");
    const domain = server?.domain || "ns.crrc.ir";
    const sni = server?.sni || "css.2net.ir";
    // انکود کردن مسیر برای پشتیبانی از ایموجی و کاراکترهای خاص
    const path = server?.path ? encodeURIComponent(server.path) : "%2FCypher_Net"; 
    
    return `vless://${uuid}@${domain}:443?encryption=none&security=tls&sni=${sni}&fp=chrome&alpn=h3%2Ch2&insecure=0&allowInsecure=0&type=xhttp&path=${path}&mode=packet-up#${remark}`;
}

function generateMtnConfig(uuid, configName = "CypherNET💎", server = null) {
    const domain = server?.domain || "ns.crrc.ir";
    const sni = server?.sni || "css.2net.ir";
    const pathStr = server?.path ? server.path : "/Cypher_Net";

    const config = {
        "dns": {
            "servers": [
                "localhost"
            ]
        },
        "inbounds": [
            {
                "listen": "127.0.0.1",
                "port": 10808,
                "protocol": "socks",
                "settings": {
                    "auth": "noauth",
                    "udp": true,
                    "userLevel": 8
                },
                "sniffing": {
                    "destOverride": [
                        "http",
                        "tls",
                        "quic"
                    ],
                    "enabled": true,
                    "routeOnly": true
                },
                "tag": "socks"
            }
        ],
        "log": {
            "loglevel": "warning"
        },
        "outbounds": [
            {
                "mux": {
                    "concurrency": -1,
                    "enabled": false
                },
                "protocol": "vless",
                "settings": {
                    "vnext": [
                        {
                            "address": domain, // متغیر دامنه
                            "port": 443,
                            "users": [
                                {
                                    "encryption": "none",
                                    "id": uuid, // متغیر شناسه کاربر
                                    "level": 8
                                }
                            ]
                        }
                    ]
                },
                "streamSettings": {
                    "finalmask": { // اضافه شدن تنظیمات فرگمنت
                        "tcp": [
                            {
                                "type": "fragment",
                                "settings": {
                                    "delay": "2-4",
                                    "length": "20-25",
                                    "packets": "tlshello"
                                }
                            }
                        ],
                        "udp": [
                            {
                                "type": "noise",
                                "settings": {
                                    "delay": "10-16",
                                    "length": "10-20"
                                }
                            }
                        ]
                    },
                    "network": "xhttp",
                    "security": "tls",
                    "sockopt": {
                        "domainStrategy": "UseIP",
                        "happyEyeballs": {
                            "interleave": 2,
                            "maxConcurrentTry": 4,
                            "prioritizeIPv6": false,
                            "tryDelayMs": 250
                        }
                    },
                    "tlsSettings": {
                        "allowInsecure": false,
                        "alpn": [
                            "h3",
                            "h2"
                        ],
                        "fingerprint": "chrome",
                        "serverName": sni // متغیر SNI
                    },
                    "xhttpSettings": {
                        "host": "",
                        "mode": "packet-up",
                        "path": pathStr // متغیر مسیر
                    }
                },
                "tag": "proxy"
            },
            {
                "protocol": "freedom",
                "streamSettings": {
                    "network": "tcp",
                    "sockopt": {
                        "domainStrategy": "UseIP"
                    }
                },
                "tag": "direct"
            },
            {
                "protocol": "blackhole",
                "settings": {
                    "response": {
                        "type": "http"
                    }
                },
                "tag": "block"
            }
        ],
        "remarks": configName + " 1", // متغیر نام کانفیگ
        "routing": {
            "domainStrategy": "AsIs",
            "rules": [
                {
                    "network": "udp",
                    "outboundTag": "block",
                    "port": "443",
                    "type": "field"
                },
                {
                    "port": "0-65535",
                    "outboundTag": "proxy",
                    "type": "field"
                }
            ]
        }
    };

    return JSON.stringify(config);
}

// حتماً یادت نره تابع تست رو هم اکسپورت کنی
module.exports = { testServerConnection, createClient, deleteClient, renewClient, getClientTraffic, generateMciConfig, generateMtnConfig, getUsdtRate };