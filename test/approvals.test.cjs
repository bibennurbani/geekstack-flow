'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createApprovals } = require('../ui/server/approvals.cjs');

test('register emits approval_request and holds until resolve; resolve emits + records + unblocks', async () => {
  const emitted = []; const recorded = [];
  const ap = createApprovals({ emit: (run_id, type, data) => emitted.push({ run_id, type, data }), record: (rec, dec) => recorded.push([rec.approval_id, dec]) });

  const p = ap.register({ run_id: 'r-1', task_id: 'T-1', project_path: '/p', action: 'git push', risk: 'HIGH', why: 'ship', files: ['a'], rollback: 'revert' });

  // approval_request fired synchronously on register
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].type, 'approval_request');
  const approval_id = emitted[0].data.approval_id;
  assert.strictEqual(emitted[0].data.risk, 'HIGH');
  assert.strictEqual(ap.listForRun('r-1').length, 1, 'pending appears for the run');

  // promise is still pending — resolve it
  ap.resolve(approval_id, 'approve');
  const decision = await p;
  assert.strictEqual(decision, 'approved');
  assert.strictEqual(emitted[1].type, 'approval_resolved');
  assert.deepStrictEqual(recorded, [[approval_id, 'approved']], 'GOV-6 record fired once');
  assert.strictEqual(ap.listForRun('r-1').length, 0, 'no longer pending');
});

test('deny path resolves to denied', async () => {
  const ap = createApprovals();
  const p = ap.register({ run_id: 'r-2', action: 'rm -rf x', risk: 'CRITICAL' });
  const id = ap.listForRun('r-2')[0].approval_id;
  ap.resolve(id, 'deny');
  assert.strictEqual(await p, 'denied');
});

test('cancelForRun resolves pending approvals as denied without recording', async () => {
  const emitted = []; const recorded = [];
  const ap = createApprovals({ emit: (run_id, type, data) => emitted.push({ type, data }), record: (r, d) => recorded.push(d) });
  const p1 = ap.register({ run_id: 'r-x', action: 'git push', risk: 'HIGH' });
  const p2 = ap.register({ run_id: 'r-x', action: 'rm -rf', risk: 'CRITICAL' });
  ap.register({ run_id: 'r-other', action: 'y', risk: 'HIGH' }); // different run — untouched
  const n = ap.cancelForRun('r-x');
  assert.strictEqual(n, 2, 'both pending approvals for the run cancelled');
  assert.deepStrictEqual([await p1, await p2], ['denied', 'denied'], 'held long-polls unblock');
  assert.strictEqual(recorded.length, 0, 'no governance entries recorded for a dead run');
  assert.strictEqual(emitted.filter((e) => e.type === 'approval_resolved').length, 2);
  assert.strictEqual(ap.listForRun('r-x').length, 0);
  assert.strictEqual(ap.listForRun('r-other').length, 1, 'other run unaffected');
});

test('double-resolve is idempotent; unknown id returns false', () => {
  const recorded = [];
  const ap = createApprovals({ record: (r, d) => recorded.push(d) });
  ap.register({ run_id: 'r-3', action: 'x', risk: 'HIGH' });
  const id = ap.listForRun('r-3')[0].approval_id;
  assert.strictEqual(ap.resolve(id, 'approve'), true);
  assert.strictEqual(ap.resolve(id, 'deny'), true, 'second resolve is a no-op success');
  assert.strictEqual(recorded.length, 1, 'recorded once only');
  assert.strictEqual(ap.resolve('nope', 'approve'), false, 'unknown id -> false');
});
