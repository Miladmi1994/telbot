const axios = require('axios');
const crypto = require('crypto');
const { CF_API_TOKEN } = require('./config');

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
    
    let inboundIds = [DEFAULT_INBOUND_ID];
    if (server && server.inbounds && server.inbounds.length > 0) {
        inboundIds = server.inbounds.map(inb => inb.id);
    } else if (server && server.inboundId) {
        inboundIds = [server.inboundId];
    }
    const apiClient = getApiClient(server);

    try {
        const res = await apiClient.post('panel/api/clients/add', {
            client: { id: uuid, email, totalGB: bytesTotal, expiryTime, enable: true, limitIp: 0, subId },
            inboundIds: inboundIds
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

async function getClientActiveInboundIds(email, server = null) {
    const apiClient = getApiClient(server); // فرض بر این است که این تابع در فایل شما وجود دارد
    try {
        const res = await apiClient.get(`panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`);
        if (res.data && res.data.success && res.data.obj) {
            const dataObj = res.data.obj;
            if (Array.isArray(dataObj)) {
                // استخراج و برگرداندن شناسه (ID) اینباندهایی که این کلاینت روی آن‌ها وجود دارد
                return dataObj.map(stat => stat.inboundId);
            }
        }
        return [];
    } catch (error) {
        console.error("❌ Error fetching active inbounds:", error.message);
        return [];
    }
}

async function renewClient(uuid, oldEmail, newEmail, finalTotalGB, finalExpiryDays, server = null) {
    const apiClient = getApiClient(server);
    let inboundIds = [DEFAULT_INBOUND_ID];
    if (server && server.inbounds && server.inbounds.length > 0) {
        inboundIds = server.inbounds.map(inb => inb.id);
    } else if (server && server.inboundId) {
        inboundIds = [server.inboundId];
    }

    try {
        const newTotalBytes = Math.floor(finalTotalGB * 1073741824);
        const newExpiryTime = Date.now() + (finalExpiryDays * 24 * 60 * 60 * 1000);

        try {
            await apiClient.post(`panel/api/clients/del/${encodeURIComponent(oldEmail)}?keepTraffic=0`);
        } catch (e) {}

        const subId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
        
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
            inboundIds: inboundIds
        });
        return { success: true, log: "OK" };

    } catch (error) {
        const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        return { success: false, log: errDetail };
    }
}

function generateJsonConfig(uuid, configName, domain, sni, pathStr, typeNum) {
    const config = {
        "dns": { "servers": ["localhost"] },
        "inbounds": [{
            "listen": "127.0.0.1", "port": 10808, "protocol": "socks",
            "settings": { "auth": "noauth", "udp": true, "userLevel": 8 },
            "sniffing": { "destOverride": ["http", "tls", "quic"], "enabled": true, "routeOnly": true },
            "tag": "socks"
        }],
        "log": { "loglevel": "warning" },
        "outbounds": [
            {
                "mux": { "concurrency": -1, "enabled": false },
                "protocol": "vless",
                "settings": {
                    "vnext": [{
                        "address": domain,
                        "port": 443,
                        "users": [{ "encryption": "none", "id": uuid, "level": 8 }]
                    }]
                },
                "streamSettings": {
                    "finalmask": {
                        "tcp": [
                            { "type": "fragment", "settings": { "delay": "2-4", "length": "20-25", "packets": "tlshello" } }
                        ],
                        "udp": [
                            { "type": "noise", "settings": { "delay": "10-16", "length": "10-20" } }
                        ]
                    },
                    "network": "xhttp",
                    "security": "tls",
                    "sockopt": {
                        "domainStrategy": "UseIP",
                        "happyEyeballs": { "interleave": 2, "maxConcurrentTry": 4, "prioritizeIPv6": false, "tryDelayMs": 250 }
                    },
                    "tlsSettings": { "allowInsecure": false, "alpn": ["h3", "h2"], "fingerprint": "chrome", "serverName": sni },
                    "xhttpSettings": { "host": "", "mode": "packet-up", "path": pathStr }
                },
                "tag": "proxy"
            },
            { "protocol": "freedom", "streamSettings": { "network": "tcp", "sockopt": { "domainStrategy": "UseIP" } }, "tag": "direct" },
            { "protocol": "blackhole", "settings": { "response": { "type": "http" } }, "tag": "block" }
        ],
        "remarks": `${configName} ${typeNum}`,
        "routing": {
            "domainStrategy": "AsIs",
            "rules": [
                { "network": "udp", "outboundTag": "block", "port": "443", "type": "field" },
                { "port": "0-65535", "outboundTag": "proxy", "type": "field" }
            ]
        }
    };
    return JSON.stringify(config);
}

function generateVlessLink(uuid, configName, domain, sni, pathStr, typeNum) {
    const remark = encodeURIComponent(`${configName} ${typeNum}`);
    const encPath = encodeURIComponent(pathStr);
    return `vless://${uuid}@${domain}:443?encryption=none&security=tls&sni=${sni}&fp=chrome&alpn=h3%2Ch2&insecure=0&allowInsecure=0&type=xhttp&path=${encPath}&mode=packet-up#${remark}`;
}

function generateFinalMaskLink(uuid, configName, domain, sni, pathStr, typeNum) {
    const remark = encodeURIComponent(`${configName} ${typeNum}`);
    const encPath = encodeURIComponent(pathStr);
    const fmObj = {
        "tcp": [
            { "type": "fragment", "settings": { "packets": "tlshello", "lengths": ["5","94", "1"], "delays": ["0"], "maxSplit": "0" } },
            { "type": "fragment", "settings": { "packets": "1-1", "lengths": ["109", "1"], "delays": ["1"], "maxSplit": "355" } }
        ]
    };
    const encFm = encodeURIComponent(JSON.stringify(fmObj));
    return `vless://${uuid}@${domain}:443?encryption=none&security=tls&sni=${sni}&fp=chrome&alpn=h3%2Ch2&insecure=0&allowInsecure=0&type=xhttp&path=${encPath}&mode=packet-up&fm=${encFm}#${remark}`;
}

function generateAllConfigs(uuid, configName = "CypherNET💎", server = null) {
    const inbounds = (server && server.inbounds && server.inbounds.length > 0) ? server.inbounds : [{
        domain: server?.domain || "ns.crrc.ir",
        sni: server?.sni || "css.2net.ir",
        path: server?.path || "/Cypher_Net"
    }];

    let results = [];
    inbounds.forEach(inb => {
        const domain = inb.domain;
        const sni = inb.sni;
        const pathStr = inb.path;
        
        results.push(generateJsonConfig(uuid, configName, domain, sni, pathStr, 1));
        results.push(generateVlessLink(uuid, configName, domain, sni, pathStr, 2));
        results.push(generateFinalMaskLink(uuid, configName, domain, sni, pathStr, 3));
    });
    
    return results;
}


// --- Cloudflare API Functions ---

async function getCloudflareZones() {
    try {
        const res = await fetch('https://api.cloudflare.com/client/v4/zones', {
            headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) return data.result.map(z => ({ id: z.id, name: z.name }));
        return [];
    } catch (e) {
        console.error("Cloudflare Zones Error:", e);
        return [];
    }
}

async function getDnsRecords(zoneId) {
    try {
        // فقط رکوردهای نوع A رو می‌گیریم که معمولاً برای سرور و کانفیگه
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=A`, {
            headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) return data.result.map(r => ({ id: r.id, name: r.name, content: r.content, proxied: r.proxied, type: r.type }));
        return [];
    } catch (e) {
        console.error("Cloudflare DNS Records Error:", e);
        return [];
    }
}

async function updateDnsRecord(zoneId, recordId, name, type, content, proxied) {
    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, type, content, proxied, ttl: 1 })
        });
        const data = await res.json();
        return data.success;
    } catch (e) {
        console.error("Cloudflare Update Error:", e);
        return false;
    }
}

// حتماً یادت نره تابع تست رو هم اکسپورت کنی
module.exports = { testServerConnection, createClient, deleteClient, renewClient, getClientTraffic, generateAllConfigs, getUsdtRate, getCloudflareZones, getDnsRecords, updateDnsRecord, getClientActiveInboundIds };