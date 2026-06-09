// GOV-2 — pending-approval registry + the loopback "hold open until decided" primitive.
// In-memory only (no DB/file; ADR 0024/0027 — pause state is server memory). A HIGH/CRITICAL action
// from the MCP gate (GOV-3) calls register() and AWAITS the returned promise; the browser decision
// (POST /api/run/approval) calls resolve(), which unblocks it. On resolve we also fire GOV-6's
// `record` callback so the decision lands in the task log via the canonical writer.

function createApprovals({ emit = () => {}, record = () => {} } = {}) {
  const pending = new Map(); // approval_id -> { ...info, status, resolveFn }
  let seq = 0;

  // Returns a promise that resolves to 'approved' | 'denied' when the browser decides.
  function register(info = {}) {
    const approval_id = `ap-${++seq}`;
    return new Promise((resolveFn) => {
      const rec = {
        approval_id, status: 'pending', resolveFn,
        run_id: info.run_id, task_id: info.task_id, project_path: info.project_path,
        action: info.action || 'unknown action', risk: info.risk || 'HIGH',
        why: info.why || '', files: info.files || [], rollback: info.rollback || '',
      };
      pending.set(approval_id, rec);
      emit(rec.run_id, 'approval_request', {
        approval_id, action: rec.action, risk: rec.risk, why: rec.why, files: rec.files, rollback: rec.rollback,
      });
    });
  }

  // Browser decision. Idempotent on a second call for the same id.
  function resolve(approval_id, decision) {
    const rec = pending.get(approval_id);
    if (!rec) return false;
    if (rec.status !== 'pending') return true; // idempotent — already decided
    const dec = decision === 'approve' || decision === 'approved' ? 'approved' : 'denied';
    rec.status = dec; // keep the record (status flips); listForRun filters to pending only
    emit(rec.run_id, 'approval_resolved', { approval_id, decision: dec });
    try { record(rec, dec); } catch { /* recording must not break the run */ }
    rec.resolveFn(dec);
    return true;
  }

  const get = (approval_id) => pending.get(approval_id) || null;
  const listForRun = (run_id) => [...pending.values()].filter((r) => r.run_id === run_id && r.status === 'pending');

  return { register, resolve, get, listForRun, _pending: pending };
}

module.exports = { createApprovals };
