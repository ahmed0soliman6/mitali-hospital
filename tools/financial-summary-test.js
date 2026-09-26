'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { aggregateCollection, requestedMonth } = require('../api/financial/summary');

const source = fs.readFileSync('index.html', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

assert.equal(requestedMonth({ query: { month: '2026-09' } }), '2026-09');
assert.equal(requestedMonth({ query: { month: 'all' } }), 'all');
assert.equal(requestedMonth({ query: { month: 'bad' } }), null);

const income = Array.from({ length: 120 }, (_, i) => ({ amount: i + 1, date: i < 60 ? '2026-09-15' : '2026-08-15' }));
const expense = [{ amount: 25, date: '2026-09-03' }, { amount: 75, date: '2026-08-03' }];
function mockAdmin(collections) {
  const firestore = () => ({
    collection(name) {
      let rows = collections[name];
      return {
        where(field, op, value) {
          rows = rows.filter(row => op === '>=' ? row[field] >= value : row[field] <= value);
          return this;
        },
        aggregate() { return { async get() { return { data: () => ({ total: rows.reduce((s, r) => s + r.amount, 0), count: rows.length }) }; } }; },
      };
    },
  });
  firestore.AggregateField = { sum: field => ({ field }), count: () => ({}) };
  return { firestore };
}
(async () => {
  const api = mockAdmin({ income, expense });
  const allIncome = await aggregateCollection(api, 'income', 'all');
  const monthIncome = await aggregateCollection(api, 'income', '2026-09');
  const monthExpense = await aggregateCollection(api, 'expense', '2026-09');
  assert.equal(allIncome.count, 120);
  assert.equal(allIncome.total, 7260);
  assert.equal(monthIncome.count, 60);
  assert.equal(monthIncome.total, 1830);
  assert.equal(monthExpense.total, 25);
  assert.equal(1000 + monthIncome.total - monthExpense.total, 2805);

  for (const fn of ['currentBalance', 'renderMoneyPage', 'renderDashboard', 'renderReports', 'ledgerRows']) {
    const start = source.indexOf(`function ${fn}`);
    assert.ok(start >= 0, `${fn} must exist`);
    const end = source.indexOf('\nfunction ', start + 10);
    const body = source.slice(start, end > start ? end : start + 12000);
    assert.doesNotMatch(body, /getTable\s*\(/, `${fn} must not use getTable for financial totals`);
  }
  assert.match(source, /window\.MitaliFirebase\.getFinancialSummary/);
  assert.match(source, /cachedFinancialSummary\("all"\)/);
  assert.match(source, /cachedFinancialSummary\(ym\)/);
  for (const collection of ['visits_clinic', 'visits_dental', 'visits_operations', 'visits_labs', 'visits_radiology', 'income', 'expense', 'payroll', 'lab_expenses']) {
    assert.match(rules, new RegExp(`match \\/${collection}\\/\\{document\\}[^]*?allow read, write: if activeUser\\(\\);`));
  }
  assert.match(rules, /match \/users\/\{uid\}/);
  assert.match(rules, /match \/staff_accounts\/\{document\}[^]*?allow read, write: if false;/);
  assert.match(rules, /match \/_security\/\{document\}[^]*?allow read, write: if false;/);
  console.log('PASS financial-summary-test: 120-record totals, month filtering, expense/balance arithmetic, automatic linked-write rules, and no getTable totals.');
})().catch(error => { console.error(error); process.exitCode = 1; });
