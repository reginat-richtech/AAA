'use client';
import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '../_components/blueprint';
import { TASK_STATUS, TASK_STATUS_LABEL, TASK_PRIORITY, TASK_TYPE, TASK_TYPE_LABEL } from '../../lib/orgRoles';

const STATUS_COLOR = { todo: '#94a3b8', in_progress: '#0ea5e9', blocked: '#dc2626', done: '#16a34a' };
const PRIORITY_COLOR = { low: '#94a3b8', normal: '#0ea5e9', high: '#dc2626' };
const STATUS_EMOJI = { todo: '⚪', in_progress: '🔵', blocked: '🔴', done: '🟢' };
const PRIORITY_EMOJI = { low: '⚪', normal: '🟡', high: '🔴' };
const ymd = (d) => (d ? String(d).slice(0, 10) : '');
const who = (email) => (email ? String(email).split('@')[0] : '');
const NONE = '__none__';

export default function Tasks() {
  const [data, setData] = useState({ me: null, tasks: [], projects: [], members: [], inventory: [], allocations: [] });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [editCell, setEditCell] = useState(null);   // { id, value } — inline title edit
  const [openUpdates, setOpenUpdates] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [newUpdate, setNewUpdate] = useState('');
  const [addText, setAddText] = useState({});        // per-block "add a task" input
  const [collapsed, setCollapsed] = useState({});    // per-block collapse state
  const [invModal, setInvModal] = useState(null);    // { project_id, label, cn_sku_id, quantity, note } — allocate inventory

  const load = useCallback(() => {
    fetch('/api/tasks').then((r) => r.json()).then((d) => { if (d && !d.error) setData(d); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patchField(id, field, value) {
    setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, [field]: value } : t)) }));
    const r = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [field]: value }),
    }).catch(() => null);
    if (!r || !r.ok) { load(); return; }
    const updated = await r.json().catch(() => null);
    if (updated) setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...updated } : t)) }));
  }

  async function addTask(key) {
    const title = (addText[key] || '').trim();
    if (!title) return;
    setBusy(true);
    const project_id = key === NONE ? null : key;
    const r = await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, project_id }) });
    setBusy(false);
    if (r.ok) { setAddText((s) => ({ ...s, [key]: '' })); load(); }
  }

  async function del(id) {
    if (!window.confirm('Delete this task?')) return;
    setBusy(true);
    const r = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (r.ok) { if (openUpdates === id) setOpenUpdates(null); load(); }
    else { const j = await r.json().catch(() => ({})); alert(j.error || 'Delete failed'); }
  }

  const loadUpdates = useCallback((id) => {
    fetch(`/api/tasks/${id}/updates`).then((r) => r.json()).then((u) => setUpdates(Array.isArray(u) ? u : [])).catch(() => setUpdates([]));
  }, []);
  function toggleUpdates(id) {
    if (openUpdates === id) { setOpenUpdates(null); return; }
    setOpenUpdates(id); setNewUpdate(''); setUpdates([]); loadUpdates(id);
  }
  async function addUpdate(id) {
    if (!newUpdate.trim()) return;
    setBusy(true);
    const r = await fetch(`/api/tasks/${id}/updates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: newUpdate.trim() }) });
    setBusy(false);
    if (r.ok) { setNewUpdate(''); loadUpdates(id); load(); }
  }

  // Allocate an inventory item to this block's project (inventory team / admins).
  async function allocateInv() {
    setBusy(true);
    const res = await fetch(`/api/inventory/${invModal.cn_sku_id}/allocate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: invModal.project_id, quantity: invModal.quantity || null, note: invModal.note || null }),
    });
    setBusy(false);
    if (res.ok) { setInvModal(null); load(); }
    else { const j = await res.json().catch(() => ({})); alert(j.error || 'Allocation failed'); }
  }

  const sel = (t, field, opts, style) => (
    <select className="tk-cell-sel" value={t[field] || ''} disabled={busy} style={style}
      onChange={(e) => patchField(t.id, field, e.target.value || null)}>{opts}</select>
  );
  const txt = (t, field, ph) => (
    <input className="tk-cell-text" defaultValue={t[field] || ''} placeholder={ph} disabled={busy}
      onBlur={(e) => { if ((e.target.value || '') !== (t[field] || '')) patchField(t.id, field, e.target.value || null); }} />
  );

  // One task row (+ its update log when open).
  const renderRow = (t) => (
    <FragmentRow key={t.id}>
      <tr className="tk-row">
        <td className="tk-name">
          {editCell?.id === t.id ? (
            <input autoFocus value={editCell.value}
              onChange={(e) => setEditCell({ id: t.id, value: e.target.value })}
              onBlur={() => { const v = editCell.value.trim(); if (v && v !== t.title) patchField(t.id, 'title', v); setEditCell(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditCell(null); }} />
          ) : (
            <span className="tk-editable" onClick={() => setEditCell({ id: t.id, value: t.title })}>{t.title}</span>
          )}
        </td>
        <td>{sel(t, 'type', [<option key="" value="">—</option>, ...TASK_TYPE.map((x) => <option key={x} value={x}>{TASK_TYPE_LABEL[x]}</option>)])}</td>
        <td>{sel(t, 'status', TASK_STATUS.map((s) => <option key={s} value={s}>{STATUS_EMOJI[s]} {TASK_STATUS_LABEL[s]}</option>), { color: STATUS_COLOR[t.status], fontWeight: 600 })}</td>
        <td>{sel(t, 'priority', TASK_PRIORITY.map((p) => <option key={p} value={p}>{PRIORITY_EMOJI[p]} {p}</option>), { color: PRIORITY_COLOR[t.priority], fontWeight: 600 })}</td>
        <td>{sel(t, 'assignee_email', [<option key="" value="">unassigned</option>,
          ...(data.members || []).map((m) => <option key={m.email} value={m.email}>{m.name || who(m.email)}</option>),
          ...(t.assignee_email && !(data.members || []).some((m) => m.email === t.assignee_email) ? [<option key="cur" value={t.assignee_email}>{who(t.assignee_email)}</option>] : [])])}</td>
        <td><input type="date" className="tk-cell-date" value={ymd(t.start_date)} disabled={busy} onChange={(e) => patchField(t.id, 'start_date', e.target.value || null)} /></td>
        <td><input type="date" className="tk-cell-date" value={ymd(t.end_date)} disabled={busy} onChange={(e) => patchField(t.id, 'end_date', e.target.value || null)} /></td>
        <td>{txt(t, 'description', 'Description…')}</td>
        <td>{txt(t, 'note', 'Note…')}</td>
        <td>{sel(t, 'project_id', [<option key="" value="">— none —</option>,
          ...(data.projects || []).map((p) => <option key={p.id} value={p.id}>{p.project_number}</option>)])}</td>
        <td className="tk-upcell" onClick={() => toggleUpdates(t.id)} title="Daily updates">
          {openUpdates === t.id ? '▾' : '💬'}{Number(t.updates_count) > 0 ? <span className="tk-upc"> {t.updates_count}</span> : ''}
        </td>
        <td><button type="button" className="tk-del" title="Delete" onClick={() => del(t.id)} disabled={busy}>✕</button></td>
      </tr>
      {openUpdates === t.id && (
        <tr className="tk-detailrow">
          <td colSpan={12}>
            <div className="tk-updates">
              <div className="tk-uphd">Daily updates — {t.title}</div>
              <div className="tk-uprow">
                <input value={newUpdate} onChange={(e) => setNewUpdate(e.target.value)} placeholder="Add today’s update…"
                  onKeyDown={(e) => { if (e.key === 'Enter') addUpdate(t.id); }} />
                <button type="button" className="secondary" onClick={() => addUpdate(t.id)} disabled={busy || !newUpdate.trim()}>Add</button>
              </div>
              {updates.length === 0 ? <p className="note" style={{ marginTop: 8 }}>No updates yet.</p> : (
                <ul className="tk-uplist">
                  {updates.map((u) => (
                    <li key={u.id}><div className="note tk-upmeta">{new Date(u.created_at).toLocaleString()} · {who(u.author)}</div><div className="tk-upbody">{u.body}</div></li>
                  ))}
                </ul>
              )}
            </div>
          </td>
        </tr>
      )}
    </FragmentRow>
  );

  // Filter, then group by project.
  const rows = (data.tasks || []).filter((t) => {
    if (fStatus && t.status !== fStatus) return false;
    if (!search) return true;
    const hay = `${t.title} ${t.type || ''} ${who(t.assignee_email)} ${t.project_number || ''} ${t.project_title || ''}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });
  const groups = {};
  for (const t of rows) (groups[t.project_id || NONE] ||= []).push(t);
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === NONE) return 1; if (b === NONE) return -1;
    return String(groups[a][0]?.project_number || '').localeCompare(String(groups[b][0]?.project_number || ''));
  });

  // Inventory allocations grouped by project (inventory team/admins can add).
  const canAllocate = !!data.me && (data.me.isAdmin || data.me.department === 'inventory');
  const allocByProject = {};
  for (const a of data.allocations || []) (allocByProject[a.project_id] = allocByProject[a.project_id] || []).push(a);

  const HEAD = (
    <thead><tr>
      <th>Task</th><th>Type</th><th>Status</th><th>Priority</th><th>Assignee</th>
      <th>Start</th><th>End</th><th>Description</th><th>Note</th><th>Project</th><th title="daily updates">💬</th><th></th>
    </tr></thead>
  );

  return (
    <>
      <PageHeader title="Task Tracking" sub="Tasks grouped by project — each project is its own block. Click any cell to edit it in place; add a task at the bottom of a block. Project link is optional." sheet="Task Tracking" />

      <div className="toolbar">
        <input placeholder="Search task, type, assignee…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          {TASK_STATUS.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
        </select>
        <span className="note" style={{ marginLeft: 'auto' }}>{rows.length} task(s) · {keys.length} block(s)</span>
      </div>

      {keys.map((k) => {
        const gtasks = groups[k];
        const meta = gtasks[0] || {};
        const label = k === NONE ? 'No project'
          : `${meta.project_number || 'Project'}${meta.project_title ? ' — ' + meta.project_title : (meta.counterparty ? ' — ' + meta.counterparty : '')}`;
        const open = collapsed[k] !== true;
        const done = gtasks.filter((t) => t.status === 'done').length;
        return (
          <div className="panel tk-block" key={k}>
            <div className="tk-blockhead" onClick={() => setCollapsed((m) => ({ ...m, [k]: !m[k] }))}>
              <span className="tk-caret">{open ? '▾' : '▸'}</span>
              {k !== NONE && <span className="tk-projchip">{meta.project_number || 'PRJ'}</span>}
              <span className="tk-blocktitle">{k === NONE ? 'No project' : (meta.project_title || meta.counterparty || 'Project')}</span>
              <div className="tk-prog" style={{ marginLeft: 'auto' }} title={`${done} of ${gtasks.length} done`}>
                <div className="tk-prog-fill" style={{ width: `${gtasks.length ? Math.round((done / gtasks.length) * 100) : 0}%` }} />
              </div>
              <span className="note tk-progtxt">{done}/{gtasks.length}</span>
            </div>
            {open && (
              <div className="tk-blockbody">
                {k !== NONE && (
                  <div className="tk-inv">
                    <span className="note">📦 Inventory:</span>
                    {(allocByProject[k] || []).length === 0 && <span className="note">none yet</span>}
                    {(allocByProject[k] || []).map((a) => (
                      <span key={a.id} className="tk-invchip" title={a.product_name || ''}>{a.sku || a.product_name || 'item'}{a.quantity ? ` ×${a.quantity}` : ''}</span>
                    ))}
                    {canAllocate && <button type="button" className="secondary tk-invadd" onClick={() => setInvModal({ project_id: k, label, cn_sku_id: '', quantity: '', note: '' })}>+ Add inventory</button>}
                  </div>
                )}
                <table className="tk-table">
                  {HEAD}
                  <tbody>
                    {gtasks.map(renderRow)}
                    <tr className="tk-addrow"><td colSpan={12}>
                      <input className="tk-addinput" placeholder="+ Add a task to this block…" value={addText[k] || ''}
                        onChange={(e) => setAddText((s) => ({ ...s, [k]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') addTask(k); }} disabled={busy} />
                      {(addText[k] || '').trim() && <button className="secondary" onClick={() => addTask(k)} disabled={busy} style={{ marginLeft: 8 }}>Add</button>}
                    </td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {keys.length === 0 && (
        <div className="panel">
          <p className="note">No tasks yet.</p>
          <input className="tk-addinput" placeholder="+ Add your first task…" value={addText[NONE] || ''}
            onChange={(e) => setAddText((s) => ({ ...s, [NONE]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') addTask(NONE); }} disabled={busy} />
        </div>
      )}

      {invModal && (
        <div className="tk-overlay" onClick={() => setInvModal(null)}>
          <div className="tk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tk-mhead"><b>Add inventory to project</b><button type="button" className="secondary" onClick={() => setInvModal(null)} style={{ marginLeft: 'auto' }}>✕</button></div>
            <p className="note" style={{ marginTop: 0 }}>{invModal.label}</p>
            <label className="tk-f">Inventory item
              <select value={invModal.cn_sku_id} onChange={(e) => setInvModal({ ...invModal, cn_sku_id: e.target.value })}>
                <option value="">Select an item…</option>
                {(data.inventory || []).map((it) => <option key={it.id} value={it.id}>{(it.sku ? it.sku + ' — ' : '')}{it.product_name || 'item'}{it.quantity != null ? ` (qty ${it.quantity})` : ''}</option>)}
              </select>
            </label>
            <div className="tk-frow">
              <label className="tk-f">Quantity<input type="number" value={invModal.quantity} onChange={(e) => setInvModal({ ...invModal, quantity: e.target.value })} /></label>
              <label className="tk-f">Note<input value={invModal.note} onChange={(e) => setInvModal({ ...invModal, note: e.target.value })} placeholder="optional" /></label>
            </div>
            <div className="tk-mactions">
              <button onClick={allocateInv} disabled={busy || !invModal.cn_sku_id}>Add to project</button>
              <button className="secondary" onClick={() => setInvModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .tk-block { padding:0; overflow:hidden; }
        .tk-inv { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 14px; border-bottom:1px dashed var(--line); }
        .tk-invchip { font-size:11px; background:#eef2f7; color:#334155; padding:2px 8px; border-radius:999px; }
        .tk-invadd { font-size:11px; padding:2px 10px; margin-left:auto; }
        .tk-overlay { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:60; display:flex; align-items:flex-start; justify-content:center; padding:48px 16px; }
        .tk-modal { width:460px; max-width:96vw; background:var(--surface); border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,.3); padding:18px; }
        .tk-mhead { display:flex; align-items:center; gap:10px; padding-bottom:10px; margin-bottom:6px; border-bottom:1px solid var(--line); }
        .tk-f { display:grid; gap:4px; font-size:13px; color:var(--muted); margin-top:10px; }
        .tk-f input, .tk-f select { width:100%; }
        .tk-frow { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .tk-mactions { display:flex; gap:8px; margin-top:18px; }
        .tk-blockhead { display:flex; align-items:center; gap:10px; padding:11px 14px; cursor:pointer; }
        .tk-blockhead:hover { background:rgba(0,0,0,.02); }
        .tk-caret { color:var(--muted); width:12px; }
        .tk-projchip { font-weight:700; font-size:11px; background:#0f172a; color:#fff; padding:1px 8px; border-radius:999px; }
        .tk-blocktitle { font-weight:600; font-size:14px; }
        .tk-blockbody { border-top:1px solid var(--line); overflow-x:auto; }
        .tk-table { width:100%; border-collapse:collapse; font-size:13px; white-space:nowrap; }
        .tk-table th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); padding:7px 8px; border-bottom:1px solid var(--line); }
        .tk-table td { padding:6px 10px; border-bottom:1px solid var(--line); vertical-align:middle; }
        .tk-row:hover td { background:rgba(37,99,235,.035); }
        .tk-prog { width:130px; height:7px; background:var(--line); border-radius:999px; overflow:hidden; flex:0 0 auto; }
        .tk-prog-fill { height:100%; background:#16a34a; border-radius:999px; transition:width .25s; }
        .tk-progtxt { flex:0 0 auto; min-width:36px; text-align:right; }
        .tk-name { font-weight:600; min-width:170px; }
        .tk-editable { cursor:text; display:inline-block; min-width:80px; padding:2px 0; }
        .tk-editable:hover { background:rgba(0,0,0,.04); border-radius:4px; }
        .tk-name input { width:100%; min-width:150px; font-weight:600; }
        .tk-cell-sel { appearance:none; -webkit-appearance:none; -moz-appearance:none; background:transparent; background-image:none;
          border:1px solid transparent; border-radius:5px; padding:3px 6px; font:inherit; cursor:pointer; min-width:84px; }
        .tk-cell-sel::-ms-expand { display:none; }
        .tk-cell-sel:hover, .tk-cell-sel:focus { border-color:var(--line); background:var(--surface); outline:none; }
        .tk-cell-date { border:1px solid transparent; background:transparent; padding:3px 4px; font:inherit; border-radius:5px; }
        .tk-cell-date:hover, .tk-cell-date:focus { border-color:var(--line); background:var(--surface); outline:none; }
        .tk-cell-text { border:1px solid transparent; background:transparent; padding:3px 6px; font:inherit; border-radius:5px; min-width:150px; }
        .tk-cell-text:hover, .tk-cell-text:focus { border-color:var(--line); background:var(--surface); outline:none; }
        .tk-upcell { cursor:pointer; text-align:center; user-select:none; }
        .tk-upc { color:var(--primary); font-weight:700; font-size:11px; }
        .tk-del { border:0; background:transparent; color:var(--muted); cursor:pointer; font-size:13px; padding:4px 6px; border-radius:5px; }
        .tk-del:hover { background:#fee2e2; color:#dc2626; }
        .tk-detailrow td { background:rgba(0,0,0,.015); white-space:normal; }
        .tk-updates { padding:8px 2px 12px; max-width:680px; }
        .tk-uphd { font-weight:700; font-size:12px; margin-bottom:8px; }
        .tk-uprow { display:flex; gap:8px; } .tk-uprow input { flex:1 1 auto; min-width:240px; }
        .tk-uplist { list-style:none; margin:10px 0 0; padding:0; display:flex; flex-direction:column; gap:9px; max-height:220px; overflow:auto; }
        .tk-uplist li { border-left:2px solid var(--line); padding:1px 0 1px 10px; }
        .tk-upmeta { font-size:11px; } .tk-upbody { font-size:13px; white-space:pre-wrap; word-break:break-word; }
        .tk-addrow td { background:transparent; white-space:normal; }
        .tk-addinput { width:60%; min-width:280px; }
      `}</style>
    </>
  );
}

function FragmentRow({ children }) { return <>{children}</>; }
