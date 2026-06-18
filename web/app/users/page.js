'use client';
import { useEffect, useState } from 'react';
import { PageHeader } from '../_components/blueprint';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('admin');
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    fetch('/api/admin/users')
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed to load'); return j; })
      .then((d) => { setUsers(d.users || []); setErr(null); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function save(addr, r) {
    setBusy(true); setErr(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: addr, role: r }),
    });
    const j = await res.json(); setBusy(false);
    if (!res.ok) { setErr(j.error || 'Failed'); return; }
    load();
  }
  async function add() {
    const addr = email.trim();
    if (!addr) return;
    await save(addr, role);
    setEmail('');
  }
  async function remove(addr) {
    if (!window.confirm(`Remove ${addr}? They revert to a regular user (only their own projects).`)) return;
    setBusy(true); setErr(null);
    const res = await fetch('/api/admin/users?email=' + encodeURIComponent(addr), { method: 'DELETE' });
    const j = await res.json(); setBusy(false);
    if (!res.ok) { setErr(j.error || 'Failed'); return; }
    load();
  }

  return (
    <>
      <PageHeader title="Users" sub="Everyone who has signed in. Admins see all projects, the Database, and the AI tabs; Members see only their own agreements." sheet="Users" />
      {err && <p className="error">{err}</p>}

      <div className="panel" style={{ maxWidth: 600 }}>
        <h3 style={{ marginTop: 0 }}>Add or update a user</h3>
        <div className="row2" style={{ alignItems: 'end' }}>
          <label>Email<input type="email" placeholder="name@richtechsystem.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Admin — sees everything</option>
              <option value="user">Member — own projects only</option>
            </select>
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <button onClick={add} disabled={busy || !email.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
        <p className="note" style={{ marginBottom: 0 }}>Use the person’s exact Google sign-in email. Changes apply on their next page load.</p>
      </div>

      <h2>Users &amp; roles</h2>
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>Last seen</th><th>Source</th><th></th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="note">Loading…</td></tr>
            ) : users.length ? users.map((u) => (
              <tr key={u.email}>
                <td>{u.email}</td>
                <td>
                  {u.source === 'builtin' ? <span className="chip ok">Admin</span> : (
                    <select value={u.role} onChange={(e) => save(u.email, e.target.value)} disabled={busy}>
                      <option value="admin">Admin</option>
                      <option value="user">Member</option>
                    </select>
                  )}
                </td>
                <td className="note">{u.last_seen ? new Date(u.last_seen).toLocaleString() : '—'}</td>
                <td><span className="note">{u.source === 'builtin' ? 'built-in (config)' : 'managed'}</span></td>
                <td>{u.source === 'managed'
                  ? <button className="secondary" onClick={() => remove(u.email)} disabled={busy}>Remove</button>
                  : <span className="note">—</span>}</td>
              </tr>
            )) : <tr><td colSpan={5} className="note">No managed users yet — add one above.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="note">Built-in admins are set in the deploy config and can’t be edited here (so no one gets locked out).</p>
    </>
  );
}
