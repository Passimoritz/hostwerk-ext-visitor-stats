'use strict';
/*
 * Reading one line of an access log and sorting it – pure functions, tested with sample logs.
 *   Apache and nginx write the "combined" format (Hostwerk sets it up that way), Caddy writes JSON lines.
 * Privacy: IP addresses are shortened right here (IPv4 → /24, IPv6 → /48); the full address never leaves this module.
 * Devices, browsers and systems only in coarse groups – nothing that could tell two people apart.
 */

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// host ident user [time] "request" status bytes "referer" "user agent" – quotes inside are escaped (\" or \x22)
const COMBINED = /^(\S+) \S+ \S+ \[([^\]]+)\] "((?:[^"\\]|\\.)*)" (\d{3}) (\S+)(?: "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)")?/;
const BEACON = '/.hostwerk-count';

/** 10/Oct/2026:13:55:36 +0200 → milliseconds */
function parseClf(s) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s);
  if (!m || MONTHS[m[2]] === undefined) return NaN;
  const off = (Number(m[8]) * 60 + Number(m[9])) * (m[7] === '-' ? -1 : 1);
  return Date.UTC(Number(m[3]), MONTHS[m[2]], Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - off * 60000;
}

const unescape = (s) => (s ? s.replace(/\\x([0-9a-f]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, '$1') : '');
const dash = (s) => (s === '-' ? '' : s);

function splitTarget(target) {
  const i = target.indexOf('?');
  return i < 0 ? { path: target, query: '' } : { path: target.slice(0, i), query: target.slice(i + 1) };
}

/** One line → { t, ip, method, path, query, status, ref, ua, host } or null (not a request line). */
function parseLine(line) {
  if (!line) return null;
  if (line[0] === '{') return parseCaddy(line);
  const m = COMBINED.exec(line);
  if (!m) return null;
  const t = parseClf(m[2]);
  if (!Number.isFinite(t)) return null;
  const req = unescape(m[3]).split(' ');
  if (req.length < 2) return null;
  return { t, ip: m[1], method: req[0], ...splitTarget(req[1]), status: Number(m[4]), ref: dash(unescape(m[6] || '')), ua: dash(unescape(m[7] || '')), host: '' };
}

/** Caddy's JSON access log (one object per line). */
function parseCaddy(line) {
  let j;
  try { j = JSON.parse(line); } catch { return null; }
  const r = j && j.request;
  if (!r || !r.uri || !j.status) return null;
  const h = r.headers || {};
  const first = (k) => { const v = h[k] || h[k.toLowerCase()]; return Array.isArray(v) ? String(v[0] || '') : String(v || ''); };
  const t = typeof j.ts === 'number' ? Math.round(j.ts * 1000) : Date.parse(j.ts);
  if (!Number.isFinite(t)) return null;
  return { t, ip: r.client_ip || r.remote_ip || '', method: r.method || 'GET', ...splitTarget(r.uri), status: Number(j.status), ref: first('Referer'), ua: first('User-Agent'), host: String(r.host || '').replace(/:\d+$/, '') };
}

/** IPv4 → a.b.c.0, IPv6 → first three groups (::/48). Loopback is recognised before shortening. */
function shortIp(ip) {
  let s = String(ip || '').trim().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (mapped) s = mapped[1];
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(s);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  if (s.includes(':')) {
    const [head, tail] = s.split('::');
    const a = head ? head.split(':') : [];
    const b = tail !== undefined && tail ? tail.split(':') : [];
    const full = tail !== undefined ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
    return `${full.slice(0, 3).map((x) => x.toLowerCase() || '0').join(':')}::`;
  }
  return '';
}

const isLoopback = (ip) => { const s = String(ip || '').replace(/^::ffff:/i, ''); return /^127\./.test(s) || s === '::1' || s === 'localhost'; };

// Robots, link previews, monitors, scripts and Hostwerk's own checks – not people
const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|archiver|scan|curl|wget|python|httpclient|http-client|okhttp|java\/|go-http|axios|node-fetch|undici|^node$|headless|lighthouse|pagespeed|gtmetrix|monitor|uptime|pingdom|statuscake|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|hostwerk|feedfetcher|rss|validator|checker|bingpreview|petalbot|semrush|ahrefs|mj12|dotbot|yandex|baidu|sogou|bytespider|gptbot|claudebot|ccbot|perplexity|amazonbot|applebot|duckduckbot|googleother|google-inspectiontool|mediapartners|adsbot/i;
// Typical probes for weak spots – always robots
const PROBE = /^\/(wp-login\.php|wp-admin|xmlrpc\.php|\.env|\.git|phpmyadmin|pma|cgi-bin|boaform|vendor\/phpunit|HNAP1|owa|\.aws|actuator|server-status)/i;
const ASSET = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac|m4a|pdf|zip|gz|tgz|rar|7z|json|xml|txt|csv|wasm|webmanifest|apk|exe|dmg|iso)$/i;
const IGNORE = /^\/(favicon\.ico|robots\.txt|sitemap[\w-]*\.xml|apple-touch-icon[\w-]*\.png|\.well-known\/)/i;

