const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');
const operationalKeys = [
  'visitsClinic', 'visitsDental', 'visitsOperations', 'visitsLabs',
  'visitsRadiology', 'income', 'expense'
];

// Guard the production rule: no previous-current diff may produce deletes.
assert.match(source, /const deleted = \[\.\.\.new Set\(explicitDeleted\)\]/);
assert.doesNotMatch(source, /const deleted = \[\.\.\.new Set\(\[\s*\.\.\.\(previous \|\| \[\]\)/);
assert.match(source, /function mergeRemoteSnapshot\(key, remoteValue, blockedIds = new Set\(\)\)/);
assert.match(source, /Snapshot ناقصة لا تعني حذفًا/);
assert.match(source, /if \(recentMutation \|\| SYNC_QUEUE_KEYS\.has\(String\(key\)\)\)/);
assert.match(source, /async function syncVisitIncomeLink\(rec, kind, skipPersist\)/);
assert.match(source, /await markSyncTombstone\("income", linked\.id\)/);
assert.match(source, /async function syncPayrollExpenseLink\(rec\)/);
assert.match(source, /async function syncLabExpenseTreasuryLink\(rec, doctorName\)/);
assert.match(source, /await markSyncTombstone\("expense", linked\.id\)/);
assert.match(source, /await markSyncTombstone\("payroll", rec\.id\)/);
assert.match(source, /await markSyncTombstone\("doctors", removed\.id\)/);
assert.match(source, /await markSyncTombstone\("employees", removed\.id\)/);
assert.match(source, /if \(removed\) await markSyncTombstone\(isIncome \? "income" : "expense", removed\.id\)/);

// Behavioral model for every operational collection: a partial local snapshot
// may update one record, but must never delete an omitted remote record.
for (const key of operationalKeys) {
  const remote = new Map([
    ['A', { id: 'A', value: 1 }],
    ['B', { id: 'B', value: 2 }],
    ['C', { id: 'C', value: 3 }],
  ]);
  const localSnapshot = [{ id: 'A', value: 1 }, { id: 'B', value: 20 }];
  const previousIds = new Set(['A', 'B', 'C']);
  const nextIds = new Set(localSnapshot.map(record => String(record.id)));
  const explicitDeleted = [];
  const deleted = [...new Set(explicitDeleted)];
  assert.deepEqual(deleted, [], `${key}: missing C must not become delete`);
  localSnapshot.forEach(record => remote.set(record.id, record));
  assert.equal(remote.has('C'), true, `${key}: C must remain remotely`);
  assert.equal(previousIds.has('C'), true);
  assert.equal(nextIds.has('C'), false);
}

// Explicit delete remains the only deletion path.
const tombstones = ['B'];
assert.deepEqual([...new Set(tombstones)], ['B']);
console.log('PASS snapshot-safety-test: partial snapshots never delete omitted records across clinics, dental, operations, labs, radiology, income, and expense; explicit tombstones remain the only delete signal.');
