'use client';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../_components/blueprint';

const ACTION = { INSERT: { label: 'Created', cls: 'ok' }, UPDATE: { label: 'Updated', cls: 'upd' }, DELETE: { label: 'Deleted', cls: 'bad' } };
const fmtVal = (v) => {
  if (v === null || v === undefined || v === '') return '∅';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
};

export default function ActivityPage() {
  const [data, setData] = useState({ events: [], actors: [], tables: [] });
  const [table, setTable] = useState('');
  const [actor, setActor] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (table) qs.set('table', table);
    if (actor) qs.set('actor', actor);
    fetch('/api/activity?' + qs.toString())
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed to load'); return j; })
      .then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [table, actor]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader title="Activity Log" sub="Every create, edit, and delete across the app — who did it, when, and exactly what changed. Append-only and hash-chained, so the record can't be silently altered." sheet="Activity" />
      {err && <p className="error">{err}</p>}

      <div className="panel actbar">
        <label className="fl">Area<select value={table} onChange={(e) => setTable(e.target.value)}>
          <option value="">All areas</option>
          {data.tables.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select></label>
        <label className="fl">Who<select value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">Everyone</option>
          {data.actors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select></label>
        <button className="secondary" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        <span className="note count">{data.events.length} most recent events</span>
      </div>

      <div className="panel tablewrap">
        <table className="actlog">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Changes</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="note">Loading…</td></tr>
              : data.events.length ? data.events.map((e) => {
                const a = ACTION[e.action] || { label: e.action, cls: 'upd' };
                return (
                  <tr key={e.id}>
                    <td className="note nowrap">{new Date(e.at).toLocaleString()}</td>
                    <td>
                      {e.who ? <span title={e.whoName || ''}>{e.who}</span> : <span className="note">system{e.dbRole ? ` (${e.dbRole})` : ''}</span>}
                      {e.ip && <div className="ip">{e.ip}</div>}
                    </td>
                    <td><span className={`chip ${a.cls}`}>{a.label}</span></td>
                    <td><b>{e.label}</b><div className="ent" title={e.entity}>{e.entity}</div></td>
                    <td>
                      {e.action === 'UPDATE'
                        ? (e.changes.length
                          ? <ul className="chg">{e.changes.map((c) => (
                              <li key={c.field}><span className="fld">{c.field}</span> <span className="from">{fmtVal(c.from)}</span> → <span className="to">{fmtVal(c.to)}</span></li>
                            ))}</ul>
                          : <span className="note">no tracked fields changed</span>)
                        : e.action === 'INSERT' ? <span className="note">new record</span>
                          : <span className="note">record removed</span>}
                    </td>
                  </tr>
                );
              }) : <tr><td colSpan={5} className="note">No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <style>{`
        .actbar { display:flex; gap:12px; align-items:end; flex-wrap:wrap; }
        .actbar .count { margin-left:auto; }
        .fl { display:grid; gap:4px; font-size:13px; color:var(--muted); }
        table.actlog td { vertical-align:top; }
        .nowrap { white-space:nowrap; }
        .actlog .ent { font-size:12px; color:var(--muted); margin-top:2px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .actlog .ip { font-size:11px; color:var(--muted); opacity:.7; }
        .chg { margin:0; padding:0; list-style:none; font-size:12px; display:grid; gap:3px; }
        .chg .fld { font-weight:600; }
        .chg .from { color:#b91c1c; }
        .chg .to { color:#15803d; }
        .chip.upd { background:#dbeafe; color:#1d4ed8; }
        .chip.bad { background:#fee2e2; color:#b91c1c; }
      `}</style>
    </>
  );
}
