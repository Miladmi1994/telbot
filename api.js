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
    
    // رفع مشکل 404: جلوگیری از افزودن مسیر سرور قدیمی به سرورهای جدید
    let path = '';
    if (server?.webBasePath !== undefined) {
        path = server.webBasePath;
    } else if (!server || server.id === 'srv_364212' || server.id === 'default') {
        path = DEFAULT_WEB_BASE_PATH;
    }

    // تضمین فرمت صحیح اسلش‌ها
    let baseURL = url.endsWith('/') ? url.slice(0, -1) : url;
    if (path && !path.startsWith('/')) path = '/' + path;
    
    const token = server?.apiToken || DEFAULT_API_TOKEN;

    return axios.create({
        baseURL: `${baseURL}${path}/`,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000 
    });
}

const WebSocket = require('ws');

// API Bitpin
const BITPIN_API = 'https://api.bitpin.org/api/v1/mkt/tickers/';

// سیستم کش و پشتیبان والکس
let cachedUsdtPrice = null;
let lastFetchTime = 0;
let latestWallexUsdtPrice = null;
let wallexWs = null;

// اتصال خودکار به وب‌سکت والکس به عنوان پشتیبان
function connectWallexFallback() {
    wallexWs = new WebSocket('wss://api.wallex.ir/connection/websocket');

    wallexWs.on('open', () => {
        const subMessage = {
            "id": 3,
            "subscribe": { "channel": "public:all@price" }
        };
        wallexWs.send(JSON.stringify(subMessage));
    });

    wallexWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.push && parsed.push.channel === 'public:all@price') {
                const marketData = parsed.push.pub.data;
                if (marketData && marketData.symbol === 'USDTTMN') {
                    // تبدیل تومان والکس به ریال یا هم‌سطح‌سازی (در صورت نیاز به عدد کفایت می‌کند)
                    latestWallexUsdtPrice = Math.ceil(Number(marketData.price));
                }
            }
        } catch (e) {}
    });

    wallexWs.on('close', () => {
        setTimeout(connectWallexFallback, 5000);
    });

    wallexWs.on('error', (err) => {});
}

// استارت زدن وب‌سکت والکس در پس‌زمینه
connectWallexFallback();

