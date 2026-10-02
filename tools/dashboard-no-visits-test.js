const fs = require('fs');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');

// ١) الرئيسية لا تحمّل جداول الزيارات ولا الأطباء
const dataKeys = index.match(/const PAGE_DATA_KEYS = \{([\s\S]*?)\n\};/);
assert.ok(dataKeys, 'PAGE_DATA_KEYS must exist');
assert.match(dataKeys[1], /\n  dashboard: \["income", "expense"\],/, 'dashboard must load only income and expense');

// ٢) الصفحات التي تحتاج الزيارات فعلًا ما زالت تحمّلها
assert.match(dataKeys[1], /reports: \[[^\]]*"visitsClinic"[^\]]*"visitsRadiology"/);
assert.match(dataKeys[1], /outstandingBalancesClinic: \["doctors", "visitsClinic"\]/);
assert.match(dataKeys[1], /clinic: \["doctors", "visitsClinic"\]/);

// ٣) دالة الرئيسية بلا أي اعتماد على الزيارات أو الأطباء أو الحصص
const start = index.indexOf('function renderDashboard()');
assert.ok(start > -1, 'renderDashboard must exist');
const end = index.indexOf('\nfunction ', start + 30);
const body = index.slice(start, end);
for (const forbidden of [
  'allRevenueVisits(', 'DB.visits', 'aggregateAccountingShares(', 'doctorRevenue(', 'sortedDoctors(',
  'dashboardDoctorSelect', 'dashboardDoctor', 'visitRemaining(',
]) assert.ok(!body.includes(forbidden), 'renderDashboard must not use ' + forbidden);
for (const name of ['overdue', 'docStat', 'docList', 'selectedDocId', 'clinicShare', 'docShare', 'revenueVisits', 'dashboardShares']) {
  assert.ok(!new RegExp('\\b' + name + '\\b').test(body), 'leftover identifier in renderDashboard: ' + name);
}
assert.ok(!/\bvisits\b/.test(body), 'leftover "visits" identifier in renderDashboard');

// ٤) بطاقة المستحقات تبقى كرابط بلا رقم مقطوع
assert.match(body, /data-dashboard-page="outstandingBalancesClinic"/);
assert.match(body, /عرض القائمة/);

// ٥) بطاقات الوارد/المنصرف والملخص المالي ما زالت موجودة
for (const keep of ['cachedFinancialSummary("all")', 'currentBalance()', 'periodFinancials(selectedPeriod)', 'id="chartWeek"', 'id="chartInOut"']) {
  assert.ok(body.includes(keep), 'dashboard must keep ' + keep);
}

// ٦) الدوال المشتركة باقية لاستخدام الصفحات الأخرى (لا حذف لها)
for (const fn of ['function allRevenueVisits()', 'function doctorRevenue(', 'function aggregateAccountingShares(', 'function visitRemaining(']) {
  assert.ok(index.includes(fn), 'shared function must remain: ' + fn);
}

// ٧) لم نلمس المستمعات
assert.match(index, /PAGE_REALTIME_KEYS = \{[\s\S]*?dashboard: \["income", "expense"\]/);

// ٨) تشغيل فعلي لدالة الرئيسية: أي معرّف غير معرَّف في الملف يرمي ReferenceError
// (فيكشف متغيرًا محذوفًا بقي مستخدمًا داخل القالب أو بعده).
{
  const declared = new Set();
  for (const m of index.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) declared.add(m[1] || m[2]);
  const stub = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()),
    apply: () => stub(),
  });
  const rendered = { html: '', listeners: 0 };
  const content = {
    set innerHTML(v) { rendered.html = String(v); }, get innerHTML() { return rendered.html; },
    querySelectorAll: () => [], querySelector: () => null,
  };
  const real = {
    document: { getElementById: id => (id === 'content' ? content : null) },
    state: { page: 'dashboard' },
    DB: { income: [{ date: '2026-10-01', amount: 100, category: 'كشف' }], expense: [{ amount: 5, category: 'نظافة' }], settings: {} },
    todayISO: () => '2026-10-01', localISO: d => d.toISOString().slice(0, 10),
    fmt: n => String(n), fmtInt: n => String(n), esc: x => String(x),
    cachedFinancialSummary: () => ({ totalIncome: 100, totalExpense: 5, income: { total: 100, count: 1 }, expense: { total: 5, count: 1 } }),
    currentBalance: () => 95,
    periodFinancials: () => ({ income: 100, incomeCount: 1, expense: 5, expenseCount: 1 }),
    PERIOD_LABELS: { today: 'اليوم' }, catNames: () => ['نظافة'],
    destroyCharts() {}, charts: {}, isPageAccessible: () => true, route() {},
    Chart: function Chart() { this.destroy = () => {}; },
  };
  const proxy = new Proxy({}, {
    has(_t, name) {
      if (typeof name === 'symbol') return false;
      if (name in real) return true;
      if (declared.has(name)) return true;               // معرَّف في index.html (سيُستبدل بـ stub)
      if (name in globalThis) return false;               // Date/Number/Math...
      throw new ReferenceError(name + ' is not defined in renderDashboard');
    },
    get(_t, name) { if (typeof name === 'symbol') return undefined; return name in real ? real[name] : stub(); },
    set() { return true; },
  });
  const fnSource = body.slice(0, body.indexOf('\n}\n') + 2);
  const run = new Function('proxy', 'with (proxy) { ' + fnSource + '\n return renderDashboard; }');
  const renderDashboard = run(proxy);
  renderDashboard();
  assert.ok(rendered.html.length > 500, 'dashboard must render HTML');
  assert.ok(rendered.html.includes('data-dashboard-page="outstandingBalancesClinic"'));
  assert.ok(rendered.html.includes('عرض القائمة'));
  assert.ok(!rendered.html.includes('إيراد الطبيب'), 'doctor revenue section must be gone');
  assert.ok(!rendered.html.includes('صافى حصة المجمع'), 'shares card must be gone');
  assert.ok(!rendered.html.includes('من إجمالي'), 'the partial visit total must be gone');
}

console.log('PASS dashboard-no-visits-test: the dashboard no longer loads visits/doctors or shows visit-derived cards computed from a partial window, keeps the overdue link without a number, and other pages still load visits.');
