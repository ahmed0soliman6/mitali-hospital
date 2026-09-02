'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');
const moneyStart = source.indexOf('function renderMoneyPage(kind)');
const moneyEnd = source.indexOf('// صفحة دفتر الخزينة', moneyStart);
assert.ok(moneyStart >= 0 && moneyEnd > moneyStart, 'renderMoneyPage block should exist');
const moneyBlock = source.slice(moneyStart, moneyEnd);

assert.match(moneyBlock, /if \(!state\[monthStateKey\]\) state\[monthStateKey\] = "all";/);
assert.match(moneyBlock, /const filteredList = selectedMonth === "all" \? list : list\.filter/);
assert.match(moneyBlock, /const totalAmt = filteredList\.reduce/);
assert.match(moneyBlock, /const moneyPg = paginateList\(sortedMoney, `money_\$\{kind\}`\);/);
assert.doesNotMatch(moneyBlock, /slice\(0\s*,\s*35\)/);
assert.doesNotMatch(moneyBlock, /slice\(0\s*,\s*50\)/);

const sourceBlock = source.slice(source.indexOf('const VISIT_SOURCE_DEFINITIONS'), source.indexOf('const PAGE_DATA_KEYS'));
for (const key of ['visitsClinic', 'visitsDental', 'visitsOperations', 'visitsLabs', 'visitsRadiology']) {
  assert.match(sourceBlock, new RegExp(key));
}
assert.match(source, /function allPatientVisits\(\) \{\s*return visitsFromSources\(VISIT_SOURCE_DEFINITIONS\);/);
assert.match(source, /income: \["income"\], expense: \["expense"\]/);
assert.match(source, /const list = isIncome \? DB\.income : DB\.expense;/);

console.log('PASS ledger-visibility-test: income and expense default to all months, retain complete totals, paginate only for display, and all five visit sources are included.');
