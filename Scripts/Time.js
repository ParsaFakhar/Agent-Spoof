// ==UserScript==
// @name         Timezone spoof with worker+iframe realm patch (VPN sync)
// @namespace    local.tz.spoof
// @version      1.4
// @description  Spoof timezone in page, worker, AND iframe realms, synced from VPN exit IP. Hardened against iframe-realm-bypass detection (CreepJS-style).
// @match        *://*/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      ipwho.is
// @connect      ipapi.co
// @connect      get.geojs.io
// @connect      ip-api.com
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'tz_spoof_target';
  const FALLBACK_TZ = 'UTC';
  const TEHRAN_TZ = 'Asia/Tehran';
  const AUTO_RELOAD_ON_UPDATE = true;
  const UTC_LIKE = new Set(['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT', 'Etc/GMT+0']);

  const LOOKUPS = [
    { url: 'https://ipwho.is/?fields=success,timezone', parse: (d) => (d && d.success ? d.timezone : null) },
    { url: 'https://ipapi.co/json/', parse: (d) => (d ? (d.timezone || d.time_zone || d.tz || null) : null) },
    { url: 'https://get.geojs.io/v1/ip/geo.json', parse: (d) => (d ? (d.timezone || d.tz || null) : null) },
    { url: 'https://ip-api.com/json/?fields=status,timezone', parse: (d) => (d && d.status === 'success' ? d.timezone : null) }
  ];

  function normalizeTimezone(tz) {
    if (typeof tz !== 'string') return FALLBACK_TZ;
    const clean = tz.trim();
    if (!clean) return FALLBACK_TZ;
    if (clean === TEHRAN_TZ || clean.toUpperCase().includes('TEHRAN')) return FALLBACK_TZ;
    return clean;
  }

  function getCachedTimezone() {
    try {
      return normalizeTimezone(GM_getValue(STORAGE_KEY, FALLBACK_TZ));
    } catch (_) {
      return FALLBACK_TZ;
    }
  }

  function setCachedTimezone(tz) {
    try {
      GM_setValue(STORAGE_KEY, normalizeTimezone(tz));
    } catch (_) {}
  }

  function gmRequestJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 8000,
        headers: { Accept: 'application/json' },
        onload: (res) => {
          try {
            if (res.status < 200 || res.status >= 300) throw new Error('HTTP ' + res.status);
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(e);
          }
        },
        onerror: () => reject(new Error('request failed')),
        ontimeout: () => reject(new Error('request timed out'))
      });
    });
  }

  async function lookupTimezoneFromVpn() {
    for (const src of LOOKUPS) {
      try {
        const data = await gmRequestJson(src.url);
        const raw = src.parse(data);
        const tz = normalizeTimezone(raw);
        if (tz) return tz;
      } catch (_) {}
    }
    return null;
  }

  function refreshTimezoneCache() {
    lookupTimezoneFromVpn()
      .then((tz) => {
        if (!tz) return;
        const previous = getCachedTimezone();
        const fixed = normalizeTimezone(tz);
        setCachedTimezone(fixed);
        if (AUTO_RELOAD_ON_UPDATE && previous !== fixed && window.top === window && !window.__tz_spoof_reloaded__) {
          window.__tz_spoof_reloaded__ = true;
          location.reload();
        }
      })
      .catch(() => {});
  }

  const TARGET_TZ = getCachedTimezone();
  injectPageSpoof(TARGET_TZ);
  refreshTimezoneCache();

  function injectPageSpoof(targetTZ) {
    // Everything below runs in TRUE page context (via injected <script>), not the
    // Tampermonkey GM-sandbox, so prototype patches are visible to page scripts
    // and to any fingerprinting library running on the page.
    const PAGE_SOURCE = `
(() => {
  'use strict';
  const TARGET_TZ = ${JSON.stringify(targetTZ)};

  // ---- 1. Core patch: applies spoofed Intl/Date to a given window-like realm ----
  function installTimezoneSpoof(realmWindow, targetTZ) {
    try {
      const NativeIntl = realmWindow.Intl;
      const NativeDTF = NativeIntl.DateTimeFormat;
      const nativeResolved = NativeDTF.prototype.resolvedOptions;
      const NativeDate = realmWindow.Date;
      const nativeDateToString = NativeDate.prototype.toString;
      const nativeToLocaleString = NativeDate.prototype.toLocaleString;

      function offsetMinutesForTimeZone(timeZone, date) {
        const d = date instanceof NativeDate ? date : new NativeDate(date);
        try {
          const parts = new NativeIntl.DateTimeFormat('en-US', {
            timeZone, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          }).formatToParts(d);
          const map = {};
          for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
          const utc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day),
                                Number(map.hour), Number(map.minute), Number(map.second));
          return Math.round((d.getTime() - utc) / 60000);
        } catch (_) { return 0; }
      }

      function copyStatics(dst, src) {
        for (const key of Object.getOwnPropertyNames(src)) {
          if (key === 'prototype') continue;
          try {
            const d = Object.getOwnPropertyDescriptor(src, key);
            if (d) Object.defineProperty(dst, key, d);
          } catch (_) {}
        }
      }

      function withTZ(options) {
        const o = options ? Object.assign({}, options) : {};
        if (o.timeZone === undefined || o.timeZone === null) o.timeZone = targetTZ;
        return o;
      }

      function FakeDateTimeFormat(locale, options) {
        return new NativeDTF(locale, withTZ(options));
      }
      FakeDateTimeFormat.prototype = NativeDTF.prototype;
      Object.setPrototypeOf(FakeDateTimeFormat, NativeDTF);
      copyStatics(FakeDateTimeFormat, NativeDTF);

      Object.defineProperty(NativeDTF.prototype, 'resolvedOptions', {
        value: function () {
          const ro = nativeResolved.call(this);
          return Object.assign({}, ro, { timeZone: targetTZ });
        },
        configurable: true, writable: true
      });

      realmWindow.Intl.DateTimeFormat = FakeDateTimeFormat;

      Object.defineProperty(NativeDate.prototype, 'getTimezoneOffset', {
        value: function () { return offsetMinutesForTimeZone(targetTZ, this); },
        configurable: true, writable: true
      });

      Object.defineProperty(NativeDate.prototype, 'toString', {
        value: function () {
          try {
            const offset = this.getTimezoneOffset();
            const sign = offset > 0 ? '-' : '+';
            const abs = Math.abs(offset);
            const hh = String(Math.floor(abs / 60)).padStart(2, '0');
            const mm = String(abs % 60).padStart(2, '0');
            const tzName = targetTZ === 'UTC' ? 'UTC' : (targetTZ.split('/').pop() || 'UTC');
            return nativeDateToString.call(this)
              .replace(/\\(.+?\\)/, '(' + tzName + ')')
              .replace(/[+-]\\d{4}/, sign + hh + mm);
          } catch (_) { return nativeDateToString.call(this); }
        },
        configurable: true, writable: true
      });

      Object.defineProperty(NativeDate.prototype, 'toLocaleString', {
        value: function (locales, options) {
          return nativeToLocaleString.call(this, locales, withTZ(options));
        },
        configurable: true, writable: true
      });

      // Newer Temporal API (if the engine ships it) reports the OS zone directly
      // unless patched too.
      if (realmWindow.Temporal && realmWindow.Temporal.Now) {
        try {
          Object.defineProperty(realmWindow.Temporal.Now, 'timeZoneId', {
            value: function () { return targetTZ; },
            configurable: true, writable: true
          });
        } catch (_) {}
      }
    } catch (_) {}
  }

  // ---- 2. Worker/Blob/ServiceWorker patch: spawns inherit the spoof via source rewrite ----
  function patchWorkerAndBlob(realmWindow, targetTZ) {
    try {
      if (realmWindow.__tzWorkerPatched__) return;
      realmWindow.__tzWorkerPatched__ = true;

      const installerSrc = installTimezoneSpoof.toString();
      const spoofCall = '(' + installerSrc + ')(self, ' + JSON.stringify(targetTZ) + ');';
      const MARKER = '/*__TZ_SPOOF__*/\\n';

      function wrapSource(src) {
        const s = String(src || '');
        if (s.startsWith(MARKER)) return s;
        return MARKER + spoofCall + '\\n' + s;
      }

      const NativeBlob = realmWindow.Blob;
      const NativeWorker = realmWindow.Worker;
      const NativeSharedWorker = typeof realmWindow.SharedWorker === 'function' ? realmWindow.SharedWorker : null;
      const swContainer = realmWindow.navigator && realmWindow.navigator.serviceWorker;
      const nativeRegister = swContainer && swContainer.register ? swContainer.register.bind(swContainer) : null;

      function loadTextSync(url) {
        const xhr = new realmWindow.XMLHttpRequest();
        xhr.open('GET', String(url), false);
        xhr.send(null);
        if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) return xhr.responseText;
        throw new Error('HTTP ' + xhr.status);
      }

      function decodeDataUrl(dataUrl) {
        const comma = dataUrl.indexOf(',');
        if (comma === -1) throw new Error('bad data url');
        const meta = dataUrl.slice(5, comma);
        let body = dataUrl.slice(comma + 1);
        if (meta.includes(';base64')) body = atob(body);
        else body = decodeURIComponent(body);
        return body;
      }

      function makePatchedWorkerCtor(NativeCtor) {
        const Patched = function (scriptURL, options) {
          try {
            const url = String(scriptURL);
            if (url.startsWith('blob:')) return new NativeCtor(scriptURL, options);
            const sourceText = url.startsWith('data:') ? decodeDataUrl(url) : loadTextSync(url);
            const blob = new NativeBlob([wrapSource(sourceText)], { type: 'application/javascript' });
            return new NativeCtor(realmWindow.URL.createObjectURL(blob), options);
          } catch (_) {
            return new NativeCtor(scriptURL, options);
          }
        };
        Patched.prototype = NativeCtor.prototype;
        Object.setPrototypeOf(Patched, NativeCtor);
        return Patched;
      }

      try { realmWindow.Worker = makePatchedWorkerCtor(NativeWorker); } catch (_) {}
      if (NativeSharedWorker) {
        try { realmWindow.SharedWorker = makePatchedWorkerCtor(NativeSharedWorker); } catch (_) {}
      }

      try {
        function PatchedBlob(parts, options) {
          const type = options && options.type ? String(options.type) : '';
          if (/javascript|ecmascript/i.test(type)) parts = [wrapSource('')].concat(parts || []);
          return new NativeBlob(parts, options);
        }
        PatchedBlob.prototype = NativeBlob.prototype;
        Object.setPrototypeOf(PatchedBlob, NativeBlob);
        realmWindow.Blob = PatchedBlob;
      } catch (_) {}

      if (nativeRegister) {
        swContainer.register = async function (scriptURL, options) {
          try {
            const resp = await realmWindow.fetch(scriptURL, { credentials: 'include' });
            const sourceText = await resp.text();
            const blob = new NativeBlob([wrapSource(sourceText)], { type: 'application/javascript' });
            return nativeRegister(realmWindow.URL.createObjectURL(blob), options);
          } catch (_) {
            return nativeRegister(scriptURL, options);
          }
        };
      }
    } catch (_) {}
  }

  // ---- 3. Iframe realm patch: THE actual fix for the Asia/Tehran leak ----
  // CreepJS-style checkers grab a fresh, unpatched Intl/Date by creating an
  // about:blank or srcdoc iframe and reading iframe.contentWindow.Intl directly.
  // Tampermonkey's @match never fires inside about:blank/srcdoc frames (no
  // scheme://), so those realms never get the spoof above. We close that gap by
  // hooking the contentWindow/contentDocument getters on HTMLIFrameElement, so
  // ANY code (the page's own JS, or the fingerprint script itself) that pulls a
  // reference to an iframe's window gets a pre-patched realm, no matter how or
  // when that iframe was created.
  function patchIframeRealms(realmWindow, targetTZ) {
    try {
      const proto = realmWindow.HTMLIFrameElement.prototype;
      const winDesc = Object.getOwnPropertyDescriptor(proto, 'contentWindow');
      if (!winDesc || !winDesc.get || !winDesc.configurable) return;
      const nativeWinGet = winDesc.get;

      const docDesc = Object.getOwnPropertyDescriptor(proto, 'contentDocument');
      const nativeDocGet = docDesc && docDesc.get;

      function patchRealm(win) {
        if (!win) return;
        try {
          if (win.__tzRealmPatched__) return;
          win.__tzRealmPatched__ = true;
        } catch (_) { return; } // cross-origin frame, nothing we can (or need to) do
        installTimezoneSpoof(win, targetTZ);
        patchWorkerAndBlob(win, targetTZ);
        patchIframeRealms(win, targetTZ); // handle grandchild iframes too
      }

      Object.defineProperty(proto, 'contentWindow', {
        configurable: true,
        get: function () {
          const win = nativeWinGet.call(this);
          patchRealm(win);
          return win;
        }
      });

      if (nativeDocGet) {
        Object.defineProperty(proto, 'contentDocument', {
          configurable: true,
          get: function () {
            const doc = nativeDocGet.call(this);
            try { if (doc && doc.defaultView) patchRealm(doc.defaultView); } catch (_) {}
            return doc;
          }
        });
      }
    } catch (_) {}
  }

  installTimezoneSpoof(window, TARGET_TZ);
  patchWorkerAndBlob(window, TARGET_TZ);
  patchIframeRealms(window, TARGET_TZ);
})();
`;

    function inject(code) {
      const parent = document.documentElement || document.head || document.body || document;
      if (!parent) {
        window.addEventListener('DOMContentLoaded', () => inject(code), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.textContent = code;
      parent.appendChild(s);
      s.remove();
    }

    inject(PAGE_SOURCE);
  }
})();
