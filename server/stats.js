'use strict';
/*
 * Visitor stats service: reads the logs of all sites (only what is new), counts into daily totals and answers the page.
 * Free of Hostwerk internals – index.js hands in sites() (web servers with their log paths and host names); the tests
 * use sample logs in a temp folder.
 */
const fs = require('fs');
const path = require('path');
const { parseLine, classify, shortIp, isLoopback } = require('./parse');
const { Aggregator } = require('./aggregate');
const { rotated, readNew, pruneState } = require('./logs');

const DEFAULTS = { retentionDays: 400, countLocal: false, ignore: [] };

/** The counter script for your own pages: no cookies, no storage, nothing about the browser – honours Do Not Track. */
const SNIPPET = `<script>
/* Hostwerk visitor stats – no cookies, no storage, honours Do Not Track */
(function () {
  var n = navigator, l = location, last = '', first = true;
  if (n.doNotTrack == '1' || window.doNotTrack == '1' || n.globalPrivacyControl) return;
  function count() {
    if (l.pathname === last) return;
    last = l.pathname;
    var r = '';
    if (first) { try { var h = new URL(document.referrer).hostname; if (h !== l.hostname) r = h; } catch (e) {} first = false; }
    var w = window.innerWidth, d = w < 768 ? 'm' : w < 1100 ? 't' : 'd';
    fetch('/.hostwerk-count?p=' + encodeURIComponent(l.pathname) + '&r=' + encodeURIComponent(r) + '&d=' + d, { credentials: 'omit', cache: 'no-store', keepalive: true }).catch(function () {});
  }
  count();
  var push = history.pushState;
  history.pushState = function () { push.apply(this, arguments); count(); };
  addEventListener('popstate', count);
})();
</script>`;

class VisitorStats {
  /** opts: { dir, sites() → [{ id, name, engine, logs[], hosts[], roots[] }], now() } */
  constructor(opts) {
    this.dir = opts.dir;
    this.sites = opts.sites;
    this.now = opts.now || Date.now;
    fs.mkdirSync(this.dir, { recursive: true });
    this.cfg = { ...DEFAULTS, ...this.read('config.json', {}) };
    this.agg = new Aggregator(this.read('stats.json', null));
    this.state = this.read('files.json', { files: {}, gz: {} });
    this.lastScan = this.state.lastScan || 0;
    this.scanning = null;
    this.lastError = null;
  }

  read(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')); } catch { return fallback; } }
  write(name, value) {
    const f = path.join(this.dir, name);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(value));
    fs.renameSync(`${f}.tmp`, f);
  }

  /** Read everything new in all logs. Only one scan at a time – a second call waits for the running one. */
  scan() {
    if (this.scanning) return this.scanning;
    this.scanning = this.doScan().finally(() => { this.scanning = null; });
    return this.scanning;
  }

