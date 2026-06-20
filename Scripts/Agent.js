// ==UserScript==
// @name         User-Agent JS Spoof (Realm/Worker/Blob/Nav)
// @namespace    local.ua.js.spoof
// @version      3.0
// @description  Pure JS spoof relying on UA Bridge Extension. Hardened against CreepJS Worker/Iframe bypasses.
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

    // === CORE SPOOF LOGIC (Stringified to avoid scope issues) ===
    const SPOOF_LOGIC = `
        'use strict';
        if (self.__ua_spoof_applied__) return;
        self.__ua_spoof_applied__ = true;

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
            if (targetUA.includes('Firefox')) derivedVendor = '';
            else if (targetUA.includes('Safari') && !targetUA.includes('Chrome')) derivedVendor = 'Apple Computer, Inc.';
            else derivedVendor = 'Google Inc.';
        } else if (targetUA.includes('Windows')) {
            derivedPlatform = 'Win32';
            derivedUADPlatform = 'Windows';
            if (targetUA.includes('Firefox')) derivedVendor = '';
            else derivedVendor = 'Google Inc.';
        } else if (targetUA.includes('Linux') && !targetUA.includes('Android')) {
            derivedPlatform = 'Linux x86_64';
            derivedUADPlatform = 'Linux';
            if (targetUA.includes('Firefox')) derivedVendor = '';
            else derivedVendor = 'Google Inc.';
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
            derivedPlatform = 'MacIntel';
            derivedUADPlatform = 'iOS';
            derivedVendor = 'Apple Computer, Inc.';
        }

        if (targetUA.includes('Firefox')) {
            if (targetUA.includes('Windows')) derivedOscpu = 'Windows NT 10.0; Win64; x64';
            else if (targetUA.includes('Mac OS X')) derivedOscpu = 'Intel Mac OS X 10.15';
            else if (targetUA.includes('Linux')) derivedOscpu = 'Linux x86_64';
        }

        if (targetUA.includes('Chrome/') && !targetUA.includes('Edg/') && !targetUA.includes('OPR/')) {
            hasClientHints = true;
            const vMatch = targetUA.match(/Chrome\\/([\\d.]+)/);
            const major = vMatch ? vMatch[1].split('.')[0] : '136';
            uaFullVersion = vMatch ? vMatch[1] : '136.0.0.0';
            brands = [{brand: "Chromium", version: major}, {brand: "Google Chrome", version: major}, {brand: "Not-A.Brand", version: "99"}];
        } else if (targetUA.includes('Edg/')) {
            hasClientHints = true;
            const vMatch = targetUA.match(/Edg\\/([\\d.]+)/);
            const major = vMatch ? vMatch[1].split('.')[0] : '136';
            uaFullVersion = vMatch ? vMatch[1] : '136.0.0.0';
            brands = [{brand: "Chromium", version: major}, {brand: "Microsoft Edge", version: major}, {brand: "Not-A.Brand", version: "99"}];
        } else if (targetUA.includes('OPR/')) {
            hasClientHints = true;
            const vMatch = targetUA.match(/OPR\\/([\\d.]+)/);
            const major = vMatch ? vMatch[1].split('.')[0] : '136';
            uaFullVersion = vMatch ? vMatch[1] : '136.0.0.0';
            brands = [{brand: "Chromium", version: major}, {brand: "Opera", version: major}, {brand: "Not-A.Brand", version: "99"}];
        }

        const nav = self.navigator;
        if (nav) {
            try {
                const handler = {
                    get(target, prop) {
                        switch (prop) {
                            case 'userAgent': return targetUA;
                            case 'userAgentData':
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
                    configurable: true,
                    writable: true
                });
            } catch (e) {
                try {
                    Object.defineProperties(nav, {
                        userAgent: { get: () => targetUA, configurable: true },
                        platform: { get: () => derivedPlatform, configurable: true },
                        appVersion: { get: () => targetUA.replace(/^Mozilla\\//, ''), configurable: true },
                        appName: { get: () => 'Netscape', configurable: true },
                        vendor: { get: () => derivedVendor, configurable: true },
                        oscpu: { get: () => derivedOscpu, configurable: true }
                    });
                } catch (_) {}
            }
        }

        // === SELF-REPLICATING HOOKS ===
        const NativeBlob = self.Blob;
        const NativeWorker = self.Worker;
        const NativeSharedWorker = self.SharedWorker;

        function wrapWorkerSource(sourceText) {
            const s = String(sourceText || '');
            if (s.includes('/*UA_SPOOF_MARKER*/')) return s;
            const injectionCode = '(function(targetUA, SPOOF_SRC){' + SPOOF_SRC + '})(' + JSON.stringify(targetUA) + ', SPOOF_SRC);';
            return '/*UA_SPOOF_MARKER*/\\n' + injectionCode + '\\n' + s;
        }

        if (NativeBlob) {
            const PatchedBlob = function(parts, opts) {
                const type = (opts && opts.type || '').toLowerCase();
                const isJS = type.includes('javascript') || type.includes('ecmascript') || type.includes('text/') || type === '';
                if (isJS) {
                    let hasMarker = false;
                    for(const p of (parts||[])) if (typeof p==='string' && p.includes('/*UA_SPOOF_MARKER*/')) { hasMarker=true; break; }
                    if (!hasMarker) {
                        const inject = '(function(targetUA, SPOOF_SRC){' + SPOOF_SRC + '})(' + JSON.stringify(targetUA) + ', SPOOF_SRC);';
                        parts = [inject].concat(parts || []);
                    }
                }
                return new NativeBlob(parts, opts);
            };
            PatchedBlob.prototype = NativeBlob.prototype;
            Object.setPrototypeOf(PatchedBlob, NativeBlob);
            try { self.Blob = PatchedBlob; } catch(_) {}

            // Catch fetch().blob() bypass
            if (self.Response && self.Response.prototype && self.Response.prototype.blob) {
                const nativeBlobMethod = self.Response.prototype.blob;
                self.Response.prototype.blob = async function() {
                    const blob = await nativeBlobMethod.call(this);
                    const type = (blob.type || '').toLowerCase();
                    if (type.includes('javascript') || type.includes('ecmascript') || type.includes('text/') || type === '') {
                        try {
                            const text = await blob.text();
                            if (!text.includes('/*UA_SPOOF_MARKER*/')) {
                                const inject = '(function(targetUA, SPOOF_SRC){' + SPOOF_SRC + '})(' + JSON.stringify(targetUA) + ', SPOOF_SRC);\\n';
                                return new NativeBlob([inject + text], { type: blob.type || 'application/javascript' });
                            }
                        } catch(e) {}
                    }
                    return blob;
                };
            }
        }

        if (NativeWorker) {
            const PatchedWorker = function(scriptURL, opts) {
                try {
                    const url = String(scriptURL);
                    if (url.startsWith('blob:')) return new NativeWorker(scriptURL, opts);
                    let source = null;
                    if (url.startsWith('data:')) {
                        const comma = url.indexOf(',');
                        if (comma !== -1) {
                            const meta = url.slice(5, comma);
                            let body = url.slice(comma + 1);
                            body = meta.includes(';base64') ? (self.atob?atob(body):body) : decodeURIComponent(body);
                            source = body;
                        }
                    } else if (self.XMLHttpRequest) {
                        const xhr = new XMLHttpRequest();
                        xhr.open('GET', url, false);
                        xhr.send();
                        if ((xhr.status>=200 && xhr.status<300) || xhr.status===0) source = xhr.responseText;
                    }
                    if (source !== null && !source.includes('/*UA_SPOOF_MARKER*/')) {
                        const inject = '(function(targetUA, SPOOF_SRC){' + SPOOF_SRC + '})(' + JSON.stringify(targetUA) + ', SPOOF_SRC);\\n';
                        const blob = new NativeBlob([inject + source], {type:'application/javascript'});
                        return new NativeWorker(URL.createObjectURL(blob), opts);
                    }
                } catch(e) {}
                return new NativeWorker(scriptURL, opts);
            };
            PatchedWorker.prototype = NativeWorker.prototype;
            Object.setPrototypeOf(PatchedWorker, NativeWorker);
            try { self.Worker = PatchedWorker; } catch(_) {}
        }

        if (NativeSharedWorker) {
            const PatchedSharedWorker = function(scriptURL, opts) {
                try {
                    const url = String(scriptURL);
                    if (url.startsWith('blob:')) return new NativeSharedWorker(scriptURL, opts);
                    let source = null;
                    if (url.startsWith('data:')) {
                        const comma = url.indexOf(',');
                        if (comma !== -1) {
                            const meta = url.slice(5, comma);
                            let body = url.slice(comma + 1);
                            body = meta.includes(';base64') ? (self.atob?atob(body):body) : decodeURIComponent(body);
                            source = body;
                        }
                    } else if (self.XMLHttpRequest) {
                        const xhr = new XMLHttpRequest();
                        xhr.open('GET', url, false);
                        xhr.send();
                        if ((xhr.status>=200 && xhr.status<300) || xhr.status===0) source = xhr.responseText;
                    }
                    if (source !== null && !source.includes('/*UA_SPOOF_MARKER*/')) {
                        const inject = '(function(targetUA, SPOOF_SRC){' + SPOOF_SRC + '})(' + JSON.stringify(targetUA) + ', SPOOF_SRC);\\n';
                        const blob = new NativeBlob([inject + source], {type:'application/javascript'});
                        return new NativeSharedWorker(URL.createObjectURL(blob), opts);
                    }
                } catch(e) {}
                return new NativeSharedWorker(scriptURL, opts);
            };
            PatchedSharedWorker.prototype = NativeSharedWorker.prototype;
            Object.setPrototypeOf(PatchedSharedWorker, NativeSharedWorker);
            try { self.SharedWorker = PatchedSharedWorker; } catch(_) {}
        }

        // === IFRAME REALM TRAP ===
        if (self.document && self.HTMLIFrameElement) {
            function patchIframe(iframe) {
                try {
                    if (iframe.contentWindow && !iframe.contentWindow.__ua_spoof_applied__) {
                        const s = iframe.contentDocument.createElement('script');
                        s.textContent = '(function(targetUA, SPOOF_SRC){' + SPOOF_SRC + '})(' + JSON.stringify(targetUA) + ', SPOOF_SRC);';
                        (iframe.contentDocument.head || iframe.contentDocument).appendChild(s);
                        s.remove();
                    }
                } catch(e) {}
            }

            ['appendChild','insertBefore','replaceChild'].forEach(method => {
                const native = self.Node.prototype[method];
                if (native) {
                    self.Node.prototype[method] = function(...args) {
                        const res = native.apply(this, args);
                        const child = args[0];
                        if (child && child.nodeName === 'IFRAME') patchIframe(child);
                        else if (child && child.querySelectorAll) {
                            child.querySelectorAll('iframe').forEach(patchIframe);
                        }
                        return res;
                    };
                }
            });

            const desc = Object.getOwnPropertyDescriptor(self.HTMLIFrameElement.prototype, 'contentWindow');
            if (desc && desc.get) {
                Object.defineProperty(self.HTMLIFrameElement.prototype, 'contentWindow', {
                    get: function() {
                        const win = desc.get.call(this);
                        if (win && !win.__ua_spoof_applied__) {
                            try {
                                const s = win.document.createElement('script');
                                s.textContent = '(function(targetUA, SPOOF_SRC){' + SPOOF_SRC + '})(' + JSON.stringify(targetUA) + ', SPOOF_SRC);';
                                (win.document.head || win.document).appendChild(s);
                                s.remove();
                            } catch(e) {}
                        }
                        return win;
                    }, configurable: true
                });
            }
        }
    `;

    const INJECTOR = `(function(targetUA, SPOOF_SRC) { ${SPOOF_LOGIC} })`;

    // Inject into main thread
    const script = document.createElement('script');
    script.textContent = `(${INJECTOR})(${JSON.stringify(SPOOF_UA)}, ${JSON.stringify(SPOOF_LOGIC)});`;
    (document.documentElement || document.head || document).prepend(script);
    script.remove();

    window.forceRotate = () => {
        alert("To force a new UA immediately: Go to about:debugging -> Inspect the UA Bridge Extension -> Console -> type: browser.storage.local.clear() and hit Enter. Then reload this page.");
    };
})();
