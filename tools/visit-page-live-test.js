const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');

const helper = index.match(/function reconcileVisitPageWithLive\(snapshot, live, sortedList, isFirstPage, hasMore\) \{[\s\S]*?\n\}\n/);
const info = index.match(/function firestorePageInfo\(pageKey, list\) \{[\s\S]*?\n\}\n/);
assert.ok(helper, 'reconcileVisitPageWithLive must exist');
assert.ok(info, 'firestorePageInfo must exist');

function make(dbKey, pageState, dbRows) {
  const sandbox = {
    STORAGE_MODE: 'firestore', PAGE_SIZE: 50,
    state: { tablePage: {} },
    DB: { [dbKey]: dbRows },
    pageKeyDatabaseKey: () => dbKey,
    getFirestorePageState: () => pageState,
  };
  vm.createContext(sandbox);
  vm.runInContext(helper[0] + info[0] + '\nthis.fn = firestorePageInfo;', sandbox);
  return sandbox.fn;
}
const ids = rows => JSON.stringify(rows.map(r => r.id));
const V = (id, date, extra) => Object.assign({ id, date, patient: id }, extra || {});

{
  const a = V('a', '2026-09-29'), b = V('b', '2026-09-28'), n = V('new', '2026-09-30');
  const st = { currentPage: 1, pages: { 1: [a, b] }, hasMore: {} };
  const fn = make('visitsClinic', st, [a, b, n]);
  const pg = fn('visits_clinic', [n, a, b]);
  assert.strictEqual(ids(pg.pageItems), '["new","a","b"]');
  assert.strictEqual(pg.total, 3);
  assert.strictEqual(ids(st.pages[1]), '["a","b"]', 'the cached snapshot itself must stay untouched');
}
{
  const a = V('a', '2026-09-29'), b = V('b', '2026-09-28'), c = V('c', '2026-09-27');
  const st = { currentPage: 1, pages: { 1: [a, b, c] }, hasMore: {} };
  const fn = make('visitsDental', st, [a, c]);
  const pg = fn('visits_dental', [a, c]);
  assert.strictEqual(ids(pg.pageItems), '["a","c"]');
}
{
  const a = V('a', '2026-09-29', { paid: 10 }), a2 = V('a', '2026-09-29', { paid: 99 });
  const st = { currentPage: 1, pages: { 1: [a] }, hasMore: {} };
  const fn = make('visitsClinic', st, [a2]);
  const pg = fn('visits_clinic', [a2]);
  assert.strictEqual(pg.pageItems[0].paid, 99);
}
{
  const x = V('x', '2026-09-10'), y = V('y', '2026-09-09'), n = V('new', '2026-09-30');
  const st = { currentPage: 2, pages: { 1: [V('p', '2026-09-20')], 2: [x, y] }, hasMore: {} };
  const fn = make('visitsClinic', st, [x, n]);
  const pg = fn('visits_clinic', [n, x]);
  assert.strictEqual(ids(pg.pageItems), '["x"]');
}
{
  const a = V('a', '2026-09-30'), b = V('b', '2026-09-25');
  const old = V('old', '2026-09-01'), n = V('new', '2026-09-30');
  const st = { currentPage: 1, pages: { 1: [a, b] }, hasMore: { 1: true } };
  const fn = make('visitsClinic', st, [a, b, old, n]);
  const pg = fn('visits_clinic', [n, a, b, old]);
  assert.strictEqual(ids(pg.pageItems), '["new","a","b"]');
}
{
  const a = V('a', '2026-09-29'), n = V('new', '2026-09-30');
  const st = { currentPage: 1, pages: { 1: [a] }, hasMore: {} };
  const fn = make('payroll', st, [a, n]);
  const pg = fn('payroll', [n, a]);
  assert.strictEqual(ids(pg.pageItems), '["a"]');
}
{
  const st = { currentPage: 1, pages: {}, hasMore: {} };
  const fn = make('visitsClinic', st, []);
  assert.strictEqual(fn('visits_clinic', []), null);
}

assert.match(index, /dashboard: \["income", "expense"\]/);
assert.match(index, /clinic: \["visitsClinic"\]/);
assert.match(index, /pageState\.pages\[page\] = Array\.isArray\(result\.records\) \? result\.records\.slice\(\) : \[\];/);

console.log('PASS visit-page-live-test: added/edited/deleted visits show immediately in the diary list, page 2 and non-visit tables are unchanged, and the cached page snapshot is never mutated.');
