'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { PageHeader } from '../_components/blueprint';

export default function Inventory() {
  const [data, setData] = useState({ canEdit: false, projects: [], carts: [], inventory: [] });
  const [selectedId, setSelectedId] = useState('');
  const [addModal, setAddModal] = useState(null);   // { cn_sku_id, quantity, note }
  const [busy, setBusy] = useState(false);

  const load = () => fetch('/api/inventory/cart').then((r) => r.json()).then((d) => { if (d && !d.error) setData(d); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const cartByProject = useMemo(() => {
    const m = {};
    for (const c of data.carts || []) (m[c.project_id] = m[c.project_id] || []).push(c);
    return m;
  }, [data.carts]);

  const project = (data.projects || []).find((p) => p.id === selectedId) || null;
  const cart = selectedId ? (cartByProject[selectedId] || []) : [];
  const withCarts = (data.projects || []).filter((p) => (cartByProject[p.id] || []).length);

  async function addToCart() {
    if (!selectedId || !addModal.cn_sku_id) return;
    setBusy(true);
    const res = await fetch(`/api/inventory/${addModal.cn_sku_id}/allocate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: selectedId, quantity: addModal.quantity || null, note: addModal.note || null }),
    });
    setBusy(false);
    if (res.ok) { setAddModal(null); load(); }
    else { const j = await res.json().catch(() => ({})); alert(j.error || 'Add failed'); }
  }
  async function removeLine(id) {
    setBusy(true);
    await fetch(`/api/inventory/cart?id=${id}`, { method: 'DELETE' }).catch(() => {});
    setBusy(false); load();
  }

  const canEdit = data.canEdit;

  return (
    <>
      <PageHeader title="Inventory" sub="Inventory needed per project — a shopping cart built from the proposal form. Add the items each project needs; open the full stock list for what we have." sheet="Inventory" />

      <div className="toolbar">
        <Link href="/inventory/detail" className="invbtn">📦 Full inventory detail (stock list) →</Link>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ minWidth: 320 }}>
          <option value="">Choose a project…</option>
          {(data.projects || []).map((p) => (
            <option key={p.id} value={p.id}>{p.project_number} — {p.title || p.counterparty || 'project'}{(cartByProject[p.id] || []).length ? ` (${cartByProject[p.id].length})` : ''}</option>
          ))}
        </select>
        {!canEdit && <span className="note">View only — admins / inventory team can edit carts.</span>}
      </div>

      {!selectedId ? (
        <>
          <div className="panel"><p className="note" style={{ margin: 0 }}>Choose a project above to see what it needs and build its inventory cart.</p></div>
          {withCarts.length > 0 && (
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-title"><h2>Projects with a cart</h2><span className="meta">{withCarts.length}</span></div>
              <div className="cart-quick">
                {withCarts.map((p) => (
                  <button key={p.id} className="cart-qchip" onClick={() => setSelectedId(p.id)}>
                    {p.project_number} <span className="note">{(cartByProject[p.id] || []).length} item(s)</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* From the form */}
          <div className="panel">
            <div className="panel-title"><h2>{project?.project_number} — {project?.title || project?.counterparty || 'Project'}</h2><span className="meta">from the proposal form</span></div>
            <div className="cart-form">
              {project?.robot_types && <span>🤖 <b>Robots:</b> {project.robot_types}{project.robot_count != null ? ` · ${project.robot_count} unit(s)` : ''}</span>}
              {project?.agreement_type && <span><b>Type:</b> {project.agreement_type}</span>}
              {project?.counterparty && <span><b>Client:</b> {project.counterparty}</span>}
              {!project?.robot_types && !project?.agreement_type && <span className="note">No form details on the agreement.</span>}
            </div>
          </div>

          {/* The cart */}
          <div className="panel tablewrap" style={{ marginTop: 12 }}>
            <div className="panel-title" style={{ padding: '0 0 10px' }}>
              <h2>🛒 Inventory needed ({cart.length})</h2>
              {canEdit && <button onClick={() => setAddModal({ cn_sku_id: '', quantity: '', note: '' })}>+ Add to cart</button>}
            </div>
            <table>
              <thead><tr><th>Product</th><th>SKU</th><th>Qty needed</th><th>Note</th>{canEdit && <th></th>}</tr></thead>
              <tbody>
                {cart.length ? cart.map((c) => (
                  <tr key={c.id}>
                    <td>{c.product_name || '—'}</td>
                    <td><code>{c.sku || '—'}</code></td>
                    <td>{c.quantity ?? ''}</td>
                    <td className="note">{c.note || ''}</td>
                    {canEdit && <td style={{ textAlign: 'right' }}><button className="secondary cart-rm" onClick={() => removeLine(c.id)} disabled={busy} title="Remove from cart">✕</button></td>}
                  </tr>
                )) : <tr><td colSpan={canEdit ? 5 : 4} className="note">Cart is empty{canEdit ? ' — click “+ Add to cart”.' : '.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Add-to-cart modal */}
      {addModal && (
        <div className="cart-overlay" onClick={() => setAddModal(null)}>
          <div className="cart-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cart-mhead"><b>Add to {project?.project_number}’s cart</b><button className="secondary" onClick={() => setAddModal(null)} style={{ marginLeft: 'auto' }}>✕</button></div>
            <label className="cart-f">Inventory item
              <select value={addModal.cn_sku_id} onChange={(e) => setAddModal({ ...addModal, cn_sku_id: e.target.value })}>
                <option value="">Select an item…</option>
                {(data.inventory || []).map((it) => <option key={it.id} value={it.id}>{(it.sku ? it.sku + ' — ' : '')}{it.product_name || 'item'}{it.quantity != null ? ` (in stock ${it.quantity})` : ''}</option>)}
              </select>
            </label>
            <div className="cart-frow">
              <label className="cart-f">Qty needed<input type="number" value={addModal.quantity} onChange={(e) => setAddModal({ ...addModal, quantity: e.target.value })} /></label>
              <label className="cart-f">Note<input value={addModal.note} onChange={(e) => setAddModal({ ...addModal, note: e.target.value })} placeholder="optional" /></label>
            </div>
            <div className="cart-actions">
              <button onClick={addToCart} disabled={busy || !addModal.cn_sku_id}>Add to cart</button>
              <button className="secondary" onClick={() => setAddModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .invbtn { display:inline-flex; align-items:center; background:var(--primary); color:#fff; padding:8px 16px; border-radius:8px; font-weight:600; font-size:13px; }
        .invbtn:hover { filter:brightness(1.08); }
        .cart-form { display:flex; flex-wrap:wrap; gap:8px 20px; font-size:13.5px; }
        .cart-quick { display:flex; flex-wrap:wrap; gap:8px; }
        .cart-qchip { border:1px solid var(--line); background:var(--surface); border-radius:8px; padding:8px 12px; cursor:pointer; font:inherit; color:var(--ink); }
        .cart-qchip:hover { border-color:var(--primary); }
        .cart-rm { font-size:11px; padding:2px 8px; }
        .panel-title { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .cart-overlay { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:60; display:flex; align-items:flex-start; justify-content:center; padding:48px 16px; }
        .cart-modal { width:460px; max-width:96vw; background:var(--surface); border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,.3); padding:18px; }
        .cart-mhead { display:flex; align-items:center; gap:10px; padding-bottom:10px; margin-bottom:6px; border-bottom:1px solid var(--line); }
        .cart-f { display:grid; gap:4px; font-size:13px; color:var(--muted); margin-top:10px; }
        .cart-f input, .cart-f select { width:100%; }
        .cart-frow { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .cart-actions { display:flex; gap:8px; margin-top:18px; }
        table code { font-size:12px; }
      `}</style>
    </>
  );
}
