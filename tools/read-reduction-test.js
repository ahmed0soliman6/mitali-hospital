const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync('index.html', 'utf8');
const realtimeMatch = index.match(/const PAGE_REALTIME_KEYS\s*=\s*\{([\s\S]*?)\n\};/);
assert.ok(realtimeMatch, 'PAGE_REALTIME_KEYS must be declared');
assert.doesNotMatch(realtimeMatch[1], /staffAccounts/);
assert.match(realtimeMatch[1], /visitsClinic|visitsDental/);
assert.match(index, /function subscribeFirestoreRealtime\(page = state\.page\)/);

const codeWithoutLineComments = index.replace(/^\s*\/\/.*$/gm, '');
const loadAllCalls = (codeWithoutLineComments.match(/\bloadAll\s*\(/g) || []).length;
assert.equal(loadAllCalls, 1, 'loadAll should remain only as a legacy/full-refresh function definition');
assert.match(index, /const READ_CACHE_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
assert.match(index, /const CORE_BOOT_KEYS\s*=\s*\["staffAccounts"/);
assert.match(index, /function ensurePageDataLoaded\(page, options = \{\}\)/);
assert.match(index, /await loadKeys\(pageKeys\(state\.page\), \{ preferCache: false, requireServer: true \}\)/);
assert.match(index, /const postLoginKeys = CORE_BOOT_KEYS\.filter\(key => key !== "staffAccounts"\)/);

const store = fs.readFileSync('firebase-store.js', 'utf8');
assert.match(store, /function getReadMetrics\(\)/);
assert.match(store, /recordReadMetric\(key, snap\.docs\.length\)/);
console.log('PASS read-reduction-test: boot/page loading is demand-driven, realtime is page-scoped, and local read metrics are exposed.');
