'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');
const store = fs.readFileSync('firebase-store.js', 'utf8');
const realtimeStart = source.indexOf('function applyRealtimeChanges');
const realtimeEnd = source.indexOf('async function refreshTableFromFirestore', realtimeStart);
assert.ok(realtimeStart >= 0 && realtimeEnd > realtimeStart, 'production realtime helper must exist');
const context = { PENDING_WRITES: 0, SYNC_QUEUE_KEYS: new Set() };
vm.runInNewContext(`${source.slice(realtimeStart, realtimeEnd)}\nthis.applyRealtimeChanges = applyRealtimeChanges;`, context);

const staleLocal = [{ id: 'X', updatedAt: '2026-09-26T14:00:00.000Z', amount: 500 }];
context.applyRealtimeChanges('income', staleLocal, [{ type: 'modified', record: { id: 'X', updatedAt: '2026-09-26T13:00:00.000Z', amount: 1 } }], new Set());
assert.equal(staleLocal[0].amount, 500, 'older realtime update must not overwrite newer local record');

const pendingLocal = [{ id: 'X', updatedAt: '2026-09-26T14:00:00.000Z', amount: 500 }];
context.PENDING_WRITES = 1;
context.SYNC_QUEUE_KEYS.add('income');
context.applyRealtimeChanges('income', pendingLocal, [{ type: 'removed', record: { id: 'X' } }], new Set());
assert.equal(pendingLocal.length, 1, 'pending local mutation must not be replaced by realtime');
context.PENDING_WRITES = 0;
context.SYNC_QUEUE_KEYS.clear();

const crossDeviceLocal = [{ id: 'X', amount: 500 }];
context.applyRealtimeChanges('income', crossDeviceLocal, [{ type: 'removed', record: { id: 'X' } }], new Set());
assert.equal(crossDeviceLocal.length, 0, 'cross-device explicit remote removal must remove stale local record');

const manualIncome = [];
context.applyRealtimeChanges('income', manualIncome, [{ type: 'added', record: { id: 'manual-test-1', amount: 500, doctorId: null } }], new Set());
assert.deepEqual(manualIncome, [{ id: 'manual-test-1', amount: 500, doctorId: null }], 'manual income without doctor must survive realtime reconciliation');

assert.match(source, /for \(const source of VISIT_SOURCE_DEFINITIONS\)/);
assert.match(source, /String\(visit\.linkedIncomeId \|\| ""\) === String\(removed\.id\)/);
assert.match(source, /const CHUNK = 400/);
assert.match(source, /await window\.MitaliFirebase\.deleteRecords\("auditLog", ids\.slice\(i, i \+ CHUNK\)\)/);
assert.match(source, /"labExpenses"/);
assert.match(store, /const uniqueIds = \[\.\.\.new Set\(\(ids \|\| \[\]\)\.map\(String\)\)\]/);
assert.match(store, /for \(let i = 0; i < uniqueIds\.length; i \+= CHUNK\)/);
console.log('PASS realtime-consistency-test: stale realtime updates, pending outbox mutations, cross-device deletes, manual income without doctor, all visit sources, audit chunking, and 400-item Firestore deletes.');
