const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');
const grab = (re, name) => { const m = index.match(re); assert.ok(m, name + ' must exist'); return m[0]; };
const fns = [
  grab(/function settlementMonthKey\(\) \{[^\n]*\n/, 'settlementMonthKey'),
  grab(/function exactVisitsPlan\(page\) \{[\s\S]*?\n\}\n/, 'exactVisitsPlan'),
  grab(/function exactEntryFresh\(key, scope\) \{[\s\S]*?\n\}\n/, 'exactEntryFresh'),
  grab(/function exactVisitsReady\(plan\) \{[\s\S]*?\n\}\n/, 'exactVisitsReady'),
  grab(/function exactVisitsSettled\(plan\) \{[\s\S]*?\n\}\n/, 'exactVisitsSettled'),
  grab(/function exactVisitRows\(key, scope\) \{[\s\S]*?\n\}\n/, 'exactVisitRows'),
  grab(/function exactMonthVisits\(ym\) \{[\s\S]*?\n\}\n/, 'exactMonthVisits'),
  grab(/function clearExactVisits\(\) \{[\s\S]*?\n\}\n/, 'clearExactVisits'),
  grab(/async function fetchExactVisitRows\(key, scope\) \{[\s\S]*?\n\}\n/, 'fetchExactVisitRows'),
  grab(/async function ensureExactVisits\(page\) \{[\s\S]*?\n\}\n/, 'ensureExactVisits'),
  grab(/function exactVisitsPlaceholderHTML\(plan, title\) \{[\s\S]*?\n\}\n/, 'exactVisitsPlaceholderHTML'),
  grab(/function bindExactVisitsRetry\(root\) \{[\s\S]*?\n\}\n/, 'bindExactVisitsRetry'),
  grab(/function renderExactVisitsGate\(c, page, title\) \{[\s\S]*?\n\}\n/, 'renderExactVisitsGate'),
  grab(/function outstandingVisits\(meta\) \{[\s\S]*?\n\}\n/, 'outstandingVisits'),
].join('\n');

const SOURCES = [
  { dbKey: 'visitsClinic', kind: 'عيادات', kindKey: 'clinic' },
  { dbKey: 'visitsDental', kind: 'أسنان', kindKey: 'dental' },
  { dbKey: 'visitsOperations', kind: 'عمليات', kindKey: 'operations' },
  { dbKey: 'visitsLabs', kind: 'تحاليل', kindKey: 'labs' },
  { dbKey: 'visitsRadiology', kind: 'أشعة', kindKey: 'radiology' },
];
const J = x => JSON.stringify(x);
function make(extra = {}) {
  const calls = { table: [], page: [] };
  const mk = n => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, date: '2026-09-15', total: 10, paid: 5 }));
  const sandbox = Object.assign({
    STORAGE_MODE: 'firestore', currentUser: { id: 'u' }, READ_CACHE_TTL_MS: 300000,
    VISIT_SOURCE_DEFINITIONS: SOURCES, state: { payrollMonth: '2026-09' },
    todayISO: () => '2026-10-02', can: () => true, normalizePageId: p => p, route() {}, DB: {},
    window: { MitaliFirebase: {
      getTable: async key => { calls.table.push(key); return mk(120); },
      getPage: async (key, opts) => {
        calls.page.push({ key, opts: JSON.parse(JSON.stringify(opts)) });
        const n = opts.cursor ? Number(String(opts.cursor.documentId).slice(1)) + 1 : 1;
        return { records: mk(50), hasMore: n < 3, nextCursor: { primaryValue: '2026-09-01', documentId: 'c' + n } };
      },
    } },
    console: { warn() {} }, Date, Math, Number, String, Object, JSON, Promise, Error, RegExp, Array, Map,
  }, extra);
  sandbox.document = {};
  vm.createContext(sandbox);
  vm.runInContext('const EXACT_VISITS = Object.create(null); const EXACT_VISITS_ERRORS = Object.create(null); const EXACT_VISITS_LOADING = new Map();\n' + fns +
    '\nthis.api = { exactVisitsPlan, exactVisitsReady, exactVisitsSettled, exactVisitRows, exactMonthVisits, clearExactVisits, fetchExactVisitRows, ensureExactVisits, renderExactVisitsGate, outstandingVisits, EXACT_VISITS, EXACT_VISITS_ERRORS };', sandbox);
  return { sandbox, api: sandbox.api, calls };
}

