'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const swSource = fs.readFileSync('sw.js', 'utf8');
const storeSource = fs.readFileSync('firebase-store.js', 'utf8');
const appSource = fs.readFileSync('index.html', 'utf8');
const apiSource = fs.readFileSync('api/admin/account.js', 'utf8');
let contextLastFetchOptions = null;

(async () => {
// Runtime simulation of the Service Worker fetch handler.
const handlers = {};
const context = {
  self: {
    addEventListener(type, handler) { handlers[type] = handler; },
    skipWaiting() {},
    clients: { claim() {} },
  },
  caches: {
    open: async () => ({ addAll: async () => {}, match: async () => undefined, put: async () => {} }),
    match: async () => undefined,
    keys: async () => [],
  },
  fetch: async (_request, options) => { contextLastFetchOptions = options; return new Response('ok', { status: 200 }); },
  URL,
  Request,
  Response,
  console,
  Promise,
};
vm.runInNewContext(swSource, context, { filename: 'sw.js' });

let apiRespondWithCalled = false;
awaitable(handlers.fetch({
  request: new Request('https://mitali1.vercel.app/api/admin/account', { headers: { Authorization: 'Bearer test' } }),
  respondWith() { apiRespondWithCalled = true; },
}));
assert.equal(apiRespondWithCalled, false, 'Service Worker must never intercept /api/*');

let staticRespondWithCalled = false;
awaitable(handlers.fetch({
  request: new Request('https://mitali1.vercel.app/index.html'),
  respondWith() { staticRespondWithCalled = true; },
}));
assert.equal(staticRespondWithCalled, true, 'Service Worker should still handle static GET requests');

let navigationResponsePromise = null;
awaitable(handlers.fetch({
  request: { method: 'GET', mode: 'navigate', destination: 'document', url: 'https://mitali1.vercel.app/' },
  respondWith(promise) { navigationResponsePromise = promise; },
}));
assert.ok(navigationResponsePromise, 'Service Worker must handle navigations');
await navigationResponsePromise;
assert.equal(contextLastFetchOptions.cache, 'no-store', 'navigation must prefer the network to avoid stale app shells');
assert.match(swSource, /hospital-v1\.3\.\d+-firestore-only/);
assert.doesNotMatch(swSource, /const urlsToCache = \[\'\.\/\',/);

// Runtime check that the timeout wrapper forwards cache: no-store to fetch.
let capturedOptions = null;
const fetchContext = {
  fetch: async (_url, options) => {
    capturedOptions = options;
    return { ok: true };
  },
  AbortController: undefined,
  setTimeout,
  clearTimeout,
};
const wrapperStart = storeSource.indexOf('async function fetchWithTimeout');
const wrapperEnd = storeSource.indexOf('\n\n  async function adminAccountRequest', wrapperStart);
const wrapper = vm.runInNewContext(`(${storeSource.slice(wrapperStart, wrapperEnd)})`, fetchContext);
await wrapper('/api/admin/account', { method: 'GET', cache: 'no-store', headers: { 'Cache-Control': 'no-store' } });
assert.equal(capturedOptions.cache, 'no-store');
assert.equal(capturedOptions.headers['Cache-Control'], 'no-store');

// Contract checks for the real permission-save path: POST response is applied
// locally and persisted before rendering; there is no stale immediate GET.
const permissionStart = appSource.indexOf('const response = await window.MitaliFirebase.adminUpdateAccount', appSource.indexOf('id="unifiedPermForm"'));
const permissionEnd = appSource.indexOf('    } catch (err) {', permissionStart);
assert.ok(permissionStart > 0 && permissionEnd > permissionStart, 'permission save path must exist');
const permissionBlock = appSource.slice(permissionStart, permissionEnd);
assert.ok(permissionBlock.indexOf('DB.staffAccounts[index]') < permissionBlock.indexOf('await cacheLocally'), 'local account must update before local cache write');
assert.ok(permissionBlock.indexOf('await cacheLocally') < permissionBlock.indexOf('await writeSyncBaseline'), 'local cache must update before baseline');
assert.equal(permissionBlock.includes('await refreshAccountsFromAdminApi'), false, 'permission save must not immediately rehydrate stale GET data');

assert.match(storeSource, /cache:\s*'no-store'/, 'account requests must use no-store');
assert.match(apiSource, /Cache-Control.*no-store/, 'account API responses must disable caching');
console.log('PASS permissions-cache-runtime-test: API requests bypass the Service Worker/cache, while permission save keeps the confirmed POST result in local state before rerender.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

function awaitable(value) {
  // fetch handlers call respondWith synchronously; this helper makes the intent explicit.
  return value;
}
