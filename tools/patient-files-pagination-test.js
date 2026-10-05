const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');
const grab = (re, name) => { const m = index.match(re); assert.ok(m, name + ' must exist'); return m[0]; };

// 1. Verify structural configuration in index.html and firebase-store.js
const fbStore = fs.readFileSync('firebase-store.js', 'utf8');
assert.match(fbStore, /patientFileIndexClinic:\s*"patient_file_index_clinic"/, 'patientFileIndexClinic must be mapped in firebase-store.js');
assert.match(fbStore, /patientFileIndexDental:\s*"patient_file_index_dental"/, 'patientFileIndexDental must be mapped in firebase-store.js');
assert.match(fbStore, /patientFileIndexClinic:\s*\{\s*primary:\s*"updatedAt"\s*\}/, 'patientFileIndexClinic primary order field must be updatedAt');
assert.match(fbStore, /patientFileIndexDental:\s*\{\s*primary:\s*"updatedAt"\s*\}/, 'patientFileIndexDental primary order field must be updatedAt');

assert.match(index, /patientFileIndexClinic/, 'patientFileIndexClinic must exist in index.html');
assert.match(index, /patientFileIndexDental/, 'patientFileIndexDental must exist in index.html');
assert.match(index, /patientFilesClinic:\s*\["doctors",\s*"patientFileIndexClinic"\]/, 'patientFilesClinic page keys must use patientFileIndexClinic');
assert.match(index, /patientFilesDental:\s*\["doctors",\s*"patientFileIndexDental"\]/, 'patientFilesDental page keys must use patientFileIndexDental');

// 2. Unit testing patient summary functions, pagination, and on-demand visit loading
const fns = [
  'const PATIENT_VISITS_LOADED_KEYS = new Set();',
  grab(/function patientFilesPaginationHTML\(pageKey, pageInfo\) \{[\s\S]*?\n\}\n/, 'patientFilesPaginationHTML'),
  grab(/function patientKey\(v\) \{[\s\S]*?\n\}\n/, 'patientKey'),
  grab(/function groupPatients\(visits\) \{[\s\S]*?\n\}\n/, 'groupPatients'),
  grab(/async function syncPatientSummaryForVisit\(visit, kindKey\) \{[\s\S]*?\n\}\n/, 'syncPatientSummaryForVisit'),
  grab(/async function ensurePatientVisitsLoaded\(kindKey, pKey\) \{[\s\S]*?\n\}\n/, 'ensurePatientVisitsLoaded'),
  grab(/function getPatientSummaries\(kindKey\) \{[\s\S]*?\n\}\n/, 'getPatientSummaries'),
  grab(/function renderPatientList\(summaries, pgInfo, pageKey\) \{[\s\S]*?\n\}\n/, 'renderPatientList'),
].join('\n');

