'use strict';
/*
 * Daily totals per site – the only thing that is stored. No single requests, no IP addresses.
 *
 * Visitors: per day and site a hash of (daily random salt + shortened IP + browser group + system group + device).
 * The salt changes every day and is thrown away two days later – after that nobody (not even this PC) can tell
 * whether two days came from the same person. Only the count stays.
 *
 * Counter script: when it reports for a day, that day counts its numbers (more exact, also single-page apps) instead
 * of the page requests in the log – never both.
 */
const crypto = require('crypto');

const MAX_KEYS = 300; // per list and day (pages, sources …) – the smallest ones become "(other)"
const OPEN_DAYS = 2; // visitor hashes are kept this long (late log lines still count right), then only the count

const pad = (n) => String(n).padStart(2, '0');
/** Day key in local time: 2026-10-21 */
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const emptyPart = () => ({ views: 0, visitors: 0, hours: Array(24).fill(0), pages: {}, refs: {}, devices: {}, browsers: {}, os: {} });
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

function compact(map, max = MAX_KEYS) {
  const e = Object.entries(map);
  if (e.length <= max) return map;
  e.sort((a, b) => b[1] - a[1]);
  const out = Object.fromEntries(e.slice(0, max - 1));
  out['(other)'] = (out['(other)'] || 0) + e.slice(max - 1).reduce((n, [, v]) => n + v, 0);
  return out;
}

class Aggregator {
  /** data: stored object { sites: { id: { days: { day: Day } } }, open: { 'site|day|part': { salt, keys[] } } } */
  constructor(data) {
    this.data = data && data.sites ? data : { v: 1, sites: {}, open: {} };
    if (!this.data.open) this.data.open = {};
    this.sets = new Map(); // 'site|day|part' → { salt, keys: Set }
    for (const [k, o] of Object.entries(this.data.open)) this.sets.set(k, { salt: o.salt, keys: new Set(o.keys) });
  }

  day(site, day) {
    const s = this.data.sites[site] || (this.data.sites[site] = { days: {} });
    return s.days[day] || (s.days[day] = { log: emptyPart(), bots: 0, nf: {} });
  }

  /** Count one sorted request (from classify) with the time and shortened IP of its line. */
  add(site, c, t, ip) {
    if (c.kind === 'skip') return;
    const key = dayKey(t);
    const d = this.day(site, key);
    if (c.kind === 'bot') { d.bots++; return; }
    if (c.kind === 'notfound') { inc(d.nf, c.path); return; }
    const partName = c.kind === 'beacon' ? 'beacon' : 'log';
    const p = d[partName] || (d[partName] = emptyPart());
    p.views++;
    p.hours[new Date(t).getHours()]++;
    inc(p.pages, c.path);
    if (c.ref) inc(p.refs, c.ref);
    // A visitor counts once per day – device, browser and system with the first view of the day
    const sk = `${site}|${key}|${partName}`;
    let set = this.sets.get(sk);
    if (!set) { set = { salt: crypto.randomBytes(16).toString('hex'), keys: new Set() }; this.sets.set(sk, set); }
    const h = crypto.createHash('sha256').update(`${set.salt}|${ip}|${c.browser}|${c.os}|${c.device}`).digest('base64url').slice(0, 12);
    if (!set.keys.has(h)) {
      set.keys.add(h);
      p.visitors++;
      inc(p.devices, c.device);
      inc(p.browsers, c.browser);
      inc(p.os, c.os);
    }
  }

  /** After a scan: shorten long lists, forget visitor hashes of older days, drop days past the retention. */
  finish(now = Date.now(), retentionDays = 400) {
    const keepOpen = new Set(Array.from({ length: OPEN_DAYS }, (_, i) => dayKey(now - i * 86400000)));
    this.data.open = {};
    for (const [k, s] of this.sets) {
      if (keepOpen.has(k.split('|')[1])) this.data.open[k] = { salt: s.salt, keys: [...s.keys] };
      else this.sets.delete(k);
    }
    const oldest = dayKey(now - (retentionDays - 1) * 86400000);
    for (const s of Object.values(this.data.sites)) {
      for (const [day, d] of Object.entries(s.days)) {
        if (day < oldest) { delete s.days[day]; continue; }
        d.nf = compact(d.nf, 100);
        for (const p of [d.log, d.beacon].filter(Boolean)) for (const k of ['pages', 'refs']) p[k] = compact(p[k]);
      }
    }
    return this.data;
  }

  /**
   * Numbers for the page: range 'day' (today by hour), 'week' (7 days), 'month' (30 days), with the period before for
   * comparison. sites: list of site ids (all when empty).
   */
  report(sites, range = 'week', now = Date.now()) {
    const ids = sites && sites.length ? sites : Object.keys(this.data.sites);
    const len = range === 'day' ? 1 : range === 'month' ? 30 : 7;
    const days = Array.from({ length: len }, (_, i) => dayKey(now - (len - 1 - i) * 86400000));
    const prevDays = Array.from({ length: len }, (_, i) => dayKey(now - (2 * len - 1 - i) * 86400000));
    // Per day: the counter script's numbers if it reported that day, else the log's
    const part = (d) => (d.beacon && d.beacon.views ? d.beacon : d.log);
    const sum = { views: 0, visitors: 0, bots: 0 };
    const prev = { views: 0, visitors: 0 };
    const lists = { pages: {}, refs: {}, devices: {}, browsers: {}, os: {}, nf: {} };
    const hours = Array(24).fill(0);
    let beacon = false;
    const series = days.map((day) => ({ day, views: 0, visitors: 0 }));
    for (const id of ids) {
      const s = this.data.sites[id];
      if (!s) continue;
      days.forEach((day, i) => {
        const d = s.days[day];
        if (!d) return;
        const p = part(d);
        if (p === d.beacon) beacon = true;
        series[i].views += p.views; series[i].visitors += p.visitors;
        sum.views += p.views; sum.visitors += p.visitors; sum.bots += d.bots;
        p.hours.forEach((n, h) => { hours[h] += n; });
        for (const k of ['pages', 'refs', 'devices', 'browsers', 'os']) for (const [x, n] of Object.entries(p[k])) inc(lists[k], x, n);
        for (const [x, n] of Object.entries(d.nf)) inc(lists.nf, x, n);
      });
      for (const day of prevDays) { const d = s.days[day]; if (d) { const p = part(d); prev.views += p.views; prev.visitors += p.visitors; } }
    }
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
    return {
      range, days,
      totals: sum, prev,
      series: range === 'day' ? hours.map((views, h) => ({ hour: h, views })) : series,
      pages: top(lists.pages, 20), refs: top(lists.refs, 12), devices: top(lists.devices, 3), browsers: top(lists.browsers, 8), os: top(lists.os, 8), notFound: top(lists.nf, 10),
      beacon,
      hasData: Object.values(this.data.sites).some((s) => Object.keys(s.days).length > 0),
    };
  }
}

module.exports = { Aggregator, dayKey, compact, MAX_KEYS };
