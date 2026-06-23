'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { PageHeader } from '../../_components/blueprint';

const OFFER_LABEL = { finished_goods: 'Finished Goods', raas: 'RaaS', event_rental: 'Event Rental' };
const OFFER_ORDER = ['finished_goods', 'raas', 'event_rental'];
const ITEM_CLASS = ['finished_goods', 'part', 'accessory'];
const ITEM_CLASS_LABEL = { finished_goods: 'Finished Goods', part: 'Raw Materials / Parts', accessory: 'Accessory' };
const EMPTY_ADD = { product_name: '', sku: '', quantity: '', location: '' };

export default function InventoryDetail() {
  const [data, setData] = useState({ period: null, periods: [], categories: [], productLines: [], itemClasses: [], catalog: [], projects: [], allocations: [], canEdit: false, rows: [] });
  const [q, setQ] = useState('');
  const [line, setLine] = useState('all');
  const [cat, setCat] = useState('all');
  const [cls, setCls] = useState('all');
  const [showZero, setShowZero] = useState(false);   // default: hide 0-qty items
  const [busy, setBusy] = useState(false);
  const [addForm, setAddForm] = useState(null);       // add-item modal

  const load = (period) => {
    const url = period ? `/api/inventory?period=${encodeURIComponent(period)}` : '/api/inventory';
    fetch(url).then((r) => r.json()).then((d) => { if (d && !d.error) setData(d); }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const allocByItem = useMemo(() => {
    const m = {};
    for (const a of data.allocations || []) (m[a.cn_sku_id] = m[a.cn_sku_id] || []).push(a);
    return m;
  }, [data.allocations]);

  const rows = useMemo(() => data.rows.filter((r) => {
    if (!showZero && (Number(r.quantity) || 0) === 0) return false;
    if (line !== 'all' && (r.product_line || 'Other') !== line) return false;
    if (cat !== 'all' && (r.category || 'Other') !== cat) return false;
    if (cls !== 'all' && (r.item_class || '') !== cls) return false;
    if (!q) return true;
    const hay = `${r.product_name || ''} ${r.sku || ''} ${r.location || ''} ${r.category || ''} ${r.product_line || ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  }), [data.rows, q, line, cat, cls, showZero]);

  const totalQty = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const hiddenZero = data.rows.filter((r) => (Number(r.quantity) || 0) === 0).length;

  const offerings = useMemo(() => {
    if (line === 'all') return null;
    const items = (data.catalog || []).filter((c) => (c.product_line || '') === line);
    if (!items.length) return null;
    const byType = {};
    for (const c of items) (byType[c.offering_type] = byType[c.offering_type] || []).push(c.name);
    return byType;
  }, [data.catalog, line]);

  async function addItem() {
    setBusy(true);
    const r = await fetch('/api/inventory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(addForm) });
    setBusy(false);
    if (r.ok) { setAddForm(null); load(data.period); }
    else { const j = await r.json().catch(() => ({})); alert(j.error || 'Add failed'); }
  }
  const canEdit = data.canEdit;
  const cols = 8;

  return (
    <>
      <PageHeader title="Inventory detail" sub={`Full stock list${data.period ? ` · ${data.period}` : ''}. 0-quantity items hidden by default. Search by product, SKU, location, or category.`} sheet="Inventory" />

      <div className="toolbar"><Link href="/inventory" className="secondary">← Back to Inventory</Link></div>

      <div className="inv-cats">
        <button className={'inv-cat' + (line === 'all' ? ' on' : '')} onClick={() => { setLine('all'); setCat('all'); }}>All lines</button>
        {data.productLines.map((l) => (
          <button key={l.line} className={'inv-cat' + (line === l.line ? ' on' : '')} onClick={() => { setLine(l.line); setCat('all'); }}>
            {l.line} <span className="inv-n">{l.count}</span>
          </button>
        ))}
      </div>

      {offerings && (
        <div className="panel inv-offer">
          <span><b>{line}</b> is sold as —</span>
          {OFFER_ORDER.filter((t) => offerings[t]).map((t) => (
            <span key={t} className="inv-offer-grp"><span className="chip ok">{OFFER_LABEL[t]}</span> {offerings[t].join(', ')}</span>
          ))}
        </div>
      )}

      <div className="toolbar">
        {canEdit && <button onClick={() => setAddForm({ ...EMPTY_ADD })}>+ Add item</button>}
        <input placeholder="Search product, SKU, location…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="all">All categories</option>
          {data.categories.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.count})</option>)}
        </select>
        <select value={cls} onChange={(e) => setCls(e.target.value)}>
          <option value="all">All classes</option>
          {ITEM_CLASS.map((c) => <option key={c} value={c}>{ITEM_CLASS_LABEL[c]}</option>)}
        </select>
        <label className="inv-chk" title={`${hiddenZero} item(s) have 0 quantity`}>
          <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} /> Show 0-qty ({hiddenZero})
        </label>
        {data.periods.length > 1 && (
          <select value={data.period || ''} onChange={(e) => { setLine('all'); setCat('all'); load(e.target.value); }}>
            {data.periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <span className="note" style={{ marginLeft: 'auto' }}>{rows.length} item(s) · total qty {totalQty}</span>
      </div>

      <div className="panel tablewrap">
        <table>
          <thead><tr><th>Product</th><th>SKU</th><th>Line</th><th>Class</th><th>Category</th><th>Qty</th><th>Location</th><th></th></tr></thead>
          <tbody>
            {rows.length ? rows.map((r) => {
              const allocs = allocByItem[r.id] || [];
              return (
                <tr key={r.id}>
                  <td>{r.product_name || '—'}</td>
                  <td><code>{r.sku || '—'}</code></td>
                  <td>{r.product_line ? <span className="chip ok">{r.product_line}</span> : <span className="note">—</span>}</td>
                  <td>{r.item_class ? <span className="chip">{ITEM_CLASS_LABEL[r.item_class]}</span> : <span className="note">—</span>}</td>
                  <td><span className="chip">{r.category || 'Other'}</span></td>
                  <td>{r.quantity ?? ''}</td>
                  <td className="note">{r.location || ''}</td>
                  <td className="inv-act">
                    {allocs.length > 0 && (
                      <span className="inv-alloc" title={allocs.map((a) => `${a.project_number || a.project_id}${a.quantity ? ` ×${a.quantity}` : ''}`).join('\n')}>
                        📦 {allocs.length}
                      </span>
                    )}
                  </td>
                </tr>
              );
            }) : <tr><td colSpan={cols} className="note">No items match your search.</td></tr>}
          </tbody>
        </table>
      </div>

      {addForm && (
        <div className="inv-overlay" onClick={() => setAddForm(null)}>
          <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="inv-mhead"><b>Add inventory item</b><button className="secondary" onClick={() => setAddForm(null)} style={{ marginLeft: 'auto' }}>✕</button></div>
            <label className="inv-f">Product name<input value={addForm.product_name} onChange={(e) => setAddForm({ ...addForm, product_name: e.target.value })} placeholder="e.g. ADAM 7-core control cable" /></label>
            <label className="inv-f">SKU<input value={addForm.sku} onChange={(e) => setAddForm({ ...addForm, sku: e.target.value })} placeholder="e.g. SE-ADAM-XXXX (class & line auto-derive)" /></label>
            <div className="inv-frow">
              <label className="inv-f">Quantity<input type="number" value={addForm.quantity} onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })} /></label>
              <label className="inv-f">Location<input value={addForm.location} onChange={(e) => setAddForm({ ...addForm, location: e.target.value })} placeholder="e.g. Warehouse" /></label>
            </div>
            <div className="inv-actions">
              <button onClick={addItem} disabled={busy || (!addForm.product_name.trim() && !addForm.sku.trim())}>Add item</button>
              <button className="secondary" onClick={() => setAddForm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .inv-cats { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
        .inv-cat { font-size:12px; padding:4px 12px; border:1px solid var(--line); border-radius:999px; background:var(--surface); color:var(--ink); cursor:pointer; }
        .inv-cat:hover { border-color:var(--primary); }
        .inv-cat.on { background:var(--primary); color:#fff; border-color:var(--primary); }
        .inv-n { opacity:.6; margin-left:2px; }
        .inv-chk { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--muted); }
        .inv-offer { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; font-size:13px; margin-bottom:12px; }
        .inv-offer-grp { display:inline-flex; align-items:center; gap:6px; }
        table code { font-size:12px; }
        .inv-act { white-space:nowrap; text-align:right; }
        .inv-alloc { font-size:11px; color:var(--muted); margin-right:8px; }
        .inv-overlay { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:60; display:flex; align-items:flex-start; justify-content:center; padding:48px 16px; }
        .inv-modal { width:460px; max-width:96vw; background:var(--surface); border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,.3); padding:18px; }
        .inv-mhead { display:flex; align-items:center; gap:10px; padding-bottom:10px; margin-bottom:6px; border-bottom:1px solid var(--line); }
        .inv-f { display:grid; gap:4px; font-size:13px; color:var(--muted); margin-top:10px; }
        .inv-f input, .inv-f select { width:100%; }
        .inv-frow { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .inv-actions { display:flex; gap:8px; margin-top:18px; }
      `}</style>
    </>
  );
}
