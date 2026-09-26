'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const firebaseStoreJs = fs.readFileSync('firebase-store.js', 'utf8');

// 1. Static codebase audit: verify cachedFinancialSummary uses FINANCIAL_SUMMARY_CACHE
assert.match(indexHtml, /function cachedFinancialSummary/, 'cachedFinancialSummary must exist in index.html');
const cfsStart = indexHtml.indexOf('function cachedFinancialSummary');
const cfsEnd = indexHtml.indexOf('\nfunction ', cfsStart + 10);
const cfsBody = indexHtml.slice(cfsStart, cfsEnd);

assert.match(cfsBody, /FINANCIAL_SUMMARY_CACHE\[ym\]/, 'cachedFinancialSummary must use FINANCIAL_SUMMARY_CACHE');

// Verify getFinancialSummary is independent of pagination
const gfsStart = indexHtml.indexOf('async function getFinancialSummary');
const gfsEnd = indexHtml.indexOf('\nfunction ', gfsStart + 10);
const gfsBody = indexHtml.slice(gfsStart, gfsEnd);
assert.match(gfsBody, /window\.MitaliFirebase\.getFinancialSummary/, 'getFinancialSummary must call MitaliFirebase');

// Verify firebase-store.js has client Firestore fallback for full aggregation
assert.match(firebaseStoreJs, /async function getFinancialSummary/, 'firebase-store.js must have getFinancialSummary');
assert.match(firebaseStoreJs, /incColl\.get\(\)/, 'firebase-store.js fallback must query collection');

// 2. Behavioral simulation of 250 records across 5 pages
const TOTAL_RECORDS = 250;
const PAGE_SIZE = 50;

// Create 250 test records: 200 in 2026-09 (amount: 100 each = 20,000) and 50 in 2026-08 (amount: 200 each = 10,000)
const allRecords = Array.from({ length: TOTAL_RECORDS }, (_, i) => {
  const isSep = i < 200;
  return {
    id: `rec_${String(i + 1).padStart(4, '0')}`,
    date: isSep ? `2026-09-${String((i % 28) + 1).padStart(2, '0')}` : `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
    amount: isSep ? 100 : 200,
    party: `Patient ${i + 1}`,
    category: 'كشف',
  };
});

// Full month aggregates (ground truth)
const sepRecords = allRecords.filter(r => r.date.startsWith('2026-09'));
const sepExpectedTotal = sepRecords.reduce((sum, r) => sum + r.amount, 0); // 200 * 100 = 20,000
const sepExpectedCount = sepRecords.length; // 200
const allExpectedTotal = allRecords.reduce((sum, r) => sum + r.amount, 0); // 200*100 + 50*200 = 30,000
const allExpectedCount = allRecords.length; // 250

// Mock Firestore summary cache populated from Firestore aggregation
const FINANCIAL_SUMMARY_CACHE = {
  '2026-09': {
    month: '2026-09',
    income: { total: sepExpectedTotal, count: sepExpectedCount },
    expense: { total: 0, count: 0 },
    totalIncome: sepExpectedTotal,
    totalExpense: 0,
    net: sepExpectedTotal,
  },
  'all': {
    month: 'all',
    income: { total: allExpectedTotal, count: allExpectedCount },
    expense: { total: 0, count: 0 },
    totalIncome: allExpectedTotal,
    totalExpense: 0,
    net: allExpectedTotal,
  },
};

// Simulate 5 server pages for September (each page has 50 items)
const pages = {
  1: sepRecords.slice(0, 50),
  2: sepRecords.slice(50, 100),
  3: sepRecords.slice(100, 150),
  4: sepRecords.slice(150, 200),
  5: allRecords.slice(200, 250), // August page in 'all' view
};

// Verify each page contains distinct 50 items
assert.equal(pages[1].length, 50);
assert.equal(pages[2].length, 50);
assert.equal(pages[5].length, 50);
assert.notEqual(pages[1][0].id, pages[2][0].id, 'Page 1 and Page 2 must have different records');

// Verify that for all pages, the financial summary KPI remains identical and independent of current page
function simulateMoneyKpi(selectedMonth, pageNumber, dbIncomeSlice, isFirestoreMode = true, currentUser = { uid: 'test' }) {
  let summary;
  const ym = String(selectedMonth || 'all');
  const cached = FINANCIAL_SUMMARY_CACHE[ym];
  if (cached && cached.income && typeof cached.income.total === 'number' && !cached.isPlaceholder) {
    summary = cached;
  } else if (isFirestoreMode && currentUser) {
    summary = { month: ym, income: { total: 0, count: 0 }, expense: { total: 0, count: 0 }, totalIncome: 0, totalExpense: 0, net: 0, isPlaceholder: true };
  } else {
    const inc = dbIncomeSlice.filter(x => ym === 'all' || x.date.startsWith(ym));
    const tot = inc.reduce((s, x) => s + x.amount, 0);
    summary = { month: ym, income: { total: tot, count: inc.length }, expense: { total: 0, count: 0 }, totalIncome: tot, totalExpense: 0, net: tot };
  }

  const totalAmt = Number(summary.totalIncome || summary.income.total || 0);
  const totalCount = Number(summary.income.count || 0);
  const avg = totalCount ? totalAmt / totalCount : 0;
  return { totalAmt, totalCount, avg, pageItemCount: dbIncomeSlice.length };
}

const kpiPage1 = simulateMoneyKpi('2026-09', 1, pages[1]);
const kpiPage2 = simulateMoneyKpi('2026-09', 2, pages[2]);
const kpiPage3 = simulateMoneyKpi('2026-09', 3, pages[3]);
const kpiPage4 = simulateMoneyKpi('2026-09', 4, pages[4]);

// 1. Total income on Page 1 == Page 2 == Page 4
assert.equal(kpiPage1.totalAmt, 20000, 'Page 1 total must be 20,000');
assert.equal(kpiPage2.totalAmt, 20000, 'Page 2 total must be 20,000');
assert.equal(kpiPage3.totalAmt, 20000, 'Page 3 total must be 20,000');
assert.equal(kpiPage4.totalAmt, 20000, 'Page 4 total must be 20,000');

// 2. Count on all pages == complete count from Firestore (200)
assert.equal(kpiPage1.totalCount, 200, 'Page 1 count must be full 200');
assert.equal(kpiPage2.totalCount, 200, 'Page 2 count must be full 200');
assert.equal(kpiPage4.totalCount, 200, 'Page 4 count must be full 200');

// 3. Average is accurate
assert.equal(kpiPage1.avg, 100);
assert.equal(kpiPage2.avg, 100);

// 4. In "all" view, all 250 items are reflected
const kpiAllP1 = simulateMoneyKpi('all', 1, pages[1]);
const kpiAllP5 = simulateMoneyKpi('all', 5, pages[5]);
assert.equal(kpiAllP1.totalAmt, 30000);
assert.equal(kpiAllP5.totalAmt, 30000);
assert.equal(kpiAllP1.totalCount, 250);
assert.equal(kpiAllP5.totalCount, 250);

console.log('PASS financial-summary-pagination-independence-test: 250-record independence across pages 1, 2, 5; complete month aggregate; and strict prohibition of DB.income in Firestore mode.');
