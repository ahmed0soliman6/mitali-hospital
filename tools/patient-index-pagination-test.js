'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const store = fs.readFileSync(path.join(root, 'firebase-store.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

// 1. Verify Firestore Rules allow activeUser for both index collections
assert.match(rules, /match \/patient_file_index_clinic\/\{document\}\s*\{\s*allow read, write: if activeUser\(\);/);
assert.match(rules, /match \/patient_file_index_dental\/\{document\}\s*\{\s*allow read, write: if activeUser\(\);/);

// 2. Verify firebase-store.js defines getPatientIndexPage and exports it
assert.match(store, /async function getPatientIndexPage\(pageKey, options = \{\}\)/);
assert.match(store, /patientFilesClinic:\s*"patient_file_index_clinic"/);
assert.match(store, /patientFilesDental:\s*"patient_file_index_dental"/);
assert.match(store, /getPatientIndexPage,/);

// 3. Verify index.html defines PATIENT_FILES_PAGE_SIZE and PATIENT_FILE_PAGE_STATE
assert.match(html, /const PATIENT_FILES_PAGE_SIZE = 30;/);
assert.match(html, /const PATIENT_FILE_PAGE_STATE = \{/);
assert.match(html, /patientFilesClinic:\s*\{/);
assert.match(html, /patientFilesDental:\s*\{/);

// 4. Test VM simulation of pagination state and caching
const mockDocs = Array.from({ length: 70 }, (_, i) => ({
  id: `patient-${i + 1}`,
  name: `مريض ${i + 1}`,
  phone: `010000000${i + 1}`,
  visitsCount: 1,
  lastVisitDate: '2026-10-01',
  totalPaid: 100,
  totalDue: 0,
  updatedAt: new Date(Date.now() - i * 1000).toISOString()
}));

let networkReadsCount = 0;
const mockFirebase = {
  getPatientIndexPage: async (pageKey, options = {}) => {
    networkReadsCount++;
    const pageSize = options.pageSize || 30;
    const startIdx = options.cursor ? Number(options.cursor.id.replace('patient-', '')) : 0;
    const slice = mockDocs.slice(startIdx, startIdx + pageSize + 1);
    const docs = slice.slice(0, pageSize);
    return {
      records: docs,
      hasMore: slice.length > pageSize,
      nextCursor: docs.length ? { id: docs[docs.length - 1].id } : null,
      pageSize
    };
  }
};

const sandbox = {
  window: { MitaliFirebase: mockFirebase },
  PATIENT_FILES_PAGE_SIZE: 30,
  PATIENT_FILE_PAGE_STATE: {
    patientFilesClinic: { currentPage: 1, pages: {}, loading: false, searchResults: {} },
    patientFilesDental: { currentPage: 1, pages: {}, loading: false, searchResults: {} }
  },
  PATIENT_PAGE_LOAD_PROMISES: new Map(),
  STORAGE_MODE: 'firestore',
  currentUser: { username: 'test' },
  isMidEdit: () => false,
  isUserActivelyTyping: () => false,
  console
};

vm.createContext(sandbox);

// Extract loadPatientFilesPageData & navigatePatientFilesPage from index.html
const fnLoad = html.match(/async function loadPatientFilesPageData\([^)]*\)\s*\{[\s\S]*?\n\}/)[0];
const fnNav = html.match(/(?:async\s+)?function navigatePatientFilesPage\([^)]*\)\s*\{[\s\S]*?\n\}/)[0];
vm.runInContext(`${fnLoad}\n${fnNav}\nfunction route() {}`, sandbox);

(async () => {
  // Page 1 load
  await sandbox.loadPatientFilesPageData('patientFilesClinic', 1);
  const state1 = sandbox.PATIENT_FILE_PAGE_STATE.patientFilesClinic;
  assert.equal(state1.pages[1].records.length, 30);
  assert.equal(state1.pages[1].records[0].name, 'مريض 1');
  assert.equal(state1.pages[1].hasMore, true);
  assert.equal(networkReadsCount, 1, 'First load should perform 1 read request');

  // Page 2 load (using nextCursor of Page 1)
  await sandbox.loadPatientFilesPageData('patientFilesClinic', 2);
  assert.equal(state1.pages[2].records.length, 30);
  assert.equal(state1.pages[2].records[0].name, 'مريض 31');
  assert.equal(networkReadsCount, 2, 'Second page load should perform 1 read request');

  // Page 1 re-access (Zero reads - cached in state)
  await sandbox.loadPatientFilesPageData('patientFilesClinic', 1);
  assert.equal(networkReadsCount, 2, 'Returning to page 1 must NOT re-read Firestore (zero read)');
  assert.equal(state1.pages[1].records[0].name, 'مريض 1');

  console.log('PASS: patient-index-pagination-test passed with zero unnecessary Firestore reads and true 30-patient pages.');
})();
