const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const store = fs.readFileSync('firebase-store.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

const start = store.indexOf('  async function getFinancialSummary');
const end = store.indexOf('  async function getMonthRecords', start);
assert.ok(start > -1 && end > start, 'getFinancialSummary must exist');
const body = store.slice(start, end);

// تشغيل الدالة الحقيقية مع بدائل لـ Firestore والواجهة.
async function run(month, { apiOk = false, queryFails = false } = {}) {
  const calls = { get: 0, unfilteredGet: 0, whereCount: 0 };
  const mkColl = () => {
    let filtered = 0;
    const q = {
      where() { filtered++; calls.whereCount++; return q; },
      async get() {
        calls.get++;
        if (!filtered) calls.unfilteredGet++;
        if (queryFails) throw new Error('boom');
        return { docs: [{ data: () => ({ amount: 100 }) }, { data: () => ({ amount: 50 }) }] };
      },
    };
    return q;
  };
  const ctx = {
    init() {}, ready: async () => {},
    auth: { currentUser: { getIdToken: async () => 't' } },
    apiUrl: p => p,
    fetchWithTimeout: async () => ({
      ok: apiOk,
      json: async () => (apiOk ? { income: { total: 7, count: 1 }, expense: { total: 3, count: 1 } } : {}),
    }),
    db: { collection: mkColl }, collectionName: k => k,
    console: { warn() {} }, Date, Number, String, Math, Promise, Error, Object, JSON, RegExp,
  };
  vm.createContext(ctx);
  vm.runInContext(body + '\nthis.fn = getFinancialSummary;', ctx);
  try { return { result: await ctx.fn(month), calls }; } catch (err) { return { threw: String(err && err.message), calls }; }
}

(async () => {
  // ١) الواجهة تعمل: تُستخدم نتيجتها دون أي قراءة مباشرة
  let r = await run('2026-09', { apiOk: true });
  assert.strictEqual(r.result.income.total, 7);
  assert.strictEqual(r.calls.get, 0);

  // ٢) الواجهة معطّلة + "الكل": يُرمى استثناء (لا أصفار) ولا تُقرأ أي مجموعة
  r = await run('all');
  assert.ok(r.threw && /financial-summary-unavailable/.test(r.threw), 'month=all must throw, not return zeros');
  assert.strictEqual(r.calls.get, 0);

  // ٣) شهر غير صالح: استثناء أيضًا
  r = await run('garbage');
  assert.ok(r.threw, 'invalid month must throw');
  assert.strictEqual(r.calls.get, 0);

  // ٤) الواجهة معطّلة + شهر محدد: مجاميع صحيحة من مستندات الشهر فقط (استعلامان مفلتران)
  r = await run('2026-09');
  assert.ok(!r.threw, r.threw);
  assert.strictEqual(r.result.income.total, 150);
  assert.strictEqual(r.result.income.count, 2);
  assert.strictEqual(r.result.expense.total, 150);
  assert.strictEqual(r.result.net, 0);
  assert.strictEqual(r.calls.get, 2);
  assert.strictEqual(r.calls.unfilteredGet, 0, 'the fallback must never read a whole collection');
  assert.strictEqual(r.calls.whereCount, 4);

  // ٥) فشل استعلام الشهر: استثناء وليس أصفارًا
  r = await run('2026-09', { queryFails: true });
  assert.ok(r.threw && /boom/.test(r.threw), 'a failed month query must throw, not return zeros');

  // ٦) index.html يلتقط الاستثناء ويحسب من البيانات المحمّلة
  const wrapper = index.slice(index.indexOf('async function getFinancialSummary'));
  assert.match(wrapper.slice(0, 2500), /catch[\s\S]{0,400}cachedFinancialSummary\(/, 'index.html must fall back to cachedFinancialSummary on error');

  console.log('PASS financial-summary-fallback-test: when the summary API fails, month=all and failed month queries throw (no zeros), month fallback reads only that month with filtered queries, and index.html computes from loaded data.');
})().catch(err => { console.error(err); process.exit(1); });
