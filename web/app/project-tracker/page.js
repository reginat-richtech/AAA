'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, StageRail, ProjectRail, STAGES, STAGE_RAMP } from '../_components/blueprint';

const LEAF_ICON = { done: '✓', pending: '○', manual: '·' };

// Node dot styling for the expanded tree. Solid fill for done/current, hollow
// for pending, dashed for reference — no translucent ring (it rendered as a
// half-cut / double circle at this small size).
function dotStyle(node, color) {
  if (node.status === 'done' || node.status === 'current') return { background: color, borderColor: color };
  if (node.status === 'manual') return { background: '#fff', borderColor: color, borderStyle: 'dashed' };
  return { background: '#fff', borderColor: 'var(--line)' };
}

export default function ProjectTracker() {
  const [data, setData] = useState({ stages: [], projects: [], counts: {} });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    fetch('/api/project-tracker/projects').then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  const projects = data.projects.filter((p) => {
    if (!q) return true;
    const hay = `${p.project_number} ${p.contract_number} ${p.counterparty} ${p.salesman_name} ${p.so_number} ${p.robot_types}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <>
      <PageHeader title="Project Tracker" sub="Read-only workflow tree per project. Each project starts from the Final Proposal Form, then advances through 9 stages as its agreement, tech request, approval, and confirmation steps complete." sheet="Project Tracker" />

      <section className="panel">
        <div className="panel-title"><h2>Project process tracker</h2><span className="meta">9 stages · red → blue</span></div>
        <StageRail stages={STAGES} counts={data.counts} />
        <div className="rail-legend">
          <span><i className="done" /> done</span>
          <span><i className="next" /> next action</span>
          <span><i className="ref" /> reference stage</span>
          <span><i className="pend" /> pending</span>
          <span className="note">· nodes take each stage's color (1→9 red → blue)</span>
        </div>
        <style>{`
          .rail-legend { display:flex; flex-wrap:wrap; align-items:center; gap:6px 16px; margin-top:14px; padding-top:12px; border-top:1px dashed var(--line); font-size:12.5px; color:var(--muted); }
          .rail-legend i { display:inline-block; width:13px; height:13px; border-radius:50%; margin-right:6px; vertical-align:-2px; border:2px solid var(--line); background:#fff; }
          .rail-legend i.done { background:var(--primary); border-color:var(--primary); }
          .rail-legend i.next { border-color:#10b981; box-shadow:0 0 0 3px rgba(16,185,129,.25); }
          .rail-legend i.ref { border-style:dashed; }
        `}</style>
      </section>

      <div className="toolbar">
        <input placeholder="Search client, salesman, SO#, robot…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 320 }} />
        <span className="note">{projects.length} project(s)</span>
      </div>

      {projects.length === 0 && <p className="note">No projects yet — a project starts when a Final Proposal Form is submitted.</p>}

      {projects.map((p) => {
        const curColor = STAGE_RAMP[p.stage];
        const cur = p.nodes[p.stage];
        const isOpen = open === p.id;
        return (
          <div className="pcard" key={p.id} onClick={() => setOpen(isOpen ? null : p.id)}>
            <div className="pc-head">
              <div className="pc-title">
                <span className="pc-id">{p.project_number}</span>
                <span className="pc-name">{p.title || p.counterparty || '—'}</span>
              </div>
              <span className="pc-stage" style={{ background: curColor }}>Stage {p.stage + 1}/9 · {cur.label}</span>
            </div>

            <div className="pc-meta">
              {p.agreement_type && <span className="type-pill">{p.agreement_type}</span>}
              {p.robot_types && <span><span className="mi">🤖</span> {p.robot_types}{p.robot_count != null ? ` · ${p.robot_count} unit${p.robot_count === 1 ? '' : 's'}` : ''}</span>}
              {p.salesman_name && <span><span className="mi">👤</span> {p.salesman_name}</span>}
              {p.contract_number && <span>Contract {p.contract_number}</span>}
              {p.so_number && <span>SO {p.so_number}</span>}
              {p.created_at && <span><span className="mi">📅</span> {new Date(p.created_at).toLocaleDateString()}</span>}
              <span className="pc-link" onClick={(e) => e.stopPropagation()}>
                {p.is_proposal_only
                  ? <Link href={`/data-upload?sales_name=${encodeURIComponent(p.salesman_name || '')}&sales_email=${encodeURIComponent(p.salesman_email || '')}&contract=${encodeURIComponent(p.contract_number || '')}`} className="btnlink">+ Upload agreement ↗</Link>
                  : <Link href={`/tech-request?agreement=${p.id}`}>Tech Request ↗</Link>}
                {p.jotform_url && <> · <a href={p.jotform_url} target="_blank" rel="noreferrer">JotForm ↗</a></>}
                {p.calendar_link && <> · <a href={p.calendar_link} target="_blank" rel="noreferrer">Calendar ↗</a></>}
              </span>
            </div>

            <ProjectRail nodes={p.nodes} />

            {isOpen && (
              <div className="tree" onClick={(e) => e.stopPropagation()}>
                {p.nodes.map((n, i) => (
                  <div className="tnode" key={n.key}>
                    <div className="h"><span className="dot" style={dotStyle(n, STAGE_RAMP[i])} /> {i + 1}. {n.label} <span className="note" style={{ fontWeight: 400 }}>· {n.status}</span></div>
                    {n.tasks.map((t, j) => (
                      <div className="tleaf" key={j}>
                        <span className="s">{LEAF_ICON[t.status]}</span>
                        <span>{t.label}{t.detail ? <span className="d"> — {t.detail}</span> : null}{t.doc ? <> · <a href={t.doc.preview} target="_blank" rel="noreferrer" title="Preview document">{t.doc.name}</a> · <a href={t.doc.download} title="Download document">Download</a></> : t.url ? <> · <a href={t.url} target="_blank" rel="noreferrer">link</a></> : null}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