(async () => {
  // ١) خطة التحميل لكل صفحة
  let t = make();
  assert.strictEqual(J(t.api.exactVisitsPlan('payroll')), J({ keys: SOURCES.map(s => s.dbKey), scope: '2026-09' }));
  assert.strictEqual(J(t.api.exactVisitsPlan('outstandingBalancesDental')), J({ keys: ['visitsDental'], scope: 'all' }));
  for (const [page, key] of [['outstandingBalancesClinic', 'visitsClinic'], ['outstandingBalancesOperations', 'visitsOperations'], ['outstandingBalancesLabs', 'visitsLabs'], ['outstandingBalancesRadiology', 'visitsRadiology']])
    assert.strictEqual(J(t.api.exactVisitsPlan(page).keys), J([key]));
  for (const page of ['dashboard', 'clinic', 'reports', 'ledger', 'income', 'patientFilesClinic']) assert.strictEqual(t.api.exactVisitsPlan(page), null, page);
  t = make({ state: { payrollMonth: 'all' } });
  assert.strictEqual(t.api.exactVisitsPlan('payroll'), null, 'month=all keeps the old path');
  t = make({ can: () => false });
  assert.strictEqual(t.api.exactVisitsPlan('payroll'), null, 'no doctors permission -> no extra reads');
  t = make({ STORAGE_MODE: 'local' });
  assert.strictEqual(t.api.exactVisitsPlan('payroll'), null);
  assert.strictEqual(t.api.exactVisitsPlan('outstandingBalancesClinic'), null);

  // ٢) جلب المستحقات كاملة: استعلام واحد للجدول
  t = make();
  let rows = await t.api.fetchExactVisitRows('visitsClinic', 'all');
  assert.strictEqual(rows.length, 120);
  assert.strictEqual(J(t.calls.table), '["visitsClinic"]');
  assert.strictEqual(t.calls.page.length, 0);

  // ٣) جلب زيارات الشهر كاملة: صفحات متتالية بمؤشر ونطاق تاريخ، حتى انتهاء النتائج
  t = make();
  rows = await t.api.fetchExactVisitRows('visitsLabs', '2026-09');
  assert.strictEqual(rows.length, 150, 'three pages of 50 are all collected');
  assert.strictEqual(t.calls.page.length, 3);
  assert.strictEqual(J(t.calls.page[0].opts.where), J([{ field: 'date', op: '>=', value: '2026-09-01' }, { field: 'date', op: '<=', value: '2026-09-30' }]));
  assert.strictEqual(t.calls.page[0].opts.cursor, null);
  assert.strictEqual(t.calls.page[1].opts.cursor.documentId, 'c1');
  assert.strictEqual(t.calls.page[2].opts.cursor.documentId, 'c2');
  assert.ok(t.calls.page.every(c => c.opts.pageSize === 50));
  t = make();
  await t.api.fetchExactVisitRows('visitsLabs', '2024-02');
  assert.strictEqual(t.calls.page[0].opts.where[1].value, '2024-02-29', 'leap year');

  // ٤) ensureExactVisits: يحمّل الأقسام الخمسة للتسوية بالتوازي ويخزّنها، ولا يعيد القراءة ضمن المهلة
  t = make();
  await t.api.ensureExactVisits('payroll');
  assert.strictEqual(t.calls.page.length, 15, '5 departments x 3 pages');
  const plan = t.api.exactVisitsPlan('payroll');
  assert.ok(t.api.exactVisitsReady(plan) && t.api.exactVisitsSettled(plan));
  await t.api.ensureExactVisits('payroll');
  assert.strictEqual(t.calls.page.length, 15, 'fresh data is not re-read');
  // تغيير الشهر يعيد التحميل
  t.sandbox.state.payrollMonth = '2026-08';
  assert.ok(!t.api.exactVisitsReady(t.api.exactVisitsPlan('payroll')), 'other month is not ready');
  await t.api.ensureExactVisits('payroll');
  assert.strictEqual(t.calls.page.length, 30);

  // ٥) زيارات الشهر المعروضة: كل الأقسام ومعلَّمة بالقسم ومفلترة بالشهر
  t = make();
  await t.api.ensureExactVisits('payroll');
  const monthVisits = t.api.exactMonthVisits('2026-09');
  assert.strictEqual(monthVisits.length, 750, '5 x 150, not the 250-row first-page window');
  assert.ok(monthVisits.every(v => v.kind && v.kindKey));
  assert.strictEqual(t.api.exactMonthVisits('2026-07').length, 0);

  // ٦) المستحقات: كل زيارات القسم وليس نافذة الـ 50
  t = make();
  t.sandbox.DB.visitsClinic = [{ id: 'only-window' }];
  const meta = { listKey: 'visitsClinic', kind: 'عيادات' };
  assert.strictEqual(t.api.outstandingVisits(meta).length, 1, 'before the exact load it falls back to DB');
  await t.api.ensureExactVisits('outstandingBalancesClinic');
  assert.strictEqual(t.api.outstandingVisits(meta).length, 120);

  // ٧) فشل التحميل: لا أرقام ناقصة، تظهر رسالة، ولا حلقة إعادة محاولة تلقائية
  t = make();
  t.sandbox.window.MitaliFirebase.getTable = async () => { throw new Error('offline'); };
  await t.api.ensureExactVisits('outstandingBalancesClinic');
  const p2 = t.api.exactVisitsPlan('outstandingBalancesClinic');
  assert.ok(!t.api.exactVisitsReady(p2), 'failed load is not ready');
  assert.ok(t.api.exactVisitsSettled(p2), 'failed load is settled (no automatic retry loop)');
  const c = { innerHTML: '', querySelectorAll: () => [] };
  assert.strictEqual(t.api.renderExactVisitsGate(c, 'outstandingBalancesClinic', 'T'), false);
  assert.ok(c.innerHTML.includes('تعذّر تحميل الزيارات كاملة') && c.innerHTML.includes('data-exact-retry'));

  // ٨) البوابة: قبل التحميل رسالة انتظار، وبعده تسمح بالرسم
  t = make();
  const c2 = { innerHTML: '', querySelectorAll: () => [] };
  assert.strictEqual(t.api.renderExactVisitsGate(c2, 'outstandingBalancesClinic', 'T'), false);
  assert.ok(c2.innerHTML.includes('جارٍ تحميل الزيارات كاملة'));
  await t.api.ensureExactVisits('outstandingBalancesClinic');
  assert.strictEqual(t.api.renderExactVisitsGate(c2, 'outstandingBalancesClinic', 'T'), true);
  assert.strictEqual(t.api.renderExactVisitsGate(c2, 'clinic', 'T'), true, 'pages without a plan are never gated');

  // ٩) مغادرة الصفحة تمسح المخزن
  t.api.clearExactVisits();
  assert.strictEqual(Object.keys(t.api.EXACT_VISITS).length, 0);

  // ١٠) تكامل ensurePageDataLoaded: لا تُقرأ أول صفحة من الزيارات للصفحات الدقيقة، ثم يُحمَّل المخزن الدقيق ثم route()
  const ens = index.match(/async function ensurePageDataLoaded\(page, options = \{\}\) \{[\s\S]*?\n\}\n/)[0];
  async function runEnsure(page, extra = {}) {
    const log = [];
    const sb = Object.assign({
      STORAGE_MODE: 'firestore', currentUser: { id: 'u' }, READ_CACHE_TTL_MS: 300000, Date, JSON, Promise, Set, Map, Object, Array, console: { warn() {} },
      SERVER_PAGED_KEYS: new Set(['visitsClinic', 'visitsDental', 'visitsOperations', 'visitsLabs', 'visitsRadiology', 'payroll', 'auditLog', 'labExpenses']),
      PAGE_DATA_LOADED_AT: {}, PAGE_DATA_LOADING: new Map(),
      pageKeys: p => ({ outstandingBalancesClinic: ['doctors', 'visitsClinic'], payroll: ['employees', 'doctors', 'payroll', 'labExpenses', ...SOURCES.map(s => s.dbKey), 'income'], clinic: ['doctors', 'visitsClinic'] })[p],
      getFirestorePageState: () => ({ pages: {}, querySignature: '[]' }),
      pageQueryOptions: () => ({ where: [] }),
      loadKeys: async keys => { log.push(['loadKeys', keys.join(',')]); },
      loadFirestorePage: async key => { log.push(['page', key]); },
      preloadFinancialSummaries: async () => {}, isMidEdit: () => false, isUserActivelyTyping: () => false,
      route: () => log.push(['route']),
      exactVisitsPlan: pg => (pg === 'outstandingBalancesClinic' ? { keys: ['visitsClinic'], scope: 'all' } : null),
      exactVisitsSettled: () => !!extra.settled,
      clearExactVisits: () => log.push(['clear']),
      ensureExactVisits: async pg => { log.push(['exact', pg]); },
    }, extra.globals || {});
    vm.createContext(sb);
    vm.runInContext(ens + '\nthis.fn = ensurePageDataLoaded;', sb);
    if (extra.freshAll) for (const k of ['doctors', 'employees', 'income']) sb.PAGE_DATA_LOADED_AT[k] = Date.now();
    await sb.fn(page);
    return log.map(x => x.join(':'));
  }
  let log = await runEnsure('outstandingBalancesClinic');
  assert.ok(!log.includes('page:visitsClinic'), 'no first-page read of visits on an exact page');
  assert.ok(log.includes('loadKeys:doctors') && log.includes('exact:outstandingBalancesClinic') && log.includes('route'));
  assert.ok(!log.includes('clear'));
  log = await runEnsure('outstandingBalancesClinic', { freshAll: true, settled: false });
  assert.deepStrictEqual([...log].map(String), ['exact:outstandingBalancesClinic', 'route'], 'fresh other keys but exact missing -> only the exact load, then one re-render');
  log = await runEnsure('outstandingBalancesClinic', { freshAll: true, settled: true });
  assert.strictEqual(log.length, 0, 'everything fresh -> nothing happens');
  log = await runEnsure('clinic');
  assert.ok(log.includes('clear'), 'leaving the exact pages clears the exact store');
  assert.ok(log.includes('page:visitsClinic'), 'normal pages keep the paged window load');

  // ١١) ربط الواجهة
  const outstanding = index.slice(index.indexOf('function renderOutstandingBalances(sectionKey)'));
  assert.ok(outstanding.indexOf('renderExactVisitsGate(c, state.page') > -1 && outstanding.indexOf('renderExactVisitsGate(c, state.page') < outstanding.indexOf('groupPatients(outstandingVisits(meta))'));
  const settle = index.slice(index.indexOf('function doctorSettlementSectionHTML()'), index.indexOf('function bindDoctorSettlementEvents'));
  assert.ok(settle.includes('exactVisitsPlaceholderHTML(exactPlan') && settle.includes('exactPlan ? exactMonthVisits(ym)'));
  assert.match(index, /function bindDoctorSettlementEvents\(c\) \{\s*bindExactVisitsRetry\(c\);/);
  assert.match(index, /outstandingBalances: \["doctors"\],\s*outstandingBalancesClinic: \[\], outstandingBalancesDental: \[\],/);

  // ١١-ب) تشغيل فعلي للدالتين المعدّلتين: أي معرّف غير معرَّف يرمي ReferenceError
  {
    const declared = new Set();
    for (const m of index.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) declared.add(m[1] || m[2]);
    const stub = () => new Proxy(function () {}, {
      get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()),
      apply: () => stub(),
    });
    const body = name => { const a = index.indexOf(name); const b = index.indexOf('\n}\n', a); return index.slice(a, b + 2); };
    function runFn(source, fnName, real) {
      const proxy = new Proxy({}, {
        has(_t, name) {
          if (typeof name === 'symbol') return false;
          if (name in real || declared.has(name)) return true;
          if (name in globalThis) return false;
          throw new ReferenceError(name + ' is not defined in ' + fnName);
        },
        get(_t, name) { if (typeof name === 'symbol') return undefined; return name in real ? real[name] : stub(); },
        set() { return true; },
      });
      return new Function('proxy', 'with (proxy) { ' + source + '\n return ' + fnName + '; }')(proxy);
    }
    const t2 = make();
    const a = t2.api;
    const common = {
      state: { page: 'outstandingBalancesClinic', payrollMonth: '2026-09', tablePage: {} }, DB: { visitsClinic: [], income: [], doctors: [], labExpenses: [] },
      STORAGE_MODE: 'firestore', can: () => true, canOutstandingSection: () => true, normalizePageId: p => p,
      OUTSTANDING_SECTION_META: { clinic: { kind: 'عيادات', label: 'L', icon: 'i', listKey: 'visitsClinic', csv: 'c', accent: '#000', soft: '#fff' } },
      OUTSTANDING_PAGE_SIZE: 20, fmt: n => String(n), esc: x => String(x), monthLabel: m => m, todayISO: () => '2026-10-02',
      groupPatients: rows => (rows.length ? [{ key: 'k', name: 'x', phone: '', totalDue: 10, totalPaid: 0, visits: rows, lastVisit: rows[0] }] : []),
      waIconButtonHTML: () => '', exportTableToCSV() {}, openWhatsAppChat() {}, route() {},
      exactVisitsPlan: a.exactVisitsPlan, exactVisitsReady: a.exactVisitsReady, exactVisitRows: a.exactVisitRows, exactMonthVisits: a.exactMonthVisits,
      renderExactVisitsGate: a.renderExactVisitsGate, outstandingVisits: a.outstandingVisits, exactVisitsPlaceholderHTML: (p, title) => '<card>' + title + '</card>',
      bindExactVisitsRetry() {}, settlementMonthKey: () => '2026-09', EXACT_VISITS: a.EXACT_VISITS,
    };
    // المستحقات: قبل التحميل رسالة انتظار، بعده الجدول بكل الزيارات
    const rendered = { html: '' };
    const content = { set innerHTML(v) { rendered.html = String(v); }, get innerHTML() { return rendered.html; }, querySelectorAll: () => [] };
    common.document = { getElementById: () => content };
    const renderOutstanding = runFn(body('function renderOutstandingBalances(sectionKey)'), 'renderOutstandingBalances', common);
    renderOutstanding('clinic');
    assert.ok(rendered.html.includes('جارٍ تحميل الزيارات كاملة'), 'before the exact load the page shows the loading card');
    await a.ensureExactVisits('outstandingBalancesClinic');
    renderOutstanding('clinic');
    assert.ok(rendered.html.includes('outstanding-cards-grid') && !rendered.html.includes('جارٍ تحميل الزيارات كاملة'), 'after the exact load the real page (not the loading card) is rendered');
    // تسوية الأطباء: بطاقة انتظار قبل التحميل، ثم رسم فعلي بلا أخطاء معرّفات
    const settleSrc = body('function doctorSettlementSectionHTML()');
    const settle = runFn(settleSrc, 'doctorSettlementSectionHTML', common);
    const waiting = settle();
    assert.ok(String(waiting).includes('تسوية حساب الأطباء'), 'settlement shows a waiting card before the exact load');
    await a.ensureExactVisits('payroll');
    common.exactVisitsReady = a.exactVisitsReady;
    assert.doesNotThrow(() => settle(), 'settlement renders after the exact load');
  }

  // ١٢) لم نلمس: مفاتيح الصفحات، الحفظ، المزامنة، النوافذ
  assert.match(index, /const PAGE_SIZE = 30;/);
  assert.match(index, /dashboard: \["income", "expense"\]/);
  assert.match(index, /reports: \["doctors", "employees", "visitsClinic"/);
  assert.match(index, /if \(visitSource && state\.page !== visitSource\.kindKey\) options\.pageSize = 50;/);

  console.log('PASS exact-visits-test: outstanding balances and doctor settlement read ALL visits (all-time per department / the whole selected month) in an isolated store, never the 50-row window, show a loading/error card instead of partial numbers, and do not touch DB, page snapshots, sync or other pages.');
})().catch(err => { console.error(err); process.exit(1); });
