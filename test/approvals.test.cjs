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
