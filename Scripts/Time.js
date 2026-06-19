// ==UserScript==
// @name         Timezone spoof with worker patch (VPN sync)
// @namespace    local.tz.spoof
// @version      1.3
// @description  Spoof timezone in page and worker realms, synced from VPN exit IP. Fixed for CreepJS Timezone test.
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

  function isUtcLike(tz) {
    return UTC_LIKE.has(tz);
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
    function installTimezoneSpoof(targetTZ) {
      'use strict';

      const NativeIntl = globalThis.Intl;
      const NativeDTF = NativeIntl.DateTimeFormat;
      const nativeResolved = NativeDTF.prototype.resolvedOptions;
      const nativeDateToString = Date.prototype.toString;
      const nativeGetTimezoneOffset = Date.prototype.getTimezoneOffset;

      // Better offset calculator using spoofed TZ
      function offsetMinutesForTimeZone(timeZone, date = new Date()) {
        const d = date instanceof Date ? date : new Date(date);
        try {
          const parts = NativeIntl.DateTimeFormat('en-US', {
            timeZone,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }).formatToParts(d);

          const map = {};
          for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;

          const utc = Date.UTC(
            Number(map.year),
            Number(map.month) - 1,
            Number(map.day),
            Number(map.hour),
            Number(map.minute),
            Number(map.second)
          );
          return Math.round((d.getTime() - utc) / 60000);
        } catch (_) {
          return 0; // fallback UTC
        }
      }

      function copyStatics(dst, src) {
        for (const key of Object.getOwnPropertyNames(src)) {
          if (key === 'prototype') continue;
          try {
            const desc = Object.getOwnPropertyDescriptor(src, key);
            if (desc) Object.defineProperty(dst, key, desc);
          } catch (_) {}
        }
      }

      function withTZ(options) {
        const o = options ? { ...options } : {};
        if (!('timeZone' in o) || o.timeZone == null) o.timeZone = targetTZ;
        return o;
      }

      // Fake DateTimeFormat
      function FakeDateTimeFormat(locale, options) {
        return new NativeDTF(locale, withTZ(options));
      }
      FakeDateTimeFormat.prototype = NativeDTF.prototype;
      Object.setPrototypeOf(FakeDateTimeFormat, NativeDTF);
      copyStatics(FakeDateTimeFormat, NativeDTF);

      try {
        Object.defineProperty(NativeDTF.prototype, 'resolvedOptions', {
          value: function () {
            const ro = nativeResolved.call(this);
            return { ...ro, timeZone: targetTZ };
          },
          configurable: true,
          writable: true
        });
      } catch (_) {}

      try {
        NativeIntl.DateTimeFormat = FakeDateTimeFormat;
      } catch (_) {}

      // getTimezoneOffset
      try {
        Object.defineProperty(Date.prototype, 'getTimezoneOffset', {
          value: function () {
            return offsetMinutesForTimeZone(targetTZ, this);
          },
          configurable: true,
          writable: true
        });
      } catch (_) {}

      // Improved toString - tries to reflect spoofed TZ
      try {
        Object.defineProperty(Date.prototype, 'toString', {
          value: function () {
            try {
              const offset = this.getTimezoneOffset();
              const sign = offset > 0 ? '-' : '+';
              const absOffset = Math.abs(offset);
              const hh = String(Math.floor(absOffset / 60)).padStart(2, '0');
              const mm = String(absOffset % 60).padStart(2, '0');
              const tzName = targetTZ === 'UTC' ? 'UTC' : targetTZ.split('/').pop() || 'UTC';
              // Mimic common native format
              return nativeDateToString.call(this)
                .replace(/\(.+?\)/, `(${tzName})`)
                .replace(/[+-]\d{4}/, `${sign}${hh}${mm}`);
            } catch (_) {
              return nativeDateToString.call(this);
            }
          },
          configurable: true,
          writable: true
        });
      } catch (_) {}

      // Extra safety for other Date methods that might leak
      try {
        const nativeToLocaleString = Date.prototype.toLocaleString;
        Object.defineProperty(Date.prototype, 'toLocaleString', {
          value: function (locales, options) {
            return nativeToLocaleString.call(this, locales, withTZ(options));
          },
          configurable: true,
          writable: true
        });
      } catch (_) {}
    }

    const INSTALLER_SRC = installTimezoneSpoof.toString();
    const SPOOF_CALL = '(' + INSTALLER_SRC + ')(' + JSON.stringify(targetTZ) + ');';
    const MARKER = '/*__TZ_SPOOF__*/\n';

    const PAGE_SOURCE = `
(() => {
  'use strict';
  const SPOOF_CALL = ${JSON.stringify(SPOOF_CALL)};
  const MARKER = ${JSON.stringify(MARKER)};

  const NativeBlob = Blob;
  const NativeWorker = Worker;
  const NativeSharedWorker = typeof SharedWorker === 'function' ? SharedWorker : null;
  const nativeRegister = navigator.serviceWorker?.register?.bind(navigator.serviceWorker);

  Function(SPOOF_CALL)();

  function looksLikeJSBlob(parts, type) {
    const t = String(type || '').toLowerCase();
    if (t.includes('javascript') || t.includes('ecmascript')) return true;
    let text = '';
    for (const p of parts || []) if (typeof p === 'string') text += p;
    return /Intl\\.DateTimeFormat|postMessage|importScripts|getTimezoneOffset|new\\s+Worker|SharedWorker|serviceWorker/i.test(text);
  }

  function wrapSource(sourceText) {
    const s = String(sourceText || '');
    if (s.startsWith(MARKER)) return s;
    return MARKER + SPOOF_CALL + '\\n' + s;
  }

  // ... (rest of your original worker/blob/serviceworker patching code stays exactly the same)
  function loadTextSync(url) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', String(url), false);
    xhr.send(null);
    if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) return xhr.responseText;
    throw new Error('HTTP ' + xhr.status);
  }

  function decodeDataUrl(dataUrl) {
    const comma = dataUrl.indexOf(',');
    if (comma === -1) throw new Error('Invalid data URL');
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

        let sourceText = null;
        if (url.startsWith('data:')) {
          sourceText = decodeDataUrl(url);
        } else {
          sourceText = loadTextSync(url);
        }

        const patchedBlob = new NativeBlob([wrapSource(sourceText)], { type: 'application/javascript' });
        return new NativeCtor(URL.createObjectURL(patchedBlob), options);
      } catch (_) {
        return new NativeCtor(scriptURL, options);
      }
    };
    Patched.prototype = NativeCtor.prototype;
    Object.setPrototypeOf(Patched, NativeCtor);
    return Patched;
  }

  const PatchedWorker = makePatchedWorkerCtor(NativeWorker);
  try { window.Worker = PatchedWorker; } catch (_) {}

  if (NativeSharedWorker) {
    const PatchedSharedWorker = makePatchedWorkerCtor(NativeSharedWorker);
    try { window.SharedWorker = PatchedSharedWorker; } catch (_) {}
  }

  try {
    function PatchedBlob(parts, options) {
      const type = options && options.type ? String(options.type) : '';
      if (looksLikeJSBlob(parts, type)) {
        parts = [wrapSource('')].concat(parts);
      }
      return new NativeBlob(parts, options);
    }
    PatchedBlob.prototype = NativeBlob.prototype;
    Object.setPrototypeOf(PatchedBlob, NativeBlob);
    for (const key of Object.getOwnPropertyNames(NativeBlob)) {
      if (key === 'prototype') continue;
      try {
        const desc = Object.getOwnPropertyDescriptor(NativeBlob, key);
        if (desc) Object.defineProperty(PatchedBlob, key, desc);
      } catch (_) {}
    }
    window.Blob = PatchedBlob;
  } catch (_) {}

  if (nativeRegister) {
    navigator.serviceWorker.register = async function (scriptURL, options) {
      try {
        const url = String(scriptURL);
        const resp = await fetch(url, { credentials: 'include' });
        const sourceText = await resp.text();
        const patchedBlob = new NativeBlob([wrapSource(sourceText)], { type: 'application/javascript' });
        return nativeRegister(URL.createObjectURL(patchedBlob), options);
      } catch (_) {
        return nativeRegister(scriptURL, options);
      }
    };
  }
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