// تابع جدید که اول بیت‌پین رو تست میکنه، اگر خطا داد میره سراغ والکس
async function getUsdtRate() {
    const now = Date.now();
    if (cachedUsdtPrice !== null && (now - lastFetchTime) < 30000) {
        return cachedUsdtPrice;
    }

    // ۱. اولویت اول: بیت‌پین با هدرهای مرورگر برای جلوگیری از خطای 403
    try {
        const res = await axios.get(BITPIN_API, { 
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });
        if (res.data && Array.isArray(res.data)) {
            const usdt = res.data.find(ticker => ticker.symbol === 'USDT_IRT');
            if (usdt && usdt.price) {
                cachedUsdtPrice = Math.ceil(Number(usdt.price));
                lastFetchTime = now;
                return cachedUsdtPrice;
            }
        }
    } catch (error) {
        console.warn('⚠️ [Bitpin] خطا یا مسدودیت، استفاده از پشتیبان والکس...');
    }

    // ۲. اولویت دوم (پشتیبان): وب‌سکت والکس
    if (latestWallexUsdtPrice !== null) {
        cachedUsdtPrice = latestWallexUsdtPrice;
        lastFetchTime = now;
        return cachedUsdtPrice;
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

function getFilteredInboundIds(server, isVip = false, tierModeEnabled = false) {
    if (!server || !server.inbounds || server.inbounds.length === 0) return [];
    if (!tierModeEnabled) return server.inbounds.map(inb => inb.id);

    const matched = server.inbounds.filter(inb => {
        const tier = inb.tier || 'both';
        if (tier === 'both') return true;
        return isVip ? tier === 'vip' : tier === 'normal';
    });

    // اگر ادمین یادش رفته بود اینباندی برای آن سطح ست کند، برای جلوگیری از خطا همه را برگردان
    return (matched.length > 0 ? matched : server.inbounds).map(inb => inb.id);
}

async function createClient(email, totalGB, expiryDays, server, isVip = false, tierModeEnabled = false) {
    const apiClient = getApiClient(server);
    const uuid = crypto.randomUUID();
    const subId = crypto.randomBytes(8).toString('hex');

    const totalByte = totalGB === 0 ? 0 : Math.floor(totalGB * 1073741824);
    const expiryTime = expiryDays === 0 ? 0 : Date.now() + Math.floor(expiryDays * 24 * 60 * 60 * 1000);

    if (!server.inbounds || server.inbounds.length === 0) {
        console.error("❌ No inbounds defined for this server.");
        return false;
    }

    const inboundIds = getFilteredInboundIds(server, isVip, tierModeEnabled);

    const payload = {
        client: {
            id: uuid,
            email: email,
            limitIp: 0,
            totalGB: totalByte,
            expiryTime: expiryTime,
            enable: true,
            tgId: 0,
            subId: subId
        },
        inboundIds: inboundIds // اختصاص همزمان کلاینت به تمام اینباندها (WS و XHTTP)
    };

    try {
        const res = await apiClient.post('panel/api/clients/add', payload);
        if (res.data && res.data.success) {
            return uuid;
        } else {
            console.error("❌ Panel rejected add client:", res.data?.msg);
            return false;
        }
    } catch (error) {
        console.error("❌ API Error adding client:", error.message);
        return false;
    }
}

async function deleteClient(identifier, server = null) {
    const apiClient = getApiClient(server);
    try {
        const res = await apiClient.post(`panel/api/clients/del/${identifier}`);
        return res.data && res.data.success;
    } catch (error) {
        return false;
    }
}

async function getClientTraffic(email, server = null) {
    const apiClient = getApiClient(server);
    try {
        // ۱. بررسی قطعی وجود کلاینت در پنل (با مسیر رسمی 3x-ui)
        const clientRes = await apiClient.get(`panel/api/clients/get/${encodeURIComponent(email)}`);
        
        if (!clientRes.data || !clientRes.data.success || !clientRes.data.obj) {
            return null; // کلاینت در پنل وجود ندارد (حذف واقعی)
        }

        const obj = clientRes.data.obj;
        let total = obj.totalGB || obj.total || (obj.client && (obj.client.total || obj.client.totalGB)) || 0;
        let expiryTime = obj.expiryTime || (obj.client && obj.client.expiryTime) || 0;

        let up = 0, down = 0;
        let trafficFound = false;

        // ۲. استفاده از مسیر اختصاصی ترافیک بر اساس داکیومنت 3x-ui
        try {
            const trafficRes = await apiClient.get(`panel/api/clients/traffic/${encodeURIComponent(email)}`);
            if (trafficRes.data && trafficRes.data.success && trafficRes.data.obj) {
                const tObj = trafficRes.data.obj;
                up = tObj.up || 0;
                down = tObj.down || 0;
                if (total === 0 && tObj.total) total = tObj.total;
                if (expiryTime === 0 && tObj.expiryTime) expiryTime = tObj.expiryTime;
                trafficFound = true;
            }
        } catch (trafficErr) {
            // در صورت عدم مصرف ترافیک، ممکن است پنل خطا دهد. به مرحله بعد (Fallback) می‌رویم.
        }

        // ۳. سیستم جایگزین (Fallback): خواندن از لیست اینباندها و clientStats
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
                                if (expiryTime === 0 && cStats.expiryTime) expiryTime = cStats.expiryTime;
                                trafficFound = true;
                            }
                        }
                    }
                }
            } catch (fallbackErr) {}
        }

        return { total, up, down, expiryTime };
    } catch (error) {
        // بازگرداندن undefined در صورت خطای شبکه برای جلوگیری از حذف اشتباه کاربران در ربات
        console.error(`⚠️ [Traffic] خطا در دریافت ترافیک ${email}:`, error.message);
        return undefined; 
    }
}


async function getClientActiveInboundIds(email, server = null) {
    const apiClient = getApiClient(server);
    try {
        const res = await apiClient.get('panel/api/inbounds/list');
        if (res.data && res.data.success && Array.isArray(res.data.obj)) {
            const activeInboundIds = [];
            res.data.obj.forEach(inbound => {
                if (inbound.clientStats && Array.isArray(inbound.clientStats)) {
                    const exists = inbound.clientStats.some(stat => stat.email === email);
                    if (exists) {
                        activeInboundIds.push(inbound.id);
                    }
                }
            });
            return activeInboundIds;
        }
        return [];
    } catch (error) {
        console.error("❌ Error fetching active inbounds:", error.message);
        return [];
    }
}

