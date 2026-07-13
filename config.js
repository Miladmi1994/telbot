const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const GROUP_ID = process.env.GROUP_ID;
const TOPIC_TEST = process.env.TOPIC_TEST;
const TOPIC_PAYMENT = process.env.TOPIC_PAYMENT;
const TOPIC_ERROR = process.env.TOPIC_ERROR;
const TOPIC_SUPPORT = process.env.TOPIC_SUPPORT;
const ADMIN_IDS = [process.env.ADMIN_ID || '278963307'];

const userSteps = new Map();
const adminSteps = new Map(); 

// کانفیگ همراه اول
const sampleConfig = 'vmess://ew0KICAidiI6ICIyIiwNCiAgInBzIjogIkZhc3RseSAyfEhlc2FtIFx1RDgzQ1x1REQ5NFx1RDgzQ1x1RERGM1x1RDgzQ1x1RERGMSIsDQogICJhZGQiOiAiMTY3LjgyLjkyLjE0NSIsDQogICJwb3J0IjogIjgwIiwNCiAgImlkIjogIjAxOTdlNTBiLTU2MmEtN2U2Yi04OWIwLWI2Yjg3YjcxNjFiMyIsDQogICJhaWQiOiAiMCIsDQogICJzY3kiOiAiYXV0byIsDQogICJuZXQiOiAieGh0dHAiLA0KICAidHlwZSI6ICJhdXRvIiwNCiAgImhvc3QiOiAiemVuc29mdHdhcmUtbmFtZS5nbG9iYWwuc3NsLmZhc3RseS5uZXQiLA0KICAicGF0aCI6ICIvQ3lwaGVyU3lzdGVtQ29uZmlnIiwNCiAgInRscyI6ICIiLA0KICAic25pIjogIiIsDQogICJhbHBuIjogIiIsDQogICJmcCI6ICIiDQp9';

// کانفیگ ایرانسل (به صورت فشرده و یک‌خطی برای کپی راحت)
const sampleConfigMtn = '{"dns":{"servers":["1.1.1.1","8.8.8.8"],"tag":"dns-module"},"inbounds":[{"listen":"127.0.0.1","port":10808,"protocol":"socks","settings":{"auth":"noauth","udp":true,"userLevel":8},"sniffing":{"destOverride":["http","tls","quic"],"enabled":true,"routeOnly":true},"tag":"socks"}],"outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"8.209.105.99","port":443,"users":[{"encryption":"none","flow":"","id":"3ed9f21d-c6cd-441c-8bd1-916e40104095","level":8}]}]},"streamSettings":{"finalmask":{"tcp":[{"settings":{"delay":"2-4","length":"20-25","packets":"tlshello"},"type":"fragment"}],"udp":[{"settings":{"noise":[{"delay":"10-16","rand":"10-20"}]},"type":"noise"}]},"network":"xhttp","security":"tls","tlsSettings":{"allowInsecure":false,"alpn":["h3","h2"],"fingerprint":"chrome","serverName":"css.2net.ir","show":false},"xhttpSettings":{"host":"","mode":"packet-up","path":"/Cypher_Net"}},"tag":"proxy"},{"protocol":"freedom","streamSettings":{"network":"tcp","sockopt":{"domainStrategy":"UseIP"}},"tag":"direct"},{"protocol":"blackhole","settings":{"response":{"type":"http"}},"tag":"block"},{"protocol":"dns","tag":"dns-out"}],"remarks":"CypherNET💎|Milad🇮🇹","routing":{"domainStrategy":"IPIfNonMatch","rules":[{"inboundTag":["socks"],"outboundTag":"dns-out","port":"53","type":"field"},{"network":"udp","outboundTag":"block","port":"443","type":"field"},{"domain":["geosite:ir"],"outboundTag":"direct","type":"field"},{"ip":["geoip:ir"],"outboundTag":"direct","type":"field"},{"outboundTag":"proxy","network":"tcp,udp","type":"field"}]}}';

module.exports = {
    GROUP_ID, TOPIC_TEST, TOPIC_PAYMENT, TOPIC_ERROR, TOPIC_SUPPORT, 
    ADMIN_IDS,userSteps, adminSteps, sampleConfig, sampleConfigMtn,
    CF_API_TOKEN: process.env.CF_API_TOKEN
};