import { useEffect, useState } from 'react';
import { LineChart, RefreshCw, Globe, FileText, Copy, ShieldCheck, Smartphone, Compass, Monitor, FileQuestion, Code2, Settings2, FolderPlus, RotateCcw, Users } from 'lucide-react';
import { get, put, post, del, useApi, fmtBytes } from '@hostwerk/api';
import { Btn, Seg, Empty, Loading, TileEmpty, InfoTip, Callout, SettingRow, Switch, Field, Sparkline, toast, confirmDialog } from '@hostwerk/ui';
import './style.css';

/*
 * Visitor stats: numbers of the chosen period, a bar chart, top pages, sources, devices and 404s – all from the access
 * logs of Hostwerk's web servers, plus the optional counter script and the settings.
 * Texts are English; German comes from locales/de.json (translated automatically, also inside JSX).
 */
const RANGES = [{ id: 'day', label: 'Today' }, { id: 'week', label: '7 days' }, { id: 'month', label: '30 days' }];
const DEVICE = { desktop: 'Computer', mobile: 'Phone', tablet: 'Tablet' };
const nf = (n) => Number(n || 0).toLocaleString();
const label = (k) => DEVICE[k] || (k === 'Other' ? 'Other' : k === '(other)' ? '(others)' : k);

function Trend({ cur, prev }) {
  if (!prev) return <span className="s">–</span>;
  const p = Math.round(((cur - prev) / prev) * 100);
  return <span className={`s ${p > 0 ? 'c-ok' : p < 0 ? 'c-err' : ''}`}>{p > 0 ? `+${p} %` : `${p} %`} <span className="muted">vs. before</span></span>;
}