async function renewClient(uuid, oldEmail, newEmail, totalGB, expiryDays, server, isVip = false, tierModeEnabled = false) {
    const apiClient = getApiClient(server);

    const totalByte = totalGB === 0 ? 0 : Math.floor(totalGB * 1073741824);
    const expiryTime = expiryDays === 0 ? 0 : Date.now() + Math.floor(expiryDays * 24 * 60 * 60 * 1000);
    const subId = crypto.randomBytes(8).toString('hex');

    if (!server.inbounds || server.inbounds.length === 0) {
        return { success: false, log: 'اینباندی برای این سرور یافت نشد.' };
    }

    const inboundIds = getFilteredInboundIds(server, isVip, tierModeEnabled);

    try {
        // ۱. عملیات خودترمیمی (Self-Healing): حذف کامل کلاینت با UUID
        await apiClient.post(`panel/api/clients/del/${uuid}`).catch(() => {});
        await apiClient.post(`panel/api/clients/del/${oldEmail}`).catch(() => {});

        // ۲. ساخت مجدد کلاینت با ایمیل و حجم جدید روی تمام اینباندها به صورت همزمان
        const payload = {
            client: {
                id: uuid, // UUID ثابت می‌ماند تا کانفیگ کاربر قطع نشود
                email: newEmail,
                limitIp: 0,
                totalGB: totalByte,
                expiryTime: expiryTime,
                enable: true,
                tgId: 0,
                subId: subId
            },
            inboundIds: inboundIds
        };

        const res = await apiClient.post('panel/api/clients/add', payload);

        if (res.data && res.data.success) {
            return { success: true, log: 'تمدید با موفقیت انجام شد' };
        } else {
            return { success: false, log: res.data?.msg || 'خطا در ثبت کلاینت جدید در پنل' };
        }
    } catch (error) {
        console.error(`❌ Error renewing client:`, error.message);
        return { success: false, log: error.message };
    }
}

function generateJsonConfig(uuid, configName, domain, port, sni, pathStr, network, suffix) {
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
                        "port": port,
                        "users": [{ "encryption": "none", "id": uuid, "level": 8 }]
                    }]
                },
                "streamSettings": {
                    "finalmask": {
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
                    "network": network,
                    "security": "tls",
                    "tlsSettings": { "allowInsecure": false, "alpn": ["h3", "h2"], "fingerprint": "chrome", "serverName": sni }
                },
                "tag": "proxy"
            },
            { "protocol": "freedom", "streamSettings": { "network": "tcp", "sockopt": { "domainStrategy": "UseIP" } }, "tag": "direct" },
            { "protocol": "blackhole", "settings": { "response": { "type": "http" } }, "tag": "block" }
        ],
        "remarks": `${configName} ${suffix}`,
        "routing": {
            "domainStrategy": "AsIs",
            "rules": [
                { "network": "udp", "outboundTag": "block", "port": "443", "type": "field" },
                { "port": "0-65535", "outboundTag": "proxy", "type": "field" }
            ]
        }
    };

    if (network === 'xhttp') {
        config.outbounds[0].streamSettings.xhttpSettings = { "host": "", "mode": "packet-up", "path": pathStr };
        config.outbounds[0].streamSettings.sockopt = {
            "domainStrategy": "UseIP",
            "happyEyeballs": { "interleave": 2, "maxConcurrentTry": 4, "prioritizeIPv6": false, "tryDelayMs": 250 }
        };
    } else if (network === 'ws') {
        config.outbounds[0].streamSettings.wsSettings = { "headers": {}, "path": pathStr };
    }

    return JSON.stringify(config);
}

