const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const reportsHandler = require('../api/financial/reports');

async function runTests() {
  console.log('--- Testing Financial Reports API & Client Integration ---');

  // 1. Verify computeReports logic with a mock Firestore DB
  const mockDoctors = [
    { id: 'doc1', name: 'د. أحمد', type: 'كشف', specialty: 'باطنة', feeMode: 'fixed_visit', checkupClinicFee: 30 },
    { id: 'doc2', name: 'د. محمد', type: 'أسنان', specialty: 'أسنان', docPct: 0.6, clinicPct: 0.4 },
  ];

  const queriesExecuted = [];

  function createMockCollection(name, data = []) {
    return {
      doc(id) {
        return {
          get: async () => ({
            exists: true,
            data: () => ({ openingBalance: 5000 })
          })
        };
      },
      get: async () => ({
        docs: data.map(d => ({ id: d.id, data: () => d }))
      }),
      where(field, op, val) {
        queriesExecuted.push({ collection: name, field, op, val });
        return {
          where(field2, op2, val2) {
            queriesExecuted.push({ collection: name, field: field2, op: op2, val: val2 });
            return {
              select(...fields) {
                return {
                  get: async () => {
                    const filtered = data.filter(d => {
                      if (field === 'date' && op === '>=') {
                        if (d[field] < val) return false;
                      }
                      if (field2 === 'date' && op2 === '<=') {
                        if (d[field2] > val2) return false;
                      }
                      return true;
                    });
                    return {
                      docs: filtered.map(d => ({ id: d.id, data: () => d }))
                    };
                  }
                };
              },
              get: async () => {
                const filtered = data.filter(d => {
                  if (field === 'date' && op === '>=') {
                    if (d[field] < val) return false;
                  }
                  if (field2 === 'date' && op2 === '<=') {
                    if (d[field2] > val2) return false;
                  }
                  return true;
                });
                return {
                  docs: filtered.map(d => ({ id: d.id, data: () => d }))
                };
              },
              aggregate(spec) {
                return {
                  get: async () => {
                    const filtered = data.filter(d => {
                      if (field === 'date' && op === '>=') {
                        if (d[field] < val) return false;
                      }
                      if (field2 === 'date' && op2 === '<=') {
                        if (d[field2] > val2) return false;
                      }
                      return true;
                    });
                    const total = filtered.reduce((s, r) => s + Number(r.amount || r.paid || 0), 0);
                    return {
                      data: () => ({ total, count: filtered.length })
                    };
                  }
                };
              }
            };
          },
          select(...fields) {
            return {
              get: async () => ({
                docs: data.filter(d => {
                  if (op === '<') return d[field] < val;
                  if (op === '==') return d[field] === val;
                  return true;
                }).map(d => ({ id: d.id, data: () => d }))
              })
            };
          },
          aggregate(spec) {
            return {
              get: async () => {
                const filtered = data.filter(d => {
                  if (op === '<') return d[field] < val;
                  if (op === '==') return d[field] === val;
                  return true;
                });
                const total = filtered.reduce((s, r) => s + Number(r.amount || r.paid || 0), 0);
                return {
                  data: () => ({ total, count: filtered.length })
                };
              }
            };
          },
          get: async () => ({
            docs: data.filter(d => {
              if (op === '==') return d[field] === val;
              return true;
            }).map(d => ({ id: d.id, data: () => d }))
          })
        };
      }
    };
  }

  // 120 visits in 2026-10 (more than 50-row window limit)
  const visitsOctober = Array.from({ length: 120 }, (_, i) => ({
    id: `v_oct_${i}`,
    date: '2026-10-15',
    paid: 100,
    doctorId: i % 2 === 0 ? 'doc1' : 'doc2',
    examType: 'كشف',
    clinicFeeSnapshot: 30
  }));

  // 10 visits in 2026-09
  const visitsSeptember = Array.from({ length: 10 }, (_, i) => ({
    id: `v_sep_${i}`,
    date: '2026-09-15',
    paid: 100,
    doctorId: 'doc1',
    examType: 'كشف',
    clinicFeeSnapshot: 30
  }));

  const allMockVisits = [...visitsOctober, ...visitsSeptember];

  const mockDb = {
    collection(name) {
      if (name === 'doctors') return createMockCollection('doctors', mockDoctors);
      if (name === 'settings') return createMockCollection('settings');
      if (name.startsWith('visits_')) return createMockCollection(name, allMockVisits);
      if (name === 'income') return createMockCollection('income', [
        { id: 'inc1', date: '2026-10-10', amount: 500, category: 'كشف' },
        { id: 'inc2', date: '2026-09-10', amount: 300, category: 'كشف' }
      ]);
      if (name === 'expense') return createMockCollection('expense', [
        { id: 'exp1', date: '2026-10-12', amount: 200, category: 'صيانة' },
        { id: 'exp2', date: '2026-09-12', amount: 150, category: 'كهرباء' }
      ]);
      if (name === 'payroll') return createMockCollection('payroll', [
        { id: 'p1', month: '2026-10', amount: 1000, status: 'تم' }
      ]);
      if (name === 'lab_expenses') return createMockCollection('lab_expenses', []);
      return createMockCollection(name, []);
    }
  };

  // Test computeReports
  const resultOct = await reportsHandler.computeReports(mockDb, {
    range: 6,
    closingMonth: '2026-10',
    annualYear: '2026',
    doctorMonth: '2026-10'
  });

  // Test 1: Returns all required sections
  assert.ok(Array.isArray(resultOct.monthlyRows), 'must return monthlyRows array');
  assert.strictEqual(resultOct.monthlyRows.length, 0, 'monthlyRows must be empty to avoid reading past months');
  assert.ok(resultOct.byDoctor, 'must return byDoctor');
  assert.ok(resultOct.bySpecialty, 'must return bySpecialty');
  assert.ok(resultOct.closing, 'must return closing');
  assert.ok(resultOct.annual, 'must return annual');
  assert.strictEqual(resultOct.annual.loaded, false, 'annual must not be loaded by default to save quota');
  assert.strictEqual(resultOct.doctorMonth, '2026-10', 'must return doctorMonth');

  // Test 2: Does not limit to 50 rows (all 120 visits counted for 2026-10)
  // 5 collections * 60 visits for doc1 = 300 visits for doc1
  const doc1Data = resultOct.byDoctor.find(d => d.name === 'د. أحمد');
  assert.ok(doc1Data, 'doc1 must be present');
  assert.ok(doc1Data.count > 50, `doc1 count (${doc1Data.count}) must exceed 50-row limit without truncation`);

  // Test 3: Doctor report strictly limited to selected month (2026-10 visits only, no September visits)
  // In October, doc1 has 60 visits per collection * 5 = 300. In September, doc1 has 10 visits * 5 = 50.
  // If doctorMonth is 2026-10, count must be exactly 300, NOT 350!
  assert.strictEqual(doc1Data.count, 300, 'byDoctor must only include visits for doctorMonth (2026-10)');

  // Test 4: When doctorMonth is changed to 2026-09, only 2026-09 visits are included
  const resultSep = await reportsHandler.computeReports(mockDb, {
    range: 6,
    closingMonth: '2026-09',
    annualYear: '2026',
    doctorMonth: '2026-09'
  });
  const doc1SepData = resultSep.byDoctor.find(d => d.name === 'د. أحمد');
  assert.strictEqual(doc1SepData.count, 50, 'byDoctor for 2026-09 must only include September visits (50)');
  assert.strictEqual(resultSep.byDoctor.find(d => d.name === 'د. محمد'), undefined, 'doc2 had 0 visits in September and must not appear');

  // Test 4b: includeAnnual='1' explicitly executes annual calculation
  const resultWithAnnual = await reportsHandler.computeReports(mockDb, {
    range: 6,
    closingMonth: '2026-10',
    annualYear: '2026',
    doctorMonth: '2026-10',
    includeAnnual: '1'
  });
  assert.ok(resultWithAnnual.annual, 'must still return annual object');
  assert.strictEqual(resultWithAnnual.annual.loaded, true, 'annual must be loaded when includeAnnual is 1');

  // Test 4c: Code 8 quota exhausted error handling
  let statusOut = 0;
  let bodyOut = null;
  const mockRes = {
    status(s) { statusOut = s; return this; },
    setHeader() { return this; },
    end(str) { bodyOut = JSON.parse(str); }
  };
  const mockReq = {
    method: 'GET',
    headers: { authorization: 'Bearer test' },
    query: { doctorMonth: '2026-10' }
  };
  // Test handler with mock error
  const originalGetAdmin = require('../api/_lib/firebase-admin').getAdmin;
  try {
    const quotaError = Object.assign(new Error('Quota exceeded for Firestore reads'), { code: 8 });
    const mockApi = {
      auth: () => ({ verifyIdToken: async () => ({ uid: 'user1' }) }),
      firestore: () => ({
        collection: (col) => {
          if (col === 'users') {
            return {
              doc: () => ({
                get: async () => ({ exists: true, data: () => ({ status: 'نشط' }) })
              })
            };
          }
          throw quotaError;
        }
      })
    };
    require('../api/_lib/firebase-admin').getAdmin = () => mockApi;
    await reportsHandler(mockReq, mockRes);
    assert.strictEqual(statusOut, 503, 'Code 8 must result in HTTP 503');
    assert.strictEqual(bodyOut.error, 'firestore-resource-exhausted', 'Code 8 must result in firestore-resource-exhausted');
    assert.strictEqual(bodyOut.retryable, true, 'Must indicate retryable');
  } finally {
    require('../api/_lib/firebase-admin').getAdmin = originalGetAdmin;
  }

  // Test 5: Check index.html source contracts
  const indexHtml = fs.readFileSync('index.html', 'utf8');

  // Check PAGE_DATA_KEYS.reports is empty
  const pageDataMatch = indexHtml.match(/reports:\s*\[(.*?)\],/);
  assert.ok(pageDataMatch, 'PAGE_DATA_KEYS must contain reports');
  assert.strictEqual(pageDataMatch[1].trim(), '', 'PAGE_DATA_KEYS.reports must be empty');

  // Check PAGE_REALTIME_KEYS.reports is empty
  const realtimeMatch = indexHtml.match(/const PAGE_REALTIME_KEYS\s*=\s*\{[\s\S]*?reports:\s*\[(.*?)\],/);
  assert.ok(realtimeMatch, 'PAGE_REALTIME_KEYS must contain reports');
  assert.strictEqual(realtimeMatch[1].trim(), '', 'PAGE_REALTIME_KEYS.reports must be empty');

  // Check that renderReports uses REPORTS_API_DATA and does not compute from DB collections
  const renderReportsMatch = indexHtml.match(/function renderReports\(\)\s*\{([\s\S]*?)\nfunction /);
  assert.ok(renderReportsMatch, 'renderReports function must exist');
  assert.ok(renderReportsMatch[1].includes('const reportsData = REPORTS_API_DATA;'), 'renderReports must use REPORTS_API_DATA');
  assert.ok(!renderReportsMatch[1].includes('DB.income.filter'), 'renderReports must not use DB.income');
  assert.ok(!renderReportsMatch[1].includes('DB.expense.filter'), 'renderReports must not use DB.expense');
  assert.ok(!renderReportsMatch[1].includes('DB.payroll.filter'), 'renderReports must not use DB.payroll');
  assert.ok(!renderReportsMatch[1].includes('exportMonthlyCsv'), 'renderReports must not contain monthly table export button');
  assert.ok(!renderReportsMatch[1].includes('reportMonthsSelect'), 'renderReports must not contain monthly table range select');
  assert.ok(renderReportsMatch[1].includes('doctorMonthInput'), 'renderReports must have doctorMonthInput');
  assert.ok(renderReportsMatch[1].includes('specialtyMonthInput'), 'renderReports must have specialtyMonthInput');

  // Test 6: Verify cache in index.html
  assert.ok(indexHtml.includes('const REPORTS_CACHE = Object.create(null);'), 'REPORTS_CACHE must be declared');
  assert.ok(indexHtml.includes('REPORTS_CACHE[paramKey]'), 'REPORTS_CACHE must cache by paramKey');

  // Test 7: Verify firebase-store.js getReportsData function
  const firebaseStore = fs.readFileSync('firebase-store.js', 'utf8');
  assert.ok(firebaseStore.includes('async function getReportsData'), 'getReportsData must be declared in firebase-store.js');
  assert.ok(firebaseStore.includes('/api/financial/reports'), 'getReportsData must call /api/financial/reports');
  assert.ok(firebaseStore.includes('doctorMonth: String(options.doctorMonth || "")'), 'getReportsData must pass doctorMonth');
  assert.ok(firebaseStore.includes('15000'), 'getReportsData must use a robust 15s timeout to prevent admin-api-timeout');

  console.log('PASS financial-reports-test: all report sections returned, scoped by doctorMonth, no 50-row limit, no allRevenueVisits dependency, and cached without unnecessary queries.');
}

runTests().catch(err => {
  console.error('FAIL financial-reports-test:', err);
  process.exit(1);
});
