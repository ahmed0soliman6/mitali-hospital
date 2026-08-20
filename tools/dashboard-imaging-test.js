const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');

assert.match(source, /function dashboardRowsForPeriod\(rows, period\)/, 'dashboard must filter ledger rows by selected period');
assert.match(source, /function periodFinancials\(period\)/, 'dashboard must calculate income and expense together');
assert.match(source, /const incomeRows = dashboardRowsForPeriod\(DB\.income, period\)/, 'dashboard income must come from the full income ledger');
assert.match(source, /const expenseRows = dashboardRowsForPeriod\(DB\.expense, period\)/, 'dashboard expense must come from the full expense ledger');
assert.match(source, /const totalRevenue = DB\.income\.reduce/, 'all-period revenue must include manual and linked income');
assert.match(source, /const dayRevenue = days\.map\(d => DB\.income\.filter\(x => x\.date === d\)/, 'seven-day chart must include all income entries');
assert.match(source, /backfillIncomeLinks\(DB\.visitsOperations, "operations"\)/, 'legacy operations visits must be linked to income');
assert.match(source, /backfillIncomeLinks\(DB\.visitsLabs, "labs"\)/, 'legacy lab visits must be linked to income');
assert.match(source, /backfillIncomeLinks\(DB\.visitsRadiology, "radiology"\)/, 'legacy radiology visits must be linked to income');
assert.match(source, /const DEFAULT_XRAY_TYPES = \[[^\]]*أشعة دوبلر[^\]]*أشعة بانوراما الأسنان/s, 'two additional default x-ray types must exist');
assert.match(source, /const DEFAULT_LAB_TEST_TYPES = \[[^\]]*تحليل دهون كامل[^\]]*وظائف الغدة الدرقية/s, 'two additional default lab types must exist');
assert.match(source, /serviceTypesVersion: 2/, 'service type migration version must be persisted');
assert.match(source, /serviceOptionsKey: "labTestTypes"/, 'lab diary must use settings lab types');
assert.match(source, /serviceOptionsKey: "xrayTypes"/, 'radiology diary must use settings x-ray types');
assert.match(source, /const typeOptions = cfg\.serviceOptionsKey \? \(DB\.settings\[cfg\.serviceOptionsKey\]/, 'service diary must read configured options');

console.log('PASS dashboard-imaging-test: full financial ledger periods, legacy service income backfill, and configurable lab/x-ray types.');
