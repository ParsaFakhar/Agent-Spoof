const FALLBACK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
let uaList = [];
let uaMapping = {};

// 1. Initialize and fetch UA list
async function init() {
    try {
        let data = await browser.storage.local.get(["uaList", "uaMapping"]);
        uaMapping = data.uaMapping || {};
        uaList = data.uaList || [];
        
        if (uaList.length === 0) {
            let res = await fetch("https://cdn.jsdelivr.net/gh/microlinkhq/top-user-agents@master/src/desktop.json");
            uaList = await res.json();
            await browser.storage.local.set({ uaList });
        }
    } catch (e) {
        console.error("UA Bridge Init Error:", e);
        uaList = [FALLBACK_UA];
    }
}
init();

// 2. Helper to extract clean domain
function getDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) { return null; }
}

// 3. Get or assign UA (Auto-rotates every 24 hours)
function getUA(url) {
    let domain = getDomain(url);
    if (!domain || domain === 'localhost' || domain.endsWith('.local')) return null;
    
    let now = Date.now();
    let entry = uaMapping[domain];
    
    // If no entry, or entry is older than 24 hours, rotate
    if (!entry || !entry.ua || (now - (entry.ts || 0) > 86400000)) {
        let randomUA = uaList.length > 0 ? uaList[Math.floor(Math.random() * uaList.length)] : FALLBACK_UA;
        uaMapping[domain] = { ua: randomUA, ts: now };
        browser.storage.local.set({ uaMapping }); // Save asynchronously
    }
    return uaMapping[domain].ua;
}

// 4. Intercept HTTP Headers & Set Cookie
browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        if (details.url.startsWith('moz-extension://') || details.url.startsWith('chrome-extension://')) return {};
        
        let ua = getUA(details.url);
        if (!ua) return {};
        
        // Drop cookie ONLY on main page loads so Tampermonkey can read it synchronously
        if (details.type === 'main_frame') {
            try {
                browser.cookies.set({
                    url: details.url,
                    path: "/",
                    name: "__spoof_ua",
                    value: encodeURIComponent(ua),
                    expirationDate: Math.floor(Date.now() / 1000) + 86400
                }).catch(()=>{});
            } catch(e) {}
        }
        
        // Rewrite HTTP Header
        let headers = details.requestHeaders || [];
        headers = headers.filter(h => h.name.toLowerCase() !== 'user-agent');
        headers.push({ name: "User-Agent", value: ua });
        
        return { requestHeaders: headers };
    },
    { urls: ["<all_urls>"] },
    ["blocking", "requestHeaders"]
);
