const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');
const grab = (re, name) => { const m = index.match(re); assert.ok(m, name + ' must exist'); return m[0]; };
const fnRange = grab(/function visitPeriodDateRange\(kindKey\) \{[\s\S]*?\n\}\n/, 'visitPeriodDateRange');
const fnOpts = grab(/function pageQueryOptions\(key, page\) \{[\s\S]*?\n\}\n/, 'pageQueryOptions');

const SOURCES = [
  { dbKey: 'visitsClinic', kind: 'عيادات', kindKey: 'clinic' },
  { dbKey: 'visitsDental', kind: 'أسنان', kindKey: 'dental' },
  { dbKey: 'visitsOperations', kind: 'عمليات', kindKey: 'operations' },
  { dbKey: 'visitsLabs', kind: 'تحاليل', kindKey: 'labs' },
  { dbKey: 'visitsRadiology', kind: 'أشعة', kindKey: 'radiology' },
];
function size(page, key) {
  const sandbox = {
    state: { page }, VISIT_SOURCE_DEFINITIONS: SOURCES, PAGE_SIZE: 30,
    todayISO: () => '2026-10-01',
    getFirestorePageState: () => ({ cursors: { 1: null } }),
  };
  vm.createContext(sandbox);
  vm.runInContext(fnRange + fnOpts + '\nthis.opts = pageQueryOptions;', sandbox);
  return sandbox.opts(key, 1).pageSize;
}

// صفحة اليومية نفسها: 30
for (const s of SOURCES) assert.strictEqual(size(s.kindKey, s.dbKey), 30, s.kindKey + ' diary keeps 30');
// الرئيسية والتقارير والمستحقات وملفات المرضى: 50 (النافذة التي تُحسب منها الأرقام)
for (const page of ['dashboard', 'reports', 'payroll', 'outstandingBalancesClinic', 'patientFilesDental']) {
  for (const s of SOURCES) assert.strictEqual(size(page, s.dbKey), 50, `${page}/${s.dbKey} keeps the 50-row window`);
}
// جداول أخرى لا تتأثر
assert.strictEqual(size('payroll', 'payroll'), 30);
assert.strictEqual(size('income', 'income'), 30);
assert.strictEqual(size('dashboard', 'doctors'), 30);

// المستمع اللحظي يستخدم نفس نافذة التحميل (لا يفرض PAGE_SIZE)
assert.match(index, /const listenerOptions = SERVER_PAGED_KEYS\.has\(key\)\s*\n\s*\? pageQueryOptions\(key, currentPage\)\s*\n\s*: null;/);
assert.doesNotMatch(index, /Object\.assign\(pageQueryOptions\(key, currentPage\), \{ pageSize: PAGE_SIZE \}\)/);
assert.match(index, /const PAGE_SIZE = 30;/);

console.log('PASS visit-window-size-test: diary pages load 30 visits, every other page keeps the 50-row window, and realtime listeners use the same window as the page load.');
