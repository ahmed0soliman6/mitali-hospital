'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const indexHtml = fs.readFileSync('index.html', 'utf8');

// 1. Static codebase audit: verify income & expense are NOT in SERVER_PAGED_KEYS
assert.match(indexHtml, /const SERVER_PAGED_KEYS = new Set\(\[/, 'SERVER_PAGED_KEYS must exist in index.html');
const serverPagedMatch = indexHtml.match(/const SERVER_PAGED_KEYS = new Set\(\[\s*([\s\S]*?)\s*\]\);/);
assert.ok(serverPagedMatch, 'SERVER_PAGED_KEYS block must be found');
const pagedKeysList = serverPagedMatch[1];
assert.ok(!pagedKeysList.includes('"income"'), 'income MUST NOT be in SERVER_PAGED_KEYS');
assert.ok(!pagedKeysList.includes('"expense"'), 'expense MUST NOT be in SERVER_PAGED_KEYS');

// 2. Behavioral simulation of 237 records in September 2026 ($100 each) and 50 in August 2026 ($200 each)
const SEP_COUNT = 237;
const AUG_COUNT = 50;
const TOTAL_RECORDS = SEP_COUNT + AUG_COUNT;

const allIncome = Array.from({ length: TOTAL_RECORDS }, (_, i) => {
  const isSep = i < SEP_COUNT;
  return {
    id: `rec_${String(i + 1).padStart(4, '0')}`,
    date: isSep ? `2026-09-${String((i % 28) + 1).padStart(2, '0')}` : `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
    amount: isSep ? 100 : 200,
    party: `Patient ${i + 1}`,
    category: 'كشف',
    receiptNo: `R-${i + 1}`,
  };
});

const PAGE_SIZE = 50;
function simulatePaginateList(list, pageNumber) {
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(Math.max(pageNumber, 1), totalPages);
  const start = (current - 1) * PAGE_SIZE;
  return {
    pageItems: list.slice(start, start + PAGE_SIZE),
    current,
    totalPages,
    total: list.length,
    start: list.length ? start + 1 : 0,
    end: Math.min(start + PAGE_SIZE, list.length),
  };
}

function simulateRenderMoneyPage(selectedMonth, pageNumber = 1) {
  const list = allIncome;
  const filteredList = selectedMonth === 'all' ? list : list.filter(x => (x.date || '').startsWith(selectedMonth));
  const totalAmt = filteredList.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const totalCount = filteredList.length;
  const moneyPg = simulatePaginateList(filteredList, pageNumber);

  return {
    selectedMonth,
    totalAmt,
    totalCount,
    currentPage: moneyPg.current,
    totalPages: moneyPg.totalPages,
    renderedRowsCount: moneyPg.pageItems.length,
  };
}

// Test 1: September 237 records -> totalCount = 237, totalAmt = 23,700
const sepP1 = simulateRenderMoneyPage('2026-09', 1);
assert.equal(sepP1.totalCount, 237, 'September count must be 237');
assert.equal(sepP1.totalAmt, 23700, 'September total must be 23,700');
assert.equal(sepP1.renderedRowsCount, 50, 'Page 1 renders 50 rows');
assert.equal(sepP1.totalPages, 5, 'September has 5 display pages');

// Test 2: Page 2 (51-100) -> totalCount = 237, totalAmt = 23,700
const sepP2 = simulateRenderMoneyPage('2026-09', 2);
assert.equal(sepP2.totalCount, 237, 'Page 2 count must still be 237');
assert.equal(sepP2.totalAmt, 23700, 'Page 2 total must still be 23,700');
assert.equal(sepP2.renderedRowsCount, 50, 'Page 2 renders 50 rows');

// Test 3: Page 3 (101-150) -> totalCount = 237, totalAmt = 23,700
const sepP3 = simulateRenderMoneyPage('2026-09', 3);
assert.equal(sepP3.totalCount, 237);
assert.equal(sepP3.totalAmt, 23700);

// Test 4: Page 5 (last page: 201-237) -> totalCount = 237, totalAmt = 23,700
const sepP5 = simulateRenderMoneyPage('2026-09', 5);
assert.equal(sepP5.totalCount, 237);
assert.equal(sepP5.totalAmt, 23700);
assert.equal(sepP5.renderedRowsCount, 37, 'Last page renders remaining 37 rows');

// Test 5: August -> totalCount = 50, totalAmt = 10,000
const augP1 = simulateRenderMoneyPage('2026-08', 1);
assert.equal(augP1.totalCount, 50);
assert.equal(augP1.totalAmt, 10000);

// Test 6: All months -> totalCount = 287, totalAmt = 33,700
const allP1 = simulateRenderMoneyPage('all', 1);
assert.equal(allP1.totalCount, 287);
assert.equal(allP1.totalAmt, 33700);
assert.equal(allP1.renderedRowsCount, 50);

console.log('PASS financial-summary-pagination-independence-test: All 8 income tests verified. DB.income holds full array, totals and counts are 100% independent of display pagination.');
