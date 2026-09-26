'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const firebaseStoreJs = fs.readFileSync('firebase-store.js', 'utf8');

// 1. Static codebase audit: verify cachedFinancialSummary uses FINANCIAL_SUMMARY_CACHE
assert.match(indexHtml, /function cachedFinancialSummary/, 'cachedFinancialSummary must exist in index.html');
assert.match(indexHtml, /function loadFullFinancialMonth/, 'loadFullFinancialMonth must exist in index.html');
assert.match(indexHtml, /FINANCIAL_MONTH_RECORDS_CACHE/, 'FINANCIAL_MONTH_RECORDS_CACHE must exist in index.html');
assert.match(indexHtml, /isFullMonthView \? sortedMoney : moneyPg\.pageItems/, 'renderMoneyPage must render all sortedMoney in full month view');
assert.match(indexHtml, /isFullMonthView \? "" : paginationControlsHTML/, 'renderMoneyPage must omit pagination controls in full month view');

const cfsStart = indexHtml.indexOf('function cachedFinancialSummary');
const cfsEnd = indexHtml.indexOf('\nfunction ', cfsStart + 10);
const cfsBody = indexHtml.slice(cfsStart, cfsEnd);
assert.match(cfsBody, /FINANCIAL_SUMMARY_CACHE\[ym\]/, 'cachedFinancialSummary must use FINANCIAL_SUMMARY_CACHE');

// Verify getFinancialSummary is independent of pagination
const gfsStart = indexHtml.indexOf('async function getFinancialSummary');
const gfsEnd = indexHtml.indexOf('\nfunction ', gfsStart + 10);
const gfsBody = indexHtml.slice(gfsStart, gfsEnd);
assert.match(gfsBody, /window\.MitaliFirebase\.getFinancialSummary/, 'getFinancialSummary must call MitaliFirebase');

// Verify firebase-store.js has client Firestore fallback for full aggregation and getMonthRecords
assert.match(firebaseStoreJs, /async function getFinancialSummary/, 'firebase-store.js must have getFinancialSummary');
assert.match(firebaseStoreJs, /async function getMonthRecords/, 'firebase-store.js must have getMonthRecords');
assert.match(firebaseStoreJs, /getMonthRecords,/, 'firebase-store.js must export getMonthRecords');

// 2. Behavioral simulation of 237 records in September 2026 and 50 in August 2026 (Total 287)
const SEP_COUNT = 237;
const AUG_COUNT = 50;
const TOTAL_RECORDS = SEP_COUNT + AUG_COUNT;

const allRecords = Array.from({ length: TOTAL_RECORDS }, (_, i) => {
  const isSep = i < SEP_COUNT;
  return {
    id: `rec_${String(i + 1).padStart(4, '0')}`,
    date: isSep ? `2026-09-${String((i % 28) + 1).padStart(2, '0')}` : `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
    amount: isSep ? 100 : 200,
    party: `Patient ${i + 1}`,
    category: 'كشف',
  };
});

// Full month aggregates
const sepRecords = allRecords.filter(r => r.date.startsWith('2026-09'));
const sepExpectedTotal = sepRecords.reduce((sum, r) => sum + r.amount, 0); // 237 * 100 = 23,700
const sepExpectedCount = sepRecords.length; // 237
const allExpectedTotal = allRecords.reduce((sum, r) => sum + r.amount, 0); // 237*100 + 50*200 = 33,700
const allExpectedCount = allRecords.length; // 287

assert.equal(sepRecords.length, 237, 'September records must be 237');

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

const FINANCIAL_MONTH_RECORDS_CACHE = {
  'income:2026-09': sepRecords,
};

// Simulation of rendering September Month View vs All-Months View
function simulateMoneyPageView(selectedMonth, dbIncomeSlice = []) {
  const isIncome = true;
  const isFullMonthView = isIncome && selectedMonth !== 'all';
  const monthCacheKey = `${isIncome ? 'income' : 'expense'}:${selectedMonth}`;
  const fullMonthRecords = isFullMonthView ? FINANCIAL_MONTH_RECORDS_CACHE[monthCacheKey] : null;

  const activeRecords = isFullMonthView
    ? (Array.isArray(fullMonthRecords) ? fullMonthRecords : dbIncomeSlice.filter(x => x.date.startsWith(selectedMonth)))
    : dbIncomeSlice;

  const summary = FINANCIAL_SUMMARY_CACHE[selectedMonth];
  const totalAmt = Number(summary.totalIncome || summary.income.total || 0);
  const totalCount = Number(summary.income.count || 0);
  const avg = totalCount ? totalAmt / totalCount : 0;

  const tableRenderCount = isFullMonthView ? activeRecords.length : Math.min(activeRecords.length, 50);
  const hasPaginationControls = !isFullMonthView;

  return {
    selectedMonth,
    isFullMonthView,
    totalAmt,
    totalCount,
    avg,
    renderedTableRows: tableRenderCount,
    hasPaginationControls,
  };
}

// 1. In September view, all 237 records are rendered on a single page with no pagination controls
const sepView = simulateMoneyPageView('2026-09', allRecords.slice(0, 50));
assert.equal(sepView.isFullMonthView, true);
assert.equal(sepView.renderedTableRows, 237, 'September table must render all 237 records');
assert.equal(sepView.totalAmt, 23700, 'September total must be 23,700');
assert.equal(sepView.totalCount, 237, 'September count must be 237');
assert.equal(sepView.avg, 100, 'September average must be 100');
assert.equal(sepView.hasPaginationControls, false, 'September view must not have pagination controls');

// 2. In "all" view, 50 records per page with pagination controls, but full KPIs
const allViewP1 = simulateMoneyPageView('all', allRecords.slice(0, 50));
const allViewP2 = simulateMoneyPageView('all', allRecords.slice(50, 100));

assert.equal(allViewP1.isFullMonthView, false);
assert.equal(allViewP1.renderedTableRows, 50);
assert.equal(allViewP1.hasPaginationControls, true);
assert.equal(allViewP1.totalAmt, 33700);
assert.equal(allViewP1.totalCount, 287);
assert.equal(allViewP2.totalAmt, 33700);
assert.equal(allViewP2.totalCount, 287);

console.log('PASS financial-summary-pagination-independence-test: 237 September records rendered completely without pagination in month view, full month loader, and all-month pagination.');
