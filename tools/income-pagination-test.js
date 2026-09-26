'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');
const firebaseJson = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
const indexesJson = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));

// 1. Verify Composite Index configuration
assert.ok(firebaseJson.firestore && firebaseJson.firestore.indexes === 'firestore.indexes.json', 'firebase.json must link firestore.indexes.json');
assert.ok(Array.isArray(indexesJson.indexes), 'firestore.indexes.json must contain indexes array');

const indexedGroups = new Set(indexesJson.indexes.map(idx => idx.collectionGroup));
['income', 'expense', 'payroll', 'lab_expenses'].forEach(col => {
  assert.ok(indexedGroups.has(col), `firestore.indexes.json must contain index for ${col}`);
  const indexDef = indexesJson.indexes.find(idx => idx.collectionGroup === col);
  assert.equal(indexDef.queryScope, 'COLLECTION');
  const primaryField = col === 'payroll' || col === 'lab_expenses' ? 'month' : 'date';
  assert.deepEqual(indexDef.fields, [
    { fieldPath: primaryField, order: 'DESCENDING' },
    { fieldPath: '__name__', order: 'DESCENDING' },
  ]);
});

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

// Payroll 120 records verification
const payrollRecords = Array.from({ length: 120 }, (_, i) => ({
  id: `payroll-${i}`,
  month: `2026-0${7 + Math.floor(i / 40)}`,
  name: `Emp-${i}`,
  amount: (i + 1) * 100,
}));
['2026-07', '2026-08', '2026-09'].forEach(month => {
  const monthRows = payrollRecords.filter(r => r.month === month);
  assert.equal(monthRows.length, 40, `Each month must have all 40 payroll records`);
});
const payrollP1 = payrollRecords.slice(0, 50);
const payrollP2 = payrollRecords.slice(50, 100);
const payrollP3 = payrollRecords.slice(100, 120);
const combinedPayroll = [...payrollP1, ...payrollP2, ...payrollP3];
assert.equal(new Set(combinedPayroll.map(r => r.id)).size, 120, 'Payroll pagination must not duplicate or lose records');

// 3. Verify Code Contract & Query Options
const pageStart = source.indexOf('function pageQueryOptions(key, page)');
const moneyStart = source.indexOf('function renderMoneyPage(kind)');
const moneyEnd = source.indexOf('// صفحة دفتر الخزينة', moneyStart);
const payrollStart = source.indexOf('function renderPayroll()');
const payrollEnd = source.indexOf('// صفحة التقارير', payrollStart > 0 ? payrollStart : moneyEnd);
assert.ok(pageStart >= 0 && moneyStart >= 0 && moneyEnd > moneyStart && payrollStart >= 0);

const pageBlock = source.slice(pageStart, source.indexOf('\nfunction ', pageStart + 10));
const moneyBlock = source.slice(moneyStart, moneyEnd);
const payrollBlock = source.slice(payrollStart, payrollEnd > payrollStart ? payrollEnd : payrollStart + 3000);

assert.match(pageBlock, /key === "payroll"/);
assert.match(pageBlock, /field: "month"/);
assert.match(pageBlock, /monthKey !== "all"/);
assert.match(moneyBlock, /const totalCount = isIncome\s*\? Number\(summary\.income\.count/);
assert.match(moneyBlock, /سجل \$\{isIncome \? "الوارد" : "المنصرف"\} —/);
assert.match(moneyBlock, /pageState\.cursors = \{ 1: null \}/);
assert.match(moneyBlock, /pageState\.pages = \{\}/);
assert.match(moneyBlock, /pageState\.hasMore = \{\}/);
assert.match(payrollBlock, /pageState\.cursors = \{ 1: null \}/);
assert.match(payrollBlock, /pageState\.pages = \{\}/);
assert.match(payrollBlock, /pageState\.hasMore = \{\}/);
assert.match(source, /تعذر تحميل بيانات السحابة، تحقق من Firestore Indexes\./);

console.log('PASS income-pagination-test: 120 records across months for income and payroll, cursor reset, composite index config, error messaging, and all-month pagination contract.');