function device(ua) {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|Opera Mini/i.test(ua)) return 'mobile';
  return 'desktop';
}
function browser(ua) {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS|Chromium/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  return 'Other';
}
function system(ua) {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod|CPU (iPhone )?OS/.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return 'Other';
}

/** Host of a referrer, without "www." – '' for none or an own address (then it is not a source). */
function refHost(ref, own) {
  if (!ref) return '';
  let h;
  try { h = new URL(ref).hostname.toLowerCase(); } catch { return ''; }
  h = h.replace(/^www\./, '');
  if (!h || own.has(h) || own.has(`www.${h}`) || h === 'localhost' || /^127\./.test(h) || h === '[::1]') return '';
  return h;
}

const qs = (query) => { try { return new URLSearchParams(query); } catch { return new URLSearchParams(); } };

/**
 * Sort a parsed request: → { kind: 'view'|'beacon'|'notfound'|'bot'|'skip', path, ref, device, browser, os }
 * own: Set of the site's own host names (referrers from there are internal links, not sources).
 */
function classify(hit, own = new Set()) {
  const ua = hit.ua || '';
  if (!ua || BOT_UA.test(ua) || PROBE.test(hit.path)) return { kind: 'bot' };
  const base = { device: device(ua), browser: browser(ua), os: system(ua) };
  if (hit.path === BEACON) {
    const q = qs(hit.query);
    const p = String(q.get('p') || '/').slice(0, 300);
    const d = { m: 'mobile', t: 'tablet', d: 'desktop' }[q.get('d')] || base.device;
    const r = String(q.get('r') || '').toLowerCase().replace(/^www\./, '');
    return { kind: 'beacon', ...base, device: d, path: p.startsWith('/') ? p : `/${p}`, ref: r && !own.has(r) && /^[a-z0-9.-]{1,253}$/.test(r) ? r : '' };
  }
  if (hit.method !== 'GET') return { kind: 'skip' };
  if (IGNORE.test(hit.path) || ASSET.test(hit.path)) return { kind: 'skip' };
  if (hit.status === 404) return { kind: 'notfound', path: hit.path.slice(0, 300) };
  if (!((hit.status >= 200 && hit.status < 300) || hit.status === 304)) return { kind: 'skip' };
  return { kind: 'view', ...base, path: normPath(hit.path), ref: refHost(hit.ref, own) };
}

/** /index.html and /index.php count as / – decoded, at most 300 characters. */
function normPath(p) {
  let s = p;
  try { s = decodeURI(p); } catch { /* keep */ }
  return s.replace(/\/index\.(html?|php)$/i, '/').slice(0, 300) || '/';
}

module.exports = { parseLine, parseClf, parseCaddy, shortIp, isLoopback, classify, refHost, device, browser, system, normPath, BEACON };
