// Read one submission back by id. Used by the tech-confirmation webhook to
// auto-capture the SO number (and team/dates/technicians) from the live form
// rather than trusting the webhook's raw field encoding. Answers come back
// keyed by question-id: { "15": { answer, prettyFormat, name, type }, ... }.
export async function getJotformSubmission(submissionId) {
  const key = process.env.JOTFORM_API_KEY;
  if (!key) return { ok: false, skipped: 'JOTFORM_API_KEY not configured' };
  try {
    const r = await fetch(
      `https://api.jotform.com/submission/${encodeURIComponent(submissionId)}?apiKey=${encodeURIComponent(key)}`,
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.message || `JotForm HTTP ${r.status}` };
    const content = j.content || {};
    return { ok: true, form_id: content.form_id || null, answers: content.answers || {} };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Minimal JotForm client — submit a finalized form. Degrades gracefully when
// JOTFORM_API_KEY is not set (returns { ok:false, skipped }).
export async function createJotformSubmission(formId, payload) {
  const key = process.env.JOTFORM_API_KEY;
  if (!key) return { ok: false, form_id: formId, skipped: 'JOTFORM_API_KEY not configured' };
  try {
    const body = new URLSearchParams(payload);
    const r = await fetch(
      `https://api.jotform.com/form/${formId}/submissions?apiKey=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, form_id: formId, error: j.message || `JotForm HTTP ${r.status}` };
    const content = j.content || {};
    return { ok: true, form_id: formId, submission_id: content.submissionID || null, url: content.URL || null };
  } catch (e) {
    return { ok: false, form_id: formId, error: String(e?.message || e) };
  }
}
