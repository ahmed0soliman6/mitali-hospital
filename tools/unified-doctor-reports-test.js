const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const reportsHandler = require('../api/financial/reports');

async function runTests() {
  console.log('--- Testing Unified Doctor Reports & Cache Optimization ---');

  const index = fs.readFileSync('index.html', 'utf8');
  const store = fs.readFileSync('firebase-store.js', 'utf8');

  // 1. Static Contract Checks
  // A: income is NOT in PAGE_DATA_KEYS.payroll
  const pageDataKeysBlock = index.match(/const PAGE_DATA_KEYS = \{([\s\S]*?)\};/);
  assert.ok(pageDataKeysBlock, 'PAGE_DATA_KEYS must exist');
  const payrollKeysMatch = pageDataKeysBlock[1].match(/payroll:\s*\[([^\]]*?)\]/);
  assert.ok(payrollKeysMatch, 'PAGE_DATA_KEYS.payroll must exist');
  assert.ok(!payrollKeysMatch[1].includes('"income"'), 'PAGE_DATA_KEYS.payroll must NOT include "income"');
  assert.ok(payrollKeysMatch[1].includes('...REVENUE_VISIT_DB_KEYS'), 'PAGE_DATA_KEYS.payroll must include ...REVENUE_VISIT_DB_KEYS');

  // B: settlementMonthKey prioritizes state.settlementMonth
  const settleKeyFn = index.match(/function settlementMonthKey\(\) \{([^\n]*)\}/);
  assert.ok(settleKeyFn, 'settlementMonthKey must exist on single line');
  assert.ok(settleKeyFn[1].includes('state.settlementMonth'), 'settlementMonthKey must check state.settlementMonth');

  // C: DOCTOR_REPORTS_CACHE and getUnifiedDoctorReport exist
  assert.ok(index.includes('const DOCTOR_REPORTS_CACHE = Object.create(null);'), 'DOCTOR_REPORTS_CACHE must exist');
  assert.ok(index.includes('async function getUnifiedDoctorReport'), 'getUnifiedDoctorReport must exist');
  assert.ok(index.includes('function invalidateDoctorReportsCache'), 'invalidateDoctorReportsCache must exist');

  // D: Export of getDoctorMonthReport in firebase-store.js
  assert.ok(store.includes('getDoctorMonthReport,'), 'getDoctorMonthReport must be exported in window.MitaliFirebase');
  assert.ok(store.includes('window.getDoctorMonthReport = getDoctorMonthReport;'), 'window.getDoctorMonthReport must be exported');

  // E: Invalidation called at mutations
  assert.ok(index.includes('invalidateDoctorReportsCache(rec.date);'), 'must invalidate on visit/income save');
  assert.ok(index.includes('invalidateDoctorReportsCache(ym);'), 'must invalidate on lab expense save');

  // 2. Unit Testing in Sandbox
  const sandbox = {
    state: { settlementMonth: null, payrollMonth: null },
    todayISO: () => '2026-10-09',
    DOCTOR_REPORTS_CACHE: Object.create(null),
    DOCTOR_REPORTS_INFLIGHT: new Map(),
    DOCTOR_REPORTS_ERRORS: Object.create(null),
    DOCTOR_REPORTS_TTL_MS: 300000,
    REPORTS_CACHE: Object.create(null),
    STORAGE_MODE: 'firestore',
    currentUser: { id: 'test' },
    Date, Math, Number, String, Object, Map, Promise, console
  };

  // Run settlementMonthKey in sandbox
  vm.createContext(sandbox);
  vm.runInContext(settleKeyFn[0] + '\nthis.settlementMonthKey = settlementMonthKey;', sandbox);

  // Test 2A: settlementMonthKey logic
  sandbox.state.settlementMonth = '2026-08';
  sandbox.state.payrollMonth = '2026-10';
  assert.strictEqual(sandbox.settlementMonthKey(), '2026-08', 'settlementMonth must take precedence over payrollMonth');

  sandbox.state.settlementMonth = null;
  sandbox.state.payrollMonth = '2026-10';
  assert.strictEqual(sandbox.settlementMonthKey(), '2026-10', 'falls back to payrollMonth when settlementMonth is null');

  sandbox.state.settlementMonth = null;
  sandbox.state.payrollMonth = 'all';
  assert.strictEqual(sandbox.settlementMonthKey(), 'all', 'settlementMonthKey preserves "all" when payrollMonth is "all"');

  sandbox.state.settlementMonth = '2026-09';
  sandbox.state.payrollMonth = 'all';
  assert.strictEqual(sandbox.settlementMonthKey(), '2026-09', 'settlementMonth overrides "all" without changing payroll filter');

  // Test 2B: In-flight request sharing and browser caching
  let cloudCallCount = 0;
  sandbox.window = {
    MitaliFirebase: {
      authUser: () => ({ uid: 'u1' }),
      getDoctorMonthReport: async (ym) => {
        cloudCallCount++;
        await new Promise(r => setTimeout(r, 10));
        return {
          doctorMonth: ym,
          byDoctor: [
            { doctorId: 'd1', name: 'د. سمير', type: 'كشف', count: 15, rev: 1500, docShare: 900, clinicShare: 600, labExpense: 0 }
          ],
          bySpecialty: { 'باطنة': 1500 },
          totals: { gross: 1500, lab: 0, net: 1500, doc: 900, clinic: 600, count: 15 }
        };
      }
    }
  };

  const getUnifiedSrc = index.match(/async function getUnifiedDoctorReport[\s\S]*?\n\}\n/)[0];
  const invalSrc = index.match(/function invalidateDoctorReportsCache[\s\S]*?\n\}\n/)[0];
  vm.runInContext(invalSrc + '\n' + getUnifiedSrc + '\nthis.getUnifiedDoctorReport = getUnifiedDoctorReport; this.invalidateDoctorReportsCache = invalidateDoctorReportsCache;', sandbox);

  // Simultaneous calls share one in-flight request
  const [res1, res2] = await Promise.all([
    sandbox.getUnifiedDoctorReport('2026-09'),
    sandbox.getUnifiedDoctorReport('2026-09')
  ]);
  assert.strictEqual(cloudCallCount, 1, 'concurrent requests for same month must coalesce into 1 call');
  assert.deepStrictEqual(res1, res2, 'concurrent callers receive identical data');

  // Third call reads from browser cache
  const res3 = await sandbox.getUnifiedDoctorReport('2026-09');
  assert.strictEqual(cloudCallCount, 1, 'cached month must not call cloud API again');
  assert.strictEqual(res3.totals.gross, 1500);

  // Invalidation clears cache
  sandbox.invalidateDoctorReportsCache('2026-09');
  assert.strictEqual(sandbox.DOCTOR_REPORTS_CACHE['2026-09'], undefined, 'cache entry must be deleted after invalidation');

  const res4 = await sandbox.getUnifiedDoctorReport('2026-09');
  assert.strictEqual(cloudCallCount, 2, 'subsequent call after invalidation refetches fresh data');

  // 3. API Isolation Test: scope=doctors does not touch expense, payroll, or settings
  const collectionsAccessed = [];
  function createSpyCollection(name, docs = []) {
    return {
      doc: () => ({ get: async () => { collectionsAccessed.push(name); return { exists: false }; } }),
      where: () => ({
        where: () => ({
          select: () => ({
            get: async () => {
              collectionsAccessed.push(name);
              return { docs: docs.map(d => ({ id: d.id, data: () => d })) };
            }
          }),
          get: async () => {
            collectionsAccessed.push(name);
            return { docs: docs.map(d => ({ id: d.id, data: () => d })) };
          }
        }),
        get: async () => {
          collectionsAccessed.push(name);
          return { docs: docs.map(d => ({ id: d.id, data: () => d })) };
        }
      }),
      get: async () => {
        collectionsAccessed.push(name);
        return { docs: docs.map(d => ({ id: d.id, data: () => d })) };
      }
    };
  }

  // 120 visits to test complete counting without 50-row cutoff
  const visits120 = Array.from({ length: 120 }, (_, i) => ({
    id: `v_${i}`, date: '2026-10-10', paid: 100, doctorId: 'doc1', examType: 'كشف', clinicFeeSnapshot: 40
  }));

  const mockDb = {
    collection: (name) => {
      if (name === 'doctors') return createSpyCollection('doctors', [{ id: 'doc1', name: 'د. خالد', type: 'كشف', docPct: 0.6, clinicPct: 0.4 }]);
      if (name.startsWith('visits_')) return createSpyCollection(name, visits120);
      if (name === 'income') return createSpyCollection('income', []);
      if (name === 'lab_expenses') return createSpyCollection('lab_expenses', []);
      return createSpyCollection(name, []);
    }
  };

  const doctorOnlyResult = await reportsHandler.computeDoctorReports(mockDb, '2026-10');
  assert.ok(doctorOnlyResult.byDoctor, 'must return byDoctor');
  // 5 collections * 120 visits = 600 visits
  assert.strictEqual(doctorOnlyResult.byDoctor[0].count, 600, 'must compute all 600 visits without 50 truncation');
  assert.strictEqual(doctorOnlyResult.totals.gross, 60000, 'gross revenue must equal 60,000');

  // Verify that expense, payroll, settings openingBalance were NOT accessed
  assert.ok(!collectionsAccessed.includes('expense'), 'scope=doctors must NOT query expense');
  assert.ok(!collectionsAccessed.includes('payroll'), 'scope=doctors must NOT query payroll');
  assert.ok(!collectionsAccessed.includes('settings'), 'scope=doctors must NOT query settings');

  // 4. Verify Patient Indexing contracts are intact
  assert.ok(store.includes('async function searchPatientIndex'), 'searchPatientIndex must remain defined in store');
  assert.ok(store.includes('async function savePatientToIndex'), 'savePatientToIndex must remain defined in store');
  assert.ok(store.includes('searchPatientIndex,'), 'searchPatientIndex must remain exported in store');
  assert.ok(store.includes('savePatientToIndex,'), 'savePatientToIndex must remain exported in store');
  assert.ok(index.includes('searchPatientIndex'), 'searchPatientIndex must be used in index');

  console.log('PASS unified-doctor-reports-test: unified data source, browser cache reuse, in-flight sharing, complete row counting, no full income collection load on payroll, independent settlement month, and cache invalidation on save.');
}

runTests().catch(err => {
  console.error('FAIL unified-doctor-reports-test:', err);
  process.exit(1);
});
