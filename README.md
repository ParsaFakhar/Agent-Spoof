# 🕵️ Agent-Spoof

A semi-advanced Firefox fingerprint spoofing setup designed to improve consistency between browser-level and JavaScript-level fingerprint surfaces.

## Features

- 🔄 Rotating User-Agent spoofing
- 🌐 Domain-consistent User-Agent persistence
- 🧩 Worker, Blob Worker, and Navigator User-Agent patching
- 🕒 Timezone spoofing with Worker support
- 🔐 VPN-aware timezone synchronization
- 🛡️ Fallback protection against common timezone leaks
- 🖥️ Desktop Firefox support

> [!NOTE]
> Desktop Firefox only.

> [!WARNING]
> Read the **Timezone Configuration** section before using the timezone script.

> [!WARNING]
> Use GeoSpoof Add-on to prevent WebTRC Leaks for TimeZone (Will fix it, in future)
---

# Why This Exists

Most User-Agent or timezone spoofing solutions only modify the obvious browser surfaces.

Modern fingerprinting frameworks such as **CreepJS** perform JavaScript execution inside:

- Dedicated Workers
- Blob Workers
- Nested execution contexts

to retrieve values that many spoofing extensions fail to patch.

As a result, your browser may report:

- A spoofed User-Agent in the main page
- Your real User-Agent inside Workers
- A spoofed timezone in the main page
- Your real timezone inside Workers

This mismatch is highly fingerprintable.

Agent-Spoof attempts to keep these surfaces synchronized.

---

# Installation

## 1. Install Tampermonkey

Install the Tampermonkey extension for Firefox.

## 2. Import the Scripts

From the `Scripts` folder:

- Import `Agent.js`
- Import `Time.js`

**Important:** Import them as **separate scripts**.

Do **not** merge them together.

## 3. Load the Extension

Open:

```

about:debugging

```

Navigate to:

```

This Firefox

```

Click:

```

Load Temporary Add-on...

```

Select:

```

Extension/manifest.json

````

## 4. Enable Everything

- Enable both Tampermonkey scripts.
- Ensure the extension is loaded.

## 5. Verify

Test your setup using:

- https://abrahamjuliot.github.io/creepjs/
- https://creepjs.org/checker
- https://www.whatismybrowser.com/

---

# How It Works

## The Problem

Fingerprinting frameworks do not trust values exposed directly through:

```js
navigator.userAgent
````

Instead, they execute code inside Workers and compare the results.

Example:

```js
const blob = new Blob([`
postMessage({
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  offset: new Date().getTimezoneOffset(),
  lang: navigator.language
})
`]);

const worker = new Worker(URL.createObjectURL(blob));

worker.onmessage = e => console.log(e.data);
```

Many Firefox spoofing extensions fail to patch this execution context.

Running code like the example above may reveal your:

* Real timezone
* Real locale
* Real User-Agent

even when the main page appears spoofed.

---

## Why Use Tampermonkey?

Tampermonkey executes very early in the page lifecycle and is well-suited for intercepting:

* Worker()
* Blob Workers
* Navigator properties
* JavaScript fingerprinting surfaces

This makes Worker patching significantly easier.

However, Tampermonkey cannot modify:

```http
User-Agent:
```

HTTP request headers.

---

## The Solution

The project splits responsibilities:

### Extension

Responsible for:

* HTTP User-Agent spoofing
* User-Agent rotation
* Storing the selected User-Agent in a cookie (`_spoof`)

### Tampermonkey

Responsible for:

* Worker patching
* Blob Worker patching
* Navigator spoofing
* Reading the `_spoof` cookie
* Applying the same User-Agent inside JavaScript contexts

This ensures that:

```text
HTTP User-Agent
=
Navigator User-Agent
=
Worker User-Agent
=
Blob Worker User-Agent
```

which significantly reduces inconsistencies.

---

## User-Agent Source

User-Agents are fetched from:

https://microlink.io/user-agents

---

## Timezone Spoofing

The timezone script:

1. Detects your public Geo-IP location.
2. Determines the corresponding timezone.
3. Applies timezone spoofing.
4. Patches Worker contexts to prevent leaks.

Additional configuration is required before first use.

See the section below.

---

# Design Choice

## Why Separate the Extension and Script?

Instead of creating one large extension, the project separates responsibilities between:

* Extension = Brain
* Tampermonkey = Muscle

### Comparison

| Feature                | Hybrid (Extension + Tampermonkey) | All-in-One Extension           |
| ---------------------- | --------------------------------- | ------------------------------ |
| Complexity             | Medium                            | Low                            |
| Worker / Blob Patching | Excellent                         | Good                           |
| Rotation Logic         | Easy (GM_setValue)                | More Complex (browser.storage) |
| Debugging              | Easy                              | Harder                         |
| Portability            | Requires Tampermonkey             | Extension Only                 |
| Detection Risk         | Very Low                          | Very Low                       |

The hybrid design was chosen primarily because Worker patching is easier to develop, debug, and maintain through Tampermonkey.

---

# Timezone Configuration

> [!CAUTION]
> This step is mandatory.

Before importing `Time.js` into Tampermonkey, locate the following constant:

```js
const TEHRAN_TZ = 'Asia/Tehran';
```

Replace:

```js
Asia/Tehran
```

with **your real timezone so when not using a VPN, the Fallback Logic set your Time to UTC**.

Examples:

### London

```js
const TEHRAN_TZ = 'Europe/London';
```

### New York

```js
const TEHRAN_TZ = 'America/New_York';
```

### Berlin

```js
const TEHRAN_TZ = 'Europe/Berlin';
```

### Tokyo

```js
const TEHRAN_TZ = 'Asia/Tokyo';
```

Do **not** rename the variable:

```js
TEHRAN_TZ
```

Only change the timezone string.

---

# Limitations

* Firefox only.
* Desktop only.
* Temporary extension loading must be repeated after browser restart.
* HTTP header spoofing requires the extension.
* Worker spoofing requires the Tampermonkey scripts.
* Incorrect timezone configuration may introduce fingerprint inconsistencies.

---

# Disclaimer

This project is intended for browser fingerprint research, testing, and privacy experimentation.

No spoofing solution can guarantee 100% anonymity or perfect resistance against advanced fingerprinting systems.
