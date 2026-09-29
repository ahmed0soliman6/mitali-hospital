const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');

// 1) الدالة المساعدة: نستخرجها ونشغّلها بسلوك حقيقي مع بدائل بسيطة.
const m = index.match(/async function ensureIncomeLoadedForVisitDelete\(target\) \{[\s\S]*?\n\}\n/);
assert.ok(m, 'ensureIncomeLoadedForVisitDelete must exist');

async function run(ctx, target) {
  const calls = [];
  const sandbox = Object.assign({
    STORAGE_MODE: 'firestore', currentUser: { uid: 'u' }, PAGE_DATA_LOADED_AT: {},
    console: { warn() {} },
    loadKeys: async (keys, opts) => { calls.push({ keys, opts }); },
  }, ctx, { calls });
  vm.createContext(sandbox);
  vm.runInContext(m[0] + '\nthis.fn = ensureIncomeLoadedForVisitDelete;', sandbox);
  const ok = await sandbox.fn(target);
  return { ok, calls, loadedAt: sandbox.PAGE_DATA_LOADED_AT.income };
}

(async () => {
  let r = await run({}, { id: 'v1', paid: 100, linkedIncomeId: 'visit-income-clinic-v1' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(JSON.stringify(r.calls[0].keys), '["income"]');
  assert.strictEqual(r.calls[0].opts.requireServer, true);
  assert.ok(r.loadedAt > 0);

  r = await run({ PAGE_DATA_LOADED_AT: { income: Date.now() } }, { id: 'v2', paid: 50, linkedIncomeId: 'x' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.calls.length, 0);

  r = await run({}, { id: 'v3', paid: 0, linkedIncomeId: null });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.calls.length, 0);

  r = await run({ loadKeys: async () => { throw new Error('offline'); } }, { id: 'v4', paid: 10, linkedIncomeId: 'x' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.loadedAt, undefined);

  r = await run({ STORAGE_MODE: 'local' }, { id: 'v5', paid: 10, linkedIncomeId: 'x' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.calls.length, 0);

  const handlers = index.split('[data-del]').slice(1);
  const visitHandlers = handlers.filter(h => h.includes('markSyncTombstone("income"'));
  assert.strictEqual(visitHandlers.length, 2, 'both visit delete handlers must handle linked income');
  for (const h of visitHandlers) {
    const iEnsure = h.indexOf('ensureIncomeLoadedForVisitDelete(target)');
    const iLinked = h.indexOf('const linkedIncome =');
    assert.ok(iEnsure > -1 && iLinked > -1 && iEnsure < iLinked, 'income must be loaded before the linked income lookup');
    assert.match(h, /const linkedIncomeId = linkedIncome \? linkedIncome\.id : \(\(target && target\.linkedIncomeId\) \|\| null\);/);
    assert.match(h, /const hasLinked = !!linkedIncomeId;/);
    assert.match(h, /markSyncTombstone\("income", linkedIncomeId\)/);
    assert.match(h, /DB\.income\.findIndex\(x => x\.id === linkedIncomeId\)/);
    assert.doesNotMatch(h, /markSyncTombstone\("income", linkedIncome\.id\)/);
  }

  assert.match(index, /clinic: \["visitsClinic"\]/);
  assert.match(index, /dashboard: \["income", "expense"\]/);
  assert.match(index, /clinic: \["doctors", "visitsClinic"\]/);

  console.log('PASS visit-delete-income-test: income is loaded before deleting a paid visit, linked income is tombstoned by id even if absent locally, and deletion is blocked (not orphaned) when income cannot be loaded.');
})().catch(err => { console.error(err); process.exit(1); });