// تابع جدید: تولید کانفیگ ویژه وب‌سوکت با فرگمنت در سطح outbound
function generateSpecialWsConfig(uuid, configName, domain, port, sni, pathStr) {
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
                "protocol": "vless",
                "settings": {
                    "vnext": [{
                        "address": domain,
                        "port": port,
                        "users": [{ "encryption": "none", "id": uuid, "level": 8 }]
                    }]
                },
                "streamSettings": {
                    "network": "ws",
                    "security": "tls",
                    "sockopt": {
                        "domainStrategy": "UseIP",
                        "dialerProxy": "fragment",
                        "happyEyeballs": { "interleave": 2, "maxConcurrentTry": 4, "prioritizeIPv6": false, "tryDelayMs": 250 }
                    },
                    "tlsSettings": {
                        "allowInsecure": false,
                        "alpn": ["h2"],
                        "fingerprint": "firefox",
                        "serverName": sni
                    },
                    "wsSettings": { "headers": {}, "path": pathStr }
                },
                "tag": "proxy"
            },
            {
                "tag": "fragment",
                "protocol": "freedom",
                "settings": {
                    "fragment": {
                        "packets": "tlshello",
                        "length": "20-25",
                        "interval": "2-4"
                    }
                }
            },
            {
                "protocol": "freedom",
                "streamSettings": { "network": "tcp", "sockopt": { "domainStrategy": "UseIP" } },
                "tag": "direct"
            },
            { "protocol": "blackhole", "tag": "block" }
        ],
        "remarks": `WS 💎 ${configName}`,
        "routing": {
            "domainStrategy": "AsIs",
            "rules": [
                { "network": "udp", "outboundTag": "block", "port": "443", "type": "field" },
                { "port": "0-65535", "outboundTag": "proxy", "type": "field" }
            ]
        }
    };
    return JSON.stringify(config, null, 2);
}

function generateAllConfigs(uuid, configName = "CypherNET💎", server = null) {
    const inbounds = (server && server.inbounds && server.inbounds.length > 0) ? server.inbounds : [];
    let results = [];
    let wsCounter = 1;
    let otherCounter = 1;

    inbounds.forEach((inb) => {
        const network = (inb.network || inb.streamSettings?.network || "xhttp").toLowerCase();
        const port = inb.port || 443;
        let domain = inb.domain;
        let sni = inb.sni;
        let pathStr = inb.path;

        if (network === 'xhttp') {
            const xhttp = inb.streamSettings?.xhttpSettings || {};
            pathStr = pathStr || xhttp.path || "/Cypher_Net";
            domain = domain || xhttp.host || "ns.crrc.ir";
        } else if (network === 'ws') {
            const ws = inb.streamSettings?.wsSettings || {};
            pathStr = pathStr || ws.path || "/Cypher_Net";
            domain = domain || ws.host || "ns.crrc.ir";
        }
        sni = sni || inb.streamSettings?.tlsSettings?.serverName || domain;
        domain = domain || "ns.crrc.ir";

        const getNextSuffix = () => {
            if (network === 'ws') {
                return `ws-${wsCounter++}`;
            } else {
                return `${otherCounter++}`;
            }
        };

        // --- منطق جدید: اگر حالت ویژه فعال بود، فقط ۱ کانفیگ JSON ویژه بساز ---
        if (network === 'ws' && inb.isSpecialWs) {
            results.push(generateSpecialWsConfig(uuid, configName, domain, port, sni, pathStr));
        } else {
            // در غیر این صورت، همان ۳ کانفیگ همیشگی ساخته شود
            results.push(generateJsonConfig(uuid, configName, domain, port, sni, pathStr, network, getNextSuffix()));
            results.push(generateVlessLink(uuid, configName, domain, port, sni, pathStr, network, getNextSuffix()));
            results.push(generateFinalMaskLink(uuid, configName, domain, port, sni, pathStr, network, getNextSuffix()));
            
            if (network === 'xhttp' && (!server || server.echEnabled !== false)) {
                const echAddr = server?.echAddress || 'ns3.crrc.ir';
                const echConf = server?.echConfig || 'cloudflare-ech.com+udp://1.1.1.1';
                results.push(generateEchVlessLink(uuid, configName, echAddr, port, sni, pathStr, network, `${getNextSuffix()} ech`, echConf));
            }
        }
    });
    return results;
}

