'use strict';
/*
 * Visitor stats with sample logs (tests/fixtures): Apache/nginx combined, Caddy JSON, bots, assets, 404, loopback,
 * shortened IPs, rotation with gzip, counter script, retention and forgetting the daily salts.
 *   node --test tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const P = require('../server/parse');
const { Aggregator, dayKey, compact } = require('../server/aggregate');
const { rotated, customLogPaths, readNew } = require('../server/logs');
const { VisitorStats, SNIPPET } = require('../server/stats');
const de = require('../locales/de.json');

const FIX = path.join(__dirname, 'fixtures');
// 21 Oct 2026, 12:00 UTC – the sample lines are between 12:00 and 15:00 UTC, so the day is the same in every time zone ±9 h
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hw-visitor-stats-'));
const copy = (name, dir, as = name) => { fs.copyFileSync(path.join(FIX, name), path.join(dir, as)); return path.join(dir, as); };
const toMap = (list) => Object.fromEntries(list);

test('combined line: time with offset, escaped quotes, query split off', () => {
  const h = P.parseLine('1.2.3.4 - - [10/Oct/2026:13:55:36 +0200] "GET /a/b?c=1 HTTP/1.1" 200 12 "https://x.test/" "Mozilla \\"q\\" \\x22z\\x22"');
  assert.strictEqual(h.t, Date.UTC(2026, 9, 10, 11, 55, 36));
  assert.strictEqual(h.path, '/a/b');
  assert.strictEqual(h.query, 'c=1');
  assert.strictEqual(h.ua, 'Mozilla "q" "z"');
  assert.strictEqual(h.ref, 'https://x.test/');
  // common log format without referrer/agent, and lines that are no requests
  assert.strictEqual(P.parseLine('1.2.3.4 - - [10/Oct/2026:13:55:36 +0000] "GET / HTTP/1.0" 200 -').ua, '');
  assert.strictEqual(P.parseLine('garbage'), null);
  assert.strictEqual(P.parseLine('1.2.3.4 - - [10/Foo/2026:13:55:36 +0000] "GET / HTTP/1.0" 200 -'), null);
  assert.strictEqual(P.parseLine('{"no":"request"}'), null);
});

test('Caddy JSON line', () => {
  const line = fs.readFileSync(path.join(FIX, 'caddy_access.log'), 'utf8').split('\n')[0];
  const h = P.parseLine(line);
  assert.strictEqual(h.host, 'blog.example.test');
  assert.strictEqual(h.path, '/post/1');
  assert.strictEqual(h.ref, 'https://www.bing.com/search?q=x');
  assert.match(h.ua, /Macintosh/);
  assert.strictEqual(h.t, 1792591200500);
});

test('IP addresses are shortened, loopback recognised', () => {
  assert.strictEqual(P.shortIp('203.0.113.77'), '203.0.113.0');
  assert.strictEqual(P.shortIp('::ffff:198.51.100.9'), '198.51.100.0');
  assert.strictEqual(P.shortIp('2001:db8:1234:5678::1'), '2001:db8:1234::');
  assert.strictEqual(P.shortIp('2001:db8::1'), '2001:db8:0::');
  assert.strictEqual(P.shortIp('[2a00:1450:4001:82a::200e]'), '2a00:1450:4001::');
  assert.ok(P.isLoopback('127.0.0.1') && P.isLoopback('::1') && P.isLoopback('::ffff:127.0.0.1') && !P.isLoopback('10.0.0.1'));
});

test('sorting: bots, probes, assets, 404, own referrers, devices', () => {
  const own = new Set(['example.test']);
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const hit = (o) => ({ method: 'GET', path: '/', query: '', status: 200, ref: '', ua, ...o });
  assert.strictEqual(P.classify(hit({ ua: 'Mozilla/5.0 (compatible; bingbot/2.0)' })).kind, 'bot');
  assert.strictEqual(P.classify(hit({ ua: 'curl/8.4.0' })).kind, 'bot');
  assert.strictEqual(P.classify(hit({ ua: 'Hostwerk' })).kind, 'bot');
  assert.strictEqual(P.classify(hit({ ua: '' })).kind, 'bot');
  assert.strictEqual(P.classify(hit({ path: '/.env' })).kind, 'bot');
  assert.strictEqual(P.classify(hit({ path: '/img/logo.PNG' })).kind, 'skip');
  assert.strictEqual(P.classify(hit({ path: '/robots.txt' })).kind, 'skip');
  assert.strictEqual(P.classify(hit({ method: 'HEAD' })).kind, 'skip');
  assert.strictEqual(P.classify(hit({ status: 500 })).kind, 'skip');
  assert.deepStrictEqual(P.classify(hit({ status: 404, path: '/nope' })), { kind: 'notfound', path: '/nope' });
  assert.strictEqual(P.classify(hit({ ref: 'https://www.example.test/x' }), own).ref, '');
  assert.strictEqual(P.classify(hit({ ref: 'https://www.google.de/' }), own).ref, 'google.de');
  const c = P.classify(hit({ path: '/index.html' }), own);
  assert.deepStrictEqual([c.kind, c.path, c.device, c.browser, c.os], ['view', '/', 'desktop', 'Chrome', 'Windows']);
  assert.strictEqual(P.browser('Mozilla/5.0 ... Chrome/130.0 Safari/537.36 Edg/130.0'), 'Edge');
  assert.strictEqual(P.device('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit Chrome/130 Safari'), 'tablet');
  assert.strictEqual(P.system('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)'), 'ChromeOS');
});

test('counter script line: page, source and coarse device from the script, own host ignored', () => {
  const b = P.classify({ method: 'GET', path: P.BEACON, query: 'p=%2Fapp%2Fx&r=www.t.co&d=m', status: 404, ua: 'Mozilla/5.0 (Windows NT 10.0) Firefox/131.0' }, new Set());
  assert.deepStrictEqual([b.kind, b.path, b.ref, b.device, b.browser], ['beacon', '/app/x', 't.co', 'mobile', 'Firefox']);
  assert.strictEqual(P.classify({ method: 'GET', path: P.BEACON, query: 'p=/&r=example.test', status: 200, ua: 'Mozilla/5.0 Firefox/1' }, new Set(['example.test'])).ref, '');
  assert.match(SNIPPET, /credentials: 'omit'/);
  assert.match(SNIPPET, /doNotTrack/);
  assert.ok(!/cookie|localStorage|sessionStorage|userAgent|canvas/i.test(SNIPPET.replace(/no cookies, no storage/, '')), 'no cookies, storage or fingerprinting');
});

test('Apache sample log end to end', async () => {
  const dir = tmp();
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs);
  copy('apache_access.log', logs);
  const s = new VisitorStats({ dir: path.join(dir, 'data'), now: () => NOW, sites: () => [{ id: 'apache', name: 'Apache', engine: 'apache', logs: [path.join(logs, 'apache_access.log')], hosts: ['example.test'], roots: [] }] });
  await s.scan();
  const r = s.report('apache', 'day');
  assert.deepStrictEqual(r.totals, { views: 6, visitors: 3, bots: 3 });
  assert.deepStrictEqual(toMap(r.pages), { '/': 3, '/about.html': 2, '/blog/hallo welt': 1 });
  assert.deepStrictEqual(toMap(r.refs), { 'google.com': 1, 'duckduckgo.com': 1, 'news.ycombinator.com': 1 });
  assert.deepStrictEqual(toMap(r.devices), { desktop: 2, mobile: 1 });
  assert.deepStrictEqual(toMap(r.browsers), { Chrome: 1, Safari: 1, Firefox: 1 });
  assert.deepStrictEqual(toMap(r.os), { Windows: 1, iOS: 1, Linux: 1 });
  assert.deepStrictEqual(r.notFound, [['/missing-page', 1]]);
  assert.strictEqual(r.series.length, 24);
  assert.strictEqual(r.series.reduce((n, x) => n + x.views, 0), 6);
  // week: yesterday's visit counts too, the period before is empty
  const w = s.report('all', 'week');
  assert.strictEqual(w.totals.views, 7);
  assert.strictEqual(w.series.at(-2).views, 1);
  assert.deepStrictEqual(w.prev, { views: 0, visitors: 0 });
  // nothing new → nothing counted twice
  await s.scan();
  assert.strictEqual(s.report('apache', 'day').totals.views, 6);
  // stored data holds no IP address, no user agent
  const stored = fs.readFileSync(path.join(dir, 'data', 'stats.json'), 'utf8');
  assert.ok(!/203\.0\.113\.7|198\.51\.100\.4|2001:db8|Mozilla/.test(stored));
  // counting this PC too (setting)
  s.saveSettings({ countLocal: true });
  s.reset();
  await s.scan();
  assert.strictEqual(s.report('apache', 'day').totals.views, 7);
});

test('nginx (\\x22 escapes) and Caddy JSON; the counter script wins for its day', async () => {
  const dir = tmp();
  copy('nginx_access.log', dir);
  copy('caddy_access.log', dir);
  const s = new VisitorStats({ dir: path.join(dir, 'data'), now: () => NOW, sites: () => [
    { id: 'nginx', name: 'nginx', logs: [path.join(dir, 'nginx_access.log')], hosts: [] },
    { id: 'caddy', name: 'Caddy', logs: [path.join(dir, 'caddy_access.log')], hosts: [] },
  ] });
  await s.scan();
  const n = s.report('nginx', 'day');
  assert.strictEqual(n.totals.views, 2);
  assert.deepStrictEqual(toMap(n.devices), { mobile: 1, tablet: 1 });
  assert.deepStrictEqual(toMap(n.refs), { 't.co': 1 });
  const c = s.report('caddy', 'day');
  assert.strictEqual(c.beacon, true);
  assert.deepStrictEqual(toMap(c.pages), { '/app/settings': 1 });
  assert.deepStrictEqual(toMap(c.browsers), { Edge: 1 });
  assert.deepStrictEqual(toMap(c.devices), { mobile: 1 });
  // the log part is still there (if the script is removed again)
  const day = s.agg.data.sites.caddy.days[dayKey(NOW)];
  assert.strictEqual(day.log.views, 2);
  assert.deepStrictEqual(day.log.refs, { 'bing.com': 1 }, 'own host (from the request) is not a source');
  assert.strictEqual(s.report('all', 'day').totals.views, 3);
});

test('rotation: renamed and gzipped files keep their read position', async () => {
  const dir = tmp();
  const main = path.join(dir, 'web_access.log');
  const ua = 'Mozilla/5.0 (Windows NT 10.0) Firefox/131.0';
  const line = (i, p) => `203.0.113.${i} - - [21/Oct/2026:12:${String(i).padStart(2, '0')}:00 +0000] "GET ${p} HTTP/1.1" 200 1 "-" "${ua}"\n`;
  fs.writeFileSync(main, line(1, '/a') + line(2, '/b'));
  const s = new VisitorStats({ dir: path.join(dir, 'data'), now: () => NOW, sites: () => [{ id: 'web', name: 'Web', logs: [main], hosts: [] }] });
  await s.scan();
  assert.strictEqual(s.report('web', 'day').totals.views, 2);
  // half a line (the server is still writing) waits for the next scan
  fs.appendFileSync(main, line(3, '/c') + line(4, '/d').slice(0, 20));
  await s.scan();
  assert.strictEqual(s.report('web', 'day').totals.views, 3);
  fs.appendFileSync(main, line(4, '/d').slice(20));
  // rotation: the file is renamed and packed, a new one begins
  fs.writeFileSync(`${main}.1.gz`, zlib.gzipSync(fs.readFileSync(main)));
  fs.unlinkSync(main);
  fs.writeFileSync(main, line(5, '/e'));
  // other files in the folder are not ours
  fs.writeFileSync(path.join(dir, 'web_error.log'), line(9, '/x'));
  fs.writeFileSync(path.join(dir, 'webshop_access.log'), line(9, '/x'));
  assert.deepStrictEqual(rotated(main).map((f) => path.basename(f)).sort(), ['web_access.log', 'web_access.log.1.gz']);
  await s.scan();
  const r = s.report('web', 'day');
  assert.strictEqual(r.totals.views, 5);
  assert.deepStrictEqual(toMap(r.pages), { '/a': 1, '/b': 1, '/c': 1, '/d': 1, '/e': 1 });
  // packed file is not unpacked again when unchanged
  let reads = 0;
  await readNew(`${main}.1.gz`, s.state, () => { reads++; });
  assert.strictEqual(reads, 0);
  await s.scan();
  assert.strictEqual(s.report('web', 'day').totals.views, 5);
});

test('daily salts are forgotten after two days, old days dropped after the retention', () => {
  const a = new Aggregator(null);
  const c = { kind: 'view', path: '/', ref: '', device: 'desktop', browser: 'Chrome', os: 'Windows' };
  a.add('s', c, NOW, '203.0.113.0');
  a.add('s', c, NOW, '203.0.113.0');
  a.add('s', c, NOW - 400 * 86400000, '203.0.113.0');
  let d = a.finish(NOW, 400);
  assert.strictEqual(Object.keys(d.open).length, 1);
  assert.strictEqual(d.sites.s.days[dayKey(NOW)].log.visitors, 1);
  assert.strictEqual(d.sites.s.days[dayKey(NOW - 400 * 86400000)], undefined);
  d = a.finish(NOW + 3 * 86400000, 400);
  assert.deepStrictEqual(d.open, {}, 'salt and hashes are gone');
  assert.strictEqual(d.sites.s.days[dayKey(NOW)].log.visitors, 1, 'only the count stays');
  // a stored state reloads its open hashes (visitor stays one visitor after a restart)
  const fresh = new Aggregator(null);
  fresh.add('s', c, NOW, '203.0.113.0');
  const b = new Aggregator(JSON.parse(JSON.stringify(fresh.finish(NOW, 400))));
  b.add('s', c, NOW, '203.0.113.0');
  b.add('s', { ...c, browser: 'Firefox' }, NOW, '203.0.113.0');
  assert.strictEqual(b.data.sites.s.days[dayKey(NOW)].log.visitors, 2);
});

test('long lists are shortened to the biggest entries plus "(other)"', () => {
  const m = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`/p${i}`, i + 1]));
  const out = compact(m, 4);
  assert.deepStrictEqual(out, { '/p9': 10, '/p8': 9, '/p7': 8, '(other)': 28 });
});

test('log paths from the web server\'s own settings', () => {
  const base = path.join(os.tmpdir(), 'conf');
  const apache = 'CustomLog "logs/extra_access.log" combined\n# CustomLog "/commented.log" combined\nCustomLog "|/usr/bin/rotatelogs x" combined';
  const nginx = 'server {\n  access_log /var/log/nginx/site.log;\n  access_log off;\n}';
  const caddy = 'site.test {\n  log {\n    output file "C:/logs/site.log"\n  }\n}';
  const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(base, p));
  assert.deepStrictEqual(customLogPaths(apache, base), [path.resolve(base, 'logs/extra_access.log')]);
  assert.deepStrictEqual(customLogPaths(nginx, base), [abs('/var/log/nginx/site.log')]);
  assert.deepStrictEqual(customLogPaths(caddy, base), [abs('C:/logs/site.log')]);
});

test('settings are checked, counter files only where missing', () => {
  const dir = tmp();
  const root = path.join(dir, 'htdocs');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, '.hostwerk-count'), 'keep');
  const root2 = path.join(dir, 'blog');
  fs.mkdirSync(root2);
  const s = new VisitorStats({ dir: path.join(dir, 'data'), now: () => NOW, sites: () => [{ id: 'a', name: 'A', logs: [], roots: [root, root2, path.join(dir, 'gone')] }] });
  const c = s.saveSettings({ retentionDays: 5, ignore: ['/admin', 'nope', '/x y'], bogus: 1 });
  assert.deepStrictEqual(c, { retentionDays: 30, countLocal: false, ignore: ['/admin'] });
  assert.strictEqual(s.counterFiles().length, 2);
  assert.strictEqual(fs.readFileSync(path.join(root, '.hostwerk-count'), 'utf8'), 'keep');
  assert.strictEqual(fs.readFileSync(path.join(root2, '.hostwerk-count'), 'utf8'), '');
});

test('every German text has a value', () => {
  for (const [k, v] of Object.entries(de)) if (k !== '$patterns') assert.ok(typeof v === 'string' && v.trim(), k);
});