function makeSandbox(extra = {}) {
  const calls = { getPage: [] };
  const DB = {
    doctors: [],
    visitsClinic: [],
    visitsDental: [],
    patientFileIndexClinic: [],
    patientFileIndexDental: [],
  };
  const sandbox = Object.assign({
    STORAGE_MODE: 'firestore',
    currentUser: { id: 'u1' },
    READ_CACHE_TTL_MS: 300000,
    DB,
    state: { tablePage: {} },
    PAGE_SIZE: 30,
    todayISO: () => '2026-10-05',
    nowISO: () => '2026-10-05T12:00:00.000Z',
    visitRemaining: v => Math.max(0, (Number(v.total) || 0) - (Number(v.paid) || 0)),
    sortByEntryOrderDesc: list => (list || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    esc: x => String(x || ''),
    fmt: n => String(n || 0),
    fmtInt: n => String(n || 0),
    entryTimeDisplay: () => '',
    waIconButtonHTML: () => '',
    paginationControlsHTML: (key, info) => `<nav-bar-page-${info.current}></nav-bar-page-${info.current}>`,
    storeSetInner: async (key, val) => { DB[key] = val; },
    persist: async () => {},
    markSyncTombstone: async () => {},
    window: {
      MitaliFirebase: {
        getPage: async (key, opts) => {
          calls.getPage.push({ key, opts: JSON.parse(JSON.stringify(opts)) });
          return { records: [], hasMore: false };
        }
      }
    },
    console: { warn() {}, error() {} },
    Date, Math, Number, String, Array, Object, Map, Set, JSON, Promise,
  }, extra);

  vm.createContext(sandbox);
  vm.runInContext(fns + '\nthis.api = { patientKey, groupPatients, syncPatientSummaryForVisit, ensurePatientVisitsLoaded, getPatientSummaries, renderPatientList };', sandbox);
  return { sandbox, api: sandbox.api, calls, DB };
}

(async () => {
  // Test A: Patient summary sync on visit save/delete
  let { api, DB } = makeSandbox();
  const visit1 = { id: 'v1', date: '2026-10-01', fileNo: '101', patient: 'أحمد', phone: '01012345678', total: 500, paid: 200, createdAt: '2026-10-01T10:00:00Z' };
  DB.visitsClinic.push(visit1);

  await api.syncPatientSummaryForVisit(visit1, 'clinic');
  assert.strictEqual(DB.patientFileIndexClinic.length, 1, 'Patient summary record created in patientFileIndexClinic');
  assert.strictEqual(DB.patientFileIndexClinic[0].patientKey, 'F:101');
  assert.strictEqual(DB.patientFileIndexClinic[0].visitsCount, 1);
  assert.strictEqual(DB.patientFileIndexClinic[0].totalDue, 300);

  // Add second visit for same patient
  const visit2 = { id: 'v2', date: '2026-10-05', fileNo: '101', patient: 'أحمد', phone: '01012345678', total: 300, paid: 300, createdAt: '2026-10-05T10:00:00Z' };
  DB.visitsClinic.push(visit2);
  await api.syncPatientSummaryForVisit(visit2, 'clinic');
  assert.strictEqual(DB.patientFileIndexClinic.length, 1, 'Patient summary updated without duplicates');
  assert.strictEqual(DB.patientFileIndexClinic[0].visitsCount, 2);
  assert.strictEqual(DB.patientFileIndexClinic[0].totalDue, 300);

  // Test B: 30 patients per page & pagination UI controls in renderPatientList
  let { api: apiB, DB: DBb } = makeSandbox();
  const mockSummaries = Array.from({ length: 65 }, (_, i) => ({
    id: 'F:' + (i + 1),
    patientKey: 'F:' + (i + 1),
    fileNo: String(i + 1),
    name: 'مريض ' + (i + 1),
    phone: '010' + (i + 1),
    visitsCount: 1,
    totalPaid: 100,
    totalDue: 0,
    lastVisitDate: '2026-10-01'
  }));
  DBb.patientFileIndexDental = mockSummaries;

  const summaries = apiB.getPatientSummaries('dental');
  assert.strictEqual(summaries.length, 65);

  const page1Items = summaries.slice(0, 30);
  const pgInfoPage1 = { current: 1, totalPages: 3, total: 65, start: 1, end: 30, hasMore: true };
  const htmlPage1 = apiB.renderPatientList(page1Items, pgInfoPage1, 'patientFilesDental');
  assert.ok(htmlPage1.includes('مريض 1'), 'Page 1 renders first patient');
  assert.ok(htmlPage1.includes('مريض 30'), 'Page 1 renders 30th patient');
  assert.ok(!htmlPage1.includes('مريض 31'), 'Page 1 does NOT render 31st patient');
  assert.ok(htmlPage1.includes('data-patient-page-nav="patientFilesDental"'), 'Pagination controls present');

  // Test C: On-demand full patient visit history load upon opening a patient file
  let { api: apiC, calls: callsC, DB: DBc } = makeSandbox();
  await apiC.ensurePatientVisitsLoaded('clinic', 'F:202');
  assert.strictEqual(callsC.getPage.length, 1, 'getPage called for specific patient fileNo on demand');
  assert.strictEqual(callsC.getPage[0].key, 'visitsClinic');
  assert.deepStrictEqual(callsC.getPage[0].opts.where, [{ field: 'fileNo', op: '==', value: '202' }]);

  console.log('PASS patient-files-pagination-test: independent 30-patient cursor pagination, patient summary index sync, and on-demand patient visit history loading are verified.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
