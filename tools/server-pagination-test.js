'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const store = fs.readFileSync('firebase-store.js', 'utf8');
const app = fs.readFileSync('index.html', 'utf8');
const start = store.indexOf('const PAGE_QUERY_CONFIG');
const end = store.indexOf('\n\n  async function getValue', start);
assert.ok(start >= 0 && end > start, 'production getPage block must exist');
const calls = [];
const docs = Array.from({ length: 50 }, (_, i) => ({
  id: `id-${i}`,
  data: () => ({ date: `2026-09-${String(30 - (i % 29)).padStart(2, '0')}`, amount: i }),
  get: field => field === 'date' ? `2026-09-${String(30 - (i % 29)).padStart(2, '0')}` : undefined,
}));
const query = {
  where(field, op, value) { calls.push(['where', field, op, value]); return this; },
  orderBy(field, direction) { calls.push(['orderBy', String(field), direction]); return this; },
  limit(size) { calls.push(['limit', size]); return this; },
  startAfter(primary, id) { calls.push(['startAfter', primary, id]); return this; },
  async get() { return { docs }; },
};
const context = {
  db: { collection: key => { calls.push(['collection', key]); return query; } },
  collectionName: key => key,
  ready: async () => {},
  recordReadMetric: (key, count) => calls.push(['metric', key, count]),
  window: { firebase: { firestore: { FieldPath: { documentId: () => '__name__' } } } },
};
vm.runInNewContext(`${store.slice(start, end)}\nthis.getPage = getPage;`, context);
(async () => {
  const result = await context.getPage('income', {
    pageSize: 5000,
    where: [
      { field: 'date', op: '>=', value: '2026-09-01' },
      { field: 'date', op: '<=', value: '2026-09-30' },
    ],
    cursor: { primaryValue: '2026-09-20', documentId: 'old-id' },
  });
  assert.equal(result.records.length, 50);
  assert.equal(result.pageSize, 50);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor.primaryValue, '2026-09-10');
  assert.equal(result.nextCursor.documentId, 'id-49');
  assert.deepEqual(calls.filter(c => c[0] === 'limit'), [['limit', 50]]);
  assert.equal(calls.filter(c => c[0] === 'where').length, 2);
  assert.equal(calls.filter(c => c[0] === 'startAfter').length, 1);
  assert.equal(calls.find(c => c[0] === 'startAfter')[2], 'old-id');
  assert.equal(calls.find(c => c[0] === 'metric')[2], 50);

  assert.match(store, /startAfter\(cursor\.primaryValue, String\(cursor\.documentId\)\)/);
  assert.doesNotMatch(store, /\.offset\(/);
  assert.match(app, /const SERVER_PAGED_KEYS = new Set/);
  assert.match(app, /loadFirestorePage\(key, 1/);
  assert.match(app, /PAGE_PRIMARY_KEY/);
  assert.match(app, /income: \["income"\]/);
  assert.match(app, /ledger: \["income", "expense", "settings"\]/);
  console.log('PASS server-pagination-test: getPage caps reads at 50, applies server filters and cursor, exposes nextCursor, avoids offset, and keeps income/ledger page loads scoped.');
})().catch(error => { console.error(error); process.exitCode = 1; });
