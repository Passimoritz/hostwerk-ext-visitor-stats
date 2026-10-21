'use strict';
/*
 * Finding and reading access logs – only what is new since the last time.
 *
 * Each file is recognised by its first line (a fingerprint), not by its name: when the log is rotated
 * (access.log → access.log.1 → access.log.2.gz), the file keeps its first line and therefore its read position –
 * nothing is counted twice and nothing is lost, whatever naming the rotation uses. Gzipped files (.gz) are read through
 * zlib; a finished rotated file is remembered by name, size and time and not unpacked again.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Log files of the web server configuration: the main file plus everything rotation made of it (.1, .2.gz, -20261021.gz …). */
function rotated(main) {
  const dir = path.dirname(main);
  const stem = path.basename(main).replace(/\.log$/i, '');
  const re = new RegExp(`^${esc(stem)}(?:[.-][\\w.-]*)?$`, 'i');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => re.test(n) && /\.log|\.gz$|\.\d+$/i.test(n.slice(stem.length) || '.log'))
    .map((n) => path.join(dir, n))
    .filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
}

/** Further log paths written by hand into the web server's own settings (CustomLog / access_log / output file). */
function customLogPaths(text, baseDir) {
  const out = new Set();
  const add = (p) => {
    if (!p || /^(off|syslog:|\||\/dev\/)/i.test(p) || /[{}$]/.test(p)) return;
    out.add(path.isAbsolute(p) ? p : path.resolve(baseDir, p));
  };
  for (const m of String(text || '').matchAll(/^[ \t]*(?:CustomLog|TransferLog|access_log)[ \t]+(?:"([^"]+)"|([^\s;"]+))/gim)) add(m[1] || m[2]);
  for (const m of String(text || '').matchAll(/output[ \t]+file[ \t]+(?:"([^"]+)"|([^\s}"]+))/gi)) add(m[1] || m[2]);
  return [...out];
}

/** Call onLine for every complete line of a stream. Returns the bytes of the complete lines (plus the rest when final). */
function eachLine(stream, { skip = 0, final = false }, onLine) {
  return new Promise((resolve, reject) => {
    let rest = Buffer.alloc(0);
    let skipped = 0;
    let used = skip;
    stream.on('data', (chunk) => {
      let c = chunk;
      if (skipped < skip) {
        const n = Math.min(skip - skipped, c.length);
        skipped += n;
        c = c.subarray(n);
        if (!c.length) return;
      }
      const buf = rest.length ? Buffer.concat([rest, c]) : c;
      let from = 0;
      for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, from)) {
        onLine(buf.toString('utf8', from, i).replace(/\r$/, ''));
        used += i + 1 - from;
        from = i + 1;
      }
      rest = Buffer.from(buf.subarray(from));
      if (rest.length > 1024 * 1024) rest = Buffer.alloc(0); // a "line" this long is not a log line
    });
    stream.on('error', reject);
    stream.on('end', () => {
      if (final && rest.length) { onLine(rest.toString('utf8').replace(/\r$/, '')); used += rest.length; }
      resolve(used);
    });
  });
}

const isGz = (f) => /\.gz$/i.test(f);
const open = (f, start) => (isGz(f) ? fs.createReadStream(f).pipe(zlib.createGunzip()) : fs.createReadStream(f, start ? { start } : undefined));

/** Fingerprint = hash of the first line (unpacked). null while the file has no complete line yet. */
async function fingerprint(f) {
  return new Promise((resolve) => {
    const s = open(f);
    let buf = Buffer.alloc(0);
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { s.destroy(); } catch { /* closed */ } resolve(v); };
    s.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      const i = buf.indexOf(10);
      if (i !== -1 || buf.length > 4096) finish(crypto.createHash('sha1').update(buf.subarray(0, i === -1 ? 4096 : i)).digest('hex').slice(0, 20));
    });
    s.on('error', () => finish(null));
    s.on('end', () => finish(buf.length && isGz(f) ? crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) : null));
  });
}

/**
 * Read everything new of one file. state: { files: { fp: { done, t } }, gz: { path: { size, mtime, fp } } }
 * → number of new lines
 */
async function readNew(f, state, onLine) {
  let st;
  try { st = fs.statSync(f); } catch { return 0; }
  if (!st.size) return 0;
  const gz = isGz(f);
  const known = gz ? state.gz[f] : null;
  if (known && known.size === st.size && known.mtime === st.mtimeMs && state.files[known.fp] && state.files[known.fp].full) { state.files[known.fp].t = Date.now(); return 0; }
  const fp = await fingerprint(f);
  if (!fp) return 0;
  const rec = state.files[fp] || (state.files[fp] = { done: 0 });
  rec.t = Date.now();
  if (gz) state.gz[f] = { size: st.size, mtime: st.mtimeMs, fp };
  if (!gz && rec.done > st.size) rec.done = st.size; // emptied and refilled with the same first line – rare, do not count twice
  if (!gz && rec.done === st.size) return 0;
  let n = 0;
  const used = await eachLine(open(f, gz ? 0 : rec.done), { skip: gz ? rec.done : 0, final: gz }, (line) => { n++; onLine(line); });
  // gzip: "used" counts from the start of the unpacked file; plain: from where reading began
  rec.done = gz ? Math.max(rec.done, used) : rec.done + used;
  if (gz) rec.full = true;
  return n;
}

/** Forget files not seen for 60 days. */
function pruneState(state, now = Date.now()) {
  for (const [fp, r] of Object.entries(state.files)) if (now - (r.t || 0) > 60 * 86400000) delete state.files[fp];
  for (const [f, g] of Object.entries(state.gz)) if (!state.files[g.fp]) delete state.gz[f];
}

module.exports = { rotated, customLogPaths, eachLine, fingerprint, readNew, pruneState };
