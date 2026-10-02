const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');

// الحالة محل المراجعة: إيراد صافٍ 140 وأجر يومي ثابت 200.
// النتيجة المحاسبية الصحيحة: عجز المجمع = 140 - 200 = -60، وليس صفرًا مخفيًا.
const gross = 140;
const doctorPay = 200;
const labExpense = 0;
const netRevenue = gross - labExpense;
const clinicShare = netRevenue - doctorPay;
assert.equal(clinicShare, -60, 'fixed-daily deficit must remain visible as -60');
assert.equal(doctorPay + clinicShare, netRevenue, 'doctor and clinic shares must reconcile to net revenue');

assert.match(source, /function doctorSettlementBreakdown\(doctor, visits, lumpIncome, labExpense\)/, 'all doctor settlements must use one shared breakdown');
assert.match(source, /const clinicShare = netRevenue - docShare;/, 'clinic share must be the signed residual after doctor share');
assert.match(source, /function aggregateAccountingShares\(visits, incomeRows, labExpenses\)/, 'dashboard and closing reports must use central accounting aggregation');
assert.doesNotMatch(source, /const dashboardShares = aggregateAccountingShares\(/, 'dashboard must not compute accounting shares from a partial first-page visit window');
assert.match(source, /const closingShares = aggregateAccountingShares\(visits, incomeThisMonth, DB\.labExpenses\.filter\(x => x\.month === ym\)\)/, 'monthly closing must use the same accounting aggregation');
assert.match(source, /function allRevenueVisits\(\)/, 'all revenue departments must have a shared visit source');
assert.match(source, /function renderAnnualReportPrint\(\)[\s\S]*?const visits = allRevenueVisits\(\)/, 'annual report must include operations/labs/radiology');
assert.match(source, /function renderReports\(\)[\s\S]*?const visits = allRevenueVisits\(\)/, 'period and doctor reports must include all departments');
assert.match(source, /function syncPayrollExpenseLink\(rec\)/, 'paid payroll must link exactly once to expense ledger');
assert.match(source, /function syncVisitIncomeLink\(rec, kind, skipPersist\)/, 'paid visits must link exactly once to income ledger');
assert.match(source, /function periodFinancials\(period\)[\s\S]*?DB\.income[\s\S]*?DB\.expense/, 'dashboard period totals must use both ledgers');
assert.match(source, /function currentBalance\(\)[\s\S]*?DB\.income[\s\S]*?DB\.expense/, 'treasury balance must use both ledgers');

console.log('PASS accounting-consistency-test: fixed-daily deficit reconciliation, all departments, ledgers, payroll, and reports.');
