const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');

const requiredSources = [
  ['visitsClinic', 'عيادات', 'clinic'],
  ['visitsDental', 'أسنان', 'dental'],
  ['visitsOperations', 'عمليات', 'operations'],
  ['visitsLabs', 'تحاليل', 'labs'],
  ['visitsRadiology', 'أشعة', 'radiology'],
];

assert.match(source, /const VISIT_SOURCE_DEFINITIONS = Object\.freeze\(\[/);
for (const [dbKey, kind, kindKey] of requiredSources) {
  assert.match(source, new RegExp(`dbKey: "${dbKey}"`), `${dbKey} must be a central visit source`);
  assert.match(source, new RegExp(`kind: "${kind}"`), `${kind} must have a display label`);
  assert.match(source, new RegExp(`kindKey: "${kindKey}"`), `${kindKey} must have a stable key`);
}

assert.match(source, /dashboard: \["doctors", \.\.\.REVENUE_VISIT_DB_KEYS, "income", "expense"\]/);
assert.match(source, /function visitsFromSources\(sources = VISIT_SOURCE_DEFINITIONS\)/);
assert.match(source, /function allVisits\(\) \{\s*return visitsFromSources\(VISIT_SOURCE_DEFINITIONS\.slice\(0, 2\)\);/s);
assert.match(source, /function allRevenueVisits\(\) \{\s*return visitsFromSources\(VISIT_SOURCE_DEFINITIONS\);/s);
assert.match(source, /function allPatientVisits\(\) \{\s*return visitsFromSources\(VISIT_SOURCE_DEFINITIONS\);/s);

const realtime = source.match(/const PAGE_REALTIME_KEYS = \{([\s\S]*?)\n\};/);
assert.ok(realtime, 'PAGE_REALTIME_KEYS must be declared');
assert.match(realtime[1], /dashboard: \["income", "expense", \.\.\.REVENUE_VISIT_DB_KEYS\]/);
assert.match(realtime[1], /income: \["income"\]/);
assert.match(realtime[1], /settings: \["doctors", "employees", "settings", "categories", "specialties"\]/);
assert.match(realtime[1], /outstandingBalances: \["doctors", \.\.\.REVENUE_VISIT_DB_KEYS\]/);
assert.doesNotMatch(realtime[1], /staffAccounts/);

console.log('PASS dashboard-patient-sources-test: all five visit departments share one source map and reach dashboard/patient aggregation safely.');
