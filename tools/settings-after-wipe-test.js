const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');
const resetStart = source.indexOf('const DEFAULT_SETTINGS_AFTER_WIPE = {');
assert.ok(resetStart >= 0, 'local cleanup must define a complete settings object');
const resetBlock = source.slice(resetStart, source.indexOf('};', resetStart) + 2);
assert.match(resetBlock, /xrayTypes:\s*\[/, 'xrayTypes must exist after cleanup');
assert.match(resetBlock, /labTestTypes:\s*\[/, 'labTestTypes must exist after cleanup');
assert.match(source, /DB\.settings\.xrayTypes\.length/, 'settings page contract should remain covered');
assert.match(source, /DB\.settings\.labTestTypes\.length/, 'settings page contract should remain covered');
assert.match(source, /function ensureSettingsDefaults\(value\)/, 'settings normalization helper must exist');
assert.match(source, /DB\.settings = ensureSettingsDefaults\(DB\.settings\)/, 'renderSettings must normalize settings before rendering');
assert.match(source, /function renderPageError\(error\)/, 'route must expose render errors instead of leaving blank content');
assert.match(source, /Page render failed:/, 'route must catch renderer exceptions');
const cloudKeysStart = source.indexOf('const CLOUD_BUSINESS_KEYS_TO_CLEAR = [');
const cloudKeysEnd = source.indexOf('];', cloudKeysStart);
const cloudKeys = source.slice(cloudKeysStart, cloudKeysEnd);
assert.match(cloudKeys, /visitsClinic.*visitsDental.*visitsOperations.*visitsLabs.*visitsRadiology/s, 'cloud wipe must include patient visit tables');
assert.match(cloudKeys, /income.*expense/s, 'cloud wipe must include income and expense');
assert.doesNotMatch(cloudKeys, /doctors|employees|settings|categories|specialties|payroll|labExpenses|auditLog/, 'cloud wipe must not include settings, doctors, employees, or unrelated tables');
assert.match(source, /clearLocalHospitalData\(\{ scope: "business", wipeMarker:/, 'cloud marker must use the limited business scope');
assert.match(source, /if \(!businessOnly\) \{\r?\n    DB\.settings = \{ \.\.\.DEFAULT_SETTINGS_AFTER_WIPE \};/, 'settings reset must be limited to local full-browser cleanup');

console.log('PASS settings-after-wipe-test: local/cloud cleanup recreates settings arrays required by the settings page.');
