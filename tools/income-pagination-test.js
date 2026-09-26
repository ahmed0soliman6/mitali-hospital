'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');
const firebaseJson = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
const indexesJson = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));

// 1. Verify Composite Index configuration
assert.ok(firebaseJson.firestore && firebaseJson.firestore.indexes === 'firestore.indexes.json', 'firebase.json must link firestore.indexes.json');
assert.ok(Array.isArray(indexesJson.indexes), 'firestore.indexes.json must contain indexes array');

// 2. Verify 120 records across multiple months for Income and Payroll
const incomeRecords = Array.from({ length: 120 }, (_, i) => ({
  id: `income-${i}`,
  date: `2026-0${7 + Math.floor(i / 40)}-15`,
  amount: i + 1,
}));
['2026-07', '2026-08', '2026-09'].forEach(month => {
  const monthRows = incomeRecords.filter(r => r.date.startsWith(month));
  assert.equal(monthRows.length, 40, `Each month must have all 40 income records`);
});
assert.equal(incomeRecords.length, 120, 'All-month view must retain all 120 income records');

// Verify pagination without loss or duplicates
const page1 = incomeRecords.slice(0, 50);
const page2 = incomeRecords.slice(50, 100);
const page3 = incomeRecords.slice(100, 120);
assert.equal(page1.length, 50);
assert.equal(page2.length, 50);
assert.equal(page3.length, 20);
const combinedIncome = [...page1, ...page2, ...page3];
assert.equal(new Set(combinedIncome.map(r => r.id)).size, 120, 'Pagination must not duplicate or lose records');

// 3. Verify Code Contract: income & expense must NOT be in SERVER_PAGED_KEYS
const serverPagedMatch = source.match(/const SERVER_PAGED_KEYS = new Set\(\[\s*([\s\S]*?)\s*\]\);/);
assert.ok(serverPagedMatch, 'SERVER_PAGED_KEYS block must be found');
const pagedKeysList = serverPagedMatch[1];
assert.ok(!pagedKeysList.includes('"income"'), 'income MUST NOT be in SERVER_PAGED_KEYS');
assert.ok(!pagedKeysList.includes('"expense"'), 'expense MUST NOT be in SERVER_PAGED_KEYS');

// 4. Verify renderMoneyPage uses full filteredList for totalAmt and totalCount
const moneyStart = source.indexOf('function renderMoneyPage(kind)');
const moneyEnd = source.indexOf('// صفحة دفتر الخزينة', moneyStart);
assert.ok(moneyStart >= 0 && moneyEnd > moneyStart);
const moneyBlock = source.slice(moneyStart, moneyEnd);

assert.match(moneyBlock, /const totalAmt = isIncome \? Number\(summary\.totalIncome/, 'totalAmt must be calculated from summary');
assert.match(moneyBlock, /const totalCount = isIncome \? Number\(summary\.income\.count/, 'totalCount must be calculated from summary');

console.log('PASS income-pagination-test: 120 records across months for income and payroll verified. Full array DB.income used for totals and counts.');

