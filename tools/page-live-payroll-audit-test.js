const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');
const grab = (re, name) => { const m = index.match(re); assert.ok(m, name + ' must exist'); return m[0]; };
const helper = grab(/function reconcileVisitPageWithLive\(snapshot, live, sortedList, isFirstPage, hasMore\) \{[\s\S]*?\n\}\n/, 'reconcileVisitPageWithLive');
const info = grab(/function firestorePageInfo\(pageKey, list\) \{[\s\S]*?\n\}\n/, 'firestorePageInfo');

function make(dbKey, pageState, dbRows) {
  const sandbox = {
    STORAGE_MODE: 'firestore', PAGE_SIZE: 50, state: { tablePage: {} },
    DB: { [dbKey]: dbRows },
    pageKeyDatabaseKey: () => dbKey,
    getFirestorePageState: () => pageState,
  };
  vm.createContext(sandbox);
  vm.runInContext(helper + info + '\nthis.fn = firestorePageInfo;', sandbox);
  return sandbox.fn;
}
const ids = rows => JSON.stringify(rows.map(r => r.id));

// المرتبات: سجل جديد يظهر فورًا، والمحذوف يختفي، والمعدَّل يظهر بنسخته الحيّة (سجلات بلا حقل date)
{
  const a = { id: 'a', month: '2026-09', amount: 100 }, b = { id: 'b', month: '2026-09', amount: 200 };
  const n = { id: 'new', month: '2026-09', amount: 50 };
  const a2 = { id: 'a', month: '2026-09', amount: 999 };
  const st = { currentPage: 1, pages: { 1: [a, b] }, hasMore: { 1: true } };
  let pg = make('payroll', st, [a, b, n])('payroll', [n, a, b]);
  assert.strictEqual(ids(pg.pageItems), '["new","a","b"]');
  pg = make('payroll', st, [a])('payroll', [a]);
  assert.strictEqual(ids(pg.pageItems), '["a"]');
  pg = make('payroll', st, [a2, b])('payroll', [a2, b]);
  assert.strictEqual(pg.pageItems[0].amount, 999);
  assert.strictEqual(ids(st.pages[1]), '["a","b"]', 'snapshot must stay untouched');
}

// سجل النشاط: إدخال جديد يظهر في الأعلى، والفلاتر الظاهرة تُطبَّق على الصفوف المحمّلة
{
  const e1 = { id: 'e1', date: '2026-09-29', userId: 'u1', action: 'حذف زيارة' };
  const e2 = { id: 'e2', date: '2026-09-28', userId: 'u2', action: 'إضافة زيارة' };
  const n = { id: 'e3', date: '2026-09-30', userId: 'u1', action: 'تعديل زيارة' };
  const st = { currentPage: 1, pages: { 1: [e1, e2] }, hasMore: { 1: true } };
  // بدون فلاتر
  let pg = make('auditLog', st, [e2, e1, n])('auditLog', [n, e1, e2]);
  assert.strictEqual(ids(pg.pageItems), '["e3","e1","e2"]');
  // فلتر المستخدم u1 (القائمة المرشّحة فقط تحتوي e3 وe1)
  pg = make('auditLog', st, [e2, e1, n])('auditLog', [n, e1]);
  assert.strictEqual(ids(pg.pageItems), '["e3","e1"]');
  // "حذف كل السجل": القائمة الحيّة فارغة → لا صفوف
  pg = make('auditLog', st, [])('auditLog', []);
  assert.strictEqual(ids(pg.pageItems), '[]');
}

// جدول غير مُدرَج يبقى على سلوكه القديم
{
  const a = { id: 'a', date: '2026-09-29' }, n = { id: 'new', date: '2026-09-30' };
  const st = { currentPage: 1, pages: { 1: [a] }, hasMore: {} };
  const pg = make('income', st, [a, n])('income', [n, a]);
  assert.strictEqual(ids(pg.pageItems), '["a"]');
}

// رسالة واضحة عند منع الحفظ المتكرر (بدل العودة الصامتة) في اليوميات ونماذج الوارد/المنصرف
const toast = 'showToast("⏳ جارٍ حفظ العملية السابقة — انتظر لحظة حتى تظهر في الجدول قبل إعادة المحاولة"); return;';
assert.ok(index.includes('if (ACTIVE_UI_SAVES.has(moneySaveKey)) { ' + toast + ' }'));
assert.strictEqual(index.split('if (ACTIVE_UI_SAVES.has(saveKey)) { ' + toast + ' }').length - 1, 2);
assert.doesNotMatch(index, /if \(ACTIVE_UI_SAVES\.has\((saveKey|moneySaveKey)\)\) return;/);
// القفل نفسه لم يُمَس
assert.match(index, /ACTIVE_UI_SAVES\.add\(saveKey\);/);
assert.match(index, /ACTIVE_UI_SAVES\.delete\(saveKey\);/);

console.log('PASS page-live-payroll-audit-test: payroll and audit-log pages show added/edited/deleted rows and active filters immediately, other tables keep old behaviour, and a blocked double-save now shows a message.');