function generateVlessLink(uuid, configName, domain, port, sni, pathStr, network, suffix) {
    const remark = encodeURIComponent(`${configName} ${suffix}`);
    const encPath = encodeURIComponent(pathStr);
    const modeParam = network === 'xhttp' ? '&mode=packet-up' : '';
    // پارامتر host کاملا حذف شد
    return `vless://${uuid}@${domain}:${port}?encryption=none&security=tls&sni=${sni}&fp=chrome&alpn=h3%2Ch2&insecure=0&allowInsecure=0&type=${network}&path=${encPath}${modeParam}#${remark}`;
}

function generateEchVlessLink(uuid, configName, domain, port, sni, pathStr, network, suffix, echStr) {
    const remark = encodeURIComponent(`${configName} ${suffix}`);
    const encPath = encodeURIComponent(pathStr);
    const encEch = encodeURIComponent(echStr);
    const modeParam = network === 'xhttp' ? '&mode=packet-up' : '';
    return `vless://${uuid}@${domain}:${port}?encryption=none&security=tls&sni=${sni}&fp=chrome&alpn=h2%2Chttp%2F1.1&insecure=0&allowInsecure=0&ech=${encEch}&type=${network}&path=${encPath}${modeParam}#${remark}`;
}

function generateFinalMaskLink(uuid, configName, domain, port, sni, pathStr, network, suffix) {
    const remark = encodeURIComponent(`${configName} ${suffix}`);
    const encPath = encodeURIComponent(pathStr);
    const modeParam = network === 'xhttp' ? '&mode=packet-up' : '';
    const fmObj = {
        "tcp": [
            { "type": "fragment", "settings": { "packets": "tlshello", "lengths": ["5", "94", "1"], "delays": ["0"], "maxSplit": "0" } },
            { "type": "fragment", "settings": { "packets": "1-1", "lengths": ["109", "1"], "delays": ["1"], "maxSplit": "355" } }
        ]
    };
    const encFm = encodeURIComponent(JSON.stringify(fmObj));
    // پارامتر host حذف شد و ساختار fm دقیقاً روی لینک شماره ۳ اعمال شد
    return `vless://${uuid}@${domain}:${port}?encryption=none&security=tls&sni=${sni}&fp=chrome&alpn=h3%2Ch2&insecure=0&allowInsecure=0&type=${network}&path=${encPath}${modeParam}&fm=${encFm}#${remark}`;
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

// --- تابع اختصاصی تزریق پاداش رفرال به کانفیگ (مبتنی بر مسیر ایمیل) ---
async function addRewardToClient(email, uuid, rewardType, server) {
    const apiClient = getApiClient(server);
    try {
        // ۱. دریافت اطلاعات کامل کلاینت با استفاده از ایمیل یونیک
        const clientRes = await apiClient.get(`panel/api/clients/get/${encodeURIComponent(email)}`);
        if (!clientRes.data || !clientRes.data.success || !clientRes.data.obj) {
            return { success: false, msg: 'کلاینت با این ایمیل در پنل یافت نشد.' };
        }

        const obj = clientRes.data.obj;
        
        // استخراج دقیق حجم و زمان فعلی (برای حفظ کامل ترافیک مصرفی)
        let currentTotal = obj.totalGB || obj.total || (obj.client && (obj.client.total || obj.client.totalGB)) || 0;
        let currentExpiry = obj.expiryTime || (obj.client && obj.client.expiryTime) || 0;

        let newTotalByte = currentTotal;
        let newExpiryTime = currentExpiry;

        // ۲. محاسبه مقادیر جدید بر اساس پاداش انتخابی
        if (rewardType === 'gb') {
            if (newTotalByte === 0) return { success: false, msg: 'این کانفیگ حجم نامحدود دارد و افزودن حجم بی‌تأثیر است.' };
            newTotalByte += (5 * 1073741824); // اضافه کردن ۵ گیگابایت به بایت
        } else if (rewardType === 'days') {
            if (newExpiryTime === 0) return { success: false, msg: 'این کانفیگ زمان نامحدود دارد و افزودن زمان بی‌تأثیر است.' };
            newExpiryTime += (5 * 24 * 60 * 60 * 1000); // اضافه کردن ۵ روز
        }

        const tgId = obj.client?.tgId || obj.tgId || 0;
        const subId = obj.client?.subId || obj.subId || require('crypto').randomBytes(8).toString('hex');
        const limitIp = obj.client?.limitIp || obj.limitIp || 0;
        const enable = obj.client?.enable !== undefined ? obj.client.enable : (obj.enable !== undefined ? obj.enable : true);

        // ۳. ساخت پی‌لود آپدیت
        const updatePayload = {
            id: uuid,
            email: email,
            enable: enable,
            total: newTotalByte,
            totalGB: newTotalByte,
            expiryTime: newExpiryTime,
            limitIp: limitIp,
            tgId: tgId,
            subId: subId
        };

        // ۴. ارسال درخواست به مسیر استاندارد update بر اساس ایمیل یونیک
        const updateRes = await apiClient.post(`panel/api/clients/update/${encodeURIComponent(email)}`, updatePayload);

        if (updateRes.data && updateRes.data.success) {
            return { success: true };
        } else {
            return { success: false, msg: updateRes.data?.msg || 'خطای پنل در آپدیت مقادیر' };
        }
    } catch (error) {
        return { success: false, msg: error.message };
    }
}

// --- تابع اختصاصی اعمال جبران خسارت گروهی با مسیر ایمیل ---
async function applyGroupCompensation(email, uuid, extraGB, extraDays, server) {
    const apiClient = getApiClient(server);
    try {
        const clientRes = await apiClient.get(`panel/api/clients/get/${encodeURIComponent(email)}`);
        if (!clientRes.data || !clientRes.data.success || !clientRes.data.obj) return { success: false };

        const obj = clientRes.data.obj;
        let currentTotal = obj.totalGB || obj.total || (obj.client && (obj.client.total || obj.client.totalGB)) || 0;
        let currentExpiry = obj.expiryTime || (obj.client && obj.client.expiryTime) || 0;

        let newTotalByte = currentTotal;
        if (currentTotal > 0 && extraGB > 0) newTotalByte += (extraGB * 1073741824);

        let newExpiryTime = currentExpiry;
        if (currentExpiry > 0 && extraDays > 0) newExpiryTime += (extraDays * 24 * 60 * 60 * 1000);

        const updatePayload = {
            id: uuid,
            email: email,
            enable: obj.client?.enable !== undefined ? obj.client.enable : (obj.enable !== undefined ? obj.enable : true),
            total: newTotalByte,
            totalGB: newTotalByte,
            expiryTime: newExpiryTime,
            limitIp: obj.client?.limitIp || obj.limitIp || 0,
            tgId: obj.client?.tgId || obj.tgId || 0,
            subId: obj.client?.subId || obj.subId || ''
        };

        const updateRes = await apiClient.post(`panel/api/clients/update/${encodeURIComponent(email)}`, updatePayload);
        return { success: !!(updateRes.data && updateRes.data.success) };
    } catch (error) {
        return { success: false };
    }
}

// --- تابع جدید و فوق‌العاده دقیق برای دریافت ترافیک کل کلاینت‌ها از API جدید پنل ---
async function getServerTrafficMap(server) {
    const apiClient = getApiClient(server);
    const trafficMap = {};
    try {
        // دریافت صفحه اول با سایز بزرگ تا کل کاربران در یک درخواست بیایند
        const res = await apiClient.get('panel/api/clients/list/paged?page=1&pageSize=500&sort=createdAt&order=ascend');
        if (res.data && res.data.success && res.data.obj && res.data.obj.items) {
            for (const item of res.data.obj.items) {
                const email = item.email;
                if (!email) continue;
                
                const t = item.traffic || {};
                trafficMap[email] = {
                    up: t.up || 0,
                    down: t.down || 0,
                    total: t.total || item.totalGB || 0,
                    expiryTime: t.expiryTime || item.expiryTime || 0
                };
            }
            return trafficMap;
        }
    } catch (error) {
        console.error(`⚠️ [TrafficMap] خطا در دریافت لیست کلاینت‌های سرور ${server?.name}:`, error.message);
    }
    return null;
}

// --- تابع اختصاصی مدیریت و ویرایش دستی حجم و زمان کلاینت توسط ادمین (مبتنی بر مسیر ایمیل) ---
async function adminModifyClient(email, uuid, deltaGB, deltaDays, server) {
    const apiClient = getApiClient(server);
    try {
        const clientRes = await apiClient.get(`panel/api/clients/get/${encodeURIComponent(email)}`);
        if (!clientRes.data || !clientRes.data.success || !clientRes.data.obj) {
            return { success: false, msg: 'کلاینت در پنل یافت نشد.' };
        }

        const obj = clientRes.data.obj;
        let currentTotal = obj.totalGB || obj.total || (obj.client && (obj.client.total || obj.client.totalGB)) || 0;
        let currentExpiry = obj.expiryTime || (obj.client && obj.client.expiryTime) || 0;
        if (currentExpiry > 0 && currentExpiry < 1e12) currentExpiry *= 1000;

        let newTotalByte = currentTotal;
        if (deltaGB !== 0) {
            const deltaBytes = Math.floor(deltaGB * 1073741824);
            newTotalByte = Math.max(0, currentTotal + deltaBytes);
        }

        let newExpiryTime = currentExpiry;
        if (deltaDays !== 0) {
            const deltaMs = Math.floor(deltaDays * 24 * 60 * 60 * 1000);
            // اگر قبلاً منقضی شده بود و ادمین روز مثبت اضافه کرد، از لحظه حال محاسبه کن
            const baseTime = (currentExpiry > 0 && currentExpiry < Date.now() && deltaDays > 0) ? Date.now() : (currentExpiry > 0 ? currentExpiry : Date.now());
            newExpiryTime = Math.max(0, baseTime + deltaMs);
        }

        const updatePayload = {
            id: obj.client?.id || obj.id || uuid,
            email: email,
            enable: true,
            total: newTotalByte,
            totalGB: newTotalByte,
            expiryTime: newExpiryTime,
            limitIp: obj.client?.limitIp || obj.limitIp || 0,
            tgId: obj.client?.tgId || obj.tgId || 0,
            subId: obj.client?.subId || obj.subId || ''
        };

        const updateRes = await apiClient.post(`panel/api/clients/update/${encodeURIComponent(email)}`, updatePayload);
        if (updateRes.data && updateRes.data.success) {
            return { success: true, newTotal: newTotalByte, newExpiry: newExpiryTime };
        }
        return { success: false, msg: updateRes.data?.msg || 'خطای پنل در بروزرسانی' };
    } catch (error) {
        return { success: false, msg: error.message };
    }
}

// --- تابع حذف قطعی کلاینت با بررسی مسیر ایمیل و UUID ---
async function deleteClientByEmailAndUuid(email, uuid, server) {
    const apiClient = getApiClient(server);
    let deleted = false;
    try {
        if (email) {
            const resEmail = await apiClient.post(`panel/api/clients/del/${encodeURIComponent(email)}`).catch(() => null);
            if (resEmail?.data?.success) deleted = true;
        }
        if (uuid) {
            const resUuid = await apiClient.post(`panel/api/clients/del/${uuid}`).catch(() => null);
            if (resUuid?.data?.success) deleted = true;
        }
        // بررسی نهایی: اگر کلاینت دیگر در پنل وجود ندارد یعنی حذف موفق بوده است
        const checkRes = await apiClient.get(`panel/api/clients/get/${encodeURIComponent(email)}`).catch(() => null);
        if (!checkRes || !checkRes.data || !checkRes.data.success || !checkRes.data.obj) {
            deleted = true;
        }
    } catch (e) {}
    return deleted;
}

wallexWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.push && parsed.push.channel === 'public:all@price') {
                const marketData = parsed.push.pub.data;
                if (marketData && marketData.symbol === 'USDTTMN') {
                    latestWallexUsdtPrice = Math.ceil(Number(marketData.price));
                    
                    // 👈 این خط را موقتاً اضافه کنید تا مطمئن شوید قیمت از والکس می‌رسد
                    console.log('🟢 [Wallex WS] قیمت جدید تتر دریافت شد:', latestWallexUsdtPrice);
                }
            }
        } catch (e) {}
    });

module.exports = { testServerConnection, createClient, deleteClient, renewClient, getClientTraffic, generateAllConfigs, getUsdtRate, getCloudflareZones, getDnsRecords, updateDnsRecord, getClientActiveInboundIds, addRewardToClient, applyGroupCompensation, getServerTrafficMap, adminModifyClient, deleteClientByEmailAndUuid };