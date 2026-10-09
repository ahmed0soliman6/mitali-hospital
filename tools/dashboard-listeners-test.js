const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const index = fs.readFileSync('index.html', 'utf8');

// 1. التحقق من تعريف وثوابت PAGE_REALTIME_KEYS
const realtimeMatch = index.match(/const PAGE_REALTIME_KEYS\s*=\s*\{([\s\S]*?)\n\};/);
assert.ok(realtimeMatch, 'PAGE_REALTIME_KEYS must be declared');

// استخراج الكائن لتقييمه واختباره بدقة
const sandbox = {
  REVENUE_VISIT_DB_KEYS: ["visitsClinic", "visitsDental", "visitsOperations", "visitsLabs", "visitsRadiology"],
  SERVER_PAGED_KEYS: new Set([
    "visitsClinic", "visitsDental", "visitsOperations", "visitsLabs", "visitsRadiology",
    "payroll", "labExpenses", "auditLog",
  ]),
  state: { page: "dashboard" },
  firestoreRealtimeUnsubs: new Map(),
};

vm.runInNewContext(`
  ${realtimeMatch[0]}
  this.PAGE_REALTIME_KEYS = PAGE_REALTIME_KEYS;
`, sandbox);

const dashboardKeys = sandbox.PAGE_REALTIME_KEYS.dashboard;
assert.ok(Array.isArray(dashboardKeys), 'dashboard keys must be an array');
assert.ok(dashboardKeys.includes('income'), 'dashboard must include income');
assert.ok(dashboardKeys.includes('expense'), 'dashboard must include expense');

const forbiddenDashboardKeys = [
  'visitsClinic', 'visitsDental', 'visitsOperations', 'visitsLabs', 'visitsRadiology'
];
for (const k of forbiddenDashboardKeys) {
  assert.ok(!dashboardKeys.includes(k), `dashboard must NOT include ${k}`);
}

// التأكد من أن باقي الصفحات لم تتغير
const checkEqual = (actual, expected, msg) => assert.deepEqual([...actual], [...expected], msg);
checkEqual(sandbox.PAGE_REALTIME_KEYS.clinic, ["visitsClinic"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.dental, ["visitsDental"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.operations, ["visitsOperations"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.labs, ["visitsLabs"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.radiology, ["visitsRadiology"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.income, ["income"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.expense, ["expense"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.payroll, ["payroll"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.ledger, ["income", "expense", "settings"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.reports, []);
checkEqual(sandbox.PAGE_REALTIME_KEYS.settings, ["doctors", "employees", "settings", "categories", "specialties"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.patientFilesClinic, ["visitsClinic"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.patientFilesDental, ["visitsDental"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.outstandingBalances, ["doctors", ...sandbox.REVENUE_VISIT_DB_KEYS]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.outstandingBalancesClinic, ["visitsClinic"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.outstandingBalancesDental, ["visitsDental"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.outstandingBalancesOperations, ["visitsOperations"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.outstandingBalancesLabs, ["visitsLabs"]);
checkEqual(sandbox.PAGE_REALTIME_KEYS.outstandingBalancesRadiology, ["visitsRadiology"]);

// 2. التحقق من دالة backgroundRefreshKeysForPage
const bgFnMatch = index.match(/function backgroundRefreshKeysForPage\(page = state\.page\)\s*\{([\s\S]*?)\n\}/);
assert.ok(bgFnMatch, 'backgroundRefreshKeysForPage must be declared');

const pageDataMatch = index.match(/const PAGE_DATA_KEYS\s*=\s*\{([\s\S]*?)\n\};/);
assert.ok(pageDataMatch, 'PAGE_DATA_KEYS must be declared');

vm.runInNewContext(`
  ${pageDataMatch[0]}
  function pageKeys(page) { return PAGE_DATA_KEYS[page] || ["doctors", "employees", "settings"]; }
  ${bgFnMatch[0]}
  this.backgroundRefreshKeysForPage = backgroundRefreshKeysForPage;
  this.pageKeys = pageKeys;
  this.PAGE_DATA_KEYS = PAGE_DATA_KEYS;
`, sandbox);

const dashboardRefreshKeys = sandbox.backgroundRefreshKeysForPage("dashboard");
for (const k of sandbox.SERVER_PAGED_KEYS) {
  assert.ok(!dashboardRefreshKeys.includes(k), `backgroundRefreshKeysForPage("dashboard") must not return server-paged key: ${k}`);
}

// التأكد من أن باقي الصفحات ترجع نفس ما كانت ترجعه قبل التعديل
// دالة النموذج القديم:
function oldBackgroundRefreshKeys(page) {
  const keys = sandbox.pageKeys(page);
  const realtimeKeys = new Set(Array.isArray(sandbox.PAGE_REALTIME_KEYS[page]) ? sandbox.PAGE_REALTIME_KEYS[page] : []);
  return keys.filter(key => !realtimeKeys.has(key) && !sandbox.firestoreRealtimeUnsubs.has(String(key)));
}

checkEqual(sandbox.backgroundRefreshKeysForPage("clinic"), oldBackgroundRefreshKeys("clinic"));
checkEqual(sandbox.backgroundRefreshKeysForPage("payroll"), oldBackgroundRefreshKeys("payroll"));
checkEqual(sandbox.backgroundRefreshKeysForPage("labs"), oldBackgroundRefreshKeys("labs"));

console.log('PASS dashboard-listeners-test: dashboard realtime listeners minimized, other pages untouched, and background refresh correctly excludes server-paged keys.');
