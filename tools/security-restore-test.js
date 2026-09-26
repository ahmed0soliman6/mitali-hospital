'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

// Execute the production restore function, not a copied model.
const start = source.indexOf('async function restoreTableFully');
const end = source.indexOf('async function migrateCurrentDataToFirestore', start);
assert.ok(start >= 0 && end > start, 'production restoreTableFully must exist');
const restoreCode = `${source.slice(start, end)}\nthis.restoreTableFully = restoreTableFully;`;
const calls = [];
const context = {
  DB: { income: [{ id: 'A', amount: 500 }, { id: 'B', amount: 700 }] },
  window: {
    MitaliFirebase: {
      async getTable(key) { calls.push(['read', key]); return [{ id: 'A' }, { id: 'B' }, { id: 'C' }]; },
      async deleteRecords(key, ids) { calls.push(['delete', key, ids]); },
      async upsertRecords(key, records) { calls.push(['upsert', key, records.map(r => r.id)]); },
    },
  },
};
vm.runInNewContext(restoreCode, context);
(async () => {
  const result = await context.restoreTableFully('income', ['A', 'B']);
  assert.equal(result.applied, true);
  assert.equal(result.deleted, 1);
  assert.equal(result.uploaded, 2);
  assert.deepEqual(calls, [
    ['read', 'income'],
    ['delete', 'income', ['C']],
    ['upsert', 'income', ['A', 'B']],
  ], 'restore must delete only explicitly absent records and upload backup records');

  // The production CRUD path must retain the explicit-only deletion invariant.
  assert.match(source, /const deleted = \[\.\.\.new Set\(explicitDeleted\)\]/);
  assert.doesNotMatch(source, /const deleted = \[\.\.\.new Set\(\[\s*\.\.\.\(previous \|\| \[\]\)/);

  // Rules must deny unknown collections and client access to recovery material.
  assert.match(rules, /match \/_security\/\{document\} \{\s*allow read, write: if false;/);
  assert.match(rules, /match \/\{collection\}\/\{document\} \{\s*allow read, write: if false;/);
  for (const [collection, module] of [
    ['visits_clinic', 'clinic'], ['visits_dental', 'dental'], ['visits_operations', 'operations'],
    ['visits_labs', 'labs'], ['visits_radiology', 'radiology'], ['income', 'income'],
    ['expense', 'expense'], ['payroll', 'payroll'],
  ]) {
    assert.match(rules, new RegExp(`match \\/${collection}\\/\\{document\\}[^]*?allow read, write: if activeUser\\(\\);`));
  }
  assert.match(rules, /match \/lab_expenses\/\{document\}[^]*?allow read, write: if activeUser\(\);/);
  console.log('PASS security-restore-test: production restore uploads the selected backup and deletes only its explicit scope; snapshot deletion remains explicit-only; Firestore rules protect _security, unknown collections, and module permissions.');
})().catch(error => { console.error(error); process.exitCode = 1; });
