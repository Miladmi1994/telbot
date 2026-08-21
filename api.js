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

async function createClient(email, totalGB, expiryDays, server) {
    const apiClient = getApiClient(server);
    const uuid = crypto.randomUUID();
    const subId = crypto.randomBytes(8).toString('hex');

    const totalByte = totalGB === 0 ? 0 : Math.floor(totalGB * 1073741824);
    const expiryTime = expiryDays === 0 ? 0 : Date.now() + Math.floor(expiryDays * 24 * 60 * 60 * 1000);

    if (!server.inbounds || server.inbounds.length === 0) {
        console.error("❌ No inbounds defined for this server.");
        return false;
    }

    const inboundIds = server.inbounds.map(inb => inb.id);

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
        await apiClient.post(`panel/api/clients/del/${identifier}`);
        return true;
    } catch (error) {
        return false;
    }
}

async function getClientTraffic(email, server = null) {
    const apiClient = getApiClient(server);
    try {
        let total = 0, up = 0, down = 0, expiryTime = 0;
        let found = false;

        // ۱. تلاش اول: اندپوینت مخصوص ترافیک (سبک‌تر و سریع‌تر)
        try {
            const res = await apiClient.get(`panel/api/clients/traffic/${encodeURIComponent(email)}`);
            if (res.data && res.data.success && res.data.obj) {
                const obj = res.data.obj;
                total = obj.total || 0;
                up = obj.up || 0;
                down = obj.down || 0;
                expiryTime = obj.expiryTime || 0;
                found = true;
            }
        } catch (e) {
            // اگر خطا داد (مثلاً 404 یا 500)، silently به مرحله fallback می‌رود
        }

        // ۲. تلاش دوم: اندپوینت دریافت اطلاعات کامل کلاینت (Fallback)
        if (!found) {
            const clientRes = await apiClient.get(`panel/api/clients/get/${encodeURIComponent(email)}`);
            if (clientRes.data && clientRes.data.success && clientRes.data.obj) {
                const obj = clientRes.data.obj;
                
                // ✅ اصلاح باگ: در 3x-ui مقادیر up و down مستقیماً داخل obj هستند
                total = obj.total || 0; // مقدار total در API همیشه بر حسب بایت است
                expiryTime = obj.expiryTime || 0;
                up = obj.up || 0;       // <--- اصلاح شد (حذف obj.traffic)
                down = obj.down || 0;   // <--- اصلاح شد (حذف obj.traffic)
                found = true;
            }
        }

        // ۳. اگر در هر دو حالت پیدا نشد، یعنی کلاینت در پنل وجود ندارد (حذف شده)
        if (!found) {
            return null; 
        }

        return { total, up, down, expiryTime };
        
    } catch (error) {
        // خطای کلی شبکه (مثلاً خاموش بودن کامل سرور، DNS مشکل‌دار یا ECONNREFUSED)
        // در این حالت undefined برمی‌گرداند تا سیستم Sync Job بداند این یک خطای موقتی شبکه است
        // و نباید کاربر را به اشتباه "حذف‌شده" در نظر بگیرد.
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

async function renewClient(uuid, oldEmail, newEmail, totalGB, expiryDays, server) {
    const apiClient = getApiClient(server);

    const totalByte = totalGB === 0 ? 0 : Math.floor(totalGB * 1073741824);
    const expiryTime = expiryDays === 0 ? 0 : Date.now() + Math.floor(expiryDays * 24 * 60 * 60 * 1000);
    const subId = crypto.randomBytes(8).toString('hex');

    if (!server.inbounds || server.inbounds.length === 0) {
        return { success: false, log: 'اینباندی برای این سرور یافت نشد.' };
    }

    const inboundIds = server.inbounds.map(inb => inb.id);

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

// تغییر در generateAllConfigs
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
        }
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