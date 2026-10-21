'use strict';
/*
 * Native part of "Visitor stats" (SDK 2.7):
 *   GET    /api/visitor-stats?site=all|<id>&range=day|week|month → sites, report, settings, last scan, counter script
 *   GET    /api/visitor-stats/tile                                → today and the last 7 days (overview tile)
 *   POST   /api/visitor-stats/scan                                → read new log lines now
 *   PUT    /api/visitor-stats/settings                            → { retentionDays, countLocal, ignore[] }
 *   POST   /api/visitor-stats/counter-file                        → empty ".hostwerk-count" into the site folders
 *   DELETE /api/visitor-stats/data                                → forget all numbers and read again
 * Reads the access logs Hostwerk's web servers write (path from the web server configuration) every 5 minutes.
 * Offers "visitorStats" (report, sites) to other extensions.
 */
const fs = require('fs');
const path = require('path');
const { VisitorStats, SNIPPET } = require('./stats');
const { customLogPaths } = require('./logs');

const EVERY = 5 * 60 * 1000;
let stats = null;
let timer = null;
let first = null;

/** Web servers of Hostwerk with log paths, own host names and site folders. */
function siteSource(ctx) {
  return () => (ctx.web ? ctx.web.list() : []).map((inst) => {
    const logs = [path.join(ctx.paths.logs, `${inst.id}_access.log`)];
    // Own log lines in the web server's custom settings ("Eigene Einstellungen") count too
    const confDir = path.join(ctx.paths.config, inst.id);
    for (const f of ['eigene-einstellungen.conf', 'eigene-einstellungen.caddy']) {
      try { logs.push(...customLogPaths(fs.readFileSync(path.join(confDir, f), 'utf8'), confDir)); } catch { /* none */ }
    }
    const vhosts = (inst.vhosts || []).filter((v) => v && v.domain);
    const hosts = vhosts.flatMap((v) => [v.domain, ...String(v.aliases || '').split(/\s+/)]).filter(Boolean);
    return { id: inst.id, name: inst.name || inst.id, engine: inst.type, logs, hosts, roots: [inst.docRoot, ...vhosts.map((v) => v.root)].filter(Boolean) };
  });
}

function activate(host) {
  const { ctx } = host;
  stats = new VisitorStats({ dir: path.join(ctx.paths.data, 'visitor-stats'), sites: siteSource(ctx) });
  // For other extensions (host.use('visitorStats')): numbers only, never single requests
  host.provide('visitorStats', { report: (site, range) => (stats ? stats.report(site, range) : null), sites: () => (stats ? stats.siteList().map(({ id, name }) => ({ id, name })) : []) });
  const run = () => { if (stats) stats.scan().catch((e) => host.log('scan failed:', e.message)); };
  if (!process.env.HW_TEST) {
    first = setTimeout(run, 15000);
    first.unref();
    timer = setInterval(run, EVERY);
    timer.unref();
  }

  const state = (req) => ({
    sites: stats.siteList(),
    report: stats.report(req.query.site, req.query.range),
    cfg: stats.cfg,
    lastScan: stats.lastScan,
    scanning: !!stats.scanning,
    error: stats.lastError,
    snippet: SNIPPET,
  });
  host.router.get('/visitor-stats', (req, res) => res.json(state(req)));
  host.router.get('/visitor-stats/tile', (req, res) => {
    const today = stats.report(null, 'day');
    const week = stats.report(null, 'week');
    res.json({ views: today.totals.views, visitors: today.totals.visitors, week: week.series.map((x) => x.visitors), sites: stats.siteList().length, hasData: week.hasData });
  });
  host.router.post('/visitor-stats/scan', async (req, res) => {
    // Wait at most 20 s – a first import of big logs carries on in the background
    await Promise.race([stats.scan(), new Promise((r) => { setTimeout(r, 20000).unref(); })]);
    res.json(state(req));
  });
  host.router.put('/visitor-stats/settings', (req, res) => { stats.saveSettings(req.body || {}); res.json(state(req)); });
  host.router.post('/visitor-stats/counter-file', (req, res) => res.json({ files: stats.counterFiles() }));
  host.router.delete('/visitor-stats/data', async (req, res) => {
    if (stats.scanning) await stats.scanning;
    stats.reset();
    await stats.scan();
    res.json(state(req));
  });
  host.on('shutdown', () => deactivate());
}

function deactivate() {
  clearTimeout(first);
  clearInterval(timer);
  timer = null; first = null;
  stats = null;
}

module.exports = { activate, deactivate, siteSource };