/** Bars per day (or per hour for "today") – drawn with the theme colours, the numbers also as text for screen readers. */
function Chart({ r }) {
  const day = r.range === 'day';
  const data = r.series.map((x) => ({ k: day ? `${String(x.hour).padStart(2, '0')}:00` : new Date(`${x.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'numeric' }), v: day ? x.views : x.visitors }));
  const max = Math.max(1, ...data.map((d) => d.v));
  const w = 100 / data.length;
  return (
    <figure className="vst-chart">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={day ? 'Page views per hour' : 'Visitors per day'}>
        {data.map((d, i) => (
          <rect key={d.k} className="vst-bar" x={i * w + w * 0.15} width={w * 0.7} y={40 - (d.v / max) * 38} height={Math.max(0.3, (d.v / max) * 38)}>
            <title>{`${d.k}: ${nf(d.v)}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="vst-axis tiny muted" aria-hidden="true">
        <span>{data[0] && data[0].k}</span><span>{data.length > 2 ? data[Math.floor(data.length / 2)].k : ''}</span><span>{data.length > 1 ? data[data.length - 1].k : ''}</span>
      </figcaption>
    </figure>
  );
}

function Bars({ title, icon: Icon, rows, total, empty, tip, mono }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="card">
      <div className="card-head"><Icon size={16} /><h3>{title}</h3>{tip}</div>
      {!rows.length ? <TileEmpty icon={Icon} text={empty} /> : (
        <ul className="vst-bars">
          {rows.map(([k, n]) => (
            <li key={k} className="vst-row" title={total ? `${Math.round((n / total) * 100)} %` : undefined}>
              <span className="vst-fill" aria-hidden="true" style={{ width: `${(n / max) * 100}%` }} />
              <span className={`vst-key ellipsis ${mono ? 'mono' : ''}`}>{label(k)}</span>
              <span className="vst-num">{nf(n)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Script({ s }) {
  const copy = async () => { try { await navigator.clipboard.writeText(s.snippet); toast.success('Copied'); } catch { toast.error('Could not copy'); } };
  const files = async () => {
    try { const r = await post('/visitor-stats/counter-file'); toast.success(r.files.length === 1 ? 'Counter file in 1 site folder' : `Counter file in ${r.files.length} site folders`); } catch (e) { toast.error(e); }
  };
  return (
    <div className="card">
      <div className="card-head"><Code2 size={16} /><h3>Counter script (optional)</h3>
        <InfoTip title="Counter script">The logs are enough for normal websites. For single-page apps (React, Vue …) or pages served from a cache, put this script into your page. It sets no cookies, stores nothing in the browser and does nothing when Do Not Track is on. Its request goes to your own site and lands in the same log.</InfoTip>
      </div>
      <div className="card-body stack">
        <pre className="code-block vst-code">{s.snippet}</pre>
        <div className="row-tight vst-wrap">
          <Btn className="sm" icon={Copy} onClick={copy}>Copy script</Btn>
          <Btn className="sm ghost" icon={FolderPlus} onClick={files}>Put counter file into site folders</Btn>
          <InfoTip title="Counter file">An empty file “.hostwerk-count” in the site folder answers the script with “OK” instead of “not found” – so the server's error log stays clean. Existing files are left alone.</InfoTip>
        </div>
      </div>
    </div>
  );
}

function Settings({ s, q, onSaved }) {
  const [ignore, setIgnore] = useState((s.cfg.ignore || []).join(', '));
  const [days, setDays] = useState(String(s.cfg.retentionDays));
  const save = async (patch) => { try { onSaved(await put(`/visitor-stats/settings${q}`, patch)); toast.success('Saved'); } catch (e) { toast.error(e); } };
  const reset = async () => {
    if (!(await confirmDialog({ title: 'Start over?', text: 'All numbers are deleted and the logs that still exist are read again. Older days whose logs are gone are lost.', confirm: 'Start over', danger: true }))) return;
    try { onSaved(await del(`/visitor-stats/data${q}`)); toast.success('Read again'); } catch (e) { toast.error(e); }
  };
  return (
    <div className="card">
      <div className="card-head"><Settings2 size={16} /><h3>Settings</h3></div>
      <div className="card-body">
        <SettingRow title="Count visits from this PC" text="Off = your own clicks on localhost do not count."><Switch checked={!!s.cfg.countLocal} onChange={(v) => save({ countLocal: v })} /></SettingRow>
        <Field label="Keep days" hint="30 to 1000 days."><div className="row-tight"><input className="input sm vst-num-input" inputMode="numeric" aria-label="Keep days" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /><Btn className="sm" onClick={() => save({ retentionDays: Number(days) })}>Save</Btn></div></Field>
        <Field label="Leave out paths" hint="Starting with, separated by commas – for example /admin, /api"><div className="row-tight"><input className="input sm mono grow" aria-label="Leave out paths" value={ignore} placeholder="/admin, /api" onChange={(e) => setIgnore(e.target.value)} /><Btn className="sm" onClick={() => save({ ignore: ignore.split(',').map((x) => x.trim()).filter(Boolean) })}>Save</Btn></div></Field>
        <Btn className="sm ghost danger" icon={RotateCcw} onClick={reset}>Start over</Btn>
      </div>
    </div>
  );
}

function Logs({ s }) {
  return (
    <div className="card">
      <div className="card-head"><FileText size={16} /><h3>Logs read</h3>
        <InfoTip title="Which logs?">The access log every Hostwerk web server writes (Apache and nginx in the combined format, Caddy as JSON), plus log lines from the server's own settings. Rotated and gzipped files are read too – each line counts only once.</InfoTip>
      </div>
      <ul className="vst-logs">
        {s.sites.flatMap((x) => x.logs.map((l) => (
          <li key={l.path} className="list-item">
            <span className="badge">{x.name}</span>
            <code className="grow ellipsis small" title={l.path}>{l.path}</code>
            <span className="tiny muted">{l.size === null ? 'not there yet' : fmtBytes(l.size)}</span>
          </li>
        )))}
      </ul>
    </div>
  );
}

function VisitorStatsPage() {
  const [site, setSite] = useState('all');
  const [range, setRange] = useState('week');
  const st = useApi(`/visitor-stats?site=${encodeURIComponent(site)}&range=${range}`, [site, range], { live: false });
  const [busy, setBusy] = useState(false);
  const q = `?site=${encodeURIComponent(site)}&range=${range}`;
  const scan = async () => { setBusy(true); try { st.setData(await post(`/visitor-stats/scan${q}`)); } catch (e) { toast.error(e); } setBusy(false); };
  useEffect(() => { scan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- read new lines once when the page opens
  const s = st.data;
  if (!s) return st.error ? <Empty icon={LineChart} title="Could not load" text={String(st.error.message || st.error)} /> : <Loading />;
  const r = s.report;
  const t = r.totals;
  return (
    <div className="page fade-in vst">
      <div className="page-head">
        <div>
          <h1><LineChart /> Visitor stats</h1>
          <p>Visitors of your sites – from the web server logs, without cookies.</p>
        </div>
        <div className="actions vst-wrap">
          {s.sites.length > 1 && (
            <select className="select sm" aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="all">All sites</option>
              {s.sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <Seg options={RANGES} value={range} onChange={setRange} />
          <Btn className="sm ghost" icon={RefreshCw} busy={busy} title="Read new log lines now" aria-label="Read new log lines now" onClick={scan} />
          <InfoTip title="Privacy" icon={ShieldCheck}>No cookies, no fingerprint. IP addresses are shortened (the last part removed) and turned into a hash that changes every day – after two days not even this PC can link visits. Bots, crawlers, uptime checks, images and scripts are left out. Nothing leaves this PC.</InfoTip>
        </div>
      </div>
      {s.error && <Callout kind="err" dismissible={false}>{s.error}</Callout>}
      {!s.sites.length ? <Empty icon={Globe} title="No web server yet" text="Create a web server in Hostwerk – the visitors of its sites show up here." action={<a className="btn primary" href="#/web">Open web servers</a>} /> : !r.hasData ? (
        <>
          <Empty icon={Users} title="No visitors yet" text={s.cfg.countLocal ? 'As soon as someone opens one of your sites, it shows up here.' : 'As soon as someone opens one of your sites, it shows up here. Your own visits from this PC do not count – switch that on in the settings below to try it out.'} />
          <div className="grid grid-2 vst-grid"><Logs s={s} /><Settings s={s} q={q} onSaved={st.setData} /></div>
          <Script s={s} />
        </>
      ) : (
        <>
          <div className="grid grid-4 vst-grid">
            <div className="card card-pad stat"><div className="k">Visitors</div><div className="v">{nf(t.visitors)}</div><Trend cur={t.visitors} prev={r.prev.visitors} /></div>
            <div className="card card-pad stat"><div className="k">Page views</div><div className="v">{nf(t.views)}</div><Trend cur={t.views} prev={r.prev.views} /></div>
            <div className="card card-pad stat"><div className="k">Pages per visitor</div><div className="v">{t.visitors ? (t.views / t.visitors).toFixed(1) : '–'}</div><span className="s muted">{r.beacon ? 'from the counter script' : 'from the logs'}</span></div>
            <div className="card card-pad stat"><div className="k">Bots left out</div><div className="v">{nf(t.bots)}</div><span className="s muted">crawlers, checks, probes</span></div>
          </div>
          <div className="card vst-grid">
            <div className="card-head"><LineChart size={16} /><h3>{range === 'day' ? 'Page views per hour' : 'Visitors per day'}</h3></div>
            <div className="card-body"><Chart r={r} /></div>
          </div>
          <div className="grid grid-2 vst-grid">
            <Bars title="Pages" icon={FileText} rows={r.pages} total={t.views} empty="No page views in this period." mono />
            <Bars title="Sources" icon={Compass} rows={r.refs} total={t.views} empty="Nobody came from another site – visits were direct or from bookmarks." tip={<InfoTip title="Sources">Other websites that linked to yours (search engines, social media …). Links between your own pages do not count. Many apps and browsers send no source at all.</InfoTip>} />
            <Bars title="Devices" icon={Smartphone} rows={r.devices} total={t.visitors} empty="No visitors in this period." />
            <Bars title="Browsers" icon={Globe} rows={r.browsers} total={t.visitors} empty="No visitors in this period." />
            <Bars title="Systems" icon={Monitor} rows={r.os} total={t.visitors} empty="No visitors in this period." />
            <Bars title="Not found (404)" icon={FileQuestion} rows={r.notFound} empty="No broken links – nobody hit a missing page." mono tip={<InfoTip title="Not found">Pages people asked for that do not exist – often old links. Probes for weak spots (like /wp-login.php) count as bots and are not listed.</InfoTip>} />
          </div>
          <div className="grid grid-2 vst-grid"><Script s={s} /><Settings s={s} q={q} onSaved={st.setData} /></div>
          <Logs s={s} />
          <p className="tiny muted vst-foot">{s.lastScan ? `Last read ${new Date(s.lastScan).toLocaleTimeString()}` : ''}</p>
        </>
      )}
    </div>
  );
}

/** Overview tile: visitors today, page views, the last 7 days as a small line. */
function VisitorStatsTile() {
  const [d, setD] = useState(null);
  useEffect(() => { let on = true; const load = () => get('/visitor-stats/tile').then((x) => { if (on) setD(x); }).catch(() => {}); load(); const t = setInterval(load, 60000); return () => { on = false; clearInterval(t); }; }, []);
  if (!d) return <div className="card-body"><span className="small muted">…</span></div>;
  if (!d.sites) return <TileEmpty icon={Globe} text="No web server yet." href="#/web" action="Web servers" />;
  if (!d.hasData) return <TileEmpty icon={LineChart} text="No visitors counted yet." href="#/ext/visitor-stats" action="Open" />;
  return (
    <a className="card-body vst-tile" href="#/ext/visitor-stats">
      <div className="stat"><div className="k">Visitors today</div><div className="v">{nf(d.visitors)}</div><div className="s muted">{d.views === 1 ? '1 page view' : `${nf(d.views)} page views`}</div></div>
      <Sparkline data={d.week} width={120} height={36} />
    </a>
  );
}

export default {
  pages: { main: VisitorStatsPage },
  slots: { 'dashboard.tiles': [{ id: 'today', title: 'Visitors today', icon: 'line-chart', size: 'third', Component: VisitorStatsTile }] },
};
