const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');
const grab = (re, name) => { const m = index.match(re); assert.ok(m, name + ' must exist'); return m[0]; };
const fnRange = grab(/function visitPeriodDateRange\(kindKey\) \{[\s\S]*?\n\}\n/, 'visitPeriodDateRange');
const fnOpts = grab(/function pageQueryOptions\(key, page\) \{[\s\S]*?\n\}\n/, 'pageQueryOptions');
const fnHelper = grab(/function reconcileVisitPageWithLive\(snapshot, live, sortedList, isFirstPage, hasMore\) \{[\s\S]*?\n\}\n/, 'reconcileVisitPageWithLive');

const SOURCES = [
  { dbKey: 'visitsClinic', kind: 'عيادات', kindKey: 'clinic' },
  { dbKey: 'visitsDental', kind: 'أسنان', kindKey: 'dental' },
  { dbKey: 'visitsOperations', kind: 'عمليات', kindKey: 'operations' },
  { dbKey: 'visitsLabs', kind: 'تحاليل', kindKey: 'labs' },
  { dbKey: 'visitsRadiology', kind: 'أشعة', kindKey: 'radiology' },
];
function make(state) {
  const sandbox = {
    state, VISIT_SOURCE_DEFINITIONS: SOURCES, PAGE_SIZE: 50,
    todayISO: () => '2026-09-30',
    getFirestorePageState: () => ({ cursors: { 1: null, 2: { primaryValue: '2026-09-01', documentId: 'x' } } }),
  };
  vm.createContext(sandbox);
  vm.runInContext(fnRange + fnOpts + fnHelper + '\nthis.opts = pageQueryOptions; this.range = visitPeriodDateRange;', sandbox);
  return sandbox;
}
const W = o => JSON.stringify(o.where || null);
const between = (a, b) => JSON.stringify([{ field: 'date', op: '>=', value: a }, { field: 'date', op: '<=', value: b }]);

// ١) الافتراضي على صفحة اليومية: الشهر الحالي
let t = make({ page: 'clinic' });
assert.strictEqual(W(t.opts('visitsClinic', 1)), between('2026-09-01', '2026-09-30'));
// ٢) شهر آخر + سنة كبيسة + يوم + سنة
t = make({ page: 'dental', visitFilterGran_dental: 'month', visitFilterVal_dental: '2026-02' });
assert.strictEqual(W(t.opts('visitsDental', 1)), between('2026-02-01', '2026-02-28'));
t = make({ page: 'dental', visitFilterGran_dental: 'month', visitFilterVal_dental: '2024-02' });
assert.strictEqual(W(t.opts('visitsDental', 1)), between('2024-02-01', '2024-02-29'));
t = make({ page: 'labs', visitFilterGran_labs: 'day', visitFilterVal_labs: '2026-09-15' });
assert.strictEqual(W(t.opts('visitsLabs', 1)), between('2026-09-15', '2026-09-15'));
t = make({ page: 'radiology', visitFilterGran_radiology: 'year', visitFilterVal_radiology: '2025' });
assert.strictEqual(W(t.opts('visitsRadiology', 1)), between('2025-01-01', '2025-12-31'));
// ٣) "الكل": بلا فلتر
t = make({ page: 'operations', visitFilterGran_operations: 'all' });
assert.strictEqual(W(t.opts('visitsOperations', 1)), 'null');
// ٤) الفلتر لا يمتد لصفحات أخرى ولا لجداول يوميات أخرى
t = make({ page: 'dashboard', visitFilterGran_clinic: 'month', visitFilterVal_clinic: '2026-02' });
assert.strictEqual(W(t.opts('visitsClinic', 1)), 'null', 'dashboard must keep its old behaviour');
t = make({ page: 'dental' });
assert.strictEqual(W(t.opts('visitsClinic', 1)), 'null', 'only the diary of the same table is filtered');
// ٥) تغيير الفلتر يغيّر توقيع الاستعلام (فيُعاد تحميل الصفحة الأولى)
t = make({ page: 'clinic', visitFilterGran_clinic: 'month', visitFilterVal_clinic: '2026-09' });
const sigSep = W(t.opts('visitsClinic', 1));
t.state.visitFilterVal_clinic = '2026-08';
assert.notStrictEqual(W(t.opts('visitsClinic', 1)), sigSep);
// ٦) المؤشر (cursor) وحجم الصفحة كما هما
const o2 = t.opts('visitsClinic', 2);
assert.strictEqual(o2.pageSize, 50);
assert.strictEqual(o2.cursor.documentId, 'x');
// ٧) الوارد/المنصرف/المرتبات بلا تغيير
t = make({ page: 'income', incomeMonth: '2026-08' });
assert.strictEqual(W(t.opts('income', 1)), between('2026-08-01', '2026-08-31'));
t = make({ page: 'payroll', payrollMonth: '2026-07' });
assert.strictEqual(W(t.opts('payroll', 1)), JSON.stringify([{ field: 'month', op: '>=', value: '2026-07' }, { field: 'month', op: '<=', value: '2026-07' }]));
t = make({ page: 'clinic' });
assert.strictEqual(W(t.opts('doctors', 1)), 'null');

// ٨) الصفوف المعروضة تحترم الفلتر الظاهر حتى لو احتوت اللقطة على شهور أخرى
const V = (id, date) => ({ id, date });
const a = V('a', '2026-09-29'), b = V('b', '2026-08-30'), c = V('c', '2026-08-10');
const rec = vm.runInContext('reconcileVisitPageWithLive', t);
const out = rec([a, b, c], [a, b, c], [a], true, false);
assert.strictEqual(JSON.stringify(out.map(r => r.id)), '["a"]');
const out2 = rec([a, b, c], [a, b, c], [b, c], true, false);
assert.strictEqual(JSON.stringify(out2.map(r => r.id)), '["b","c"]');

// ٩) لم نلمس المستمعات
assert.match(index, /dashboard: \["income", "expense"\]/);
assert.match(index, /clinic: \["visitsClinic"\]/);

console.log('PASS visit-period-filter-test: diary period filter is sent to Firestore for that diary only (month/day/year/all), other pages and tables keep their queries, and displayed rows respect the filter.');
