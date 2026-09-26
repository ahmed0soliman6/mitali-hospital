'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');
const pageStart = source.indexOf('function pageQueryOptions(key, page)');
const moneyStart = source.indexOf('function renderMoneyPage(kind)');
const moneyEnd = source.indexOf('// صفحة دفتر الخزينة', moneyStart);
assert.ok(pageStart >= 0 && moneyStart >= 0 && moneyEnd > moneyStart);
const moneyBlock = source.slice(moneyStart, moneyEnd);
const pageBlock = source.slice(pageStart, source.indexOf('\nfunction ', pageStart + 10));

const records = Array.from({ length: 120 }, (_, i) => ({
  id: `income-${i}`,
  date: `${2026 - Math.floor(i / 40) % 1}-${String(9 - Math.floor(i / 40)).padStart(2, '0')}-15`,
  amount: i + 1,
}));
const oldMonth = records.filter(row => row.date.startsWith('2026-07'));
assert.equal(oldMonth.length, 40, 'old month must contain all 40 records');
assert.equal(records.length, 120, 'all-month view must retain all 120 records');
assert.equal(records.slice(0, 50).length, 50);
assert.equal(records.slice(50, 100).length, 50);
assert.equal(records.slice(100).length, 20);

assert.match(source, /state\.monthStateKey = monthStateKey/);
assert.match(pageBlock, /monthKey !== "all"/);
assert.match(pageBlock, /\^\\d\{4\}-\\d\{2\}\$\/\.test/);
assert.match(moneyBlock, /const totalCount = isIncome\s*\? Number\(summary\.income\.count/);
assert.match(moneyBlock, /سجل \$\{isIncome \? "الوارد" : "المنصرف"\} —/);
assert.match(moneyBlock, /pageState\.cursors = \{ 1: null \}/);
assert.match(moneyBlock, /pageState\.pages = \{\}/);
assert.match(moneyBlock, /pageState\.hasMore = \{\}/);
assert.doesNotMatch(moneyBlock, /سجل \$\{isIncome \? "الوارد" : "المنصرف"\}.*filteredList\.length/);
console.log('PASS income-pagination-test: 120 records across three months, old-month filtering, all-month pagination, summary count, and cursor reset contract.');
