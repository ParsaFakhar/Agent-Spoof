// ==UserScript==
// @name         User-Agent JS Spoof (Worker/Blob/Nav)
// @namespace    local.ua.js.spoof
// @version      2.1
// @description  Pure JS spoof relying on UA Bridge Extension for HTTP headers
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const FALLBACK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

    // 1. Read the cookie dropped by the Extension
    let SPOOF_UA = null;
    let match = document.cookie.match(/(?:^|;\s*)__spoof_ua=([^;]+)/);
    if (match) {
        try { SPOOF_UA = decodeURIComponent(match[1].trim()); } catch(e) { SPOOF_UA = match[1].trim(); }
    }

    if (!SPOOF_UA) SPOOF_UA = FALLBACK_UA;

    const MARKER = '/*__UA_WORKER_SPOOF_v2.1__*/';

    const SPOOF_INJECTOR = `
(() => {
    'use strict';
    const targetUA = ${JSON.stringify(SPOOF_UA)};
    const MARKER = ${JSON.stringify(MARKER)};

    // Dynamically derive platform/vendor based on the spoofed UA
    let derivedPlatform = 'Win32';
    let derivedVendor = 'Google Inc.';
    let derivedOscpu = undefined;
    let derivedUADPlatform = 'Windows';
    let isMobile = false;
    let hasClientHints = false;
    let brands = [];
    let uaFullVersion = "";

    if (targetUA.includes('Macintosh') || targetUA.includes('Mac OS X')) {
        derivedPlatform = 'MacIntel';
        derivedUADPlatform = 'macOS';
        if (targetUA.includes('Firefox')) {
            derivedVendor = '';
        } else if (targetUA.includes('Safari') && !targetUA.includes('Chrome')) {
            derivedVendor = 'Apple Computer, Inc.';
        } else {
            derivedVendor = 'Google Inc.';
        }
    } else if (targetUA.includes('Windows')) {
        derivedPlatform = 'Win32';
        derivedUADPlatform = 'Windows';
        if (targetUA.includes('Firefox')) {
            derivedVendor = '';
        } else {
            derivedVendor = 'Google Inc.';
        }
    } else if (targetUA.includes('Linux') && !targetUA.includes('Android')) {
        derivedPlatform = 'Linux x86_64';
        derivedUADPlatform = 'Linux';
        if (targetUA.includes('Firefox')) {
            derivedVendor = '';
        } else {
            derivedVendor = 'Google Inc.';
        }
    } else if (targetUA.includes('Android')) {
        derivedPlatform = 'Linux armv8l';
        derivedUADPlatform = 'Android';
        derivedVendor = 'Google Inc.';
        isMobile = true;
    } else if (targetUA.includes('iPhone')) {
        derivedPlatform = 'iPhone';
        derivedUADPlatform = 'iOS';
        derivedVendor = 'Apple Computer, Inc.';
        isMobile = true;
    } else if (targetUA.includes('iPad')) {
        derivedPlatform = 'MacIntel'; // iPadOS 13+ requests desktop and reports MacIntel
        derivedUADPlatform = 'iOS';
        derivedVendor = 'Apple Computer, Inc.';
    }

    // Firefox specific oscpu mapping
    if (targetUA.includes('Firefox')) {
        if (targetUA.includes('Windows NT 10.0')) derivedOscpu = 'Windows NT 10.0; Win64; x64';
        else if (targetUA.includes('Windows')) derivedOscpu = 'Windows NT 10.0; Win64; x64';
        else if (targetUA.includes('Mac OS X')) derivedOscpu = 'Intel Mac OS X 10.15';
        else if (targetUA.includes('Linux')) derivedOscpu = 'Linux x86_64';
    }

    // Client Hints (Only Chromium browsers support this)
    if (targetUA.includes('Chrome/') && !targetUA.includes('Edg/') && !targetUA.includes('OPR/')) {
        hasClientHints = true;
        const vMatch = targetUA.match(/Chrome\\/([\\d.]+)/);
        const major = vMatch ? vMatch[1].split('.')[0] : '136';
        uaFullVersion = vMatch ? vMatch[1] : '136.0.0.0';
        brands = [
            {brand: "Chromium", version: major},
            {brand: "Google Chrome", version: major},
            {brand: "Not-A.Brand", version: "99"}
        ];
    } else if (targetUA.includes('Edg/')) {
        hasClientHints = true;
        const vMatch = targetUA.match(/Edg\\/([\\d.]+)/);
        const major = vMatch ? vMatch[1].split('.')[0] : '136';
        uaFullVersion = vMatch ? vMatch[1] : '136.0.0.0';
        brands = [
            {brand: "Chromium", version: major},
            {brand: "Microsoft Edge", version: major},
            {brand: "Not-A.Brand", version: "99"}
        ];
    } else if (targetUA.includes('OPR/')) {
        hasClientHints = true;
        const vMatch = targetUA.match(/OPR\\/([\\d.]+)/);
        const major = vMatch ? vMatch[1].split('.')[0] : '136';
        uaFullVersion = vMatch ? vMatch[1] : '136.0.0.0';
        brands = [
            {brand: "Chromium", version: major},
            {brand: "Opera", version: major},
            {brand: "Not-A.Brand", version: "99"}
        ];
    }

    function spoofNavigator() {
        const nav = self.navigator;

        try {
            const handler = {
                get(target, prop) {
                    switch (prop) {
                        case 'userAgent': return targetUA;
                        case 'userAgentData':
                            // Safari and Firefox DO NOT have this property. Returning it is an instant red flag for fingerprinters.
                            if (!hasClientHints) return undefined;
                            return {
                                brands: brands,
                                mobile: isMobile,
                                platform: derivedUADPlatform,
                                getHighEntropyValues: () => Promise.resolve({
                                    platform: derivedUADPlatform,
                                    platformVersion: derivedUADPlatform === 'Windows' ? '10.0.0' : (derivedUADPlatform === 'macOS' ? '10.15.7' : '1.0.0'),
                                    architecture: derivedPlatform.includes('x86') || derivedPlatform.includes('Win') || derivedPlatform.includes('Mac') ? 'x86' : 'arm',
                                    model: '',
                                    uaFullVersion: uaFullVersion,
                                    fullVersionList: brands.map(b => ({brand: b.brand, version: uaFullVersion}))
                                })
                            };
                        case 'platform': return derivedPlatform;
                        case 'appVersion': return targetUA.replace(/^Mozilla\\//, '');
                        case 'appName': return 'Netscape';
                        case 'vendor': return derivedVendor;
                        case 'oscpu': return derivedOscpu;
                        default: return target[prop];
                    }
                }
            };
            const proxied = new Proxy(nav, handler);
            Object.defineProperty(self, 'navigator', {
                value: proxied,
                configurable: false,
                writable: false
            });
            return;
        } catch (e) {}

        try {
            Object.defineProperties(nav, {
                userAgent: { get: () => targetUA, configurable: false },
                platform: { get: () => derivedPlatform, configurable: false },
                appVersion: { get: () => targetUA.replace(/^Mozilla\\//, ''), configurable: false },
                appName: { get: () => 'Netscape', configurable: false },
                vendor: { get: () => derivedVendor, configurable: false },
                oscpu: { get: () => derivedOscpu, configurable: false }
            });
        } catch (_) {}
    }

    spoofNavigator();
    setTimeout(spoofNavigator, 10);
    setTimeout(spoofNavigator, 100);
})();
`;

    const FULL_SPOOF_CODE = SPOOF_INJECTOR + `
(() => {
    'use strict';
    const MARKER = ${JSON.stringify(MARKER)};
    const spoofCode = ${JSON.stringify(SPOOF_INJECTOR)};

    function wrapSource(src) {
        const s = String(src || '');
        if (s.includes(MARKER)) return s;
        return MARKER + spoofCode + '\\n' + s;
    }

    Function(${JSON.stringify(SPOOF_INJECTOR)})();

    const NativeWorker = Worker;
    const NativeSharedWorker = typeof SharedWorker === 'function' ? SharedWorker : null;
    const NativeBlob = Blob;

    function patchedWorkerCtor(NativeCtor) {
        return function(scriptURL, options) {
            try {
                const urlStr = String(scriptURL);
                if (urlStr.startsWith('blob:')) return new NativeCtor(scriptURL, options);

                let source = '';
                if (urlStr.startsWith('data:')) {
                    const comma = urlStr.indexOf(',');
                    source = urlStr.slice(comma + 1);
                    if (urlStr.includes(';base64')) source = atob(source);
                    else source = decodeURIComponent(source);
                } else {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', urlStr, false);
                    xhr.send();
                    source = xhr.responseText;
                }

                const patchedBlob = new NativeBlob([wrapSource(source)], {type: 'application/javascript'});
                return new NativeCtor(URL.createObjectURL(patchedBlob), options);
            } catch (e) {
                return new NativeCtor(scriptURL, options);
            }
        };
    }

    try {
        window.Worker = patchedWorkerCtor(NativeWorker);
        Object.setPrototypeOf(window.Worker, NativeWorker);
    } catch (_) {}

    if (NativeSharedWorker) {
        try {
            window.SharedWorker = patchedWorkerCtor(NativeSharedWorker);
            Object.setPrototypeOf(window.SharedWorker, NativeSharedWorker);
        } catch (_) {}
    }

    try {
        window.Blob = function(parts, opts) {
            const type = String(opts?.type || '').toLowerCase();
            if (type.includes('javascript') || /navigator|useragent/i.test(String(parts))) {
                parts = [wrapSource('')].concat(parts || []);
            }
            return new NativeBlob(parts, opts);
        };
        window.Blob.prototype = NativeBlob.prototype;
        Object.setPrototypeOf(window.Blob, NativeBlob);
    } catch (_) {}

    if (navigator.serviceWorker?.register) {
        const nativeRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
        navigator.serviceWorker.register = async (scriptURL, opts) => {
            try {
                const r = await fetch(scriptURL);
                const text = await r.text();
                const blob = new NativeBlob([wrapSource(text)], {type: 'application/javascript'});
                return nativeRegister(URL.createObjectURL(blob), opts);
            } catch (_) {
                return nativeRegister(scriptURL, opts);
            }
        };
    }
})();
`;

    function inject() {
        const s = document.createElement('script');
        s.textContent = FULL_SPOOF_CODE;
        (document.documentElement || document.head || document).prepend(s);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject, {once: true});
    } else {
        inject();
    }

    window.forceRotate = () => {
        alert("To force a new UA immediately: Go to about:debugging -> Inspect the UA Bridge Extension -> Console -> type: browser.storage.local.clear() and hit Enter. Then reload this page.");
    };
})();