  async doScan() {
    let lines = 0;
    const ignore = (this.cfg.ignore || []).filter(Boolean);
    try {
      for (const site of this.sites()) {
        const own = new Set((site.hosts || []).map((h) => String(h).toLowerCase().replace(/^www\./, '')));
        const files = [...new Set(site.logs.flatMap((l) => rotated(l)))]
          .map((f) => { try { return { f, m: fs.statSync(f).mtimeMs }; } catch { return null; } })
          .filter(Boolean).sort((a, b) => a.m - b.m).map((x) => x.f);
        const onLine = (line) => {
          const hit = parseLine(line);
          if (!hit) return;
          if (!this.cfg.countLocal && isLoopback(hit.ip)) return;
          const c = classify(hit, hit.host ? new Set([...own, hit.host.toLowerCase().replace(/^www\./, '')]) : own);
          // Left-out paths: the requested path, and for the counter script the page it reports
          if (ignore.some((p) => hit.path.startsWith(p) || (c.path && c.path.startsWith(p)))) return;
          this.agg.add(site.id, c, hit.t, shortIp(hit.ip));
        };
        for (const f of files) {
          if (!/\.gz$/i.test(f)) { lines += await readNew(f, this.state, onLine); continue; }
          // Packed logs that cannot be unpacked are listed under "Logs read" (state.broken: path → size) instead of being
          // skipped silently – and a damaged archive never stops the other logs or gets read again and again
          let size = 0;
          try { size = fs.statSync(f).size; } catch { /* gone */ }
          const broken = this.state.broken || (this.state.broken = {});
          if (broken[f] === size) continue; // still the same damaged file
          try { lines += await readNew(f, this.state, onLine); } catch {
            const g = this.state.gz[f];
            if (g && this.state.files[g.fp]) this.state.files[g.fp].full = true; // lines before the damage are counted once
            broken[f] = size;
            continue;
          }
          if (size && !this.state.gz[f]) broken[f] = size; else delete broken[f]; // readNew skips a file without a readable first line
        }
      }
      for (const f of Object.keys(this.state.broken || {})) if (!fs.existsSync(f)) delete this.state.broken[f];
      this.lastError = null;
    } catch (e) { this.lastError = e.message; }
    this.agg.finish(this.now(), this.cfg.retentionDays);
    pruneState(this.state, this.now());
    this.lastScan = this.now();
    this.state.lastScan = this.lastScan;
    this.write('stats.json', this.agg.data);
    this.write('files.json', this.state);
    return lines;
  }

  /** Sites with their log files (for the page: which file is read, does it exist). */
  siteList() {
    return this.sites().map((s) => ({
      id: s.id, name: s.name, engine: s.engine, url: s.url || null,
      logs: [...new Set(s.logs.flatMap((l) => { const r = rotated(l); return r.length ? r : [l]; }))].map((f) => { try { const st = fs.statSync(f); return { path: f, size: st.size, ...(this.state.broken && this.state.broken[f] !== undefined ? { broken: true } : {}) }; } catch { return { path: f, size: null }; } }),
    }));
  }

  report(site, range) {
    const ids = site && site !== 'all' ? [site] : this.sites().map((s) => s.id);
    return this.agg.report(ids, ['day', 'yesterday', 'week', 'month'].includes(range) ? range : 'week', this.now());
  }

  saveSettings(b) {
    const c = { ...this.cfg };
    // An empty field (Number('') = 0) must not quietly become 30 days – the next scan would delete everything older
    if (/^\s*\d+(\.\d+)?\s*$/.test(String(b.retentionDays ?? '')) && Number(b.retentionDays) > 0) c.retentionDays = Math.min(1000, Math.max(30, Math.round(Number(b.retentionDays))));
    if (typeof b.countLocal === 'boolean') c.countLocal = b.countLocal;
    if (Array.isArray(b.ignore)) c.ignore = [...new Set(b.ignore.map((x) => String(x).trim()).filter((x) => /^\/[^\s]{0,200}$/.test(x)))].slice(0, 50);
    this.cfg = c;
    this.write('config.json', c);
    return c;
  }

  /** Start from scratch: forget all numbers and read positions – the logs that still exist are read again. */
  reset() {
    this.agg = new Aggregator(null);
    this.state = { files: {}, gz: {} };
    this.write('stats.json', this.agg.data);
    this.write('files.json', this.state);
  }

  /**
   * Put an empty ".hostwerk-count" into the site folders, so the counter script gets "200" instead of "404"
   * (some servers write every 404 into the error log). Existing files stay untouched.
   */
  counterFiles() {
    const out = [];
    for (const s of this.sites()) {
      for (const root of s.roots || []) {
        const f = path.join(root, '.hostwerk-count');
        try {
          if (!fs.statSync(root).isDirectory()) continue;
          if (!fs.existsSync(f)) fs.writeFileSync(f, '');
          out.push(f);
        } catch { /* folder missing */ }
      }
    }
    return out;
  }
}

module.exports = { VisitorStats, SNIPPET, DEFAULTS };
